import { Router } from "express";
import { mapRow, mapRows, query, getClient } from "../db/index.js";
import { effectiveQuestions } from "../db/effectiveRows.js";
import { redactStoragePathsMiddleware } from "../utils/redactStoragePaths.js";
import { authenticate } from "../middleware/auth.js";
import { requireRole } from "../middleware/roles.js";
import { getQuestDepartments } from "../utils/departmentScope.js";
import { asyncHandler } from "../utils/asyncHandler.js";
import { freezeAuditPeriodsSql } from "../utils/auditCoverage.js";

const VALID_RECURRENCE = ["weekly", "fortnightly", "monthly", "quarterly", "semi-annual", "annual", "none"];
const VALID_PRIORITIES = ["Critical", "High", "Medium", "Low"];

const router = Router();
// Never expose raw storage refs (F-01) — evidence rows on the question detail carry file_path.
router.use(redactStoragePathsMiddleware);

// Ensure a tenant-specific row exists for quest_id under companyId, creating one
// from the global canonical row (company_id IS NULL) if the tenant has no copy
// yet. ADMIN/LEAD writes must always land on a tenant-owned row, never on the
// shared global row (F-06) — company_id here is always the caller's own,
// never client-controlled. Returns false if quest_id doesn't exist at all.
// ON CONFLICT DO NOTHING makes concurrent first-write races safe: whichever
// request loses the insert still ends up with a tenant row in place, since the
// (company_id, quest_id) unique index guarantees exactly one was created.
async function ensureTenantQuestion(companyId, questId) {
  const tenantResult = await query(
    "SELECT id FROM questions WHERE quest_id = $1 AND company_id = $2",
    [questId, companyId]
  );
  if (tenantResult.rows.length > 0) return true;

  const globalResult = await query(
    "SELECT * FROM questions WHERE quest_id = $1 AND company_id IS NULL",
    [questId]
  );
  if (globalResult.rows.length === 0) return false;
  const g = globalResult.rows[0];

  await query(
    `INSERT INTO questions
       (quest_id, company_id, module_id, module_name, control_area, iso_reference,
        baseline_question, level3_yes_criteria, required_evidence, default_owner,
        frequency, priority, tags, due_date, recurrence_interval, next_due_date)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16)
     ON CONFLICT (company_id, quest_id) DO NOTHING`,
    [questId, companyId, g.module_id, g.module_name, g.control_area, g.iso_reference,
     g.baseline_question, g.level3_yes_criteria, g.required_evidence, g.default_owner,
     g.frequency, g.priority, g.tags, g.due_date, g.recurrence_interval, g.next_due_date]
  );
  return true;
}

router.get("/", authenticate, asyncHandler(async (req, res) => {
  const { moduleId } = req.query;
  const values = [req.user.companyId];
  // One row per quest_id, company-specific copy preferred over the global template (F-14)
  let sql = `SELECT *,
    CASE WHEN next_due_date IS NOT NULL AND next_due_date < NOW() THEN true ELSE false END AS is_overdue,
    COALESCE((
      SELECT COUNT(*)::INT FROM question_dependencies qd
      WHERE qd.company_id = $1 AND qd.quest_id = questions.quest_id
    ), 0) AS dependency_count,
    CASE WHEN EXISTS (
      SELECT 1 FROM question_dependencies qd
      WHERE qd.company_id = $1 AND qd.quest_id = questions.quest_id
        AND NOT EXISTS (
          SELECT 1 FROM assessments a
          WHERE a.quest_id = qd.depends_on_quest_id AND a.company_id = $1
            AND a.review_status IN ('FINISHED', 'AUDITED')
        )
    ) THEN true ELSE false END AS blocked_by_deps,
    COALESCE((
      SELECT COUNT(*)::INT FROM question_dependencies qd
      WHERE qd.company_id = $1 AND qd.quest_id = questions.quest_id
        AND NOT EXISTS (
          SELECT 1 FROM assessments a
          WHERE a.quest_id = qd.depends_on_quest_id AND a.company_id = $1
            AND a.review_status IN ('FINISHED', 'AUDITED')
        )
    ), 0) AS unmet_dep_count,
    (
      SELECT answer FROM assessments
      WHERE quest_id = questions.quest_id AND company_id = $1
        AND review_status IN ('FINISHED', 'AUDITED')
      ORDER BY created_at DESC LIMIT 1
    ) AS latest_answer,
    (
      SELECT comments FROM assessments
      WHERE quest_id = questions.quest_id AND company_id = $1
      ORDER BY created_at DESC LIMIT 1
    ) AS latest_comments,
    (
      SELECT reviewer_notes FROM assessments
      WHERE quest_id = questions.quest_id AND company_id = $1
      ORDER BY created_at DESC LIMIT 1
    ) AS latest_reviewer_notes
    FROM ${effectiveQuestions("$1")} questions WHERE archived_at IS NULL`;

  if (moduleId) {
    values.push(moduleId);
    sql += ` AND module_id = $${values.length}`;
  }

  sql += " ORDER BY quest_id ASC";
  const result = await query(sql, values);
  const rows = mapRows(result);
  const owners = await getQuestDepartments(req.user.companyId);
  res.json(rows.map((q) => ({ ...q, departments: owners.get(q.questId) || [] })));
}));

