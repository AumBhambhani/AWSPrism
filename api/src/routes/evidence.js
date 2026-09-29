import { Router } from "express";
import multer from "multer";
import { buildUpdate, mapRow, mapRows, query } from "../db/index.js";
import { isQuestionVisible } from "../db/effectiveRows.js";
import { authenticate } from "../middleware/auth.js";
import { requireRole, requireReadOnly } from "../middleware/roles.js";
import { longRequestTimeout } from "../middleware/timeout.js";
import { asyncHandler } from "../utils/asyncHandler.js";
import { writeAuditLog } from "../utils/auditLog.js";
import { analyzeEvidence } from "../utils/aiProvider.js";
import { runEvidenceAnalysis, resolveVaultIdForEvidence } from "../utils/evidenceAnalysis.js";
import { notifyReviewers } from "../utils/notifyReviewers.js";
import { scanBuffer } from "../utils/scanFile.js";
import { openObjectStream, withLocalCopy } from "../utils/evidenceStorage.js";
import path from "path";
import { uploadFileFilter } from "../utils/uploadPolicy.js";
import { assertNotAudited, finalizeEvidenceUpload, findLinkedVaultFileForQuestion, resolveEvidenceAssessmentLink, UploadRefusedError } from "../utils/evidenceUploads.js";
import { pendingScanResponse, quarantineUpload } from "../utils/uploadQuarantine.js";
import { AUDITED_LOCK_ERROR, approvedAssessmentsForEvidenceRow, hasAuditedApproval, reopenReviewForChangedEvidenceRow } from "../utils/approvedEvidence.js";
import { redactStoragePathsMiddleware } from "../utils/redactStoragePaths.js";

const router = Router();
router.use(redactStoragePathsMiddleware);

const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 10 * 1024 * 1024 }, fileFilter: uploadFileFilter });

function publicEvidence(record) {
  if (!record) return record;
  const { filePath, ...safeRecord } = record;
  return {
    ...safeRecord,
    hasFile: safeRecord.hasFile ?? Boolean(filePath),
  };
}

router.get("/", authenticate, requireReadOnly(["ADMIN", "LEAD", "CONTRIBUTOR", "REVIEWER", "AUDITOR"]), asyncHandler(async (req, res) => {
  if (req.user.role === "AUDITOR") {
    await writeAuditLog({ userId: req.user.userId, companyId: req.user.companyId, email: req.user.email, action: "READ", resource: "evidence", ip: req.ip });
  }
  const { questId, moduleId, month } = req.query;
  const conditions = ["e.company_id = $1"];
  const values = [req.user.companyId];

  if (questId) {
    values.push(questId);
    conditions.push(`e.quest_id = $${values.length}`);
  }

  if (moduleId) {
    values.push(moduleId);
    conditions.push(`e.module_id = $${values.length}`);
  }

  if (month) {
    values.push(month);
    conditions.push(`e.month = $${values.length}`);
  }

  // AI analysis now lives on the shared evidence_vault item; fall back to the
  // legacy per-row columns for evidence uploaded/analysed before the move.
  const result = await query(
    `SELECT e.id, e.evidence_id, e.month, e.module_id, e.quest_id, e.company_id,
            e.evidence_type, e.evidence_name, e.evidence_link,
            (e.file_path IS NOT NULL) AS has_file,
            e.uploaded_by, e.upload_date, e.reviewer, e.approval_status, e.notes,
            COALESCE(ev.ai_contributor_comments, e.ai_contributor_comments) AS ai_contributor_comments,
            COALESCE(ev.ai_reviewer_comments,    e.ai_reviewer_comments)    AS ai_reviewer_comments,
            COALESCE(ev.ai_gaps,                 e.ai_gaps)                 AS ai_gaps,
            COALESCE(ev.ai_suggestions,          e.ai_suggestions)          AS ai_suggestions,
            COALESCE(ev.ai_analyzed_at,          e.ai_analyzed_at)          AS ai_analyzed_at,
            COALESCE(ev.ai_date_warning,         e.ai_date_warning)         AS ai_date_warning,
            ev.ai_analysis_status, ev.ai_analyzed_version, ev.current_version,
            e.created_at, e.updated_at
       FROM evidence e
       LEFT JOIN LATERAL (
         SELECT vv.ai_contributor_comments, vv.ai_reviewer_comments, vv.ai_gaps,
                vv.ai_suggestions, vv.ai_analyzed_at, vv.ai_date_warning,
                vv.ai_analysis_status, vv.ai_analyzed_version,
                (SELECT COALESCE(MAX(version_number), 1) FROM evidence_versions WHERE evidence_id = vv.id) AS current_version
           FROM evidence_vault vv
          WHERE vv.company_id = e.company_id
            AND (
              vv.legacy_evidence_id = e.id
              OR (e.quest_id IS NOT NULL AND vv.id IN (
                    SELECT qe.vault_id FROM question_evidence qe
                     WHERE qe.company_id = e.company_id AND qe.quest_id = e.quest_id
                  ))
            )
          ORDER BY (vv.legacy_evidence_id = e.id) DESC, vv.updated_at DESC
          LIMIT 1
       ) ev ON TRUE
      WHERE ${conditions.join(" AND ")}
      ORDER BY e.created_at DESC`,
    values
  );
  res.json(mapRows(result).map(publicEvidence));
}));

