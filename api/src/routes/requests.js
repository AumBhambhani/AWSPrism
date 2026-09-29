import { Router } from "express";
import multer from "multer";
import path from "path";
import fs from "fs";
import { mapRow, mapRows, query } from "../db/index.js";
import { authenticate } from "../middleware/auth.js";
import { requireRole } from "../middleware/roles.js";
import { asyncHandler } from "../utils/asyncHandler.js";
import { sendEmail } from "../utils/email.js";
import { buildEmailHtml } from "../utils/emailTemplate.js";
import { FulfilError, fulfilEvidenceRequest } from "../utils/evidenceRequestFulfil.js";

const router = Router();

const WRITERS = ["ADMIN", "LEAD", "CONTRIBUTOR"];
const MANAGERS = ["ADMIN", "LEAD"];

const BASE_SELECT = `
  SELECT
    er.id, er.assessment_id, er.question_id, er.artifact_group_id,
    er.requester_id, er.assignee_id, er.title, er.description,
    er.priority, er.due_date, er.status, er.fulfilled_evidence_id,
    er.created_at, er.updated_at, er.completed_at,
    COALESCE(ru.full_name, ru.email) AS requester_name, ru.email AS requester_email,
    COALESCE(au.full_name, au.email) AS assignee_name, au.email AS assignee_email,
    q.baseline_question, q.control_area, q.module_name,
    ev.title AS evidence_title, ev.file_name AS evidence_file_name,
    ev.file_type AS evidence_file_type, ev.file_size AS evidence_file_size
  FROM evidence_requests er
  JOIN users ru ON ru.id = er.requester_id
  LEFT JOIN users au ON au.id = er.assignee_id AND au.company_id = er.company_id
  LEFT JOIN LATERAL (
    SELECT baseline_question, control_area, module_name
    FROM questions
    WHERE quest_id = er.question_id AND (company_id = $1 OR company_id IS NULL)
    ORDER BY company_id ASC NULLS LAST LIMIT 1
  ) q ON er.question_id IS NOT NULL
  LEFT JOIN evidence_vault ev ON ev.id = er.fulfilled_evidence_id AND ev.company_id = er.company_id
`;

const PRIORITIES = ["Critical", "High", "Medium", "Low"];

const parseId = (v) => {
  if ((typeof v !== "string" && typeof v !== "number") || !/^[0-9]+$/.test(String(v))) return NaN;
  const n = parseInt(v, 10);
  return n >= 1 && n <= 2147483647 ? n : NaN; // Postgres int4
};

