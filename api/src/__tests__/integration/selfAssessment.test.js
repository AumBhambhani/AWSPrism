import { describe, test, expect, vi } from "vitest";
import request from "supertest";
import app from "../../app.js";
import { query } from "../../db/index.js";
import { createCompany, createUser, createSuperAdmin } from "../setup/helpers.js";

const sendEmail = vi.fn().mockResolvedValue({ sent: true });
vi.mock("../../utils/email.js", () => ({
  sendEmail: (...args) => sendEmail(...args),
}));

async function seedSubmission(companyId, userId, email, department, answers) {
  await query(
    `INSERT INTO self_assessment_submissions (company_id, user_id, user_email, department, answers, submitted_at)
     VALUES ($1, $2, $3, $4, $5, NOW())`,
    [companyId, userId, email, department, JSON.stringify(answers)]
  );
}

describe("POST /api/self-assessment/complete", () => {
  test("emails the user + the team on first completion and stamps the company", async () => {
    sendEmail.mockClear();
    const company = await createCompany({ name: "Finisher Inc" });
    const admin = await createUser(company.id, "ADMIN", { email: "admin@finisher.io" });
    await seedSubmission(company.id, admin.id, admin.email, "IT", { "it-15": "NO", "it-16": "YES" });
    // IT and HR are mandatory departments — both must be in for the set to be complete.
    await seedSubmission(company.id, admin.id, admin.email, "HR", { "hr-1": "YES" });

    const res = await request(app)
      .post("/api/self-assessment/complete")
      .set("Authorization", `Bearer ${admin.token}`)
      .send({ departments: ["IT"] });

    expect(res.status).toBe(200);
    expect(res.body.firstCompletion).toBe(true);
    expect(res.body.departmentStatus.complete).toBe(true);

    const recipients = sendEmail.mock.calls.map((c) => c[0].to);
    expect(recipients).toContain("admin@finisher.io");
    expect(recipients).toContain("team@prismgrc.co");

    const row = (await query("SELECT self_assessment_completed_at FROM companies WHERE id = $1", [company.id])).rows[0];
    expect(row.self_assessment_completed_at).not.toBeNull();
  });

  test("a late delegated department, submitted via the API, unlocks the report and notifies the team", async () => {
    const company = await createCompany({ name: "LateDept Co" });
    const admin = await createUser(company.id, "ADMIN", { email: "admin@latedept.io" });
    const legal = await createUser(company.id, "CONTRIBUTOR", { email: "legal@latedept.io" });
    await seedSubmission(company.id, admin.id, admin.email, "IT", { "it-1": "YES" });
    await seedSubmission(company.id, admin.id, admin.email, "HR", { "hr-1": "YES" });

    // Admin finishes their part but declares IT + Legal (HR is added as mandatory).
    await request(app)
      .post("/api/self-assessment/complete")
      .set("Authorization", `Bearer ${admin.token}`)
      .send({ departments: ["IT", "Legal"] });

    let row = (await query("SELECT self_assessment_all_departments_at FROM companies WHERE id = $1", [company.id])).rows[0];
    expect(row.self_assessment_all_departments_at).toBeNull();

    sendEmail.mockClear();
    // Legal submits through the real endpoint.
    const res = await request(app)
      .post("/api/self-assessment")
      .set("Authorization", `Bearer ${legal.token}`)
      .send({ department: "Legal", answers: { "legal-1": "YES" } });
    expect(res.status).toBe(200);

    row = (await query("SELECT self_assessment_all_departments_at FROM companies WHERE id = $1", [company.id])).rows[0];
    expect(row.self_assessment_all_departments_at).not.toBeNull();
    expect(sendEmail.mock.calls.map(c => c[0].subject).some(s => /All departments now submitted/.test(s))).toBe(true);
  });

  test("a second call does not re-notify the team", async () => {
    const company = await createCompany();
    const admin = await createUser(company.id, "ADMIN");
    await seedSubmission(company.id, admin.id, admin.email, "HR", { "hr-1": "PARTIAL" });

    await request(app).post("/api/self-assessment/complete").set("Authorization", `Bearer ${admin.token}`);
    sendEmail.mockClear();
    const res = await request(app).post("/api/self-assessment/complete").set("Authorization", `Bearer ${admin.token}`);

    expect(res.status).toBe(200);
    expect(res.body.firstCompletion).toBe(false);
    const recipients = sendEmail.mock.calls.map((c) => c[0].to);
    expect(recipients).not.toContain("team@prismgrc.co");
  });
});