// Auditors can view (/:id/view) but not download.
router.get("/:id/download", authenticate, requireRole(["ADMIN", "LEAD", "CONTRIBUTOR"]), asyncHandler(async (req, res) => {
  const evidenceResult = await query(
    "SELECT evidence_name, file_path FROM evidence WHERE id = $1 AND company_id = $2",
    [parseInt(req.params.id), req.user.companyId]
  );
  const evidence = mapRow(evidenceResult);

  if (!evidence || !evidence.filePath) {
    return res.status(404).json({ error: "Evidence file not found" });
  }

  const stream = await openObjectStream(req.user.companyId, evidence.filePath);
  if (!stream) return res.status(404).json({ error: "Evidence file not found" });

  const filename = evidence.evidenceName || path.basename(evidence.filePath);
  res.setHeader("Content-Disposition", `attachment; filename="${filename.replace(/"/g, "")}"`);
  res.setHeader("X-Content-Type-Options", "nosniff");
  stream.on("error", () => { if (!res.headersSent) res.status(404).end(); });
  stream.pipe(res);
}));

// GET /api/evidence/:id/view — serve file inline (auditors can view but not download)
router.get("/:id/view", authenticate, requireReadOnly(["ADMIN", "LEAD", "CONTRIBUTOR", "AUDITOR"]), asyncHandler(async (req, res) => {
  const evidenceResult = await query(
    "SELECT evidence_name, file_path FROM evidence WHERE id = $1 AND company_id = $2",
    [parseInt(req.params.id), req.user.companyId]
  );
  const evidence = mapRow(evidenceResult);

  if (!evidence || !evidence.filePath) return res.status(404).json({ error: "Evidence file not found" });

  const stream = await openObjectStream(req.user.companyId, evidence.filePath);
  if (!stream) return res.status(404).json({ error: "Evidence file not found" });

  const filename = evidence.evidenceName || path.basename(evidence.filePath);
  res.setHeader("Content-Disposition", `inline; filename="${filename.replace(/"/g, "")}"`);
  res.setHeader("X-Content-Type-Options", "nosniff");
  stream.on("error", () => { if (!res.headersSent) res.status(404).end(); });
  stream.pipe(res);
}));

router.post("/", authenticate, requireRole(["ADMIN", "LEAD", "CONTRIBUTOR"]), upload.single("file"), asyncHandler(async (req, res) => {
  if (Object.prototype.hasOwnProperty.call(req.body, "filePath") ||
      Object.prototype.hasOwnProperty.call(req.body, "file_path")) {
    return res.status(400).json({ error: "filePath cannot be supplied; upload the file instead" });
  }

  const uploadedBy = req.user?.email || req.body.uploadedBy || null;
  const uploadDate = req.body.uploadDate || new Date();
  const evidenceType = req.body.evidenceType || (req.file ? "FILE" : "LINK");

  const data = {
    evidence_id: req.body.evidenceId || null,
    month: req.body.month || null,
    module_id: req.body.moduleId || null,
    quest_id: req.body.questId || null,
    company_id: req.user.companyId,
    evidence_type: evidenceType,
    evidence_name: req.body.evidenceName || null,
    evidence_link: req.body.evidenceLink || null,
    file_path: null,
    uploaded_by: uploadedBy,
    upload_date: uploadDate,
    reviewer: req.body.reviewer || null,
    approval_status: req.body.approvalStatus || null,
    notes: req.body.notes || null
  };

  if (!(await isQuestionVisible(query, data.company_id, data.quest_id))) return res.status(400).json({ error: "Question not found" });
  try {
    data.evidence_id = await resolveEvidenceAssessmentLink(data.company_id, data.evidence_id, data.quest_id);
  } catch (e) {
    if (e instanceof UploadRefusedError) return res.status(e.status).json(e.body);
    throw e;
  }

  try {
    if (req.file) {
      const scan = await scanBuffer(req.file.buffer, req.file.mimetype);
      if (scan.unavailable) {
        // Refuse now what would be refused on release (audited lock, F-11).
        await assertNotAudited(data.company_id, await findLinkedVaultFileForQuestion(data.company_id, data.quest_id));
        const { company_id, file_path, ...params } = data;
        const q = await quarantineUpload({ companyId: data.company_id, user: req.user, kind: "evidence", params: { data: params }, file: req.file });
        return res.status(202).json(pendingScanResponse(q));
      }
      if (!scan.safe) return res.status(400).json({ error: `File rejected: ${scan.reason}` });
    }
    const { company_id, file_path, ...fields } = data;
    const evidenceRecord = await finalizeEvidenceUpload({ companyId: data.company_id, data: fields, file: req.file || null });
    res.status(201).json(publicEvidence(evidenceRecord));
  } catch (e) {
    if (e instanceof UploadRefusedError) return res.status(e.status).json(e.body);
    throw e;
  }
}));

