import { Router } from "express";
import { authenticate } from "../middleware/auth.js";
import { query } from "../db/index.js";
import { isQuestionVisible } from "../db/effectiveRows.js";
import { asyncHandler } from "../utils/asyncHandler.js";

const router = Router();

// GET /api/reminders/settings — get company reminder settings (default offsets)
// MUST be before /:id to avoid "settings" matching as an ID
router.get("/settings", authenticate, asyncHandler(async (req, res) => {
  const companyId = req.user?.companyId;
  if (!companyId) {
    return res.json({ defaultReminderOffsets: [7, 14, 30] });
  }

  const result = await query(
    "SELECT default_reminder_offsets FROM company_settings WHERE company_id = $1",
    [companyId]
  );

  if (result.rows.length === 0) {
    return res.json({ defaultReminderOffsets: [7, 14, 30] });
  }

  res.json({ defaultReminderOffsets: result.rows[0].default_reminder_offsets || [7, 14, 30] });
}));

// PUT /api/reminders/settings — update company reminder offsets
router.put("/settings", authenticate, asyncHandler(async (req, res) => {
  const companyId = req.user?.companyId;
  if (!companyId) {
    return res.status(400).json({ error: "No company context" });
  }
  if (req.user.role !== "ADMIN") {
    return res.status(403).json({ error: "Admin only" });
  }

  const { defaultReminderOffsets } = req.body;

  // Validate: must be array of positive integers
  if (!Array.isArray(defaultReminderOffsets) || 
      defaultReminderOffsets.some(v => !Number.isInteger(v) || v < 0)) {
    return res.status(400).json({ error: "defaultReminderOffsets must be an array of positive integers" });
  }

  // Sort descending for consistent display
  const sorted = [...defaultReminderOffsets].sort((a, b) => b - a);

  await query(
    `INSERT INTO company_settings (company_id, default_reminder_offsets) 
     VALUES ($1, $2) 
     ON CONFLICT (company_id) DO UPDATE SET default_reminder_offsets = $2, updated_at = NOW()`,
    [companyId, sorted]
  );

  res.json({ defaultReminderOffsets: sorted });
}));

// GET /api/reminders — get reminders for user's company
// Supports ?upcoming=true to filter only unsent future reminders
router.get("/", authenticate, asyncHandler(async (req, res) => {
  const companyId = req.user?.companyId;
  if (!companyId) {
    return res.json([]);
  }

  const { upcoming, questId, actionId } = req.query;

  let sql = `SELECT id, action_id, quest_id, module_id, reminder_type, remind_at, 
             recipient_email, message, sent, sent_at, created_at 
             FROM reminders WHERE company_id = $1`;
  const values = [companyId];

  if (upcoming === "true") {
    sql += ` AND sent = FALSE AND remind_at >= NOW()`;
  }

  if (questId) {
    values.push(questId);
    sql += ` AND quest_id = $${values.length}`;
  }

  if (actionId) {
    values.push(actionId);
    sql += ` AND action_id = $${values.length}`;
  }

  sql += ` ORDER BY remind_at ASC`;

  const result = await query(sql, values);
  res.json(result.rows);
}));

// POST /api/reminders — create a reminder
router.post("/", authenticate, asyncHandler(async (req, res) => {
  const companyId = req.user?.companyId;
  if (!companyId) {
    return res.status(400).json({ error: "No company context" });
  }
  if (!["ADMIN", "LEAD"].includes(req.user.role)) {
    return res.status(403).json({ error: "Admin or Lead only" });
  }

  const { message, remindAt, questId, moduleId, actionId, recipientEmail, reminderType } = req.body;
  if (!remindAt) {
    return res.status(400).json({ error: "remindAt is required" });
  }
  if (!(await isQuestionVisible(query, companyId, questId))) return res.status(400).json({ error: "Question not found" });

  const result = await query(
    `INSERT INTO reminders (company_id, message, remind_at, quest_id, module_id, action_id, recipient_email, reminder_type) 
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8) 
     RETURNING id, reminder_type, remind_at, message, sent, created_at`,
    [companyId, message || null, remindAt, questId || null, moduleId || null, actionId || null, recipientEmail || null, reminderType || 'action_due']
  );
  res.status(201).json(result.rows[0]);
}));

// DELETE /api/reminders/:id — delete a reminder
router.delete("/:id", authenticate, asyncHandler(async (req, res) => {
  if (!["ADMIN", "LEAD"].includes(req.user.role)) {
    return res.status(403).json({ error: "Admin or Lead only" });
  }
  const companyId = req.user?.companyId;
  const { id } = req.params;

  const result = await query(
    "DELETE FROM reminders WHERE id = $1 AND company_id = $2 RETURNING id",
    [id, companyId]
  );

  if (result.rows.length === 0) {
    return res.status(404).json({ error: "Reminder not found" });
  }

  res.json({ deleted: true });
}));

export default router;
