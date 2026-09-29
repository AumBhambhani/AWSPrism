import { describe, expect, test, vi } from "vitest";
import request from "supertest";
import app from "../../app.js";
import { query } from "../../db/index.js";
import { createCompany, createUser } from "../setup/helpers.js";

vi.mock("../../utils/email.js", () => ({ sendEmail: vi.fn().mockResolvedValue(undefined), sendInvitationEmail: vi.fn() }));
vi.mock("../../utils/notifyReviewers.js", () => ({ notifyReviewers: vi.fn().mockResolvedValue(undefined) }));

// Independent review 6 (reviewer A) — PUT /api/assessments/:id now refuses to let a
// CONTRIBUTOR reopen a colleague's submission (NOT_OWN_SUBMISSION). These probe sibling
// paths that reach the same outcome without PUT.

const sfx = () => `${Date.now()}-${Math.random().toString(16).slice(2)}`;
const MONTH = new Date().toISOString().slice(0, 7);

async function setup(status) {
  const c = await createCompany({ domain: `r6a-${sfx()}.test` });
  const me = await createUser(c.id, "CONTRIBUTOR", { email: `me-${sfx()}@r6a.test` });
  const colleague = await createUser(c.id, "CONTRIBUTOR", { email: `col-${sfx()}@r6a.test` });
  await query(`INSERT INTO modules (module_id, company_id, name) VALUES ('M-R6', $1, 'Mod')`, [c.id]);
  await query(`INSERT INTO questions (quest_id, company_id, module_id, baseline_question) VALUES ('Q-R6', $1, 'M-R6', 'Control?')`, [c.id]);
  const a = (await query(
    `INSERT INTO assessments (company_id, quest_id, module_id, month, answer, current_level, review_status, submitted_by,
                              reviewed_by, reviewed_at, audited_by, audited_at, audit_period_end, evidence_link)
     VALUES ($1, 'Q-R6', 'M-R6', $2, 'IMPLEMENTED', 3, $3, $4, 'lead@r6a.test', NOW() - INTERVAL '1 minute',
             CASE WHEN $3 = 'AUDITED' THEN 'auditor@r6a.test' END, CASE WHEN $3 = 'AUDITED' THEN NOW() END,
             CASE WHEN $3 = 'AUDITED' THEN CURRENT_DATE + 20 END, 'https://evidence.example/doc')
     RETURNING id`,
    [c.id, MONTH, status, colleague.email]
  )).rows[0];
  const ev = (await query(
    `INSERT INTO evidence (company_id, quest_id, module_id, month, evidence_id, evidence_name, evidence_link, uploaded_by, created_at)
     VALUES ($1, 'Q-R6', 'M-R6', $2, $3, 'colleague-proof.pdf', 'https://evidence.example/doc', $4, NOW() - INTERVAL '2 minutes') RETURNING id`,
    [c.id, MONTH, String(a.id), colleague.email]
  )).rows[0];
  return { c, me, colleague, assessmentId: a.id, evidenceId: ev.id };
}
const statusOf = async (id) => (await query("SELECT review_status FROM assessments WHERE id = $1", [id])).rows[0].review_status;

describe("review6A: a contributor cannot alter a colleague's approved assessment by other routes", () => {
  test("POST /api/assessments with evidenceIds does not send a colleague's FINISHED approval back to review", async () => {
    const { me, assessmentId, evidenceId } = await setup("FINISHED");
    const res = await request(app).post("/api/assessments").set("Authorization", `Bearer ${me.token}`).send({
      month: MONTH, moduleId: "M-R6", questId: "Q-R6", answer: "IMPLEMENTED", reviewStatus: "WIP", evidenceIds: [evidenceId],
    });
    // Either refused, or at least the colleague's approval and evidence are left alone.
    const ev = (await query("SELECT evidence_id FROM evidence WHERE id = $1", [evidenceId])).rows[0];
    expect({ status: await statusOf(assessmentId), evidenceOwner: ev.evidence_id, http: res.status < 300 ? "ok" : "refused" })
      .toMatchObject({ status: "FINISHED", evidenceOwner: String(assessmentId) });
  });

  test("POST /api/assessments for the same quest+month does not displace a colleague's AUDITED control on the dashboard", async () => {
    const { me, c } = await setup("AUDITED");
    const admin = await createUser(c.id, "ADMIN", { email: `adm-${sfx()}@r6a.test` });
    const before = await request(app).get(`/api/dashboard?month=${MONTH}`).set("Authorization", `Bearer ${admin.token}`);
    expect(before.status).toBe(200);
    expect(before.body.overall.finished).toBe(1);

    const res = await request(app).post("/api/assessments").set("Authorization", `Bearer ${me.token}`).send({
      month: MONTH, moduleId: "M-R6", questId: "Q-R6", answer: "IMPLEMENTED", reviewStatus: "WIP",
    });
    // Refused outright (only an auditor/admin may reopen an audited month).
    expect(res.status).toBe(409);
    const after = await request(app).get(`/api/dashboard?month=${MONTH}`).set("Authorization", `Bearer ${admin.token}`);
    expect(after.body.overall.finished).toBe(1);
  });

  test("HELD: a legacy assessment with no submitted_by cannot be reopened by a contributor", async () => {
    const { me, assessmentId } = await setup("FINISHED");
    await query("UPDATE assessments SET submitted_by = NULL WHERE id = $1", [assessmentId]);
    const res = await request(app).put(`/api/assessments/${assessmentId}`).set("Authorization", `Bearer ${me.token}`).send({ reviewStatus: "WIP" });
    expect(res.status).toBe(403);
    expect(await statusOf(assessmentId)).toBe("FINISHED");
  });
});
