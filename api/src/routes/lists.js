import { Router } from "express";
import { mapRow, mapRows, query } from "../db/index.js";
import { authenticate } from "../middleware/auth.js";
import { requireRole } from "../middleware/roles.js";
import { asyncHandler } from "../utils/asyncHandler.js";

const router = Router();

router.get("/", authenticate, asyncHandler(async (req, res) => {
  const { listName } = req.query;
  const values = [req.user.companyId];
  let sql = "SELECT * FROM list_items WHERE company_id = $1";

  if (listName) {
    values.push(listName);
    sql += ` AND list_name = $${values.length}`;
  }

  sql += " ORDER BY value ASC";
  const result = await query(sql, values);
  res.json(mapRows(result));
}));

router.post("/", authenticate, requireRole(["ADMIN", "LEAD"]), asyncHandler(async (req, res) => {
  const { listName, value, color } = req.body;

  if (!listName || !value) {
    return res.status(400).json({ error: "listName and value are required" });
  }

  const result = await query(
    "INSERT INTO list_items (list_name, value, color, company_id) VALUES ($1, $2, $3, $4) RETURNING *",
    [listName, value, color || null, req.user.companyId]
  );
  res.status(201).json(mapRow(result));
}));

router.delete("/:id", authenticate, requireRole(["ADMIN", "LEAD"]), asyncHandler(async (req, res) => {
  const itemId = parseInt(req.params.id);
  const result = await query(
    "DELETE FROM list_items WHERE id = $1 AND company_id = $2",
    [itemId, req.user.companyId]
  );

  if (result.rowCount === 0) {
    return res.status(404).json({ error: "List item not found" });
  }

  res.status(204).send();
}));

export default router;
