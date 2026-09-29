import { Router } from "express";
import { authenticate } from "../middleware/auth.js";
import { query, getClient, mapRow } from "../db/index.js";
import { logoUpload, saveCompanyLogo } from "../utils/logoStorage.js";
import { scanDiskUpload, scanXlsxUpload } from "../utils/scanUpload.js";
import { asyncHandler } from "../utils/asyncHandler.js";
import { deriveSortOrder } from "../utils/prismOrder.js";
import multer from "multer";
import fs from "fs";
import path from "path";
import { parseExcelImport } from "../utils/excelParser.js";
import { importFrameworkQuestions, provisionTemplate, computeVersionDiff } from "./frameworks.js";
import { findTemplateMatches } from "../utils/templateMatch.js";
import { deleteCompanyFiles } from "../utils/deleteCompanyFiles.js";
import { sendEmail } from "../utils/email.js";
import { buildEmailHtml } from "../utils/emailTemplate.js";
import { buildCompanyReport, departmentStatus } from "./selfAssessment.js";
import { buildReadinessDocx, DOCX_MIME } from "../utils/selfAssessmentDocx.js";
import { deptQuestionBase, expandQuestions } from "../utils/deptSelfAssessQuestions.js";
import { IT_DERIVED_QUESTIONS } from "../data/itCapabilityMap.js";
import { seedAssessmentsFromSelfAssessment } from "../utils/seedAssessmentsFromSelfAssessment.js";

// Where a superadmin-generated gap-assessment report is emailed.
const GAP_REPORT_RECIPIENT = process.env.GAP_REPORT_RECIPIENT || "ab@neozaar.com";

const router = Router();

// Middleware: only SUPERADMIN
const requireSuperAdmin = (req, res, next) => {
  if (req.user?.role !== "SUPERADMIN") {
    return res.status(403).json({ error: "Forbidden" });
  }
  next();
};

// GET /api/superadmin/companies — list all companies with AI status
router.get("/companies", authenticate, requireSuperAdmin, asyncHandler(async (req, res) => {
  const result = await query(
    `SELECT c.id, c.name, c.domain, c.admin_email, c.industry, c.company_size, c.status, c.is_verified, c.created_at,
            c.plan, c.billing_status, c.trial_ends_at,
            c.self_assessment_completed_at, c.self_assessment_all_departments_at,
            COALESCE(cs.ai_enabled, false) AS ai_enabled,
            cs.ai_provider,
            c.template_id,
            mt.name AS template_name
     FROM companies c
     LEFT JOIN company_settings cs ON cs.company_id = c.id
     LEFT JOIN module_templates mt ON mt.id = c.template_id
     ORDER BY c.created_at DESC`
  );
  res.json(result.rows);
}));

// PATCH /api/superadmin/companies/:id/status — unified status management
router.patch("/companies/:id/status", authenticate, requireSuperAdmin, asyncHandler(async (req, res) => {
  const { id } = req.params;
  const { status } = req.body;

  const validStatuses = ["approved", "rejected", "suspended"];
  if (!status || !validStatuses.includes(status)) {
    return res.status(400).json({ error: `Invalid status. Must be one of: ${validStatuses.join(", ")}` });
  }

  const result = await query(
    `UPDATE companies
     SET status = $1, is_verified = ($1 = 'approved'), updated_at = NOW()
     WHERE id = $2 RETURNING id, name, domain, status, template_id`,
    [status, id]
  );

  if (result.rows.length === 0) {
    return res.status(404).json({ error: "Company not found" });
  }

  const company = result.rows[0];

  // When approving, reset onboarding so dept selection runs on next login
  if (status === "approved") {
    await query(
      "UPDATE users SET onboarding_completed = FALSE, updated_at = NOW() WHERE company_id = $1 AND role = 'ADMIN'",
      [id]
    );
  }

  // Auto-provision template when approving a company that has one assigned
  let templateProvisioned = false;
  if (status === "approved" && company.template_id) {
    const tplResult = await query("SELECT * FROM module_templates WHERE id = $1", [company.template_id]);
    if (tplResult.rows.length > 0) {
      const template = tplResult.rows[0];
      const modules = typeof template.module_data === "string" ? JSON.parse(template.module_data) : template.module_data;
      const questions = typeof template.question_data === "string" ? JSON.parse(template.question_data) : template.question_data;
      const frameworkKey = template.framework_key || null;
      const tplClient = await getClient();
      try {
        await tplClient.query("BEGIN");
        await provisionTemplate(tplClient, { companyId: company.id, modules, questions, frameworkKey });
        await tplClient.query("COMMIT");
        templateProvisioned = true;
      } catch (err) {
        await tplClient.query("ROLLBACK");
        console.error("[superadmin] Template provisioning failed:", err.message);
      } finally {
        tplClient.release();
      }
    }
  }

  // Pre-fill the tracker from the company's self-assessment answers so an
  // approved company starts from a realistic baseline. Draft (WIP) rows only —
  // does not move the readiness score. Best-effort: approval still stands if it
  // fails (mirrors the template-provisioning handling above).
  let selfAssessmentSeeded = 0;
  if (status === "approved") {
    const seedClient = await getClient();
    try {
      await seedClient.query("BEGIN");
      const r = await seedAssessmentsFromSelfAssessment(seedClient, company.id, { scope: "framework" });
      await seedClient.query("COMMIT");
      selfAssessmentSeeded = r.seeded;
    } catch (err) {
      await seedClient.query("ROLLBACK");
      console.error("[superadmin] Self-assessment seeding failed:", err.message);
    } finally {
      seedClient.release();
    }
  }

  res.json({ ...company, templateProvisioned, selfAssessmentSeeded });
}));

