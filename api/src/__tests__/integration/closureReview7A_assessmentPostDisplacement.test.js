import { describe, expect, test, vi } from "vitest";
import request from "supertest";
import app from "../../app.js";
import { query } from "../../db/index.js";
import { createCompany, createUser } from "../setup/helpers.js";

vi.mock("../../utils/email.js", () => ({ sendEmail: vi.fn().mockResolvedValue(undefined), sendInvitationEmail: vi.fn() }));
vi.mock("../../utils/notifyReviewers.js", () => ({ notifyReviewers: vi.fn().mockResolvedValue(undefined) }));

// Independent review 7 (reviewer 7A) — 6A3/6A4 POST /api/assessments refusals.
// 6A4 only looks at approved rows of the SAME month. An AUDITED assessment stays in
// effect for its whole audited period (audit_period_end; the Tracker carries it forward
// and shows it locked; collectionRunner / retireQuestion treat it as in effect), and
// the executive dashboard takes the newest approved row by month.

const sfx = () => `${Date.now()}-${Math.random().toString(16).slice(2)}`;
const monthAt = (offset) => {
  const n = new Date();
  return new Date(Date.UTC(n.getUTCFullYear(), n.getUTCMonth() + offset, 1)).toISOString().slice(0, 7);
};
const MONTH = monthAt(0);
const NEXT = monthAt(1);

async function setup({ status = "AUDITED", submittedBy } = {}) {
  const c = await createCompany({ domain: `r7a-${sfx()}.test` });
  const me = await createUser(c.id, "CONTRIBUTOR", { email: `me-${sfx()}@r7a.test` });
  const colleague = await createUser(c.id, "CONTRIBUTOR", { email: `col-${sfx()}@r7a.test` });
  const admin = await createUser(c.id, "ADMIN", { email: `adm-${sfx()}@r7a.test` });
  const lead = await createUser(c.id, "LEAD", { email: `lead-${sfx()}@r7a.test` });
  await query(`INSERT INTO modules (module_id, company_id, name) VALUES ('M-R7', $1, 'Mod')`, [c.id]);
  await query(
    `INSERT INTO questions (quest_id, company_id, module_id, baseline_question, recurrence_interval) VALUES ('Q-R7', $1, 'M-R7', 'Control?', 'annual')`,
    [c.id]
  );
  const a = (await query(
    `INSERT INTO assessments (company_id, quest_id, module_id, month, answer, current_level, review_status, submitted_by,
                              reviewed_by, reviewed_at, audited_by, audited_at, audit_period_end, evidence_link)
     VALUES ($1, 'Q-R7', 'M-R7', $2, 'IMPLEMENTED', 3, $3, $4, 'lead@r7a.test', NOW() - INTERVAL '1 minute',
             CASE WHEN $3 = 'AUDITED' THEN 'auditor@r7a.test' END, CASE WHEN $3 = 'AUDITED' THEN NOW() END,
             CASE WHEN $3 = 'AUDITED' THEN CURRENT_DATE + 300 END, 'https://evidence.example/doc')
     RETURNING id`,
    [c.id, MONTH, status, submittedBy === "me" ? me.email : colleague.email]
  )).rows[0];
  return { c, me, colleague, admin, lead, assessmentId: a.id };
}
const gap = (month) => ({
  month, moduleId: "M-R7", questId: "Q-R7", answer: "NOT_IMPLEMENTED", currentLevel: 1, reviewStatus: "FINISHED",
  actionOwner: "someone", actionDueDate: "2027-01-31", actionNotes: "fix it",
});

