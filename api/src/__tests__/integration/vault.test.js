import { describe, test, expect, vi } from "vitest";
import request from "supertest";
import app from "../../app.js";
import { createCompany, createUser } from "../setup/helpers.js";
import { query } from "../../db/index.js";

vi.mock("../../utils/scanFile.js", () => ({
  scanFile: vi.fn().mockResolvedValue({ safe: true }),
  scanBuffer: vi.fn().mockResolvedValue({ safe: true }),
}));

vi.mock("../../utils/notifyReviewers.js", () => ({
  notifyReviewers: vi.fn().mockResolvedValue(undefined),
}));

const TEXT_FILE = Buffer.from("test document content");

async function uploadFile(token, title = "Test Doc") {
  return request(app)
    .post("/api/vault")
    .set("Authorization", `Bearer ${token}`)
    .attach("file", TEXT_FILE, { filename: "test.txt", contentType: "text/plain" })
    .field("title", title);
}

describe("GET /api/vault", () => {
  test("returns empty array for new company", async () => {
    const company = await createCompany();
    const admin = await createUser(company.id, "ADMIN");

    const res = await request(app)
      .get("/api/vault")
      .set("Authorization", `Bearer ${admin.token}`);

    expect(res.status).toBe(200);
    expect(res.body).toEqual([]);
  });

  test("returns 401 without token", async () => {
    const res = await request(app).get("/api/vault");
    expect(res.status).toBe(401);
  });

  test("source=automated returns only automated items with freshness status", async () => {
    const company = await createCompany({ domain: "vaultsrc1.com" });
    const admin = await createUser(company.id, "ADMIN");

    // A manually-uploaded item (should be excluded)
    await request(app)
      .post("/api/vault")
      .set("Authorization", `Bearer ${admin.token}`)
      .attach("file", TEXT_FILE, { filename: "manual.txt", contentType: "text/plain" })
      .field("title", "Manual Upload");

    // An automated item, inserted the same way collectionRunner.js does
    const connRes = await query(
      `INSERT INTO integration_connections (company_id, integration_key, name) VALUES ($1, 'aws', 'Prod AWS') RETURNING *`,
      [company.id]
    );
    const vaultRes = await query(
      `INSERT INTO evidence_vault (company_id, title, description, uploaded_by) VALUES ($1, $2, $3, 'automated') RETURNING *`,
      [company.id, "aws.iam.mfa_enforced — account", "All IAM users have MFA enabled"]
    );
    await query(
      `INSERT INTO automated_evidence_items (company_id, connection_id, evidence_vault_id, test_key, resource_id, payload_hash, status, last_collected_at)
       VALUES ($1, $2, $3, 'aws.iam.mfa_enforced', 'account', 'deadbeef', 'fresh', NOW())`,
      [company.id, connRes.rows[0].id, vaultRes.rows[0].id]
    );

    const res = await request(app).get("/api/vault?source=automated").set("Authorization", `Bearer ${admin.token}`);

    expect(res.status).toBe(200);
    expect(res.body.length).toBe(1);
    expect(res.body[0].title).toBe("aws.iam.mfa_enforced — account");
    expect(res.body[0].freshnessStatus).toBe("fresh");
    expect(res.body[0].testKey).toBe("aws.iam.mfa_enforced");
  });

  test("without source param, still returns both manual and automated items", async () => {
    const company = await createCompany({ domain: "vaultsrc2.com" });
    const admin = await createUser(company.id, "ADMIN");

    await request(app)
      .post("/api/vault")
      .set("Authorization", `Bearer ${admin.token}`)
      .attach("file", TEXT_FILE, { filename: "manual.txt", contentType: "text/plain" })
      .field("title", "Manual Upload");

    const res = await request(app).get("/api/vault").set("Authorization", `Bearer ${admin.token}`);
    expect(res.status).toBe(200);
    expect(res.body.length).toBe(1);
    // pg returns SQL NULL for the outer-joined aei.status column on a manual-only
    // row, and JSON.stringify keeps explicit `null` values (only `undefined` is
    // dropped) — so this is `null`, not an absent/undefined key.
    expect(res.body[0].freshnessStatus).toBeNull();
  });

  test("source=automated does not leak automated items from other companies", async () => {
    // Create company A with an automated item
    const companyA = await createCompany({ domain: "vaultsrc3a.com" });
    const adminA = await createUser(companyA.id, "ADMIN");

    const connResA = await query(
      `INSERT INTO integration_connections (company_id, integration_key, name) VALUES ($1, 'aws', 'Prod AWS') RETURNING *`,
      [companyA.id]
    );
    const vaultResA = await query(
      `INSERT INTO evidence_vault (company_id, title, description, uploaded_by) VALUES ($1, $2, $3, 'automated') RETURNING *`,
      [companyA.id, "aws.iam.mfa_enforced — account", "All IAM users have MFA enabled"]
    );
    await query(
      `INSERT INTO automated_evidence_items (company_id, connection_id, evidence_vault_id, test_key, resource_id, payload_hash, status, last_collected_at)
       VALUES ($1, $2, $3, 'aws.iam.mfa_enforced', 'account', 'deadbeef', 'fresh', NOW())`,
      [companyA.id, connResA.rows[0].id, vaultResA.rows[0].id]
    );

    // Create company B and query as its admin
    const companyB = await createCompany({ domain: "vaultsrc3b.com" });
    const adminB = await createUser(companyB.id, "ADMIN");

    const res = await request(app).get("/api/vault?source=automated").set("Authorization", `Bearer ${adminB.token}`);

    expect(res.status).toBe(200);
    // Company B has no vault items at all, even with source=automated filter
    expect(res.body.length).toBe(0);
  });
});

