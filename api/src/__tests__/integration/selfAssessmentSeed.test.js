import { describe, test, expect } from "vitest";
import request from "supertest";
import app from "../../app.js";
import { query } from "../../db/index.js";
import { createCompany, createUser, createSuperAdmin } from "../setup/helpers.js";

/** Insert a framework question + its qfc mapping for a company. */
async function addFrameworkQuestion(companyId, { questId, moduleId = "M1", controlArea, baseline, framework, ref }) {
  await query(
    `INSERT INTO modules (module_id, company_id, name) VALUES ($1, $2, $3)
     ON CONFLICT (company_id, module_id) DO NOTHING`,
    [moduleId, companyId, moduleId]
  );
  await query(
    `INSERT INTO questions (quest_id, company_id, module_id, module_name, control_area, iso_reference, baseline_question)
     VALUES ($1, $2, $3, $3, $4, $5, $6)
     ON CONFLICT (company_id, quest_id) DO NOTHING`,
    [questId, companyId, moduleId, controlArea, ref, baseline]
  );
  await query(
    `INSERT INTO company_frameworks (company_id, framework_key) VALUES ($1, $2) ON CONFLICT DO NOTHING`,
    [companyId, framework]
  );
  await query(
    `INSERT INTO question_framework_controls (company_id, quest_id, framework_key, control_reference)
     VALUES ($1, $2, $3, $4) ON CONFLICT ON CONSTRAINT qfc_uniq_nnd DO NOTHING`,
    [companyId, questId, framework, ref]
  );
}

const MONTH = (() => {
  const d = new Date();
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
})();

