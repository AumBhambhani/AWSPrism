import { Router } from "express";
import { query } from "../db/index.js";
import { effectiveModules } from "../db/effectiveRows.js";
import { heldByAuditSql } from "../utils/auditCoverage.js";
import { authenticate } from "../middleware/auth.js";
import { requireReadOnly } from "../middleware/roles.js";
import { asyncHandler } from "../utils/asyncHandler.js";
import { writeAuditLog } from "../utils/auditLog.js";

const router = Router();

router.get("/", authenticate, requireReadOnly(["ADMIN", "LEAD", "CONTRIBUTOR", "REVIEWER", "AUDITOR"]), asyncHandler(async (req, res) => {
  if (req.user.role === "AUDITOR") {
    await writeAuditLog({ userId: req.user.userId, companyId: req.user.companyId, email: req.user.email, action: "READ", resource: "dashboard", ip: req.ip });
  }
  const cid = req.user.companyId;
  const { month, priority, tag, owner, status, framework } = req.query;
  const hasFilter = !!(priority || tag || owner || status || framework);

  if (month && !/^\d{4}-(0[1-9]|1[0-2])$/.test(month)) {
    return res.status(400).json({ error: "Invalid month — expected YYYY-MM" });
  }

  // Step 1: Get filtered quest IDs when filters are active.
  // The ?framework= param scopes to questions mapped to that framework via
  // question_framework_controls; all other filters narrow by question attributes.
  let filteredQuestIds = null;
  if (hasFilter) {
    let filterSql;
    let filterParams;
    let idx;

    if (framework) {
      // Scope to questions that belong to this framework for the company
      filterSql = `SELECT DISTINCT q.quest_id FROM questions q
                   JOIN question_framework_controls qfc
                     ON qfc.quest_id = q.quest_id AND qfc.company_id = $1 AND qfc.framework_key = $2
                   WHERE q.company_id = $1 AND q.archived_at IS NULL`;
      filterParams = [cid, framework];
      idx = 3;
    } else {
      filterSql = "SELECT q.quest_id FROM questions q WHERE q.company_id = $1 AND q.archived_at IS NULL";
      filterParams = [cid];
      idx = 2;
    }

    if (priority) {
      filterSql += ` AND q.priority = $${idx++}`;
      filterParams.push(priority);
    }
    if (tag) {
      filterSql += ` AND q.tags ILIKE '%' || $${idx++} || '%'`;
      filterParams.push(tag);
    }
    if (owner) {
      filterSql += ` AND q.default_owner ILIKE $${idx++}`;
      filterParams.push(owner);
    }
    if (status) {
      // Filter by latest assessment answer for this company
      filterSql += ` AND EXISTS (
        SELECT 1 FROM assessments a
        WHERE a.quest_id = q.quest_id AND a.company_id = $1
          AND UPPER(a.answer) = $${idx++}
      )`;
      filterParams.push(status.toUpperCase());
    }
    const filterResult = await query(filterSql, filterParams);
    filteredQuestIds = filterResult.rows.map(r => r.quest_id);

    if (filteredQuestIds.length === 0) {
      return res.json({
        overall: { total: 0, assessed: 0, finished: 0 },
        answerDistribution: [],
        moduleCompletion: [],
        evidenceCoverage: [],
        actionStatus: [],
        maturityDistribution: { l1: 0, l2: 0, l3: 0, l4: 0, l5: 0 },
        overdueQuestions: 0
      });
    }
  }

  // Build params helpers
  // For month queries: [cid, month, ...optionalQuestIds]
  // For non-month queries: [cid, ...optionalQuestIds]
  const monthParams = month ? [cid, month] : [cid];
  const assessParams = hasFilter ? [...monthParams, filteredQuestIds] : monthParams;
  const qfIdx = assessParams.length; // position of quest ids array param
  const questFilter = hasFilter ? `AND quest_id = ANY($${qfIdx})` : "";

  const cidParams = hasFilter ? [cid, filteredQuestIds] : [cid];
  const cidQf = hasFilter ? `AND quest_id = ANY($2)` : "";

  const monthCondition = month ? "AND month = $2" : "";

  // Carry-forward: the set of "effective" assessments as-of `month`, mirroring the
  // web tracker (getEffectiveAssessment / carriesForwardTo in web/src/utils/
  // carryForward.js). For each quest: the assessment dated `month` if one exists,
  // otherwise the most recent prior FINISHED assessment whose recurrence window
  // — the question's next_due_date, or the completion date plus the recurrence
  // interval — has not elapsed by the first day of `month`. Used only for the
  // month-scoped views; the all-time view keeps its existing semantics.
  const effCte = `eff AS (
      SELECT DISTINCT ON (a.quest_id) a.*
      FROM assessments a
      JOIN questions q ON q.company_id = a.company_id AND q.quest_id = a.quest_id
      WHERE a.company_id = $1
        AND a.archived_at IS NULL AND q.archived_at IS NULL
        AND a.month IS NOT NULL AND a.month <= $2
        AND (
          a.month = $2
          OR (
            a.review_status IN ('FINISHED', 'AUDITED')
            AND COALESCE(LOWER(NULLIF(q.recurrence_interval, '')), 'none') <> 'none'
            AND COALESCE(
                  q.next_due_date,
                  COALESCE(a.reviewed_at, a.updated_at, a.created_at, (a.month || '-01')::timestamptz)
                    + CASE LOWER(COALESCE(NULLIF(q.recurrence_interval, ''), 'monthly'))
                        WHEN 'weekly'      THEN INTERVAL '7 days'
                        WHEN 'fortnightly' THEN INTERVAL '14 days'
                        WHEN 'quarterly'   THEN INTERVAL '3 months'
                        WHEN 'semi-annual' THEN INTERVAL '6 months'
                        WHEN 'annual'      THEN INTERVAL '1 year'
                        ELSE INTERVAL '1 month'
                      END
                ) >= ($2 || '-01')::timestamptz
          )
        )
      ORDER BY a.quest_id, (a.month = $2) DESC, a.month DESC, a.updated_at DESC, a.id DESC
    )`;

  const [totalQ, assessed, finished, answerDist, moduleCompletion, evidenceCoverage, actionStatus, maturityDist, overdueQuestions, notesCount, reviewerNotesCount, noNotesCount, openRequests, overdueRequests, completedRequests, requestsByUser, vaultTotalVersions, vaultUpdatedThisMonth, vaultLatestModified, scoreEligible, automatedCoverage] = await Promise.all([
    // Total questions (filtered by priority/tag)
    hasFilter
      ? query("SELECT $1::int AS n", [filteredQuestIds.length])
      : query("SELECT COUNT(*) AS n FROM questions WHERE company_id = $1 AND archived_at IS NULL", [cid]),

    // Assessed count
    query(
      month
        ? `WITH ${effCte} SELECT COUNT(DISTINCT quest_id) AS n FROM eff WHERE TRUE ${questFilter}`
        : `SELECT COUNT(DISTINCT quest_id) AS n FROM assessments WHERE company_id = $1 AND archived_at IS NULL ${questFilter}`,
      assessParams
    ),

    // Finished count (carry-forward applied for the month view)
    query(
      month
        ? `WITH ${effCte} SELECT COUNT(DISTINCT quest_id) AS n FROM eff WHERE review_status IN ('FINISHED', 'AUDITED') ${questFilter}`
        : `SELECT COUNT(DISTINCT quest_id) AS n FROM assessments WHERE company_id = $1 AND archived_at IS NULL AND review_status IN ('FINISHED', 'AUDITED') ${hasFilter ? "AND quest_id = ANY($2)" : ""}`,
      assessParams
    ),

    // Answer distribution
    query(
      month
        ? `WITH ${effCte} SELECT answer, COUNT(*) AS n FROM eff WHERE TRUE ${questFilter} GROUP BY answer`
        : `SELECT answer, COUNT(*) AS n FROM assessments WHERE company_id = $1 AND archived_at IS NULL ${questFilter} GROUP BY answer`,
      assessParams
    ),

    // Module completion
    hasFilter
      ? query(
          month
            ? `WITH ${effCte} SELECT m.module_id, m.name,
                (SELECT COUNT(*) FROM questions WHERE company_id = $1 AND module_id = m.module_id AND quest_id = ANY($3) AND archived_at IS NULL) AS total_quests,
                COUNT(DISTINCT a.quest_id) FILTER (WHERE a.review_status IN ('FINISHED', 'AUDITED')) AS finished,
                COUNT(DISTINCT a.quest_id) AS assessed
              FROM ${effectiveModules("$1")} m
              LEFT JOIN eff a ON a.module_id = m.module_id AND a.quest_id = ANY($3)
              GROUP BY m.module_id, m.name, m.sort_order
              HAVING (SELECT COUNT(*) FROM questions WHERE company_id = $1 AND module_id = m.module_id AND quest_id = ANY($3) AND archived_at IS NULL) > 0
              ORDER BY m.sort_order ASC, m.module_id ASC`
            : `SELECT m.module_id, m.name,
                (SELECT COUNT(*) FROM questions WHERE company_id = $1 AND module_id = m.module_id AND quest_id = ANY($2) AND archived_at IS NULL) AS total_quests,
                COUNT(DISTINCT a.quest_id) FILTER (WHERE a.review_status IN ('FINISHED', 'AUDITED')) AS finished,
                COUNT(DISTINCT a.quest_id) AS assessed
              FROM ${effectiveModules("$1")} m
              LEFT JOIN assessments a ON a.module_id = m.module_id AND a.company_id = $1 AND a.quest_id = ANY($2)
              GROUP BY m.module_id, m.name, m.sort_order
              HAVING (SELECT COUNT(*) FROM questions WHERE company_id = $1 AND module_id = m.module_id AND quest_id = ANY($2) AND archived_at IS NULL) > 0
              ORDER BY m.sort_order ASC, m.module_id ASC`,
          assessParams
        )
      : query(
          month
            ? `WITH ${effCte} SELECT m.module_id, m.name,
                (SELECT COUNT(*) FROM questions WHERE company_id = $1 AND module_id = m.module_id AND archived_at IS NULL) AS total_quests,
                COUNT(DISTINCT a.quest_id) FILTER (WHERE a.review_status IN ('FINISHED', 'AUDITED')) AS finished,
                COUNT(DISTINCT a.quest_id) AS assessed
              FROM ${effectiveModules("$1")} m
              LEFT JOIN eff a ON a.module_id = m.module_id
              GROUP BY m.module_id, m.name, m.sort_order
              ORDER BY m.sort_order ASC, m.module_id ASC`
            : `SELECT m.module_id, m.name,
                (SELECT COUNT(*) FROM questions WHERE company_id = $1 AND module_id = m.module_id AND archived_at IS NULL) AS total_quests,
                COUNT(DISTINCT a.quest_id) FILTER (WHERE a.review_status IN ('FINISHED', 'AUDITED')) AS finished,
                COUNT(DISTINCT a.quest_id) AS assessed
              FROM ${effectiveModules("$1")} m
              LEFT JOIN assessments a ON a.module_id = m.module_id AND a.company_id = $1
              GROUP BY m.module_id, m.name, m.sort_order
              ORDER BY m.sort_order ASC, m.module_id ASC`,
          monthParams
        ),

    // Evidence coverage — counts a question as covered if it has evidence OR a vault link
    hasFilter
      ? query(
          month
            ? `SELECT q.module_id,
                COUNT(DISTINCT q.quest_id) FILTER (WHERE (
                  EXISTS (SELECT 1 FROM evidence e WHERE e.quest_id = q.quest_id AND e.company_id = $1 AND e.month = $2)
                  OR EXISTS (SELECT 1 FROM question_evidence qe WHERE qe.quest_id = q.quest_id AND qe.company_id = $1)
                )) AS covered,
                COUNT(DISTINCT q.quest_id) AS total
              FROM questions q
              WHERE q.company_id = $1 AND q.quest_id = ANY($3) AND q.archived_at IS NULL
              GROUP BY q.module_id
              ORDER BY q.module_id`
            : `SELECT q.module_id,
                COUNT(DISTINCT q.quest_id) FILTER (WHERE (
                  EXISTS (SELECT 1 FROM evidence e WHERE e.quest_id = q.quest_id AND e.company_id = $1)
                  OR EXISTS (SELECT 1 FROM question_evidence qe WHERE qe.quest_id = q.quest_id AND qe.company_id = $1)
                )) AS covered,
                COUNT(DISTINCT q.quest_id) AS total
              FROM questions q
              WHERE q.company_id = $1 AND q.quest_id = ANY($2) AND q.archived_at IS NULL
              GROUP BY q.module_id
              ORDER BY q.module_id`,
          assessParams
        )
      : query(
          month
            ? `SELECT q.module_id,
                COUNT(DISTINCT q.quest_id) FILTER (WHERE (
                  EXISTS (SELECT 1 FROM evidence e WHERE e.quest_id = q.quest_id AND e.company_id = $1 AND e.month = $2)
                  OR EXISTS (SELECT 1 FROM question_evidence qe WHERE qe.quest_id = q.quest_id AND qe.company_id = $1)
                )) AS covered,
                COUNT(DISTINCT q.quest_id) AS total
              FROM questions q
              WHERE q.company_id = $1 AND q.archived_at IS NULL
              GROUP BY q.module_id
              ORDER BY q.module_id`
            : `SELECT q.module_id,
                COUNT(DISTINCT q.quest_id) FILTER (WHERE (
                  EXISTS (SELECT 1 FROM evidence e WHERE e.quest_id = q.quest_id AND e.company_id = $1)
                  OR EXISTS (SELECT 1 FROM question_evidence qe WHERE qe.quest_id = q.quest_id AND qe.company_id = $1)
                )) AS covered,
                COUNT(DISTINCT q.quest_id) AS total
              FROM questions q
              WHERE q.company_id = $1 AND q.archived_at IS NULL
              GROUP BY q.module_id
              ORDER BY q.module_id`,
          monthParams
        ),

    // Action status
    query(
      `SELECT COALESCE(UPPER(status), 'OPEN') AS status, COUNT(*) AS n FROM actions WHERE company_id = $1 ${cidQf} GROUP BY COALESCE(UPPER(status), 'OPEN')`,
      cidParams
    ),

    // Maturity distribution
    query(
      `${month ? `WITH ${effCte} ` : ""}SELECT
        COUNT(*) FILTER (WHERE current_level = 1) AS l1,
        COUNT(*) FILTER (WHERE current_level = 2) AS l2,
        COUNT(*) FILTER (WHERE current_level = 3) AS l3,
        COUNT(*) FILTER (WHERE current_level = 4) AS l4,
        COUNT(*) FILTER (WHERE current_level = 5) AS l5
      FROM ${month ? "eff" : "assessments"}
      WHERE ${month ? "TRUE" : "company_id = $1 AND archived_at IS NULL"} ${questFilter}`,
      assessParams
    ),

    // Overdue questions
    hasFilter
      ? query(
          "SELECT COUNT(*) AS n FROM questions WHERE company_id = $1 AND quest_id = ANY($2) AND next_due_date IS NOT NULL AND next_due_date < NOW() AND archived_at IS NULL",
          [cid, filteredQuestIds]
        )
      : query(
          "SELECT COUNT(*) AS n FROM questions WHERE company_id = $1 AND next_due_date IS NOT NULL AND next_due_date < NOW() AND archived_at IS NULL",
          [cid]
        ),

    // Questions with internal notes (comments)
    query(
      `SELECT COUNT(DISTINCT quest_id)::INT AS n FROM assessments WHERE company_id = $1 AND archived_at IS NULL AND comments IS NOT NULL AND comments <> '' ${cidQf}`,
      cidParams
    ),

    // Questions with reviewer notes
    query(
      `SELECT COUNT(DISTINCT quest_id)::INT AS n FROM assessments WHERE company_id = $1 AND archived_at IS NULL AND reviewer_notes IS NOT NULL AND reviewer_notes <> '' ${cidQf}`,
      cidParams
    ),

    // Questions without any notes
    query(
      `SELECT COUNT(DISTINCT q.quest_id)::INT AS n
       FROM questions q
       WHERE q.company_id = $1 AND q.archived_at IS NULL ${cidQf}
       AND NOT EXISTS (
         SELECT 1 FROM assessments a
         WHERE a.company_id = $1 AND a.quest_id = q.quest_id
         AND (
           (a.comments IS NOT NULL AND a.comments <> '')
           OR (a.reviewer_notes IS NOT NULL AND a.reviewer_notes <> '')
         )
       )`,
      cidParams
    ),

    // Open evidence requests
    query(
      "SELECT COUNT(*)::INT AS n FROM evidence_requests WHERE company_id = $1 AND status NOT IN ('Completed', 'Cancelled')",
      [cid]
    ),

    // Overdue evidence requests
    query(
      "SELECT COUNT(*)::INT AS n FROM evidence_requests WHERE company_id = $1 AND status NOT IN ('Completed', 'Cancelled') AND due_date IS NOT NULL AND due_date < CURRENT_DATE",
      [cid]
    ),

    // Completed evidence requests
    query(
      "SELECT COUNT(*)::INT AS n FROM evidence_requests WHERE company_id = $1 AND status = 'Completed'",
      [cid]
    ),

    // Requests by assignee (top 10)
    query(
      `SELECT COALESCE(u.full_name, u.email) AS name, COUNT(er.id)::INT AS n
       FROM evidence_requests er
       JOIN users u ON u.id = er.assignee_id AND u.company_id = er.company_id
       WHERE er.company_id = $1 AND er.assignee_id IS NOT NULL
       GROUP BY u.id, u.full_name, u.email
       ORDER BY n DESC LIMIT 10`,
      [cid]
    ),

    // Total evidence versions across all vault items for this company
    query(
      `SELECT COUNT(ev.id)::INT AS n
       FROM evidence_versions ev
       JOIN evidence_vault vault ON vault.id = ev.evidence_id
       WHERE vault.company_id = $1`,
      [cid]
    ),

    // Vault items that had a new version uploaded this calendar month
    query(
      `SELECT COUNT(DISTINCT ev.evidence_id)::INT AS n
       FROM evidence_versions ev
       JOIN evidence_vault vault ON vault.id = ev.evidence_id
       WHERE vault.company_id = $1
         AND DATE_TRUNC('month', ev.uploaded_at) = DATE_TRUNC('month', NOW())`,
      [cid]
    ),

    // Most recently modified vault item (latest version uploaded)
    query(
      `SELECT vault.title, ev.uploaded_at
       FROM evidence_versions ev
       JOIN evidence_vault vault ON vault.id = ev.evidence_id
       WHERE vault.company_id = $1
       ORDER BY ev.uploaded_at DESC LIMIT 1`,
      [cid]
    ),

    // Score-eligible controls (IMPLEMENTED, maturity >= 3, score_eligible = true)
    query(
      month
        ? `WITH ${effCte} SELECT COUNT(DISTINCT quest_id)::INT AS n FROM eff WHERE score_eligible = TRUE ${questFilter}`
        : `SELECT COUNT(DISTINCT quest_id)::INT AS n FROM assessments WHERE company_id = $1 AND archived_at IS NULL ${questFilter} AND score_eligible = TRUE`,
      assessParams
    ),

    // Automated coverage: controls satisfied by at least one fresh automated evidence item.
    // A question is matched to a test_control_mappings row (test_key, framework,
    // iso_reference) two ways, unioned in the LATERAL subquery `m`:
    //   1. legacy columns — the question's own iso_reference (ISO27001 clause rows) or
    //      control_area (DPDPA rows, whose iso_reference is a whole subsection shared by
    //      many control areas; see testDefinitionSync.js) equals the mapping ref.
    //   2. canonical crosswalk — question_framework_controls(framework_key,
    //      control_reference) equals the mapping's (framework, iso_reference), so a
    //      GDPR / SOC 2 / … question from a framework import is covered by a connector's
    //      evidence even when its legacy columns don't carry the ISO clause.
    // Returns one row per covered question (not just a count) so the dashboard widget can
    // drill down into exactly which questions were satisfied and by which connector/test.
    query(
      hasFilter
        ? `SELECT q.quest_id, q.module_id, q.module_name, q.control_area, q.baseline_question,
                  array_agg(DISTINCT aei.test_key ORDER BY aei.test_key) AS test_keys,
                  array_agg(DISTINCT at.integration_key ORDER BY at.integration_key) AS integration_keys
           FROM questions q
           JOIN LATERAL (
             SELECT tcm.test_key FROM test_control_mappings tcm
              WHERE tcm.iso_reference IN (q.iso_reference, q.control_area)
             UNION
             SELECT tcm.test_key FROM test_control_mappings tcm
               JOIN question_framework_controls qfc
                 ON qfc.company_id = q.company_id AND qfc.quest_id = q.quest_id
                AND qfc.framework_key = tcm.framework AND qfc.control_reference = tcm.iso_reference
           ) m ON TRUE
           JOIN automated_evidence_items aei ON aei.test_key = m.test_key AND aei.company_id = q.company_id
             AND (aei.status = 'fresh'
                  OR (aei.evidence_vault_id IS NOT NULL AND ${heldByAuditSql("aei.evidence_vault_id", "q.company_id", "q.quest_id")}))
           JOIN automated_tests at ON at.test_key = m.test_key
           WHERE q.company_id = $1 AND q.quest_id = ANY($2) AND q.archived_at IS NULL
           GROUP BY q.quest_id, q.module_id, q.module_name, q.control_area, q.baseline_question
           ORDER BY q.module_id, q.quest_id`
        : `SELECT q.quest_id, q.module_id, q.module_name, q.control_area, q.baseline_question,
                  array_agg(DISTINCT aei.test_key ORDER BY aei.test_key) AS test_keys,
                  array_agg(DISTINCT at.integration_key ORDER BY at.integration_key) AS integration_keys
           FROM questions q
           JOIN LATERAL (
             SELECT tcm.test_key FROM test_control_mappings tcm
              WHERE tcm.iso_reference IN (q.iso_reference, q.control_area)
             UNION
             SELECT tcm.test_key FROM test_control_mappings tcm
               JOIN question_framework_controls qfc
                 ON qfc.company_id = q.company_id AND qfc.quest_id = q.quest_id
                AND qfc.framework_key = tcm.framework AND qfc.control_reference = tcm.iso_reference
           ) m ON TRUE
           JOIN automated_evidence_items aei ON aei.test_key = m.test_key AND aei.company_id = q.company_id
             AND (aei.status = 'fresh'
                  OR (aei.evidence_vault_id IS NOT NULL AND ${heldByAuditSql("aei.evidence_vault_id", "q.company_id", "q.quest_id")}))
           JOIN automated_tests at ON at.test_key = m.test_key
           WHERE q.company_id = $1 AND q.archived_at IS NULL
           GROUP BY q.quest_id, q.module_id, q.module_name, q.control_area, q.baseline_question
           ORDER BY q.module_id, q.quest_id`,
      hasFilter ? [cid, filteredQuestIds] : [cid]
    )
  ]);

  const [recentlyReviewed, rejectedControls] = await Promise.all([
    query(
      `SELECT a.id, a.quest_id, a.module_id, a.review_status,
              a.reviewed_by, a.reviewed_at, a.reviewer_notes,
              a.audited_by, a.audited_at, a.auditor_notes,
              COALESCE(q.control_area, a.control_area) AS control_area
       FROM assessments a
       LEFT JOIN questions q ON q.quest_id = a.quest_id AND q.company_id = a.company_id
       WHERE a.company_id = $1
         AND a.review_status IN ('FINISHED', 'AUDITED', 'WIP')
         AND (a.reviewed_at IS NOT NULL OR a.audited_at IS NOT NULL)
       ORDER BY GREATEST(
         COALESCE(a.reviewed_at, '2000-01-01'::timestamptz),
         COALESCE(a.audited_at, '2000-01-01'::timestamptz)
       ) DESC
       LIMIT 200`,
      [cid]
    ),
    query(
      `SELECT a.id, a.quest_id, a.module_id,
              a.reviewer_notes, a.auditor_notes,
              a.reviewed_by, a.reviewed_at,
              a.audited_by, a.audited_at,
              COALESCE(q.control_area, a.control_area) AS control_area
       FROM assessments a
       LEFT JOIN questions q ON q.quest_id = a.quest_id AND q.company_id = a.company_id
       WHERE a.company_id = $1
         AND a.review_status = 'WIP'
         AND (
           (a.reviewer_notes IS NOT NULL AND a.reviewer_notes <> '')
           OR (a.auditor_notes IS NOT NULL AND a.auditor_notes <> '')
         )
       ORDER BY GREATEST(
         COALESCE(a.reviewed_at, '2000-01-01'::timestamptz),
         COALESCE(a.audited_at, '2000-01-01'::timestamptz)
       ) DESC
       LIMIT 300`,
      [cid]
    )
  ]);

  // Auditor-only: how many in-scope controls have actually been audited
  // (AUDITED) vs. reviewed and awaiting the auditor's own sign-off (FINISHED),
  // one bucket per quest_id using its highest-ranked assessment so a control
  // re-submitted after audit isn't double-counted.
  let auditorStats = null;
  if (req.user.role === "AUDITOR") {
    const ranked = await query(
      `SELECT
         COUNT(*) FILTER (WHERE review_status = 'AUDITED')  AS audited,
         COUNT(*) FILTER (WHERE review_status = 'FINISHED') AS awaiting_audit
       FROM (
         SELECT DISTINCT ON (quest_id) quest_id, review_status
         FROM assessments
         WHERE company_id = $1 ${cidQf}
         ORDER BY quest_id,
           CASE review_status WHEN 'AUDITED' THEN 3 WHEN 'FINISHED' THEN 2 WHEN 'Submitted' THEN 1 ELSE 0 END DESC,
           month DESC NULLS LAST, updated_at DESC NULLS LAST, id DESC
       ) latest`,
      cidParams
    );
    auditorStats = {
      audited: parseInt(ranked.rows[0]?.audited) || 0,
      awaitingAudit: parseInt(ranked.rows[0]?.awaiting_audit) || 0,
    };
  }

  res.json({
    ...(auditorStats ? { auditorStats } : {}),
    overall: {
      total: hasFilter ? filteredQuestIds.length : parseInt(totalQ.rows[0].n),
      assessed: parseInt(assessed.rows[0].n),
      finished: parseInt(finished.rows[0].n)
    },
    answerDistribution: answerDist.rows.map(r => ({ answer: r.answer || "WIP", count: parseInt(r.n) })),
    moduleCompletion: moduleCompletion.rows.map(r => ({
      moduleId: r.module_id,
      name: r.name,
      total: parseInt(r.total_quests) || 0,
      assessed: parseInt(r.assessed),
      finished: parseInt(r.finished)
    })),
    evidenceCoverage: evidenceCoverage.rows.map(r => ({
      moduleId: r.module_id,
      covered: parseInt(r.covered),
      total: parseInt(r.total)
    })),
    actionStatus: actionStatus.rows.map(r => ({ status: r.status || "OPEN", count: parseInt(r.n) })),
    maturityDistribution: {
      l1: parseInt(maturityDist.rows[0]?.l1) || 0,
      l2: parseInt(maturityDist.rows[0]?.l2) || 0,
      l3: parseInt(maturityDist.rows[0]?.l3) || 0,
      l4: parseInt(maturityDist.rows[0]?.l4) || 0,
      l5: parseInt(maturityDist.rows[0]?.l5) || 0,
    },
    overdueQuestions: parseInt(overdueQuestions.rows[0].n) || 0,
    notesMetrics: {
      withNotes: parseInt(notesCount.rows[0].n) || 0,
      withReviewerNotes: parseInt(reviewerNotesCount.rows[0].n) || 0,
      withoutAnyNotes: parseInt(noNotesCount.rows[0].n) || 0
    },
    requestMetrics: {
      open: parseInt(openRequests.rows[0]?.n) || 0,
      overdue: parseInt(overdueRequests.rows[0]?.n) || 0,
      completed: parseInt(completedRequests.rows[0]?.n) || 0,
      byUser: requestsByUser.rows.map(r => ({ name: r.name, count: r.n }))
    },
    vaultMetrics: {
      totalVersions: parseInt(vaultTotalVersions.rows[0]?.n) || 0,
      updatedThisMonth: parseInt(vaultUpdatedThisMonth.rows[0]?.n) || 0,
      latestModifiedTitle: vaultLatestModified.rows[0]?.title || null,
      latestModifiedAt: vaultLatestModified.rows[0]?.uploaded_at || null
    },
    scoreEligible: {
      count: parseInt(scoreEligible.rows[0]?.n) || 0,
      total: hasFilter ? filteredQuestIds.length : parseInt(totalQ.rows[0].n)
    },
    automatedCoverage: {
      count: automatedCoverage.rows.length,
      total: hasFilter ? filteredQuestIds.length : parseInt(totalQ.rows[0].n),
      questions: automatedCoverage.rows.map(r => ({
        questId: r.quest_id,
        moduleId: r.module_id,
        moduleName: r.module_name,
        controlArea: r.control_area,
        baselineQuestion: r.baseline_question,
        testKeys: r.test_keys,
        integrationKeys: r.integration_keys
      }))
    },
    recentlyReviewed: recentlyReviewed.rows.map(r => {
      const audited = r.review_status === "AUDITED";
      return {
        id: r.id,
        questId: r.quest_id,
        moduleId: r.module_id,
        reviewStatus: r.review_status,
        controlArea: r.control_area,
        reviewedBy: r.reviewed_by,
        reviewedAt: r.reviewed_at,
        reviewerNotes: r.reviewer_notes,
        auditedBy: r.audited_by,
        auditedAt: r.audited_at,
        auditorNotes: r.auditor_notes,
        // Who/when for the most recent action on this row, and its kind.
        activityBy: audited ? (r.audited_by || r.reviewed_by) : r.reviewed_by,
        activityAt: audited ? (r.audited_at || r.reviewed_at) : r.reviewed_at,
        activityKind: audited ? "audit" : "review",
      };
    }),
    rejectedControls: rejectedControls.rows.map(r => ({
      id: r.id,
      questId: r.quest_id,
      moduleId: r.module_id,
      controlArea: r.control_area,
      reviewerNotes: r.reviewer_notes,
      auditorNotes: r.auditor_notes,
      reviewedBy: r.reviewed_by,
      reviewedAt: r.reviewed_at,
      auditedBy: r.audited_by,
      auditedAt: r.audited_at,
    })),
  });
}));

export default router;
