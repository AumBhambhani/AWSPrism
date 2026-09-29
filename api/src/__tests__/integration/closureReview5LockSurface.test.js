import { describe, expect, test, vi } from "vitest";
import request from "supertest";
import app from "../../app.js";
import { getClient, query } from "../../db/index.js";
import { createCompany, createUser } from "../setup/helpers.js";

vi.mock("../../utils/email.js", () => ({ sendEmail: vi.fn().mockResolvedValue(undefined), sendInvitationEmail: vi.fn() }));
vi.mock("../../utils/notifyReviewers.js", () => ({ notifyReviewers: vi.fn().mockResolvedValue(undefined) }));
vi.mock("../../utils/scanFile.js", () => ({
  scanFile: vi.fn().mockResolvedValue({ safe: true }),
  scanBuffer: vi.fn().mockResolvedValue({ safe: true }),
}));

// Independent reviewer A probes for F-11 / F-24.

const MONTH = "2026-08";

async function setup() {
  const s = `${Date.now()}-${Math.random().toString(16).slice(2)}`;
  const company = await createCompany({ domain: `rva-${s}.test` });
  const admin = await createUser(company.id, "ADMIN", { email: `admin-${s}@rva.test` });
  const lead = await createUser(company.id, "LEAD", { email: `lead-${s}@rva.test` });
  const contributor = await createUser(company.id, "CONTRIBUTOR", { email: `c-${s}@rva.test` });
  const auditor = await createUser(company.id, "AUDITOR", { email: `a-${s}@rva.test` });
  await query(
    `INSERT INTO auditor_profiles (user_id, company_id, start_date, expiry_date, active)
     VALUES ($1, $2, CURRENT_DATE - 1, CURRENT_DATE + 30, TRUE)`,
    [auditor.id, company.id]
  );
  await query(
    `INSERT INTO questions (quest_id, company_id, module_id, module_name, control_area, baseline_question)
     VALUES ('Q-RVA', $1, 'M-RVA', 'Access', 'Access control', 'Is access reviewed?')`,
    [company.id]
  );
  return { company, admin, lead, contributor, auditor };
}

const as = (r, u) => r.set("Authorization", `Bearer ${u.token}`);
const status = async (id) => (await query("SELECT review_status FROM assessments WHERE id = $1", [id])).rows[0]?.review_status;

describe("reviewA F-24: sibling delete path", () => {
  // Evidence row R (same quest + month) is attached (evidence_id) to a WIP draft A2, and
  // existed when a sibling assessment A1 of the same quest/month was AUDITED. R is locked
  // by A1 (PUT /api/evidence/:id -> 409, DELETE /api/evidence/:id -> 409, and Review shows
  // it under A1), but a LEAD deleting the WIP draft A2 cascades R away.
  test("LEAD deleting a non-audited assessment must not delete evidence locked by an AUDITED sibling", async () => {
    const ctx = await setup();
    const { rows: a2 } = await query(
      "INSERT INTO assessments (company_id, quest_id, module_id, month, answer, review_status) VALUES ($1, 'Q-RVA', 'M-RVA', $2, 'IMPLEMENTED', 'WIP') RETURNING id",
      [ctx.company.id, MONTH]
    );
    const up = await as(request(app).post("/api/evidence"), ctx.contributor)
      .send({ questId: "Q-RVA", moduleId: "M-RVA", month: MONTH, evidenceId: String(a2[0].id), evidenceLink: "https://good.example/e", evidenceName: "audited evidence" });
    expect(up.status).toBe(201);
    const { rows: a1 } = await query(
      `INSERT INTO assessments (company_id, quest_id, module_id, month, answer, review_status, reviewed_at, audited_at)
       VALUES ($1, 'Q-RVA', 'M-RVA', $2, 'IMPLEMENTED', 'AUDITED', NOW(), NOW() + INTERVAL '1 second') RETURNING id`,
      [ctx.company.id, MONTH]
    );
    // Sanity: the row really is locked by the audited sibling.
    expect((await as(request(app).put(`/api/evidence/${up.body.id}`), ctx.contributor).send({ notes: "x" })).status).toBe(409);
    expect((await as(request(app).delete(`/api/evidence/${up.body.id}`), ctx.lead)).status).toBe(409);

    const res = await as(request(app).delete(`/api/assessments/${a2[0].id}`), ctx.lead);
    const left = await query("SELECT 1 FROM evidence WHERE id = $1", [up.body.id]);
    expect(await status(a1[0].id)).toBe("AUDITED");
    // Either the delete is refused, or the locked evidence row survives it.
    expect(res.status === 409 || left.rows.length === 1).toBe(true);
  });
});

