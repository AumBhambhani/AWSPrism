import { query, getClient } from "../db/index.js";
import { auditPeriodEndSql } from "./auditCoverage.js";

/**
 * F-25: a question dropped from the template is archived — unless an audit of it still
 * covers today. Then it stays (with its evidence lock) until that audited period ends,
 * and the scheduler archives it afterwards (archiveRetiredQuestions).
 */
export async function retireQuestion(db, companyId, questId) {
  const held = await db.query(
    `SELECT MAX(COALESCE(a.audit_period_end, ${auditPeriodEndSql("a")}))::text AS until
     FROM assessments a
     WHERE a.company_id = $1 AND a.quest_id = $2 AND a.review_status = 'AUDITED' AND a.archived_at IS NULL`,
    [companyId, questId]
  );
  const until = held.rows[0]?.until;
  const today = (await db.query("SELECT CURRENT_DATE::text AS d")).rows[0].d;
  if (until && until >= today) {
    await db.query(
      "UPDATE questions SET archive_after = $3 WHERE company_id = $1 AND quest_id = $2 AND archived_at IS NULL",
      [companyId, questId, until]
    );
    return { deferredUntil: until };
  }
  await db.query(
    "UPDATE questions SET archived_at = NOW(), archive_after = NULL WHERE company_id = $1 AND quest_id = $2",
    [companyId, questId]
  );
  await db.query(
    "UPDATE assessments SET archived_at = NOW() WHERE company_id = $1 AND quest_id = $2",
    [companyId, questId]
  );
  return { archived: true };
}

// Daily: archive questions whose audited period (F-25 deferral) has ended. If the
// audit was reopened or a newer audit extends the period, retireQuestion re-decides.
export async function archiveRetiredQuestions() {
  const due = await query(
    "SELECT company_id, quest_id FROM questions WHERE archive_after IS NOT NULL AND archive_after < CURRENT_DATE AND archived_at IS NULL"
  );
  for (const q of due.rows) {
    const client = await getClient();
    try {
      await client.query("BEGIN");
      await retireQuestion(client, q.company_id, q.quest_id);
      await client.query("COMMIT");
    } catch (e) {
      await client.query("ROLLBACK").catch(() => {});
      console.error(`[scheduler] archiveRetiredQuestions failed for ${q.quest_id}:`, e.message); // nosemgrep
    } finally {
      client.release();
    }
  }
  return due.rows.length;
}
