// Evidence behind an AUDITED assessment stays valid for the whole period that audit
// covers, even if it would otherwise lapse part-way through (its "review due" date, or
// an automated item going stale/expired).
//
// Coverage of an AUDITED assessment = the start of its month through one recurrence
// interval of the control (a quarterly control audited for 2026-07 covers
// 1 Jul – 30 Sep), capped at one interval after the sign-off so a far-future month
// cannot hold evidence open indefinitely. Only evidence already linked when the audit
// was signed off counts (audited_at).
//
// The hold is applied where evidence is READ (vault responses, dashboard coverage),
// per control — automated_evidence_items.status keeps reporting real freshness, so an
// item linked to several controls is only held valid for the ones actually audited.

const INTERVAL_SQL = (q) => `CASE LOWER(COALESCE(NULLIF(${q}.recurrence_interval, ''), 'monthly'))
      WHEN 'weekly'      THEN INTERVAL '7 days'
      WHEN 'fortnightly' THEN INTERVAL '14 days'
      WHEN 'quarterly'   THEN INTERVAL '3 months'
      WHEN 'semi-annual' THEN INTERVAL '6 months'
      WHEN 'annual'      THEN INTERVAL '1 year'
      ELSE INTERVAL '1 month'
    END`;

const VALID_MONTH_SQL = `'^[0-9]{4}-(0[1-9]|1[0-2])$'`;

// Recurrence interval of assessment `a`'s control (tenant row before the global one).
const intervalOf = (a) => `COALESCE((
    SELECT ${INTERVAL_SQL("q_ac")} FROM questions q_ac
    WHERE q_ac.quest_id = ${a}.quest_id AND (q_ac.company_id = ${a}.company_id OR q_ac.company_id IS NULL)
    ORDER BY q_ac.company_id ASC NULLS LAST, q_ac.id ASC LIMIT 1
  ), INTERVAL '1 month')`;

// Last day (DATE) of the period AUDITED assessment `a` covers, from the control's
// current interval. It is frozen onto assessments.audit_period_end when the audit is
// signed off (and before the control's recurrence changes), so editing the control
// afterwards can't stretch a period the auditor never covered (closure review C).
export const auditPeriodEndSql = (a) => `(CASE WHEN ${a}.month ~ ${VALID_MONTH_SQL} AND ${a}.audited_at IS NOT NULL
    THEN LEAST((${a}.month || '-01')::date + ${intervalOf(a)}, ${a}.audited_at::date + ${intervalOf(a)})::date - 1 END)`;

// Last day (DATE, inclusive) a vault item is kept valid by an audit, or NULL. Cast to
// ::text when returning it to clients — node-pg turns a DATE into a local-midnight Date.
// `questExpr` (optional) restricts it to one control. All arguments are SQL expressions.
// Only audits with a sign-off time count: a legacy row's updated_at moves on any edit,
// so it can't anchor which evidence the auditor saw (init.sql backfills audited_at).
export const auditedThroughSql = (vaultIdExpr, companyExpr, questExpr = null) => `(
  SELECT MAX(COALESCE(a.audit_period_end, ${auditPeriodEndSql("a")}))
  FROM question_evidence qe_ac
  JOIN assessments a
    ON a.company_id = qe_ac.company_id AND a.quest_id = qe_ac.quest_id
   AND a.review_status = 'AUDITED' AND a.archived_at IS NULL
   AND a.month ~ ${VALID_MONTH_SQL}
   AND a.audited_at IS NOT NULL
   AND qe_ac.linked_at <= a.audited_at
  WHERE qe_ac.vault_id = ${vaultIdExpr} AND qe_ac.company_id = ${companyExpr}
    ${questExpr ? `AND qe_ac.quest_id = ${questExpr}` : ""}
)`;

// Freeze the audited period of this company's AUDITED assessments (optionally one
// control) that don't have it yet. Run inside the caller's transaction.
export const freezeAuditPeriodsSql = (companyParam, questParam = null) =>
  `UPDATE assessments a SET audit_period_end = ${auditPeriodEndSql("a")}
   WHERE a.company_id = ${companyParam} AND a.review_status = 'AUDITED' AND a.audit_period_end IS NULL
     ${questParam ? `AND a.quest_id = ${questParam}` : ""}`;

// TRUE when this vault item is still inside an audited period for this control.
export const heldByAuditSql = (vaultIdExpr, companyExpr, questExpr) =>
  `COALESCE(${auditedThroughSql(vaultIdExpr, companyExpr, questExpr)}, DATE '1900-01-01') >= CURRENT_DATE`;