// PATCH /api/superadmin/companies/:id/seed-self-assessment — manually (re-)run the
// self-assessment -> tracker pre-fill for a company. Idempotent: never overwrites
// an existing assessment for the current month.
router.patch("/companies/:id/seed-self-assessment", authenticate, requireSuperAdmin, asyncHandler(async (req, res) => {
  const { id } = req.params;
  const exists = await query("SELECT id FROM companies WHERE id = $1", [id]);
  if (exists.rows.length === 0) return res.status(404).json({ error: "Company not found" });

  const client = await getClient();
  try {
    await client.query("BEGIN");
    const result = await seedAssessmentsFromSelfAssessment(client, Number(id), { scope: "all" });
    await client.query("COMMIT");
    res.json(result);
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  } finally {
    client.release();
  }
}));

// PATCH /api/superadmin/companies/:id/unapprove — revoke verification without changing status
router.patch("/companies/:id/unapprove", authenticate, requireSuperAdmin, asyncHandler(async (req, res) => {
  const { id } = req.params;

  const result = await query(
    `UPDATE companies SET is_verified = FALSE, updated_at = NOW() WHERE id = $1 RETURNING id, name, domain, status`,
    [id]
  );

  if (result.rows.length === 0) {
    return res.status(404).json({ error: "Company not found" });
  }

  res.json({ ...result.rows[0], isVerified: false });
}));

// PATCH /api/superadmin/companies/:id/start-onboarding — wipe dept data + reset onboarding flag (fresh start)
router.patch("/companies/:id/start-onboarding", authenticate, requireSuperAdmin, asyncHandler(async (req, res) => {
  const { id } = req.params;

  const client = await getClient();
  try {
    await client.query("BEGIN");
    await client.query("DELETE FROM questions WHERE company_id = $1 AND quest_id LIKE 'dept-%'", [id]);
    await client.query("DELETE FROM modules WHERE company_id = $1 AND module_id LIKE 'dept-%'", [id]);
    await client.query(
      "UPDATE users SET onboarding_completed = FALSE, updated_at = NOW() WHERE company_id = $1 AND role = 'ADMIN'",
      [id]
    );
    await client.query("COMMIT");
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  } finally {
    client.release();
  }

  res.json({ started: true });
}));

// PATCH /api/superadmin/companies/:id/reset-onboarding — re-show policy onboarding for this company's admin(s)
router.patch("/companies/:id/reset-onboarding", authenticate, requireSuperAdmin, asyncHandler(async (req, res) => {
  const { id } = req.params;

  const result = await query(
    "UPDATE users SET onboarding_completed = FALSE, updated_at = NOW() WHERE company_id = $1 AND role = 'ADMIN' RETURNING id",
    [id]
  );

  if (result.rows.length === 0) {
    return res.status(404).json({ error: "No admin users found for this company" });
  }

  res.json({ reset: true, usersUpdated: result.rows.length });
}));

// DELETE /api/superadmin/companies/:id — permanently delete a company and all its data
router.delete("/companies/:id", authenticate, requireSuperAdmin, asyncHandler(async (req, res) => {
  const { id } = req.params;

  const companyCheck = await query("SELECT id, name FROM companies WHERE id = $1", [id]);
  if (companyCheck.rows.length === 0) {
    return res.status(404).json({ error: "Company not found" });
  }
  const companyName = companyCheck.rows[0].name;

  // Remove uploaded files first — company_settings.logo_url disappears once the row cascades away
  await deleteCompanyFiles(id);

  // Delete in dependency order inside a transaction so partial failure leaves no orphans
  const client = await getClient();
  try {
    await client.query("BEGIN");
    await client.query("DELETE FROM reminders WHERE company_id = $1", [id]);
    await client.query("DELETE FROM actions WHERE company_id = $1", [id]);
    await client.query("DELETE FROM evidence WHERE company_id = $1", [id]);
    await client.query("DELETE FROM assessments WHERE company_id = $1", [id]);
    await client.query("DELETE FROM questions WHERE company_id = $1", [id]);
    await client.query("DELETE FROM modules WHERE company_id = $1", [id]);
    await client.query("DELETE FROM invitations WHERE company_id = $1", [id]);
    await client.query("DELETE FROM auditor_profiles WHERE company_id = $1", [id]);
    await client.query("DELETE FROM users WHERE company_id = $1", [id]);
    await client.query("DELETE FROM companies WHERE id = $1", [id]);
    await client.query("COMMIT");
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  } finally {
    client.release();
  }

  res.json({ deleted: true, companyName });
}));

// PATCH /api/superadmin/companies/:id/ai-toggle — toggle AI for a company
// PATCH /api/superadmin/companies/:id/billing — set plan and/or billing_status, optionally extend trial
router.patch("/companies/:id/billing", authenticate, requireSuperAdmin, asyncHandler(async (req, res) => {
  const { id } = req.params;
  const { plan, billingStatus, trialDays } = req.body;

  const validPlans = ["starter", "custom"];
  const validStatuses = ["trial", "active", "expired"];

  if (plan && !validPlans.includes(plan)) return res.status(400).json({ error: "Invalid plan" });
  if (billingStatus && !validStatuses.includes(billingStatus)) return res.status(400).json({ error: "Invalid billing status" });

  const sets = [];
  const vals = [];
  let i = 1;

  if (plan)          { sets.push(`plan = $${i++}`);           vals.push(plan); }
  if (billingStatus) { sets.push(`billing_status = $${i++}`); vals.push(billingStatus); }
  if (trialDays)     { sets.push(`trial_ends_at = NOW() + ($${i++} || ' days')::INTERVAL`); vals.push(String(trialDays)); }
  sets.push(`updated_at = NOW()`);
  vals.push(id);

  await query(`UPDATE companies SET ${sets.join(", ")} WHERE id = $${i}`, vals);

  // Moving to the custom plan auto-enables AI
  if (plan === "custom") {
    await query(
      `INSERT INTO company_settings (company_id, ai_enabled)
       VALUES ($1, TRUE)
       ON CONFLICT (company_id) DO UPDATE SET ai_enabled = TRUE, updated_at = NOW()`,
      [id]
    );
  }

  const updated = await query(
    "SELECT plan, billing_status, trial_ends_at FROM companies WHERE id = $1", [id]
  );
  res.json(updated.rows[0]);
}));

