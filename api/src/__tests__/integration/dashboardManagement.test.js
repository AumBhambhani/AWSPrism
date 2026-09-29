import { describe, test, expect } from "vitest";
import request from "supertest";
import app from "../../app.js";
import { createCompany, createUser, createDepartment, setQuestDepartments } from "../setup/helpers.js";
import { query } from "../../db/index.js";

const AUTH = (t) => ["Authorization", `Bearer ${t}`];

// A YYYY-MM string `offset` whole months before now (0 = current month).
function monthsAgo(offset) {
  const d = new Date();
  d.setDate(1);
  d.setMonth(d.getMonth() - offset);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
}

async function addQuestion(companyId, questId, { owner = null, moduleId = "M1" } = {}) {
  await query(
    `INSERT INTO questions (company_id, quest_id, module_id, baseline_question, control_area, default_owner)
     VALUES ($1, $2, $3, 'Q?', 'Area', $4)`,
    [companyId, questId, moduleId, owner]
  );
}

async function addAssessment(
  companyId,
  questId,
  { month, answer, level, moduleId = "M1", reviewStatus = "FINISHED" }
) {
  await query(
    `INSERT INTO assessments (company_id, quest_id, module_id, month, answer, current_level, review_status)
     VALUES ($1, $2, $3, $4, $5, $6, $7)`,
    [companyId, questId, moduleId, month, answer, level, reviewStatus]
  );
}

async function addFinding(companyId, connectionId, { testKey, resourceId, severity, status, ageDays = 0, title }) {
  const detected = `NOW() - INTERVAL '${ageDays} days'`;
  await query(
    `INSERT INTO findings (company_id, connection_id, test_key, resource_id, severity, status, title, first_detected_at, last_detected_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7, ${detected}, ${detected})`,
    [companyId, connectionId, testKey, resourceId, severity, status, title]
  );
}

async function makeConnection(companyId) {
  const r = await query(
    `INSERT INTO integration_connections (company_id, integration_key, name) VALUES ($1, 'aws', 'AWS') RETURNING id`,
    [companyId]
  );
  return r.rows[0].id;
}

