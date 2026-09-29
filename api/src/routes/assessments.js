import { Router } from "express";
import fs from "fs";
import path from "path";
import { buildUpdate, getClient, mapRow, mapRows, query } from "../db/index.js";
import { auditPeriodEndSql } from "../utils/auditCoverage.js";
import { AUDITED_LOCK_ERROR, approvedAssessmentsForEvidenceRow, hasAuditedApproval, reopenReviewForChangedEvidenceRow } from "../utils/approvedEvidence.js";
import { authenticate } from "../middleware/auth.js";
import { requireRole, requireReadOnly } from "../middleware/roles.js";
import { asyncHandler } from "../utils/asyncHandler.js";
import { writeAuditLog } from "../utils/auditLog.js";
import { sanitiseFields } from "../utils/sanitise.js";
import { notifyReviewers } from "../utils/notifyReviewers.js";
import { getQuestDepartments, getUserScope, leadScopeViolation } from "../utils/departmentScope.js";

const router = Router();

const VALID_MONTH = /^\d{4}-(0[1-9]|1[0-2])$/;

// Question context copied onto remediation actions: the caller's own copy first, then
// the global template — never another tenant's copy of the same quest_id (F-14).
const QUESTION_CONTEXT_SQL = `SELECT control_area, baseline_question, default_owner FROM questions
  WHERE quest_id = $1 AND (company_id = $2 OR company_id IS NULL)
  ORDER BY company_id ASC NULLS LAST, id ASC LIMIT 1`;

router.get("/", authenticate, requireReadOnly(["ADMIN", "LEAD", "CONTRIBUTOR", "REVIEWER", "AUDITOR"]), asyncHandler(async (req, res) => {
  if (req.user.role === "AUDITOR") {
    await writeAuditLog({ userId: req.user.userId, companyId: req.user.companyId, email: req.user.email, action: "READ", resource: "assessments", ip: req.ip });
  }
  const { questId, month, moduleId, reviewStatus, scope } = req.query;
  const conditions = ["company_id = $1"];
  const values = [req.user.companyId];

  // Soft department scoping: only when the client asks for "my departments".
  if (scope === "mine") {
    const userScope = await getUserScope(req.user);
    if (!userScope.all) {
      values.push(userScope.departmentIds);
      conditions.push(`quest_id IN (
        SELECT qd.quest_id FROM question_departments qd
        WHERE qd.company_id = $1 AND qd.department_id = ANY($${values.length}::int[]))`);
    }
  }

  if (questId) {
    values.push(questId);
    conditions.push(`quest_id = $${values.length}`);
  }

  if (month) {
    values.push(month);
    conditions.push(`month = $${values.length}`);
  }

  if (moduleId) {
    values.push(moduleId);
    conditions.push(`module_id = $${values.length}`);
  }

  if (reviewStatus) {
    // Accepts a single status or a comma-separated list (e.g. "FINISHED,AUDITED"
    // for the auditor queue).
    const statuses = String(reviewStatus).split(",").map((s) => s.trim()).filter(Boolean);
    if (statuses.length === 1) {
      values.push(statuses[0]);
      conditions.push(`review_status = $${values.length}`);
    } else if (statuses.length > 1) {
      const placeholders = statuses.map((s) => {
        values.push(s);
        return `$${values.length}`;
      });
      conditions.push(`review_status IN (${placeholders.join(", ")})`);
    }
  }

  const result = await query(
    `SELECT a.*, act.owner AS action_owner, act.due_date AS action_due_date, act.notes AS action_notes
     FROM assessments a
     LEFT JOIN LATERAL (
       SELECT owner, due_date, notes FROM actions
       WHERE quest_id = a.quest_id AND company_id = a.company_id AND month = a.month
       ORDER BY created_at DESC LIMIT 1
     ) act ON true
     WHERE ${conditions.map(c => `a.${c}`).join(" AND ")} ORDER BY a.created_at DESC`,
    values
  );
  const rows = mapRows(result);
  const owners = await getQuestDepartments(req.user.companyId, [...new Set(rows.map((r) => r.questId).filter(Boolean))]);
  res.json(rows.map((r) => ({ ...r, departments: owners.get(r.questId) || [] })));
}));

const VALID_REVIEW_STATUSES = new Set(["Submitted", "WIP", "FINISHED", "AUDITED"]);