// PATCH /api/superadmin/companies/:id/ai-toggle — toggle AI for a company
router.patch("/companies/:id/ai-toggle", authenticate, requireSuperAdmin, asyncHandler(async (req, res) => {
  const { id } = req.params;
  const { aiEnabled } = req.body;

  if (typeof aiEnabled !== "boolean") {
    return res.status(400).json({ error: "aiEnabled must be a boolean" });
  }

  // Validate company exists
  const companyCheck = await query("SELECT id FROM companies WHERE id = $1", [id]);
  if (companyCheck.rows.length === 0) {
    return res.status(404).json({ error: "Company not found" });
  }

  // Upsert company_settings
  await query(
    `INSERT INTO company_settings (company_id, ai_enabled)
     VALUES ($1, $2)
     ON CONFLICT (company_id) DO UPDATE SET ai_enabled = $2, updated_at = NOW()`,
    [id, aiEnabled]
  );

  res.json({ companyId: parseInt(id), aiEnabled });
}));

// PATCH /api/superadmin/companies/:id/ai-provider — switch a company's AI backend
// (AWS Bedrock <-> Azure). null clears the override back to the platform default.
router.patch("/companies/:id/ai-provider", authenticate, requireSuperAdmin, asyncHandler(async (req, res) => {
  const { id } = req.params;
  let { aiProvider } = req.body;

  if (aiProvider === "" || aiProvider === "default") aiProvider = null;
  if (aiProvider !== null && !["bedrock", "azure"].includes(aiProvider)) {
    return res.status(400).json({ error: "aiProvider must be 'bedrock', 'azure', or null" });
  }

  const companyCheck = await query("SELECT id FROM companies WHERE id = $1", [id]);
  if (companyCheck.rows.length === 0) {
    return res.status(404).json({ error: "Company not found" });
  }

  await query(
    `INSERT INTO company_settings (company_id, ai_provider)
     VALUES ($1, $2)
     ON CONFLICT (company_id) DO UPDATE SET ai_provider = $2, updated_at = NOW()`,
    [id, aiProvider]
  );

  res.json({ companyId: parseInt(id), aiProvider });
}));

// --- Logo upload: utils/logoStorage.js ---

// POST /api/superadmin/companies/:id/logo — upload logo for a specific company
// The company must exist before anything is written to disk.
const requireExistingCompany = asyncHandler(async (req, res, next) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id) || id < 1 || id > 2147483647) return res.status(400).json({ error: "Invalid company id" });
  const found = await query("SELECT 1 FROM companies WHERE id = $1", [id]);
  if (found.rows.length === 0) return res.status(404).json({ error: "Company not found" });
  next();
});

router.post("/companies/:id/logo", authenticate, requireSuperAdmin, requireExistingCompany, logoUpload.single("logo"), scanDiskUpload(), asyncHandler(async (req, res) => {
  const id = Number(req.params.id);
  if (!req.file) return res.status(400).json({ error: "No file uploaded" });
  const logoUrl = await saveCompanyLogo(id, req.file.filename);
  res.json({ logoUrl });
}));

// PUT /api/superadmin/companies/:id/settings — update branding settings for a company
router.put("/companies/:id/settings", authenticate, requireSuperAdmin, asyncHandler(async (req, res) => {
  const id = parseInt(req.params.id);
  const { primaryColor } = req.body;
  await query(
    `INSERT INTO company_settings (company_id, primary_color)
     VALUES ($1, $2)
     ON CONFLICT (company_id) DO UPDATE SET primary_color = $2, updated_at = NOW()`,
    [id, primaryColor || null]
  );
  res.json({ success: true });
}));

// GET /api/superadmin/companies/:id/settings — get branding for a company
router.get("/companies/:id/settings", authenticate, requireSuperAdmin, asyncHandler(async (req, res) => {
  const id = parseInt(req.params.id);
  const result = await query(
    "SELECT logo_url, primary_color FROM company_settings WHERE company_id = $1",
    [id]
  );
  const row = result.rows[0];
  res.json({ logoUrl: row?.logo_url || null, primaryColor: row?.primary_color || null });
}));

// --- Multer Configuration ---
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    const uploadsDir = path.resolve('uploads');
    if (!fs.existsSync(uploadsDir)) {
      fs.mkdirSync(uploadsDir, { recursive: true });
    }
    cb(null, uploadsDir);
  },
  filename: (req, file, cb) => {
    const uniqueName = `${Date.now()}-${file.originalname}`;
    cb(null, uniqueName);
  },
});

const upload = multer({
  storage,
  limits: { fileSize: 10 * 1024 * 1024 }, // 10MB
  fileFilter: (req, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase();
    if (ext === '.xlsx') {
      cb(null, true);
    } else {
      cb(new Error('Only .xlsx files are allowed'));
    }
  },
});