router.get("/:questId", authenticate, asyncHandler(async (req, res) => {
  const questionResult = await query(
    `SELECT * FROM questions WHERE quest_id = $1 AND (company_id = $2 OR company_id IS NULL)
     ORDER BY company_id ASC NULLS LAST LIMIT 1`,
    [req.params.questId, req.user.companyId]
  );
  const question = mapRow(questionResult);
  if (!question) {
    return res.status(404).json({ error: "Question not found" });
  }

  const [assessmentsResult, actionsResult, evidenceResult] = await Promise.all([
    query(
      "SELECT * FROM assessments WHERE quest_id = $1 AND company_id = $2 ORDER BY created_at DESC",
      [req.params.questId, req.user.companyId]
    ),
    query(
      "SELECT * FROM actions WHERE quest_id = $1 AND company_id = $2 ORDER BY created_at DESC",
      [req.params.questId, req.user.companyId]
    ),
    query(
      // AI analysis lives on the shared evidence_vault item (auto-run on upload);
      // fall back to the legacy per-row columns for evidence analysed before the move.
      `SELECT e.*,
              COALESCE(ev.ai_contributor_comments, e.ai_contributor_comments) AS ai_contributor_comments,
              COALESCE(ev.ai_reviewer_comments,    e.ai_reviewer_comments)    AS ai_reviewer_comments,
              COALESCE(ev.ai_gaps,                 e.ai_gaps)                 AS ai_gaps,
              COALESCE(ev.ai_suggestions,          e.ai_suggestions)          AS ai_suggestions,
              COALESCE(ev.ai_analyzed_at,          e.ai_analyzed_at)          AS ai_analyzed_at,
              COALESCE(ev.ai_date_warning,         e.ai_date_warning)         AS ai_date_warning,
              ev.ai_analysis_status, ev.ai_analyzed_version, ev.current_version
         FROM evidence e
         LEFT JOIN LATERAL (
           SELECT vv.ai_contributor_comments, vv.ai_reviewer_comments, vv.ai_gaps,
                  vv.ai_suggestions, vv.ai_analyzed_at, vv.ai_date_warning,
                  vv.ai_analysis_status, vv.ai_analyzed_version,
                  (SELECT COALESCE(MAX(version_number), 1) FROM evidence_versions WHERE evidence_id = vv.id) AS current_version
             FROM evidence_vault vv
            WHERE vv.company_id = e.company_id
              AND (
                vv.legacy_evidence_id = e.id
                OR vv.id IN (
                     SELECT qe.vault_id FROM question_evidence qe
                      WHERE qe.company_id = e.company_id AND qe.quest_id = e.quest_id
                   )
              )
            ORDER BY (vv.legacy_evidence_id = e.id) DESC, vv.updated_at DESC
            LIMIT 1
         ) ev ON TRUE
        WHERE e.quest_id = $1 AND e.company_id = $2
        ORDER BY e.created_at DESC`,
      [req.params.questId, req.user.companyId]
    )
  ]);

  question.assessments = mapRows(assessmentsResult);
  question.actions = mapRows(actionsResult);
  question.evidence = mapRows(evidenceResult);
  question.departments = (await getQuestDepartments(req.user.companyId, [question.questId])).get(question.questId) || [];

  const depsResult = await query(
    `WITH q_info AS (
       SELECT DISTINCT ON (quest_id) quest_id, control_area, module_id
       FROM questions
       WHERE (company_id = $1 OR company_id IS NULL)
       ORDER BY quest_id ASC, company_id ASC NULLS LAST
     )
     SELECT
       qd.depends_on_quest_id AS dep_quest_id,
       qi.control_area,
       qi.module_id,
       a.answer AS latest_answer,
       a.review_status AS latest_review_status
     FROM question_dependencies qd
     LEFT JOIN q_info qi ON qi.quest_id = qd.depends_on_quest_id
     LEFT JOIN LATERAL (
       SELECT answer, review_status FROM assessments
       WHERE quest_id = qd.depends_on_quest_id AND company_id = $1
         AND review_status IN ('FINISHED', 'AUDITED')
       ORDER BY created_at DESC LIMIT 1
     ) a ON TRUE
     WHERE qd.company_id = $1 AND qd.quest_id = $2
     ORDER BY qd.depends_on_quest_id ASC`,
    [req.user.companyId, req.params.questId]
  );
  question.dependencies = depsResult.rows.map(row => ({
    questId: row.dep_quest_id,
    controlArea: row.control_area,
    moduleId: row.module_id,
    latestAnswer: row.latest_answer,
    latestReviewStatus: row.latest_review_status,
  }));

  res.json(question);
}));

