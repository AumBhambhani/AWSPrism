import { Router } from "express";
import crypto from "crypto";
import { mapRow, mapRows, query } from "../db/index.js";
import { authenticate } from "../middleware/auth.js";
import { requireRole } from "../middleware/roles.js";
import { asyncHandler } from "../utils/asyncHandler.js";
import { sanitiseText } from "../utils/sanitise.js";
import { validateDepartmentIds, writeUserDepartments } from "../utils/departmentScope.js";

const router = Router();

router.get("/", authenticate, requireRole(["ADMIN"]), asyncHandler(async (req, res) => {
  const result = await query(
    `SELECT u.id, u.email, u.role, u.created_at, u.all_departments,
            COALESCE(ARRAY(
              SELECT ud.department_id FROM user_departments ud WHERE ud.user_id = u.id ORDER BY ud.department_id
            ), '{}') AS department_ids
     FROM users u WHERE u.company_id = $1 ORDER BY u.created_at ASC`,
    [req.user.companyId]
  );
  res.json(mapRows(result));
}));

router.post("/invite", authenticate, requireRole(["ADMIN"]), asyncHandler(async (req, res) => {
  const { email, role, department, allDepartments, departmentIds } = req.body;
  const normalizedEmail = typeof email === "string" ? email.trim().toLowerCase() : "";

  if (!normalizedEmail || !role) {
    return res.status(400).json({ error: "Email and role required" });
  }
  
  if (role === "AUDITOR") {
    return res.status(400).json({ error: "AUDITOR role cannot be assigned via invite. Please use the Auditor panel to create auditors directly." });
  }
  
  const existingUser = await query("SELECT id FROM users WHERE email = $1", [normalizedEmail]);
  if (existingUser.rows.length > 0) {
    return res.status(400).json({ error: "User already exists" });
  }
  
  const existingInvitation = await query(
    "SELECT id FROM invitations WHERE email = $1 AND company_id = $2 AND accepted_at IS NULL",
    [normalizedEmail, req.user.companyId]
  );
  if (existingInvitation.rows.length > 0) {
    return res.status(400).json({ error: "Invitation already sent" });
  }
  
  // Department scoping: "All departments" unless the admin explicitly scopes the
  // invite. (`department` is the separate self-assessment delegation label.)
  const scoped = allDepartments === false;
  let scopedIds = null;
  if (scoped) {
    scopedIds = await validateDepartmentIds(req.user.companyId, departmentIds || []);
    if (scopedIds === null) return res.status(400).json({ error: "departmentIds must be departments of this company" });
  }

  const token = crypto.randomBytes(32).toString("hex");
  const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);
  
  const dept = typeof department === "string" ? department.trim() || null : null;
  const invitationResult = await query(
    `INSERT INTO invitations (email, company_id, role, token, expires_at, department, all_departments, department_ids)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
     RETURNING id, email, role, token, expires_at, department, all_departments, department_ids, created_at`,
    [normalizedEmail, req.user.companyId, role, token, expiresAt, dept, !scoped, scopedIds]
  );
  const invitation = mapRow(invitationResult);

  res.status(201).json({
    invitation,
    inviteLink: `${process.env.WEB_URL || req.headers.origin || "http://localhost:5173"}/accept-invite/${token}`
  });
}));

// PUT /api/users/me — update own profile fields
router.put("/me", authenticate, asyncHandler(async (req, res) => {
  const { fullName, department, jobTitle } = req.body;
  const cleanName  = sanitiseText(fullName, 200);
  const cleanDept  = sanitiseText(department, 200);
  const cleanTitle = sanitiseText(jobTitle, 200);
  const updates = [];
  const values = [];

  if (fullName   !== undefined) { values.push(cleanName);  updates.push(`full_name = $${values.length}`); }
  // Once the company uses departments, the label is derived from the admin-managed
  // membership (see writeUserDepartments) and can't be self-edited.
  const managedDepartments = department !== undefined && (await query(
    "SELECT 1 FROM departments WHERE company_id = $1 LIMIT 1", [req.user.companyId]
  )).rows.length > 0;
  if (department !== undefined && !managedDepartments) { values.push(cleanDept);  updates.push(`department = $${values.length}`); }
  if (jobTitle   !== undefined) { values.push(cleanTitle); updates.push(`job_title = $${values.length}`); }

  if (updates.length === 0) return res.status(400).json({ error: "No fields to update" });

  values.push(new Date()); updates.push(`updated_at = $${values.length}`);
  values.push(req.user.userId);

  const result = await query(
    `UPDATE users SET ${updates.join(", ")} WHERE id = $${values.length} RETURNING id, email, role, full_name, department, job_title`,
    values
  );

  res.json(mapRow(result));
}));