// POST /api/superadmin/import-modules — Excel import with optional template save
router.post("/import-modules", authenticate, requireSuperAdmin, upload.single('file'), scanXlsxUpload(), asyncHandler(async (req, res) => {
  if (!req.file) {
    return res.status(400).json({ error: "No file uploaded" });
  }

  const filePath = req.file.path;
  const { companyId, saveAsTemplate, templateName, frameworkKey: bodyFrameworkKey, publishAsVersionOf } = req.body;

  let result;
  const client = await getClient();

  try {
    // Parse the Excel file
    const parsed = await parseExcelImport(filePath, { originalName: req.file.originalname });

    // Fall back to the framework detected from the filename / sheet so an import
    // that didn't pick one explicitly still gets activated + mapped to controls.
    const frameworkKey = bodyFrameworkKey || parsed.frameworkGuess || null;

    // Validate the framework key up front so a typo fails cleanly, not as a FK error.
    if (frameworkKey) {
      const fw = await client.query("SELECT key FROM frameworks WHERE key = $1", [frameworkKey]);
      if (fw.rows.length === 0) {
        return res.status(400).json({ error: `Unknown framework: ${frameworkKey}` });
      }
    }

    const wantsTemplateOnly = (saveAsTemplate === 'true' || saveAsTemplate === true) && !companyId;

    // If no data at all and there are errors, and we're not just saving a template, return 400
    if (!wantsTemplateOnly && parsed.modules.length === 0 && parsed.questions.length === 0 && parsed.errors.length > 0) {
      return res.status(400).json({ errors: parsed.errors });
    }

    await client.query('BEGIN');

    let templateId = null;
    let modulesInserted = 0;
    let questionsInserted = 0;
    let publishedVersion = null;
    let notifiedCompanyCount = 0;

    // Save as template if requested — either a brand-new lineage, or (when
    // publishAsVersionOf names an existing lineage's root id) a new version
    // chained onto it. Superadmin always makes this choice explicitly; nothing
    // here guesses on its own.
    if (saveAsTemplate === 'true' || saveAsTemplate === true) {
      const tplName = templateName || req.file.originalname;

      if (publishAsVersionOf) {
        const rootId = parseInt(publishAsVersionOf, 10);
        const currentResult = await client.query(
          "SELECT * FROM module_templates WHERE root_template_id = $1 AND is_current = true",
          [rootId]
        );
        if (currentResult.rows.length === 0) {
          await client.query("ROLLBACK");
          return res.status(404).json({ error: "Template lineage not found" });
        }
        const current = currentResult.rows[0];
        publishedVersion = current.version + 1;

        await client.query("UPDATE module_templates SET is_current = false WHERE id = $1", [current.id]);
        const tpl = await client.query(
          `INSERT INTO module_templates
             (name, description, file_name, module_data, question_data, framework_key,
              created_by, root_template_id, version, is_current, published_at, published_by)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, true, NOW(), $7)
           RETURNING id`,
          [tplName, '', req.file.originalname, JSON.stringify(parsed.modules), JSON.stringify(parsed.questions),
           frameworkKey || current.framework_key || null, req.user.userId || null, rootId, publishedVersion]
        );
        templateId = tpl.rows[0].id;

        // Notify every company currently on an older version of this lineage.
        const companiesResult = await client.query(
          "SELECT id, template_version FROM companies WHERE template_id = $1 AND template_version < $2",
          [rootId, publishedVersion]
        );
        const diffCache = new Map();
        for (const company of companiesResult.rows) {
          if (!diffCache.has(company.template_version)) {
            diffCache.set(company.template_version, await computeVersionDiff(client, rootId, company.template_version, publishedVersion));
          }
          const versionDiff = diffCache.get(company.template_version);
          if (!versionDiff) continue;
          await client.query(
            `INSERT INTO template_update_notices (company_id, template_id, from_version, to_version, status, diff_summary)
             VALUES ($1, $2, $3, $4, 'pending', $5)
             ON CONFLICT (company_id, template_id, to_version) DO NOTHING`,
            [company.id, rootId, company.template_version, publishedVersion, JSON.stringify(versionDiff.summary)]
          );
          notifiedCompanyCount++;
        }
      } else {
        const tpl = await client.query(
          `INSERT INTO module_templates (name, description, file_name, module_data, question_data, framework_key, created_by)
           VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING id`,
          [tplName, '', req.file.originalname, JSON.stringify(parsed.modules), JSON.stringify(parsed.questions), frameworkKey || null, req.user.userId || null]
        );
        templateId = tpl.rows[0].id;
      }
    }

    // If companyId provided, insert modules + questions
    if (companyId) {
      if (frameworkKey) {
        // Framework import: dedupe questions by (module, control area, question text)
        // fingerprint and map each to its framework control. Activates the framework.
        await client.query(
          `INSERT INTO company_frameworks (company_id, framework_key) VALUES ($1, $2) ON CONFLICT DO NOTHING`,
          [companyId, frameworkKey]
        );
        const counts = await importFrameworkQuestions(client, {
          companyId, frameworkKey, modules: parsed.modules, questions: parsed.questions,
        });
        modulesInserted = parsed.modules.length;
        questionsInserted = counts.questionsInserted;
      } else {
        for (const mod of parsed.modules) {
          const sortOrder = deriveSortOrder(mod.module_id);
          const insertResult = await client.query(
            `INSERT INTO modules (module_id, company_id, name, primary_owner, frequency, total_quests, purpose, sort_order, framework_key)
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
             ON CONFLICT (company_id, module_id) DO UPDATE SET framework_key = EXCLUDED.framework_key
             RETURNING id`,
            [mod.module_id, companyId, mod.name, mod.primary_owner, mod.frequency, mod.total_quests, mod.purpose, sortOrder, null]
          );
          if (insertResult.rows.length > 0) modulesInserted++;
        }

        for (const q of parsed.questions) {
          const insertResult = await client.query(
            `INSERT INTO questions (quest_id, company_id, module_id, module_name, control_area,
             iso_reference, baseline_question, level3_yes_criteria, required_evidence,
             default_owner, frequency, priority, tags)
             VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)
             ON CONFLICT (company_id, quest_id) DO NOTHING
             RETURNING quest_id`,
            [q.quest_id, companyId, q.module_id, q.module_name, q.control_area,
             q.iso_reference, q.baseline_question, q.level3_yes_criteria,
             q.required_evidence, q.default_owner, q.frequency, normPriority(q.priority), q.tags || null]
          );
          if (insertResult.rows.length > 0) questionsInserted++;
        }
      }
    }

    await client.query('COMMIT');

    result = {
      modulesImported: modulesInserted,
      questionsImported: questionsInserted,
      errors: parsed.errors,
      templateId,
      publishedVersion,
      notifiedCompanyCount,
    };
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
    // Clean up uploaded file
    try {
      if (fs.existsSync(filePath)) {
        fs.unlinkSync(filePath);
      }
    } catch (cleanupErr) {
      // Silently ignore cleanup errors
    }
  }

  res.json(result);
}));

