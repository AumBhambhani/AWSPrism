import { mapRow, mapRows, query } from "../db/index.js";
import { deleteObject, readObjectBuffer, saveObject } from "./evidenceStorage.js";
import { isScannerConfigured, scanBuffer } from "./scanFile.js";
import { finalizeEvidenceUpload, finalizeVaultUpload, finalizeVaultVersion, UploadRefusedError } from "./evidenceUploads.js";
import { FulfilError, fulfilEvidenceRequest } from "./evidenceRequestFulfil.js";
import { writeAuditLog } from "./auditLog.js";
import { sendEmail } from "./email.js";
import { buildEmailHtml } from "./emailTemplate.js";

// F-12 — uploads that arrive while ClamAV is configured but unavailable are held here
// instead of being accepted unscanned. The bytes live under the company's "quarantine"
// storage scope and are referenced only by upload_quarantine, so nothing can view,
// link, approve or analyse them. The scheduler rescans pending rows; a clean file is
// finalised exactly as if it had just been uploaded, anything else is deleted and the
// uploader is told.

export const PENDING_SCAN_MESSAGE =
  "The malware scanner is temporarily unavailable. Your file has been quarantined and will be added automatically once it has been scanned.";

const ttlMs = () => parseFloat(process.env.UPLOAD_QUARANTINE_TTL_HOURS || "24") * 60 * 60 * 1000;
const STALE_PROCESSING = "10 minutes";

export async function quarantineUpload({ companyId, user, kind, params, file }) {
  const ref = await saveObject(companyId, {
    buffer: file.buffer,
    originalName: file.originalname,
    scope: "quarantine",
    contentType: file.mimetype,
  });
  const result = await query(
    `INSERT INTO upload_quarantine (company_id, user_id, kind, params, storage_ref, file_name, file_type, file_size)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8) RETURNING *`,
    [companyId, user?.userId ?? null, kind, JSON.stringify(params || {}), ref, file.originalname, file.mimetype, file.size]
  );
  const row = mapRow(result);
  await writeAuditLog({
    userId: user?.userId, companyId, email: user?.email,
    action: "UPLOAD_QUARANTINED", resource: "upload_quarantine",
    detail: { quarantineId: row.id, kind, fileName: file.originalname },
  });
  return row;
}

export function pendingScanResponse(row) {
  return { status: "pending_scan", quarantineId: row.id, fileName: row.fileName, message: PENDING_SCAN_MESSAGE };
}

async function notifyUploader(row, { title, body }) {
  if (!row.userId) return;
  try {
    const u = await query("SELECT email FROM users WHERE id = $1 AND company_id = $2", [row.userId, row.companyId]);
    await query(
      `INSERT INTO notifications (company_id, user_id, title, body, entity_type, entity_id)
       VALUES ($1, $2, $3, $4, 'upload_quarantine', $5)`,
      [row.companyId, row.userId, title, body, row.id]
    );
    const email = u.rows[0]?.email;
    if (email) {
      await sendEmail({
        to: email,
        subject: title,
        text: body,
        html: buildEmailHtml({
          heading: title,
          preheader: body,
          body,
          details: [{ label: "File", value: row.fileName || "upload" }],
          cta: { text: "Open PRISM", url: process.env.WEB_URL || "https://prismgrc.co" },
        }),
      });
    }
  } catch (e) {
    console.error("[quarantine] failed to notify uploader:", e.message);
  }
}

// Resolve a row this worker still owns (same claim_token). Returns false — and touches
// nothing — if the claim was lost to another run.
async function resolve(row, status, { lastError = null, result = null, from = ["processing", "finalizing"] } = {}) {
  const done = await query(
    `UPDATE upload_quarantine SET status = $1, last_error = $2, result = $3, resolved_at = NOW()
     WHERE id = $4 AND claim_token = $5 AND status = ANY($6::text[])`,
    [status, lastError, result ? JSON.stringify(result) : null, row.id, row.claimToken, from]
  );
  if (done.rowCount === 0) return false;
  try { await deleteObject(row.companyId, row.storageRef); } catch { /* non-fatal */ }
  await writeAuditLog({
    userId: row.userId, companyId: row.companyId,
    action: `UPLOAD_QUARANTINE_${status.toUpperCase()}`, resource: "upload_quarantine",
    detail: { quarantineId: row.id, kind: row.kind, fileName: row.fileName, error: lastError, result },
  });
  return true;
}

