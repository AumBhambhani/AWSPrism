import { describe, expect, test, vi } from "vitest";
import request from "supertest";
import app from "../../app.js";
import { query } from "../../db/index.js";
import { heldByAuditSql } from "../../utils/auditCoverage.js";
import { createCompany, createUser } from "../setup/helpers.js";

vi.mock("../../utils/email.js", () => ({ sendEmail: vi.fn().mockResolvedValue(undefined), sendInvitationEmail: vi.fn() }));
vi.mock("../../utils/notifyReviewers.js", () => ({ notifyReviewers: vi.fn().mockResolvedValue(undefined) }));

// Reviewer C — adversarial probes for the audit-period evidence hold (auditCoverage.js).

const MONTH = new Date().toISOString().slice(0, 7);
const lastDayAfter = (month, months) => {
  const [y, m] = month.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1 + months, 0)).toISOString().slice(0, 10);
};

async function setup({ recurrence = "monthly", auditedAt = new Date(Date.now() - 24 * 3600 * 1000), linkedAt = new Date(Date.now() - 80 * 24 * 3600 * 1000), questId = "Q-RCAP", global = false } = {}) {
  const s = `${Date.now()}-${Math.random().toString(16).slice(2)}`;
  const company = await createCompany({ domain: `rcap-${s}.test` });
  const admin = await createUser(company.id, "ADMIN", { email: `a-${s}@rcap.test` });
  const auditor = await createUser(company.id, "AUDITOR", { email: `au-${s}@rcap.test` });
  await query("INSERT INTO auditor_profiles (user_id, company_id, expiry_date, active) VALUES ($1, $2, CURRENT_DATE + INTERVAL '30 days', TRUE)", [auditor.id, company.id]);
  if (!global) {
    await query("INSERT INTO questions (quest_id, company_id, module_id, baseline_question, recurrence_interval) VALUES ($1, $2, 'M-RC', 'q', $3)", [questId, company.id, recurrence]);
  }
  const { rows: v } = await query("INSERT INTO evidence_vault (company_id, title, file_name) VALUES ($1, 'Policy', 'p.pdf') RETURNING id", [company.id]);
  await query("INSERT INTO question_evidence (company_id, quest_id, vault_id, linked_by, linked_at) VALUES ($1, $2, $3, 'seed', $4)", [company.id, questId, v[0].id, linkedAt]);
  const { rows: a } = await query(
    `INSERT INTO assessments (company_id, quest_id, module_id, month, answer, review_status, reviewed_at, audited_at, audited_by)
     VALUES ($1, $2, 'M-RC', $3, 'IMPLEMENTED', 'AUDITED', $4, $4, 'auditor') RETURNING id`,
    [company.id, questId, MONTH, auditedAt]
  );
  return { company, admin, auditor, vaultId: v[0].id, assessmentId: a[0].id, questId };
}
const as = (r, u) => r.set("Authorization", `Bearer ${u.token}`);
const through = async (u, vaultId) => (await as(request(app).get(`/api/vault/${vaultId}`), u)).body.auditedThrough;
const held = async (companyId, vaultId, questId) =>
  (await query(`SELECT ${heldByAuditSql("$2::int", "$1::int", "$3::text")} AS held`, [companyId, vaultId, questId])).rows[0].held;