// POST /api/superadmin/preview-import — parse Excel and return mapping preview without inserting
router.post("/preview-import", authenticate, requireSuperAdmin, upload.single('file'), scanXlsxUpload(), asyncHandler(async (req, res) => {
  if (!req.file) {
    return res.status(400).json({ error: "No file uploaded" });
  }
  const filePath = req.file.path;
  try {
    const parsed = await parseExcelImport(filePath, { originalName: req.file.originalname });
    const frameworkKey = req.body.frameworkKey || parsed.frameworkGuess || null;
    // Suggest whether this looks like a new version of an existing template —
    // never applied automatically; the superadmin always confirms the target.
    const templateMatches = frameworkKey
      ? await findTemplateMatches({ query }, { frameworkKey, newQuestions: parsed.questions })
      : [];
    res.json({
      modules: parsed.modules,
      questions: parsed.questions,
      errors: parsed.errors,
      totalModules: parsed.modules.length,
      totalQuestions: parsed.questions.length,
      frameworkGuess: parsed.frameworkGuess || null,
      templateMatches,
    });
  } finally {
    try { if (fs.existsSync(filePath)) fs.unlinkSync(filePath); } catch {}
  }
}));

// GET /api/superadmin/templates — list templates (latest version of each lineage
// by default; pass ?all=true to include superseded versions too)
router.get("/templates", authenticate, requireSuperAdmin, asyncHandler(async (req, res) => {
  const result = await query(
    `SELECT id, name, description, file_name, framework_key, module_data, question_data,
            root_template_id, version, is_current, published_at,
            jsonb_array_length(module_data) AS module_count,
            jsonb_array_length(question_data) AS question_count,
            created_at, updated_at
     FROM module_templates
     ${req.query.all === "true" ? "" : "WHERE is_current = true"}
     ORDER BY created_at DESC`
  );
  res.json(result.rows);
}));

// GET /api/superadmin/templates/:rootId/versions — full publish history of a lineage
router.get("/templates/:rootId/versions", authenticate, requireSuperAdmin, asyncHandler(async (req, res) => {
  const { rootId } = req.params;
  const result = await query(
    `SELECT id, name, version, is_current, published_at, published_by,
            jsonb_array_length(question_data) AS question_count, created_at
     FROM module_templates
     WHERE root_template_id = $1
     ORDER BY version DESC`,
    [rootId]
  );
  res.json(result.rows);
}));

// DELETE /api/superadmin/templates/:templateId — delete a template
router.delete("/templates/:templateId", authenticate, requireSuperAdmin, asyncHandler(async (req, res) => {
  const { templateId } = req.params;

  const result = await query(
    "DELETE FROM module_templates WHERE id = $1 RETURNING id",
    [templateId]
  );

  if (result.rows.length === 0) {
    return res.status(404).json({ error: "Template not found" });
  }

  res.json({ deleted: true, templateId: parseInt(templateId) });
}));

// POST /api/superadmin/templates/:templateId/assign — assign template to company
router.post("/templates/:templateId/assign", authenticate, requireSuperAdmin, asyncHandler(async (req, res) => {
  const { templateId } = req.params;
  const { companyId, frameworkKey: bodyFrameworkKey } = req.body;

  if (!companyId) {
    return res.status(400).json({ error: "companyId is required" });
  }

  // Verify template exists
  const tplResult = await query("SELECT * FROM module_templates WHERE id = $1", [templateId]);
  if (tplResult.rows.length === 0) {
    return res.status(404).json({ error: "Template not found" });
  }

  // Verify company exists
  const companyResult = await query("SELECT id FROM companies WHERE id = $1", [companyId]);
  if (companyResult.rows.length === 0) {
    return res.status(404).json({ error: "Company not found" });
  }

  const template = tplResult.rows[0];
  const modules = typeof template.module_data === 'string' ? JSON.parse(template.module_data) : template.module_data;
  const questions = typeof template.question_data === 'string' ? JSON.parse(template.question_data) : template.question_data;
  // frameworkKey: caller can override; else fall back to what's stored on the template
  const frameworkKey = bodyFrameworkKey || template.framework_key || null;

  // Templates saved by the old parser carry neither a framework nor control
  // references — provisioning them would create questions no framework owns
  // (invisible to the dashboard's framework scope). Refuse instead.
  const hasControls = Array.isArray(questions) && questions.some(q =>
    (Array.isArray(q.controls) && q.controls.length) || q.iso_reference || q.control_reference);
  if (!hasControls || (!frameworkKey && !questions.some(q => Array.isArray(q.controls) && q.controls.length))) {
    return res.status(400).json({
      error: "Template has no framework mapping — re-upload the sheet to refresh it",
    });
  }

  const client = await getClient();
  let moduleCount = 0;
  let questionCount = 0;

  try {
    await client.query('BEGIN');
    const counts = await provisionTemplate(client, {
      companyId, modules, questions, frameworkKey, templateVersion: template.version,
    });
    moduleCount = counts.moduleCount;
    questionCount = counts.questionCount;
    await client.query('COMMIT');
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }

  // Track which template lineage + version this company is on (root id, not the
  // specific version row's own id, so future publishes can find them).
  await query(
    "UPDATE companies SET template_id = $1, template_version = $2, updated_at = NOW() WHERE id = $3",
    [template.root_template_id || template.id, template.version, companyId]
  );

  res.json({ assigned: true, moduleCount, questionCount });
}));

// GET /api/superadmin/companies/:id/modules — list modules for a company
router.get("/companies/:id/modules", authenticate, requireSuperAdmin, asyncHandler(async (req, res) => {
  const { id } = req.params;

  // Verify company exists
  const companyResult = await query("SELECT id FROM companies WHERE id = $1", [id]);
  if (companyResult.rows.length === 0) {
    return res.status(404).json({ error: "Company not found" });
  }

  const result = await query(
    `SELECT id, module_id, name, primary_owner, frequency, total_quests, purpose, sort_order, created_at
     FROM modules
     WHERE company_id = $1
     ORDER BY sort_order ASC, module_id ASC`,
    [id]
  );
  res.json(result.rows);
}));