describe("POST /api/vault", () => {
  test("uploads a file and returns vault item", async () => {
    const company = await createCompany();
    const admin = await createUser(company.id, "ADMIN");

    const res = await uploadFile(admin.token, "My Policy Doc");

    expect(res.status).toBe(201);
    expect(res.body.id).toBeDefined();
    expect(res.body.title).toBe("My Policy Doc");
    expect(res.body.fileName).toBe("test.txt");
  });

  test("returns 400 when title is missing", async () => {
    const company = await createCompany();
    const admin = await createUser(company.id, "ADMIN");

    const res = await request(app)
      .post("/api/vault")
      .set("Authorization", `Bearer ${admin.token}`)
      .attach("file", TEXT_FILE, { filename: "test.txt", contentType: "text/plain" });

    expect(res.status).toBe(400);
  });

  test("REVIEWER role is forbidden", async () => {
    const company = await createCompany();
    const reviewer = await createUser(company.id, "REVIEWER");

    const res = await uploadFile(reviewer.token);
    expect(res.status).toBe(403);
  });

  test("uploaded item appears in GET list", async () => {
    const company = await createCompany();
    const admin = await createUser(company.id, "ADMIN");

    await uploadFile(admin.token, "Listed Doc");

    const res = await request(app)
      .get("/api/vault")
      .set("Authorization", `Bearer ${admin.token}`);

    expect(res.status).toBe(200);
    expect(res.body.length).toBe(1);
    expect(res.body[0].title).toBe("Listed Doc");
  });
});

// Waits for the fire-and-forget queueEvidenceAnalysis to settle on a vault row,
// optionally for a specific analysed-version number.
async function waitForAnalysis(vaultId, { version = null, tries = 100 } = {}) {
  for (let i = 0; i < tries; i++) {
    const r = await query(
      "SELECT ai_analyzed_at, ai_analyzed_version, ai_analysis_status FROM evidence_vault WHERE id = $1",
      [vaultId]
    );
    const row = r.rows[0];
    const settled = row && row.ai_analysis_status === null && row.ai_analyzed_at;
    if (settled && (version === null || row.ai_analyzed_version === version)) return row;
    await new Promise((res) => setTimeout(res, 50));
  }
  throw new Error(`analysis did not settle for vault ${vaultId}`);
}