describe("review7A: 6A4 — a new row may not displace an AUDITED control still in its audited period", () => {
  test("contributor POST for the NEXT month (inside the audited period) is refused", async () => {
    const { me, admin } = await setup();
    const before = await request(app).get(`/api/dashboard?month=${NEXT}`).set("Authorization", `Bearer ${admin.token}`);
    expect(before.status).toBe(200);
    const beforeAnswers = JSON.stringify(before.body.answerDistribution ?? before.body.overall);

    const res = await request(app).post("/api/assessments").set("Authorization", `Bearer ${me.token}`).send(gap(NEXT));
    const after = await request(app).get(`/api/dashboard?month=${NEXT}`).set("Authorization", `Bearer ${admin.token}`);
    // Refused: future months are rejected outright (400); a covered month is 409.
    expect([400, 409]).toContain(res.status);
    expect(JSON.stringify(after.body.answerDistribution ?? after.body.overall)).toBe(beforeAnswers);
  });

  test("a LEAD's POST for the current month inside an earlier audit's period is refused; an ADMIN's is not", async () => {
    const { assessmentId, lead, admin } = await setup();
    await query("UPDATE assessments SET month = $1 WHERE id = $2", [monthAt(-1), assessmentId]);
    const body = { ...gap(MONTH) };
    const refused = await request(app).post("/api/assessments").set("Authorization", `Bearer ${lead.token}`).send(body);
    expect(refused.status).toBe(409);
    expect(refused.body.code).toBe("AUDITED");
    expect((await request(app).post("/api/assessments").set("Authorization", `Bearer ${admin.token}`).send(body)).status).toBe(201);
  });

  test("contributor POST for a far-future month does not flip the executive control status of an audited control", async () => {
    const { me, admin } = await setup();
    const before = await request(app).get("/api/dashboard/management?months=3").set("Authorization", `Bearer ${admin.token}`);
    expect(before.status).toBe(200);
    expect(before.body.controlStatus).toMatchObject({ compliant: 1, nonCompliant: 0 });

    const res = await request(app).post("/api/assessments").set("Authorization", `Bearer ${me.token}`).send(gap("2099-12"));
    const after = await request(app).get("/api/dashboard/management?months=3").set("Authorization", `Bearer ${admin.token}`);
    expect([400, 409]).toContain(res.status);
    expect(after.body.controlStatus).toMatchObject({ compliant: 1, nonCompliant: 0 });
  });

  test("HELD: same-month POST over AUDITED is 409 for LEAD and CONTRIBUTOR, allowed for ADMIN", async () => {
    const { me, lead, admin } = await setup();
    const body = { month: MONTH, moduleId: "M-R7", questId: "Q-R7", answer: "IMPLEMENTED", reviewStatus: "WIP" };
    expect((await request(app).post("/api/assessments").set("Authorization", `Bearer ${me.token}`).send(body)).status).toBe(409);
    expect((await request(app).post("/api/assessments").set("Authorization", `Bearer ${lead.token}`).send(body)).status).toBe(409);
    expect((await request(app).post("/api/assessments").set("Authorization", `Bearer ${admin.token}`).send(body)).status).toBe(201);
  });

  test("HELD: month omitted — the month-less row displaces nothing on the dashboards", async () => {
    const { me, admin } = await setup();
    const res = await request(app).post("/api/assessments").set("Authorization", `Bearer ${me.token}`).send({ ...gap(undefined) });
    expect(res.status).toBeLessThan(300);
    const mgmt = await request(app).get("/api/dashboard/management?months=3").set("Authorization", `Bearer ${admin.token}`);
    expect(mgmt.body.controlStatus).toMatchObject({ compliant: 1, nonCompliant: 0 });
    const cur = await request(app).get(`/api/dashboard?month=${MONTH}`).set("Authorization", `Bearer ${admin.token}`);
    expect(cur.body.overall.finished).toBe(1);
  });
});