// DELETE /api/superadmin/companies/:id/modules — delete all modules and questions for a company
router.delete("/companies/:id/modules", authenticate, requireSuperAdmin, asyncHandler(async (req, res) => {
  const { id } = req.params;

  const companyResult = await query("SELECT id FROM companies WHERE id = $1", [id]);
  if (companyResult.rows.length === 0) {
    return res.status(404).json({ error: "Company not found" });
  }

  const client = await getClient();
  try {
    await client.query('BEGIN');
    await client.query("DELETE FROM questions WHERE company_id = $1", [id]);
    await client.query("DELETE FROM modules WHERE company_id = $1", [id]);
    await client.query('COMMIT');
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }

  res.json({ deleted: true, companyId: parseInt(id) });
}));

// PATCH /api/superadmin/companies/:companyId/modules/:moduleId/order — update sort_order
router.patch("/companies/:companyId/modules/:moduleId/order", authenticate, requireSuperAdmin, asyncHandler(async (req, res) => {
  const { companyId, moduleId } = req.params;
  const { sortOrder } = req.body;

  if (sortOrder === undefined || sortOrder === null || !Number.isInteger(sortOrder) || sortOrder < 0) {
    return res.status(400).json({ error: "sortOrder must be a non-negative integer" });
  }

  const result = await query(
    `UPDATE modules SET sort_order = $1, updated_at = NOW()
     WHERE module_id = $2 AND company_id = $3
     RETURNING *`,
    [sortOrder, moduleId, companyId]
  );

  if (result.rows.length === 0) {
    return res.status(404).json({ error: "Module not found" });
  }

  res.json(result.rows[0]);
}));

// POST /api/superadmin/companies/:id/modules — add single module
router.post("/companies/:id/modules", authenticate, requireSuperAdmin, asyncHandler(async (req, res) => {
  const { id } = req.params;
  const { moduleId, name, primaryOwner, frequency, totalQuests, purpose, sortOrder } = req.body;

  if (!moduleId || !name) {
    return res.status(400).json({ error: "moduleId and name are required" });
  }

  // Check duplicate
  const existing = await query(
    "SELECT id FROM modules WHERE module_id = $1 AND company_id = $2",
    [moduleId, id]
  );
  if (existing.rows.length > 0) {
    return res.status(409).json({ error: "Module ID already exists for this company" });
  }

  const finalSortOrder = sortOrder !== undefined && sortOrder !== null ? sortOrder : deriveSortOrder(moduleId);

  const result = await query(
    `INSERT INTO modules (module_id, company_id, name, primary_owner, frequency, total_quests, purpose, sort_order)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
     RETURNING *`,
    [moduleId, id, name, primaryOwner || null, frequency || null, totalQuests || null, purpose || null, finalSortOrder]
  );

  res.status(201).json(result.rows[0]);
}));

// DELETE /api/superadmin/companies/:id/modules/:moduleId — delete single module + its questions
router.delete("/companies/:id/modules/:moduleId", authenticate, requireSuperAdmin, asyncHandler(async (req, res) => {
  const { id, moduleId } = req.params;

  const client = await getClient();
  try {
    await client.query('BEGIN');

    // Delete questions first
    await client.query(
      "DELETE FROM questions WHERE module_id = $1 AND company_id = $2",
      [moduleId, id]
    );

    const result = await client.query(
      "DELETE FROM modules WHERE module_id = $1 AND company_id = $2 RETURNING id",
      [moduleId, id]
    );

    if (result.rowCount === 0) {
      await client.query('ROLLBACK');
      return res.status(404).json({ error: "Module not found" });
    }

    await client.query('COMMIT');
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }

  res.json({ deleted: true });
}));

const VALID_PRIORITIES = ["Critical", "High", "Medium", "Low"];
const normPriority = (p) => (VALID_PRIORITIES.includes(p) ? p : "Medium");

// GET /api/superadmin/companies/:id/questions — list questions for a company
router.get("/companies/:id/questions", authenticate, requireSuperAdmin, asyncHandler(async (req, res) => {
  const { id } = req.params;

  const companyCheck = await query("SELECT id FROM companies WHERE id = $1", [id]);
  if (companyCheck.rows.length === 0) {
    return res.status(404).json({ error: "Company not found" });
  }

  const result = await query(
    `SELECT q.*,
       COALESCE((
         SELECT COUNT(*)::INT FROM question_dependencies qd
         WHERE qd.company_id = $1 AND qd.quest_id = q.quest_id
       ), 0) AS dependency_count
     FROM questions q
     WHERE q.company_id = $1
     ORDER BY q.quest_id ASC`,
    [id]
  );

  res.json(result.rows);
}));

// POST /api/superadmin/companies/:id/questions — add single question
router.post("/companies/:id/questions", authenticate, requireSuperAdmin, asyncHandler(async (req, res) => {
  const { id } = req.params;
  const { questId, moduleId, moduleName, controlArea, isoReference, baselineQuestion, level3YesCriteria, requiredEvidence, defaultOwner, frequency, priority, tags, dueDate } = req.body;

  if (!questId || !moduleId) {
    return res.status(400).json({ error: "questId and moduleId are required" });
  }

  if (priority && !VALID_PRIORITIES.includes(priority)) {
    return res.status(400).json({ error: `priority must be one of: ${VALID_PRIORITIES.join(", ")}` });
  }

  // Verify module exists for company
  const moduleCheck = await query(
    "SELECT id FROM modules WHERE module_id = $1 AND company_id = $2",
    [moduleId, id]
  );
  if (moduleCheck.rows.length === 0) {
    return res.status(400).json({ error: "Module not found for this company" });
  }

  const result = await query(
    `INSERT INTO questions (quest_id, company_id, module_id, module_name, control_area, iso_reference, baseline_question, level3_yes_criteria, required_evidence, default_owner, frequency, priority, tags, due_date)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14)
     RETURNING *`,
    [questId, id, moduleId, moduleName || null, controlArea || null, isoReference || null, baselineQuestion || null, level3YesCriteria || null, requiredEvidence || null, defaultOwner || null, frequency || null, normPriority(priority), tags || null, dueDate || null]
  );

  res.status(201).json(result.rows[0]);
}));

