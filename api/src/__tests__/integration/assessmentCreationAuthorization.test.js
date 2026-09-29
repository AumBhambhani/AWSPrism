import { describe, test, expect } from "vitest";
import request from "supertest";
import app from "../../app.js";
import { query } from "../../db/index.js";
import { createCompany, createUser } from "../setup/helpers.js";

/**
 * F-07 (creation path) — POST /api/assessments field-level authorization.
 *
 * The PUT /:id fix closed the review/audit-workflow endpoint, but POST / — the
 * assessment *creation* endpoint, also reachable by CONTRIBUTOR — accepted
 * reviewStatus, scoreEligible, reviewedBy, and auditedBy directly from the request
 * body with no restriction at all, reproducing the same four attacks via a sibling
 * route on the same resource (confirmed in the F-07 independent closure review).
 *
 * Legitimate creation behavior (traced from web/src/pages/Tracker.jsx, the only
 * caller of this endpoint) is:
 *  - saveAndContinue (draft): always { reviewStatus: "WIP", scoreEligible: false }.
 *  - submitReview: { reviewStatus: isImplemented ? "Submitted" : "FINISHED",
 *      scoreEligible: isImplemented && maturity >= 3 && hasEvidence }.
 *    i.e. an IMPLEMENTED/YES answer always goes to "Submitted" (queued for
 *    reviewer approval) and never self-finalizes; a non-compliant answer is
 *    auto-"FINISHED" because there's nothing for a reviewer to verify.
 *  - reviewedBy/auditedBy are never sent at creation by any caller — a
 *    just-created row cannot already have been reviewed or audited.
 *  - Both ADMIN and LEAD use the exact same Tracker.jsx code path when they
 *    personally record an assessment, so these rules apply uniformly to every
 *    role, not just CONTRIBUTOR.
 */

async function addQuestion(companyId, questId, overrides = {}) {
  await query(
    `INSERT INTO modules (module_id, company_id, name) VALUES ($1, $2, $1)
     ON CONFLICT (company_id, module_id) DO NOTHING`,
    [overrides.moduleId || "M1", companyId]
  );
  await query(
    `INSERT INTO questions (quest_id, company_id, module_id, module_name, control_area, baseline_question)
     VALUES ($1, $2, $3, $3, $4, $5) ON CONFLICT (company_id, quest_id) DO NOTHING`,
    [questId, companyId, overrides.moduleId || "M1", overrides.controlArea || "Test control", overrides.baseline || "Is it done?"]
  );
}

async function assessmentsFor(companyId, questId) {
  const result = await query(
    "SELECT * FROM assessments WHERE company_id = $1 AND quest_id = $2 ORDER BY id",
    [companyId, questId]
  );
  return result.rows;
}