// AI is opt-in per company — enable it so auto-analysis actually runs.
async function enableAi(companyId) {
  await query(
    `INSERT INTO company_settings (company_id, ai_enabled) VALUES ($1, TRUE)
     ON CONFLICT (company_id) DO UPDATE SET ai_enabled = TRUE`,
    [companyId]
  );
}

describe("auto AI analysis on upload (PRISM_AI_PROVIDER=none)", () => {
  test("a fresh upload gets analysed and stamped with version 1", async () => {
    const company = await createCompany({ domain: "autoai1.com" });
    const admin = await createUser(company.id, "ADMIN");
    await enableAi(company.id);

    const up = await uploadFile(admin.token, "Auto Analysed Doc");
    expect(up.status).toBe(201);

    const row = await waitForAnalysis(up.body.id, { version: 1 });
    expect(row.ai_analyzed_version).toBe(1);
    expect(row.ai_analysis_status).toBeNull();

    // exposed through the API for reviewers/auditors
    const detail = await request(app)
      .get(`/api/vault/${up.body.id}`)
      .set("Authorization", `Bearer ${admin.token}`);
    expect(detail.status).toBe(200);
    expect(detail.body.aiContributorComments).toBeTruthy();
    expect(detail.body.currentVersion).toBe(1);
  });

  test("uploading a new version re-runs analysis against version 2", async () => {
    const company = await createCompany({ domain: "autoai2.com" });
    const admin = await createUser(company.id, "ADMIN");
    await enableAi(company.id);

    const up = await uploadFile(admin.token, "Versioned Doc");
    await waitForAnalysis(up.body.id, { version: 1 });

    const v2 = await request(app)
      .post(`/api/vault/${up.body.id}/versions`)
      .set("Authorization", `Bearer ${admin.token}`)
      .attach("file", Buffer.from("v2 content"), { filename: "test-v2.txt", contentType: "text/plain" });
    expect(v2.status).toBe(201);

    const row = await waitForAnalysis(up.body.id, { version: 2 });
    expect(row.ai_analyzed_version).toBe(2);
  });
});

describe("GET /api/vault/:id", () => {
  test("returns vault item by id", async () => {
    const company = await createCompany();
    const admin = await createUser(company.id, "ADMIN");

    const upload = await uploadFile(admin.token, "Single Doc");
    const id = upload.body.id;

    const res = await request(app)
      .get(`/api/vault/${id}`)
      .set("Authorization", `Bearer ${admin.token}`);

    expect(res.status).toBe(200);
    expect(res.body.id).toBe(id);
  });

  test("returns 404 for unknown id", async () => {
    const company = await createCompany();
    const admin = await createUser(company.id, "ADMIN");

    const res = await request(app)
      .get("/api/vault/99999")
      .set("Authorization", `Bearer ${admin.token}`);

    expect(res.status).toBe(404);
  });
});

describe("DELETE /api/vault/:id", () => {
  test("deletes vault item", async () => {
    const company = await createCompany();
    const admin = await createUser(company.id, "ADMIN");

    const upload = await uploadFile(admin.token, "To Delete");
    const id = upload.body.id;

    const res = await request(app)
      .delete(`/api/vault/${id}`)
      .set("Authorization", `Bearer ${admin.token}`);

    expect(res.status).toBe(204);
  });

  test("CONTRIBUTOR cannot delete vault items", async () => {
    const company = await createCompany();
    const admin = await createUser(company.id, "ADMIN");
    const contributor = await createUser(company.id, "CONTRIBUTOR");

    const upload = await uploadFile(admin.token, "Protected");
    const id = upload.body.id;

    const res = await request(app)
      .delete(`/api/vault/${id}`)
      .set("Authorization", `Bearer ${contributor.token}`);

    expect(res.status).toBe(403);
  });
});
