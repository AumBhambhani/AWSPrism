import { Router } from "express";
import { mapRows, query } from "../db/index.js";
import { authenticate } from "../middleware/auth.js";
import { asyncHandler } from "../utils/asyncHandler.js";

const router = Router();

// GET /api/notifications — list notifications for the current user (newest first).
// ?limit=N (default 50, max 100) and ?before=<id> (cursor: return notifications
// older than this id) support paging through full history on the notifications page.
router.get("/", authenticate, asyncHandler(async (req, res) => {
  const limit = Math.min(parseInt(req.query.limit) || 50, 100);
  const conditions = ["user_id = $1", "company_id = $2"];
  const values = [req.user.userId, req.user.companyId];

  if (req.query.before) {
    const before = parseInt(req.query.before);
    if (Number.isInteger(before)) {
      values.push(before);
      conditions.push(`id < $${values.length}`);
    }
  }

  values.push(limit);
  const result = await query(
    `SELECT id, title, body, entity_type, entity_id, is_read, created_at
     FROM notifications
     WHERE ${conditions.join(" AND ")}
     ORDER BY created_at DESC, id DESC
     LIMIT $${values.length}`,
    values
  );
  res.json(mapRows(result));
}));

// GET /api/notifications/unread-count
router.get("/unread-count", authenticate, asyncHandler(async (req, res) => {
  const result = await query(
    "SELECT COUNT(*)::INT AS count FROM notifications WHERE user_id = $1 AND company_id = $2 AND is_read = false",
    [req.user.userId, req.user.companyId]
  );
  res.json({ count: result.rows[0].count });
}));

// POST /api/notifications/:id/read — mark one notification as read
router.post("/:id/read", authenticate, asyncHandler(async (req, res) => {
  const result = await query(
    "UPDATE notifications SET is_read = true WHERE id = $1 AND user_id = $2 AND company_id = $3",
    [parseInt(req.params.id), req.user.userId, req.user.companyId]
  );
  if (result.rowCount === 0) return res.status(404).json({ error: "Notification not found" });
  res.status(204).send();
}));

// POST /api/notifications/read-all — mark all as read
router.post("/read-all", authenticate, asyncHandler(async (req, res) => {
  await query(
    "UPDATE notifications SET is_read = true WHERE user_id = $1 AND company_id = $2 AND is_read = false",
    [req.user.userId, req.user.companyId]
  );
  res.status(204).send();
}));

export default router;
