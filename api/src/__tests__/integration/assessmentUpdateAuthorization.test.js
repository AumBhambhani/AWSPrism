import { describe, test, expect } from "vitest";
import request from "supertest";
import app from "../../app.js";
import { query } from "../../db/index.js";
import { createCompany, createUser } from "../setup/helpers.js";

/**
 * F-07 regression suite — PUT /api/assessments/:id field-level authorization.
 *
 * The route's role gate (requireRole(["ADMIN","LEAD","CONTRIBUTOR","AUDITOR"])) only
 * decides who may hit the endpoint at all; it does not restrict what a permitted
 * role can then write. The handler now enforces field-level authorization on top
 * of that gate (see routes/assessments.js PUT /:id), matching the only three real
 * callers of this endpoint: Review.jsx (ADMIN/LEAD approve-reject), Dashboard.jsx
 * (AUDITOR approve/reject), and QuestionCard.jsx (CONTRIBUTOR unlock-for-edit).
 *
 * The first block below are the originally-confirmed attack paths — they were RED
 * against the pre-fix handler and must stay GREEN now. The second block adds
 * positive coverage for the legitimate workflows plus bypass-combination checks
 * (an allowed field alongside a forbidden one must not let the forbidden one
 * through, and identity fields must never come from the body even for a role that
 * is otherwise authorized to act).
 */

async function seedAssessment(companyId, overrides = {}) {
  const result = await query(
    `INSERT INTO assessments
       (assessment_id, month, module_id, quest_id, company_id, control_area, answer,
        current_level, review_status, score_eligible, submitted_by, reviewed_by, audited_by)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)
     RETURNING *`,
    [
      overrides.assessmentId || "seed-1",
      overrides.month || "2026-09",
      overrides.moduleId || "M1",
      overrides.questId || "ISO-A5.1",
      companyId,
      overrides.controlArea || "Policies for information security",
      overrides.answer || "PARTIALLY_IMPLEMENTED",
      overrides.currentLevel ?? 2,
      overrides.reviewStatus || "Submitted",
      overrides.scoreEligible ?? false,
      overrides.submittedBy || "contributor@testcorp.com",
      overrides.reviewedBy ?? null,
      overrides.auditedBy ?? null,
    ]
  );
  return result.rows[0];
}

async function fetchAssessment(id) {
  const result = await query("SELECT * FROM assessments WHERE id = $1", [id]);
  return result.rows[0];
}