describe("reviewC audit hold — held checks", () => {
  test("another company's audit of the same quest_id does not hold this company's evidence", async () => {
    const A = await setup();
    const B = await setup();
    // B's evidence for the same quest_id, no audit in B
    await query("UPDATE assessments SET review_status = 'WIP', audited_at = NULL WHERE id = $1", [B.assessmentId]);
    expect(await held(B.company.id, B.vaultId, B.questId)).toBe(false);
    expect(await held(A.company.id, A.vaultId, A.questId)).toBe(true);
    // cross-tenant pairing of vault id and company never matches
    expect(await held(A.company.id, B.vaultId, A.questId)).toBe(false);
    expect(await through(A.admin, B.vaultId)).toBeUndefined();
  });

  test("reopening the audit (AUDITOR -> WIP) removes the hold", async () => {
    const ctx = await setup();
    expect(await through(ctx.admin, ctx.vaultId)).toBe(lastDayAfter(MONTH, 1));
    const r = await as(request(app).put(`/api/assessments/${ctx.assessmentId}`), ctx.auditor).send({ reviewStatus: "WIP" });
    expect(r.status).toBe(200);
    expect(await through(ctx.admin, ctx.vaultId)).toBeNull();
  });

  test("global-template question: interval from the global row, hold still applies", async () => {
    const s = `Q-RCAP-G-${Date.now()}`;
    await query("INSERT INTO questions (quest_id, company_id, module_id, baseline_question, recurrence_interval) VALUES ($1, NULL, 'M-RC', 'q', 'quarterly')", [s]);
    const ctx = await setup({ questId: s, global: true });
    expect(await through(ctx.admin, ctx.vaultId)).toBe(lastDayAfter(MONTH, 3));
  });
});

describe("reviewC audit hold — faults", () => {
  // P3: the audited period is derived from the control's CURRENT recurrence_interval,
  // which ADMIN/LEAD may change after sign-off. A monthly control audited for this month
  // becomes "valid" for a year once the auditee flips it to annual.
  test("changing the control's recurrence after the audit does not stretch the audited period", async () => {
    const ctx = await setup({ recurrence: "monthly" });
    expect(await through(ctx.admin, ctx.vaultId)).toBe(lastDayAfter(MONTH, 1));
    const r = await as(request(app).put(`/api/questions/${ctx.questId}/recurrence`), ctx.admin).send({ recurrenceInterval: "annual" });
    expect(r.status).toBe(200);
    expect(await through(ctx.admin, ctx.vaultId)).toBe(lastDayAfter(MONTH, 1));
  });

  // HELD (probe kept as a regression): re-sending AUDITED on an already-AUDITED row must
  // not let evidence linked AFTER the original sign-off become held.
  test("re-stamping AUDITED does not pull in evidence linked after the original sign-off", async () => {
    const ctx = await setup({ auditedAt: new Date(Date.now() - 5 * 24 * 3600 * 1000) });
    const { rows } = await query("INSERT INTO evidence_vault (company_id, title) VALUES ($1, 'late') RETURNING id", [ctx.company.id]);
    await query("INSERT INTO question_evidence (company_id, quest_id, vault_id, linked_by, linked_at) VALUES ($1, $2, $3, 'x', NOW() - INTERVAL '1 day')", [ctx.company.id, ctx.questId, rows[0].id]);
    expect(await through(ctx.admin, rows[0].id)).toBeNull();
    const r = await as(request(app).put(`/api/assessments/${ctx.assessmentId}`), ctx.auditor).send({ reviewStatus: "AUDITED" });
    expect(r.status).toBe(200);
    expect(await through(ctx.admin, rows[0].id)).toBeNull();
  });

  // P4: for a legacy AUDITED row (audited_at NULL) the anchor is updated_at, which an
  // ADMIN bumps just by editing reviewerNotes — pulling in evidence linked after the audit.
  test("editing reviewerNotes on a legacy AUDITED row does not extend the hold to later evidence", async () => {
    const ctx = await setup({ linkedAt: new Date(Date.now() - 3600 * 1000) });
    await query("UPDATE assessments SET audited_at = NULL, updated_at = NOW() - INTERVAL '1 day' WHERE id = $1", [ctx.assessmentId]);
    expect(await through(ctx.admin, ctx.vaultId)).toBeNull();
    const r = await as(request(app).put(`/api/assessments/${ctx.assessmentId}`), ctx.admin).send({ reviewerNotes: "typo fix" });
    expect(r.status).toBe(200);
    expect(await through(ctx.admin, ctx.vaultId)).toBeNull();
  });
});