router.put("/:id", authenticate, requireRole(["ADMIN", "LEAD", "CONTRIBUTOR"]), asyncHandler(async (req, res) => {
  const data = {
    evidence_id: req.body.evidenceId,
    month: req.body.month,
    module_id: req.body.moduleId,
    quest_id: req.body.questId,
    evidence_type: req.body.evidenceType,
    evidence_name: req.body.evidenceName,
    evidence_link: req.body.evidenceLink,
    // file_path intentionally excluded — only set at upload time, never via API update
    uploaded_by: req.body.uploadedBy || req.user?.email || null,
    upload_date: req.body.uploadDate,
    reviewer: req.body.reviewer,
    approval_status: req.body.approvalStatus,
    notes: req.body.notes,
    updated_at: new Date()
  };

  const hasUpdates = Object.keys(data).some((key) => key !== "updated_at" && data[key] !== undefined);
  if (!hasUpdates) {
    return res.status(400).json({ error: "No fields to update" });
  }

  if (data.quest_id !== undefined && !(await isQuestionVisible(query, req.user.companyId, data.quest_id))) {
    return res.status(400).json({ error: "Question not found" });
  }

  // F-11: evidence that was part of an audited assessment is locked; evidence of a
  // FINISHED assessment may change but sends that approval back for review.
  const existing = await query("SELECT quest_id, month, evidence_id, evidence_name, created_at FROM evidence WHERE id = $1 AND company_id = $2", [parseInt(req.params.id), req.user.companyId]);
  if (existing.rows.length === 0) return res.status(404).json({ error: "Evidence not found" });
  // Check both where the row is now and where the edit would put it — otherwise a row
  // could be moved out, edited, and moved back under an audited assessment.
  const current = existing.rows[0];
  const target = {
    quest_id: data.quest_id !== undefined ? data.quest_id : current.quest_id,
    month: data.month !== undefined ? data.month : current.month,
    evidence_id: data.evidence_id !== undefined ? data.evidence_id : current.evidence_id,
    created_at: current.created_at,
  };
  if (data.evidence_id !== undefined) {
    try {
      data.evidence_id = await resolveEvidenceAssessmentLink(req.user.companyId, data.evidence_id, target.quest_id);
      target.evidence_id = data.evidence_id;
    } catch (e) {
      if (e instanceof UploadRefusedError) return res.status(e.status).json(e.body);
      throw e;
    }
  }
  const approvedNow = await approvedAssessmentsForEvidenceRow(req.user.companyId, current);
  const approvedTarget = await approvedAssessmentsForEvidenceRow(req.user.companyId, target);
  const approved = [...new Map([...approvedNow, ...approvedTarget].map((a) => [a.id, a])).values()];
  if (hasAuditedApproval(approved)) return res.status(409).json(AUDITED_LOCK_ERROR);
  // Contributors may not change (or move) evidence behind a colleague's approval — that
  // would send the colleague's approved assessment back for review (closure review 7C).
  const me = String(req.user.email || "").toLowerCase();
  if (req.user.role === "CONTRIBUTOR" && approved.some((a) => String(a.submittedBy || "").toLowerCase() !== me)) {
    return res.status(403).json({ error: "This evidence is part of a colleague's approved assessment.", code: "NOT_OWN_EVIDENCE" });
  }

  const update = buildUpdate(data);
  const evidenceResult = await query(
    `UPDATE evidence SET ${update.set} WHERE id = $${update.values.length + 1} AND company_id = $${update.values.length + 2} RETURNING *`,
    [...update.values, parseInt(req.params.id), req.user.companyId]
  );

  if (evidenceResult.rows.length === 0) {
    return res.status(404).json({ error: "Evidence not found" });
  }

  if (approved.length > 0) {
    await reopenReviewForChangedEvidenceRow({
      companyId: req.user.companyId,
      assessmentIds: approved.map((a) => a.id),
      title: existing.rows[0].evidence_name,
      change: "Tracker evidence edited",
      actor: req.user.email,
    });
  }

  res.json(publicEvidence(mapRow(evidenceResult)));
}));