// A real calendar date (YYYY-MM-DD) Postgres will accept — Date.parse also takes
// 2026-02-30 and trailing junk.
const isValidDueDate = (v) => {
  if (typeof v !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(v)) return false;
  const d = new Date(`${v}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.getUTCFullYear() >= 1 && d.toISOString().slice(0, 10) === v; // Postgres has no year 0
};

// Every foreign reference on a request must belong to the caller's tenant.
// Returns an error string, or null when all supplied references are valid.
async function validateReferences(cid, { assessmentId, questionId, artifactGroupId, assigneeId }) {
  if (assessmentId) {
    const id = parseId(assessmentId);
    if (Number.isNaN(id)) return "Invalid assessmentId";
    const r = await query("SELECT 1 FROM assessments WHERE id = $1 AND company_id = $2", [id, cid]);
    if (r.rows.length === 0) return "Assessment not found";
  }
  if (questionId) {
    if (typeof questionId !== "string") return "Invalid questionId";
    const r = await query("SELECT 1 FROM questions WHERE quest_id = $1 AND (company_id = $2 OR company_id IS NULL) LIMIT 1", [questionId, cid]);
    if (r.rows.length === 0) return "Question not found";
  }
  if (artifactGroupId && Number.isNaN(parseId(artifactGroupId))) return "Invalid artifactGroupId";
  if (assigneeId) {
    const id = parseId(assigneeId);
    if (Number.isNaN(id)) return "Invalid assigneeId";
    const r = await query("SELECT 1 FROM users WHERE id = $1 AND company_id = $2", [id, cid]);
    if (r.rows.length === 0) return "Assignee not found";
  }
  return null;
}

// ── GET /api/requests/users — assignable user list for all writers ──
router.get("/users", authenticate, requireRole(WRITERS), asyncHandler(async (req, res) => {
  const result = await query(
    `SELECT id, email, COALESCE(full_name, email) AS name, role
     FROM users
     WHERE company_id = $1 AND role NOT IN ('REVIEWER', 'AUDITOR')
     ORDER BY
       CASE role WHEN 'ADMIN' THEN 1 WHEN 'LEAD' THEN 2 WHEN 'CONTRIBUTOR' THEN 3 ELSE 4 END,
       COALESCE(full_name, email)`,
    [req.user.companyId]
  );
  res.json(result.rows.map(r => ({ id: r.id, email: r.email, name: r.name, role: r.role })));
}));

// ── GET /api/requests — list with role-based scoping ──
router.get("/", authenticate, requireRole(WRITERS), asyncHandler(async (req, res) => {
  const cid = req.user.companyId;
  const { role, userId } = req.user;
  const { mine, status, priority, search } = req.query;

  const params = [cid];
  let conditions = "WHERE er.company_id = $1";
  let idx = 2;

  // CONTRIBUTOR always sees only their own; ADMIN/LEAD can see all or use ?mine=true
  if (role === "CONTRIBUTOR" || mine === "true") {
    conditions += ` AND (er.requester_id = $${idx} OR er.assignee_id = $${idx})`;
    params.push(userId);
    idx++;
  }

  if (status) {
    conditions += ` AND er.status = $${idx++}`;
    params.push(status);
  }
  if (priority) {
    conditions += ` AND er.priority = $${idx++}`;
    params.push(priority);
  }
  if (search) {
    conditions += ` AND (er.title ILIKE $${idx} OR er.description ILIKE $${idx})`;
    params.push(`%${search}%`);
    idx++;
  }

  const result = await query(
    `${BASE_SELECT} ${conditions} ORDER BY
      CASE er.status WHEN 'Open' THEN 1 WHEN 'In Progress' THEN 2 WHEN 'Submitted' THEN 3 WHEN 'Completed' THEN 5 WHEN 'Cancelled' THEN 6 ELSE 4 END,
      er.due_date ASC NULLS LAST,
      er.created_at DESC`,
    params
  );
  res.json(mapRows(result));
}));

// ── GET /api/requests/:id — detail with comments ──
router.get("/:id", authenticate, requireRole(WRITERS), asyncHandler(async (req, res) => {
  const cid = req.user.companyId;
  const id = parseInt(req.params.id);
  const { role, userId } = req.user;

  const result = await query(
    `${BASE_SELECT} WHERE er.id = $2 AND er.company_id = $1`,
    [cid, id]
  );
  const item = mapRow(result);
  if (!item) return res.status(404).json({ error: "Request not found" });

  // CONTRIBUTOR can only view their own
  if (role === "CONTRIBUTOR" && item.requesterId !== userId && item.assigneeId !== userId) {
    return res.status(403).json({ error: "Forbidden" });
  }

  const commentsResult = await query(
    `SELECT erc.id, erc.body, erc.created_at,
            COALESCE(u.full_name, u.email) AS author_name, u.email AS author_email
     FROM evidence_request_comments erc
     JOIN users u ON u.id = erc.author_id
     WHERE erc.request_id = $1
     ORDER BY erc.created_at ASC`,
    [id]
  );
  item.comments = mapRows(commentsResult);
  res.json(item);
}));

// ── POST /api/requests — create ──
router.post("/", authenticate, requireRole(WRITERS), asyncHandler(async (req, res) => {
  const cid = req.user.companyId;
  const userId = req.user.userId;
  const { assessmentId, questionId, artifactGroupId, assigneeId, title, description, priority, dueDate } = req.body;

  if (typeof title !== "string" || !title.trim()) return res.status(400).json({ error: "title is required" });
  if (description != null && typeof description !== "string") return res.status(400).json({ error: "description must be text" });
  if (dueDate && !isValidDueDate(dueDate)) return res.status(400).json({ error: "Invalid dueDate" });
  if (priority !== undefined && !PRIORITIES.includes(priority)) return res.status(400).json({ error: "Invalid priority" });

  const refError = await validateReferences(cid, { assessmentId, questionId, artifactGroupId, assigneeId });
  if (refError) return res.status(400).json({ error: refError });

  const result = await query(
    `INSERT INTO evidence_requests
       (company_id, assessment_id, question_id, artifact_group_id,
        requester_id, assignee_id, title, description, priority, due_date)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
     RETURNING id`,
    [
      cid,
      assessmentId ? parseInt(assessmentId) : null,
      questionId || null,
      artifactGroupId ? parseInt(artifactGroupId) : null,
      userId,
      assigneeId ? parseInt(assigneeId) : null,
      title.trim(),
      description?.trim() || null,
      priority || "Medium",
      dueDate || null
    ]
  );

  const id = result.rows[0].id;
  const detailResult = await query(`${BASE_SELECT} WHERE er.id = $2 AND er.company_id = $1`, [cid, id]);
  const item = mapRow(detailResult);

  // Notify assignee
  if (assigneeId) {
    const assigneeResult = await query("SELECT email, COALESCE(full_name, email) AS name FROM users WHERE id = $1 AND company_id = $2", [parseInt(assigneeId), cid]);
    if (assigneeResult.rows[0]) {
      const { email, name } = assigneeResult.rows[0];
      sendEmail({
        to: email,
        subject: `Evidence Request assigned to you — ${title.trim()}`,
        text: [
          `Hi ${name},`,
          ``,
          `You have been assigned an evidence request in PRISM.`,
          ``,
          `Title: ${title.trim()}`,
          `Priority: ${priority || "Medium"}`,
          `Due Date: ${dueDate || "No due date"}`,
          description ? `Description: ${description.trim()}` : "",
          ``,
          `Please log in to PRISM to view and fulfil this request.`
        ].filter(l => l !== undefined).join("\n"),
        html: buildEmailHtml({
          heading: "Evidence Request Assigned to You",
          preheader: `You've been assigned: ${title.trim()}`,
          body: `Hi ${name}, you have been assigned an evidence request in PRISM. Please review the details below and upload the required evidence.`,
          details: [
            { label: "Title",    value: title.trim() },
            { label: "Priority", value: priority || "Medium" },
            { label: "Due Date", value: dueDate || "No due date" },
            description?.trim() ? { label: "Description", value: description.trim() } : null,
          ].filter(Boolean),
          cta: { text: "View Request in PRISM", url: process.env.WEB_URL || "https://prismgrc.co" },
        }),
      }).catch(() => {});
    }
  }

  res.status(201).json(item);
}));

