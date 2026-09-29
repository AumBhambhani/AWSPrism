import { afterAll, beforeAll, describe, expect, test, vi } from "vitest";
import fs from "fs";
import os from "os";
import path from "path";
import request from "supertest";
import app from "../../app.js";
import { createCompany, createSuperAdmin, createUser } from "../setup/helpers.js";

vi.mock("../../utils/email.js", () => ({ sendEmail: vi.fn().mockResolvedValue(undefined), sendInvitationEmail: vi.fn() }));
const scanner = vi.hoisted(() => ({ down: false }));
vi.mock("../../utils/scanFile.js", async (orig) => {
  const real = await orig();
  return { ...real, scanFile: vi.fn(async (...a) => (scanner.down ? { safe: false, unavailable: true, reason: "down" } : real.scanFile(...a))) };
});

// Accepted logos are written to disk — keep them out of the checkout's uploads folder.
let uploadDir, prevUploadDir;
beforeAll(() => { prevUploadDir = process.env.UPLOAD_DIR; uploadDir = fs.mkdtempSync(path.join(os.tmpdir(), "f16-")); process.env.UPLOAD_DIR = uploadDir; });
afterAll(() => { if (prevUploadDir === undefined) delete process.env.UPLOAD_DIR; else process.env.UPLOAD_DIR = prevUploadDir; fs.rmSync(uploadDir, { recursive: true, force: true }); });

// F-16 — logo uploads and spreadsheet imports were never scanned: any file declared
// image/* (incl. SVG) or named .xlsx was accepted as-is.

const PNG = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.alloc(64)]);
const SVG = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"><script>alert(document.cookie)</script></svg>');

async function admin() {
  const c = await createCompany({ domain: `f16-${Date.now()}-${Math.random().toString(16).slice(2)}.test` });
  return createUser(c.id, "ADMIN", { email: `a-${Date.now()}-${Math.random().toString(16).slice(2)}@f16.test` });
}
const logo = (u, buf, name, type) =>
  request(app).post("/api/settings/logo").set("Authorization", `Bearer ${u.token}`).attach("logo", buf, { filename: name, contentType: type });

describe("F-16 non-evidence uploads are scanned", () => {
  test("an SVG logo (script-capable) is rejected", async () => {
    expect((await logo(await admin(), SVG, "logo.svg", "image/svg+xml")).status).toBe(400);
  });

  test("a spoofed 'PNG' logo is rejected", async () => {
    expect((await logo(await admin(), SVG, "logo.png", "image/png")).status).toBe(400);
  });

  test("a real PNG logo is accepted", async () => {
    expect((await logo(await admin(), PNG, "logo.png", "image/png")).status).toBe(200);
  });

  test("a logo upload is refused (not accepted unscanned) while the scanner is down", async () => {
    scanner.down = true;
    try {
      const res = await logo(await admin(), PNG, "logo.png", "image/png");
      expect(res.status).toBe(503);
      expect(res.body.code).toBe("SCANNER_UNAVAILABLE");
    } finally {
      scanner.down = false;
    }
  });

  test("a spreadsheet import that is not really an .xlsx is rejected", async () => {
    const sa = await createSuperAdmin();
    const res = await request(app).post("/api/superadmin/preview-import").set("Authorization", `Bearer ${sa.token}`)
      .attach("file", Buffer.from("MZ not a spreadsheet"), { filename: "evil.xlsx", contentType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" });
    expect(res.status).toBe(400);
    const res2 = await request(app).post("/api/frameworks/import/batches").set("Authorization", `Bearer ${sa.token}`)
      .attach("file", Buffer.from("MZ not a spreadsheet"), { filename: "evil.xlsx", contentType: "application/octet-stream" });
    expect(res2.status).toBe(400);
  });
});
