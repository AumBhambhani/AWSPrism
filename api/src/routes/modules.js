import { Router } from "express";
import { mapRow, mapRows, query } from "../db/index.js";
import { authenticate } from "../middleware/auth.js";
import { requireRole } from "../middleware/roles.js";
import { asyncHandler } from "../utils/asyncHandler.js";
import { effectiveModules, effectiveQuestions } from "../db/effectiveRows.js";

const router = Router();

router.get("/", authenticate, asyncHandler(async (req, res) => {
  const companyId = req.user.companyId;
  const result = await query(
    `SELECT m.*,
      COALESCE(
        (SELECT ARRAY_AGG(md.depends_on_module_id ORDER BY md.depends_on_module_id)
         FROM module_dependencies md
         WHERE md.company_id = $1 AND md.module_id = m.module_id),
        ARRAY[]::TEXT[]
      ) AS dep_module_ids,
      EXISTS (
        SELECT 1 FROM module_dependencies md
        WHERE md.company_id = $1 AND md.module_id = m.module_id
          AND EXISTS (
            SELECT 1 FROM ${effectiveQuestions("$1")} q
            WHERE q.module_id = md.depends_on_module_id
              AND q.archived_at IS NULL
              AND NOT EXISTS (
                SELECT 1 FROM assessments a
                WHERE a.quest_id = q.quest_id AND a.company_id = $1
                  AND a.review_status IN ('FINISHED', 'AUDITED')
              )
          )
      ) AS blocked_by_deps
    FROM ${effectiveModules("$1")} m
    ORDER BY m.sort_order ASC, m.module_id ASC`,
    [companyId]
  );
  res.json(mapRows(result));
}));

router.get("/:moduleId", authenticate, asyncHandler(async (req, res) => {
  const moduleResult = await query(
    `SELECT * FROM ${effectiveModules("$2")} m WHERE module_id = $1`,
    [req.params.moduleId, req.user.companyId]
  );
  const module = mapRow(moduleResult);
  if (!module) {
    return res.status(404).json({ error: "Module not found" });
  }

  const questionsResult = await query(
    `SELECT * FROM ${effectiveQuestions("$2")} q WHERE module_id = $1 AND archived_at IS NULL ORDER BY quest_id ASC`,
    [req.params.moduleId, req.user.companyId]
  );
  module.questions = mapRows(questionsResult);
  res.json(module);
}));

// GET /api/modules/:moduleId/dependencies — list which modules this module depends on
router.get("/:moduleId/dependencies", authenticate, asyncHandler(async (req, res) => {
  const { moduleId } = req.params;
  const companyId = req.user.companyId;
  const result = await query(
    `SELECT md.depends_on_module_id AS module_id, m.name
     FROM module_dependencies md
     LEFT JOIN ${effectiveModules("$1")} m ON m.module_id = md.depends_on_module_id
     WHERE md.company_id = $1 AND md.module_id = $2
     ORDER BY md.depends_on_module_id ASC`,
    [companyId, moduleId]
  );
  res.json(result.rows);
}));

// PUT /api/modules/:moduleId/dependencies — replace full dependency list (ADMIN only)
router.put("/:moduleId/dependencies", authenticate, requireRole(["ADMIN", "SUPERADMIN"]), asyncHandler(async (req, res) => {
  const { moduleId } = req.params;
  const { dependsOn = [] } = req.body;
  const companyId = req.user.companyId;

  if (!Array.isArray(dependsOn)) {
    return res.status(400).json({ error: "dependsOn must be an array of module IDs" });
  }

  const unique = [...new Set(dependsOn)].filter(id => id && id !== moduleId);

  // Verify module exists for this company
  const modCheck = await query(
    "SELECT 1 FROM modules WHERE module_id = $1 AND (company_id = $2 OR company_id IS NULL) LIMIT 1",
    [moduleId, companyId]
  );
  if (modCheck.rows.length === 0) {
    return res.status(404).json({ error: "Module not found" });
  }

  // Verify all dep modules exist
  for (const depId of unique) {
    const depCheck = await query(
      "SELECT 1 FROM modules WHERE module_id = $1 AND (company_id = $2 OR company_id IS NULL) LIMIT 1",
      [depId, companyId]
    );
    if (depCheck.rows.length === 0) {
      return res.status(400).json({ error: `Dependency module not found: ${depId}` });
    }
  }

  // Replace all dependencies atomically
  await query("DELETE FROM module_dependencies WHERE company_id = $1 AND module_id = $2", [companyId, moduleId]);
  for (const depId of unique) {
    await query(
      "INSERT INTO module_dependencies (company_id, module_id, depends_on_module_id) VALUES ($1, $2, $3) ON CONFLICT DO NOTHING",
      [companyId, moduleId, depId]
    );
  }

  res.json({ moduleId, dependsOn: unique });
}));

export default router;