// ── PUT /api/requests/:id — update metadata or status ──
router.put("/:id", authenticate, requireRole(WRITERS), asyncHandler(async (req, res) => {
  const cid = req.user.companyId;
  const id = parseInt(req.params.id);
  const { role, userId } = req.user;
  const { title, description, priority, dueDate, assigneeId, status } = req.body;

  const existing = await query(
    "SELECT id, requester_id, assignee_id, status, title FROM evidence_requests WHERE id = $1 AND company_id = $2",
    [id, cid]
  );
  if (existing.rows.length === 0) return res.status(404).json({ error: "Request not found" });
  const er = existing.rows[0];

  // Permission: CONTRIBUTOR can only update own requests (as requester or assignee)
  if (role === "CONTRIBUTOR" && er.requester_id !== userId && er.assignee_id !== userId) {
    return res.status(403).json({ error: "Forbidden" });
  }
  // Cannot update Completed or Cancelled requests (except ADMIN)
  if (role === "CONTRIBUTOR" && ["Completed", "Cancelled"].includes(er.status)) {
    return res.status(409).json({ error: `Cannot update a ${er.status} request` });
  }

  // The due date, priority and assignee are the manager's (or the requester's) call; an
  // assignee only works the request. A submitted request stays in the manager's queue
  // until they complete it or send it back (closure review C).
  if (role === "CONTRIBUTOR" && er.requester_id !== userId
      && (title !== undefined || description !== undefined || priority !== undefined || dueDate !== undefined || assigneeId !== undefined)) {
    return res.status(403).json({ error: "Only the requester, an admin or a lead can change this request's details" });
  }
  if (role === "CONTRIBUTOR" && status !== undefined && er.status === "Submitted" && status !== "Submitted") {
    return res.status(403).json({ error: "Only an admin or lead can send a submitted request back" });
  }
  if ((title !== undefined && typeof title !== "string") || (description != null && typeof description !== "string")) {
    return res.status(400).json({ error: "title and description must be text" });
  }
  if (dueDate && !isValidDueDate(dueDate)) {
    return res.status(400).json({ error: "Invalid dueDate" });
  }
  if (priority !== undefined && !PRIORITIES.includes(priority)) return res.status(400).json({ error: "Invalid priority" });
  const refError = await validateReferences(cid, { assigneeId });
  if (refError) return res.status(400).json({ error: refError });

  const updates = [];
  const params = [cid, id];
  let idx = 3;

  if (title !== undefined) { updates.push(`title = $${idx++}`); params.push(title.trim() || er.title); }
  if (description !== undefined) { updates.push(`description = $${idx++}`); params.push(description?.trim() || null); }
  if (priority !== undefined) { updates.push(`priority = $${idx++}`); params.push(priority); }
  if (dueDate !== undefined) { updates.push(`due_date = $${idx++}`); params.push(dueDate || null); }
  if (assigneeId !== undefined) { updates.push(`assignee_id = $${idx++}`); params.push(assigneeId ? parseInt(assigneeId) : null); }

  if (status !== undefined) {
    const VALID = ["Open", "In Progress", "Submitted", "Completed", "Cancelled"];
    if (!VALID.includes(status)) return res.status(400).json({ error: "Invalid status" });
    // F-17: a contributor may only move a request along (Open / In Progress). Submitted
    // comes from attaching evidence (fulfil), Completed/Cancelled are manager decisions
    // (cancel by the requester goes through DELETE) — matching what the UI offers.
    if (role === "CONTRIBUTOR" && !["Open", "In Progress"].includes(status)) {
      return res.status(403).json({ error: "Only an admin or lead can set a request to " + status });
    }
    updates.push(`status = $${idx++}`);
    params.push(status);
    if (status === "Completed") {
      updates.push(`completed_at = NOW()`);
    }
  }

  if (updates.length === 0) return res.status(400).json({ error: "No fields to update" });
  updates.push("updated_at = NOW()");

  const result = await query(
    `UPDATE evidence_requests SET ${updates.join(", ")} WHERE company_id = $1 AND id = $2 RETURNING id`,
    params
  );
  if (result.rowCount === 0) return res.status(404).json({ error: "Request not found" });

  // Notify new assignee if changed
  if (assigneeId && parseInt(assigneeId) !== er.assignee_id) {
    const assigneeResult = await query("SELECT email, COALESCE(full_name, email) AS name FROM users WHERE id = $1 AND company_id = $2", [parseInt(assigneeId), cid]);
    if (assigneeResult.rows[0]) {
      const { email, name } = assigneeResult.rows[0];
      const reqTitle = title?.trim() || er.title;
      sendEmail({
        to: email,
        subject: `Evidence Request assigned to you — ${reqTitle}`,
        text: `Hi ${name},\n\nYou have been assigned an evidence request in PRISM: "${reqTitle}".\n\nPlease log in to PRISM to view and fulfil this request.`,
        html: buildEmailHtml({
          heading: "Evidence Request Assigned to You",
          preheader: `You've been assigned: ${reqTitle}`,
          body: `Hi ${name}, you have been assigned an evidence request in PRISM. Please review the details below and upload the required evidence.`,
          details: [
            { label: "Title", value: reqTitle },
          ],
          cta: { text: "View Request in PRISM", url: process.env.WEB_URL || "https://prismgrc.co" },
        }),
      }).catch(() => {});
    }
  }

  const detailResult = await query(`${BASE_SELECT} WHERE er.id = $2 AND er.company_id = $1`, [cid, result.rows[0].id]);
  res.json(mapRow(detailResult));
}));

