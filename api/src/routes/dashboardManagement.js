import { Router } from "express";
import { query } from "../db/index.js";
import { authenticate } from "../middleware/auth.js";
import { requireReadOnly } from "../middleware/roles.js";
import { asyncHandler } from "../utils/asyncHandler.js";
import { writeAuditLog } from "../utils/auditLog.js";

const router = Router();

// Shared readiness weighting: 60% implementation, 40% maturity (level / 5).
// `col` is the answer column to switch on (differs per query alias).
const implCase = (col) => `CASE ${col}
  WHEN 'IMPLEMENTED' THEN 1
  WHEN 'NOT_APPLICABLE' THEN 1
  WHEN 'PARTIALLY_IMPLEMENTED' THEN 0.5
  WHEN 'PLANNED' THEN 0.25
  WHEN 'NOT_IMPLEMENTED' THEN 0
  ELSE 0 END`;

// Readiness is measured across the WHOLE control set, counting only approved
// (review_status IN ('FINISHED', 'AUDITED')) assessments — an un-reviewed or un-assessed control
// contributes nothing. This is deliberately a full-framework audit-readiness figure,
// not a "quality of the work done so far" figure.
//
//   implSum  — Σ implementation weight of approved controls (0..totalControls)
//   levelSum — Σ current_level of approved controls that have one recorded
//   total    — total controls in scope
//
// Maturity term = levelSum / (5 * total); when no approved control has a level
// recorded it falls back to the implementation rate so half-filled data isn't
// double-penalised.
const readinessScore = (implSum, levelSum, total) => {
  if (!total || total <= 0) return 0;
  const implRate = implSum / total;
  const maturityRate = levelSum > 0 ? levelSum / (5 * total) : implRate;
  return Math.round(100 * (0.6 * implRate + 0.4 * maturityRate));
};

