import { afterAll, beforeAll, describe, expect, test, vi } from "vitest";
import fs from "fs";
import os from "os";
import path from "path";
import request from "supertest";
import app from "../../app.js";
import { query } from "../../db/index.js";
import { createCompany, createSuperAdmin, createUser } from "../setup/helpers.js";

vi.mock("../../utils/email.js", () => ({ sendEmail: vi.fn().mockResolvedValue(undefined), sendInvitationEmail: vi.fn() }));
vi.mock("../../utils/notifyReviewers.js", () => ({ notifyReviewers: vi.fn().mockResolvedValue(undefined) }));

const sfx = () => `${Date.now()}-${Math.random().toString(16).slice(2)}`;

// Low (fifth review): a CONTRIBUTOR could send any non-audited assessment back to WIP —
// a colleague's submission or a reviewer-approved control — though the workflow only
// lets them unlock their own submission for editing.
describe("contributors reopen only their own submissions", () => {
  async function setup(status, submittedBy) {
    const c = await createCompany({ domain: `lc-${sfx()}.test` });
    const me = await createUser(c.id, "CONTRIBUTOR", { email: `me-${sfx()}@lc.test` });
    const other = await createUser(c.id, "CONTRIBUTOR", { email: `other-${sfx()}@lc.test` });
    const owner = submittedBy === "me" ? me.email : other.email;
    const { rows } = await query(
      `INSERT INTO assessments (company_id, quest_id, module_id, month, answer, review_status, submitted_by)
       VALUES ($1, 'Q-LC', 'M-LC', '2026-09', 'IMPLEMENTED', $2, $3) RETURNING id`,
      [c.id, status, owner.toUpperCase()]
    );
    return { me, id: rows[0].id };
  }
  const reopen = (u, id) => request(app).put(`/api/assessments/${id}`).set("Authorization", `Bearer ${u.token}`).send({ reviewStatus: "WIP" });
  const status = async (id) => (await query("SELECT review_status FROM assessments WHERE id = $1", [id])).rows[0].review_status;

  test.each(["Submitted", "FINISHED"])("a colleague's %s assessment stays as it is", async (st) => {
    const { me, id } = await setup(st, "other");
    const res = await reopen(me, id);
    expect(res.status).toBe(403);
    expect(res.body.code).toBe("NOT_OWN_SUBMISSION");
    expect(await status(id)).toBe(st);
  });

  test("their own submission can still be unlocked (email match is case-insensitive)", async () => {
    const { me, id } = await setup("Submitted", "me");
    expect((await reopen(me, id)).status).toBe(200);
    expect(await status(id)).toBe("WIP");
  });
});

// Low (fifth review): replacing a logo left the old file on disk forever, and logos were
// saved in the upload root while only /api/logos (UPLOAD_DIR/logos) is served, so no
// uploaded logo was ever shown.
describe("company logos", () => {
  const PNG = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.alloc(64)]);
  let dir, prev;
  beforeAll(() => { prev = process.env.UPLOAD_DIR; dir = fs.mkdtempSync(path.join(os.tmpdir(), "logos-")); process.env.UPLOAD_DIR = dir; });
  afterAll(() => { if (prev === undefined) delete process.env.UPLOAD_DIR; else process.env.UPLOAD_DIR = prev; fs.rmSync(dir, { recursive: true, force: true }); });
  const logos = () => (fs.existsSync(path.join(dir, "logos")) ? fs.readdirSync(path.join(dir, "logos")) : []);
  const upload = (tok, url = "/api/settings/logo") => request(app).post(url).set("Authorization", `Bearer ${tok}`).attach("logo", PNG, { filename: "l.png", contentType: "image/png" });

  test("an uploaded logo is served, as an image that can't be sniffed or scripted", async () => {
    const c = await createCompany({ domain: `lg-${sfx()}.test` });
    const admin = await createUser(c.id, "ADMIN", { email: `a-${sfx()}@lg.test` });
    const res = await upload(admin.token);
    expect(res.status).toBe(200);
    expect(res.body.logoUrl).toMatch(/^\/api\/logos\/logo-[\d-]+\.png$/);
    const served = await request(app).get(res.body.logoUrl);
    expect(served.status).toBe(200);
    expect(served.headers["content-type"]).toBe("image/png");
    expect(served.headers["x-content-type-options"]).toBe("nosniff");
    expect(served.headers["content-security-policy"]).toContain("sandbox");
  });

  test("replacing a logo deletes the old file (tenant admin and superadmin)", async () => {
    const c = await createCompany({ domain: `lg-${sfx()}.test` });
    const admin = await createUser(c.id, "ADMIN", { email: `a-${sfx()}@lg.test` });
    const sa = await createSuperAdmin({ email: `sa-${sfx()}@lg.test` });
    const before = new Set(logos());
    const first = await upload(admin.token);
    const second = await upload(sa.token, `/api/superadmin/companies/${c.id}/logo`);
    expect(second.status).toBe(200);
    const mine = logos().filter((f) => !before.has(f));
    expect(mine).toEqual([path.basename(second.body.logoUrl)]);
    expect((await request(app).get(first.body.logoUrl)).status).toBe(404);
  });

  test("a legacy /uploads/ logo in the upload root is removed when replaced", async () => {
    const c = await createCompany({ domain: `lg-${sfx()}.test` });
    const admin = await createUser(c.id, "ADMIN", { email: `a-${sfx()}@lg.test` });
    fs.writeFileSync(path.join(dir, "logo-legacy-1.png"), PNG);
    await query("INSERT INTO company_settings (company_id, logo_url) VALUES ($1, '/uploads/logo-legacy-1.png')", [c.id]);
    expect((await upload(admin.token)).status).toBe(200);
    expect(fs.existsSync(path.join(dir, "logo-legacy-1.png"))).toBe(false);
  });

  test("a stored logo_url can't point the cleanup outside the logo folders", async () => {
    const c = await createCompany({ domain: `lg-${sfx()}.test` });
    const admin = await createUser(c.id, "ADMIN", { email: `a-${sfx()}@lg.test` });
    fs.writeFileSync(path.join(dir, "keep.txt"), "x");
    await query("INSERT INTO company_settings (company_id, logo_url) VALUES ($1, '/uploads/../keep.txt')", [c.id]);
    expect((await upload(admin.token)).status).toBe(200);
    expect(fs.existsSync(path.join(dir, "keep.txt"))).toBe(true);
  });
});