// DELETE /api/superadmin/companies/:id/questions/:questId — delete single question
router.delete("/companies/:id/questions/:questId", authenticate, requireSuperAdmin, asyncHandler(async (req, res) => {
  const { id, questId } = req.params;

  const result = await query(
    "DELETE FROM questions WHERE quest_id = $1 AND company_id = $2 RETURNING id",
    [questId, id]
  );

  if (result.rowCount === 0) {
    return res.status(404).json({ error: "Question not found" });
  }

  res.json({ deleted: true });
}));

// GET /api/superadmin/companies/:id/questions/:questId/dependencies
router.get("/companies/:id/questions/:questId/dependencies", authenticate, requireSuperAdmin, asyncHandler(async (req, res) => {
  const { id, questId } = req.params;

  const result = await query(
    `WITH q_info AS (
       SELECT DISTINCT ON (quest_id) quest_id, control_area, module_id
       FROM questions
       WHERE company_id = $1 OR company_id IS NULL
       ORDER BY quest_id ASC, company_id ASC NULLS LAST
     )
     SELECT
       qd.depends_on_quest_id AS dep_quest_id,
       qi.control_area,
       qi.module_id
     FROM question_dependencies qd
     LEFT JOIN q_info qi ON qi.quest_id = qd.depends_on_quest_id
     WHERE qd.company_id = $1 AND qd.quest_id = $2
     ORDER BY qd.depends_on_quest_id ASC`,
    [id, questId]
  );

  res.json(result.rows.map(row => ({
    questId: row.dep_quest_id,
    controlArea: row.control_area,
    moduleId: row.module_id,
  })));
}));

// PUT /api/superadmin/companies/:id/questions/:questId/dependencies
router.put("/companies/:id/questions/:questId/dependencies", authenticate, requireSuperAdmin, asyncHandler(async (req, res) => {
  const { id, questId } = req.params;
  const { dependsOn = [] } = req.body;

  if (!Array.isArray(dependsOn)) {
    return res.status(400).json({ error: "dependsOn must be an array of quest IDs" });
  }

  const uniqueDeps = [...new Set(dependsOn)];

  if (uniqueDeps.includes(questId)) {
    return res.status(400).json({ error: "A question cannot depend on itself" });
  }

  const questCheck = await query(
    "SELECT 1 FROM questions WHERE quest_id = $1 AND company_id = $2 LIMIT 1",
    [questId, id]
  );
  if (questCheck.rows.length === 0) {
    return res.status(404).json({ error: "Question not found" });
  }

  for (const depId of uniqueDeps) {
    const depCheck = await query(
      "SELECT 1 FROM questions WHERE quest_id = $1 AND (company_id = $2 OR company_id IS NULL) LIMIT 1",
      [depId, id]
    );
    if (depCheck.rows.length === 0) {
      return res.status(400).json({ error: `Dependency question not found: ${depId}` });
    }
  }

  if (uniqueDeps.length > 0) {
    const cycleResult = await query(
      `WITH RECURSIVE reachable AS (
         SELECT unnest($2::text[]) AS q
         UNION
         SELECT qd.depends_on_quest_id
         FROM question_dependencies qd
         INNER JOIN reachable r ON r.q = qd.quest_id
         WHERE qd.company_id = $1 AND qd.quest_id != $3
       )
       SELECT 1 FROM reachable WHERE q = $3 LIMIT 1`,
      [id, uniqueDeps, questId]
    );
    if (cycleResult.rows.length > 0) {
      return res.status(400).json({ error: "Circular dependency detected: the requested dependencies would create a cycle" });
    }
  }

  const client = await getClient();
  try {
    await client.query("BEGIN");
    await client.query(
      "DELETE FROM question_dependencies WHERE company_id = $1 AND quest_id = $2",
      [id, questId]
    );
    for (const depId of uniqueDeps) {
      await client.query(
        "INSERT INTO question_dependencies (company_id, quest_id, depends_on_quest_id) VALUES ($1, $2, $3)",
        [id, questId, depId]
      );
    }
    await client.query("COMMIT");
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  } finally {
    client.release();
  }

  res.json({ questId, dependsOn: uniqueDeps });
}));

router.get("/companies/:id/users", authenticate, requireSuperAdmin, asyncHandler(async (req, res) => {
  const { id } = req.params;
  const result = await query(
    `SELECT id, full_name, email, role, created_at
     FROM users
     WHERE company_id = $1
     ORDER BY
       CASE role
         WHEN 'ADMIN'       THEN 1
         WHEN 'LEAD'        THEN 2
         WHEN 'CONTRIBUTOR' THEN 3
         WHEN 'REVIEWER'    THEN 4
         WHEN 'AUDITOR'     THEN 5
         ELSE 6
       END,
       COALESCE(full_name, email) ASC`,
    [id]
  );
  res.json(result.rows.map(r => ({
    id: r.id,
    fullName: r.full_name,
    email: r.email,
    role: r.role,
    createdAt: r.created_at,
  })));
}));