// ── POST /api/requests/:id/fulfill — attach vault evidence ──
router.post("/:id/fulfill", authenticate, requireRole(WRITERS), asyncHandler(async (req, res) => {
  const cid = req.user.companyId;
  const id = parseInt(req.params.id);
  const { role, userId } = req.user;
  const { vaultId } = req.body;

  if (!vaultId) return res.status(400).json({ error: "vaultId is required" });
  const vid = parseId(vaultId);
  if (Number.isNaN(vid)) return res.status(400).json({ error: "Invalid vaultId" });

  try {
    await fulfilEvidenceRequest({ companyId: cid, requestId: id, vaultId: vid, actor: { userId, role, email: req.user.email } });
  } catch (e) {
    if (e instanceof FulfilError) return res.status(e.status).json(e.body);
    throw e;
  }

  const detailResult = await query(`${BASE_SELECT} WHERE er.id = $2 AND er.company_id = $1`, [cid, id]);
  const updated = mapRow(detailResult);
  const commentsResult = await query(
    `SELECT erc.id, erc.body, erc.created_at,
            COALESCE(u.full_name, u.email) AS author_name, u.email AS author_email
     FROM evidence_request_comments erc
     JOIN users u ON u.id = erc.author_id
     WHERE erc.request_id = $1 ORDER BY erc.created_at ASC`,
    [id]
  );
  updated.comments = mapRows(commentsResult);
  res.json(updated);
}));