router.get(
  "/",
  authenticate,
  requireReadOnly(["ADMIN", "LEAD", "CONTRIBUTOR", "REVIEWER", "AUDITOR"]),
  asyncHandler(async (req, res) => {
    if (req.user.role === "AUDITOR") {
      await writeAuditLog({
        userId: req.user.userId,
        companyId: req.user.companyId,
        email: req.user.email,
        action: "READ",
        resource: "dashboard-management",
        ip: req.ip,
      });
    }

    const cid = req.user.companyId;
    let months = Number.parseInt(req.query.months, 10);
    if (!Number.isFinite(months)) months = 12;
    months = Math.max(3, Math.min(24, months));

    const [trendRes, controlRes, heatRes, riskRes, deptRes, evidenceRes, riskCountRes] =
      await Promise.all([
        // Readiness per month across the window. For each month we take the latest
        // APPROVED assessment per control as-of that month (carry-forward), so an
        // approved control stays counted until it is re-assessed — readiness doesn't
        // collapse just because no new work landed in a given calendar month.
        query(
          `WITH months AS (
             SELECT to_char(gs, 'YYYY-MM') AS ym
             FROM generate_series(
               date_trunc('month', NOW()) - (($2::int - 1) * INTERVAL '1 month'),
               date_trunc('month', NOW()),
               INTERVAL '1 month'
             ) gs
           ),
           tot AS (SELECT COUNT(*)::int AS n FROM questions WHERE company_id = $1 AND archived_at IS NULL),
           snap AS (
             SELECT m.ym, s.answer, s.current_level
             FROM months m
             CROSS JOIN LATERAL (
               SELECT DISTINCT ON (a.quest_id) a.quest_id, a.answer, a.current_level
               FROM assessments a
               WHERE a.company_id = $1
                 AND a.archived_at IS NULL
                 AND a.review_status IN ('FINISHED', 'AUDITED')
                 AND a.month <= m.ym
               ORDER BY a.quest_id, a.month DESC, a.updated_at DESC, a.id DESC
             ) s
           )
           SELECT m.ym,
                  COALESCE(SUM(${implCase("snap.answer")}), 0)::float AS impl_sum,
                  COALESCE(SUM(snap.current_level) FILTER (WHERE snap.current_level IS NOT NULL), 0)::float AS level_sum,
                  COUNT(snap.answer)::int AS n,
                  (SELECT n FROM tot) AS total
           FROM months m
           LEFT JOIN snap ON snap.ym = m.ym
           GROUP BY m.ym
           ORDER BY m.ym`,
          [cid, months]
        ),

        // Control status from the latest APPROVED assessment per question
        query(
          `WITH latest AS (
             SELECT DISTINCT ON (quest_id) quest_id, answer
             FROM assessments
             WHERE company_id = $1 AND archived_at IS NULL AND review_status IN ('FINISHED', 'AUDITED')
             ORDER BY quest_id, month DESC NULLS LAST, updated_at DESC
           )
           SELECT
             (SELECT COUNT(*) FROM questions WHERE company_id = $1 AND archived_at IS NULL)::int AS total,
             COUNT(*) FILTER (WHERE answer IN ('IMPLEMENTED', 'NOT_APPLICABLE'))::int     AS compliant,
             COUNT(*) FILTER (WHERE answer IN ('PARTIALLY_IMPLEMENTED', 'PLANNED'))::int  AS partial,
             COUNT(*) FILTER (WHERE answer = 'NOT_IMPLEMENTED')::int                      AS non_compliant
           FROM latest`,
          [cid]
        ),

        // Risk heatmap: likelihood (rows) x impact (cols)
        query(
          `SELECT
             CASE
               WHEN status IN ('resolved', 'suppressed', 'false_positive') THEN 0
               WHEN status = 'acknowledged' THEN 1
               WHEN status = 'open' AND last_detected_at >= NOW() - INTERVAL '30 days' THEN 2
               ELSE 3
             END AS lk,
             CASE severity WHEN 'low' THEN 0 WHEN 'medium' THEN 1 WHEN 'high' THEN 2 WHEN 'critical' THEN 3 END AS im,
             COUNT(*)::int AS n
           FROM findings
           WHERE company_id = $1
           GROUP BY lk, im`,
          [cid]
        ),

        // Top open risks, grouped by title
        query(
          `SELECT title,
                  (ARRAY['low', 'medium', 'high', 'critical'])[
                    MAX(CASE severity WHEN 'low' THEN 1 WHEN 'medium' THEN 2 WHEN 'high' THEN 3 WHEN 'critical' THEN 4 END)
                  ] AS severity,
                  COUNT(*)::int AS count
           FROM findings
           WHERE company_id = $1 AND status IN ('open', 'acknowledged')
           GROUP BY title
           ORDER BY MAX(CASE severity WHEN 'low' THEN 1 WHEN 'medium' THEN 2 WHEN 'high' THEN 3 WHEN 'critical' THEN 4 END) DESC,
                    COUNT(*) DESC
           LIMIT 6`,
          [cid]
        ),

        // Readiness bucketed by the control owner (questions.default_owner).
        // Readiness per owner is measured across ALL of that owner's controls,
        // counting only approved (FINISHED) assessments.
        query(
          `WITH latest AS (
             SELECT DISTINCT ON (quest_id) quest_id, answer AS a_answer, current_level
             FROM assessments
             WHERE company_id = $1 AND archived_at IS NULL AND review_status IN ('FINISHED', 'AUDITED')
             ORDER BY quest_id, month DESC NULLS LAST, updated_at DESC, id DESC
           ),
           -- Once the company has departments, controls bucket by owning
           -- department (a jointly owned control counts in each); until then
           -- by the legacy default_owner text.
           q AS (
             SELECT q.quest_id,
                    COALESCE(
                      d.name,
                      CASE WHEN EXISTS (SELECT 1 FROM departments WHERE company_id = $1) THEN 'Unassigned'
                           ELSE COALESCE(NULLIF(TRIM(q.default_owner), ''), 'Unassigned') END
                    ) AS owner
             FROM questions q
             LEFT JOIN question_departments qd ON qd.company_id = $1 AND qd.quest_id = q.quest_id
             LEFT JOIN departments d ON d.id = qd.department_id
             WHERE q.company_id = $1 AND q.archived_at IS NULL
           )
           SELECT q.owner AS name,
                  COUNT(*)::int AS controls,
                  COUNT(l.quest_id)::int AS approved,
                  COALESCE(SUM(${implCase("l.a_answer")}), 0)::float AS impl_sum,
                  COALESCE(SUM(l.current_level) FILTER (WHERE l.current_level IS NOT NULL), 0)::float AS level_sum
           FROM q
           LEFT JOIN latest l ON l.quest_id = q.quest_id
           GROUP BY q.owner`,
          [cid]
        ),

        // Evidence status
        query(
          `SELECT
             (SELECT COUNT(*) FROM questions WHERE company_id = $1 AND archived_at IS NULL)::int AS total,
             (SELECT COUNT(DISTINCT q.quest_id)
                FROM questions q
                WHERE q.company_id = $1 AND q.archived_at IS NULL
                  AND (EXISTS (SELECT 1 FROM evidence e WHERE e.quest_id = q.quest_id AND e.company_id = $1)
                    OR EXISTS (SELECT 1 FROM question_evidence qe WHERE qe.quest_id = q.quest_id AND qe.company_id = $1)))::int AS collected,
             (SELECT COUNT(*)
                FROM questions q
                WHERE q.company_id = $1 AND q.archived_at IS NULL
                  AND q.next_due_date IS NOT NULL AND q.next_due_date < NOW()
                  AND NOT EXISTS (SELECT 1 FROM evidence e WHERE e.quest_id = q.quest_id AND e.company_id = $1)
                  AND NOT EXISTS (SELECT 1 FROM question_evidence qe WHERE qe.quest_id = q.quest_id AND qe.company_id = $1))::int AS overdue`,
          [cid]
        ),

        // Open-risk headline counts
        query(
          `SELECT
             COUNT(*) FILTER (WHERE status IN ('open', 'acknowledged'))::int AS open_risks,
             COUNT(*) FILTER (WHERE status IN ('open', 'acknowledged') AND severity IN ('critical', 'high'))::int AS high_risks
           FROM findings
           WHERE company_id = $1`,
          [cid]
        ),
      ]);

    // ----- Readiness trend -----
    // value is null only while no control has been approved as-of that month, so the
    // chart shows a gap rather than a misleading flat zero for pre-history months.
    const readinessTrend = trendRes.rows.map((r) => ({
      month: r.ym,
      value:
        r.n > 0
          ? readinessScore(Number(r.impl_sum), Number(r.level_sum), Number(r.total))
          : null,
    }));
    const nonNull = readinessTrend.filter((p) => p.value !== null);
    const readiness = nonNull.length ? nonNull[nonNull.length - 1].value : 0;
    const readinessDelta =
      nonNull.length >= 2 ? readiness - nonNull[nonNull.length - 2].value : 0;

    // ----- Control status -----
    const c = controlRes.rows[0] || {};
    const total = c.total || 0;
    const compliant = c.compliant || 0;
    const partial = c.partial || 0;
    const nonCompliant = c.non_compliant || 0;
    const controlStatus = {
      total,
      compliant,
      partial,
      nonCompliant,
      notAssessed: Math.max(0, total - compliant - partial - nonCompliant),
    };

    // ----- Risk heatmap -----
    const riskHeatmap = [
      [0, 0, 0, 0],
      [0, 0, 0, 0],
      [0, 0, 0, 0],
      [0, 0, 0, 0],
    ];
    for (const row of heatRes.rows) {
      if (row.lk != null && row.im != null) riskHeatmap[row.lk][row.im] = row.n;
    }

    // ----- Top risks -----
    const topRisks = riskRes.rows.map((r) => ({
      title: r.title,
      severity: r.severity,
      count: r.count,
    }));

    // ----- Departments (by control owner) -----
    // `approved` = controls with a FINISHED assessment; readiness is over the owner's
    // full control count. Exposed as `assessed` for response back-compat.
    const departments = deptRes.rows
      .map((r) => ({
        name: r.name,
        controls: r.controls,
        assessed: r.approved,
        readiness:
          r.approved > 0
            ? readinessScore(Number(r.impl_sum), Number(r.level_sum), Number(r.controls))
            : 0,
      }))
      .sort((a, b) => b.readiness - a.readiness || a.name.localeCompare(b.name));
    const departmentCount = departments.filter((d) => d.name !== "Unassigned").length;

    // ----- Evidence status -----
    const ev = evidenceRes.rows[0] || {};
    const evTotal = ev.total || 0;
    const collected = ev.collected || 0;
    const overdue = ev.overdue || 0;
    const evidenceStatus = {
      collected,
      pending: Math.max(0, evTotal - collected - overdue),
      overdue,
    };

    const rc = riskCountRes.rows[0] || {};

    res.json({
      readiness,
      readinessDelta,
      readinessTrend,
      controlStatus,
      riskHeatmap,
      riskHeatmapAxes: {
        likelihood: ["Rare", "Unlikely", "Likely", "Frequent"],
        impact: ["Low", "Minor", "Major", "Severe"],
      },
      topRisks,
      departments,
      evidenceStatus,
      openRisks: rc.open_risks || 0,
      highRisks: rc.high_risks || 0,
      departmentCount,
    });
  })
);

export default router;
