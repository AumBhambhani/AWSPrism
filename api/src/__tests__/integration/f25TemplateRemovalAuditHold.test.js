import { describe, expect, test, vi } from "vitest";
import { getClient, query } from "../../db/index.js";
import { createCompany } from "../setup/helpers.js";
import { applyTemplateDiff } from "../../routes/frameworks.js";
import { archiveRetiredQuestions } from "../../utils/retireQuestion.js";

vi.mock("../../utils/email.js", () => ({ sendEmail: vi.fn().mockResolvedValue(undefined), sendInvitationEmail: vi.fn() }));
vi.mock("../../utils/notifyReviewers.js", () => ({ notifyReviewers: vi.fn().mockResolvedValue(undefined) }));

// F-25 (archive half) — a template upgrade that removes a question archived it and its
// assessments at once, dropping an audit's evidence lock mid-period. User decision: keep
// the question for the audited period, then remove it.

async function setup({ status = "AUDITED", periodEnd = "CURRENT_DATE + 20" } = {}) {
  const company = await createCompany({ domain: `f25-${Date.now()}-${Math.random().toString(16).slice(2)}.test` });
  await query(
    "INSERT INTO questions (quest_id, company_id, module_id, baseline_question) VALUES ('Q-F25', $1, 'M-F25', 'Retired control?')",
    [company.id]
  );
  if (status) {
    await query(
      `INSERT INTO assessments (company_id, quest_id, module_id, month, answer, review_status, audited_at, audit_period_end)
       VALUES ($1, 'Q-F25', 'M-F25', to_char(CURRENT_DATE, 'YYYY-MM'), 'IMPLEMENTED', $2,
               CASE WHEN $2 = 'AUDITED' THEN NOW() END, CASE WHEN $2 = 'AUDITED' THEN ${periodEnd} END)`,
      [company.id, status]
    );
  }
  return company;
}

async function removeQ(companyId, extra = {}) {
  const client = await getClient();
  try {
    await client.query("BEGIN");
    await applyTemplateDiff(client, {
      companyId,
      diff: { reworded: [], renamed: [], added: extra.added || [], removed: [{ questId: "Q-F25" }] },
      toQuestions: extra.toQuestions || [], toVersion: 2, frameworkKey: null,
    });
    await client.query("COMMIT");
  } finally {
    client.release();
  }
}

const state = async (companyId) => {
  const q = (await query("SELECT archived_at, archive_after::text AS archive_after FROM questions WHERE company_id = $1 AND quest_id = 'Q-F25'", [companyId])).rows[0];
  const a = (await query("SELECT archived_at FROM assessments WHERE company_id = $1 AND quest_id = 'Q-F25'", [companyId])).rows;
  return { questionArchived: !!q.archived_at, archiveAfter: q.archive_after, assessmentsArchived: a.map((r) => !!r.archived_at) };
};

describe("F-25 template removal keeps audited questions for the audited period", () => {
  test("a question audited for a period that is still running is kept until the period ends", async () => {
    const c = await setup();
    await removeQ(c.id);
    const s = await state(c.id);
    expect(s.questionArchived).toBe(false);
    expect(s.assessmentsArchived).toEqual([false]);
    expect(s.archiveAfter).toBe((await query("SELECT (CURRENT_DATE + 20)::text AS d")).rows[0].d);
  });

  test("once the audited period has ended the scheduler archives it", async () => {
    const c = await setup();
    await removeQ(c.id);
    await query("UPDATE questions SET archive_after = CURRENT_DATE - 1 WHERE company_id = $1", [c.id]);
    await query("UPDATE assessments SET audit_period_end = CURRENT_DATE - 1 WHERE company_id = $1", [c.id]);
    await archiveRetiredQuestions();
    const s = await state(c.id);
    expect(s.questionArchived).toBe(true);
    expect(s.archiveAfter).toBeNull();
    expect(s.assessmentsArchived).toEqual([true]);
  });

  test("if a newer audit extends the period, the scheduler keeps it longer", async () => {
    const c = await setup();
    await removeQ(c.id);
    await query("UPDATE questions SET archive_after = CURRENT_DATE - 1 WHERE company_id = $1", [c.id]);
    await query("UPDATE assessments SET audit_period_end = CURRENT_DATE + 40 WHERE company_id = $1", [c.id]);
    await archiveRetiredQuestions();
    const s = await state(c.id);
    expect(s.questionArchived).toBe(false);
    expect(s.archiveAfter).toBe((await query("SELECT (CURRENT_DATE + 40)::text AS d")).rows[0].d);
  });

  test("an audit whose period already ended does not hold the removal", async () => {
    const c = await setup({ periodEnd: "CURRENT_DATE - 1" });
    await removeQ(c.id);
    expect((await state(c.id)).questionArchived).toBe(true);
  });

  test("a question that was never audited is archived straight away, as before", async () => {
    const c = await setup({ status: "FINISHED" });
    await removeQ(c.id);
    const s = await state(c.id);
    expect(s.questionArchived).toBe(true);
    expect(s.assessmentsArchived).toEqual([true]);
  });
});