describe("F-07: assessment update field-level authorization", () => {
  test("CONTRIBUTOR cannot approve an assessment (self-approval via reviewStatus=FINISHED)", async () => {
    const company = await createCompany({ domain: `f07-a-${Date.now()}.com` });
    const contributor = await createUser(company.id, "CONTRIBUTOR", {
      email: `contrib-${Date.now()}@testcorp.com`,
    });
    const seeded = await seedAssessment(company.id, { submittedBy: contributor.email });

    await request(app)
      .put(`/api/assessments/${seeded.id}`)
      .set("Authorization", `Bearer ${contributor.token}`)
      .send({ reviewStatus: "FINISHED" });

    const row = await fetchAssessment(seeded.id);

    // A CONTRIBUTOR must not be able to move their own submission straight to
    // FINISHED (self-approval).
    expect(row.review_status).not.toBe("FINISHED");
  });

  test("CONTRIBUTOR cannot forge reviewedBy to an arbitrary identity", async () => {
    const company = await createCompany({ domain: `f07-b-${Date.now()}.com` });
    const contributor = await createUser(company.id, "CONTRIBUTOR", {
      email: `contrib-${Date.now()}@testcorp.com`,
    });
    const seeded = await seedAssessment(company.id, { submittedBy: contributor.email });

    await request(app)
      .put(`/api/assessments/${seeded.id}`)
      .set("Authorization", `Bearer ${contributor.token}`)
      .send({ reviewedBy: "impersonated-lead@evil.example", reviewStatus: "FINISHED" });

    const row = await fetchAssessment(seeded.id);

    // reviewedBy must never be settable to an identity other than the
    // authenticated actor performing a genuine review action, and never by a
    // CONTRIBUTOR at all.
    expect(row.reviewed_by).not.toBe("impersonated-lead@evil.example");
  });

  test("CONTRIBUTOR cannot forge auditedBy to an arbitrary identity", async () => {
    const company = await createCompany({ domain: `f07-c-${Date.now()}.com` });
    const contributor = await createUser(company.id, "CONTRIBUTOR", {
      email: `contrib-${Date.now()}@testcorp.com`,
    });
    const seeded = await seedAssessment(company.id, { submittedBy: contributor.email });

    await request(app)
      .put(`/api/assessments/${seeded.id}`)
      .set("Authorization", `Bearer ${contributor.token}`)
      .send({ auditedBy: "impersonated-auditor@evil.example", reviewStatus: "AUDITED" });

    const row = await fetchAssessment(seeded.id);

    expect(row.audited_by).not.toBe("impersonated-auditor@evil.example");
  });

  test("CONTRIBUTOR cannot manipulate scoreEligible", async () => {
    const company = await createCompany({ domain: `f07-d-${Date.now()}.com` });
    const contributor = await createUser(company.id, "CONTRIBUTOR", {
      email: `contrib-${Date.now()}@testcorp.com`,
    });
    const seeded = await seedAssessment(company.id, {
      submittedBy: contributor.email,
      scoreEligible: false,
    });

    await request(app)
      .put(`/api/assessments/${seeded.id}`)
      .set("Authorization", `Bearer ${contributor.token}`)
      .send({ scoreEligible: true });

    const row = await fetchAssessment(seeded.id);

    // score_eligible feeds the dashboard's compliance-score calculation
    // (routes/dashboard.js) directly from this column; a CONTRIBUTOR must not
    // be able to flip it.
    expect(row.score_eligible).not.toBe(true);
  });

  test("AUDITOR cannot modify the control's answer/current_level (owner-controlled fields)", async () => {
    const company = await createCompany({ domain: `f07-e-${Date.now()}.com` });
    const auditor = await createUser(company.id, "AUDITOR", {
      email: `auditor-${Date.now()}@testcorp.com`,
    });
    await query(
      `INSERT INTO auditor_profiles (user_id, company_id, expiry_date, active)
       VALUES ($1, $2, CURRENT_DATE + INTERVAL '30 days', TRUE)`,
      [auditor.id, company.id]
    );
    const seeded = await seedAssessment(company.id, {
      answer: "PARTIALLY_IMPLEMENTED",
      currentLevel: 2,
    });

    await request(app)
      .put(`/api/assessments/${seeded.id}`)
      .set("Authorization", `Bearer ${auditor.token}`)
      .send({ answer: "IMPLEMENTED", currentLevel: 5 });

    const row = await fetchAssessment(seeded.id);

    // An AUDITOR's role is to review/audit, not to rewrite the underlying
    // control-implementation evidence the contributor submitted.
    expect(row.answer).toBe("PARTIALLY_IMPLEMENTED");
    expect(row.current_level).toBe(2);
  });

  test("NOT VULNERABLE: authenticated user cannot update another tenant's assessment", async () => {
    const companyA = await createCompany({ domain: `f07-tenant-a-${Date.now()}.com` });
    const companyB = await createCompany({ domain: `f07-tenant-b-${Date.now()}.com` });
    const adminB = await createUser(companyB.id, "ADMIN", {
      email: `admin-b-${Date.now()}@testcorp.com`,
    });
    const seededInA = await seedAssessment(companyA.id);

    // scoreEligible is deliberately omitted here: it is not a legitimate PUT field
    // for any role (see the "unsupported field" tests below) and would be rejected
    // by field-level validation before ever reaching the tenant-scope check this
    // test targets. reviewStatus=FINISHED alone is exactly what a legitimate ADMIN
    // approve action sends, isolating the tenant-boundary assertion from that concern.
    const res = await request(app)
      .put(`/api/assessments/${seededInA.id}`)
      .set("Authorization", `Bearer ${adminB.token}`)
      .send({ reviewStatus: "FINISHED" });

    const row = await fetchAssessment(seededInA.id);

    expect(res.status).toBe(404);
    expect(row.review_status).toBe("Submitted");
  });
});