router.put("/:id", authenticate, requireRole(["ADMIN"]), asyncHandler(async (req, res) => {
  const { role, allDepartments, departmentIds } = req.body;
  const userId = parseInt(req.params.id);
  const changesRole = role !== undefined;
  const changesDepartments = allDepartments !== undefined || departmentIds !== undefined;

  if (!changesRole && !changesDepartments) {
    return res.status(400).json({ error: "No fields to update" });
  }
  if (changesRole && userId === req.user.userId) {
    return res.status(400).json({ error: "Cannot change your own role" });
  }
  
  if (role === "AUDITOR") {
    return res.status(400).json({ error: "AUDITOR role cannot be assigned via role update. Please use the Auditor panel to create auditors directly." });
  }

  const existing = await query("SELECT id FROM users WHERE id = $1 AND company_id = $2", [userId, req.user.companyId]);
  if (existing.rows.length === 0) {
    return res.status(404).json({ error: "User not found" });
  }

  let scopedIds = [];
  if (changesDepartments && allDepartments === false) {
    scopedIds = await validateDepartmentIds(req.user.companyId, departmentIds || []);
    if (scopedIds === null) return res.status(400).json({ error: "departmentIds must be departments of this company" });
  }

  if (changesRole) {
    await query(
      "UPDATE users SET role = $1, updated_at = NOW() WHERE id = $2 AND company_id = $3",
      [role, userId, req.user.companyId]
    );
  }
  if (changesDepartments) {
    await writeUserDepartments({ query }, userId, { allDepartments: allDepartments !== false, departmentIds: scopedIds });
  }

  const updatedResult = await query(
    `SELECT u.id, u.email, u.role, u.created_at, u.all_departments,
            COALESCE(ARRAY(
              SELECT ud.department_id FROM user_departments ud WHERE ud.user_id = u.id ORDER BY ud.department_id
            ), '{}') AS department_ids
     FROM users u WHERE u.id = $1`,
    [userId]
  );
  res.json(mapRow(updatedResult));
}));

router.delete("/:id", authenticate, requireRole(["ADMIN"]), asyncHandler(async (req, res) => {
  const userId = parseInt(req.params.id);
  
  if (userId === req.user.userId) {
    return res.status(400).json({ error: "Cannot delete yourself" });
  }
  
  const result = await query(
    "DELETE FROM users WHERE id = $1 AND company_id = $2",
    [userId, req.user.companyId]
  );
  if (result.rowCount === 0) {
    return res.status(404).json({ error: "User not found" });
  }

  res.status(204).send();
}));

router.get("/invitations", authenticate, requireRole(["ADMIN"]), asyncHandler(async (req, res) => {
  const result = await query(
    "SELECT id, email, role, token, expires_at, created_at FROM invitations WHERE company_id = $1 AND accepted_at IS NULL ORDER BY created_at DESC",
    [req.user.companyId]
  );
  res.json(mapRows(result));
}));

router.delete("/invitations/:id", authenticate, requireRole(["ADMIN"]), asyncHandler(async (req, res) => {
  const invitationId = parseInt(req.params.id);
  
  const result = await query(
    "DELETE FROM invitations WHERE id = $1 AND company_id = $2",
    [invitationId, req.user.companyId]
  );
  if (result.rowCount === 0) {
    return res.status(404).json({ error: "Invitation not found" });
  }

  res.status(204).send();
}));

export default router;
