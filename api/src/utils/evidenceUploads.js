import { mapRow, query } from "../db/index.js";
import { saveObject } from "./evidenceStorage.js";
import { queueEvidenceAnalysis } from "./evidenceAnalysis.js";
import { notifyReviewers } from "./notifyReviewers.js";
import { AUDITED_LOCK_ERROR, approvedAssessmentsForVault, hasAuditedApproval, reopenReviewForChangedEvidence } from "./approvedEvidence.js";

// The "finish the upload" half of every evidence upload, shared by the upload routes
// (after a synchronous malware scan) and the quarantine worker (after a deferred scan,
// F-12). `file` is { buffer, originalname, mimetype, size } — a multer file or the
// equivalent rebuilt from a quarantined object.

export class UploadRefusedError extends Error {
  constructor(status, body) {
    super(body.error);
    this.status = status;
    this.body = body;
  }
}

const auditedLock = () => new UploadRefusedError(409, AUDITED_LOCK_ERROR);

const MAX_INT4 = 2147483647;

// evidence.evidence_id links a Tracker row to its assessment. It must be a real
// assessment of this company for the same question; attaching new evidence straight
// into an AUDITED assessment is refused (F-11 — new evidence belongs to a later period).
// Returns the canonical id string (or null when no link was requested); throws
// UploadRefusedError otherwise. Also re-run when a quarantined upload is released.
export async function resolveEvidenceAssessmentLink(companyId, evidenceId, questId) {
  if (evidenceId === undefined || evidenceId === null || evidenceId === "") return null;
  if ((typeof evidenceId !== "string" && typeof evidenceId !== "number") || !/^[0-9]+$/.test(String(evidenceId))) {
    throw new UploadRefusedError(400, { error: "Invalid evidenceId" });
  }
  const id = Number(evidenceId);
  if (!Number.isSafeInteger(id) || id < 1 || id > MAX_INT4) throw new UploadRefusedError(400, { error: "Invalid evidenceId" });
  const r = await query(
    "SELECT review_status FROM assessments WHERE id = $1 AND company_id = $2 AND quest_id IS NOT DISTINCT FROM $3",
    [id, companyId, questId ?? null]
  );
  if (r.rows.length === 0) throw new UploadRefusedError(400, { error: "evidenceId must be an assessment of this question" });
  if (r.rows[0].review_status === "AUDITED") throw auditedLock();
  return String(id);
}

// The vault item a Tracker re-upload on this question would version (F-11 applies).
export async function findLinkedVaultFileForQuestion(companyId, questId) {
  if (!questId) return null;
  const r = await query(
    `SELECT qe.vault_id FROM question_evidence qe
     JOIN evidence_vault ev ON ev.id = qe.vault_id AND ev.company_id = qe.company_id
     WHERE qe.quest_id = $1 AND qe.company_id = $2 AND ev.storage_path IS NOT NULL
     ORDER BY ev.updated_at DESC LIMIT 1`,
    [questId, companyId]
  );
  return r.rows[0]?.vault_id ?? null;
}

export async function assertNotAudited(companyId, vaultId) {
  if (vaultId && hasAuditedApproval(await approvedAssessmentsForVault(companyId, vaultId))) throw auditedLock();
}

// POST /api/vault
export async function finalizeVaultUpload({ companyId, uploadedBy, title, description, questId, file }) {
  let storageRef = null;
  if (file) {
    storageRef = await saveObject(companyId, {
      buffer: file.buffer,
      originalName: file.originalname,
      scope: "vault",
      contentType: file.mimetype,
    });
  }

  const result = await query(
    `INSERT INTO evidence_vault
       (company_id, title, description, file_name, file_type, file_size, storage_path, uploaded_by)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
     RETURNING *`,
    [companyId, title, description || null, file?.originalname || null, file?.mimetype || null, file?.size || null, storageRef, uploadedBy]
  );
  const item = mapRow(result);

  // Create version 1 record if a file was attached
  if (file) {
    await query(
      `INSERT INTO evidence_versions (evidence_id, version_number, file_name, file_type, file_size, storage_path, uploaded_by, version_notes)
       VALUES ($1, 1, $2, $3, $4, $5, $6, 'Initial version')
       ON CONFLICT (evidence_id, version_number) DO NOTHING`,
      [item.id, file.originalname, file.mimetype, file.size, storageRef, uploadedBy]
    );
  }

  if (questId) {
    await query(
      `INSERT INTO question_evidence (company_id, quest_id, vault_id, linked_by)
       VALUES ($1, $2, $3, $4)
       ON CONFLICT (company_id, quest_id, vault_id) DO NOTHING`,
      [companyId, questId, item.id, uploadedBy]
    );
    item.linkedCount = 1;
  } else {
    item.linkedCount = 0;
  }

  // Auto-run AI analysis so reviewers/auditors have a cached result. Fire-and-forget.
  if (file) queueEvidenceAnalysis({ vaultId: item.id, companyId });
  return item;
}