// PUT /api/questions/:questId - update question fields (priority, dueDate)
router.put("/:questId", authenticate, requireRole(["ADMIN", "LEAD"]), asyncHandler(async (req, res) => {
  const { priority, dueDate } = req.body;

  if (priority === undefined && dueDate === undefined) {
    return res.status(400).json({ error: "No updatable fields provided" });
  }
  if (priority !== undefined && !VALID_PRIORITIES.includes(priority)) {
    return res.status(400).json({ error: `priority must be one of: ${VALID_PRIORITIES.join(", ")}` });
  }

  const exists = await ensureTenantQuestion(req.user.companyId, req.params.questId);
  if (!exists) {
    return res.status(404).json({ error: "Question not found" });
  }

  const sets = [];
  const values = [];
  let idx = 1;
  if (priority !== undefined) {
    sets.push(`priority = $${idx++}`);
    values.push(priority);
  }
  if (dueDate !== undefined) {
    sets.push(`due_date = $${idx++}`);
    values.push(dueDate || null);
  }
  sets.push("updated_at = NOW()");

  values.push(req.params.questId);
  const whereClause = `quest_id = $${idx++} AND company_id = $${idx}`;
  values.push(req.user.companyId);

  const result = await query(
    `UPDATE questions SET ${sets.join(", ")} WHERE ${whereClause} RETURNING *`,
    values
  );
  res.json(mapRow(result));
}));

// PUT /api/questions/:questId/recurrence - update recurrence settings for a question
router.put("/:questId/recurrence", authenticate, requireRole(["ADMIN", "LEAD"]), asyncHandler(async (req, res) => {
  const { recurrenceInterval, nextDueDate } = req.body;

  if (recurrenceInterval && !VALID_RECURRENCE.includes(recurrenceInterval)) {
    return res.status(400).json({ error: `recurrenceInterval must be one of: ${VALID_RECURRENCE.join(", ")}` });
  }

  const exists = await ensureTenantQuestion(req.user.companyId, req.params.questId);
  if (!exists) {
    return res.status(404).json({ error: "Question not found" });
  }

  // Audits already signed off keep the period they covered under the old interval.
  if (recurrenceInterval !== undefined) {
    await query(freezeAuditPeriodsSql("$1", "$2"), [req.user.companyId, req.params.questId]);
  }

  const sets = [];
  const values = [];
  let idx = 1;

  if (recurrenceInterval !== undefined) {
    sets.push(`recurrence_interval = $${idx++}`);
    values.push(recurrenceInterval);
  }
  if (nextDueDate !== undefined) {
    sets.push(`next_due_date = $${idx++}`);
    values.push(nextDueDate || null);
  }
  sets.push("updated_at = NOW()");

  values.push(req.params.questId);
  const whereClause = `quest_id = $${idx++} AND company_id = $${idx}`;
  values.push(req.user.companyId);

  const result = await query(
    `UPDATE questions SET ${sets.join(", ")} WHERE ${whereClause} RETURNING *`,
    values
  );
  res.json(mapRow(result));
}));