async function actorFor(row) {
  if (!row.userId) return null;
  const r = await query("SELECT id, email, role FROM users WHERE id = $1 AND company_id = $2", [row.userId, row.companyId]);
  const u = r.rows[0];
  return u ? { userId: u.id, email: u.email, role: u.role } : null;
}

async function finalize(row, file) {
  const p = row.params || {};
  const companyId = row.companyId;
  if (row.kind === "vault") {
    const item = await finalizeVaultUpload({ companyId, uploadedBy: p.uploadedBy, title: p.title, description: p.description, questId: p.questId, file });
    const result = { vaultId: item.id };
    if (p.fulfilRequestId) {
      const actor = await actorFor(row);
      try {
        if (!actor) throw new FulfilError(403, "Uploader no longer exists");
        await fulfilEvidenceRequest({ companyId, requestId: p.fulfilRequestId, vaultId: item.id, actor });
        result.fulfilledRequestId = p.fulfilRequestId;
      } catch (e) {
        if (!(e instanceof FulfilError)) throw e;
        result.fulfilError = e.message;
      }
    }
    return result;
  }
  if (row.kind === "vault_version") {
    const ver = await finalizeVaultVersion({ companyId, vaultId: p.vaultId, uploadedBy: p.uploadedBy, versionNotes: p.versionNotes, file });
    return { vaultId: p.vaultId, versionId: ver.id, versionNumber: ver.versionNumber };
  }
  if (row.kind === "evidence") {
    const ev = await finalizeEvidenceUpload({ companyId, data: p.data, file });
    return { evidenceId: ev.id };
  }
  throw new Error(`unknown quarantine kind ${row.kind}`);
}

async function processOne(row) {
  const expired = Date.now() - new Date(row.createdAt).getTime() > ttlMs();
  const buffer = await readObjectBuffer(row.companyId, row.storageRef);
  if (!buffer) {
    if (!(await resolve(row, "expired", { lastError: "Quarantined file is missing from storage" }))) return "lost";
    await notifyUploader(row, {
      title: "Upload could not be completed",
      body: `"${row.fileName}" could not be scanned and was discarded. Please upload it again.`,
    });
    return "expired";
  }

  const scan = await scanBuffer(buffer, row.fileType);
  if (scan.unavailable) {
    if (!expired) {
      await query("UPDATE upload_quarantine SET status = 'pending', last_error = $1 WHERE id = $2 AND claim_token = $3 AND status = 'processing'", [scan.reason, row.id, row.claimToken]);
      return "pending";
    }
    if (!(await resolve(row, "expired", { lastError: "Malware scanner stayed unavailable" }))) return "lost";
    await notifyUploader(row, {
      title: "Upload expired before it could be scanned",
      body: `"${row.fileName}" could not be scanned within 24 hours because the malware scanner was unavailable, so it was discarded. Please upload it again.`,
    });
    return "expired";
  }
  if (!scan.safe) {
    if (!(await resolve(row, "infected", { lastError: scan.reason }))) return "lost";
    await notifyUploader(row, {
      title: "Upload rejected by the malware scanner",
      body: `"${row.fileName}" was rejected (${scan.reason}) and has been deleted.`,
    });
    return "infected";
  }

  // Re-check the uploader at release time: still a writer, company still active.
  const actor = await actorFor(row);
  const company = (await query("SELECT status, is_verified FROM companies WHERE id = $1", [row.companyId])).rows[0];
  const refusal = !actor || !["ADMIN", "LEAD", "CONTRIBUTOR"].includes(actor.role)
    ? "the uploader no longer has permission to add evidence"
    : !company || ["rejected", "suspended"].includes(company.status)
      ? "the company account is not active"
      : null;
  if (refusal) {
    if (!(await resolve(row, "rejected", { lastError: refusal }))) return "lost";
    await notifyUploader(row, {
      title: "Quarantined upload could not be added",
      body: `"${row.fileName}" passed the malware scan but could not be added: ${refusal}.`,
    });
    return "rejected";
  }

  // From here on the upload may be partly written. 'finalizing' is never retried
  // automatically, so a crash cannot release the same file twice.
  const owned = await query(
    "UPDATE upload_quarantine SET status = 'finalizing' WHERE id = $1 AND status = 'processing' AND claim_token = $2 RETURNING id",
    [row.id, row.claimToken]
  );
  if (owned.rowCount === 0) return "lost"; // another run recovered this claim
  try {
    const result = await finalize(row, { buffer, originalname: row.fileName, mimetype: row.fileType, size: Number(row.fileSize) || buffer.length });
    if (!(await resolve(row, "released", { result }))) return "lost";
    await notifyUploader(row, {
      title: "Quarantined upload has been added",
      body: `"${row.fileName}" passed the malware scan and has been added.` +
        (result.fulfilError ? ` It could not be attached to the evidence request: ${result.fulfilError}` : ""),
    });
    return "released";
  } catch (e) {
    if (!(e instanceof UploadRefusedError)) throw e;
    if (!(await resolve(row, "rejected", { lastError: e.message }))) return "lost";
    await notifyUploader(row, {
      title: "Quarantined upload could not be added",
      body: `"${row.fileName}" passed the malware scan but could not be added: ${e.message}`,
    });
    return "rejected";
  }
}