router.delete("/:id", authenticate, requireRole(["ADMIN", "LEAD"]), asyncHandler(async (req, res) => {
  const id = parseInt(req.params.id);

  // Block deletion if the evidence belongs to a quest with a finished review
  const evCheck = await query(
    "SELECT quest_id FROM evidence WHERE id = $1 AND company_id = $2",
    [id, req.user.companyId]
  );
  const ev = mapRow(evCheck);
  if (!ev) return res.status(404).json({ error: "Evidence not found" });

  if (ev.questId) {
    const lockCheck = await query(
      "SELECT 1 FROM assessments WHERE quest_id = $1 AND company_id = $2 AND review_status IN ('FINISHED', 'AUDITED') LIMIT 1",
      [ev.questId, req.user.companyId]
    );
    if (lockCheck.rows.length > 0) {
      return res.status(409).json({
        error: "This evidence is locked because the linked control has been approved by a reviewer.",
        code: "LOCKED"
      });
    }
  }

  const result = await query(
    "DELETE FROM evidence WHERE id = $1 AND company_id = $2",
    [id, req.user.companyId]
  );
  if (result.rowCount === 0) return res.status(404).json({ error: "Evidence not found" });
  res.status(204).send();
}));

router.post("/:id/analyze", authenticate, requireRole(["ADMIN", "LEAD", "CONTRIBUTOR"]), longRequestTimeout(120000), asyncHandler(async (req, res) => {
  // Check if AI is enabled for this company
  const settingsResult = await query(
    "SELECT ai_enabled, ai_provider FROM company_settings WHERE company_id = $1",
    [req.user.companyId]
  );
  const settings = mapRow(settingsResult);
  if (!settings?.aiEnabled) {
    return res.status(403).json({ error: "AI features are disabled for your company" });
  }

  const evidenceId = parseInt(req.params.id);
  const evidenceResult = await query(
    `SELECT e.*, q.required_evidence, q.recurrence_interval
     FROM evidence e
     LEFT JOIN LATERAL (
       SELECT required_evidence, recurrence_interval FROM questions
       WHERE quest_id = e.quest_id AND (company_id = $2 OR company_id IS NULL)
       ORDER BY company_id ASC NULLS LAST, id ASC LIMIT 1
     ) q ON TRUE
     WHERE e.id = $1 AND e.company_id = $2`,
    [evidenceId, req.user.companyId]
  );
  const evidence = mapRow(evidenceResult);

  if (!evidence) {
    return res.status(404).json({ error: "Evidence not found" });
  }

  const today = new Date().toISOString().slice(0, 10);
  const provider = settings?.aiProvider || null;

  // Prefer analysing the shared vault item so the result is reused by every
  // question/framework the evidence is linked to. Fall back to the legacy
  // evidence row only when there is no vault mirror (e.g. a link-only record).
  const vaultId = await resolveVaultIdForEvidence(evidenceId, req.user.companyId);

  let analysis;
  if (vaultId) {
    ({ analysis } = await runEvidenceAnalysis({
      vaultId, companyId: req.user.companyId, provider, today,
    }));
  } else {
    const runAnalysis = (filePath) => analyzeEvidence({
      provider,
      evidenceName: evidence.evidenceName,
      evidenceType: evidence.evidenceType,
      questId: evidence.questId,
      moduleId: evidence.moduleId,
      requiredEvidence: evidence.requiredEvidence,
      filePath,
      recurrenceInterval: evidence.recurrenceInterval || null,
      today
    });
    analysis = evidence.evidenceType === "FILE" && evidence.filePath
      ? await withLocalCopy(req.user.companyId, evidence.filePath, runAnalysis)
      : await runAnalysis(null);
  }

  // Dual-write onto the legacy evidence row so the Tracker UI (which reads
  // /api/evidence) keeps showing analysis without a frontend change.
  const updateResult = await query(
    `UPDATE evidence
     SET ai_contributor_comments = $1, ai_reviewer_comments = $2,
         ai_gaps = $3, ai_suggestions = $4, ai_analyzed_at = NOW(),
         ai_date_warning = $5
     WHERE id = $6 AND company_id = $7
     RETURNING *`,
    [
      Array.isArray(analysis.contributorComments) ? analysis.contributorComments.join("\n") : analysis.contributorComments,
      analysis.reviewerComments,
      JSON.stringify(analysis.gaps || []),
      JSON.stringify(analysis.suggestions || []),
      analysis.dateWarning || null,
      evidenceId,
      req.user.companyId
    ]
  );

  res.json(publicEvidence(mapRow(updateResult)));
}));

export default router;
