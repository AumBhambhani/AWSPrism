import { afterAll, beforeAll, describe, expect, test, vi } from "vitest";
import fs from "fs";
import os from "os";
import path from "path";
import http from "http";
import jwt from "jsonwebtoken";
import request from "supertest";
import app from "../../app.js";
import { query } from "../../db/index.js";
import { createCompany, createSuperAdmin, createUser } from "../setup/helpers.js";
import { logoFilePath } from "../../utils/logoStorage.js";

vi.mock("../../utils/email.js", () => ({ sendEmail: vi.fn().mockResolvedValue(undefined), sendInvitationEmail: vi.fn() }));
vi.mock("../../utils/notifyReviewers.js", () => ({ notifyReviewers: vi.fn().mockResolvedValue(undefined) }));

const sfx = () => `${Date.now()}-${Math.random().toString(16).slice(2)}`;
const PNG = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.alloc(64)]);

describe("review6B logos", () => {
  let dir, prev;
  beforeAll(() => { prev = process.env.UPLOAD_DIR; dir = fs.mkdtempSync(path.join(os.tmpdir(), "r6b-logos-")); process.env.UPLOAD_DIR = dir; });
  afterAll(() => { if (prev === undefined) delete process.env.UPLOAD_DIR; else process.env.UPLOAD_DIR = prev; fs.rmSync(dir, { recursive: true, force: true }); });
  const logos = () => (fs.existsSync(path.join(dir, "logos")) ? fs.readdirSync(path.join(dir, "logos")) : []);

  // HELD probes
  test("HELD: logoFilePath refuses traversal / non-logo names", () => {
    for (const u of ["/api/logos/../../etc/passwd", "/api/logos/..", "/uploads/../x", "/api/logos/logo-..", "/api/logos/", null, 5, "/api/logos/1/evidence.pdf"]) {
      const p = logoFilePath(u);
      if (p) expect(p.startsWith(path.join(dir, "logos") + path.sep) || p.startsWith(dir + path.sep)).toBe(true);
      if (p) expect(path.basename(p)).toMatch(/^logo-/);
    }
    expect(logoFilePath("/api/logos/..%2f..%2fx")).toBeNull();
  });

  test("HELD: no directory listing, dotfiles denied, traversal not served", async () => {
    fs.mkdirSync(path.join(dir, "logos"), { recursive: true });
    fs.writeFileSync(path.join(dir, "logos", ".secret"), "s");
    fs.writeFileSync(path.join(dir, "outside.txt"), "outside");
    const list = await request(app).get("/api/logos/");
    expect(list.status).toBe(404);
    expect((await request(app).get("/api/logos/.secret")).status).not.toBe(200);
    expect((await request(app).get("/api/logos/..%2foutside.txt")).status).not.toBe(200);
    expect((await request(app).get("/api/logos/%2e%2e/outside.txt")).status).not.toBe(200);
  });

  test("HELD: non-admin roles refused before multer writes", async () => {
    const c = await createCompany({ domain: `r6b-${sfx()}.test` });
    const lead = await createUser(c.id, "LEAD", { email: `l-${sfx()}@r6b.test` });
    const before = logos().length;
    const res = await request(app).post("/api/settings/logo").set("Authorization", `Bearer ${lead.token}`).attach("logo", PNG, { filename: "l.png", contentType: "image/png" });
    expect(res.status).toBe(403);
    expect(logos().length).toBe(before);
  });

  // FAULT probe (P4): superadmin upload for a company that doesn't exist leaves a
  // scanned logo on disk (publicly served at /api/logos/<name>) and returns 500.
  test("FAULT: superadmin logo upload for a non-existent company leaves no orphan file", async () => {
    const sa = await createSuperAdmin({ email: `sa-${sfx()}@r6b.test` });
    const before = new Set(logos());
    const res = await request(app).post("/api/superadmin/companies/999999/logo").set("Authorization", `Bearer ${sa.token}`).attach("logo", PNG, { filename: "l.png", contentType: "image/png" });
    const added = logos().filter((f) => !before.has(f));
    expect(res.status).not.toBe(500);
    expect(added).toEqual([]);
  });

  // FAULT probe (P4): the disk magic check for image/webp only checks "RIFF", so any
  // RIFF container (WAV/AVI) is accepted and served as image/webp. scanBuffer checks "WEBP".
  test("FAULT: a RIFF/WAVE file is not accepted as a WebP logo", async () => {
    const c = await createCompany({ domain: `r6b-${sfx()}.test` });
    const admin = await createUser(c.id, "ADMIN", { email: `a-${sfx()}@r6b.test` });
    const wav = Buffer.concat([Buffer.from("RIFF"), Buffer.from([0x24, 0, 0, 0]), Buffer.from("WAVEfmt "), Buffer.alloc(64)]);
    const res = await request(app).post("/api/settings/logo").set("Authorization", `Bearer ${admin.token}`).attach("logo", wav, { filename: "x.webp", contentType: "image/webp" });
    expect(res.status).toBe(400);
  });
});

