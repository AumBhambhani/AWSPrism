import { describe, test, expect } from "vitest";
import request from "supertest";
import app from "../../app.js";
import { createCompany, createUser } from "../setup/helpers.js";
import { query } from "../../db/index.js";

describe("GET /api/dashboard — automatedCoverage", () => {

  test("counts distinct controls satisfied by at least one fresh automated evidence item", async () => {
    const company = await createCompany({ domain: "dashauto1.com" });
    const admin = await createUser(company.id, "ADMIN");

    // One question mapped to a test with fresh automated evidence
    await query(
      `INSERT INTO questions (company_id, quest_id, module_id, baseline_question, iso_reference, control_area)
       VALUES ($1, 'Q1', 'M1', 'MFA enforced?', 'A.9.4.2', 'Access control')`,
      [company.id]
    );
    // A second question with no automated coverage at all
    await query(
      `INSERT INTO questions (company_id, quest_id, module_id, baseline_question, iso_reference, control_area)
       VALUES ($1, 'Q2', 'M1', 'Backups tested?', 'A.17.1.3', 'Continuity')`,
      [company.id]
    );

    // aws.iam.mfa_enforced / A.9.4.2 is already seeded by init.sql (automated_tests + test_control_mappings)
    const connRes = await query(
      `INSERT INTO integration_connections (company_id, integration_key, name) VALUES ($1, 'aws', 'Prod AWS') RETURNING *`,
      [company.id]
    );
    await query(
      `INSERT INTO automated_evidence_items (company_id, connection_id, test_key, resource_id, payload_hash, status, last_collected_at)
       VALUES ($1, $2, 'aws.iam.mfa_enforced', 'account', 'deadbeef', 'fresh', NOW())`,
      [company.id, connRes.rows[0].id]
    );

    const res = await request(app).get("/api/dashboard").set("Authorization", `Bearer ${admin.token}`);

    expect(res.status).toBe(200);
    expect(res.body.automatedCoverage.count).toBe(1);
    expect(res.body.automatedCoverage.total).toBe(2);
    expect(res.body.automatedCoverage.questions).toEqual([
      expect.objectContaining({
        questId: "Q1",
        controlArea: "Access control",
        testKeys: ["aws.iam.mfa_enforced"],
        integrationKeys: ["aws"]
      })
    ]);
  });

  test("matches DPDPA mappings via control_area, not just iso_reference", async () => {
    const company = await createCompany({ domain: "dashauto3.com" });
    const admin = await createUser(company.id, "ADMIN");

    // DPDPA question: iso_reference is a whole subsection ("Sec 8(5)") shared by many
    // unrelated control areas, so the mapping must key off control_area instead.
    await query(
      `INSERT INTO questions (company_id, quest_id, module_id, baseline_question, iso_reference, control_area)
       VALUES ($1, 'PL-Q076', 'PL', 'MFA for sensitive systems implemented?', 'Sec 8(5)', 'MFA for Sensitive Systems')`,
      [company.id]
    );
    // Different control area, same DPDPA subsection — must NOT be counted as covered.
    await query(
      `INSERT INTO questions (company_id, quest_id, module_id, baseline_question, iso_reference, control_area)
       VALUES ($1, 'PL-Q094', 'PL', 'Backups tested?', 'Sec 8(5)', 'Backup & Recovery')`,
      [company.id]
    );

    // aws.iam.mfa_enforced is already seeded by init.sql; ensure the DPDPA control_area
    // mapping under test exists (syncTestDefinitions() creates the same row at startup, so
    // it may already be present — this test only needs it to be there, not to own it).
    const connRes = await query(
      `INSERT INTO integration_connections (company_id, integration_key, name) VALUES ($1, 'aws', 'Prod AWS') RETURNING *`,
      [company.id]
    );
    await query(
      `INSERT INTO test_control_mappings (test_key, framework, iso_reference)
       VALUES ('aws.iam.mfa_enforced', 'DPDPA', 'MFA for Sensitive Systems')
       ON CONFLICT (test_key, framework, iso_reference) DO NOTHING`
    );
    await query(
      `INSERT INTO automated_evidence_items (company_id, connection_id, test_key, resource_id, payload_hash, status, last_collected_at)
       VALUES ($1, $2, 'aws.iam.mfa_enforced', 'account', 'deadbeef', 'fresh', NOW())`,
      [company.id, connRes.rows[0].id]
    );

    const res = await request(app).get("/api/dashboard").set("Authorization", `Bearer ${admin.token}`);

    expect(res.status).toBe(200);
    expect(res.body.automatedCoverage.count).toBe(1);
    expect(res.body.automatedCoverage.questions.map(q => q.questId)).toEqual(["PL-Q076"]);
  });

  test("counts a question covered only through question_framework_controls (crosswalk propagation)", async () => {
    const company = await createCompany({ domain: "dashauto4.com" });
    const admin = await createUser(company.id, "ADMIN");

    // A GDPR question whose iso_reference / control_area do NOT match any connector's
    // ISO clause — it is tied to GDPR Art. 32(1)(b) only via the canonical crosswalk.
    await query(
      `INSERT INTO questions (company_id, quest_id, module_id, baseline_question, iso_reference, control_area)
       VALUES ($1, 'QG', 'M1', 'Authentication secure?', 'GDPR-32', 'Security of processing')`,
      [company.id]
    );
    await query(
      `INSERT INTO question_framework_controls (company_id, quest_id, framework_key, control_reference)
       VALUES ($1, 'QG', 'GDPR', 'Art. 32(1)(b)')`,
      [company.id]
    );
    await query(
      `INSERT INTO test_control_mappings (test_key, framework, iso_reference)
       VALUES ('aws.iam.mfa_enforced', 'GDPR', 'Art. 32(1)(b)')
       ON CONFLICT (test_key, framework, iso_reference) DO NOTHING`
    );

    const connRes = await query(
      `INSERT INTO integration_connections (company_id, integration_key, name) VALUES ($1, 'aws', 'Prod AWS') RETURNING *`,
      [company.id]
    );
    await query(
      `INSERT INTO automated_evidence_items (company_id, connection_id, test_key, resource_id, payload_hash, status, last_collected_at)
       VALUES ($1, $2, 'aws.iam.mfa_enforced', 'account', 'deadbeef', 'fresh', NOW())`,
      [company.id, connRes.rows[0].id]
    );

    const res = await request(app).get("/api/dashboard").set("Authorization", `Bearer ${admin.token}`);
    expect(res.status).toBe(200);
    expect(res.body.automatedCoverage.count).toBe(1);
    expect(res.body.automatedCoverage.questions.map((q) => q.questId)).toEqual(["QG"]);
  });

  test("does not count a stale automated evidence item", async () => {
    const company = await createCompany({ domain: "dashauto2.com" });
    const admin = await createUser(company.id, "ADMIN");

    await query(
      `INSERT INTO questions (company_id, quest_id, module_id, baseline_question, iso_reference, control_area)
       VALUES ($1, 'Q1', 'M1', 'MFA enforced?', 'A.9.4.2', 'Access control')`,
      [company.id]
    );
    const connRes = await query(
      `INSERT INTO integration_connections (company_id, integration_key, name) VALUES ($1, 'aws', 'Prod AWS') RETURNING *`,
      [company.id]
    );
    await query(
      `INSERT INTO automated_evidence_items (company_id, connection_id, test_key, resource_id, payload_hash, status, last_collected_at)
       VALUES ($1, $2, 'aws.iam.mfa_enforced', 'account', 'deadbeef', 'stale', NOW())`,
      [company.id, connRes.rows[0].id]
    );

    const res = await request(app).get("/api/dashboard").set("Authorization", `Bearer ${admin.token}`);
    expect(res.status).toBe(200);
    expect(res.body.automatedCoverage.count).toBe(0);
    expect(res.body.automatedCoverage.total).toBe(1);
  });
});
