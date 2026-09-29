import { Router } from "express";
import bcrypt from "bcryptjs";
import { mapRow, mapRows, query } from "../db/index.js";
import { authenticate } from "../middleware/auth.js";
import { requireRole } from "../middleware/roles.js";
import { asyncHandler } from "../utils/asyncHandler.js";
import { writeAuditLog } from "../utils/auditLog.js";

const router = Router();

// List all auditors for this company
router.get("/", authenticate, requireRole(["ADMIN"]), asyncHandler(async (req, res) => {
  const result = await query(
    `SELECT u.id, u.email, u.role, u.created_at,
            ap.start_date, ap.expiry_date, ap.active, ap.id AS profile_id
     FROM users u
     JOIN auditor_profiles ap ON ap.user_id = u.id
     WHERE u.company_id = $1 AND u.role = 'AUDITOR'
     ORDER BY ap.created_at DESC`,
    [req.user.companyId]
  );
  res.json(mapRows(result));
}));

// Create a new auditor account directly (no invite flow)
router.post("/", authenticate, requireRole(["ADMIN"]), asyncHandler(async (req, res) => {
  const { email, password, startDate, expiryDate } = req.body;
  const normalizedEmail = typeof email === "string" ? email.trim().toLowerCase() : "";

  if (!normalizedEmail || !password) {
    return res.status(400).json({ error: "email and password required" });
  }

  const existing = await query("SELECT id FROM users WHERE email = $1", [normalizedEmail]);
  if (existing.rows.length > 0) {
    return res.status(400).json({ error: "Email already registered" });
  }

  const passwordHash = await bcrypt.hash(password, 10);
  const start  = startDate  ? new Date(startDate)  : new Date();
  const expiry = expiryDate ? new Date(expiryDate) : new Date(Date.now() + 14 * 24 * 60 * 60 * 1000);

  const userResult = await query(
    "INSERT INTO users (email, password_hash, role, company_id) VALUES ($1, $2, 'AUDITOR', $3) RETURNING id, email, role, created_at",
    [normalizedEmail, passwordHash, req.user.companyId]
  );
  const user = mapRow(userResult);

  const profileResult = await query(
    `INSERT INTO auditor_profiles (user_id, company_id, start_date, expiry_date, active, created_by)
     VALUES ($1, $2, $3, $4, TRUE, $5)
     RETURNING id, start_date, expiry_date, active`,
    [user.id, req.user.companyId, start, expiry, req.user.userId]
  );
  const profile = mapRow(profileResult);

  await writeAuditLog({
    userId:    req.user.userId,
    companyId: req.user.companyId,
    email:     req.user.email,
    action:    "AUDITOR_CREATED",
    resource:  "auditor_profiles",
    detail:    { auditorEmail: normalizedEmail, expiryDate: expiry },
    ip:        req.ip
  });

  res.status(201).json({ ...user, ...profile });
}));

// Update expiry date or active flag
router.put("/:id", authenticate, requireRole(["ADMIN"]), asyncHandler(async (req, res) => {
  const userId = parseInt(req.params.id);
  const { expiryDate, active } = req.body;

  const sets = [];
  const values = [];

  if (expiryDate !== undefined) {
    values.push(new Date(expiryDate));
    sets.push(`expiry_date = $${values.length}`);
  }
  if (active !== undefined) {
    values.push(Boolean(active));
    sets.push(`active = $${values.length}`);
  }
  if (sets.length === 0) {
    return res.status(400).json({ error: "Nothing to update" });
  }

  sets.push("updated_at = NOW()");
  values.push(userId, req.user.companyId);

  const result = await query(
    `UPDATE auditor_profiles SET ${sets.join(", ")}
     WHERE user_id = $${values.length - 1} AND company_id = $${values.length}
     RETURNING id, user_id, start_date, expiry_date, active`,
    values
  );
  if (result.rows.length === 0) {
    return res.status(404).json({ error: "Auditor not found" });
  }

  await writeAuditLog({
    userId:    req.user.userId,
    companyId: req.user.companyId,
    email:     req.user.email,
    action:    active === false ? "AUDITOR_DEACTIVATED" : "AUDITOR_UPDATED",
    resource:  "auditor_profiles",
    detail:    { targetUserId: userId, expiryDate, active },
    ip:        req.ip
  });

  res.json(mapRow(result));
}));

// Delete auditor account entirely
router.delete("/:id", authenticate, requireRole(["ADMIN"]), asyncHandler(async (req, res) => {
  const userId = parseInt(req.params.id);

  const userCheck = await query(
    "SELECT id, email FROM users WHERE id = $1 AND company_id = $2 AND role = 'AUDITOR'",
    [userId, req.user.companyId]
  );
  if (userCheck.rows.length === 0) {
    return res.status(404).json({ error: "Auditor not found" });
  }

  await query("DELETE FROM users WHERE id = $1 AND company_id = $2", [userId, req.user.companyId]);

  await writeAuditLog({
    userId:    req.user.userId,
    companyId: req.user.companyId,
    email:     req.user.email,
    action:    "AUDITOR_DELETED",
    resource:  "auditor_profiles",
    detail:    { targetUserId: userId, targetEmail: userCheck.rows[0].email },
    ip:        req.ip
  });

  res.status(204).send();
}));

// Audit log viewer — paginated, newest first
router.get("/logs", authenticate, requireRole(["ADMIN"]), asyncHandler(async (req, res) => {
  const limit  = Math.min(parseInt(req.query.limit  || "100"), 500);
  const offset = parseInt(req.query.offset || "0");
  const userId = req.query.userId ? parseInt(req.query.userId) : null;

  const conditions = ["company_id = $1"];
  const values     = [req.user.companyId];

  if (userId) {
    values.push(userId);
    conditions.push(`user_id = $${values.length}`);
  }

  values.push(limit, offset);
  const result = await query(
    `SELECT id, user_id, email, action, resource, detail, ip, created_at
     FROM audit_logs
     WHERE ${conditions.join(" AND ")}
     ORDER BY created_at DESC
     LIMIT $${values.length - 1} OFFSET $${values.length}`,
    values
  );

  const countResult = await query(
    `SELECT COUNT(*) AS n FROM audit_logs WHERE ${conditions.join(" AND ")}`,
    values.slice(0, values.length - 2)
  );

  res.json({
    logs:  mapRows(result),
    total: parseInt(countResult.rows[0].n)
  });
}));

export default router;