// ── POST /api/requests/:id/comments — add comment ──
router.post("/:id/comments", authenticate, requireRole(WRITERS), asyncHandler(async (req, res) => {
  const cid = req.user.companyId;
  const id = parseInt(req.params.id);
  const { role, userId } = req.user;
  const { body } = req.body;

  if (!body?.trim()) return res.status(400).json({ error: "Comment body is required" });

  // Check request exists and user has access
  const erCheck = await query("SELECT id, requester_id, assignee_id FROM evidence_requests WHERE id = $1 AND company_id = $2", [id, cid]);
  if (erCheck.rows.length === 0) return res.status(404).json({ error: "Request not found" });
  const er = erCheck.rows[0];

  if (role === "CONTRIBUTOR" && er.requester_id !== userId && er.assignee_id !== userId) {
    return res.status(403).json({ error: "Forbidden" });
  }

  const result = await query(
    `WITH inserted AS (
       INSERT INTO evidence_request_comments (request_id, company_id, author_id, body)
       VALUES ($1, $2, $3, $4)
       RETURNING *
     )
     SELECT inserted.*, COALESCE(u.full_name, u.email) AS author_name, u.email AS author_email
     FROM inserted JOIN users u ON u.id = inserted.author_id`,
    [id, cid, userId, body.trim()]
  );
  res.status(201).json(mapRow(result));
}));

// ── DELETE /api/requests/:id — cancel ──
router.delete("/:id", authenticate, requireRole(WRITERS), asyncHandler(async (req, res) => {
  const cid = req.user.companyId;
  const id = parseInt(req.params.id);
  const { role, userId } = req.user;

  const existing = await query(
    "SELECT id, requester_id, status FROM evidence_requests WHERE id = $1 AND company_id = $2",
    [id, cid]
  );
  if (existing.rows.length === 0) return res.status(404).json({ error: "Request not found" });
  const er = existing.rows[0];

  const isAdmin = MANAGERS.includes(role);
  const isRequester = er.requester_id === userId;

  if (!isAdmin && !isRequester) return res.status(403).json({ error: "Forbidden" });
  if (!isAdmin && er.status !== "Open") return res.status(409).json({ error: "Only Open requests can be cancelled by the requester" });
  if (er.status === "Completed") return res.status(409).json({ error: "Completed requests cannot be deleted" });

  // Soft cancel (preserve the record) vs hard delete — use soft cancel (status = Cancelled)
  await query(
    "UPDATE evidence_requests SET status = 'Cancelled', updated_at = NOW() WHERE id = $1 AND company_id = $2",
    [id, cid]
  );
  res.status(204).send();
}));

export default router;
