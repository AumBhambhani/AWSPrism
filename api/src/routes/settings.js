import { Router } from "express";
import bcrypt from "bcryptjs";
import { authenticate } from "../middleware/auth.js";
import { query, mapRow } from "../db/index.js";
import { logoUpload, saveCompanyLogo } from "../utils/logoStorage.js";
import { scanDiskUpload } from "../utils/scanUpload.js";
import { asyncHandler } from "../utils/asyncHandler.js";
import { deleteCompanyFiles } from "../utils/deleteCompanyFiles.js";
import { writeAuditLog } from "../utils/auditLog.js";
import { testBackend, invalidateStorage, parseAzureConnectionString } from "../utils/evidenceStorage.js";
import { getStorageCredential, storeStorageCredential, deleteStorageCredential } from "../db/storageCredentials.js";
import { upsertStorageMigration, deleteStorageMigration } from "../db/storageMigrations.js";
import { runStorageMigration, companyHasObjectsOn } from "../utils/storageMigration.js";


const router = Router();

// GET /api/settings — get company settings
router.get("/", authenticate, asyncHandler(async (req, res) => {
  const companyId = req.user?.companyId;
  if (!companyId) {
    return res.json({ logoUrl: null, primaryColor: null, aiEnabled: false });
  }

  const result = await query(
    `SELECT logo_url, primary_color, ai_enabled,
            evidence_storage_backend, evidence_storage_migration_status
       FROM company_settings WHERE company_id = $1`,
    [companyId]
  );

  if (result.rows.length === 0) {
    return res.json({
      logoUrl: null, primaryColor: null, aiEnabled: false,
      evidenceStorage: { backend: "local", migrationStatus: null },
    });
  }

  const row = result.rows[0];
  res.json({
    logoUrl: row.logo_url || null,
    primaryColor: row.primary_color || null,
    aiEnabled: row.ai_enabled || false,
    evidenceStorage: {
      backend: row.evidence_storage_backend || "local",
      migrationStatus: row.evidence_storage_migration_status || null,
    },
  });
}));

// ─── Evidence storage backend (BYO S3 / Azure Blob) ─────────────────────────

// Validate + normalise the { backend, config, secret } body. Throws a 400 on a
// bad shape; returns { backend, config, authType, secret } on success.
function parseStorageBody(body) {
  const bad = (msg) => Object.assign(new Error(msg), { status: 400 });
  const backend = body?.backend;
  if (!["local", "s3", "azure_blob"].includes(backend)) throw bad("backend must be 'local', 's3', or 'azure_blob'");

  if (backend === "local") return { backend, config: {}, authType: null, secret: null };

  const config = body?.config || {};
  const secret = body?.secret || {};

  if (backend === "s3") {
    if (!config.bucket || !config.region) throw bad("S3 requires config.bucket and config.region");
    const authType = body?.authType;
    if (!["access_key", "iam_role"].includes(authType)) throw bad("S3 authType must be 'access_key' or 'iam_role'");
    const cleanConfig = { bucket: String(config.bucket).trim(), region: String(config.region).trim() };
    if (!/^[a-z]{2}(-[a-z]+)+-\d{1,2}$/.test(cleanConfig.region)) throw bad("config.region must be an AWS region such as eu-west-1");
    if (config.prefix) cleanConfig.prefix = String(config.prefix).trim().replace(/^\/+|\/+$/g, "");
    if (authType === "access_key") {
      if (!secret.accessKeyId || !secret.secretAccessKey) throw bad("Access key credentials require accessKeyId and secretAccessKey");
      return { backend, config: cleanConfig, authType, secret: {
        accessKeyId: String(secret.accessKeyId).trim(),
        secretAccessKey: String(secret.secretAccessKey).trim(),
        ...(secret.sessionToken ? { sessionToken: String(secret.sessionToken).trim() } : {}),
      } };
    }
    // iam_role
    if (!config.roleArn) throw bad("IAM role requires config.roleArn");
    if (!secret.externalId) throw bad("IAM role requires secret.externalId");
    cleanConfig.roleArn = String(config.roleArn).trim();
    return { backend, config: cleanConfig, authType, secret: { externalId: String(secret.externalId).trim() } };
  }

  // azure_blob
  if (!config.container) throw bad("Azure Blob requires config.container");
  if (!secret.connectionString) throw bad("Azure Blob requires secret.connectionString");
  try {
    parseAzureConnectionString(String(secret.connectionString).trim());
  } catch (e) {
    throw bad(e.message);
  }
  return {
    backend,
    config: { container: String(config.container).trim() },
    authType: "connection_string",
    secret: { connectionString: String(secret.connectionString).trim() },
  };
}