describe("F-07 (creation path): POST /api/assessments field-level authorization", () => {
  test("CONTRIBUTOR cannot create a FINISHED assessment for an IMPLEMENTED/YES answer (self-approval)", async () => {
    const company = await createCompany({ domain: `f07c-a-${Date.now()}.com` });
    const contributor = await createUser(company.id, "CONTRIBUTOR", { email: `contrib-${Date.now()}@testcorp.com` });
    await addQuestion(company.id, "Q-A");

    const res = await request(app)
      .post("/api/assessments")
      .set("Authorization", `Bearer ${contributor.token}`)
      .send({
        questId: "Q-A", moduleId: "M1", month: "2026-09",
        answer: "IMPLEMENTED", currentLevel: 5, evidenceLink: "https://example.com/evidence.pdf",
        reviewStatus: "FINISHED",
      });

    expect(res.status).toBe(400);
    const rows = await assessmentsFor(company.id, "Q-A");
    expect(rows.length).toBe(0); // rejected atomically — nothing persisted
  });

  test("CONTRIBUTOR cannot create an AUDITED assessment", async () => {
    const company = await createCompany({ domain: `f07c-b-${Date.now()}.com` });
    const contributor = await createUser(company.id, "CONTRIBUTOR", { email: `contrib-${Date.now()}@testcorp.com` });
    await addQuestion(company.id, "Q-B");

    const res = await request(app)
      .post("/api/assessments")
      .set("Authorization", `Bearer ${contributor.token}`)
      .send({ questId: "Q-B", moduleId: "M1", month: "2026-09", answer: "WIP", reviewStatus: "AUDITED" });

    expect(res.status).toBe(400);
    const rows = await assessmentsFor(company.id, "Q-B");
    expect(rows.length).toBe(0);
  });

  test("CONTRIBUTOR cannot forge reviewedBy at creation", async () => {
    const company = await createCompany({ domain: `f07c-c-${Date.now()}.com` });
    const contributor = await createUser(company.id, "CONTRIBUTOR", { email: `contrib-${Date.now()}@testcorp.com` });
    await addQuestion(company.id, "Q-C");

    const res = await request(app)
      .post("/api/assessments")
      .set("Authorization", `Bearer ${contributor.token}`)
      .send({
        questId: "Q-C", moduleId: "M1", month: "2026-09",
        answer: "WIP", reviewStatus: "WIP", scoreEligible: false,
        reviewedBy: "forged-lead@evil.example",
      });

    expect(res.status).toBe(201);
    const rows = await assessmentsFor(company.id, "Q-C");
    expect(rows.length).toBe(1);
    expect(rows[0].reviewed_by).toBeNull();
  });

  test("CONTRIBUTOR cannot forge auditedBy at creation", async () => {
    const company = await createCompany({ domain: `f07c-d-${Date.now()}.com` });
    const contributor = await createUser(company.id, "CONTRIBUTOR", { email: `contrib-${Date.now()}@testcorp.com` });
    await addQuestion(company.id, "Q-D");

    const res = await request(app)
      .post("/api/assessments")
      .set("Authorization", `Bearer ${contributor.token}`)
      .send({
        questId: "Q-D", moduleId: "M1", month: "2026-09",
        answer: "WIP", reviewStatus: "WIP", scoreEligible: false,
        auditedBy: "forged-auditor@evil.example",
      });

    expect(res.status).toBe(201);
    const rows = await assessmentsFor(company.id, "Q-D");
    expect(rows.length).toBe(1);
    expect(rows[0].audited_by).toBeNull();
  });

  test("CONTRIBUTOR cannot manipulate scoreEligible for a non-compliant answer", async () => {
    const company = await createCompany({ domain: `f07c-e-${Date.now()}.com` });
    const contributor = await createUser(company.id, "CONTRIBUTOR", { email: `contrib-${Date.now()}@testcorp.com` });
    await addQuestion(company.id, "Q-E");

    const res = await request(app)
      .post("/api/assessments")
      .set("Authorization", `Bearer ${contributor.token}`)
      .send({
        questId: "Q-E", moduleId: "M1", month: "2026-09",
        answer: "NOT_IMPLEMENTED", scoreEligible: true, // forged — content doesn't claim compliance
        reviewStatus: "FINISHED", // legitimate for a NOT_IMPLEMENTED gap (matches submitReview)
        actionOwner: "owner@testcorp.com", actionDueDate: "2026-12-01", actionNotes: "gap notes",
      });

    expect(res.status).toBe(201);
    const rows = await assessmentsFor(company.id, "Q-E");
    expect(rows.length).toBe(1);
    // score_eligible feeds the dashboard's compliance-score calculation directly
    // (routes/dashboard.js); it must reflect the actual content, not a forged claim.
    expect(rows[0].score_eligible).toBe(false);
    expect(rows[0].review_status).toBe("FINISHED"); // legitimate auto-finish for a gap
  });

  test("CONTRIBUTOR cannot manipulate scoreEligible via a claimed-but-unmet maturity threshold", async () => {
    const company = await createCompany({ domain: `f07c-f-${Date.now()}.com` });
    const contributor = await createUser(company.id, "CONTRIBUTOR", { email: `contrib-${Date.now()}@testcorp.com` });
    await addQuestion(company.id, "Q-F");

    const res = await request(app)
      .post("/api/assessments")
      .set("Authorization", `Bearer ${contributor.token}`)
      .send({
        questId: "Q-F", moduleId: "M1", month: "2026-09",
        answer: "IMPLEMENTED", currentLevel: 1, // below the maturity >= 3 threshold
        evidenceLink: "https://example.com/evidence.pdf",
        reviewStatus: "Submitted", // legitimate for an IMPLEMENTED answer
        scoreEligible: true, // forged
      });

    expect(res.status).toBe(201);
    const rows = await assessmentsFor(company.id, "Q-F");
    expect(rows.length).toBe(1);
    expect(rows[0].score_eligible).toBe(false);
    expect(rows[0].review_status).toBe("Submitted"); // IMPLEMENTED always queues for review
  });

  test("companyId cannot be forged to create an assessment for another tenant", async () => {
    const companyA = await createCompany({ domain: `f07c-tenant-a-${Date.now()}.com` });
    const companyB = await createCompany({ domain: `f07c-tenant-b-${Date.now()}.com` });
    const contributorA = await createUser(companyA.id, "CONTRIBUTOR", { email: `contrib-${Date.now()}@testcorp.com` });
    await addQuestion(companyA.id, "Q-TEN");

    const res = await request(app)
      .post("/api/assessments")
      .set("Authorization", `Bearer ${contributorA.token}`)
      .send({ questId: "Q-TEN", moduleId: "M1", month: "2026-09", answer: "WIP", reviewStatus: "WIP", companyId: companyB.id });

    expect(res.status).toBe(201);
    expect(res.body.companyId).toBe(companyA.id);

    const inB = await assessmentsFor(companyB.id, "Q-TEN");
    expect(inB.length).toBe(0); // nothing leaked into the other tenant

    const inA = await assessmentsFor(companyA.id, "Q-TEN");
    expect(inA.length).toBe(1);
    expect(inA[0].company_id).toBe(companyA.id);
  });
});

