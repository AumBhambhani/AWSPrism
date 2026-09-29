import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import request from "supertest";
import fs from "fs";
import os from "os";
import path from "path";
import app from "../../app.js";
import { query } from "../../db/index.js";
import { createCompany, createUser } from "../setup/helpers.js";

vi.mock("../../utils/scanFile.js", () => ({
  scanFile: vi.fn().mockResolvedValue({ safe: true }),
  scanBuffer: vi.fn().mockResolvedValue({ safe: true }),
}));

vi.mock("../../utils/notifyReviewers.js", () => ({
  notifyReviewers: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("../../utils/evidenceAnalysis.js", async (importOriginal) => {
  const actual = await importOriginal();
  return { ...actual, queueEvidenceAnalysis: vi.fn() };
});

const FILE_CONTENT = "tenant-private-evidence-content";
let uploadRoot;

beforeEach(() => {
  uploadRoot = fs.mkdtempSync(path.join(os.tmpdir(), "prism-evidence-boundary-"));
  process.env.UPLOAD_DIR = uploadRoot;
});

afterEach(() => {
  fs.rmSync(uploadRoot, { recursive: true, force: true });
  delete process.env.UPLOAD_DIR;
});

async function tenantPair() {
  const companyA = await createCompany({
    name: "Tenant A",
    domain: `tenant-a-${Date.now()}-${Math.random()}.test`,
    adminEmail: `admin-a-${Date.now()}-${Math.random()}@test.local`,
  });
  const companyB = await createCompany({
    name: "Tenant B",
    domain: `tenant-b-${Date.now()}-${Math.random()}.test`,
    adminEmail: `admin-b-${Date.now()}-${Math.random()}@test.local`,
  });
  const adminA = await createUser(companyA.id, "ADMIN", {
    email: `user-a-${Date.now()}-${Math.random()}@test.local`,
  });
  const adminB = await createUser(companyB.id, "ADMIN", {
    email: `user-b-${Date.now()}-${Math.random()}@test.local`,
  });
  return { companyA, companyB, adminA, adminB };
}

async function uploadEvidence(token, content = FILE_CONTENT, filename = "private.txt") {
  return request(app)
    .post("/api/evidence")
    .set("Authorization", `Bearer ${token}`)
    .attach("file", Buffer.from(content), { filename, contentType: "text/plain" })
    .field("evidenceType", "FILE")
    .field("evidenceName", filename);
}

describe("F-01 evidence tenant and storage boundary", () => {
  test("Tenant A cannot reassign Tenant B evidence into Tenant A", async () => {
    const { companyA, companyB, adminA, adminB } = await tenantPair();
    const uploaded = await uploadEvidence(adminB.token);
    expect(uploaded.status).toBe(201);

    const response = await request(app)
      .post(`/api/evidence/${uploaded.body.id}/reassign`)
      .set("Authorization", `Bearer ${adminA.token}`)
      .send({ targetAdminEmail: companyA.admin_email });

    expect.soft(response.status).toBe(404);
    const stored = await query("SELECT company_id FROM evidence WHERE id = $1", [uploaded.body.id]);
    expect(stored.rows[0].company_id).toBe(companyB.id);
  });

  test("a tenant administrator cannot use a cross-company reassignment API", async () => {
    const { companyA, adminA, adminB } = await tenantPair();
    const uploaded = await uploadEvidence(adminB.token);

    const response = await request(app)
      .post(`/api/evidence/${uploaded.body.id}/reassign`)
      .set("Authorization", `Bearer ${adminA.token}`)
      .send({ targetAdminEmail: companyA.admin_email });

    expect([404, 405]).toContain(response.status);
  });

  test("Tenant A cannot download Tenant B evidence after attempting reassignment", async () => {
    const { companyA, adminA, adminB } = await tenantPair();
    const uploaded = await uploadEvidence(adminB.token);

    const reassigned = await request(app)
      .post(`/api/evidence/${uploaded.body.id}/reassign`)
      .set("Authorization", `Bearer ${adminA.token}`)
      .send({ targetAdminEmail: companyA.admin_email });
    const downloaded = await request(app)
      .get(`/api/evidence/${uploaded.body.id}/download`)
      .set("Authorization", `Bearer ${adminA.token}`);

    expect.soft(reassigned.status).toBe(404);
    expect.soft(downloaded.status).toBe(404);
    expect(downloaded.text).not.toContain(FILE_CONTENT);
  });

  test("normal evidence metadata updates cannot change company or storage ownership", async () => {
    const { companyA, companyB, adminA } = await tenantPair();
    const uploaded = await uploadEvidence(adminA.token);
    const before = await query("SELECT company_id, file_path FROM evidence WHERE id = $1", [uploaded.body.id]);

    const response = await request(app)
      .put(`/api/evidence/${uploaded.body.id}`)
      .set("Authorization", `Bearer ${adminA.token}`)
      .send({
        evidenceName: "renamed.txt",
        companyId: companyB.id,
        filePath: path.join(uploadRoot, String(companyB.id), "other-tenant.txt"),
      });

    expect(response.status).toBe(200);
    const after = await query("SELECT company_id, file_path FROM evidence WHERE id = $1", [uploaded.body.id]);
    expect(after.rows[0].company_id).toBe(companyA.id);
    expect(after.rows[0].file_path).toBe(before.rows[0].file_path);
  });

  test("client-controlled filePath cannot create a downloadable reference to another tenant's file", async () => {
    const { adminA, adminB } = await tenantPair();
    const victimUpload = await uploadEvidence(adminB.token);
    const victimRow = await query("SELECT file_path FROM evidence WHERE id = $1", [victimUpload.body.id]);

    const forged = await request(app)
      .post("/api/evidence")
      .set("Authorization", `Bearer ${adminA.token}`)
      .send({
        evidenceType: "FILE",
        evidenceName: "forged-reference.txt",
        filePath: victimRow.rows[0].file_path,
      });

    const downloaded = forged.body.id
      ? await request(app)
          .get(`/api/evidence/${forged.body.id}/download`)
          .set("Authorization", `Bearer ${adminA.token}`)
      : null;

    expect.soft(forged.status).toBe(400);
    if (downloaded) {
      expect.soft(downloaded.status).toBe(404);
      expect(downloaded.text).not.toContain(FILE_CONTENT);
    }
  });

  test("legitimate same-tenant evidence upload and download remains functional", async () => {
    const company = await createCompany({
      domain: `same-tenant-${Date.now()}-${Math.random()}.test`,
      adminEmail: `same-tenant-${Date.now()}-${Math.random()}@test.local`,
    });
    const admin = await createUser(company.id, "ADMIN");
    const uploaded = await uploadEvidence(admin.token, "same-tenant-content", "same.txt");

    expect(uploaded.status).toBe(201);
    const downloaded = await request(app)
      .get(`/api/evidence/${uploaded.body.id}/download`)
      .set("Authorization", `Bearer ${admin.token}`);

    expect(downloaded.status).toBe(200);
    expect(downloaded.text).toBe("same-tenant-content");
  });

  test("evidence API responses do not expose local filesystem paths", async () => {
    const company = await createCompany({
      domain: `path-redaction-${Date.now()}-${Math.random()}.test`,
      adminEmail: `path-redaction-${Date.now()}-${Math.random()}@test.local`,
    });
    const admin = await createUser(company.id, "ADMIN");
    const uploaded = await uploadEvidence(admin.token);
    const listed = await request(app)
      .get("/api/evidence")
      .set("Authorization", `Bearer ${admin.token}`);

    expect(uploaded.status).toBe(201);
    expect(listed.status).toBe(200);
    expect(uploaded.body).not.toHaveProperty("filePath");
    expect(listed.body[0]).not.toHaveProperty("filePath");
    expect(JSON.stringify({ uploaded: uploaded.body, listed: listed.body })).not.toContain(uploadRoot);
  });
});