describe("F-07: legitimate workflows remain functional", () => {
  test("CONTRIBUTOR can still unlock their own submission back to WIP for editing", async () => {
    const company = await createCompany({ domain: `f07-pos-a-${Date.now()}.com` });
    const contributor = await createUser(company.id, "CONTRIBUTOR", {
      email: `contrib-${Date.now()}@testcorp.com`,
    });
    const seeded = await seedAssessment(company.id, {
      submittedBy: contributor.email,
      reviewStatus: "FINISHED",
    });

    const res = await request(app)
      .put(`/api/assessments/${seeded.id}`)
      .set("Authorization", `Bearer ${contributor.token}`)
      .send({ reviewStatus: "WIP" });

    const row = await fetchAssessment(seeded.id);
    expect(res.status).toBe(200);
    expect(row.review_status).toBe("WIP");
  });

  test("ADMIN/LEAD can approve a submitted assessment, with reviewedBy derived from the session", async () => {
    const company = await createCompany({ domain: `f07-pos-b-${Date.now()}.com` });
    const lead = await createUser(company.id, "LEAD", {
      email: `lead-${Date.now()}@testcorp.com`,
    });
    const seeded = await seedAssessment(company.id);

    const res = await request(app)
      .put(`/api/assessments/${seeded.id}`)
      .set("Authorization", `Bearer ${lead.token}`)
      // Mirrors Review.jsx's real payload, which already sends reviewedBy: user.email.
      .send({ reviewStatus: "FINISHED", reviewedBy: lead.email, reviewerNotes: "Looks good" });

    const row = await fetchAssessment(seeded.id);
    expect(res.status).toBe(200);
    expect(row.review_status).toBe("FINISHED");
    expect(row.reviewed_by).toBe(lead.email);
    expect(row.reviewer_notes).toBe("Looks good");
    expect(row.reviewed_at).not.toBeNull();
  });

  test("ADMIN/LEAD can reject a submitted assessment back to WIP with reviewer notes", async () => {
    const company = await createCompany({ domain: `f07-pos-c-${Date.now()}.com` });
    const admin = await createUser(company.id, "ADMIN", {
      email: `admin-${Date.now()}@testcorp.com`,
    });
    const seeded = await seedAssessment(company.id);

    const res = await request(app)
      .put(`/api/assessments/${seeded.id}`)
      .set("Authorization", `Bearer ${admin.token}`)
      .send({ reviewStatus: "WIP", reviewedBy: admin.email, reviewerNotes: "Please add evidence" });

    const row = await fetchAssessment(seeded.id);
    expect(res.status).toBe(200);
    expect(row.review_status).toBe("WIP");
    expect(row.reviewed_by).toBe(admin.email);
    expect(row.reviewer_notes).toBe("Please add evidence");
  });

  test("AUDITOR can reject a FINISHED control, with auditedBy derived from the session", async () => {
    const company = await createCompany({ domain: `f07-pos-d-${Date.now()}.com` });
    const auditor = await createUser(company.id, "AUDITOR", {
      email: `auditor-${Date.now()}@testcorp.com`,
    });
    await query(
      `INSERT INTO auditor_profiles (user_id, company_id, expiry_date, active)
       VALUES ($1, $2, CURRENT_DATE + INTERVAL '30 days', TRUE)`,
      [auditor.id, company.id]
    );
    const seeded = await seedAssessment(company.id, { reviewStatus: "FINISHED" });

    const res = await request(app)
      .put(`/api/assessments/${seeded.id}`)
      .set("Authorization", `Bearer ${auditor.token}`)
      // Mirrors the audit queue's real payload: auditedBy: user.email + auditorNotes.
      .send({ reviewStatus: "WIP", auditedBy: auditor.email, auditorNotes: "Evidence insufficient" });

    const row = await fetchAssessment(seeded.id);
    expect(res.status).toBe(200);
    expect(row.review_status).toBe("WIP");
    expect(row.audited_by).toBe(auditor.email);
    expect(row.auditor_notes).toBe("Evidence insufficient");
    expect(row.audited_at).not.toBeNull();
  });

  test("AUDITOR signs a FINISHED control off to AUDITED", async () => {
    const company = await createCompany({ domain: `f07-pos-d2-${Date.now()}.com` });
    const auditor = await createUser(company.id, "AUDITOR", {
      email: `auditor-${Date.now()}@testcorp.com`,
    });
    await query(
      `INSERT INTO auditor_profiles (user_id, company_id, expiry_date, active)
       VALUES ($1, $2, CURRENT_DATE + INTERVAL '30 days', TRUE)`,
      [auditor.id, company.id]
    );
    const seeded = await seedAssessment(company.id, { reviewStatus: "FINISHED" });

    const res = await request(app)
      .put(`/api/assessments/${seeded.id}`)
      .set("Authorization", `Bearer ${auditor.token}`)
      .send({ reviewStatus: "AUDITED", auditedBy: auditor.email, auditorNotes: "Sampled 5 tickets, all pass" });

    const row = await fetchAssessment(seeded.id);
    expect(res.status).toBe(200);
    expect(row.review_status).toBe("AUDITED");
    expect(row.audited_by).toBe(auditor.email);
    expect(row.audited_at).not.toBeNull();
  });

  test("AUDITOR may not set FINISHED, and a reviewer re-approval clears a prior audit sign-off", async () => {
    const company = await createCompany({ domain: `f07-pos-d3-${Date.now()}.com` });
    const auditor = await createUser(company.id, "AUDITOR", {
      email: `auditor-${Date.now()}@testcorp.com`,
    });
    await query(
      `INSERT INTO auditor_profiles (user_id, company_id, expiry_date, active)
       VALUES ($1, $2, CURRENT_DATE + INTERVAL '30 days', TRUE)`,
      [auditor.id, company.id]
    );
    const lead = await createUser(company.id, "LEAD", { email: `lead-${Date.now()}@testcorp.com` });
    const seeded = await seedAssessment(company.id, { reviewStatus: "FINISHED", auditedBy: auditor.email });
    await query("UPDATE assessments SET audited_at = NOW(), auditor_notes = 'ok' WHERE id = $1", [seeded.id]);

    const bad = await request(app)
      .put(`/api/assessments/${seeded.id}`)
      .set("Authorization", `Bearer ${auditor.token}`)
      .send({ reviewStatus: "FINISHED" });
    expect(bad.status).toBe(403);

    // A reviewer re-approving (or rejecting) invalidates the earlier audit.
    const res = await request(app)
      .put(`/api/assessments/${seeded.id}`)
      .set("Authorization", `Bearer ${lead.token}`)
      .send({ reviewStatus: "FINISHED", reviewedBy: lead.email });

    const row = await fetchAssessment(seeded.id);
    expect(res.status).toBe(200);
    expect(row.review_status).toBe("FINISHED");
    expect(row.audited_by).toBeNull();
    expect(row.audited_at).toBeNull();
    expect(row.auditor_notes).toBeNull();
  });

  test("REVIEWER cannot reach the update handler at all", async () => {
    const company = await createCompany({ domain: `f07-pos-e-${Date.now()}.com` });
    const reviewer = await createUser(company.id, "REVIEWER", {
      email: `reviewer-${Date.now()}@testcorp.com`,
    });
    const seeded = await seedAssessment(company.id);

    const res = await request(app)
      .put(`/api/assessments/${seeded.id}`)
      .set("Authorization", `Bearer ${reviewer.token}`)
      .send({ reviewStatus: "WIP" });

    expect(res.status).toBe(403);
  });
});

