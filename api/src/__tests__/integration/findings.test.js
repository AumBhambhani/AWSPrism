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

describe("GET /api/findings", () => {
  test("lists findings scoped to the caller's company", async () => {
    const companyA = await createCompany({ domain: "a.com" });
    const companyB = await createCompany({ domain: "b.com" });
    await createFinding(companyA.id);
    await createFinding(companyB.id);
    const adminA = await createUser(companyA.id, "ADMIN");

    const res = await request(app).get("/api/findings").set("Authorization", `Bearer ${adminA.token}`);
    expect(res.status).toBe(200);
    expect(res.body.length).toBe(1);
  });

  test("filters to a single connection when connectionId is given", async () => {
    const company = await createCompany({ domain: "connscoped.com" });
    const admin = await createUser(company.id, "ADMIN");
    const findingOnConnA = await createFinding(company.id);
    await createFinding(company.id); // a second connection's finding, should be excluded

    const res = await request(app)
      .get(`/api/findings?connectionId=${findingOnConnA.connection_id}`)
      .set("Authorization", `Bearer ${admin.token}`);

    expect(res.status).toBe(200);
    expect(res.body.length).toBe(1);
    expect(res.body[0].id).toBe(findingOnConnA.id);
  });

  test("attaches resolved question ids to a finding whose test_key maps to a question", async () => {
    const company = await createCompany({ domain: "qlinked.com" });
    const admin = await createUser(company.id, "ADMIN");
    const finding = await createFinding(company.id); // test_key aws.network.s3_public_access_blocked -> ISO27001 A.8.2.3
    await query(
      `INSERT INTO questions (quest_id, company_id, module_id, iso_reference) VALUES ('Q1', $1, 'M1', 'A.8.2.3')`,
      [company.id]
    );

    const res = await request(app).get("/api/findings").set("Authorization", `Bearer ${admin.token}`);

    expect(res.status).toBe(200);
    expect(res.body.find((f) => f.id === finding.id).questIds).toEqual(["Q1"]);
  });

  test("returns an empty questIds array when the test_key has no matching question", async () => {
    const company = await createCompany({ domain: "qunlinked.com" });
    const admin = await createUser(company.id, "ADMIN");
    const finding = await createFinding(company.id);

    const res = await request(app).get("/api/findings").set("Authorization", `Bearer ${admin.token}`);

    expect(res.status).toBe(200);
    expect(res.body.find((f) => f.id === finding.id).questIds).toEqual([]);
  });
});

describe("PUT /api/findings/:id", () => {
  test("ADMIN can acknowledge a finding", async () => {
    const company = await createCompany();
    const admin = await createUser(company.id, "ADMIN");
    const finding = await createFinding(company.id);

    const res = await request(app)
      .put(`/api/findings/${finding.id}`)
      .set("Authorization", `Bearer ${admin.token}`)
      .send({ status: "acknowledged" });

    expect(res.status).toBe(200);
    expect(res.body.status).toBe("acknowledged");
  });

  test("rejects an invalid status", async () => {
    const company = await createCompany();
    const admin = await createUser(company.id, "ADMIN");
    const finding = await createFinding(company.id);

    const res = await request(app)
      .put(`/api/findings/${finding.id}`)
      .set("Authorization", `Bearer ${admin.token}`)
      .send({ status: "bogus" });

    expect(res.status).toBe(400);
  });

  test("returns 404 when the finding belongs to a different company", async () => {
    const companyA = await createCompany({ domain: "a2.com" });
    const companyB = await createCompany({ domain: "b2.com" });
    const finding = await createFinding(companyA.id);
    const adminB = await createUser(companyB.id, "ADMIN");

    const res = await request(app)
      .put(`/api/findings/${finding.id}`)
      .set("Authorization", `Bearer ${adminB.token}`)
      .send({ status: "acknowledged" });

    expect(res.status).toBe(404);
  });
});

describe("POST /api/findings/:id/promote", () => {
  test("creates a linked remediation action", async () => {
    const company = await createCompany();
    const admin = await createUser(company.id, "ADMIN");
    const finding = await createFinding(company.id);

    const res = await request(app)
      .post(`/api/findings/${finding.id}/promote`)
      .set("Authorization", `Bearer ${admin.token}`)
      .send({ owner: "security@testcorp.com", dueDate: "2026-09-01" });

    expect(res.status).toBe(201);

    const findingRow = await query(`SELECT linked_action_id FROM findings WHERE id = $1`, [finding.id]);
    expect(findingRow.rows[0].linked_action_id).toBe(res.body.id);
    expect(res.body.findingId).toBe(finding.id);
  });

  test("resolves and persists the linked question's quest_id onto the created action", async () => {
    const company = await createCompany();
    const admin = await createUser(company.id, "ADMIN");
    const finding = await createFinding(company.id);
    await query(
      `INSERT INTO questions (quest_id, company_id, module_id, iso_reference) VALUES ('Q1', $1, 'M1', 'A.8.2.3')`,
      [company.id]
    );

    const res = await request(app)
      .post(`/api/findings/${finding.id}/promote`)
      .set("Authorization", `Bearer ${admin.token}`)
      .send({});

    expect(res.status).toBe(201);
    expect(res.body.questIds).toEqual(["Q1"]);

    const actionRow = await query(`SELECT quest_id FROM actions WHERE id = $1`, [res.body.id]);
    expect(actionRow.rows[0].quest_id).toBe("Q1");
  });

  test("leaves quest_id null and questIds empty when no question maps to the finding's test_key", async () => {
    const company = await createCompany();
    const admin = await createUser(company.id, "ADMIN");
    const finding = await createFinding(company.id);

    const res = await request(app)
      .post(`/api/findings/${finding.id}/promote`)
      .set("Authorization", `Bearer ${admin.token}`)
      .send({});

    expect(res.status).toBe(201);
    expect(res.body.questIds).toEqual([]);

    const actionRow = await query(`SELECT quest_id FROM actions WHERE id = $1`, [res.body.id]);
    expect(actionRow.rows[0].quest_id).toBeNull();
  });

  test("refuses to promote the same finding twice", async () => {
    const company = await createCompany();
    const admin = await createUser(company.id, "ADMIN");
    const finding = await createFinding(company.id);

    await request(app).post(`/api/findings/${finding.id}/promote`).set("Authorization", `Bearer ${admin.token}`).send({});
    const res = await request(app).post(`/api/findings/${finding.id}/promote`).set("Authorization", `Bearer ${admin.token}`).send({});

    expect(res.status).toBe(409);
    expect(res.body.code).toBe("ALREADY_PROMOTED");
  });

  test("returns 404 when the finding belongs to a different company", async () => {
    const companyA = await createCompany({ domain: "a3.com" });
    const companyB = await createCompany({ domain: "b3.com" });
    const finding = await createFinding(companyA.id);
    const adminB = await createUser(companyB.id, "ADMIN");

    const res = await request(app)
      .post(`/api/findings/${finding.id}/promote`)
      .set("Authorization", `Bearer ${adminB.token}`)
      .send({});

    expect(res.status).toBe(404);
  });
});