describe("GET /api/dashboard/management", () => {
  test("empty company returns a well-formed zeroed payload", async () => {
    const company = await createCompany({ domain: "mgmt-empty.com" });
    const admin = await createUser(company.id, "ADMIN");

    const res = await request(app).get("/api/dashboard/management?months=6").set(...AUTH(admin.token));

    expect(res.status).toBe(200);
    expect(res.body.readiness).toBe(0);
    expect(res.body.readinessDelta).toBe(0);
    expect(res.body.readinessTrend).toHaveLength(6);
    expect(res.body.readinessTrend.every((p) => p.value === null)).toBe(true);
    expect(res.body.controlStatus).toEqual({ total: 0, compliant: 0, partial: 0, nonCompliant: 0, notAssessed: 0 });
    expect(res.body.riskHeatmap).toHaveLength(4);
    expect(res.body.riskHeatmap.flat().every((n) => n === 0)).toBe(true);
    expect(res.body.topRisks).toEqual([]);
    expect(res.body.departments).toEqual([]);
    expect(res.body.evidenceStatus).toEqual({ collected: 0, pending: 0, overdue: 0 });
  });

  test("clamps the months window to [3, 24]", async () => {
    const company = await createCompany({ domain: "mgmt-clamp.com" });
    const admin = await createUser(company.id, "ADMIN");

    const low = await request(app).get("/api/dashboard/management?months=1").set(...AUTH(admin.token));
    const high = await request(app).get("/api/dashboard/management?months=99").set(...AUTH(admin.token));

    expect(low.body.readinessTrend).toHaveLength(3);
    expect(high.body.readinessTrend).toHaveLength(24);
  });

  test("computes readiness trend, headline and delta from monthly assessments", async () => {
    const company = await createCompany({ domain: "mgmt-trend.com" });
    const admin = await createUser(company.id, "ADMIN");
    const now = new Date();
    const ym = (offset) => {
      const d = new Date(now.getFullYear(), now.getMonth() - offset, 1);
      return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
    };

    await addQuestion(company.id, "Q1");
    await addQuestion(company.id, "Q2");

    // 2 months ago: both NOT_IMPLEMENTED level 1  -> implSum 0, levelSum 2 of total 2
    //   -> maturity 2/(5*2)=0.2 -> round(100*(0.4*0.2)) = 8
    await addAssessment(company.id, "Q1", { month: ym(2), answer: "NOT_IMPLEMENTED", level: 1 });
    await addAssessment(company.id, "Q2", { month: ym(2), answer: "NOT_IMPLEMENTED", level: 1 });
    // current month: both IMPLEMENTED level 5 -> impl 1, maturity 1 -> 100
    await addAssessment(company.id, "Q1", { month: ym(0), answer: "IMPLEMENTED", level: 5 });
    await addAssessment(company.id, "Q2", { month: ym(0), answer: "IMPLEMENTED", level: 5 });

    const res = await request(app).get("/api/dashboard/management?months=6").set(...AUTH(admin.token));

    expect(res.status).toBe(200);
    const byMonth = Object.fromEntries(res.body.readinessTrend.map((p) => [p.month, p.value]));
    expect(byMonth[ym(2)]).toBe(8);
    expect(byMonth[ym(1)]).toBe(8); // carry-forward: last approved state persists
    expect(byMonth[ym(0)]).toBe(100);
    expect(res.body.readiness).toBe(100);
    expect(res.body.readinessDelta).toBe(92);
  });

  test("readiness dedupes multiple assessment rows for the same control in a month", async () => {
    const company = await createCompany({ domain: "mgmt-dedupe.com" });
    const admin = await createUser(company.id, "ADMIN");

    await addQuestion(company.id, "Q1");
    await addQuestion(company.id, "Q2");
    const m = monthsAgo(0);
    // Q1 assessed twice in the same month — only the latest (IMPLEMENTED) should count
    await addAssessment(company.id, "Q1", { month: m, answer: "NOT_IMPLEMENTED", level: 1 });
    await addAssessment(company.id, "Q1", { month: m, answer: "IMPLEMENTED", level: 5 });
    await addAssessment(company.id, "Q2", { month: m, answer: "IMPLEMENTED", level: 5 });

    const res = await request(app).get("/api/dashboard/management").set(...AUTH(admin.token));
    const byMonth = Object.fromEntries(res.body.readinessTrend.map((p) => [p.month, p.value]));
    // Both controls effectively IMPLEMENTED level 5 -> 100, not dragged down by the stale row
    expect(byMonth[m]).toBe(100);
  });

  test("readiness does not penalise controls that have no maturity level recorded", async () => {
    const company = await createCompany({ domain: "mgmt-nolevel.com" });
    const admin = await createUser(company.id, "ADMIN");

    await addQuestion(company.id, "Q1");
    await addQuestion(company.id, "Q2");
    const m = monthsAgo(0);
    // Fully implemented, but nobody recorded a maturity level
    await addAssessment(company.id, "Q1", { month: m, answer: "IMPLEMENTED", level: null });
    await addAssessment(company.id, "Q2", { month: m, answer: "IMPLEMENTED", level: null });

    const res = await request(app).get("/api/dashboard/management").set(...AUTH(admin.token));
    const byMonth = Object.fromEntries(res.body.readinessTrend.map((p) => [p.month, p.value]));
    // impl = 1, maturity term falls back to impl -> 100 (not 60)
    expect(byMonth[m]).toBe(100);
  });

  test("readiness and controlStatus count approved (FINISHED + AUDITED) assessments", async () => {
    const company = await createCompany({ domain: "mgmt-approved.com" });
    const admin = await createUser(company.id, "ADMIN");

    await addQuestion(company.id, "Q1");
    await addQuestion(company.id, "Q2");
    await addQuestion(company.id, "Q3");
    const m = monthsAgo(0);
    // Q1 fully implemented but still in review; Q2 approved (FINISHED); Q3 auditor-signed-off (AUDITED)
    await addAssessment(company.id, "Q1", { month: m, answer: "IMPLEMENTED", level: 5, reviewStatus: "WIP" });
    await addAssessment(company.id, "Q2", { month: m, answer: "IMPLEMENTED", level: 5, reviewStatus: "FINISHED" });
    await addAssessment(company.id, "Q3", { month: m, answer: "IMPLEMENTED", level: 5, reviewStatus: "AUDITED" });

    const res = await request(app).get("/api/dashboard/management").set(...AUTH(admin.token));

    // Q2 + Q3 count (AUDITED behaves as FINISHED): implSum 2, levelSum 10 of total 3
    // -> impl 2/3, maturity 10/15 -> both .667 -> 67
    const byMonth = Object.fromEntries(res.body.readinessTrend.map((p) => [p.month, p.value]));
    expect(byMonth[m]).toBe(67);
    expect(res.body.controlStatus).toEqual({
      total: 3, compliant: 2, partial: 0, nonCompliant: 0, notAssessed: 1,
    });
  });

  test("controlStatus buckets the latest assessment per question", async () => {
    const company = await createCompany({ domain: "mgmt-controls.com" });
    const admin = await createUser(company.id, "ADMIN");

    await addQuestion(company.id, "Q1");
    await addQuestion(company.id, "Q2");
    await addQuestion(company.id, "Q3");
    await addQuestion(company.id, "Q4"); // never assessed

    // Q1: superseded NOT_IMPLEMENTED then IMPLEMENTED -> compliant
    await addAssessment(company.id, "Q1", { month: "2025-01", answer: "NOT_IMPLEMENTED", level: 1 });
    await addAssessment(company.id, "Q1", { month: "2025-05", answer: "IMPLEMENTED", level: 4 });
    await addAssessment(company.id, "Q2", { month: "2025-05", answer: "PARTIALLY_IMPLEMENTED", level: 2 });
    await addAssessment(company.id, "Q3", { month: "2025-05", answer: "NOT_IMPLEMENTED", level: 1 });

    const res = await request(app).get("/api/dashboard/management").set(...AUTH(admin.token));

    expect(res.body.controlStatus).toEqual({
      total: 4, compliant: 1, partial: 1, nonCompliant: 1, notAssessed: 1,
    });
  });

  test("risk heatmap and top risks derive from findings", async () => {
    const company = await createCompany({ domain: "mgmt-risk.com" });
    const admin = await createUser(company.id, "ADMIN");
    const conn = await makeConnection(company.id);

    // open critical, fresh  -> likelihood 2, impact 3
    await addFinding(company.id, conn, { testKey: "aws.iam.mfa_enforced", resourceId: "r1", severity: "critical", status: "open", ageDays: 2, title: "MFA" });
    // open critical, fresh, same title -> groups with the one above (count 2)
    await addFinding(company.id, conn, { testKey: "aws.iam.mfa_enforced", resourceId: "r2", severity: "critical", status: "open", ageDays: 2, title: "MFA" });
    // open low, old -> likelihood 3, impact 0
    await addFinding(company.id, conn, { testKey: "aws.iam.mfa_enforced", resourceId: "r3", severity: "low", status: "open", ageDays: 90, title: "Old low" });
    // resolved high -> likelihood 0, impact 2, excluded from topRisks
    await addFinding(company.id, conn, { testKey: "aws.iam.mfa_enforced", resourceId: "r4", severity: "high", status: "resolved", ageDays: 5, title: "Resolved" });

    const res = await request(app).get("/api/dashboard/management").set(...AUTH(admin.token));

    expect(res.body.riskHeatmap[2][3]).toBe(2);
    expect(res.body.riskHeatmap[3][0]).toBe(1);
    expect(res.body.riskHeatmap[0][2]).toBe(1);
    expect(res.body.topRisks[0]).toEqual({ title: "MFA", severity: "critical", count: 2 });
    expect(res.body.topRisks.find((r) => r.title === "Resolved")).toBeUndefined();
    expect(res.body.openRisks).toBe(3);
    expect(res.body.highRisks).toBe(2);
  });

  test("departments bucket questions by their owner and score each bucket", async () => {
    const company = await createCompany({ domain: "mgmt-dept.com" });
    const admin = await createUser(company.id, "ADMIN");

    await addQuestion(company.id, "Q1", { owner: "Head of IT" });
    await addQuestion(company.id, "Q2", { owner: "Head of IT" });
    await addQuestion(company.id, "Q3", { owner: "  " }); // blank -> Unassigned

    await addAssessment(company.id, "Q1", { month: "2025-05", answer: "IMPLEMENTED", level: 5 });
    await addAssessment(company.id, "Q2", { month: "2025-05", answer: "IMPLEMENTED", level: 5 });

    const res = await request(app).get("/api/dashboard/management").set(...AUTH(admin.token));

    const it = res.body.departments.find((d) => d.name === "Head of IT");
    expect(it).toMatchObject({ controls: 2, readiness: 100 });
    const unassigned = res.body.departments.find((d) => d.name === "Unassigned");
    expect(unassigned).toMatchObject({ controls: 1 });
    expect(res.body.departmentCount).toBe(1); // "Unassigned" excluded
  });

  test("once departments exist, buckets follow department ownership (joint controls count in each)", async () => {
    const company = await createCompany({ domain: "mgmt-realdept.com" });
    const admin = await createUser(company.id, "ADMIN");
    const itDept = await createDepartment(company.id, "IT");
    const secDept = await createDepartment(company.id, "Security");

    await addQuestion(company.id, "Q1", { owner: "Head of IT" });
    await addQuestion(company.id, "Q2", { owner: "Head of IT" });
    await addQuestion(company.id, "Q3", { owner: "Head of IT" }); // unmapped -> Unassigned
    await setQuestDepartments(company.id, "Q1", [itDept.id]);
    await setQuestDepartments(company.id, "Q2", [itDept.id, secDept.id]);

    await addAssessment(company.id, "Q2", { month: "2025-05", answer: "IMPLEMENTED", level: 5 });

    const res = await request(app).get("/api/dashboard/management").set(...AUTH(admin.token));
    const byName = Object.fromEntries(res.body.departments.map((d) => [d.name, d]));
    expect(byName.IT).toMatchObject({ controls: 2 });
    expect(byName.Security).toMatchObject({ controls: 1, readiness: 100 });
    expect(byName.Unassigned).toMatchObject({ controls: 1 });
    expect(byName["Head of IT"]).toBeUndefined();
    expect(res.body.departmentCount).toBe(2);
  });

  test("does not leak another company's data", async () => {
    const a = await createCompany({ domain: "mgmt-iso-a.com" });
    const b = await createCompany({ domain: "mgmt-iso-b.com" });
    const adminA = await createUser(a.id, "ADMIN");
    await createUser(b.id, "ADMIN");
    await addQuestion(b.id, "Q1");
    await addAssessment(b.id, "Q1", { month: "2025-05", answer: "IMPLEMENTED", level: 5 });

    const res = await request(app).get("/api/dashboard/management").set(...AUTH(adminA.token));
    expect(res.body.controlStatus.total).toBe(0);
  });

  test("AUDITOR access is audit logged", async () => {
    const company = await createCompany({ domain: "mgmt-audit.com" });
    const auditor = await createUser(company.id, "AUDITOR");
    await query(
      `INSERT INTO auditor_profiles (user_id, company_id, expiry_date, active)
       VALUES ($1, $2, CURRENT_DATE + INTERVAL '14 days', TRUE)`,
      [auditor.id, company.id]
    );

    const res = await request(app).get("/api/dashboard/management").set(...AUTH(auditor.token));
    expect(res.status).toBe(200);

    const logs = await query(
      "SELECT * FROM audit_logs WHERE company_id = $1 AND resource = 'dashboard-management'",
      [company.id]
    );
    expect(logs.rows.length).toBe(1);
  });
});