// POST /api/vault/:id/versions
export async function finalizeVaultVersion({ companyId, vaultId, uploadedBy, versionNotes, file }) {
  const check = await query("SELECT id, title FROM evidence_vault WHERE id = $1 AND company_id = $2", [vaultId, companyId]);
  if (check.rows.length === 0) throw new UploadRefusedError(404, { error: "Vault item not found" });
  await assertNotAudited(companyId, vaultId);

  const storageRef = await saveObject(companyId, {
    buffer: file.buffer,
    originalName: file.originalname,
    scope: "version",
    contentType: file.mimetype,
  });

  const maxResult = await query(
    "SELECT COALESCE(MAX(version_number), 0) AS max_ver FROM evidence_versions WHERE evidence_id = $1",
    [vaultId]
  );
  const nextVer = parseInt(maxResult.rows[0].max_ver) + 1;

  const verResult = await query(
    `INSERT INTO evidence_versions (evidence_id, version_number, file_name, file_type, file_size, storage_path, uploaded_by, version_notes)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8) RETURNING *`,
    [vaultId, nextVer, file.originalname, file.mimetype, file.size, storageRef, uploadedBy, versionNotes?.trim() || null]
  );

  // Update vault pointer to latest version
  await query(
    `UPDATE evidence_vault SET file_name = $1, file_type = $2, file_size = $3, storage_path = $4, updated_at = NOW() WHERE id = $5`,
    [file.originalname, file.mimetype, file.size, storageRef, vaultId]
  );

  const vaultTitle = check.rows[0].title || "an evidence item";
  notifyReviewers(companyId, {
    title: `Evidence updated: ${vaultTitle}`,
    body: `${uploadedBy || "A contributor"} uploaded v${nextVer} of "${vaultTitle}".`,
    entityType: "vault_version",
    entityId: vaultId,
  });
  await reopenReviewForChangedEvidence({ companyId, vaultId, vaultTitle, change: `new version v${nextVer} uploaded`, actor: uploadedBy });

  // A new version means the cached analysis is stale — re-run it. Fire-and-forget.
  queueEvidenceAnalysis({ vaultId, companyId });
  return mapRow(verResult);
}

