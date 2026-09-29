import { query, mapRow } from "../db/index.js";
import { analyzeEvidence } from "./aiProvider.js";
import { withLocalCopy } from "./evidenceStorage.js";

// Guards against the same vault item being auto-analysed twice concurrently in
// one process (e.g. two version writes racing). Mirrors storageMigration.js.
const _running = new Set();

/**
 * Run AI analysis for a single evidence_vault item and persist the result on the
 * vault row (ai_contributor_comments / ai_reviewer_comments / ai_gaps /
 * ai_suggestions / ai_analyzed_at / ai_date_warning / ai_analyzed_version /
 * ai_provider).
 *
 * The vault item is the reusable unit: one analysis is shared by every question —
 * and therefore every framework — the item is linked to. `required_evidence` and
 * `recurrence_interval` are taken from the earliest-linked question (preferring the
 * company row, falling back to the global template row).
 *
 * @param {{ vaultId:number, companyId:number, provider?:string|null, today?:string|null }} args
 * @returns {Promise<{ analysis:object, vaultItem:object }>}
 */
export async function runEvidenceAnalysis({ vaultId, companyId, provider = null, today = null }) {
  const vres = await query(
    `SELECT ev.*,
            lq.quest_id            AS linked_quest_id,
            lq.required_evidence   AS linked_required_evidence,
            lq.recurrence_interval AS linked_recurrence_interval
       FROM evidence_vault ev
       LEFT JOIN LATERAL (
         SELECT qe.quest_id, q.required_evidence, q.recurrence_interval
           FROM question_evidence qe
           JOIN LATERAL (
             SELECT required_evidence, recurrence_interval FROM questions
              WHERE quest_id = qe.quest_id AND (company_id = $2 OR company_id IS NULL)
              ORDER BY company_id ASC NULLS LAST
              LIMIT 1
           ) q ON TRUE
          WHERE qe.vault_id = ev.id AND qe.company_id = $2
          ORDER BY qe.linked_at ASC
          LIMIT 1
       ) lq ON TRUE
      WHERE ev.id = $1 AND ev.company_id = $2`,
    [vaultId, companyId]
  );
  const item = mapRow(vres);
  if (!item) {
    const err = new Error("Vault item not found");
    err.status = 404;
    throw err;
  }

  const day = today || new Date().toISOString().slice(0, 10);
  const runAnalysis = (filePath) => analyzeEvidence({
    provider: provider || null,
    evidenceName: item.title || item.fileName || "Evidence",
    evidenceType: item.storagePath ? "FILE" : "LINK",
    questId: item.linkedQuestId || null,
    moduleId: null,
    requiredEvidence: item.linkedRequiredEvidence || null,
    filePath,
    recurrenceInterval: item.linkedRecurrenceInterval || null,
    today: day,
  });

  const analysis = item.storagePath
    ? await withLocalCopy(companyId, item.storagePath, runAnalysis)
    : await runAnalysis(null);

  const updated = await query(
    `UPDATE evidence_vault
        SET ai_contributor_comments = $1,
            ai_reviewer_comments    = $2,
            ai_gaps        = $3,
            ai_suggestions = $4,
            ai_analyzed_at = NOW(),
            ai_date_warning = $5,
            ai_provider     = $6,
            ai_analyzed_version = (
              SELECT COALESCE(MAX(version_number), 1) FROM evidence_versions WHERE evidence_id = $7
            ),
            ai_analysis_status = NULL,
            updated_at = NOW()
      WHERE id = $7 AND company_id = $8
      RETURNING *`,
    [
      Array.isArray(analysis.contributorComments)
        ? analysis.contributorComments.join("\n")
        : analysis.contributorComments,
      analysis.reviewerComments,
      JSON.stringify(analysis.gaps || []),
      JSON.stringify(analysis.suggestions || []),
      analysis.dateWarning || null,
      provider || null,
      vaultId,
      companyId,
    ]
  );

  return { analysis, vaultItem: mapRow(updated) };
}

/**
 * Fire-and-forget auto-analysis for a vault item, run after an upload or a new
 * file version so a cached result is always waiting for reviewers and auditors.
 *
 * Never throws and never needs awaiting — the caller kicks it off and returns.
 * (A promise is returned for tests; callers ignore it.) Progress is tracked on
 * evidence_vault.ai_analysis_status ('running' -> in flight / interrupted by a
 * restart, 'failed' -> stopped on an error, NULL -> done). The scheduler
 * re-queues any row left 'running' on boot.
 *
 * @param {{ vaultId:number, companyId:number }} args
 * @returns {Promise<void>|undefined}
 */
export function queueEvidenceAnalysis({ vaultId, companyId }) {
  if (!vaultId || !companyId) return undefined;
  if (_running.has(vaultId)) return undefined;
  _running.add(vaultId);

  return (async () => {
    try {
      const settingsRes = await query(
        "SELECT ai_enabled, ai_provider FROM company_settings WHERE company_id = $1",
        [companyId]
      );
      const settings = mapRow(settingsRes);
      if (!settings?.aiEnabled) return;  // AI is opt-in per company

      await query(
        "UPDATE evidence_vault SET ai_analysis_status = 'running' WHERE id = $1 AND company_id = $2",
        [vaultId, companyId]
      );

      // runEvidenceAnalysis persists the result and clears ai_analysis_status.
      await runEvidenceAnalysis({
        vaultId,
        companyId,
        provider: settings?.aiProvider || null,
      });
    } catch (e) {
      console.error(`[evidenceAnalysis] auto-analysis failed for vault=${vaultId}:`, e.message); // nosemgrep
      try {
        await query(
          "UPDATE evidence_vault SET ai_analysis_status = 'failed' WHERE id = $1 AND company_id = $2",
          [vaultId, companyId]
        );
      } catch { /* best effort */ }
    } finally {
      _running.delete(vaultId);
    }
  })();
}

/** Test-only: whether an auto-analysis is currently in flight for a vault id. */
export function _isAnalysisRunning(vaultId) {
  return _running.has(vaultId);
}

/**
 * Re-queue any vault items whose auto-analysis was interrupted by an API restart.
 * Called once from the scheduler on boot.
 */
export async function resumeInterruptedAnalysis() {
  const stuck = await query(
    "SELECT id, company_id FROM evidence_vault WHERE ai_analysis_status IN ('queued', 'running')"
  );
  for (const row of stuck.rows) {
    queueEvidenceAnalysis({ vaultId: row.id, companyId: row.company_id });
  }
  return stuck.rowCount;
}

/**
 * Resolve the evidence_vault item that mirrors a legacy `evidence` row:
 * first by the direct back-pointer, then via any question_evidence link that
 * shares the evidence row's quest_id. Returns the vault id or null.
 */
export async function resolveVaultIdForEvidence(evidenceId, companyId) {
  const direct = await query(
    `SELECT id FROM evidence_vault
      WHERE legacy_evidence_id = $1 AND company_id = $2
      ORDER BY updated_at DESC LIMIT 1`,
    [evidenceId, companyId]
  );
  if (direct.rows.length > 0) return direct.rows[0].id;

  const viaLink = await query(
    `SELECT qe.vault_id
       FROM evidence e
       JOIN question_evidence qe ON qe.quest_id = e.quest_id AND qe.company_id = e.company_id
       JOIN evidence_vault ev ON ev.id = qe.vault_id
      WHERE e.id = $1 AND e.company_id = $2 AND ev.storage_path IS NOT NULL
      ORDER BY ev.updated_at DESC LIMIT 1`,
    [evidenceId, companyId]
  );
  return viaLink.rows[0]?.vault_id ?? null;
}