async function currentStorage(companyId) {
  const result = await query(
    `SELECT evidence_storage_backend, evidence_storage_config,
            evidence_storage_migration_status, evidence_storage_migration_error,
            evidence_storage_migration_at
       FROM company_settings WHERE company_id = $1`,
    [companyId]
  );
  const row = mapRow(result);
  return {
    backend: row?.evidenceStorageBackend || "local",
    config: row?.evidenceStorageConfig || {},
    migrationStatus: row?.evidenceStorageMigrationStatus || null,
    migrationError: row?.evidenceStorageMigrationError || null,
    migrationAt: row?.evidenceStorageMigrationAt || null,
  };
}

// GET /api/settings/evidence-storage — current backend + non-secret config
router.get("/evidence-storage", authenticate, asyncHandler(async (req, res) => {
  const companyId = req.user?.companyId;
  if (!companyId) return res.status(400).json({ error: "No company context" });
  if (req.user.role !== "ADMIN") return res.status(403).json({ error: "Admin only" });

  const cur = await currentStorage(companyId);
  const cred = cur.backend === "local" ? null : await getStorageCredential(companyId);
  res.json({
    backend: cur.backend,
    config: cur.config,
    authType: cred?.authType || null,
    migrationStatus: cur.migrationStatus,
    migrationError: cur.migrationError,
    migrationAt: cur.migrationAt,
  });
}));

// PUT /api/settings/evidence-storage — switch backend (validates + tests connectivity,
// then migrates existing files in the background)
router.put("/evidence-storage", authenticate, asyncHandler(async (req, res) => {
  const companyId = req.user?.companyId;
  if (!companyId) return res.status(400).json({ error: "No company context" });
  if (req.user.role !== "ADMIN") return res.status(403).json({ error: "Admin only" });

  const next = parseStorageBody(req.body);
  const cur = await currentStorage(companyId);

  if (cur.migrationStatus === "in_progress") {
    return res.status(409).json({ error: "A storage migration is already running. Wait for it to finish before switching again." });
  }

  if (next.backend !== "local") {
    await testBackend(next); // throws 400 with a friendly message on failure
  }

  const needsMigration = cur.backend !== next.backend && (await companyHasObjectsOn(companyId, cur.backend));

  // Snapshot the *source* backend + its credential BEFORE we overwrite the
  // active credential row, so an interrupted migration can be resumed later.
  if (needsMigration) {
    const fromCred = cur.backend === "local" ? null : await getStorageCredential(companyId);
    await upsertStorageMigration({
      companyId,
      fromBackend: cur.backend,
      fromConfig: cur.config,
      fromAuthType: fromCred?.authType,
      fromSecret: fromCred?.secret,
    });
  } else {
    // No migration needed — clear any stale/failed job left from a superseded attempt.
    await deleteStorageMigration(companyId);
  }

  if (next.backend === "local") await deleteStorageCredential(companyId);
  else await storeStorageCredential({ companyId, authType: next.authType, secret: next.secret });

  await query(
    `INSERT INTO company_settings (company_id, evidence_storage_backend, evidence_storage_config, evidence_storage_migration_status, evidence_storage_migration_error)
     VALUES ($1, $2, $3, $4, NULL)
     ON CONFLICT (company_id) DO UPDATE SET
       evidence_storage_backend = $2, evidence_storage_config = $3,
       evidence_storage_migration_status = $4, evidence_storage_migration_error = NULL,
       updated_at = NOW()`,
    [companyId, next.backend, JSON.stringify(next.config), needsMigration ? "in_progress" : null]
  );
  invalidateStorage(companyId);

  await writeAuditLog({
    userId: req.user.userId,
    companyId,
    action: "STORAGE_BACKEND_CHANGED",
    resource: "company_settings",
    detail: { from: cur.backend, to: next.backend },
  });

  if (needsMigration) {
    runStorageMigration(companyId);
    return res.json({ ok: true, migrating: true });
  }

  res.json({ ok: true, migrating: false });
}));

// POST /api/settings/evidence-storage/retry-migration — resume a failed or
// restart-interrupted migration. The source descriptor + credential are read
// from the storage_migrations row, so this works even after an API restart with
// no admin credential re-entry.
router.post("/evidence-storage/retry-migration", authenticate, asyncHandler(async (req, res) => {
  const companyId = req.user?.companyId;
  if (!companyId) return res.status(400).json({ error: "No company context" });
  if (req.user.role !== "ADMIN") return res.status(403).json({ error: "Admin only" });

  const cur = await currentStorage(companyId);
  if (!cur.migrationStatus) {
    return res.status(400).json({ error: "There is no migration to retry." });
  }

  await query(
    `UPDATE company_settings SET evidence_storage_migration_status = 'in_progress',
            evidence_storage_migration_error = NULL, updated_at = NOW()
      WHERE company_id = $1`,
    [companyId]
  );
  runStorageMigration(companyId);
  res.json({ ok: true, migrating: true });
}));

