import { mapRows, query } from "../db/index.js";
import { notifyReviewers } from "./notifyReviewers.js";
import { writeAuditLog } from "./auditLog.js";
import { sendEmail } from "./email.js";
import { buildEmailHtml } from "./emailTemplate.js";

// F-11 — evidence behind an approved control must not change silently.
//   AUDITED  (in ANY month) -> the evidence is locked for good; callers refuse the
//               change (409 LOCKED). Fresh evidence for a later period is a new item.
//   FINISHED (in any month) -> the change is allowed, but the latest FINISHED approval
//               of each linked control goes back to the reviewer queue (Submitted,
//               "Auto-reverted" badge, audit log, email + in-app notification).
// This deliberately does NOT use the "current effective" carry-forward assessment: a
// newer draft for the current month would displace the approval and dodge the lock
// (independent closure review). It matches the rule delete/unlink already use.
// Linking additional evidence to an approved control is not restricted — it does not
// alter the evidence that was reviewed.

export const AUDITED_LOCK_ERROR = {
  error: "This evidence is locked because a linked control has been audited. Upload new evidence as a separate vault item instead.",
  code: "LOCKED",
};

const APPROVED = `a.review_status IN ('FINISHED', 'AUDITED') AND a.archived_at IS NULL`;

// Every approved assessment (any month) of every control this vault item is linked to.
export async function approvedAssessmentsForVault(companyId, vaultId) {
  if (!vaultId) return [];
  return mapRows(await query(
    `SELECT a.* FROM assessments a
     JOIN question_evidence qe ON qe.company_id = a.company_id AND qe.quest_id = a.quest_id
     WHERE a.company_id = $1 AND qe.vault_id = $2 AND ${APPROVED}`,
    [companyId, vaultId]
  ));
}

// Approved assessments a legacy Tracker evidence row is covered by: the one it is
// attached to (evidence_id), or any approval of its control for the row's month — or for
// a row with no month (or, for an approval with no month, any row) — that was given
// after the row already existed. That is what the
// Review page shows the reviewer/auditor for that assessment (third closure review).
// Rows of another month, or created after the approval, belong to another period and
// stay editable, so recurring controls can keep collecting evidence (fourth review).
// `row` needs quest_id, evidence_id and created_at (omit created_at for a new row).
export async function approvedAssessmentsForEvidenceRow(companyId, row) {
  if (!row?.quest_id) return [];
  return mapRows(await query(
    `SELECT a.* FROM assessments a
     WHERE a.company_id = $1 AND a.quest_id = $2 AND ${APPROVED}
       AND (a.id::text = $3
            OR ($4::timestamptz IS NOT NULL
                AND $4::timestamptz <= COALESCE(a.audited_at, a.reviewed_at, a.updated_at)
                AND (a.month IS NULL OR $5::text IS NULL OR $5::text = a.month)))`,
    [companyId, row.quest_id, row.evidence_id ?? null, row.created_at ?? null, row.month ?? null]
  ));
}

export const hasAuditedApproval = (approved) => approved.some((a) => a.reviewStatus === "AUDITED");

// Latest FINISHED assessment per control, reverted to Submitted.
async function revertLatestFinished({ companyId, joinSql = "", whereSql = "", param, reason }) {
  const latest = mapRows(await query(
    `SELECT DISTINCT ON (a.quest_id) a.id, a.quest_id, a.control_area, a.reviewed_by
     FROM assessments a ${joinSql}
     WHERE a.company_id = $1 AND a.review_status = 'FINISHED' AND a.archived_at IS NULL ${whereSql}
     ORDER BY a.quest_id, a.month DESC NULLS LAST, a.updated_at DESC, a.id DESC`,
    [companyId, param]
  ));
  for (const a of latest) {
    await query(
      `UPDATE assessments
       SET review_status = 'Submitted', auto_reverted_at = NOW(), auto_reverted_reason = $1, updated_at = NOW()
       WHERE id = $2 AND company_id = $3 AND review_status = 'FINISHED'`,
      [reason, a.id, companyId]
    );
    await writeAuditLog({
      companyId,
      action: "ASSESSMENT_AUTO_REVERTED",
      resource: "assessments",
      detail: { assessmentId: a.id, questId: a.questId, reason },
    });
    if (a.reviewedBy) {
      const webUrl = (process.env.WEB_URL || "https://prismgrc.co").replace(/\/$/, "");
      sendEmail({
        to: a.reviewedBy,
        subject: `Re-review needed: ${a.questId}`,
        text: reason,
        html: buildEmailHtml({
          heading: "Approved Evidence Changed — Re-review Needed",
          preheader: `${a.questId} was sent back for review`,
          body: "Evidence linked to a control you approved was changed, so the control has been sent back to the review queue.",
          details: [
            { label: "Question", value: `${a.questId}${a.controlArea ? ` — ${a.controlArea}` : ""}` },
            { label: "Reason", value: reason },
          ],
          cta: { text: "Review in PRISM", url: webUrl },
        }),
      }).catch(() => {});
    }
  }
  return latest.length;
}

function changeReason({ title, change, actor }) {
  const what = title ? `"${title}"` : "Linked evidence";
  return `${what} was changed after approval (${change}) by ${actor || "a user"} on ` +
    `${new Date().toISOString().slice(0, 10)} — the control needs to be re-reviewed.`;
}

export async function reopenReviewForChangedEvidence({ companyId, vaultId, vaultTitle, change, actor }) {
  const reason = changeReason({ title: vaultTitle, change, actor });
  const n = await revertLatestFinished({
    companyId,
    joinSql: "JOIN question_evidence qe ON qe.company_id = a.company_id AND qe.quest_id = a.quest_id AND qe.vault_id = $2",
    param: vaultId,
    reason,
  });
  if (n > 0) {
    await notifyReviewers(companyId, { title: "Approved evidence changed — re-review needed", body: reason, entityType: "vault", entityId: vaultId });
  }
}

export async function reopenReviewForChangedEvidenceRow({ companyId, assessmentIds, title, change, actor }) {
  if (!assessmentIds?.length) return;
  const reason = changeReason({ title, change, actor });
  const n = await revertLatestFinished({ companyId, whereSql: "AND a.id = ANY($2::int[])", param: assessmentIds, reason });
  if (n > 0) {
    await notifyReviewers(companyId, { title: "Approved evidence changed — re-review needed", body: reason, entityType: "evidence", entityId: null });
  }
}