describe("self-assessment → tracker pre-fill", () => {
  test("approval seeds WIP draft assessments from self-assessment answers", async () => {
    const company = await createCompany({ domain: `sa-seed-${Date.now()}.com`, status: "pending" });
    await query("UPDATE companies SET status = 'pending', is_verified = FALSE WHERE id = $1", [company.id]);
    const su = await createSuperAdmin();

    await addFrameworkQuestion(company.id, {
      questId: "ISO-A8.5", controlArea: "Secure authentication",
      baseline: "Is MFA enforced for all users?", framework: "ISO27001", ref: "A.8.5",
    });
    await addFrameworkQuestion(company.id, {
      questId: "ISO-A5.34", controlArea: "Privacy and protection of PII",
      baseline: "Is consent captured and recorded?", framework: "ISO27001", ref: "A.5.34",
    });

    // Someone already assessed ISO-A5.34 this month — seeding must not touch it.
    await query(
      `INSERT INTO assessments (assessment_id, month, quest_id, company_id, answer, review_status, submitted_by)
       VALUES ('human-1', $1, 'ISO-A5.34', $2, 'IMPLEMENTED', 'FINISHED', 'alice@x.com')`,
      [MONTH, company.id]
    );

    await query(
      `INSERT INTO self_assessment_submissions (company_id, user_email, department, answers)
       VALUES ($1, 'it@x.com', 'IT', $2), ($1, 'legal@x.com', 'Legal', $3)`,
      [company.id, JSON.stringify({ "it-15": "YES", "it-8": "YES" }), JSON.stringify({ "lg-3": "NO" })]
    );

    const res = await request(app)
      .patch(`/api/superadmin/companies/${company.id}/status`)
      .set("Authorization", `Bearer ${su.token}`)
      .send({ status: "approved" });

    expect(res.status).toBe(200);
    expect(res.body.selfAssessmentSeeded).toBeGreaterThanOrEqual(1);

    const rows = await query(
      `SELECT quest_id, answer, review_status, submitted_by, comments
       FROM assessments WHERE company_id = $1 AND assessment_id LIKE 'selfassess-%' ORDER BY quest_id`,
      [company.id]
    );

    // ISO-A8.5 seeded from it-15=YES → PARTIALLY_IMPLEMENTED / WIP
    const auth = rows.rows.find(r => r.quest_id === "ISO-A8.5");
    expect(auth).toBeTruthy();
    expect(auth.answer).toBe("PARTIALLY_IMPLEMENTED");
    expect(auth.review_status).toBe("WIP");
    expect(auth.submitted_by).toBe("self-assessment");
    expect(auth.comments).toMatch(/self-assessment/i);

    // ISO-A5.34 already had a human assessment for this month → not re-seeded
    expect(rows.rows.some(r => r.quest_id === "ISO-A5.34")).toBe(false);

    // The human row is untouched
    const human = await query("SELECT answer FROM assessments WHERE assessment_id = 'human-1'", []);
    expect(human.rows[0].answer).toBe("IMPLEMENTED");

    // companies.self_assessment_seeded_at stamped
    const co = await query("SELECT self_assessment_seeded_at FROM companies WHERE id = $1", [company.id]);
    expect(co.rows[0].self_assessment_seeded_at).toBeTruthy();
  });

  test("manual re-run endpoint is idempotent", async () => {
    const company = await createCompany({ domain: `sa-manual-${Date.now()}.com` });
    const su = await createSuperAdmin();

    await addFrameworkQuestion(company.id, {
      questId: "ISO-A8.13", controlArea: "Information backup",
      baseline: "Are backups tested?", framework: "ISO27001", ref: "A.8.13",
    });
    await query(
      `INSERT INTO self_assessment_submissions (company_id, user_email, department, answers)
       VALUES ($1, 'it@y.com', 'IT', $2)`,
      [company.id, JSON.stringify({ "it-31": "PARTIAL" })]
    );

    const first = await request(app)
      .patch(`/api/superadmin/companies/${company.id}/seed-self-assessment`)
      .set("Authorization", `Bearer ${su.token}`);
    expect(first.status).toBe(200);
    expect(first.body.seeded).toBe(1);

    const second = await request(app)
      .patch(`/api/superadmin/companies/${company.id}/seed-self-assessment`)
      .set("Authorization", `Bearer ${su.token}`);
    expect(second.status).toBe(200);
    expect(second.body.seeded).toBe(0); // already seeded this month

    const count = await query(
      "SELECT COUNT(*)::int AS n FROM assessments WHERE company_id = $1 AND quest_id = 'ISO-A8.13'",
      [company.id]
    );
    expect(count.rows[0].n).toBe(1);
  });

  test("dept-scope seeding maps onto dept-<slug>-qNN questions on onboarding", async () => {
    const company = await createCompany({ domain: `sa-dept-${Date.now()}.com` });
    const admin = await createUser(company.id, "ADMIN");

    await query(
      `INSERT INTO self_assessment_submissions (company_id, user_email, department, answers)
       VALUES ($1, $2, 'HR', $3)`,
      [company.id, admin.email, JSON.stringify({ "hr-3": "NO", "hr-4": "PARTIAL" })]
    );

    const res = await request(app)
      .post("/api/auth/complete-onboarding")
      .set("Authorization", `Bearer ${admin.token}`)
      .send({ departments: ["HR"] });
    expect(res.status).toBe(200);

    const seeded = await query(
      `SELECT a.quest_id, a.answer, a.review_status, q.control_area
       FROM assessments a JOIN questions q ON q.quest_id = a.quest_id AND q.company_id = a.company_id
       WHERE a.company_id = $1 AND a.assessment_id LIKE 'selfassess-%'`,
      [company.id]
    );
    expect(seeded.rows.length).toBeGreaterThanOrEqual(1);
    for (const r of seeded.rows) {
      expect(r.quest_id).toMatch(/^dept-hr-/);
      expect(r.review_status).toBe("WIP");
      expect(["PARTIALLY_IMPLEMENTED", "NOT_IMPLEMENTED"]).toContain(r.answer);
    }
    // hr-3 = NO (retention → "Data Retention") should be a NOT_IMPLEMENTED row
    expect(seeded.rows.some(r => r.answer === "NOT_IMPLEMENTED" && /retention/i.test(r.control_area))).toBe(true);
  });
});