describe("F-07 (creation path): combination bypass checks", () => {
  test("legitimate IMPLEMENTED content + reviewStatus=FINISHED is rejected atomically", async () => {
    const company = await createCompany({ domain: `f07c-bp-a-${Date.now()}.com` });
    const contributor = await createUser(company.id, "CONTRIBUTOR", { email: `contrib-${Date.now()}@testcorp.com` });
    await addQuestion(company.id, "Q-BPA");

    const res = await request(app)
      .post("/api/assessments")
      .set("Authorization", `Bearer ${contributor.token}`)
      .send({
        questId: "Q-BPA", moduleId: "M1", month: "2026-09",
        answer: "IMPLEMENTED", currentLevel: 5, evidenceLink: "https://example.com/evidence.pdf",
        comments: "legitimate comment", owner: "me@testcorp.com",
        reviewStatus: "FINISHED",
      });

    expect(res.status).toBe(400);
    expect((await assessmentsFor(company.id, "Q-BPA")).length).toBe(0);
  });

  test("legitimate IMPLEMENTED content + forged reviewedBy still succeeds as Submitted, identity ignored", async () => {
    const company = await createCompany({ domain: `f07c-bp-b-${Date.now()}.com` });
    const contributor = await createUser(company.id, "CONTRIBUTOR", { email: `contrib-${Date.now()}@testcorp.com` });
    await addQuestion(company.id, "Q-BPB");

    const res = await request(app)
      .post("/api/assessments")
      .set("Authorization", `Bearer ${contributor.token}`)
      .send({
        questId: "Q-BPB", moduleId: "M1", month: "2026-09",
        answer: "IMPLEMENTED", currentLevel: 5, evidenceLink: "https://example.com/evidence.pdf",
        reviewStatus: "Submitted", // exactly what Tracker.jsx's submitReview sends for IMPLEMENTED
        reviewedBy: "forged-lead@evil.example",
      });

    expect(res.status).toBe(201);
    const rows = await assessmentsFor(company.id, "Q-BPB");
    expect(rows[0].review_status).toBe("Submitted");
    expect(rows[0].reviewed_by).toBeNull();
  });

  test("legitimate IMPLEMENTED content + forged auditedBy still succeeds as Submitted, identity ignored", async () => {
    const company = await createCompany({ domain: `f07c-bp-c-${Date.now()}.com` });
    const contributor = await createUser(company.id, "CONTRIBUTOR", { email: `contrib-${Date.now()}@testcorp.com` });
    await addQuestion(company.id, "Q-BPC");

    const res = await request(app)
      .post("/api/assessments")
      .set("Authorization", `Bearer ${contributor.token}`)
      .send({
        questId: "Q-BPC", moduleId: "M1", month: "2026-09",
        answer: "IMPLEMENTED", currentLevel: 5, evidenceLink: "https://example.com/evidence.pdf",
        reviewStatus: "Submitted",
        auditedBy: "forged-auditor@evil.example",
      });

    expect(res.status).toBe(201);
    const rows = await assessmentsFor(company.id, "Q-BPC");
    expect(rows[0].review_status).toBe("Submitted");
    expect(rows[0].audited_by).toBeNull();
  });

  test("all four forged fields combined in one payload are rejected atomically", async () => {
    const company = await createCompany({ domain: `f07c-bp-d-${Date.now()}.com` });
    const contributor = await createUser(company.id, "CONTRIBUTOR", { email: `contrib-${Date.now()}@testcorp.com` });
    await addQuestion(company.id, "Q-BPD");

    const res = await request(app)
      .post("/api/assessments")
      .set("Authorization", `Bearer ${contributor.token}`)
      .send({
        questId: "Q-BPD", moduleId: "M1", month: "2026-09",
        answer: "IMPLEMENTED", currentLevel: 5, evidenceLink: "https://example.com/evidence.pdf",
        reviewStatus: "FINISHED",
        scoreEligible: true,
        reviewedBy: "forged-lead@evil.example",
        auditedBy: "forged-auditor@evil.example",
      });

    // The FINISHED+IMPLEMENTED combination alone is enough to reject the whole
    // request — proving one disallowed field can't be smuggled in alongside
    // otherwise-legitimate content, even when three other fields are also forged.
    expect(res.status).toBe(400);
    expect((await assessmentsFor(company.id, "Q-BPD")).length).toBe(0);
  });
});

