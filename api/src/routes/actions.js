import { Router } from "express";
import { buildUpdate, mapRow, mapRows, query } from "../db/index.js";
import { isQuestionVisible } from "../db/effectiveRows.js";
import { authenticate } from "../middleware/auth.js";
import { requireRole, requireReadOnly } from "../middleware/roles.js";
import { asyncHandler } from "../utils/asyncHandler.js";
import { writeAuditLog } from "../utils/auditLog.js";
import { sanitiseFields } from "../utils/sanitise.js";
import { buildFindingNarrative } from "../data/findingGuidance.js";

const router = Router();

router.get("/", authenticate, requireReadOnly(["ADMIN", "LEAD", "CONTRIBUTOR", "REVIEWER"]), asyncHandler(async (req, res) => {
  if (req.user.role === "AUDITOR") {
    await writeAuditLog({ userId: req.user.userId, companyId: req.user.companyId, email: req.user.email, action: "READ", resource: "actions", ip: req.ip });
  }
  const { questId, status, findingId } = req.query;
  const conditions = ["a.company_id = $1"];
  const values = [req.user.companyId];

  if (questId) {
    values.push(questId);
    conditions.push(`a.quest_id = $${values.length}`);
  }

  if (status) {
    values.push(status);
    conditions.push(`a.status = $${values.length}`);
  }

  if (findingId) {
    values.push(parseInt(findingId));
    conditions.push(`a.finding_id = $${values.length}`);
  }

  const result = await query(
    `SELECT a.*,
      f.title AS finding_title, f.severity AS finding_severity, f.status AS finding_status,
      f.test_key AS finding_test_key, f.resource_id AS finding_resource_id, f.description AS finding_description,
      at.description AS test_description, at.remediation_guidance AS raw_remediation_guidance,
      ic.name AS connection_name,
      CASE WHEN a.due_date IS NOT NULL AND a.due_date < NOW() AND COALESCE(UPPER(a.status), 'OPEN') NOT IN ('CLOSED', 'DONE', 'COMPLETED') THEN true ELSE false END AS is_overdue
     FROM actions a
     LEFT JOIN findings f ON f.id = a.finding_id
     LEFT JOIN automated_tests at ON at.test_key = f.test_key
     LEFT JOIN integration_connections ic ON ic.id = f.connection_id
     WHERE ${conditions.join(" AND ")}
     ORDER BY
       CASE WHEN a.due_date IS NOT NULL AND a.due_date < NOW() AND COALESCE(UPPER(a.status),'OPEN') NOT IN ('CLOSED','DONE','COMPLETED') THEN 0 ELSE 1 END,
       a.due_date ASC NULLS LAST,
       a.created_at DESC`,
    values
  );
  const actions = mapRows(result);
  for (const row of actions) {
    if (row.findingTestKey) {
      const narrative = buildFindingNarrative({
        testKey: row.findingTestKey,
        title: row.findingTitle,
        message: row.findingDescription,
        severity: row.findingSeverity,
        dbDescription: row.testDescription,
        dbRemediation: row.rawRemediationGuidance,
        resourceId: row.findingResourceId,
        connectionName: row.connectionName,
      });
      row.remediationTip = {
        immediateAction: narrative.immediateAction,
        targetArchitecture: narrative.targetArchitecture,
        steps: narrative.remediationSteps,
      };
    }
    delete row.findingTestKey;
    delete row.findingResourceId;
    delete row.findingDescription;
    delete row.testDescription;
    delete row.rawRemediationGuidance;
    delete row.connectionName;
  }
  res.json(actions);
}));

router.post("/", authenticate, requireRole(["ADMIN", "LEAD", "CONTRIBUTOR"]), asyncHandler(async (req, res) => {
  const {
    actionId, month, moduleId, questId,
    defeatedQuest, currentLevel, targetLevel,
    immediateActionRequired, owner, dueDate, status,
    closureEvidenceLink, reviewer, closureDate, notes
  } = sanitiseFields(req.body, {
    defeatedQuest: "text", owner: "text", reviewer: "text",
    notes: "text", closureEvidenceLink: "url",
  });

  if (!(await isQuestionVisible(query, req.user.companyId, questId))) return res.status(400).json({ error: "Question not found" });

  const result = await query(
    "INSERT INTO actions (action_id, month, module_id, quest_id, company_id, defeated_quest, current_level, target_level, immediate_action_required, owner, due_date, status, closure_evidence_link, reviewer, closure_date, notes) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16) RETURNING *",
    [
      actionId || null,
      month || null,
      moduleId || null,
      questId || null,
      req.user.companyId,
      defeatedQuest || null,
      currentLevel ?? null,
      targetLevel ?? null,
      immediateActionRequired ?? null,
      owner || null,
      dueDate || null,
      status || null,
      closureEvidenceLink || null,
      reviewer || null,
      closureDate || null,
      notes || null
    ]
  );

  res.status(201).json(mapRow(result));
}));

router.put("/:id", authenticate, requireRole(["ADMIN", "LEAD", "CONTRIBUTOR"]), asyncHandler(async (req, res) => {
  const sanitised = sanitiseFields(req.body, {
    defeatedQuest: "text", owner: "text", reviewer: "text",
    notes: "text", closureEvidenceLink: "url",
  });
  const data = {
    action_id: sanitised.actionId,
    month: sanitised.month,
    module_id: sanitised.moduleId,
    quest_id: sanitised.questId,
    defeated_quest: sanitised.defeatedQuest,
    current_level: sanitised.currentLevel,
    target_level: sanitised.targetLevel,
    immediate_action_required: sanitised.immediateActionRequired,
    owner: sanitised.owner,
    due_date: sanitised.dueDate === undefined ? undefined : (sanitised.dueDate || null),
    status: sanitised.status,
    closure_evidence_link: sanitised.closureEvidenceLink,
    reviewer: sanitised.reviewer,
    closure_date: sanitised.closureDate === undefined ? undefined : (sanitised.closureDate || null),
    notes: sanitised.notes,
    updated_at: new Date()
  };

  const hasUpdates = Object.keys(data).some((key) => key !== "updated_at" && data[key] !== undefined);
  if (!hasUpdates) {
    return res.status(400).json({ error: "No fields to update" });
  }

  if (data.quest_id !== undefined && !(await isQuestionVisible(query, req.user.companyId, data.quest_id))) {
    return res.status(400).json({ error: "Question not found" });
  }

  const update = buildUpdate(data);
  const actionResult = await query(
    `UPDATE actions SET ${update.set} WHERE id = $${update.values.length + 1} AND company_id = $${update.values.length + 2} RETURNING *`,
    [...update.values, parseInt(req.params.id), req.user.companyId]
  );

  if (actionResult.rows.length === 0) {
    return res.status(404).json({ error: "Action not found" });
  }

  res.json(mapRow(actionResult));
}));

router.delete("/:id", authenticate, requireRole(["ADMIN", "LEAD"]), asyncHandler(async (req, res) => {
  const result = await query(
    "DELETE FROM actions WHERE id = $1 AND company_id = $2",
    [parseInt(req.params.id), req.user.companyId]
  );
  if (result.rowCount === 0) {
    return res.status(404).json({ error: "Action not found" });
  }
  res.status(204).send();
}));

export default router;