// GET /api/superadmin/companies/:id/self-assessment
// Build (or regenerate, with ?refresh=1) the gap-analysis / Team Report for any
// company — but only once EVERY selected department has submitted. While any
// delegated department is still outstanding, returns 409 with the missing list.
router.get("/companies/:id/self-assessment", authenticate, requireSuperAdmin, asyncHandler(async (req, res) => {
  const data = await buildCompanyReport(req.params.id, {
    requestedByEmail: req.user.email,
    refresh: req.query.refresh === "1",
  });
  if (!data) return res.status(404).json({ error: "Company not found" });

  if (data.submissions.length === 0) {
    return res.status(409).json({
      error: "This company has not submitted any self-assessment responses yet.",
      status: "no-submissions",
      departmentStatus: data.deptStatus,
    });
  }
  if (!data.deptStatus.complete) {
    return res.status(409).json({
      error: `Waiting on ${data.deptStatus.missing.length} department(s) before the report can be generated: ${data.deptStatus.missing.join(", ")}.`,
      status: "incomplete",
      departmentStatus: data.deptStatus,
    });
  }

  // ?format=docx — stream the report as a Word document instead of JSON.
  // Reuses every gate above; never emails.
  if (req.query.format === "docx") {
    if (!data.report) {
      return res.status(409).json({ error: "The report is not ready to download yet.", status: "not-ready" });
    }
    const docx = await buildReadinessDocx(data.report, { companyName: data.company.name });
    const safeName = (data.company.name || "Company").replace(/[^\w.-]+/g, "_").replace(/^_+|_+$/g, "") || "Company";
    res.setHeader("Content-Type", DOCX_MIME);
    res.setHeader("Content-Disposition", `attachment; filename="${safeName}_DPDPA_Readiness_Assessment.docx"`);
    return res.send(docx);
  }

  const emailed = req.query.email === "1" && data.report;
  res.json({
    company: { id: data.company.id, name: data.company.name },
    submissions: data.submissions,
    report: data.report,
    departmentStatus: data.deptStatus,
    emailedTo: emailed ? GAP_REPORT_RECIPIENT : null,
  });

  // Fire-and-forget: a concise NOTIFICATION (not the rendered report — the
  // full document is view/download-only). Only when ?email=1, so one
  // "Generate"/"Regenerate" click == one email.
  if (emailed) {
    const fc = data.report.findingCounts || { total: 0, critical: 0, high: 0 };
    const webUrl = (process.env.WEB_URL || "https://prismgrc.co").replace(/\/$/, "");
    sendEmail({
      to: GAP_REPORT_RECIPIENT,
      subject: `[PRISM] Gap Assessment Report — ${data.company.name || "Company"}`,
      text: data.report.text,
      html: buildEmailHtml({
        heading: "DPDP Act 2023 Readiness Assessment ready",
        preheader: `${data.company.name || "A company"} — ${fc.total} findings, ${fc.critical} Critical`,
        body: `The DPDP Act 2023 Readiness Assessment for <strong>${data.company.name || "the company"}</strong> is ready.`,
        details: [
          { label: "Findings", value: `${fc.total} (${fc.critical} Critical, ${fc.high} High)` },
          { label: "Weighted maturity", value: `${data.report.maturity?.weightedNow ?? "—"} / 5 (target ${data.report.maturity?.weightedTarget ?? "—"})` },
          { label: "Assessment coverage", value: `${data.report.traceability?.coveragePct ?? "—"}% of assessable DPDP Act obligations` },
        ],
        cta: { text: "Open it in PRISM", url: `${webUrl}/superadmin?company=${data.company.id}` },
      }),
    }).catch(err => console.error("[superadmin/gap-report] sendEmail error:", err.message));
  }
}));

// GET /api/superadmin/companies/:id/self-assessment/submissions
// The raw responses each user in the company filled in, with question text resolved.
router.get("/companies/:id/self-assessment/submissions", authenticate, requireSuperAdmin, asyncHandler(async (req, res) => {
  const { id } = req.params;

  const companyResult = await query(
    `SELECT id, name, self_assessment_completed_at, self_assessment_all_departments_at,
            self_assessment_departments
     FROM companies WHERE id = $1`,
    [id]
  );
  const company = mapRow(companyResult);
  if (!company) return res.status(404).json({ error: "Company not found" });

  const result = await query(
    `SELECT s.department, s.answers, s.submitted_at, s.user_email,
            COALESCE(u.full_name, s.user_email) AS user_name, u.role AS user_role
     FROM self_assessment_submissions s
     LEFT JOIN users u ON u.id = s.user_id
     WHERE s.company_id = $1
     ORDER BY s.department, COALESCE(u.full_name, s.user_email)`,
    [id]
  );

  const deptStatus = departmentStatus(
    company.selfAssessmentDepartments,
    result.rows.map(r => r.department)
  );

  // For each department still missing a submission, surface who (if anyone) it
  // was delegated to via the self-assessment collaborator invites.
  let pendingDepartments = [];
  if (deptStatus.missing.length > 0) {
    const inv = await query(
      `SELECT department, email, accepted_at, created_at
       FROM invitations
       WHERE company_id = $1 AND department IS NOT NULL
       ORDER BY created_at`,
      [id]
    );
    const byDept = {};
    for (const row of inv.rows) {
      const key = String(row.department).trim().toLowerCase();
      (byDept[key] ||= []).push({
        email: row.email,
        invitedAt: row.created_at,
        acceptedAt: row.accepted_at,
      });
    }
    pendingDepartments = deptStatus.missing.map(dept => ({
      department: dept,
      assignees: byDept[dept.trim().toLowerCase()] || [],
    }));
  }

  const ANSWER_LABELS = { YES: "Yes", PARTIAL: "Partial", NO: "No", NA: "N/A" };
  const submissions = result.rows.map(r => {
    const answers = r.answers || {};
    const asked = expandQuestions(deptQuestionBase(r.department), answers);
    // IT answers derived from capability cards aren't in the trimmed IT list —
    // include the answered ones (same rule as resolveDeptQuestionText).
    if (r.department === "IT") {
      const have = new Set(asked.map(q => q.id));
      for (const q of IT_DERIVED_QUESTIONS) if (!have.has(q.id) && answers[q.id]) asked.push(q);
    }
    const items = asked.map(q => ({
      id: q.id,
      section: q.section || null,
      text: q.text,
      answer: answers[q.id] || null,
      answerLabel: answers[q.id] ? (ANSWER_LABELS[answers[q.id]] || answers[q.id]) : "Not answered",
    }));
    const answered = items.filter(i => i.answer).length;
    return {
      department: r.department,
      userName: r.user_name,
      userEmail: r.user_email,
      role: r.user_role || null,
      submittedAt: r.submitted_at,
      answeredCount: answered,
      totalCount: items.length,
      items,
    };
  });

  res.json({
    company: { id: company.id, name: company.name },
    completedAt: company.selfAssessmentCompletedAt,
    allDepartmentsAt: company.selfAssessmentAllDepartmentsAt,
    departmentStatus: deptStatus,
    pendingDepartments,
    respondentCount: new Set(result.rows.map(r => r.user_email)).size,
    submissions,
  });
}));

export default router;