// Detect if adding questId -> newDependsOnIds would create a cycle.
// Traverses the existing dep graph (excluding questId's current outgoing edges,
// which will be replaced) from each proposed dep to see if questId is reachable.
async function detectCycle(companyId, questId, newDependsOnIds) {
  if (newDependsOnIds.length === 0) return false;
  const result = await query(
    `WITH RECURSIVE reachable AS (
       SELECT unnest($2::text[]) AS q
       UNION
       SELECT qd.depends_on_quest_id
       FROM question_dependencies qd
       INNER JOIN reachable r ON r.q = qd.quest_id
       WHERE qd.company_id = $1 AND qd.quest_id != $3
     )
     SELECT 1 FROM reachable WHERE q = $3 LIMIT 1`,
    [companyId, newDependsOnIds, questId]
  );
  return result.rows.length > 0;
}

// GET /api/questions/:questId/dependencies
router.get("/:questId/dependencies", authenticate, asyncHandler(async (req, res) => {
  const { questId } = req.params;
  const companyId = req.user.companyId;

  const result = await query(
    `WITH q_info AS (
       SELECT DISTINCT ON (quest_id) quest_id, control_area, module_id
       FROM questions
       WHERE (company_id = $1 OR company_id IS NULL)
       ORDER BY quest_id ASC, company_id ASC NULLS LAST
     )
     SELECT
       qd.depends_on_quest_id AS dep_quest_id,
       qi.control_area,
       qi.module_id,
       a.answer AS latest_answer,
       a.review_status AS latest_review_status
     FROM question_dependencies qd
     LEFT JOIN q_info qi ON qi.quest_id = qd.depends_on_quest_id
     LEFT JOIN LATERAL (
       SELECT answer, review_status FROM assessments
       WHERE quest_id = qd.depends_on_quest_id AND company_id = $1
         AND review_status IN ('FINISHED', 'AUDITED')
       ORDER BY created_at DESC LIMIT 1
     ) a ON TRUE
     WHERE qd.company_id = $1 AND qd.quest_id = $2
     ORDER BY qd.depends_on_quest_id ASC`,
    [companyId, questId]
  );

  res.json(result.rows.map(row => ({
    questId: row.dep_quest_id,
    controlArea: row.control_area,
    moduleId: row.module_id,
    latestAnswer: row.latest_answer,
    latestReviewStatus: row.latest_review_status,
  })));
}));

// PUT /api/questions/:questId/dependencies — replace all deps for a question (ADMIN/LEAD)
router.put("/:questId/dependencies", authenticate, requireRole(["ADMIN", "LEAD"]), asyncHandler(async (req, res) => {
  const { questId } = req.params;
  const { dependsOn = [] } = req.body;
  const companyId = req.user.companyId;

  if (!Array.isArray(dependsOn)) {
    return res.status(400).json({ error: "dependsOn must be an array of quest IDs" });
  }

  const uniqueDeps = [...new Set(dependsOn)];

  if (uniqueDeps.includes(questId)) {
    return res.status(400).json({ error: "A question cannot depend on itself" });
  }

  const questExists = await query(
    "SELECT 1 FROM questions WHERE quest_id = $1 AND (company_id = $2 OR company_id IS NULL) LIMIT 1",
    [questId, companyId]
  );
  if (questExists.rows.length === 0) {
    return res.status(404).json({ error: "Question not found" });
  }

  for (const depId of uniqueDeps) {
    const depExists = await query(
      "SELECT 1 FROM questions WHERE quest_id = $1 AND (company_id = $2 OR company_id IS NULL) LIMIT 1",
      [depId, companyId]
    );
    if (depExists.rows.length === 0) {
      return res.status(400).json({ error: `Dependency question not found: ${depId}` });
    }
  }

  if (await detectCycle(companyId, questId, uniqueDeps)) {
    return res.status(400).json({ error: "Circular dependency detected: the requested dependencies would create a cycle" });
  }

  const client = await getClient();
  try {
    await client.query("BEGIN");
    await client.query(
      "DELETE FROM question_dependencies WHERE company_id = $1 AND quest_id = $2",
      [companyId, questId]
    );
    for (const depId of uniqueDeps) {
      await client.query(
        "INSERT INTO question_dependencies (company_id, quest_id, depends_on_quest_id) VALUES ($1, $2, $3)",
        [companyId, questId, depId]
      );
    }
    await client.query("COMMIT");
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  } finally {
    client.release();
  }

  res.json({ questId, dependsOn: uniqueDeps });
}));

export default router;