describe("reviewA F-11: status transitions", () => {
  // REVIEW_STATUS_BY_ROLE comment: "AUDITOR runs the audit stage on top of an
  // already-FINISHED control (FINISHED -> AUDITED / WIP)". Nothing enforces FINISHED.
  test("AUDITOR cannot mark a Submitted (never reviewed) assessment AUDITED", async () => {
    const ctx = await setup();
    const { rows } = await query(
      "INSERT INTO assessments (company_id, quest_id, module_id, month, answer, review_status) VALUES ($1, 'Q-RVA', 'M-RVA', $2, 'IMPLEMENTED', 'Submitted') RETURNING id",
      [ctx.company.id, MONTH]
    );
    const res = await as(request(app).put(`/api/assessments/${rows[0].id}`), ctx.auditor).send({ reviewStatus: "AUDITED" });
    expect(res.status).toBeGreaterThanOrEqual(400);
    expect(await status(rows[0].id)).toBe("Submitted");
  });
});

describe("reviewA F-11: month-less audited assessment", () => {
  // POST /api/assessments accepts no month (month NULL). Review.jsx shows every evidence
  // row of the quest under a month-less assessment (`!a.month || e.month === a.month ...`),
  // but approvedAssessmentsForEvidenceRow only locks rows whose month is NULL or equal.
  test("a dated row the auditor was shown under a month-less AUDITED assessment is locked", async () => {
    const ctx = await setup();
    const up = await as(request(app).post("/api/evidence"), ctx.contributor)
      .send({ questId: "Q-RVA", moduleId: "M-RVA", month: MONTH, evidenceLink: "https://good.example/e", evidenceName: "shown" });
    expect(up.status).toBe(201);
    await query(
      `INSERT INTO assessments (company_id, quest_id, module_id, month, answer, review_status, reviewed_at, audited_at)
       VALUES ($1, 'Q-RVA', 'M-RVA', NULL, 'IMPLEMENTED', 'AUDITED', NOW(), NOW() + INTERVAL '1 second')`,
      [ctx.company.id]
    );
    const res = await as(request(app).put(`/api/evidence/${up.body.id}`), ctx.contributor).send({ evidenceLink: "https://evil.example/swapped" });
    expect(res.status).toBe(409);
  });
});

describe("reviewA F-11/F-25: applyTemplateDiff rename collisions", () => {
  // questions_company_quest_id_idx is UNIQUE (company_id, quest_id) including archived rows.
  // A rename onto a quest_id the company already holds (e.g. archived by an earlier
  // version's removal) throws a unique violation -> the apply route 500s.
  test("rename onto a quest_id the company already has (archived) does not throw", async () => {
    const { applyTemplateDiff } = await import("../../routes/frameworks.js");
    const ctx = await setup();
    await query(
      `INSERT INTO questions (quest_id, company_id, module_id, module_name, control_area, baseline_question, archived_at)
       VALUES ('Q-RVA-v2', $1, 'M-RVA', 'Access', 'Access control', 'Old removed question', NOW())`,
      [ctx.company.id]
    );
    const client = await getClient();
    let err = null;
    try {
      await client.query("BEGIN");
      await applyTemplateDiff(client, {
        companyId: ctx.company.id,
        diff: { reworded: [], renamed: [{ oldQuestId: "Q-RVA", newQuestId: "Q-RVA-v2" }], added: [], removed: [] },
        toQuestions: [{ quest_id: "Q-RVA-v2", baseline_question: "Is access reviewed?" }], toVersion: 2, frameworkKey: null,
      });
      await client.query("COMMIT");
    } catch (e) {
      err = e;
      await client.query("ROLLBACK");
    } finally {
      client.release();
    }
    expect(err?.message ?? null).toBeNull();
  });

  test("rename is tenant-scoped: another tenant's rows with the same quest_id are untouched", async () => {
    const { applyTemplateDiff } = await import("../../routes/frameworks.js");
    const a = await setup();
    const b = await setup();
    const { rows: bAss } = await query(
      "INSERT INTO assessments (company_id, quest_id, month, review_status, audited_at) VALUES ($1, 'Q-RVA', $2, 'AUDITED', NOW()) RETURNING id",
      [b.company.id, MONTH]
    );
    const { rows: bEv } = await query(
      "INSERT INTO evidence (company_id, quest_id, month, evidence_type, evidence_name, evidence_link) VALUES ($1, 'Q-RVA', $2, 'LINK', 'b', 'https://b.example') RETURNING id",
      [b.company.id, MONTH]
    );
    const client = await getClient();
    try {
      await client.query("BEGIN");
      await applyTemplateDiff(client, {
        companyId: a.company.id,
        diff: { reworded: [], renamed: [{ oldQuestId: "Q-RVA", newQuestId: "Q-RVA-v3" }], added: [], removed: [] },
        toQuestions: [{ quest_id: "Q-RVA-v3", baseline_question: "q?" }], toVersion: 2, frameworkKey: null,
      });
      await client.query("COMMIT");
    } finally {
      client.release();
    }
    expect((await query("SELECT quest_id FROM assessments WHERE id = $1", [bAss[0].id])).rows[0].quest_id).toBe("Q-RVA");
    expect((await query("SELECT quest_id FROM evidence WHERE id = $1", [bEv[0].id])).rows[0].quest_id).toBe("Q-RVA");
    expect((await query("SELECT 1 FROM questions WHERE company_id = $1 AND quest_id = 'Q-RVA'", [b.company.id])).rows).toHaveLength(1);
  });
});
