import { afterAll, beforeAll, describe, expect, test, vi } from "vitest";
import fs from "fs";
import os from "os";
import path from "path";
import request from "supertest";
import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";
import app from "../../app.js";
import { query } from "../../db/index.js";
import { createCompany, createSuperAdmin, createUser } from "../setup/helpers.js";

vi.mock("../../utils/email.js", () => ({ sendEmail: vi.fn().mockResolvedValue(undefined), sendInvitationEmail: vi.fn() }));
vi.mock("../../utils/notifyReviewers.js", () => ({ notifyReviewers: vi.fn().mockResolvedValue(undefined) }));

// Reviewer B probes for F-16 / F-19 / F-20.

const PNG = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.alloc(64)]);
const PNG_HTML_POLYGLOT = Buffer.concat([
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
  Buffer.from("<html><script>fetch('/api/auth/me').then(r=>r.text()).then(alert)</script></html>"),
]);
const PIN = "482913";

let dir;
let prevUploadDir;
beforeAll(() => {
  prevUploadDir = process.env.UPLOAD_DIR;
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "reviewB-uploads-"));
  process.env.UPLOAD_DIR = dir;
});
afterAll(() => {
  if (prevUploadDir === undefined) delete process.env.UPLOAD_DIR; else process.env.UPLOAD_DIR = prevUploadDir;
  fs.rmSync(dir, { recursive: true, force: true });
});
// Logos are written to UPLOAD_DIR/logos (earlier builds wrote to the root) — check both.
const logoDirs = () => [dir, path.join(dir, "logos")].filter((d) => fs.existsSync(d));
const filesOnDisk = () => logoDirs().flatMap((d) => fs.readdirSync(d).filter((f) => f.startsWith("logo-")).map((f) => path.join(d, f)));
const clearDisk = () => filesOnDisk().forEach((f) => fs.unlinkSync(f));

const sfx = () => `${Date.now()}-${Math.random().toString(16).slice(2)}`;
async function userIn(companyId, role) {
  return createUser(companyId, role, { email: `${role.toLowerCase()}-${sfx()}@rb.test` });
}
async function companyWithPin(pin = PIN) {
  const c = await createCompany({ domain: `rb-${sfx()}.test` });
  if (pin) {
    await query(
      `INSERT INTO company_settings (company_id, vault_pin_hash) VALUES ($1, $2)
       ON CONFLICT (company_id) DO UPDATE SET vault_pin_hash = EXCLUDED.vault_pin_hash`,
      [c.id, await bcrypt.hash(pin, 4)]
    );
  }
  return c;
}
const logo = (tok, buf, name, type) =>
  request(app).post("/api/settings/logo").set("Authorization", `Bearer ${tok}`).attach("logo", buf, { filename: name, contentType: type });
const verify = (u, pin) => request(app).post("/api/vault/pin/verify").set("Authorization", `Bearer ${u.token}`).send({ pin });
const vaultList = (u, vt) => {
  const r = request(app).get("/api/vault").set("Authorization", `Bearer ${u.token}`);
  return vt ? r.set("X-Vault-Token", vt) : r;
};

describe("reviewB F-16 upload handling", () => {
  test("FAULT: a non-admin's logo upload is refused (403) but the file stays on disk", async () => {
    clearDisk();
    const c = await createCompany({ domain: `rb-${sfx()}.test` });
    const contrib = await userIn(c.id, "CONTRIBUTOR");
    const res = await logo(contrib.token, PNG, "x.png", "image/png");
    expect(res.status).toBe(403);
    expect(filesOnDisk()).toEqual([]);
  });

  test("FAULT: a superadmin (no company) logo upload to /api/settings/logo is refused but left on disk", async () => {
    clearDisk();
    const sa = await createSuperAdmin();
    const res = await logo(sa.token, PNG, "x.png", "image/png");
    expect(res.status).toBe(400);
    expect(filesOnDisk()).toEqual([]);
  });

  test("FAULT (hardening): a PNG/HTML polyglot is stored under the attacker-chosen .html extension", async () => {
    clearDisk();
    const c = await createCompany({ domain: `rb-${sfx()}.test` });
    const admin = await userIn(c.id, "ADMIN");
    const res = await logo(admin.token, PNG_HTML_POLYGLOT, "logo.html", "image/png");
    expect(res.status).toBe(200);
    expect(res.body.logoUrl).not.toMatch(/\.html$/);
  });
});

describe("reviewB F-20 vault token binding", () => {
  test("removing the PIN and re-setting the SAME PIN does not revive an old token", async () => {
    const c = await companyWithPin(null);
    const admin = await userIn(c.id, "ADMIN");
    const lead = await userIn(c.id, "LEAD");
    const setPin = () => request(app).put("/api/vault/pin").set("Authorization", `Bearer ${admin.token}`).send({ pin: PIN });
    expect((await setPin()).status).toBe(200);
    const old = (await verify(lead, PIN)).body.token;
    expect((await vaultList(lead, old)).status).toBe(200);
    expect((await request(app).delete("/api/vault/pin").set("Authorization", `Bearer ${admin.token}`)).status).toBe(200);
    expect((await setPin()).status).toBe(200);
    expect((await vaultList(lead, old)).status).toBe(403);
  });

  test("session JWT is not a vault token, vault token is not a session, tokens are user-bound, alg none refused", async () => {
    const c = await companyWithPin();
    const lead = await userIn(c.id, "LEAD");
    const other = await userIn(c.id, "CONTRIBUTOR");
    const vt = (await verify(lead, PIN)).body.token;
    expect((await vaultList(lead, lead.token)).status).toBe(403);
    expect((await request(app).get("/api/vault").set("Authorization", `Bearer ${vt}`)).status).toBe(401);
    expect((await vaultList(other, vt)).status).toBe(403);
    const decoded = jwt.decode(vt);
    const none = jwt.sign({ ...decoded }, null, { algorithm: "none" });
    expect((await vaultList(lead, none)).status).toBe(403);
    // A token from another company with the same PIN is refused.
    const c2 = await companyWithPin();
    const lead2 = await userIn(c2.id, "LEAD");
    expect((await vaultList(lead2, vt)).status).toBe(403);
  });
});

describe("reviewB F-19 PIN brute force", () => {
  test("10 wrong guesses lock the user even when successes are interleaved; other users unaffected", async () => {
    const c = await companyWithPin();
    const lead = await userIn(c.id, "LEAD");
    const peer = await userIn(c.id, "REVIEWER");
    for (let i = 0; i < 9; i++) expect((await verify(lead, "000000")).status).toBe(401);
    expect((await verify(lead, PIN)).status).toBe(200); // success not counted
    expect((await verify(lead, "000001")).status).toBe(401); // 10th failure
    const locked = await verify(lead, PIN);
    expect(locked.status).toBe(429);
    expect(locked.body.code).toBe("VAULT_PIN_LOCKED");
    // Parallel burst cannot slip past the limit.
    const burst = await Promise.all(Array.from({ length: 5 }, () => verify(lead, "123456")));
    expect(burst.every((r) => r.status === 429)).toBe(true);
    // X-Forwarded-For does not change the key.
    expect((await verify(lead, PIN).set("X-Forwarded-For", "9.9.9.9")).status).toBe(429);
    expect((await verify(peer, PIN)).status).toBe(200);
  });
});