describe("F-07 (creation path): legitimate workflows remain functional", () => {
  test("draft save (WIP) works for CONTRIBUTOR, matching Tracker.jsx's saveAndContinue", async () => {
    const company = await createCompany({ domain: `f07c-pos-a-${Date.now()}.com` });
    const contributor = await createUser(company.id, "CONTRIBUTOR", { email: `contrib-${Date.now()}@testcorp.com` });
    await addQuestion(company.id, "Q-POSA");

    const res = await request(app)
      .post("/api/assessments")
      .set("Authorization", `Bearer ${contributor.token}`)
      .send({
        questId: "Q-POSA", moduleId: "M1", month: "2026-09",
        answer: "IMPLEMENTED", currentLevel: 1, level3Plus: false,
        owner: "me@testcorp.com", reviewStatus: "WIP", scoreEligible: false, comments: "in progress",
      });

    expect(res.status).toBe(201);
    const rows = await assessmentsFor(company.id, "Q-POSA");
    expect(rows[0].review_status).toBe("WIP");
    expect(rows[0].score_eligible).toBe(false);
  });

  test("submit an IMPLEMENTED answer with real evidence and maturity>=3 is genuinely score-eligible", async () => {
    const company = await createCompany({ domain: `f07c-pos-b-${Date.now()}.com` });
    const contributor = await createUser(company.id, "CONTRIBUTOR", { email: `contrib-${Date.now()}@testcorp.com` });
    await addQuestion(company.id, "Q-POSB");

    const res = await request(app)
      .post("/api/assessments")
      .set("Authorization", `Bearer ${contributor.token}`)
      .send({
        questId: "Q-POSB", moduleId: "M1", month: "2026-09",
        answer: "IMPLEMENTED", currentLevel: 3, level3Plus: true,
        evidenceLink: "https://example.com/real-evidence.pdf", owner: "me@testcorp.com",
        reviewStatus: "Submitted",
      });

    expect(res.status).toBe(201);
    const rows = await assessmentsFor(company.id, "Q-POSB");
    expect(rows[0].review_status).toBe("Submitted");
    // Genuinely meets the criteria (IMPLEMENTED, maturity >= 3, evidence present) —
    // scoreEligible=true here is legitimate, server-computed, not a forged claim.
    expect(rows[0].score_eligible).toBe(true);
  });

  test("submit a NOT_IMPLEMENTED gap auto-finishes with an action, matching submitReview's else-branch", async () => {
    const company = await createCompany({ domain: `f07c-pos-c-${Date.now()}.com` });
    const contributor = await createUser(company.id, "CONTRIBUTOR", { email: `contrib-${Date.now()}@testcorp.com` });
    await addQuestion(company.id, "Q-POSC");

    const res = await request(app)
      .post("/api/assessments")
      .set("Authorization", `Bearer ${contributor.token}`)
      .send({
        questId: "Q-POSC", moduleId: "M1", month: "2026-09",
        answer: "NOT_IMPLEMENTED",
        reviewStatus: "FINISHED", // exactly what Tracker.jsx's submitReview sends for a gap
        actionOwner: "owner@testcorp.com", actionDueDate: "2026-12-01", actionNotes: "will fix",
      });

    expect(res.status).toBe(201);
    const rows = await assessmentsFor(company.id, "Q-POSC");
    expect(rows[0].review_status).toBe("FINISHED");
    expect(rows[0].score_eligible).toBe(false);

    const actions = await query("SELECT * FROM actions WHERE company_id = $1 AND quest_id = $2", [company.id, "Q-POSC"]);
    expect(actions.rows.length).toBe(1);
  });

  test("LEAD creating an assessment follows the same content-derived rules as CONTRIBUTOR (no special exception)", async () => {
    const company = await createCompany({ domain: `f07c-pos-d-${Date.now()}.com` });
    const lead = await createUser(company.id, "LEAD", { email: `lead-${Date.now()}@testcorp.com` });
    await addQuestion(company.id, "Q-POSD");

    const blocked = await request(app)
      .post("/api/assessments")
      .set("Authorization", `Bearer ${lead.token}`)
      .send({
        questId: "Q-POSD", moduleId: "M1", month: "2026-09",
        answer: "IMPLEMENTED", currentLevel: 5, evidenceLink: "https://example.com/e.pdf",
        reviewStatus: "FINISHED", // even LEAD cannot self-finalize a compliance claim on creation
      });
    expect(blocked.status).toBe(400);

    const ok = await request(app)
      .post("/api/assessments")
      .set("Authorization", `Bearer ${lead.token}`)
      .send({
        questId: "Q-POSD", moduleId: "M1", month: "2026-09",
        answer: "IMPLEMENTED", currentLevel: 5, evidenceLink: "https://example.com/e.pdf",
        reviewStatus: "Submitted",
      });
    expect(ok.status).toBe(201);
    const rows = await assessmentsFor(company.id, "Q-POSD");
    expect(rows.length).toBe(1);
    expect(rows[0].review_status).toBe("Submitted");
  });
});
