import { describe, expect, test, vi } from "vitest";
import { getClient, query } from "../../db/index.js";
import { createCompany } from "../setup/helpers.js";
import { applyTemplateDiff } from "../../routes/frameworks.js";
import { archiveRetiredQuestions } from "../../utils/retireQuestion.js";

vi.mock("../../utils/email.js", () => ({ sendEmail: vi.fn().mockResolvedValue(undefined), sendInvitationEmail: vi.fn() }));
vi.mock("../../utils/notifyReviewers.js", () => ({ notifyReviewers: vi.fn().mockResolvedValue(undefined) }));

// Independent review 6 (reviewer A) — F-25 deferral probes.

const sfx = () => `${Date.now()}-${Math.random().toString(16).slice(2)}`;

async function apply(companyId, diff, toQuestions = []) {
  const client = await getClient();
  try {
    await client.query("BEGIN");
    await applyTemplateDiff(client, {
      companyId, diff: { reworded: [], renamed: [], added: [], removed: [], ...diff }, toQuestions, toVersion: 3, frameworkKey: null,
    });
    await client.query("COMMIT");
  } catch (e) {
    await client.query("ROLLBACK");
    throw e;
  } finally {
    client.release();
  }
}

async function setupAudited(questId, periodEnd = "CURRENT_DATE + 20") {
  const c = await createCompany({ domain: `r6a-${sfx()}.test` });
  await query("INSERT INTO questions (quest_id, company_id, module_id, baseline_question) VALUES ($1, $2, 'M-F25', 'Control?')", [questId, c.id]);
  await query(
    `INSERT INTO assessments (company_id, quest_id, module_id, month, answer, review_status, audited_at, audit_period_end)
     VALUES ($1, $2, 'M-F25', to_char(CURRENT_DATE, 'YYYY-MM'), 'IMPLEMENTED', 'AUDITED', NOW(), ${periodEnd})`,
    [c.id, questId]
  );
  return c;
}

describe("review6A: F-25 removal / re-add", () => {
  // v2 removes Q (deferred, then archived by the scheduler once the audit ends); v3
  // puts Q back. provisionTemplate's INSERT ... ON CONFLICT DO NOTHING hits the archived
  // row and the re-added control stays archived — invisible in the Tracker/dashboard.
  test("a question re-added after its deferred removal completed is live again", async () => {
    const c = await setupAudited("Q-R6-F25");
    await apply(c.id, { removed: [{ questId: "Q-R6-F25" }] });
    await query("UPDATE questions SET archive_after = CURRENT_DATE - 1 WHERE company_id = $1", [c.id]);
    await query("UPDATE assessments SET audit_period_end = CURRENT_DATE - 1 WHERE company_id = $1", [c.id]);
    await archiveRetiredQuestions();
    expect((await query("SELECT archived_at FROM questions WHERE company_id = $1", [c.id])).rows[0].archived_at).not.toBeNull();

    await apply(c.id, { added: [{ questId: "Q-R6-F25" }] }, [{ quest_id: "Q-R6-F25", module_id: "M-F25", baseline_question: "Control? (v3)" }]);
    const q = (await query("SELECT archived_at, archive_after FROM questions WHERE company_id = $1 AND quest_id = 'Q-R6-F25'", [c.id])).rows[0];
    expect(q.archived_at).toBeNull();
  });

  test("HELD: re-adding during the deferral clears archive_after and keeps the question", async () => {
    const c = await setupAudited("Q-R6-F25b");
    await apply(c.id, { removed: [{ questId: "Q-R6-F25b" }] });
    await apply(c.id, { added: [{ questId: "Q-R6-F25b" }] }, [{ quest_id: "Q-R6-F25b", module_id: "M-F25" }]);
    const q = (await query("SELECT archived_at, archive_after FROM questions WHERE company_id = $1", [c.id])).rows[0];
    expect(q).toEqual({ archived_at: null, archive_after: null });
  });

  test("HELD: running the same removal twice is idempotent and scoped to the tenant", async () => {
    const c = await setupAudited("Q-R6-F25c");
    const other = await setupAudited("Q-R6-F25c", "CURRENT_DATE - 1");
    await apply(c.id, { removed: [{ questId: "Q-R6-F25c" }] });
    await apply(c.id, { removed: [{ questId: "Q-R6-F25c" }] });
    const mine = (await query("SELECT archived_at, archive_after::text AS aa FROM questions WHERE company_id = $1", [c.id])).rows[0];
    const theirs = (await query("SELECT archived_at, archive_after FROM questions WHERE company_id = $1", [other.id])).rows[0];
    expect(mine.archived_at).toBeNull();
    expect(mine.aa).toBe((await query("SELECT (CURRENT_DATE + 20)::text AS d")).rows[0].d);
    expect(theirs).toEqual({ archived_at: null, archive_after: null });
  });

  test("HELD: an audit reopened during the deferral lets the scheduler archive on the original date", async () => {
    const c = await setupAudited("Q-R6-F25d");
    await apply(c.id, { removed: [{ questId: "Q-R6-F25d" }] });
    await query("UPDATE assessments SET review_status = 'WIP', audited_at = NULL, audit_period_end = NULL WHERE company_id = $1", [c.id]);
    await query("UPDATE questions SET archive_after = CURRENT_DATE - 1 WHERE company_id = $1", [c.id]);
    await archiveRetiredQuestions();
    const q = (await query("SELECT archived_at FROM questions WHERE company_id = $1", [c.id])).rows[0];
    expect(q.archived_at).not.toBeNull();
  });
  // A later version renames another control onto the id of a question that is only
  // still present because of an F-25 deferral. The new clash guard treats the deferred
  // question as live and throws 409, so the whole template upgrade is blocked until the
  // audited period ends (the archived-case moves it aside instead).
  test("a rename onto a deferred (on-its-way-out) question id does not block the upgrade", async () => {
    const c = await setupAudited("Q-R6-F25e");
    await query("INSERT INTO questions (quest_id, company_id, module_id, baseline_question) VALUES ('Q-R6-OLD', $1, 'M-F25', 'Old?')", [c.id]);
    await apply(c.id, { removed: [{ questId: "Q-R6-F25e" }] });
    await expect(apply(c.id, { renamed: [{ oldQuestId: "Q-R6-OLD", newQuestId: "Q-R6-F25e" }] },
      [{ quest_id: "Q-R6-F25e", module_id: "M-F25", baseline_question: "New?" }])).resolves.toBeUndefined();
  });
});