router.post("/", authenticate, requireRole(["ADMIN", "LEAD", "CONTRIBUTOR"]), asyncHandler(async (req, res) => {
  const raw = sanitiseFields(req.body, {
    controlArea: "text", answer: "text", owner: "text", reviewer: "text",
    comments: "text", evidenceLink: "url", actionOwner: "text", actionNotes: "text",
  });
  if (raw.reviewStatus !== undefined && !VALID_REVIEW_STATUSES.has(raw.reviewStatus)) {
    raw.reviewStatus = null;
  }
  const {
    assessmentId, month, moduleId, questId,
    controlArea = raw.controlArea,
    answer = raw.answer,
    currentLevel, level3Plus,
    evidenceLink = raw.evidenceLink,
    owner = raw.owner,
    reviewer = raw.reviewer,
    reviewStatus,
    comments = raw.comments,
    evidenceIds = [],
    actionOwner = raw.actionOwner,
    actionDueDate,
    actionNotes = raw.actionNotes
  } = raw;

  const normalizedAnswer = typeof answer === "string" ? answer.trim().toUpperCase() : "";
  const normalizedEvidenceIds = Array.isArray(evidenceIds)
    ? evidenceIds
        .filter((id) => (typeof id === "number" || typeof id === "string") && /^[0-9]{1,10}$/.test(String(id)))
        .map((id) => parseInt(id, 10))
        .filter((id) => id >= 1 && id <= 2147483647) // int4
    : [];
  const hasEvidenceLink = typeof evidenceLink === "string" && evidenceLink.trim().length > 0;
  const claimsCompliant = normalizedAnswer === "IMPLEMENTED" || normalizedAnswer === "YES";

  let linkedEvidenceCount = 0;
  let vaultLinkedCount = 0;

  if (reviewStatus !== "WIP") {
    if (claimsCompliant) {
      if (normalizedEvidenceIds.length > 0) {
        const evidenceResult = await query(
          `SELECT COUNT(*) AS n
           FROM evidence
           WHERE company_id = $1
             AND quest_id = $2
             AND ($3::text IS NULL OR month = $3)
             AND id = ANY($4::int[])`,
          [req.user.companyId, questId || null, month || null, normalizedEvidenceIds]
        );
        linkedEvidenceCount = parseInt(evidenceResult.rows[0].n, 10) || 0;
      }

      const vaultResult = await query(
        `SELECT COUNT(*) AS n FROM question_evidence WHERE company_id = $1 AND quest_id = $2`,
        [req.user.companyId, questId || null]
      );
      vaultLinkedCount = parseInt(vaultResult.rows[0].n, 10) || 0;

      if (!hasEvidenceLink && linkedEvidenceCount === 0 && vaultLinkedCount === 0) {
        return res.status(400).json({ error: "Implemented assessments require an evidence upload or evidence link before submission" });
      }
    }

    if (["NOT_IMPLEMENTED", "PARTIALLY_IMPLEMENTED", "PLANNED", "NO"].includes(normalizedAnswer)) {
      if (!actionDueDate || !actionOwner || !actionNotes) {
        return res.status(400).json({ error: `${normalizedAnswer.replace(/_/g, " ")} assessments require an action owner, due date, and notes` });
      }
    }
  }

  // F-07: reviewStatus/scoreEligible/reviewedBy/auditedBy must never be trusted
  // verbatim from the client on creation — Tracker.jsx's only two callers always send
  // reviewStatus="WIP" (draft) or, on submit, "Submitted" for an IMPLEMENTED/YES answer
  // (queued for reviewer approval) vs "FINISHED" for anything else (a self-reported gap
  // with nothing for a reviewer to verify — matches the "auto-FINISHED, no review
  // needed" comment on the notifyReviewers call below). A row can never have already
  // been reviewed/audited the moment it's created, and scoreEligible must reflect the
  // actual submitted content rather than an arbitrary client claim.
  const finalReviewStatus = VALID_REVIEW_STATUSES.has(reviewStatus) ? reviewStatus : null;
  if (finalReviewStatus === "AUDITED") {
    return res.status(400).json({ error: "reviewStatus 'AUDITED' cannot be set when creating an assessment" });
  }
  if (finalReviewStatus === "FINISHED" && claimsCompliant) {
    return res.status(400).json({ error: "An IMPLEMENTED/YES assessment cannot be created as FINISHED — submit it for review instead" });
  }
  const computedScoreEligible = finalReviewStatus !== "WIP"
    && claimsCompliant
    && Number(currentLevel) >= 3
    && (hasEvidenceLink || linkedEvidenceCount > 0 || vaultLinkedCount > 0);

  // A month is always YYYY-MM with a real month (audit-period maths casts it to a date).
  if (month !== undefined && month !== null && month !== "" && (typeof month !== "string" || !VALID_MONTH.test(month))) {
    return res.status(400).json({ error: "month must be in YYYY-MM format" });
  }

  // F-11: re-parenting evidence rows (evidenceIds) must not pull evidence out of an
  // AUDITED assessment; taking it from a FINISHED one sends that approval back for review.
  const reopenAfterCommit = [];
  const myEmail = String(req.user.email || "").toLowerCase();
  const isMine = (email) => String(email || "").toLowerCase() === myEmail;

  // An approved assessment of this control and month is replaced by a new row (the
  // Tracker and dashboard show the newest), so a new row may not displace an audit
  // unless an ADMIN makes it, and a contributor may not displace a colleague's approved
  // work — the same rules as reopening it via PUT (closure review 6A).
  if (month) {
    // Assessments are for the current period; a far-future month would become the
    // "newest" row on the dashboards (closure review 7A). 14h of slack covers clients
    // ahead of the server's clock.
    const future = await query("SELECT $1::text > to_char(NOW() + INTERVAL '14 hours', 'YYYY-MM') AS ahead", [month]);
    if (future.rows[0].ahead) return res.status(400).json({ error: "month cannot be in the future" });
  }
  if (questId && month && req.user.role !== "ADMIN") {
    // An audit keeps covering its control for its whole audited period (auditCoverage.js),
    // so a new row for a later month inside that period would displace it too.
    const coveringAudit = await query(
      `SELECT 1 FROM assessments a
       WHERE a.company_id = $1 AND a.quest_id = $2 AND a.review_status = 'AUDITED' AND a.archived_at IS NULL
         AND a.month < $3 AND COALESCE(a.audit_period_end, ${auditPeriodEndSql("a")}) >= ($3 || '-01')::date
       LIMIT 1`,
      [req.user.companyId, questId, month]
    );
    if (coveringAudit.rows.length > 0) {
      return res.status(409).json({ error: "This control is still inside an audited period. Only an auditor or an admin can reopen it.", code: "AUDITED" });
    }
  }
  if (questId && month) {
    const approvedHere = await query(
      `SELECT review_status, submitted_by FROM assessments
       WHERE company_id = $1 AND quest_id = $2 AND month = $3 AND archived_at IS NULL
         AND review_status IN ('FINISHED', 'AUDITED')`,
      [req.user.companyId, questId, month]
    );
    if (approvedHere.rows.some((a) => a.review_status === "AUDITED") && req.user.role !== "ADMIN") {
      return res.status(409).json({ error: "This control has been audited for this month. Only an auditor or an admin can reopen it.", code: "AUDITED" });
    }
    if (req.user.role === "CONTRIBUTOR" && approvedHere.rows.some((a) => !isMine(a.submitted_by))) {
      return res.status(403).json({ error: "This control was approved on someone else's submission. Ask them, a lead or an admin to reopen it.", code: "NOT_OWN_SUBMISSION" });
    }
  }

  if (normalizedEvidenceIds.length > 0) {
    const rowsToMove = await query(
      "SELECT id, quest_id, month, evidence_id, evidence_name, created_at FROM evidence WHERE company_id = $1 AND id = ANY($2::int[])",
      [req.user.companyId, normalizedEvidenceIds]
    );
    for (const row of rowsToMove.rows) {
      const approved = await approvedAssessmentsForEvidenceRow(req.user.companyId, row);
      if (hasAuditedApproval(approved)) return res.status(409).json(AUDITED_LOCK_ERROR);
      // A contributor may pick up a colleague's draft evidence (the Tracker sends every
      // row of the control and month), but may not take evidence from a colleague's
      // approved assessment — that would send their approval back for review.
      if (req.user.role === "CONTRIBUTOR" && approved.some((a) => !isMine(a.submittedBy))) {
        return res.status(403).json({ error: "This evidence is part of a colleague's approved assessment.", code: "NOT_OWN_EVIDENCE" });
      }
      if (approved.length > 0) reopenAfterCommit.push({ ids: approved.map((a) => a.id), title: row.evidence_name });
    }
  }

  // The question must be one this company can see (its own copy or a global template).
  if (questId) {
    const visible = await query(
      "SELECT 1 FROM questions WHERE quest_id = $1 AND (company_id = $2 OR company_id IS NULL) LIMIT 1",
      [questId, req.user.companyId]
    );
    if (visible.rows.length === 0) return res.status(400).json({ error: "Question not found" });
  }

  const submittedBy = req.user.email || null;
  const client = await getClient();

  try {
    await client.query("BEGIN");

    const result = await client.query(
      "INSERT INTO assessments (assessment_id, month, module_id, quest_id, company_id, control_area, answer, current_level, level3_plus, evidence_link, owner, submitted_by, reviewer, review_status, score_eligible, comments, reviewed_by, audited_by) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18) RETURNING *",
      [
        assessmentId || null,
        month || null,
        moduleId || null,
        questId || null,
        req.user.companyId,
        controlArea || null,
        normalizedAnswer || null,
        currentLevel ?? null,
        level3Plus ?? null,
        evidenceLink || null,
        owner || null,
        submittedBy,
        reviewer || null,
        finalReviewStatus,
        computedScoreEligible,
        comments || null,
        null, // reviewed_by: never set at creation — nothing has been reviewed yet
        null  // audited_by: never set at creation — nothing has been audited yet
      ]
    );

    const assessment = mapRow(result);

    if (normalizedEvidenceIds.length > 0) {
      const evidenceCheckResult = await client.query(
        `SELECT id FROM evidence WHERE company_id = $1 AND id = ANY($2::int[])`,
        [req.user.companyId, normalizedEvidenceIds]
      );
      const validEvidenceIds = evidenceCheckResult.rows.map(r => r.id);
      
      if (validEvidenceIds.length > 0) {
        await client.query(
          `UPDATE evidence
           SET evidence_id = $1, quest_id = $2, module_id = $3, month = $4, updated_at = NOW()
           WHERE company_id = $5 AND id = ANY($6::int[])`,
          [String(assessment.id), questId || null, moduleId || null, month || null, req.user.companyId, validEvidenceIds]
        );
      }
    }

    if (reviewStatus !== "WIP" && ["NOT_IMPLEMENTED", "PARTIALLY_IMPLEMENTED", "PLANNED", "NO"].includes(normalizedAnswer)) {
      const questionResult = await client.query(QUESTION_CONTEXT_SQL, [questId || null, req.user.companyId]);
      const question = questionResult.rows[0] || {};
      const actionResult = await client.query(
        `INSERT INTO actions
         (action_id, month, module_id, quest_id, company_id, defeated_quest, current_level, target_level,
          immediate_action_required, owner, due_date, status, notes)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, TRUE, $9, $10, 'OPEN', $11)
         RETURNING id`,
        [
          `assessment-${assessment.id}`,
          month || null,
          moduleId || null,
          questId || null,
          req.user.companyId,
          controlArea || question.control_area || question.baseline_question || questId || null,
          currentLevel ?? null,
          3,
          actionOwner || question.default_owner || owner || null,
          actionDueDate,
          actionNotes
        ]
      );

      // Auto-create reminders based on company default offsets
      if (actionDueDate && actionResult.rows.length > 0) {
        const actionId = actionResult.rows[0].id;
        const recipientEmail = actionOwner && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(actionOwner.trim())
          ? actionOwner.trim()
          : null;

        // Get company default reminder offsets
        const settingsResult = await client.query(
          "SELECT default_reminder_offsets FROM company_settings WHERE company_id = $1",
          [req.user.companyId]
        );
        const offsets = settingsResult.rows[0]?.default_reminder_offsets || [7, 14, 30];

        const dueDate = new Date(actionDueDate);
        for (const offsetDays of offsets) {
          const remindAt = new Date(dueDate);
          remindAt.setDate(remindAt.getDate() - offsetDays);
          // Only create reminder if it's in the future
          if (remindAt > new Date()) {
            await client.query(
              `INSERT INTO reminders (action_id, company_id, quest_id, module_id, reminder_type, remind_at, recipient_email, message)
               VALUES ($1, $2, $3, $4, 'action_due', $5, $6, $7)`,
              [
                actionId,
                req.user.companyId,
                questId || null,
                moduleId || null,
                remindAt.toISOString(),
                recipientEmail,
                `Action for "${controlArea || question.control_area || questId}" is due in ${offsetDays} days`
              ]
            );
          }
        }
      }
    }

    await client.query("COMMIT");
    for (const r of reopenAfterCommit) {
      await reopenReviewForChangedEvidenceRow({
        companyId: req.user.companyId, assessmentIds: r.ids, title: r.title,
        change: "evidence moved to another assessment", actor: req.user.email,
      });
    }

    // Notify reviewers only for IMPLEMENTED submissions (non-IMPLEMENTED answers are auto-FINISHED, no review needed)
    if (reviewStatus !== "WIP" && (normalizedAnswer === "IMPLEMENTED" || normalizedAnswer === "YES")) {
      notifyReviewers(req.user.companyId, {
        title: `Assessment submitted: ${questId || controlArea || "control"}`,
        body: `Submitted by ${submittedBy}`,
        entityType: "assessment",
        entityId: assessment.id
      });
    }

    res.status(201).json(assessment);
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}));

// PUT /:id is a review/audit-workflow endpoint, not a general assessment editor — the
// only three callers in the product (Review.jsx's approve/reject, Dashboard.jsx's
// auditor approve/reject, and QuestionCard.jsx's "unlock for edit") ever send these
// fields. Control content (answer, currentLevel, controlArea, owner, comments,
// evidenceLink, scoreEligible, question/module/month identity) is only ever set via
// POST, when a new monthly assessment row is created.
const PUT_SUPPORTED_FIELDS = new Set(["reviewStatus", "reviewerNotes", "auditorNotes", "reviewedBy", "auditedBy"]);

// Which reviewStatus values each role's real workflow is allowed to set (F-07):
// CONTRIBUTOR may only unlock their own submission (submitted_by) back to WIP for editing — never
// self-approve — and never an AUDITED one (only AUDITOR/ADMIN may reopen an audit). ADMIN/LEAD run the reviewer stage (Submitted -> FINISHED / WIP).
// AUDITOR runs the audit stage on top of an already-FINISHED control
// (FINISHED -> AUDITED / WIP) — auditors never set FINISHED, reviewers never set
// AUDITED. The status lifecycle is:
//   WIP -> Submitted -> FINISHED -> AUDITED   (reject at any stage -> WIP)
const REVIEW_STATUS_BY_ROLE = {
  ADMIN: new Set(["FINISHED", "WIP"]),
  LEAD: new Set(["FINISHED", "WIP"]),
  AUDITOR: new Set(["AUDITED", "WIP"]),
  CONTRIBUTOR: new Set(["WIP"]),
};

router.put("/:id", authenticate, requireRole(["ADMIN", "LEAD", "CONTRIBUTOR", "AUDITOR"]), asyncHandler(async (req, res) => {
  const assessmentId = parseInt(req.params.id);
  const role = req.user.role;
  const body = req.body || {};

  const unsupportedFields = Object.keys(body).filter((key) => !PUT_SUPPORTED_FIELDS.has(key));
  if (unsupportedFields.length > 0) {
    return res.status(400).json({ error: `This endpoint does not support updating: ${unsupportedFields.join(", ")}` });
  }

  const rawBody = sanitiseFields(body, {
    reviewerNotes: "text", auditorNotes: "text",
  });
  if (rawBody.reviewStatus !== undefined && !VALID_REVIEW_STATUSES.has(rawBody.reviewStatus)) {
    rawBody.reviewStatus = undefined;
  }

  if (rawBody.reviewStatus !== undefined && !REVIEW_STATUS_BY_ROLE[role]?.has(rawBody.reviewStatus)) {
    return res.status(403).json({ error: `Role ${role} may not set reviewStatus to ${rawBody.reviewStatus}` });
  }
  if (rawBody.reviewerNotes !== undefined && role !== "ADMIN" && role !== "LEAD") {
    return res.status(403).json({ error: "Only a reviewer (ADMIN/LEAD) may set reviewerNotes" });
  }
  if (rawBody.auditorNotes !== undefined && role !== "AUDITOR") {
    return res.status(403).json({ error: "Only an AUDITOR may set auditorNotes" });
  }

  // reviewedBy/auditedBy are never taken from the request body (F-07: previously a
  // caller could impersonate an arbitrary reviewer/auditor) — they're derived from
  // the authenticated session whenever that role actually performs the corresponding
  // action, matching the existing approve/reject workflows above.
  const isBeingReviewed = (role === "ADMIN" || role === "LEAD") && rawBody.reviewStatus !== undefined;
  const isBeingAudited  = role === "AUDITOR" && rawBody.reviewStatus !== undefined;

  // A reviewer re-opening a control (approve or reject) invalidates any prior
  // auditor sign-off — the auditor must look at it again — so the audit stamps
  // are cleared. Same when a contributor unlocks their submission for editing.
  const clearsAudit = (isBeingReviewed || role === "CONTRIBUTOR") && rawBody.reviewStatus !== undefined;

  const data = {
    review_status: rawBody.reviewStatus,
    reviewer_notes: rawBody.reviewerNotes,
    auditor_notes: rawBody.auditorNotes,
    reviewed_by: isBeingReviewed ? req.user.email : undefined,
    audited_by: isBeingAudited ? req.user.email : (clearsAudit ? null : undefined),
    reviewed_at: isBeingReviewed ? new Date() : undefined,
    audited_at:  isBeingAudited  ? new Date() : (clearsAudit ? null : undefined),
    updated_at: new Date()
  };
  if (clearsAudit) data.auditor_notes = null;
  if (rawBody.reviewStatus !== undefined && rawBody.reviewStatus !== "AUDITED") data.audit_period_end = null;
  // A human taking a review/audit action acknowledges any prior automated revert
  // (see collectionRunner.js revertAssessmentsForEvidenceFailure) — clear the banner.
  if (isBeingReviewed || isBeingAudited) {
    data.auto_reverted_at = null;
    data.auto_reverted_reason = null;
  }

  const hasUpdates = Object.keys(data).some((key) => key !== "updated_at" && data[key] !== undefined);
  if (!hasUpdates) {
    return res.status(400).json({ error: "No fields to update" });
  }

  // A department LEAD may only review controls owned by one of their departments.
  if (isBeingReviewed || (role === "LEAD" && rawBody.reviewerNotes !== undefined)) {
    const target = await query("SELECT quest_id FROM assessments WHERE id = $1 AND company_id = $2", [assessmentId, req.user.companyId]);
    if (target.rows.length === 0) return res.status(404).json({ error: "Assessment not found" });
    const violation = await leadScopeViolation(req.user, target.rows[0].quest_id);
    if (violation) {
      return res.status(403).json({
        error: `This control is owned by ${violation.owningDepartments.join(", ") || "no department"} — outside your departments`,
        code: "OUT_OF_DEPARTMENT_SCOPE",
        ...violation,
      });
    }
  }

  const client = await getClient();
  try {
    await client.query("BEGIN");

    // F-11: an auditor's sign-off can only be undone by an AUDITOR or an ADMIN — any
    // status change on an AUDITED row clears the audit and with it the evidence lock.
    const current = await client.query(
      "SELECT review_status, audited_at, audited_by, submitted_by FROM assessments WHERE id = $1 AND company_id = $2 FOR UPDATE",
      [assessmentId, req.user.companyId]
    );
    const wasAudited = current.rows[0]?.review_status === "AUDITED";
    // The audit stage runs on a reviewer-approved control: only FINISHED (or an
    // already-AUDITED one) can be marked AUDITED, so the reviewer stage can't be skipped.
    if (current.rows[0] && rawBody.reviewStatus === "AUDITED" && !["FINISHED", "AUDITED"].includes(current.rows[0].review_status)) {
      await client.query("ROLLBACK");
      return res.status(409).json({ error: "Only a reviewer-approved (FINISHED) assessment can be audited.", code: "NOT_REVIEWED" });
    }
    // Re-auditing keeps the original sign-off time, so it can't widen the evidence lock
    // over rows added after the audit.
    if (wasAudited && rawBody.reviewStatus === "AUDITED") {
      data.audited_at = current.rows[0].audited_at;
      data.audited_by = current.rows[0].audited_by;
    }
    if (wasAudited && rawBody.reviewStatus !== undefined && rawBody.reviewStatus !== "AUDITED"
        && !["AUDITOR", "ADMIN"].includes(role)) {
      await client.query("ROLLBACK");
      return res.status(409).json({ error: "This assessment has been audited. Only an auditor or an admin can reopen it.", code: "AUDITED" });
    }
    // A contributor may only unlock their own submission for editing — not send back a
    // colleague's work or undo a reviewer's approval of it.
    if (role === "CONTRIBUTOR" && current.rows[0]
        && String(current.rows[0].submitted_by || "").toLowerCase() !== String(req.user.email || "").toLowerCase()) {
      await client.query("ROLLBACK");
      return res.status(403).json({ error: "You can only reopen assessments you submitted.", code: "NOT_OWN_SUBMISSION" });
    }

    const update = buildUpdate(data);
    const assessmentResult = await client.query(
      `UPDATE assessments SET ${update.set} WHERE id = $${update.values.length + 1} AND company_id = $${update.values.length + 2} RETURNING id, assessment_id, month, module_id, quest_id, company_id, control_area, answer, current_level, level3_plus, evidence_link, owner, submitted_by, reviewer, review_status, score_eligible, comments, reviewed_by, audited_by, reviewed_at, audited_at, reviewer_notes, auditor_notes, auto_reverted_at, auto_reverted_reason, created_at, updated_at`,
      [...update.values, assessmentId, req.user.companyId]
    );

    // A new sign-off freezes the period it covers (auditCoverage.js).
    if (!wasAudited && rawBody.reviewStatus === "AUDITED" && assessmentResult.rows[0]) {
      await client.query(
        `UPDATE assessments a SET audit_period_end = ${auditPeriodEndSql("a")} WHERE a.id = $1 AND a.company_id = $2`,
        [assessmentId, req.user.companyId]
      );
    }

    if (wasAudited && rawBody.reviewStatus !== undefined && rawBody.reviewStatus !== "AUDITED" && assessmentResult.rows[0]) {
      await writeAuditLog({
        userId: req.user.userId, companyId: req.user.companyId, email: req.user.email,
        action: "ASSESSMENT_AUDIT_REOPENED", resource: "assessments",
        detail: { assessmentId, questId: assessmentResult.rows[0].quest_id, month: assessmentResult.rows[0].month, newStatus: rawBody.reviewStatus },
        ip: req.ip,
      });
    }

    if (assessmentResult.rows.length === 0) {
      await client.query("ROLLBACK");
      return res.status(404).json({ error: "Assessment not found" });
    }

    const assessment = mapRow(assessmentResult);

    // Auto-close open actions for this quest when approved (reviewer FINISHED, or
    // auditor AUDITED — the latter is idempotent since it was already FINISHED)
    if (["FINISHED", "AUDITED"].includes(req.body.reviewStatus) && assessment.questId) {
      await client.query(
        `UPDATE actions SET status = 'CLOSED', closure_date = NOW(), updated_at = NOW()
         WHERE quest_id = $1 AND company_id = $2
           AND COALESCE(UPPER(status), 'OPEN') NOT IN ('CLOSED', 'DONE', 'COMPLETED')`,
        [assessment.questId, req.user.companyId]
      );

      // Mirror any evidence for this quest that isn't yet in the vault
      await client.query(
        `INSERT INTO evidence_vault
           (company_id, title, file_name, file_type, file_size, storage_path, evidence_link, uploaded_by, legacy_evidence_id)
         SELECT
           e.company_id,
           COALESCE(e.evidence_name, 'Untitled Evidence'),
           e.evidence_name,
           NULL,
           NULL,
           e.file_path,
           e.evidence_link,
           e.uploaded_by,
           e.id
         FROM evidence e
         WHERE e.quest_id = $1 AND e.company_id = $2
           AND (e.file_path IS NOT NULL OR e.evidence_link IS NOT NULL)
           AND NOT EXISTS (
             SELECT 1 FROM evidence_vault ev WHERE ev.legacy_evidence_id = e.id
           )
         ON CONFLICT DO NOTHING`,
        [assessment.questId, req.user.companyId]
      );

      // Link newly mirrored vault items to this quest
      await client.query(
        `INSERT INTO question_evidence (company_id, quest_id, vault_id, linked_by)
         SELECT ev.company_id, $1, ev.id, $3
         FROM evidence_vault ev
         WHERE ev.company_id = $2
           AND ev.legacy_evidence_id IN (
             SELECT id FROM evidence WHERE quest_id = $1 AND company_id = $2
           )
         ON CONFLICT (company_id, quest_id, vault_id) DO NOTHING`,
        [assessment.questId, req.user.companyId, req.user.email || null]
      );

      // Lock all vault items linked to this quest
      await client.query(
        `UPDATE evidence_vault SET locked = true
         WHERE id IN (
           SELECT vault_id FROM question_evidence WHERE quest_id = $1 AND company_id = $2
         )`,
        [assessment.questId, req.user.companyId]
      );
    }

    if (req.body.reviewStatus === "WIP" && ["NOT_IMPLEMENTED", "PARTIALLY_IMPLEMENTED", "PLANNED", "NO", "WIP"].includes(assessment.answer)) {
      const actionId = `assessment-${assessment.id}`;
      const existingAction = await client.query(
        "SELECT id FROM actions WHERE action_id = $1 AND company_id = $2",
        [actionId, req.user.companyId]
      );

      if (existingAction.rows.length === 0) {
        const questionResult = await client.query(QUESTION_CONTEXT_SQL, [assessment.questId, req.user.companyId]);
        const question = questionResult.rows[0] || {};

        await client.query(
          `INSERT INTO actions
           (action_id, month, module_id, quest_id, company_id, defeated_quest, current_level, target_level,
            immediate_action_required, owner, due_date, status, notes)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, TRUE, $9, $10, 'OPEN', $11)`,
          [
            actionId,
            assessment.month,
            assessment.moduleId,
            assessment.questId,
            req.user.companyId,
            assessment.controlArea || question.control_area || question.baseline_question || assessment.questId,
            assessment.currentLevel,
            3,
            question.default_owner || assessment.owner,
            new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString().split('T')[0],
            'Rejected by auditor - requires resubmission'
          ]
        );
      } else {
        await client.query(
          "UPDATE actions SET status = 'OPEN', updated_at = NOW() WHERE action_id = $1 AND company_id = $2",
          [actionId, req.user.companyId]
        );
      }

      // Notify the user who submitted this assessment about the rejection
      if (assessment.submittedBy) {
        const submitterResult = await client.query(
          "SELECT id FROM users WHERE email = $1 AND company_id = $2 LIMIT 1",
          [assessment.submittedBy, req.user.companyId]
        );
        if (submitterResult.rows.length > 0) {
          const submitterId = submitterResult.rows[0].id;
          const rejectionReason = rawBody.auditorNotes || "No reason provided";
          const title = `Assessment rejected: ${assessment.questId || assessment.controlArea || "control"}`;
          const body = `Rejected by ${req.user.email}. Reason: ${rejectionReason}`;
          await client.query(
            `INSERT INTO notifications (user_id, company_id, title, body, entity_type, entity_id)
             VALUES ($1, $2, $3, $4, 'rejection', $5)`,
            [submitterId, req.user.companyId, title, body, assessment.id]
          );
        }
      }
    }

    await client.query("COMMIT");

    // Notify submitter when their assessment is approved (reviewer) or passes
    // audit (auditor).
    if (["FINISHED", "AUDITED"].includes(req.body.reviewStatus) && assessment.submittedBy) {
      const audited = req.body.reviewStatus === "AUDITED";
      query(
        "SELECT id FROM users WHERE email = $1 AND company_id = $2 LIMIT 1",
        [assessment.submittedBy, req.user.companyId]
      ).then(r => {
        if (r.rows.length > 0) {
          const submitterId = r.rows[0].id;
          return query(
            `INSERT INTO notifications (user_id, company_id, title, body, entity_type, entity_id) VALUES ($1, $2, $3, $4, 'approval', $5)`,
            [submitterId, req.user.companyId,
             `${audited ? "Assessment passed audit" : "Assessment approved"}: ${assessment.questId || assessment.controlArea || "control"}`,
             `${audited ? "Audited" : "Approved"} by ${req.user.email}`,
             assessment.id]
          );
        }
      }).catch(err => console.error("[notify] approval notification failed:", err.message));
    }

    // Notify auditors when a control clears review and is ready for audit sign-off.
    if (req.body.reviewStatus === "FINISHED") {
      notifyReviewers(req.user.companyId, {
        title: `Ready for audit: ${assessment.questId || assessment.controlArea || "control"}`,
        body: `Approved by ${req.user.email} — awaiting auditor sign-off`,
        entityType: "audit",
        entityId: assessment.id,
        roles: ["AUDITOR"],
      });
    }

    res.json(assessment);
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}));

router.delete("/:id", authenticate, requireRole(["ADMIN", "LEAD"]), asyncHandler(async (req, res) => {
  const id = parseInt(req.params.id);
  const client = await getClient();
  let evidenceRows = [];
  let reopenIds = [];
  let assessment;
  try {
    await client.query("BEGIN");
    const assessmentResult = await client.query(
      "SELECT id, assessment_id, quest_id, month, company_id, review_status FROM assessments WHERE id = $1 AND company_id = $2 FOR UPDATE",
      [id, req.user.companyId]
    );
    if (assessmentResult.rows.length === 0) {
      await client.query("ROLLBACK");
      return res.status(404).json({ error: "Assessment not found" });
    }
    assessment = mapRow(assessmentResult);

    // A department LEAD may only delete assessments of controls their departments own.
    const violation = await leadScopeViolation(req.user, assessment.questId);
    if (violation) {
      await client.query("ROLLBACK");
      return res.status(403).json({
        error: `This control is owned by ${violation.owningDepartments.join(", ") || "no department"} — outside your departments`,
        code: "OUT_OF_DEPARTMENT_SCOPE",
        ...violation,
      });
    }

    // F-24: deleting an audited assessment undoes the audit — same rule as reopening
    // one (F-11): only an ADMIN may do it.
    if (assessment.reviewStatus === "AUDITED" && req.user.role !== "ADMIN") {
      await client.query("ROLLBACK");
      return res.status(409).json({ error: "This assessment has been audited. Only an admin can delete it.", code: "AUDITED" });
    }

    // Find evidence related to this assessment: only where evidence.evidence_id equals the assessment id
    const evidenceResult = await client.query(
      "SELECT id, file_path, quest_id, evidence_id, month, created_at FROM evidence WHERE company_id = $1 AND evidence_id = $2",
      [req.user.companyId, String(assessment.id)]
    );
    evidenceRows = evidenceResult.rows || [];
    // Evidence attached to this assessment may also be covered by another approval of the
    // same control and month (Review shows it there too). Deleting it would destroy
    // audited evidence, so that needs an ADMIN; FINISHED siblings go back to review.
    const coveringIds = new Set();
    for (const r of evidenceRows) {
      const others = (await approvedAssessmentsForEvidenceRow(req.user.companyId, r)).filter((a) => a.id !== assessment.id);
      if (hasAuditedApproval(others) && req.user.role !== "ADMIN") {
        await client.query("ROLLBACK");
        return res.status(409).json({ error: "This assessment's evidence is also part of an audited assessment. Only an admin can delete it.", code: "AUDITED" });
      }
      others.filter((a) => a.reviewStatus === "FINISHED").forEach((a) => coveringIds.add(a.id));
    }
    reopenIds = [...coveringIds];
    if (evidenceRows.length > 0) {
      await client.query("DELETE FROM evidence WHERE id = ANY($1::int[]) AND company_id = $2", [evidenceRows.map((r) => r.id), req.user.companyId]);
    }
    await client.query("DELETE FROM assessments WHERE id = $1 AND company_id = $2", [id, req.user.companyId]);
    await client.query("COMMIT");
  } catch (e) {
    await client.query("ROLLBACK").catch(() => {});
    throw e;
  } finally {
    client.release();
  }

  await writeAuditLog({
    userId: req.user.userId, companyId: req.user.companyId, email: req.user.email,
    action: "ASSESSMENT_DELETED", resource: "assessments",
    detail: { assessmentId: id, questId: assessment.questId, month: assessment.month, reviewStatus: assessment.reviewStatus, evidenceRowsDeleted: evidenceRows.length },
    ip: req.ip,
  });
  await reopenReviewForChangedEvidenceRow({
    companyId: req.user.companyId, assessmentIds: reopenIds, title: null,
    change: `evidence deleted with assessment ${id}`, actor: req.user.email,
  });

  // Legacy best-effort cleanup of bare local file paths (current storage refs are left
  // alone — a Tracker upload shares its stored object with the vault mirror).
  const uploadRoot = path.resolve(process.env.UPLOAD_DIR || "./uploads");
  const safeRoot = uploadRoot.endsWith(path.sep) ? uploadRoot : `${uploadRoot}${path.sep}`;
  for (const r of evidenceRows) {
    if (!r.file_path) continue;
    try {
      const resolvedPath = path.resolve(r.file_path); // nosemgrep
      if (resolvedPath.startsWith(safeRoot) && fs.existsSync(resolvedPath)) fs.unlinkSync(resolvedPath);
    } catch (e) {
      console.warn("Failed to remove evidence file", r.file_path, e.message);
    }
  }

  res.status(204).send();
}));

export default router;
