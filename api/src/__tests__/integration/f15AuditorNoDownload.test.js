import { describe, expect, test, vi } from "vitest";
import request from "supertest";
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

// F-15 — auditors can view evidence but must not download it. requireReadOnly()
// always admits AUDITOR, so download routes guarded by it let auditors through.

async function setup() {
  const suffix = `${Date.now()}-${Math.random().toString(16).slice(2)}`;
  const company = await createCompany({ domain: `f15-${suffix}.test` });
  const admin = await createUser(company.id, "ADMIN", { email: `admin-${suffix}@f15.test` });
  const lead = await createUser(company.id, "LEAD", { email: `lead-${suffix}@f15.test` });
  const auditor = await createUser(company.id, "AUDITOR", { email: `auditor-${suffix}@f15.test` });
  await query(
    `INSERT INTO auditor_profiles (user_id, company_id, start_date, expiry_date, active)
     VALUES ($1, $2, CURRENT_DATE - 1, CURRENT_DATE + 30, TRUE)`,
    [auditor.id, company.id]
  );
  const up = await request(app)
    .post("/api/vault")
    .set("Authorization", `Bearer ${admin.token}`)
    .attach("file", Buffer.from("confidential evidence body"), { filename: "e.txt", contentType: "text/plain" })
    .field("title", "F15 doc");
  expect(up.status).toBe(201);
  const versions = await request(app).get(`/api/vault/${up.body.id}/versions`).set("Authorization", `Bearer ${admin.token}`);
  return { company, admin, lead, auditor, vaultId: up.body.id, versionId: versions.body[0]?.id };
}

const get = (path, user) => request(app).get(path).set("Authorization", `Bearer ${user.token}`);

describe("F-15 auditors can view but not download evidence", () => {
  test("AUDITOR cannot download a vault file", async () => {
    const { auditor, vaultId } = await setup();
    const res = await get(`/api/vault/${vaultId}/download`, auditor);
    expect(res.status).toBe(403);
    expect(res.text).not.toContain("confidential evidence body");
  });

  test("AUDITOR can still view a vault file inline", async () => {
    const { auditor, vaultId } = await setup();
    const res = await get(`/api/vault/${vaultId}/view`, auditor);
    expect(res.status).toBe(200);
    expect(res.headers["content-disposition"]).toMatch(/^inline/);
  });

  test("AUDITOR cannot download a vault version; can view it", async () => {
    const { auditor, vaultId, versionId } = await setup();
    expect(versionId).toBeTruthy();
    expect((await get(`/api/vault/${vaultId}/versions/${versionId}/download`, auditor)).status).toBe(403);
    expect((await get(`/api/vault/${vaultId}/versions/${versionId}/view`, auditor)).status).toBe(200);
  });

  test("AUDITOR cannot download legacy evidence", async () => {
    const { auditor } = await setup();
    const res = await get("/api/evidence/999999/download", auditor);
    expect(res.status).toBe(403);
  });

  test("downloaders keep download access", async () => {
    const { lead, vaultId, versionId } = await setup();
    const res = await get(`/api/vault/${vaultId}/download`, lead);
    expect(res.status).toBe(200);
    expect(res.headers["content-disposition"]).toMatch(/^attachment/);
    expect((await get(`/api/vault/${vaultId}/versions/${versionId}/download`, lead)).status).toBe(200);
    expect((await get("/api/evidence/999999/download", lead)).status).not.toBe(403);
  });
});
