/**
 * Moves a company's existing evidence files from one storage backend to another
 * when an admin switches company_settings.evidence_storage_backend.
 *
 * Runs fire-and-forget (like the scheduler): the settings endpoint flips the
 * config, then calls runStorageMigration(companyId) without awaiting. Progress is
 * tracked on company_settings.evidence_storage_migration_status:
 *   'in_progress' -> running (or interrupted by a restart)
 *   'failed'      -> stopped on an error (retryable)
 *   NULL          -> done (or never needed)
 *
 * The *source* backend descriptor + its encrypted credential live in the
 * storage_migrations table for the lifetime of the job, so a migration can be
 * resumed after an API restart with no admin credential re-entry. The *target*
 * side is always the company's current company_settings backend + active
 * company_storage_credentials row.
 *
 * Refs are rewritten per-row, so a partial run is always safe: every row points
 * at whichever backend actually holds its bytes.
 */
import path from "path";
import {
  parseRef,
  makeRef,
  refBackend,
  getBackendHandler,
} from "./evidenceStorage.js";
import { query, mapRow } from "../db/index.js";
import { getStorageCredential } from "../db/storageCredentials.js";
import { getStorageMigration, deleteStorageMigration } from "../db/storageMigrations.js";

// Guards against a migration being triggered twice in the same process (e.g. the
// Retry button pressed while a run is genuinely still going).
const _running = new Set();

async function collectRefs(companyId, fromBackend) {
  const refs = new Set();
  // evidence / evidence_vault filter by company_id directly; evidence_versions
  // has no company_id, so scope it via its parent vault item.
  const evidence = await query(
    "SELECT file_path AS ref FROM evidence WHERE company_id = $1 AND file_path IS NOT NULL",
    [companyId]
  );
  const vault = await query(
    "SELECT storage_path AS ref FROM evidence_vault WHERE company_id = $1 AND storage_path IS NOT NULL",
    [companyId]
  );
  const versions = await query(
    `SELECT ev.storage_path AS ref
       FROM evidence_versions ev
       JOIN evidence_vault v ON v.id = ev.evidence_id
      WHERE v.company_id = $1 AND ev.storage_path IS NOT NULL`,
    [companyId]
  );
  for (const row of [...evidence.rows, ...vault.rows, ...versions.rows]) {
    if (refBackend(row.ref) === fromBackend) refs.add(row.ref);
  }
  return [...refs];
}

/** Distinct storage backends currently referenced by a company's evidence rows. */
// F-23: storage/SDK errors can carry object keys, paths or endpoint details, so the
// admin sees only a short classification; the full error is in the server log above.
export function publicMigrationError(err) {
  const code = [err?.code, err?.name].find((c) => typeof c === "string" && /^[A-Za-z][A-Za-z0-9_.-]{0,40}$/.test(c) && c !== "Error");
  return `Could not copy the evidence files${code ? ` (${code})` : ""}. Check the storage settings and credentials, then retry.`;
}

export async function companyRefBackends(companyId) {
  const evidence = await query("SELECT file_path AS ref FROM evidence WHERE company_id = $1 AND file_path IS NOT NULL", [companyId]);
  const vault = await query("SELECT storage_path AS ref FROM evidence_vault WHERE company_id = $1 AND storage_path IS NOT NULL", [companyId]);
  const versions = await query(
    `SELECT ev.storage_path AS ref FROM evidence_versions ev
       JOIN evidence_vault v ON v.id = ev.evidence_id
      WHERE v.company_id = $1 AND ev.storage_path IS NOT NULL`,
    [companyId]
  );
  const set = new Set();
  for (const row of [...evidence.rows, ...vault.rows, ...versions.rows]) set.add(refBackend(row.ref));
  return set;
}

export async function companyHasObjectsOn(companyId, backend) {
  return (await companyRefBackends(companyId)).has(backend);
}

async function streamToBuffer(stream) {
  const chunks = [];
  for await (const chunk of stream) chunks.push(typeof chunk === "string" ? Buffer.from(chunk) : chunk);
  return Buffer.concat(chunks);
}