describe("superadmin self-assessment endpoints", () => {
  test("report endpoint 404s for an unknown company", async () => {
    const su = await createSuperAdmin();
    const res = await request(app)
      .get("/api/superadmin/companies/999999/self-assessment")
      .set("Authorization", `Bearer ${su.token}`);
    expect(res.status).toBe(404);
  });

  test("report endpoint returns the paginated document for a company with submissions", async () => {
    const su = await createSuperAdmin({ email: "platform-admin@prism.test" });
    const company = await createCompany({ name: "Report Co" });
    const admin = await createUser(company.id, "ADMIN", { email: "the.admin@reportco.io" });
    await seedSubmission(company.id, admin.id, admin.email, "IT", { "it-15": "NO", "it-1": "NO", "it-11": "NO" });

    const res = await request(app)
      .get(`/api/superadmin/companies/${company.id}/self-assessment`)
      .set("Authorization", `Bearer ${su.token}`);

    expect(res.status).toBe(200);
    expect(res.body.report).not.toHaveProperty("html");
    const doc = res.body.report.document;
    expect(doc).toContain("Report Co");
    expect(doc).toContain("Annexure G — Gap Remediation Detail");
    expect(doc).toContain("Cross-Department Consistency Checks");
    // "Requested by" names the company's own admin, never the superadmin.
    expect(doc).toContain("the.admin@reportco.io");
    expect(doc).not.toContain("platform-admin@prism.test");
    expect(res.body.emailedTo).toBeNull(); // no ?email=1 → no send
  });

  test("?format=docx streams the report as a Word document (same gate, no email)", async () => {
    sendEmail.mockClear();
    const su = await createSuperAdmin();
    const company = await createCompany({ name: "Docx Report Co" });
    const admin = await createUser(company.id, "ADMIN");
    await seedSubmission(company.id, admin.id, admin.email, "IT", { "it-15": "NO", "it-1": "NO", "it-11": "NO" });

    const res = await request(app)
      .get(`/api/superadmin/companies/${company.id}/self-assessment?format=docx`)
      .set("Authorization", `Bearer ${su.token}`)
      .buffer(true)
      .parse((r, cb) => { const chunks = []; r.on("data", c => chunks.push(c)); r.on("end", () => cb(null, Buffer.concat(chunks))); });

    expect(res.status).toBe(200);
    expect(res.headers["content-type"]).toContain("wordprocessingml.document");
    expect(res.headers["content-disposition"]).toContain('Docx_Report_Co_DPDPA_Readiness_Assessment.docx');
    expect(res.body.length).toBeGreaterThan(20_000);
    expect(res.body.slice(0, 2).toString()).toBe("PK"); // zip magic
    expect(sendEmail).not.toHaveBeenCalled();
  });

  test("?format=docx is gated until every selected department has submitted", async () => {
    const su = await createSuperAdmin();
    const company = await createCompany({ name: "Gated Docx Co" });
    const admin = await createUser(company.id, "ADMIN");
    await seedSubmission(company.id, admin.id, admin.email, "IT", { "it-15": "NO" });
    await request(app)
      .post("/api/self-assessment/complete")
      .set("Authorization", `Bearer ${admin.token}`)
      .send({ departments: ["IT", "Legal"] });

    const res = await request(app)
      .get(`/api/superadmin/companies/${company.id}/self-assessment?format=docx`)
      .set("Authorization", `Bearer ${su.token}`);
    expect(res.status).toBe(409);
    expect(res.body.status).toBe("incomplete");
  });

  test("?email=1 sends a concise notification (not a rendered report) to the gap-report recipient", async () => {
    sendEmail.mockClear();
    const su = await createSuperAdmin();
    const company = await createCompany({ name: "Emailed Report Co" });
    const admin = await createUser(company.id, "ADMIN");
    await seedSubmission(company.id, admin.id, admin.email, "IT", { "it-15": "NO" });

    const res = await request(app)
      .get(`/api/superadmin/companies/${company.id}/self-assessment?email=1`)
      .set("Authorization", `Bearer ${su.token}`);

    expect(res.status).toBe(200);
    expect(res.body.emailedTo).toBe("ab@neozaar.com");
    const call = sendEmail.mock.calls.find(c => c[0].to === "ab@neozaar.com");
    expect(call).toBeTruthy();
    expect(call[0].subject).toMatch(/Gap Assessment Report — Emailed Report Co/);
    expect(call[0].html).toContain("Emailed Report Co");
    expect(call[0].html).toMatch(/Assessment coverage/i);
    expect(call[0].html).toContain("Open it in PRISM");
    expect(call[0].html).not.toContain("Annexure G"); // it is a notification, not the report
  });

  test("AI narrative cache: an unchanged fingerprint is not regenerated", async () => {
    const su = await createSuperAdmin();
    const company = await createCompany({ name: "Cache Co" });
    const admin = await createUser(company.id, "ADMIN");
    await seedSubmission(company.id, admin.id, admin.email, "IT", { "it-15": "NO" });

    const get = () => request(app)
      .get(`/api/superadmin/companies/${company.id}/self-assessment`)
      .set("Authorization", `Bearer ${su.token}`);

    await get();
    const first = (await query("SELECT narrative_fingerprint, generated_at FROM self_assessment_reports WHERE company_id = $1", [company.id])).rows[0];
    expect(first.narrative_fingerprint).toBeTruthy();

    await new Promise(r => setTimeout(r, 20));
    await get();
    const second = (await query("SELECT narrative_fingerprint, generated_at FROM self_assessment_reports WHERE company_id = $1", [company.id])).rows[0];
    // same fingerprint, and the cache hit did not rewrite the row
    expect(second.narrative_fingerprint).toBe(first.narrative_fingerprint);
    expect(new Date(second.generated_at).getTime()).toBe(new Date(first.generated_at).getTime());
  });

  test("a malformed cached narrative blob still yields a full document", async () => {
    const su = await createSuperAdmin();
    const company = await createCompany({ name: "Malformed Blob Co" });
    const admin = await createUser(company.id, "ADMIN");
    await seedSubmission(company.id, admin.id, admin.email, "IT", { "it-15": "NO", "it-1": "NO" });
    await query(
      `INSERT INTO self_assessment_reports (company_id, submissions_fingerprint, mappings, narrative, narrative_fingerprint)
       VALUES ($1, 'x', '[]', $2, 'stale')`,
      [company.id, JSON.stringify({ garbage: true })]
    );

    const res = await request(app)
      .get(`/api/superadmin/companies/${company.id}/self-assessment`)
      .set("Authorization", `Bearer ${su.token}`);

    expect(res.status).toBe(200);
    expect(res.body.report.document).toContain("Cross-Department Consistency Checks");
    expect(res.body.report.document).toContain("Annexure G");
  });

  test("report endpoint is gated until every selected department has submitted", async () => {
    const su = await createSuperAdmin();
    const company = await createCompany({ name: "Gated Co" });
    const admin = await createUser(company.id, "ADMIN");
    await seedSubmission(company.id, admin.id, admin.email, "IT", { "it-15": "NO" });
    await seedSubmission(company.id, admin.id, admin.email, "HR", { "hr-1": "YES" });

    // Admin declares IT + Legal but only IT (+ mandatory HR) has answered.
    await request(app)
      .post("/api/self-assessment/complete")
      .set("Authorization", `Bearer ${admin.token}`)
      .send({ departments: ["IT", "Legal"] });

    const blocked = await request(app)
      .get(`/api/superadmin/companies/${company.id}/self-assessment`)
      .set("Authorization", `Bearer ${su.token}`);
    expect(blocked.status).toBe(409);
    expect(blocked.body.status).toBe("incomplete");
    expect(blocked.body.departmentStatus.missing).toEqual(["Legal"]);

    // The submissions endpoint names the exact pending department (+ any assignee).
    await query(
      `INSERT INTO invitations (email, company_id, role, token, expires_at, department)
       VALUES ('legal@gated.co', $1, 'CONTRIBUTOR', 'inv-tok-1', NOW() + INTERVAL '7 days', 'Legal')`,
      [company.id]
    );
    const subs = await request(app)
      .get(`/api/superadmin/companies/${company.id}/self-assessment/submissions`)
      .set("Authorization", `Bearer ${su.token}`);
    expect(subs.body.pendingDepartments).toEqual([
      { department: "Legal", assignees: [expect.objectContaining({ email: "legal@gated.co", acceptedAt: null })] },
    ]);

    // Legal finally answers → report unlocks.
    await seedSubmission(company.id, null, "legal@gated.co", "Legal", { "legal-1": "YES" });
    const ok = await request(app)
      .get(`/api/superadmin/companies/${company.id}/self-assessment`)
      .set("Authorization", `Bearer ${su.token}`);
    expect(ok.status).toBe(200);
    expect(ok.body.report?.document).toContain("Gated Co");
  });

  test("submissions endpoint resolves question text and rejects non-superadmins", async () => {
    const su = await createSuperAdmin();
    const company = await createCompany();
    const admin = await createUser(company.id, "ADMIN", { email: "resp@co.io", fullName: "Reg User" });
    await seedSubmission(company.id, admin.id, admin.email, "IT", { "it-1": "YES", "it-15": "NO" });

    const forbidden = await request(app)
      .get(`/api/superadmin/companies/${company.id}/self-assessment/submissions`)
      .set("Authorization", `Bearer ${admin.token}`);
    expect(forbidden.status).toBe(403);

    const res = await request(app)
      .get(`/api/superadmin/companies/${company.id}/self-assessment/submissions`)
      .set("Authorization", `Bearer ${su.token}`);

    expect(res.status).toBe(200);
    expect(res.body.respondentCount).toBe(1);
    const it = res.body.submissions.find((s) => s.department === "IT");
    expect(it.userName).toBe("Reg User");
    const q15 = it.items.find((i) => i.id === "it-15");
    expect(q15.text.length).toBeGreaterThan(0);
    expect(q15.answerLabel).toBe("No");
  });
});
