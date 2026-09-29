import { Router } from "express";
import { getClient, mapRow, mapRows, query } from "../db/index.js";
import { authenticate } from "../middleware/auth.js";
import { requireRole } from "../middleware/roles.js";
import { asyncHandler } from "../utils/asyncHandler.js";
import { sanitiseText } from "../utils/sanitise.js";
import { getQuestDepartments, getUserScope, validateDepartmentIds } from "../utils/departmentScope.js";
import { mapOwnersToDepartments } from "../utils/departmentBackfill.js";

const router = Router();

const isUniqueViolation = (err) => err?.code === "23505";

router.get("/", authenticate, asyncHandler(async (req, res) => {
  const result = await query(
    `SELECT d.id, d.name, d.created_at,
            (SELECT COUNT(*)::int FROM user_departments ud WHERE ud.department_id = d.id) AS member_count,
            (SELECT COUNT(*)::int FROM question_departments qd WHERE qd.department_id = d.id) AS control_count
     FROM departments d WHERE d.company_id = $1 ORDER BY LOWER(d.name)`,
    [req.user.companyId]
  );
  res.json(mapRows(result));
}));

// The caller's resolved scope. `enabled` is false while the company has no
// departments — the UI hides every department control in that case.
router.get("/me", authenticate, asyncHandler(async (req, res) => {
  const scope = await getUserScope(req.user);
  const count = await query("SELECT COUNT(*)::int AS n FROM departments WHERE company_id = $1", [req.user.companyId]);
  const mine = await query(
    `SELECT d.id, d.name FROM user_departments ud
     JOIN departments d ON d.id = ud.department_id AND d.company_id = $2
     WHERE ud.user_id = $1 ORDER BY LOWER(d.name)`,
    [req.user.userId, req.user.companyId]
  );
  res.json({
    enabled: count.rows[0].n > 0,
    all: scope.all,
    departmentIds: scope.all ? [] : scope.departmentIds,
    departments: mine.rows.map((r) => ({ id: r.id, name: r.name })),
  });
}));

router.post("/", authenticate, requireRole(["ADMIN"]), asyncHandler(async (req, res) => {
  const name = sanitiseText(req.body?.name, 100);
  if (!name) return res.status(400).json({ error: "Department name is required" });
  try {
    const result = await query(
      "INSERT INTO departments (company_id, name) VALUES ($1, $2) RETURNING id, name, created_at",
      [req.user.companyId, name]
    );
    res.status(201).json(mapRow(result));
  } catch (err) {
    if (isUniqueViolation(err)) return res.status(409).json({ error: "A department with that name already exists" });
    throw err;
  }
}));

// Bulk: replaces the owning departments of many controls in one transaction.
// Registered before PUT /:id, which would otherwise capture "/controls".
router.put("/controls", authenticate, requireRole(["ADMIN"]), asyncHandler(async (req, res) => {
  const rawQuestIds = req.body?.questIds;
  if (!Array.isArray(rawQuestIds) || rawQuestIds.length === 0 || rawQuestIds.length > 2000
      || rawQuestIds.some((q) => typeof q !== "string" || !q.trim() || q.length > 200)) {
    return res.status(400).json({ error: "questIds must be a non-empty list of control ids" });
  }
  const questIds = [...new Set(rawQuestIds)];
  const ids = await validateDepartmentIds(req.user.companyId, req.body?.departmentIds);
  if (ids === null) return res.status(400).json({ error: "departmentIds must be departments of this company" });

  const found = await query(
    `SELECT COUNT(DISTINCT quest_id)::int AS n FROM questions
     WHERE quest_id = ANY($1::text[]) AND (company_id = $2 OR company_id IS NULL) AND archived_at IS NULL`,
    [questIds, req.user.companyId]
  );
  if (found.rows[0].n !== questIds.length) return res.status(404).json({ error: "One or more controls were not found" });

  const client = await getClient();
  try {
    await client.query("BEGIN");
    await client.query(
      "DELETE FROM question_departments WHERE company_id = $1 AND quest_id = ANY($2::text[])",
      [req.user.companyId, questIds]
    );
    if (ids.length) {
      await client.query(
        `INSERT INTO question_departments (company_id, quest_id, department_id)
         SELECT $1, q, d FROM UNNEST($2::text[]) AS q CROSS JOIN UNNEST($3::int[]) AS d`,
        [req.user.companyId, questIds, ids]
      );
    }
    await client.query("COMMIT");
  } catch (err) {
    await client.query("ROLLBACK").catch(() => {});
    throw err;
  } finally {
    client.release();
  }
  res.json({ updated: questIds.length });
}));