async function rewriteRef(companyId, oldRef, newRef) {
  await query("UPDATE evidence SET file_path = $1, updated_at = NOW() WHERE company_id = $2 AND file_path = $3", [newRef, companyId, oldRef]);
  await query("UPDATE evidence_vault SET storage_path = $1, updated_at = NOW() WHERE company_id = $2 AND storage_path = $3", [newRef, companyId, oldRef]);
  await query(
    `UPDATE evidence_versions SET storage_path = $1
       WHERE storage_path = $2
         AND evidence_id IN (SELECT id FROM evidence_vault WHERE company_id = $3)`,
    [newRef, oldRef, companyId]
  );
}

async function clearMigrationState(companyId) {
  await deleteStorageMigration(companyId);
  await query(
    `UPDATE company_settings
        SET evidence_storage_migration_status = NULL,
            evidence_storage_migration_error = NULL,
            evidence_storage_migration_at = NOW(),
            updated_at = NOW()
      WHERE company_id = $1`,
    [companyId]
  );
}

// Rebuild the target backend descriptor from the company's current settings.
async function loadTargetDescriptor(companyId) {
  const row = mapRow(await query(
    "SELECT evidence_storage_backend, evidence_storage_config FROM company_settings WHERE company_id = $1",
    [companyId]
  ));
  const backend = row?.evidenceStorageBackend || "local";
  const config = row?.evidenceStorageConfig || {};
  if (backend === "local") return { backend, config, authType: null, secret: null };
  const cred = await getStorageCredential(companyId);
  return { backend, config, authType: cred?.authType || null, secret: cred?.secret || null };
}

/**
 * Migrate every remaining source-backend object for a company onto its current
 * target backend. Idempotent and restart-safe: both sides are reconstructed from
 * the database (target from company_settings, source from storage_migrations), so
 * calling this again after a crash simply resumes.
 *
 * @param {number} companyId
 */
export async function runStorageMigration(companyId) {
  const cid = Number(companyId);
  if (_running.has(cid)) {
    console.log(`[storageMigration] company ${cid}: already running in this process, skipping`);
    return;
  }
  _running.add(cid);
  try {
    const from = await getStorageMigration(cid);
    if (!from) {
      // Nothing left to migrate — resolve any stuck status.
      await clearMigrationState(cid);
      return;
    }
    const to = await loadTargetDescriptor(cid);

    const fromHandler = getBackendHandler({
      backend: from.fromBackend,
      config: from.fromConfig,
      authType: from.fromAuthType,
      secret: from.fromSecret,
    });
    const toHandler = getBackendHandler(to);
    const refs = await collectRefs(cid, from.fromBackend);

    for (const oldRef of refs) {
      const { key } = parseRef(oldRef);
      const stream = await fromHandler.openStream(key);
      if (!stream) {
        // Source object is gone — drop the dangling ref rather than aborting.
        console.warn(`[storageMigration] company ${cid}: source object missing for ${oldRef}, skipping`);
        continue;
      }
      const buffer = await streamToBuffer(stream);
      const scope = /(^|\/)vault\//.test(key) ? "vault" : "evidence";
      const newKey = await toHandler.save(cid, {
        buffer,
        originalName: path.basename(key),
        scope,
      });
      const newRef = makeRef(to.backend, newKey);
      await rewriteRef(cid, oldRef, newRef);
      try {
        await fromHandler.delete(key);
      } catch {
        /* best effort — the ref already points at the new copy */
      }
    }

    await clearMigrationState(cid);
    console.log(`[storageMigration] company ${cid}: migrated ${refs.length} object(s) ${from.fromBackend} -> ${to.backend}`);
  } catch (err) {
    console.error(`[storageMigration] company ${cid} failed:`, err);
    await query(
      `UPDATE company_settings
          SET evidence_storage_migration_status = 'failed',
              evidence_storage_migration_error = $2,
              updated_at = NOW()
        WHERE company_id = $1`,
      [cid, publicMigrationError(err)]
    ).catch(() => {});
  } finally {
    _running.delete(cid);
  }
}