// FAULT probe (P3): PUT /api/settings/evidence-storage connectivity test lets any tenant
// ADMIN point the server at an arbitrary host:port (Azure connection string BlobEndpoint)
// and reflects the raw SDK / network error text, incl. the internal endpoint and body.
describe("review6B storage test-connection error reflection", () => {
  let server, port;
  beforeAll(async () => {
    server = http.createServer((req, res) => {
      res.writeHead(403, { "content-type": "application/xml" });
      res.end("<?xml version=\"1.0\"?><Error><Code>AuthenticationFailed</Code><Message>INTERNAL-BANNER-r6b host=db-primary.internal</Message></Error>");
    });
    await new Promise((r) => server.listen(0, "127.0.0.1", r));
    port = server.address().port;
  });
  afterAll(() => new Promise((r) => server.close(r)));

  test("FAULT: raw SDK/internal-endpoint text does not reach the client", async () => {
    const c = await createCompany({ domain: `r6b-${sfx()}.test` });
    const admin = await createUser(c.id, "ADMIN", { email: `a-${sfx()}@r6b.test` });
    const cs = `DefaultEndpointsProtocol=http;AccountName=devx;AccountKey=${Buffer.from("k").toString("base64")};BlobEndpoint=http://127.0.0.1:${port}/devx;`;
    const res = await request(app).put("/api/settings/evidence-storage").set("Authorization", `Bearer ${admin.token}`)
      .send({ backend: "azure_blob", config: { container: "c" }, secret: { connectionString: cs } });
    console.log("[r6b] status", res.status, "body", JSON.stringify(res.body));
    expect(res.status).toBe(400);
    expect(JSON.stringify(res.body)).not.toMatch(/INTERNAL-BANNER|127\.0\.0\.1|db-primary/);
  }, 60000);

  test("FAULT (oracle): closed internal port error text is not reflected", async () => {
    const c = await createCompany({ domain: `r6b-${sfx()}.test` });
    const admin = await createUser(c.id, "ADMIN", { email: `a-${sfx()}@r6b.test` });
    const cs = `DefaultEndpointsProtocol=http;AccountName=devx;AccountKey=${Buffer.from("k").toString("base64")};BlobEndpoint=http://127.0.0.1:1/devx;`;
    const res = await request(app).put("/api/settings/evidence-storage").set("Authorization", `Bearer ${admin.token}`)
      .send({ backend: "azure_blob", config: { container: "c" }, secret: { connectionString: cs } });
    console.log("[r6b] closed-port status", res.status, "body", JSON.stringify(res.body));
    expect(JSON.stringify(res.body)).not.toMatch(/ECONNREFUSED|127\.0\.0\.1/);
  }, 60000);
});

// F-21 type-confusion probes (HELD expected) + consent residual
describe("review6B super-admin tv", () => {
  const sign = (p) => jwt.sign(p, process.env.JWT_SECRET, { expiresIn: "1h" });

  test("HELD: tv '0' / null / missing handled; bumped version rejects old", async () => {
    const sa = await createSuperAdmin({ email: `sa-${sfx()}@r6b.test` });
    const id = jwt.decode(sa.token).userId;
    const base = { userId: id, email: "x", role: "SUPERADMIN", companyId: null };
    const me = (t) => request(app).get("/api/superadmin/companies").set("Authorization", `Bearer ${t}`);
    expect((await me(sign({ ...base, tv: 0 }))).status).toBe(200);
    expect((await me(sign({ ...base }))).status).toBe(200);          // legacy: no tv == 0
    expect((await me(sign({ ...base, tv: "0" }))).status).toBe(401); // string not equal
    expect((await me(sign({ ...base, tv: null }))).status).toBe(200); // null ?? 0 == 0 (same as legacy)
    await query("UPDATE super_admins SET token_version = token_version + 1 WHERE id = $1", [id]);
    expect((await me(sign({ ...base, tv: 0 }))).status).toBe(401);
    expect((await me(sign({ ...base }))).status).toBe(401);
    expect((await me(sign({ ...base, tv: null }))).status).toBe(401);
    expect((await me(sign({ ...base, tv: 1 }))).status).toBe(200);
  });

  // FAULT probe (P4, pre-existing): consent routes jwt.verify directly — a revoked session
  // (tv mismatch) or a password-reset purpose token is still accepted as identity.
  test("FAULT: /api/consent/link refuses a revoked session token", async () => {
    const c = await createCompany({ domain: `r6b-${sfx()}.test` });
    const u = await createUser(c.id, "ADMIN", { email: `a-${sfx()}@r6b.test` });
    await query("UPDATE users SET token_version = token_version + 1 WHERE id = $1", [u.id]);
    const res = await request(app).patch("/api/consent/link").set("Authorization", `Bearer ${u.token}`);
    expect(res.status).toBe(401);
  });
});