describe("review7A: legitimate Tracker flows still work", () => {
  test("HELD: contributor reopens own FINISHED (PUT WIP) then resubmits the same month with their evidence", async () => {
    const { me, c, assessmentId } = await setup({ status: "FINISHED", submittedBy: "me" });
    const ev = (await query(
      `INSERT INTO evidence (company_id, quest_id, module_id, month, evidence_id, evidence_name, evidence_link, uploaded_by, created_at)
       VALUES ($1, 'Q-R7', 'M-R7', $2, $3, 'mine.pdf', 'https://evidence.example/doc', $4, NOW() - INTERVAL '2 minutes') RETURNING id`,
      [c.id, MONTH, String(assessmentId), me.email]
    )).rows[0];
    const put = await request(app).put(`/api/assessments/${assessmentId}`).set("Authorization", `Bearer ${me.token}`).send({ reviewStatus: "WIP" });
    expect(put.status).toBe(200);
    const res = await request(app).post("/api/assessments").set("Authorization", `Bearer ${me.token}`).send({
      month: MONTH, moduleId: "M-R7", questId: "Q-R7", answer: "IMPLEMENTED", currentLevel: 3, reviewStatus: "Submitted", evidenceIds: [ev.id],
    });
    expect(res.status).toBe(201);
  });

  test("HELD: LEAD re-assesses a colleague's FINISHED month directly", async () => {
    const { lead } = await setup({ status: "FINISHED" });
    const res = await request(app).post("/api/assessments").set("Authorization", `Bearer ${lead.token}`).send({
      month: MONTH, moduleId: "M-R7", questId: "Q-R7", answer: "IMPLEMENTED", currentLevel: 3, reviewStatus: "Submitted", evidenceLink: "https://e.example/x",
    });
    expect(res.status).toBe(201);
  });

  test("HELD: contributor over a colleague's FINISHED same month is 403 NOT_OWN_SUBMISSION; legacy NULL submitter too", async () => {
    const { me, assessmentId } = await setup({ status: "FINISHED" });
    const body = { month: MONTH, moduleId: "M-R7", questId: "Q-R7", answer: "IMPLEMENTED", reviewStatus: "WIP" };
    const r1 = await request(app).post("/api/assessments").set("Authorization", `Bearer ${me.token}`).send(body);
    expect(r1.body.code).toBe("NOT_OWN_SUBMISSION");
    await query("UPDATE assessments SET submitted_by = NULL WHERE id = $1", [assessmentId]);
    const r2 = await request(app).post("/api/assessments").set("Authorization", `Bearer ${me.token}`).send(body);
    expect(r2.body.code).toBe("NOT_OWN_SUBMISSION");
  });
});

describe("review7A: 6A3 — evidence re-parenting / uploaded_by laundering", () => {
  async function withColleagueEvidence(status) {
    const s = await setup({ status });
    const ev = (await query(
      `INSERT INTO evidence (company_id, quest_id, module_id, month, evidence_id, evidence_name, evidence_link, uploaded_by, created_at)
       VALUES ($1, 'Q-R7', 'M-R7', $2, $3, 'colleague.pdf', 'https://evidence.example/doc', $4, NOW() - INTERVAL '2 minutes') RETURNING id`,
      [s.c.id, MONTH, String(s.assessmentId), s.colleague.email]
    )).rows[0];
    return { ...s, evId: ev.id };
  }
  const evRow = async (id) => (await query("SELECT evidence_id, uploaded_by FROM evidence WHERE id = $1", [id])).rows[0];

  test("HELD: PUT /api/evidence/:id cannot launder a colleague's approved row (uploaded_by overwrite + detach)", async () => {
    const { me, evId, assessmentId } = await withColleagueEvidence("FINISHED");
    const r = await request(app).put(`/api/evidence/${evId}`).set("Authorization", `Bearer ${me.token}`).send({ evidenceId: "" });
    expect(r.status).toBe(403);
    expect(await evRow(evId)).toMatchObject({ evidence_id: String(assessmentId) });
    expect((await query("SELECT review_status FROM assessments WHERE id = $1", [assessmentId])).rows[0].review_status).toBe("FINISHED");
  });

  test("HELD: POST evidenceIds with a colleague's approved row is 403 NOT_OWN_EVIDENCE (other month, no displacement guard)", async () => {
    const { me, evId, assessmentId } = await withColleagueEvidence("FINISHED");
    const r = await request(app).post("/api/assessments").set("Authorization", `Bearer ${me.token}`).send({
      month: "2020-01", moduleId: "M-R7", questId: "Q-R7", answer: "IMPLEMENTED", reviewStatus: "WIP", evidenceIds: [evId],
    });
    expect(r.body.code).toBe("NOT_OWN_EVIDENCE");
    expect(await evRow(evId)).toMatchObject({ evidence_id: String(assessmentId) });
  });
});
