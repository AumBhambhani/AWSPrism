import { describe, test, expect } from "vitest";
import request from "supertest";
import app from "../../app.js";
import { createCompany, createUser } from "../setup/helpers.js";
import { query } from "../../db/index.js";

async function createFinding(companyId) {
  const conn = await query(
    `INSERT INTO integration_connections (company_id, integration_key, name) VALUES ($1, 'aws', 'Prod AWS') RETURNING *`,
    [companyId]
  );
  const finding = await query(
    `INSERT INTO findings (company_id, connection_id, test_key, resource_id, severity, title, description)
     VALUES ($1, $2, 'aws.network.s3_public_access_blocked', 'bucket-1', 'critical', 'Bucket exposed', 'bucket-1 does not block public access') RETURNING *`,
    [companyId, conn.rows[0].id]
  );
  return finding.rows[0];
}

async function createAction(companyId, overrides = {}) {
  const result = await query(
    `INSERT INTO actions (company_id, defeated_quest, owner, status, finding_id, quest_id)
     VALUES ($1, $2, $3, $4, $5, $6) RETURNING *`,
    [
      companyId,
      overrides.defeatedQuest || "Fix it",
      overrides.owner || null,
      overrides.status || "OPEN",
      overrides.findingId || null,
      overrides.questId || null,
    ]
  );
  return result.rows[0];
}

describe("GET /api/actions", () => {
  test("lists actions scoped to the caller's company", async () => {
    const companyA = await createCompany({ domain: "actionsa.com" });
    const companyB = await createCompany({ domain: "actionsb.com" });
    await createAction(companyA.id);
    await createAction(companyB.id);
    const adminA = await createUser(companyA.id, "ADMIN");

    const res = await request(app).get("/api/actions").set("Authorization", `Bearer ${adminA.token}`);

    expect(res.status).toBe(200);
    expect(res.body.length).toBe(1);
  });

  test("includes the source finding's title/severity/status when the action came from a finding", async () => {
    const company = await createCompany({ domain: "actionsfromfinding.com" });
    const admin = await createUser(company.id, "ADMIN");
    const finding = await createFinding(company.id);
    await createAction(company.id, { findingId: finding.id });

    const res = await request(app).get("/api/actions").set("Authorization", `Bearer ${admin.token}`);

    expect(res.status).toBe(200);
    expect(res.body[0].findingTitle).toBe(finding.title);
    expect(res.body[0].findingSeverity).toBe(finding.severity);
    expect(res.body[0].findingStatus).toBe(finding.status);
  });

  test("includes remediation tip guidance for an action linked to a finding with a known test_key", async () => {
    const company = await createCompany({ domain: "actionstip.com" });
    const admin = await createUser(company.id, "ADMIN");
    const finding = await createFinding(company.id); // aws.network.s3_public_access_blocked
    await createAction(company.id, { findingId: finding.id });

    const res = await request(app).get("/api/actions").set("Authorization", `Bearer ${admin.token}`);

    expect(res.status).toBe(200);
    expect(res.body[0].remediationTip.immediateAction).toMatch(/Block Public Access/);
    expect(res.body[0].remediationTip.steps.length).toBeGreaterThan(0);
  });

  test("omits remediation tip guidance for a manually-created action", async () => {
    const company = await createCompany({ domain: "actionsnotip.com" });
    const admin = await createUser(company.id, "ADMIN");
    await createAction(company.id);

    const res = await request(app).get("/api/actions").set("Authorization", `Bearer ${admin.token}`);

    expect(res.status).toBe(200);
    expect(res.body[0].remediationTip).toBeUndefined();
  });

  test("leaves finding fields null for a manually-created action", async () => {
    const company = await createCompany({ domain: "actionsmanual.com" });
    const admin = await createUser(company.id, "ADMIN");
    await createAction(company.id);

    const res = await request(app).get("/api/actions").set("Authorization", `Bearer ${admin.token}`);

    expect(res.status).toBe(200);
    expect(res.body[0].findingTitle).toBeNull();
    expect(res.body[0].findingId).toBeNull();
  });

  test("filters by findingId", async () => {
    const company = await createCompany({ domain: "actionsfilter.com" });
    const admin = await createUser(company.id, "ADMIN");
    const finding = await createFinding(company.id);
    const linked = await createAction(company.id, { findingId: finding.id });
    await createAction(company.id); // unrelated manual action, should be excluded

    const res = await request(app)
      .get(`/api/actions?findingId=${finding.id}`)
      .set("Authorization", `Bearer ${admin.token}`);

    expect(res.status).toBe(200);
    expect(res.body.length).toBe(1);
    expect(res.body[0].id).toBe(linked.id);
  });
});

describe("PUT /api/actions/:id", () => {
  test("CONTRIBUTOR can update an action", async () => {
    const company = await createCompany({ domain: "actionsput.com" });
    const contributor = await createUser(company.id, "CONTRIBUTOR");
    const action = await createAction(company.id);

    const res = await request(app)
      .put(`/api/actions/${action.id}`)
      .set("Authorization", `Bearer ${contributor.token}`)
      .send({ status: "COMPLETED", owner: "alice@testcorp.com" });

    expect(res.status).toBe(200);
    expect(res.body.status).toBe("COMPLETED");
    expect(res.body.owner).toBe("alice@testcorp.com");
  });

  test("treats an empty-string date field as clearing it, not a bad timestamp", async () => {
    const company = await createCompany({ domain: "actionsemptydate.com" });
    const admin = await createUser(company.id, "ADMIN");
    const action = await createAction(company.id);

    const res = await request(app)
      .put(`/api/actions/${action.id}`)
      .set("Authorization", `Bearer ${admin.token}`)
      .send({ owner: "alice@testcorp.com", dueDate: "2026-08-01", closureDate: "" });

    expect(res.status).toBe(200);
    expect(res.body.closureDate).toBeNull();
  });

  test("REVIEWER cannot update an action", async () => {
    const company = await createCompany({ domain: "actionsviewer.com" });
    const reviewer = await createUser(company.id, "REVIEWER");
    const action = await createAction(company.id);

    const res = await request(app)
      .put(`/api/actions/${action.id}`)
      .set("Authorization", `Bearer ${reviewer.token}`)
      .send({ status: "COMPLETED" });

    expect(res.status).toBe(403);
  });
});

describe("DELETE /api/actions/:id", () => {
  test("ADMIN can delete an action", async () => {
    const company = await createCompany({ domain: "actionsdel.com" });
    const admin = await createUser(company.id, "ADMIN");
    const action = await createAction(company.id);

    const res = await request(app).delete(`/api/actions/${action.id}`).set("Authorization", `Bearer ${admin.token}`);

    expect(res.status).toBe(204);
    const row = await query(`SELECT id FROM actions WHERE id = $1`, [action.id]);
    expect(row.rows.length).toBe(0);
  });

  test("CONTRIBUTOR cannot delete an action", async () => {
    const company = await createCompany({ domain: "actionsdelcontrib.com" });
    const contributor = await createUser(company.id, "CONTRIBUTOR");
    const action = await createAction(company.id);

    const res = await request(app)
      .delete(`/api/actions/${action.id}`)
      .set("Authorization", `Bearer ${contributor.token}`);

    expect(res.status).toBe(403);
  });
});
