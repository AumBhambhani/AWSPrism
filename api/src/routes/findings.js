import { Router } from "express";
import { query, mapRow, mapRows, buildUpdate } from "../db/index.js";
import { authenticate } from "../middleware/auth.js";
import { requireRole, requireReadOnly } from "../middleware/roles.js";
import { asyncHandler } from "../utils/asyncHandler.js";
import { writeAuditLog } from "../utils/auditLog.js";
import { resolveQuestionsForTestKey, resolveQuestionsForTestKeys } from "../utils/questionResolution.js";

const router = Router();

router.get("/", authenticate, requireReadOnly(["ADMIN", "LEAD", "CONTRIBUTOR", "REVIEWER"]), asyncHandler(async (req, res) => {
  const { status, severity, connectionId } = req.query;
  const conditions = ["company_id = $1"];
  const values = [req.user.companyId];
  if (status) { values.push(status); conditions.push(`status = $${values.length}`); }
  if (severity) { values.push(severity); conditions.push(`severity = $${values.length}`); }
  if (connectionId) { values.push(parseInt(connectionId)); conditions.push(`connection_id = $${values.length}`); }
  const result = await query(
    `SELECT * FROM findings WHERE ${conditions.join(" AND ")} ORDER BY
       CASE severity WHEN 'critical' THEN 0 WHEN 'high' THEN 1 WHEN 'medium' THEN 2 ELSE 3 END,
       last_detected_at DESC`,
    values
  );
  const findings = mapRows(result);
  const testKeys = [...new Set(findings.map((f) => f.testKey))];
  const questionsByTestKey = await resolveQuestionsForTestKeys({ companyId: req.user.companyId, testKeys });
  for (const finding of findings) {
    finding.questIds = questionsByTestKey.get(finding.testKey) || [];
  }
  res.json(findings);
}));

router.put("/:id", authenticate, requireRole(["ADMIN", "LEAD"]), asyncHandler(async (req, res) => {
  const { status } = req.body;
  const allowed = ["open", "acknowledged", "resolved", "suppressed", "false_positive"];
  if (!allowed.includes(status)) {
    return res.status(400).json({ error: `status must be one of: ${allowed.join(", ")}` });
  }
  const data = {
    status,
    resolved_at: status === "resolved" ? new Date() : null,
    resolved_by: status === "resolved" ? req.user.userId : null,
  };
  const update = buildUpdate(data);
  const result = await query(
    `UPDATE findings SET ${update.set} WHERE id = $${update.values.length + 1} AND company_id = $${update.values.length + 2} RETURNING *`,
    [...update.values, parseInt(req.params.id), req.user.companyId]
  );
  if (result.rows.length === 0) return res.status(404).json({ error: "Finding not found" });
  await writeAuditLog({ userId: req.user.userId, companyId: req.user.companyId, action: "FINDING_STATUS_CHANGED", resource: "findings", detail: { findingId: parseInt(req.params.id), status } });
  res.json(mapRow(result));
}));

router.post("/:id/promote", authenticate, requireRole(["ADMIN", "LEAD"]), asyncHandler(async (req, res) => {
  const findingId = parseInt(req.params.id);
  const findingResult = await query(`SELECT * FROM findings WHERE id = $1 AND company_id = $2`, [findingId, req.user.companyId]);
  const finding = mapRow(findingResult);
  if (!finding) return res.status(404).json({ error: "Finding not found" });
  if (finding.linkedActionId) return res.status(409).json({ error: "Finding is already linked to an action", code: "ALREADY_PROMOTED" });

  const { owner, dueDate } = req.body;
  const questIds = await resolveQuestionsForTestKey({ companyId: req.user.companyId, testKey: finding.testKey });
  const actionResult = await query(
    `INSERT INTO actions (company_id, defeated_quest, owner, due_date, status, notes, finding_id, quest_id)
     VALUES ($1, $2, $3, $4, 'OPEN', $5, $6, $7) RETURNING *`,
    [req.user.companyId, finding.title, owner || null, dueDate || null, finding.description, findingId, questIds[0] ?? null]
  );
  const action = mapRow(actionResult);

  await query(`UPDATE findings SET linked_action_id = $1 WHERE id = $2 AND company_id = $3`, [action.id, findingId, req.user.companyId]);
  await writeAuditLog({ userId: req.user.userId, companyId: req.user.companyId, action: "FINDING_PROMOTED_TO_ACTION", resource: "findings", detail: { findingId, actionId: action.id } });

  res.status(201).json({ ...action, findingId, questIds });
}));

export default router;