// POST /api/settings/logo — upload company logo
// Company and role are checked before multer writes anything to disk.
function requireCompanyAdmin(req, res, next) {
  if (!req.user?.companyId) return res.status(400).json({ error: "No company context" });
  if (req.user.role !== "ADMIN") return res.status(403).json({ error: "Admin only" });
  next();
}

router.post("/logo", authenticate, requireCompanyAdmin, logoUpload.single("logo"), scanDiskUpload(), asyncHandler(async (req, res) => {
  const companyId = req.user.companyId;
  if (!req.file) return res.status(400).json({ error: "No file uploaded" });

  const logoUrl = await saveCompanyLogo(companyId, req.file.filename);
  res.json({ logoUrl });
}));

// GET /api/settings/tech-stack — get technology stack for this company
router.get("/tech-stack", authenticate, asyncHandler(async (req, res) => {
  const companyId = req.user?.companyId;
  if (!companyId) return res.json({});

  const result = await query(
    "SELECT technology_stack FROM company_settings WHERE company_id = $1",
    [companyId]
  );

  res.json(result.rows[0]?.technology_stack || {});
}));

// PUT /api/settings/tech-stack — save technology stack for this company
router.put("/tech-stack", authenticate, asyncHandler(async (req, res) => {
  const companyId = req.user?.companyId;
  if (!companyId) return res.status(400).json({ error: "No company context" });
  if (req.user.role !== "ADMIN") return res.status(403).json({ error: "Admin only" });

  const stack = req.body;
  if (typeof stack !== "object" || Array.isArray(stack)) {
    return res.status(400).json({ error: "Body must be a JSON object" });
  }

  await query(
    `INSERT INTO company_settings (company_id, technology_stack)
     VALUES ($1, $2)
     ON CONFLICT (company_id) DO UPDATE SET technology_stack = $2, updated_at = NOW()`,
    [companyId, JSON.stringify(stack)]
  );

  res.json({ saved: true });
}));

// PUT /api/settings — update company settings
router.put("/", authenticate, asyncHandler(async (req, res) => {
  const companyId = req.user?.companyId;
  if (!companyId) {
    return res.status(400).json({ error: "No company context" });
  }
  if (req.user.role !== "ADMIN") {
    return res.status(403).json({ error: "Admin only" });
  }

  // AI is opt-in and superadmin-controlled — ai_enabled is intentionally NOT
  // writable here (see PATCH /api/superadmin/companies/:id/ai-toggle).
  const { primaryColor } = req.body;

  await query(
    `INSERT INTO company_settings (company_id, primary_color)
     VALUES ($1, $2)
     ON CONFLICT (company_id) DO UPDATE SET primary_color = $2, updated_at = NOW()`,
    [companyId, primaryColor || null]
  );

  res.json({ success: true });
}));

// DELETE /api/settings/company — permanently delete the caller's own company (ADMIN only)
router.delete("/company", authenticate, asyncHandler(async (req, res) => {
  const companyId = req.user?.companyId;
  if (!companyId) return res.status(400).json({ error: "No company context" });
  if (req.user.role !== "ADMIN") return res.status(403).json({ error: "Admin only" });

  const { password, companyName } = req.body;
  if (!password || !companyName) {
    return res.status(400).json({ error: "Password and company name confirmation are required" });
  }

  const userResult = await query("SELECT password_hash FROM users WHERE id = $1", [req.user.userId]);
  const passwordHash = userResult.rows[0]?.password_hash;
  if (!passwordHash) return res.status(401).json({ error: "Unable to verify password" });

  const valid = await bcrypt.compare(password, passwordHash);
  if (!valid) return res.status(401).json({ error: "Incorrect password" });

  const companyResult = await query("SELECT name FROM companies WHERE id = $1", [companyId]);
  const company = companyResult.rows[0];
  if (!company) return res.status(404).json({ error: "Company not found" });
  if (companyName.trim() !== company.name) {
    return res.status(400).json({ error: "Company name confirmation does not match" });
  }

  await deleteCompanyFiles(companyId);
  await query("DELETE FROM companies WHERE id = $1", [companyId]);

  res.json({ deleted: true });
}));

export default router;