// POST /api/evidence (Tracker). `data` holds the evidence row fields except file_path.
export async function finalizeEvidenceUpload({ companyId, data, file }) {
  // Re-checked here too, so a quarantined upload released later cannot land inside an
  // assessment that was audited while it waited.
  data = { ...data, evidence_id: await resolveEvidenceAssessmentLink(companyId, data.evidence_id, data.quest_id) };
  // A file re-upload on a question versions its existing linked vault item (below).
  const existingVaultId = file ? await findLinkedVaultFileForQuestion(companyId, data.quest_id) : null;
  await assertNotAudited(companyId, existingVaultId);

  const row = { ...data, company_id: companyId, file_path: null };
  if (file) {
    row.file_path = await saveObject(companyId, {
      buffer: file.buffer,
      originalName: file.originalname,
      scope: "evidence",
      contentType: file.mimetype,
    });
    row.evidence_name = file.originalname;
  }
  // The stored ref is shared between the evidence row and its vault mirror below.
  const fileRef = row.file_path;

  const result = await query(
    "INSERT INTO evidence (evidence_id, month, module_id, quest_id, company_id, evidence_type, evidence_name, evidence_link, file_path, uploaded_by, upload_date, reviewer, approval_status, notes) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14) RETURNING *",
    [
      row.evidence_id, row.month, row.module_id, row.quest_id, row.company_id, row.evidence_type,
      row.evidence_name, row.evidence_link, row.file_path, row.uploaded_by, row.upload_date,
      row.reviewer, row.approval_status, row.notes,
    ]
  );
  const evidenceRecord = mapRow(result);

  // Mirror into evidence_vault — if a file for this question already exists in the vault, add a new version
  if (row.file_path || row.evidence_link) {
    let vaultItemId = null;

    // For file uploads on a known question, version the existing linked vault item
    if (existingVaultId) {
      const existingId = existingVaultId;

      const maxResult = await query(
        "SELECT COALESCE(MAX(version_number), 0) AS max_ver FROM evidence_versions WHERE evidence_id = $1",
        [existingId]
      );
      const nextVer = parseInt(maxResult.rows[0].max_ver) + 1;

      await query(
        `INSERT INTO evidence_versions (evidence_id, version_number, file_name, file_type, file_size, storage_path, uploaded_by, version_notes)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
        [existingId, nextVer, file.originalname, file.mimetype, file.size, fileRef, row.uploaded_by, "Updated via Tracker"]
      );

      await query(
        `UPDATE evidence_vault SET file_name=$1, file_type=$2, file_size=$3, storage_path=$4, updated_at=NOW() WHERE id=$5`,
        [file.originalname, file.mimetype, file.size, fileRef, existingId]
      );

      // Fetch vault title for notification
      const titleRes = await query("SELECT title FROM evidence_vault WHERE id = $1", [existingId]);
      const vaultTitle = titleRes.rows[0]?.title || "an evidence item";

      notifyReviewers(companyId, {
        title: `Evidence updated: ${vaultTitle}`,
        body: `${row.uploaded_by || "A contributor"} uploaded v${nextVer} of "${vaultTitle}" via Tracker (${row.quest_id}).`,
        entityType: "vault_version",
        entityId: existingId,
      });
      await reopenReviewForChangedEvidence({ companyId, vaultId: existingId, vaultTitle, change: `new version v${nextVer} uploaded via Tracker`, actor: row.uploaded_by });

      vaultItemId = existingId;
    }

    // No existing vault item found — create a new one
    if (!vaultItemId) {
      const vaultResult = await query(
        `INSERT INTO evidence_vault
           (company_id, title, description, file_name, file_type, file_size, storage_path, evidence_link, uploaded_by, legacy_evidence_id)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
         ON CONFLICT DO NOTHING
         RETURNING *`,
        [
          companyId,
          row.evidence_name || "Untitled Evidence",
          row.notes || null,
          file?.originalname || null,
          file?.mimetype || null,
          file?.size || null,
          row.file_path || null,
          row.evidence_link || null,
          row.uploaded_by,
          evidenceRecord.id,
        ]
      );

      // ON CONFLICT DO NOTHING returns zero rows if a unique constraint fired;
      // fall back to the existing vault item so linking still happens.
      let vaultItem = mapRow(vaultResult);
      if (!vaultItem) {
        const existing = await query(
          "SELECT * FROM evidence_vault WHERE legacy_evidence_id = $1",
          [evidenceRecord.id]
        );
        vaultItem = mapRow(existing);
      }
      if (vaultItem) {
        vaultItemId = vaultItem.id;

        if (row.quest_id) {
          await query(
            `INSERT INTO question_evidence (company_id, quest_id, vault_id, linked_by)
             VALUES ($1, $2, $3, $4)
             ON CONFLICT (company_id, quest_id, vault_id) DO NOTHING`,
            [companyId, row.quest_id, vaultItem.id, row.uploaded_by]
          );
        }

        if (file) {
          await query(
            `INSERT INTO evidence_versions (evidence_id, version_number, file_name, file_type, file_size, storage_path, uploaded_by, version_notes)
             VALUES ($1, 1, $2, $3, $4, $5, $6, 'Initial version')
             ON CONFLICT (evidence_id, version_number) DO NOTHING`,
            [vaultItem.id, file.originalname, file.mimetype, file.size, fileRef, row.uploaded_by]
          );
        }
      }
    }

    // Auto-run AI analysis on the (new or re-versioned) vault item so reviewers
    // and auditors always have a cached, up-to-date result. Fire-and-forget.
    if (file && vaultItemId) {
      queueEvidenceAnalysis({ vaultId: vaultItemId, companyId });
    }
  }

  return evidenceRecord;
}