router.put("/:id", authenticate, requireRole(["ADMIN"]), asyncHandler(async (req, res) => {
  const name = sanitiseText(req.body?.name, 100);
  if (!name) return res.status(400).json({ error: "Department name is required" });
  try {
    const result = await query(
      "UPDATE departments SET name = $1, updated_at = NOW() WHERE id = $2 AND company_id = $3 RETURNING id, name, created_at",
      [name, parseInt(req.params.id), req.user.companyId]
    );
    if (result.rows.length === 0) return res.status(404).json({ error: "Department not found" });
    res.json(mapRow(result));
  } catch (err) {
    if (isUniqueViolation(err)) return res.status(409).json({ error: "A department with that name already exists" });
    throw err;
  }
}));

// Cascades memberships and control ownership; controls left with no owner fall
// back to Unassigned.
router.delete("/:id", authenticate, requireRole(["ADMIN"]), asyncHandler(async (req, res) => {
  const result = await query(
    "DELETE FROM departments WHERE id = $1 AND company_id = $2",
    [parseInt(req.params.id), req.user.companyId]
  );
  if (result.rowCount === 0) return res.status(404).json({ error: "Department not found" });
  res.status(204).send();
}));

// Creates one department per name in companies.self_assessment_departments that
// doesn't already exist (case-insensitive).
router.post("/seed-from-self-assessment", authenticate, requireRole(["ADMIN"]), asyncHandler(async (req, res) => {
  const company = await query("SELECT self_assessment_departments FROM companies WHERE id = $1", [req.user.companyId]);
  let names = company.rows[0]?.self_assessment_departments;
  if (typeof names === "string") {
    try { names = JSON.parse(names); } catch { names = []; }
  }
  const created = [];
  for (const raw of Array.isArray(names) ? names : []) {
    const name = sanitiseText(raw, 100);
    if (!name) continue;
    const result = await query(
      `INSERT INTO departments (company_id, name) VALUES ($1, $2)
       ON CONFLICT (company_id, (LOWER(name))) DO NOTHING RETURNING name`,
      [req.user.companyId, name]
    );
    if (result.rows.length) created.push(result.rows[0].name);
  }
  res.json({ created });
}));

router.post("/map-owners", authenticate, requireRole(["ADMIN"]), asyncHandler(async (req, res) => {
  res.json(await mapOwnersToDepartments(req.user.companyId));
}));

// Replaces the owning departments of one control.
router.put("/controls/:questId", authenticate, requireRole(["ADMIN"]), asyncHandler(async (req, res) => {
  const { questId } = req.params;
  const ids = await validateDepartmentIds(req.user.companyId, req.body?.departmentIds);
  if (ids === null) return res.status(400).json({ error: "departmentIds must be departments of this company" });

  const quest = await query(
    "SELECT 1 FROM questions WHERE quest_id = $1 AND (company_id = $2 OR company_id IS NULL) AND archived_at IS NULL LIMIT 1",
    [questId, req.user.companyId]
  );
  if (quest.rows.length === 0) return res.status(404).json({ error: "Control not found" });

  await query("DELETE FROM question_departments WHERE company_id = $1 AND quest_id = $2", [req.user.companyId, questId]);
  if (ids.length) {
    await query(
      `INSERT INTO question_departments (company_id, quest_id, department_id)
       SELECT $1, $2, UNNEST($3::int[])`,
      [req.user.companyId, questId, ids]
    );
  }
  const map = await getQuestDepartments(req.user.companyId, [questId]);
  res.json({ questId, departments: map.get(questId) || [] });
}));

export default router;