describe("F-07: bypass-combination checks (allowed field must not smuggle a forbidden one)", () => {
  test("CONTRIBUTOR: allowed reviewStatus=WIP + scoreEligible is rejected outright, nothing applied", async () => {
    const company = await createCompany({ domain: `f07-bp-a-${Date.now()}.com` });
    const contributor = await createUser(company.id, "CONTRIBUTOR", {
      email: `contrib-${Date.now()}@testcorp.com`,
    });
    const seeded = await seedAssessment(company.id, {
      submittedBy: contributor.email,
      reviewStatus: "FINISHED",
      scoreEligible: false,
    });

    const res = await request(app)
      .put(`/api/assessments/${seeded.id}`)
      .set("Authorization", `Bearer ${contributor.token}`)
      .send({ reviewStatus: "WIP", scoreEligible: true });

    const row = await fetchAssessment(seeded.id);
    expect(res.status).toBe(400);
    expect(row.review_status).toBe("FINISHED"); // unchanged — whole request rejected
    expect(row.score_eligible).toBe(false);
  });

  test("CONTRIBUTOR: allowed reviewStatus=WIP + forged reviewedBy does not set reviewed_by", async () => {
    const company = await createCompany({ domain: `f07-bp-b-${Date.now()}.com` });
    const contributor = await createUser(company.id, "CONTRIBUTOR", {
      email: `contrib-${Date.now()}@testcorp.com`,
    });
    const seeded = await seedAssessment(company.id, { submittedBy: contributor.email });

    const res = await request(app)
      .put(`/api/assessments/${seeded.id}`)
      .set("Authorization", `Bearer ${contributor.token}`)
      .send({ reviewStatus: "WIP", reviewedBy: "impersonated-lead@evil.example" });

    const row = await fetchAssessment(seeded.id);
    // reviewStatus=WIP is legitimate for CONTRIBUTOR, so the request succeeds —
    // but reviewedBy is only ever derived for ADMIN/LEAD performing a review.
    expect(res.status).toBe(200);
    expect(row.reviewed_by).not.toBe("impersonated-lead@evil.example");
    expect(row.reviewed_by).toBeNull();
  });

  test("AUDITOR: legitimate auditorNotes + forbidden answer field is rejected outright", async () => {
    const company = await createCompany({ domain: `f07-bp-c-${Date.now()}.com` });
    const auditor = await createUser(company.id, "AUDITOR", {
      email: `auditor-${Date.now()}@testcorp.com`,
    });
    await query(
      `INSERT INTO auditor_profiles (user_id, company_id, expiry_date, active)
       VALUES ($1, $2, CURRENT_DATE + INTERVAL '30 days', TRUE)`,
      [auditor.id, company.id]
    );
    const seeded = await seedAssessment(company.id, { answer: "PARTIALLY_IMPLEMENTED", reviewStatus: "FINISHED" });

    const res = await request(app)
      .put(`/api/assessments/${seeded.id}`)
      .set("Authorization", `Bearer ${auditor.token}`)
      .send({ reviewStatus: "AUDITED", auditorNotes: "ok", answer: "IMPLEMENTED" });

    const row = await fetchAssessment(seeded.id);
    expect(res.status).toBe(400);
    expect(row.review_status).toBe("FINISHED"); // unchanged — whole request rejected
    expect(row.answer).toBe("PARTIALLY_IMPLEMENTED");
  });

  test("AUDITOR cannot set reviewerNotes, and ADMIN/LEAD cannot set auditorNotes", async () => {
    const company = await createCompany({ domain: `f07-bp-d-${Date.now()}.com` });
    const auditor = await createUser(company.id, "AUDITOR", {
      email: `auditor-${Date.now()}@testcorp.com`,
    });
    await query(
      `INSERT INTO auditor_profiles (user_id, company_id, expiry_date, active)
       VALUES ($1, $2, CURRENT_DATE + INTERVAL '30 days', TRUE)`,
      [auditor.id, company.id]
    );
    const admin = await createUser(company.id, "ADMIN", {
      email: `admin-${Date.now()}@testcorp.com`,
    });
    const seededA = await seedAssessment(company.id, { assessmentId: "seed-a", reviewStatus: "FINISHED" });
    const seededB = await seedAssessment(company.id, { assessmentId: "seed-b" });

    // AUDITED is a legitimate status for an auditor — so this isolates the
    // "auditors may not write reviewerNotes" rule.
    const auditorRes = await request(app)
      .put(`/api/assessments/${seededA.id}`)
      .set("Authorization", `Bearer ${auditor.token}`)
      .send({ reviewStatus: "AUDITED", reviewerNotes: "should not be allowed" });

    const adminRes = await request(app)
      .put(`/api/assessments/${seededB.id}`)
      .set("Authorization", `Bearer ${admin.token}`)
      .send({ reviewStatus: "FINISHED", auditorNotes: "should not be allowed" });

    const rowA = await fetchAssessment(seededA.id);
    const rowB = await fetchAssessment(seededB.id);

    expect(auditorRes.status).toBe(403);
    expect(rowA.review_status).toBe("FINISHED");
    expect(rowA.reviewer_notes).toBeNull();

    expect(adminRes.status).toBe(403);
    expect(rowB.review_status).toBe("Submitted");
    expect(rowB.auditor_notes).toBeNull();
  });

  test("forged actor identity alongside a legitimate review action is overridden by the session identity", async () => {
    const company = await createCompany({ domain: `f07-bp-e-${Date.now()}.com` });
    const admin = await createUser(company.id, "ADMIN", {
      email: `admin-${Date.now()}@testcorp.com`,
    });
    const seeded = await seedAssessment(company.id);

    const res = await request(app)
      .put(`/api/assessments/${seeded.id}`)
      .set("Authorization", `Bearer ${admin.token}`)
      .send({ reviewStatus: "FINISHED", reviewedBy: "someone-else-entirely@evil.example" });

    const row = await fetchAssessment(seeded.id);
    expect(res.status).toBe(200);
    expect(row.review_status).toBe("FINISHED");
    expect(row.reviewed_by).toBe(admin.email);
    expect(row.reviewed_by).not.toBe("someone-else-entirely@evil.example");
  });
});