// Rescan pending quarantined uploads. Safe to call concurrently: rows are claimed by
// flipping them to 'processing' with SKIP LOCKED; a claim left behind by a crashed run
// is returned to 'pending' after STALE_PROCESSING. A row left in 'finalizing' (crash
// mid-release) is never retried automatically — it may be partly written — and is
// logged for an operator instead.
async function expireStaleWithoutScan() {
  const stale = mapRows(await query(
    `UPDATE upload_quarantine SET status = 'processing', last_attempt_at = NOW(),
            claim_token = md5(random()::text || clock_timestamp()::text || id::text)
     WHERE status = 'pending' AND created_at < NOW() - make_interval(secs => $1)
     RETURNING *`,
    [ttlMs() / 1000]
  ));
  for (const row of stale) {
    if (!(await resolve(row, "expired", { lastError: "No malware scanner configured" }))) continue;
    await notifyUploader(row, {
      title: "Upload expired before it could be scanned",
      body: `"${row.fileName}" could not be scanned within 24 hours, so it was discarded. Please upload it again.`,
    });
  }
  return stale.length;
}

export async function processQuarantine({ limit = 25 } = {}) {
  // Without a configured scanner nothing can be verified — keep files held, but still
  // expire the ones past the TTL so they are not kept forever.
  if (!isScannerConfigured()) {
    const expired = await expireStaleWithoutScan();
    return expired ? { skipped: true, expired } : { skipped: true };
  }

  await query(
    `UPDATE upload_quarantine SET status = 'pending'
     WHERE status = 'processing' AND last_attempt_at < NOW() - INTERVAL '${STALE_PROCESSING}'`
  );
  const stuck = await query(
    `SELECT id FROM upload_quarantine WHERE status = 'finalizing' AND last_attempt_at < NOW() - INTERVAL '${STALE_PROCESSING}'`
  );
  if (stuck.rows.length) {
    console.error("[quarantine] uploads stuck mid-release, needs manual check:", stuck.rows.map((r) => r.id).join(", "));
  }
  const claimed = mapRows(await query(
    `UPDATE upload_quarantine SET status = 'processing', attempts = attempts + 1, last_attempt_at = NOW(),
            claim_token = md5(random()::text || clock_timestamp()::text || id::text)
     WHERE id IN (
       SELECT id FROM upload_quarantine WHERE status = 'pending'
       ORDER BY created_at LIMIT $1 FOR UPDATE SKIP LOCKED
     )
     RETURNING *`,
    [limit]
  ));

  const outcome = {};
  for (const row of claimed) {
    try {
      const r = await processOne(row);
      outcome[r] = (outcome[r] || 0) + 1;
    } catch (e) {
      console.error(`[quarantine] failed to process upload ${row.id}:`, e.message);
      // Past the TTL and never reached 'finalizing' (e.g. the company switched storage
      // backend and the held object is unreachable): expire it. A row that failed while
      // finalizing may be partly written, so it is left for an operator instead.
      if (Date.now() - new Date(row.createdAt).getTime() > ttlMs()
          && await resolve(row, "expired", { lastError: e.message, from: ["processing"] })) {
        await notifyUploader(row, {
          title: "Upload could not be completed",
          body: `"${row.fileName}" could not be processed within 24 hours and was discarded. Please upload it again.`,
        });
        outcome.expired = (outcome.expired || 0) + 1;
        continue;
      }
      // Only a claim that never reached 'finalizing' goes back to the queue.
      await query("UPDATE upload_quarantine SET status = 'pending', last_error = $1 WHERE id = $2 AND claim_token = $3 AND status = 'processing'", [e.message, row.id, row.claimToken]);
      await query("UPDATE upload_quarantine SET last_error = $1 WHERE id = $2 AND claim_token = $3 AND status = 'finalizing'", [e.message, row.id, row.claimToken]);
      outcome.error = (outcome.error || 0) + 1;
    }
  }
  return outcome;
}
