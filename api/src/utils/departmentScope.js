import { query } from "../db/index.js";

// Department scoping — the single place that decides which departments a user acts
// for. Resolved per request (not baked into the JWT) so membership edits apply
// immediately.
//
//   company has 0 departments  → all  (feature dormant)
//   ADMIN                      → all
//   users.all_departments      → all
//   otherwise                  → the user's department ids (possibly empty)

export function resolveScope({ departmentCount, role, allDepartments, departmentIds }) {
  if (!departmentCount || role === "ADMIN" || allDepartments) return { all: true };
  return { all: false, departmentIds: [...(departmentIds || [])] };
}

export async function getUserScope({ userId, companyId, role }) {
  const result = await query(
    `SELECT
       (SELECT COUNT(*)::int FROM departments WHERE company_id = $2) AS department_count,
       u.all_departments,
       COALESCE(ARRAY(
         SELECT ud.department_id FROM user_departments ud
         JOIN departments d ON d.id = ud.department_id AND d.company_id = $2
         WHERE ud.user_id = u.id ORDER BY ud.department_id
       ), '{}') AS department_ids
     FROM users u WHERE u.id = $1 AND u.company_id = $2`,
    [userId, companyId]
  );
  const row = result.rows[0];
  if (!row) return { all: true };
  return resolveScope({
    departmentCount: row.department_count,
    role,
    allDepartments: row.all_departments,
    departmentIds: row.department_ids,
  });
}

// Map<questId, [{ id, name }]> of owning departments for the given controls.
// Pass questIds = null to load every mapped control for the company.
export async function getQuestDepartments(companyId, questIds = null) {
  const params = [companyId];
  let filter = "";
  if (Array.isArray(questIds)) {
    if (questIds.length === 0) return new Map();
    params.push(questIds);
    filter = "AND qd.quest_id = ANY($2::text[])";
  }
  const result = await query(
    `SELECT qd.quest_id, d.id, d.name
     FROM question_departments qd
     JOIN departments d ON d.id = qd.department_id
     WHERE qd.company_id = $1 ${filter}
     ORDER BY d.name`,
    params
  );
  const map = new Map();
  for (const row of result.rows) {
    if (!map.has(row.quest_id)) map.set(row.quest_id, []);
    map.get(row.quest_id).push({ id: row.id, name: row.name });
  }
  return map;
}

export function questInScope(scope, questDepartments) {
  if (scope.all) return true;
  const mine = new Set(scope.departmentIds);
  return (questDepartments || []).some((d) => mine.has(d.id));
}

// Normalises a client-supplied list of department ids and checks every one belongs
// to the company (tenant boundary). Returns the deduped int array, or null if the
// input is malformed or references a department outside the company.
export async function validateDepartmentIds(companyId, rawIds) {
  if (!Array.isArray(rawIds)) return null;
  const ids = [...new Set(rawIds.map((v) => Number(v)))];
  if (ids.some((v) => !Number.isInteger(v) || v <= 0)) return null;
  if (ids.length === 0) return [];
  const result = await query(
    "SELECT id FROM departments WHERE company_id = $1 AND id = ANY($2::int[])",
    [companyId, ids]
  );
  return result.rows.length === ids.length ? ids : null;
}

// Writes a user's membership: the all_departments flag, the user_departments rows,
// and the users.department display label (comma-joined names, NULL for "All").
// `db` is anything with a pg-style query(text, params) — the pool helper or a
// transaction client. departmentIds must already be validated for the company.
export async function writeUserDepartments(db, userId, { allDepartments, departmentIds }) {
  const all = allDepartments !== false;
  const ids = all ? [] : departmentIds || [];
  await db.query("DELETE FROM user_departments WHERE user_id = $1", [userId]);
  if (ids.length) {
    await db.query(
      "INSERT INTO user_departments (user_id, department_id) SELECT $1, UNNEST($2::int[])",
      [userId, ids]
    );
  }
  await db.query(
    `UPDATE users SET all_departments = $2,
       department = CASE WHEN $2 THEN NULL ELSE (
         SELECT STRING_AGG(d.name, ', ' ORDER BY LOWER(d.name))
         FROM user_departments ud JOIN departments d ON d.id = ud.department_id
         WHERE ud.user_id = $1
       ) END,
       updated_at = NOW()
     WHERE id = $1`,
    [userId, all]
  );
}

// For review actions: a department LEAD may only act on controls owned by one of
// their departments. Returns null when allowed, or { owningDepartments: [names] }
// when the LEAD is outside the control's departments. Non-LEAD roles pass through
// (their own role rules apply elsewhere).
export async function leadScopeViolation(user, questId) {
  if (user.role !== "LEAD") return null;
  const scope = await getUserScope(user);
  if (scope.all) return null;
  const owning = (await getQuestDepartments(user.companyId, [questId])).get(questId) || [];
  return questInScope(scope, owning) ? null : { owningDepartments: owning.map((d) => d.name) };
}
