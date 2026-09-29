import { Router } from "express";
import multer from "multer";
import fs from "fs";
import path from "path";
import { query, mapRow, mapRows, getClient } from "../db/index.js";
import { scanXlsxUpload } from "../utils/scanUpload.js";
import { retireQuestion } from "../utils/retireQuestion.js";
import { authenticate } from "../middleware/auth.js";
import { requireRole, requireSuperAdmin } from "../middleware/roles.js";
import { longRequestTimeout } from "../middleware/timeout.js";
import { asyncHandler } from "../utils/asyncHandler.js";
import { deriveSortOrder } from "../utils/prismOrder.js";
import { parseExcelImport, splitRefs } from "../utils/excelParser.js";
import { clusterQuestions } from "../utils/aiProvider.js";
import { classifyTemplateDiff, summarizeTemplateDiff } from "../utils/templateDiff.js";

const router = Router();

const importUpload = multer({
  storage: multer.diskStorage({
    destination: (req, file, cb) => {
      const dir = path.resolve("uploads");
      if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
      cb(null, dir);
    },
    filename: (req, file, cb) => cb(null, `${Date.now()}-${file.originalname}`),
  }),
  limits: { fileSize: 10 * 1024 * 1024 },
  fileFilter: (req, file, cb) =>
    path.extname(file.originalname).toLowerCase() === ".xlsx"
      ? cb(null, true)
      : cb(new Error("Only .xlsx files are allowed")),
});

// ─── Helpers ──────────────────────────────────────────────────────────────────

/**
 * Given a list of questions that belong to a framework, insert them into the
 * company's question set — deduplicating by (module_id, control_area,
 * baseline_question) fingerprint — and then insert question_framework_controls
 * rows mapping each question to the framework control.
 *
 * Returns { questionsInserted, mappingsInserted }.
 */
export async function importFrameworkQuestions(client, { companyId, frameworkKey, modules, questions }) {
  let questionsInserted = 0;
  let mappingsInserted = 0;

  // Insert modules first (idempotent)
  for (const mod of modules) {
    const sortOrder = deriveSortOrder(mod.module_id);
    await client.query(
      `INSERT INTO modules (module_id, company_id, name, primary_owner, frequency, total_quests, purpose, sort_order, framework_key)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
       ON CONFLICT (company_id, module_id) DO UPDATE SET framework_key = EXCLUDED.framework_key`,
      [mod.module_id, companyId, mod.name, mod.primary_owner || null, mod.frequency || null,
       mod.total_quests || 0, mod.purpose || null, sortOrder, frameworkKey]
    );
  }

  for (const q of questions) {
    // Deduplication fingerprint: same module + control area + question text
    const fingerprint = {
      moduleId: q.module_id,
      controlArea: (q.control_area || "").trim().toLowerCase(),
      baselineQuestion: (q.baseline_question || "").trim().toLowerCase(),
    };

    // Check if an equivalent question already exists for this company
    const existing = await client.query(
      `SELECT quest_id FROM questions
       WHERE company_id = $1
         AND module_id = $2
         AND LOWER(TRIM(COALESCE(control_area, ''))) = $3
         AND LOWER(TRIM(COALESCE(baseline_question, ''))) = $4
       LIMIT 1`,
      [companyId, fingerprint.moduleId, fingerprint.controlArea, fingerprint.baselineQuestion]
    );

    let questId = existing.rows[0]?.quest_id ?? null;

    if (!questId) {
      // New question — insert it
      const ins = await client.query(
        `INSERT INTO questions (quest_id, company_id, module_id, module_name, control_area,
           iso_reference, baseline_question, level3_yes_criteria, required_evidence,
           default_owner, frequency, priority, tags)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)
         ON CONFLICT (company_id, quest_id) DO NOTHING
         RETURNING quest_id`,
        [q.quest_id, companyId, q.module_id, q.module_name || null, q.control_area || null,
         q.iso_reference || null, q.baseline_question || null, q.level3_yes_criteria || null,
         q.required_evidence || null, q.default_owner || null, q.frequency || null,
         (["Critical", "High", "Medium", "Low"].includes(q.priority) ? q.priority : "Medium"),
         q.tags || null]
      );
      if (ins.rows.length > 0) {
        questId = ins.rows[0].quest_id;
        questionsInserted++;
      } else {
        // Conflict on quest_id — use the existing one
        questId = q.quest_id;
      }
    }

    if (!questId) continue;

    // Insert framework control mapping (idempotent)
    const controlRef = q.iso_reference || q.control_reference || null;
    if (controlRef) {
      const mapIns = await client.query(
        `INSERT INTO question_framework_controls (company_id, quest_id, framework_key, control_reference)
         VALUES ($1, $2, $3, $4)
         ON CONFLICT (company_id, quest_id, framework_key, control_reference) DO NOTHING
         RETURNING id`,
        [companyId, questId, frameworkKey, controlRef]
      );
      if (mapIns.rows.length > 0) mappingsInserted++;
    }
  }

  return { questionsInserted, mappingsInserted };
}

const PRIORITIES = ["Critical", "High", "Medium", "Low"];
const normPriority = (p) => (PRIORITIES.includes(p) ? p : "Medium");

/**
 * Instantiate a module template into a company: upsert its modules and questions,
 * then activate every framework the questions map to and copy the crosswalk rows
 * per-company.
 *
 * Handles both shapes of `question_data[]`:
 *   - legacy   : { quest_id, iso_reference, ... }        + a template-level frameworkKey
 *   - canonical: { quest_id, canonical:true, controls:[{ framework_key,
 *                  control_reference, original_quest_id, original_question,
 *                  original_control_area, original_level3, original_facets }] }
 *
 * Must run inside a transaction (caller owns BEGIN/COMMIT).
 * @returns {Promise<{ moduleCount:number, questionCount:number, frameworks:string[] }>}
 */
export async function provisionTemplate(client, { companyId, modules = [], questions = [], frameworkKey = null, templateVersion = null }) {
  let moduleCount = 0;
  let questionCount = 0;

  for (const mod of modules) {
    const r = await client.query(
      `INSERT INTO modules (module_id, company_id, name, primary_owner, frequency, total_quests, purpose, sort_order, framework_key)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)
       ON CONFLICT (company_id, module_id)
         DO UPDATE SET framework_key = COALESCE(EXCLUDED.framework_key, modules.framework_key)
       RETURNING id`,
      [mod.module_id, companyId, mod.name || mod.module_id, mod.primary_owner || null, mod.frequency || null,
       mod.total_quests || 0, mod.purpose || null, deriveSortOrder(mod.module_id),
       mod.framework_key || frameworkKey || null]
    );
    if (r.rows.length > 0) moduleCount++;
  }

  const activated = new Set();
  for (const q of questions) {
    const controls = Array.isArray(q.controls) && q.controls.length
      ? q.controls
      : (frameworkKey && (q.iso_reference || q.control_reference)
          ? [{ framework_key: frameworkKey, control_reference: q.iso_reference || q.control_reference }]
          : []);

    const r = await client.query(
      `INSERT INTO questions (quest_id, company_id, module_id, module_name, control_area,
         iso_reference, baseline_question, level3_yes_criteria, required_evidence,
         default_owner, frequency, priority, tags, provisioned_from_version)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14)
       ON CONFLICT (company_id, quest_id) DO NOTHING
       RETURNING quest_id`,
      [q.quest_id, companyId, q.module_id, q.module_name || q.module_id, q.control_area || null,
       q.iso_reference || controls[0]?.control_reference || null, q.baseline_question || null,
       q.level3_yes_criteria || null, q.required_evidence || null, q.default_owner || null,
       q.frequency || null, normPriority(q.priority), q.tags || null, templateVersion]
    );
    if (r.rows.length > 0) questionCount++;

    for (const c of controls) {
      if (!c.framework_key || !c.control_reference) continue;
      if (!activated.has(c.framework_key)) {
        await client.query(
          `INSERT INTO company_frameworks (company_id, framework_key) VALUES ($1,$2) ON CONFLICT DO NOTHING`,
          [companyId, c.framework_key]
        );
        activated.add(c.framework_key);
      }
      await client.query(
        `INSERT INTO question_framework_controls
           (company_id, quest_id, framework_key, control_reference,
            original_quest_id, original_question, original_control_area, original_level3, original_facets)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)
         ON CONFLICT ON CONSTRAINT qfc_uniq_nnd DO NOTHING`,
        [companyId, q.quest_id, c.framework_key, c.control_reference,
         c.original_quest_id || null, c.original_question || null, c.original_control_area || null,
         c.original_level3 || null, c.original_facets ? JSON.stringify(c.original_facets) : null]
      );
    }
  }

  return { moduleCount, questionCount, frameworks: [...activated] };
}

// ─── Template versioning ───────────────────────────────────────────────────────

export function parseQuestionData(tpl) {
  return typeof tpl.question_data === "string" ? JSON.parse(tpl.question_data) : (tpl.question_data || []);
}

/** Fetch a specific version's question set for a template lineage (immutable once published). */
export async function getTemplateVersionQuestions(client, rootTemplateId, version) {
  const { rows } = await client.query(
    "SELECT * FROM module_templates WHERE root_template_id = $1 AND version = $2",
    [rootTemplateId, version]
  );
  if (rows.length === 0) return null;
  return parseQuestionData(rows[0]);
}

/**
 * Diff between two versions of a template lineage. Deterministic and safe to
 * recompute at any time since each version's question_data is immutable once
 * published — never trust a cached diff when correctness matters (apply).
 */
export async function computeVersionDiff(client, rootTemplateId, fromVersion, toVersion) {
  const [fromQuestions, toQuestions] = await Promise.all([
    getTemplateVersionQuestions(client, rootTemplateId, fromVersion),
    getTemplateVersionQuestions(client, rootTemplateId, toVersion),
  ]);
  if (!fromQuestions || !toQuestions) return null;
  const diff = classifyTemplateDiff(fromQuestions, toQuestions);
  return { diff, toQuestions, summary: summarizeTemplateDiff(diff) };
}

/**
 * Applies a computed version diff to one company's live question/assessment rows.
 * Must run inside a transaction (caller owns BEGIN/COMMIT). `toQuestions` is the
 * full new-version question set (needed for full field data on added/renamed rows,
 * not just the id+text the diff itself carries).
 */
export async function applyTemplateDiff(client, { companyId, diff, toQuestions, toVersion, frameworkKey }) {
  const byId = new Map(toQuestions.map((q) => [q.quest_id, q]));

  for (const { questId, newText, newIso } of diff.reworded) {
    await client.query(
      `UPDATE questions SET baseline_question = $1, iso_reference = $2, updated_at = NOW()
       WHERE company_id = $3 AND quest_id = $4 AND archived_at IS NULL`,
      [newText, newIso, companyId, questId]
    );
    if (frameworkKey) {
      await client.query(
        `UPDATE question_framework_controls SET control_reference = $1
         WHERE company_id = $2 AND quest_id = $3 AND framework_key = $4`,
        [newIso, companyId, questId, frameworkKey]
      );
    }
  }

  for (const { oldQuestId, newQuestId } of diff.renamed) {
    const nq = byId.get(newQuestId);
    // The new id may already belong to a question this company had archived (removed in
    // an earlier version) or is retiring. Move that question and its history aside so the
    // rename doesn't collide with it or absorb its evidence. A live clash is a conflict.
    const clash = await client.query(
      "SELECT id, archived_at, archive_after FROM questions WHERE company_id = $1 AND quest_id = $2",
      [companyId, newQuestId]
    );
    for (const old of clash.rows) {
      // A question only kept for its audited period (F-25) is on its way out: it moves
      // aside with its history (and lock) like an archived one, instead of blocking.
      if (!old.archived_at && !old.archive_after) {
        throw Object.assign(new Error(`Cannot rename ${oldQuestId} to ${newQuestId}: that control already exists`), { status: 409 });
      }
      const aside = `${newQuestId}~archived-${old.id}`;
      await client.query("UPDATE questions SET quest_id = $1 WHERE id = $2", [aside, old.id]);
      for (const table of ["assessments", "evidence", "question_evidence", "question_framework_controls"]) {
        await client.query(`UPDATE ${table} SET quest_id = $1 WHERE company_id = $2 AND quest_id = $3`, [aside, companyId, newQuestId]);
      }
    }
    await client.query(
      `UPDATE questions
       SET quest_id = $1, source_quest_id = $2, baseline_question = $3, iso_reference = COALESCE($4, iso_reference),
           module_id = COALESCE($5, module_id), control_area = COALESCE($6, control_area),
           provisioned_from_version = $7, updated_at = NOW()
       WHERE company_id = $8 AND quest_id = $2 AND archived_at IS NULL`,
      [newQuestId, oldQuestId, nq?.baseline_question ?? null, nq?.iso_reference ?? null, nq?.module_id ?? null,
       nq?.control_area ?? null, toVersion, companyId]
    );
    await client.query(
      "UPDATE assessments SET quest_id = $1, updated_at = NOW() WHERE company_id = $2 AND quest_id = $3",
      [newQuestId, companyId, oldQuestId]
    );
    // Evidence and vault links follow the question, otherwise the renamed control loses
    // its evidence — and any audit lock on it (F-11 / F-25).
    await client.query(
      "UPDATE evidence SET quest_id = $1, updated_at = NOW() WHERE company_id = $2 AND quest_id = $3",
      [newQuestId, companyId, oldQuestId]
    );
    await client.query(
      `UPDATE question_evidence qe SET quest_id = $1
       WHERE qe.company_id = $2 AND qe.quest_id = $3
         AND NOT EXISTS (SELECT 1 FROM question_evidence d WHERE d.company_id = $2 AND d.quest_id = $1 AND d.vault_id = qe.vault_id)`,
      [newQuestId, companyId, oldQuestId]
    );
    await client.query("DELETE FROM question_evidence WHERE company_id = $1 AND quest_id = $2", [companyId, oldQuestId]);
    await client.query(
      `UPDATE question_framework_controls SET quest_id = $1, control_reference = COALESCE($2, control_reference)
       WHERE company_id = $3 AND quest_id = $4`,
      [newQuestId, nq?.iso_reference ?? null, companyId, oldQuestId]
    );
  }

  const addedQuestions = diff.added.map(({ questId }) => byId.get(questId)).filter(Boolean);
  if (addedQuestions.length > 0) {
    await provisionTemplate(client, {
      companyId, modules: [], questions: addedQuestions, frameworkKey, templateVersion: toVersion,
    });
  }

  // A question the new version re-adds is live again: provisionTemplate skips a row that
  // already exists, so clear a pending retirement (see below) or an earlier archival and
  // take the new version's content. Its old archived assessments stay archived history.
  for (const q of addedQuestions) {
    await client.query(
      `UPDATE questions
       SET archived_at = NULL, archive_after = NULL,
           baseline_question = COALESCE($3, baseline_question), iso_reference = COALESCE($4, iso_reference),
           module_id = COALESCE($5, module_id), control_area = COALESCE($6, control_area),
           provisioned_from_version = $7, updated_at = NOW()
       WHERE company_id = $1 AND quest_id = $2 AND (archived_at IS NOT NULL OR archive_after IS NOT NULL)`,
      [companyId, q.quest_id, q.baseline_question ?? null, q.iso_reference ?? null, q.module_id ?? null,
       q.control_area ?? null, toVersion]
    );
  }

  for (const { questId } of diff.removed) {
    await retireQuestion(client, companyId, questId);
  }
}

const FACET_ORDER = { IMPLEMENTED: 0, EVIDENCE: 1, REVIEWED: 2, MATURITY: 3, OTHER: 4 };

/**
 * Collapse parsed questions into one staging unit per control (grouped by
 * `collapse_group_key`), merging the ~3 facet rows. The facet wording is kept in
 * `original_facets` so the review UI can show it.
 */
function collapseForStaging(questions, frameworkKey) {
  const groups = new Map();
  for (const q of questions) {
    const key = q.collapse_group_key || `${q.module_id}|${q.control_area}|${q.quest_id}`;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(q);
  }

  const units = [];
  for (const members of groups.values()) {
    members.sort((a, b) => (FACET_ORDER[a.facet] ?? 9) - (FACET_ORDER[b.facet] ?? 9));
    const rep = members[0];
    const facets = {};
    for (const m of members) if (m.facet && !facets[m.facet]) facets[m.facet] = m.baseline_question;
    const level3 = members.map(m => m.level3_yes_criteria || "").sort((a, b) => b.length - a.length)[0] || "";

    units.push({
      framework_key: frameworkKey,
      source_quest_id: rep.quest_id,
      module_id: rep.module_id,
      module_name: rep.module_name || rep.module_id,
      control_area: rep.control_area || "",
      control_reference: (rep.control_references && rep.control_references[0]) || rep.iso_reference || "",
      control_reference_raw: rep.iso_reference || "",
      facet: rep.facet || "OTHER",
      baseline_question: rep.baseline_question || "",
      level3_yes_criteria: level3,
      required_evidence: rep.required_evidence || "",
      default_owner: rep.default_owner || "",
      frequency: rep.frequency || "",
      priority: rep.priority || "",
      tags: rep.tags || "",
      collapse_group_key: rep.collapse_group_key || null,
      raw: { members, original_facets: facets, control_references: rep.control_references || splitRefs(rep.iso_reference) },
    });
  }
  return units;
}

// ─── Routes ────────────────────────────────────────────────────────────────────

// GET /api/frameworks
// List the catalog of all supported frameworks.
router.get("/", asyncHandler(async (req, res) => {
  const result = await query("SELECT key, name, description FROM frameworks ORDER BY name ASC");
  res.json(result.rows);
}));

// GET /api/frameworks/mine
// Frameworks currently active for the authenticated company, with question counts.
router.get("/mine", authenticate, asyncHandler(async (req, res) => {
  const cid = req.user.companyId;
  const result = await query(
    `SELECT f.key, f.name, f.description, cf.activated_at,
       (SELECT COUNT(DISTINCT qfc.quest_id)
        FROM question_framework_controls qfc
        WHERE qfc.company_id = $1 AND qfc.framework_key = f.key) AS question_count,
       (SELECT COUNT(DISTINCT a.quest_id)
        FROM question_framework_controls qfc
        JOIN assessments a ON a.quest_id = qfc.quest_id AND a.company_id = $1 AND a.review_status IN ('FINISHED', 'AUDITED')
        WHERE qfc.company_id = $1 AND qfc.framework_key = f.key) AS answered_count
     FROM company_frameworks cf
     JOIN frameworks f ON f.key = cf.framework_key
     WHERE cf.company_id = $1
     ORDER BY cf.activated_at ASC`,
    [cid]
  );
  res.json(result.rows.map(r => ({
    key: r.key,
    name: r.name,
    description: r.description,
    activatedAt: r.activated_at,
    questionCount: parseInt(r.question_count) || 0,
    answeredCount: parseInt(r.answered_count) || 0,
  })));
}));

// POST /api/frameworks/mine
// Activate a framework for the company.
// Body: { frameworkKey, modules?, questions? }
//   - If modules/questions are supplied they are imported with deduplication.
//   - If omitted the framework is activated without importing questions (useful
//     for frameworks whose questions are already present via a template).
router.post("/mine", authenticate, requireRole(["ADMIN", "LEAD"]), asyncHandler(async (req, res) => {
  const cid = req.user.companyId;
  const { frameworkKey, modules = [], questions = [] } = req.body;

  if (!frameworkKey) return res.status(400).json({ error: "frameworkKey is required" });

  // Verify framework exists in catalog
  const fwCheck = await query("SELECT key FROM frameworks WHERE key = $1", [frameworkKey]);
  if (fwCheck.rows.length === 0) {
    return res.status(400).json({ error: `Unknown framework: ${frameworkKey}` });
  }

  // Activate in company_frameworks (idempotent)
  await query(
    `INSERT INTO company_frameworks (company_id, framework_key)
     VALUES ($1, $2)
     ON CONFLICT DO NOTHING`,
    [cid, frameworkKey]
  );

  let questionsInserted = 0;
  let mappingsInserted = 0;

  if (questions.length > 0) {
    const client = await getClient();
    try {
      await client.query("BEGIN");
      const counts = await importFrameworkQuestions(client, { companyId: cid, frameworkKey, modules, questions });
      questionsInserted = counts.questionsInserted;
      mappingsInserted = counts.mappingsInserted;
      await client.query("COMMIT");
    } catch (err) {
      await client.query("ROLLBACK");
      throw err;
    } finally {
      client.release();
    }
  }

  res.status(201).json({ frameworkKey, questionsInserted, mappingsInserted });
}));

// DELETE /api/frameworks/mine/:key
// Deactivate a framework for the company.
// Questions and their answers are NOT deleted — they remain in the question set.
// Only the company_frameworks row and question_framework_controls mappings are removed.
router.delete("/mine/:key", authenticate, requireRole(["ADMIN"]), asyncHandler(async (req, res) => {
  const cid = req.user.companyId;
  const { key } = req.params;

  const client = await getClient();
  try {
    await client.query("BEGIN");
    await client.query(
      "DELETE FROM question_framework_controls WHERE company_id = $1 AND framework_key = $2",
      [cid, key]
    );
    await client.query(
      "DELETE FROM company_frameworks WHERE company_id = $1 AND framework_key = $2",
      [cid, key]
    );
    await client.query("COMMIT");
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  } finally {
    client.release();
  }

  res.status(204).send();
}));

// GET /api/frameworks/:key/questions
// Questions mapped to a specific framework for the authenticated company,
// with their latest assessment answer and evidence coverage status.
router.get("/:key/questions", authenticate, asyncHandler(async (req, res) => {
  const cid = req.user.companyId;
  const { key } = req.params;

  // Check the company has this framework active
  const cfCheck = await query(
    "SELECT 1 FROM company_frameworks WHERE company_id = $1 AND framework_key = $2",
    [cid, key]
  );
  if (cfCheck.rows.length === 0) {
    return res.status(404).json({ error: "Framework not active for this company" });
  }

  const result = await query(
    `SELECT DISTINCT ON (q.quest_id)
       q.*,
       qfc.control_reference,
       CASE WHEN q.next_due_date IS NOT NULL AND q.next_due_date < NOW() THEN true ELSE false END AS is_overdue,
       (SELECT answer FROM assessments
        WHERE quest_id = q.quest_id AND company_id = $1 AND review_status IN ('FINISHED', 'AUDITED')
        ORDER BY created_at DESC LIMIT 1) AS latest_answer,
       EXISTS (
         SELECT 1 FROM question_evidence qe WHERE qe.quest_id = q.quest_id AND qe.company_id = $1
       ) AS has_evidence
     FROM question_framework_controls qfc
     JOIN questions q ON q.quest_id = qfc.quest_id AND q.company_id = $1
     WHERE qfc.company_id = $1 AND qfc.framework_key = $2 AND q.archived_at IS NULL
     ORDER BY q.quest_id ASC, q.company_id ASC NULLS LAST`,
    [cid, key]
  );

  res.json(mapRows(result));
}));

// GET /api/frameworks/:key/dashboard
// Per-framework dashboard: completion by control area, answer distribution,
// evidence coverage, and overall score for this framework only.
router.get("/:key/dashboard", authenticate, asyncHandler(async (req, res) => {
  const cid = req.user.companyId;
  const { key } = req.params;

  const cfCheck = await query(
    "SELECT 1 FROM company_frameworks WHERE company_id = $1 AND framework_key = $2",
    [cid, key]
  );
  if (cfCheck.rows.length === 0) {
    return res.status(404).json({ error: "Framework not active for this company" });
  }

  const [controlAreas, answerDist, evidenceCoverage, totalFinished] = await Promise.all([
    // Per-control-area completion
    query(
      `SELECT
         COALESCE(q.control_area, 'Uncategorised') AS control_area,
         qfc.control_reference,
         COUNT(DISTINCT q.quest_id) AS total,
         COUNT(DISTINCT a.quest_id) FILTER (WHERE a.review_status IN ('FINISHED', 'AUDITED')) AS finished,
         COUNT(DISTINCT a.quest_id) AS assessed
       FROM question_framework_controls qfc
       JOIN questions q ON q.quest_id = qfc.quest_id AND q.company_id = $1
       LEFT JOIN assessments a ON a.quest_id = q.quest_id AND a.company_id = $1
       WHERE qfc.company_id = $1 AND qfc.framework_key = $2
       GROUP BY COALESCE(q.control_area, 'Uncategorised'), qfc.control_reference
       ORDER BY control_area ASC`,
      [cid, key]
    ),

    // Answer distribution within this framework
    query(
      `SELECT a.answer, COUNT(DISTINCT a.quest_id) AS n
       FROM assessments a
       JOIN question_framework_controls qfc ON qfc.quest_id = a.quest_id AND qfc.company_id = $1 AND qfc.framework_key = $2
       WHERE a.company_id = $1
       GROUP BY a.answer`,
      [cid, key]
    ),

    // Evidence coverage within this framework
    query(
      `SELECT
         COUNT(DISTINCT q.quest_id) FILTER (WHERE (
           EXISTS (SELECT 1 FROM question_evidence qe WHERE qe.quest_id = q.quest_id AND qe.company_id = $1)
           OR EXISTS (SELECT 1 FROM evidence e WHERE e.quest_id = q.quest_id AND e.company_id = $1)
         )) AS covered,
         COUNT(DISTINCT q.quest_id) AS total
       FROM question_framework_controls qfc
       JOIN questions q ON q.quest_id = qfc.quest_id AND q.company_id = $1
       WHERE qfc.company_id = $1 AND qfc.framework_key = $2`,
      [cid, key]
    ),

    // Total and finished for overall score
    query(
      `SELECT
         COUNT(DISTINCT q.quest_id) AS total,
         COUNT(DISTINCT a.quest_id) FILTER (WHERE a.review_status IN ('FINISHED', 'AUDITED')) AS finished
       FROM question_framework_controls qfc
       JOIN questions q ON q.quest_id = qfc.quest_id AND q.company_id = $1
       LEFT JOIN assessments a ON a.quest_id = q.quest_id AND a.company_id = $1
       WHERE qfc.company_id = $1 AND qfc.framework_key = $2`,
      [cid, key]
    ),
  ]);

  const total = parseInt(totalFinished.rows[0]?.total) || 0;
  const finished = parseInt(totalFinished.rows[0]?.finished) || 0;

  res.json({
    frameworkKey: key,
    overall: {
      total,
      finished,
      completionPct: total > 0 ? Math.round((finished / total) * 100) : 0,
    },
    controlAreas: controlAreas.rows.map(r => ({
      controlArea: r.control_area,
      controlReference: r.control_reference,
      total: parseInt(r.total),
      finished: parseInt(r.finished),
      assessed: parseInt(r.assessed),
    })),
    answerDistribution: answerDist.rows.map(r => ({
      answer: r.answer || "WIP",
      count: parseInt(r.n),
    })),
    evidenceCoverage: {
      covered: parseInt(evidenceCoverage.rows[0]?.covered) || 0,
      total: parseInt(evidenceCoverage.rows[0]?.total) || 0,
    },
  });
}));

// ═══ Framework import: AI clustering + human review (superadmin) ═══════════════

async function loadGlobalCanonical() {
  const qs = await query(
    `SELECT quest_id, module_id, control_area, baseline_question, level3_yes_criteria
       FROM questions WHERE company_id IS NULL ORDER BY quest_id`
  );
  const maps = await query(
    `SELECT quest_id, framework_key, control_reference
       FROM question_framework_controls WHERE company_id IS NULL`
  );
  const byQuest = new Map();
  for (const m of maps.rows) {
    if (!byQuest.has(m.quest_id)) byQuest.set(m.quest_id, []);
    byQuest.get(m.quest_id).push({ key: m.framework_key, ref: m.control_reference });
  }
  return qs.rows.map(q => ({
    questId: q.quest_id,
    moduleId: q.module_id,
    controlArea: q.control_area,
    question: q.baseline_question,
    level3: q.level3_yes_criteria,
    frameworks: byQuest.get(q.quest_id) || [],
  }));
}

// POST /api/frameworks/import/batches — parse a framework sheet, collapse controls,
// stage a review batch. Body: frameworkKey (defaults to the filename guess).
router.post("/import/batches", authenticate, requireSuperAdmin, importUpload.single("file"), scanXlsxUpload(),
  asyncHandler(async (req, res) => {
    if (!req.file) return res.status(400).json({ error: "No file uploaded" });
    const filePath = req.file.path;
    try {
      const parsed = await parseExcelImport(filePath, { originalName: req.file.originalname });
      const frameworkKey = req.body.frameworkKey || parsed.frameworkGuess;
      if (!frameworkKey) {
        return res.status(400).json({ error: "Could not determine the framework — pass frameworkKey.", frameworkGuess: null });
      }
      const fw = await query("SELECT key FROM frameworks WHERE key = $1", [frameworkKey]);
      if (fw.rows.length === 0) return res.status(400).json({ error: `Unknown framework: ${frameworkKey}` });

      const units = collapseForStaging(parsed.questions, frameworkKey);

      const client = await getClient();
      try {
        await client.query("BEGIN");
        const batch = await client.query(
          `INSERT INTO import_batches (kind, primary_framework_key, source_file_name, status, raw_stats, ai_provider, created_by)
           VALUES ('IMPORT', $1, $2, 'STAGED', $3, $4, $5) RETURNING id`,
          [frameworkKey, req.file.originalname,
           JSON.stringify({ rows: parsed.questions.length, controls: units.length, modules: parsed.modules.length, parseErrors: parsed.errors }),
           (process.env.PRISM_AI_PROVIDER || "bedrock"), req.user.userId || null]
        );
        const batchId = batch.rows[0].id;

        for (const u of units) {
          await client.query(
            `INSERT INTO import_staging_rows
              (batch_id, framework_key, source_quest_id, module_id, module_name, control_area,
               control_reference, control_reference_raw, facet, baseline_question, level3_yes_criteria,
               required_evidence, default_owner, frequency, priority, tags, collapse_group_key, raw)
             VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18)`,
            [batchId, u.framework_key, u.source_quest_id, u.module_id, u.module_name, u.control_area,
             u.control_reference, u.control_reference_raw, u.facet, u.baseline_question, u.level3_yes_criteria,
             u.required_evidence, u.default_owner, u.frequency, u.priority, u.tags, u.collapse_group_key,
             JSON.stringify(u.raw)]
          );
        }
        await client.query("COMMIT");
        res.status(201).json({
          batchId, frameworkKey, frameworkGuess: parsed.frameworkGuess || null,
          counts: { rows: parsed.questions.length, controls: units.length, modules: parsed.modules.length },
          parseErrors: parsed.errors,
        });
      } catch (err) {
        await client.query("ROLLBACK");
        throw err;
      } finally {
        client.release();
      }
    } finally {
      try { if (fs.existsSync(filePath)) fs.unlinkSync(filePath); } catch { /* ignore */ }
    }
  }));

// POST /api/frameworks/import/batches/:id/cluster — run AI clustering, move to REVIEW.
router.post("/import/batches/:id/cluster", authenticate, requireSuperAdmin, longRequestTimeout(120000),
  asyncHandler(async (req, res) => {
    const id = parseInt(req.params.id);
    const b = await query("SELECT * FROM import_batches WHERE id = $1", [id]);
    const batch = b.rows[0];
    if (!batch) return res.status(404).json({ error: "Batch not found" });
    if (batch.status === "COMMITTED") return res.status(409).json({ error: "Batch already committed" });

    const decided = await query(
      "SELECT COUNT(*)::int AS n FROM import_clusters WHERE batch_id = $1 AND decision IS NOT NULL", [id]
    );
    if (decided.rows[0].n > 0) {
      return res.status(409).json({ error: "Re-clustering would discard review decisions already made" });
    }

    const staging = await query("SELECT * FROM import_staging_rows WHERE batch_id = $1 ORDER BY id", [id]);
    const incoming = staging.rows.map(r => ({
      tempId: String(r.id),
      frameworkKey: r.framework_key,
      moduleId: r.module_id,
      controlArea: r.control_area,
      controlReference: r.control_reference,
      question: r.baseline_question,
      level3: r.level3_yes_criteria,
      requiredEvidence: r.required_evidence,
      facet: r.facet,
    }));
    const existing = await loadGlobalCanonical();

    const { clusters } = await clusterQuestions({ incoming, existing });

    const client = await getClient();
    try {
      await client.query("BEGIN");
      await client.query("DELETE FROM import_clusters WHERE batch_id = $1", [id]);

      const assigned = new Set();
      for (const c of clusters) {
        const ins = await client.query(
          `INSERT INTO import_clusters
             (batch_id, proposed_action, existing_quest_id, proposed_canonical_question,
              proposed_level3, proposed_control_area, proposed_module_id, ai_confidence, ai_rationale, match_method)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) RETURNING id`,
          [id, c.action, c.existingQuestId || null, c.canonicalQuestion || null, c.level3 || null,
           null, null, c.confidence ?? null, c.rationale || null, c.matchMethod || "fingerprint"]
        );
        const clusterId = ins.rows[0].id;
        for (const tempId of c.memberTempIds) {
          const rowId = parseInt(tempId);
          if (assigned.has(rowId)) continue;
          await client.query(
            `INSERT INTO import_cluster_members (cluster_id, staging_row_id) VALUES ($1, $2) ON CONFLICT DO NOTHING`,
            [clusterId, rowId]
          );
          assigned.add(rowId);
        }
      }

      // Any staging row the clusterer omitted becomes its own KEEP_SEPARATE cluster.
      for (const r of staging.rows) {
        if (assigned.has(r.id)) continue;
        const ins = await client.query(
          `INSERT INTO import_clusters (batch_id, proposed_action, proposed_canonical_question, match_method)
           VALUES ($1, 'KEEP_SEPARATE', $2, 'fingerprint') RETURNING id`,
          [id, r.baseline_question]
        );
        await client.query(
          "INSERT INTO import_cluster_members (cluster_id, staging_row_id) VALUES ($1, $2)",
          [ins.rows[0].id, r.id]
        );
      }

      await client.query("UPDATE import_batches SET status = 'REVIEW', updated_at = NOW() WHERE id = $1", [id]);
      await client.query("COMMIT");
    } catch (err) {
      await client.query("ROLLBACK");
      throw err;
    } finally {
      client.release();
    }

    const count = await query("SELECT COUNT(*)::int AS n FROM import_clusters WHERE batch_id = $1", [id]);
    res.json({ batchId: id, status: "REVIEW", clusters: count.rows[0].n });
  }));

// GET /api/frameworks/import/batches — list batches with progress.
router.get("/import/batches", authenticate, requireSuperAdmin, asyncHandler(async (req, res) => {
  const result = await query(
    `SELECT b.*,
            (SELECT COUNT(*)::int FROM import_clusters c WHERE c.batch_id = b.id) AS cluster_count,
            (SELECT COUNT(*)::int FROM import_clusters c WHERE c.batch_id = b.id AND c.decision IS NOT NULL) AS decided_count
       FROM import_batches b ORDER BY b.created_at DESC`
  );
  res.json(mapRows(result));
}));

// GET /api/frameworks/import/batches/:id — full review payload.
router.get("/import/batches/:id", authenticate, requireSuperAdmin, asyncHandler(async (req, res) => {
  const id = parseInt(req.params.id);
  const b = await query("SELECT * FROM import_batches WHERE id = $1", [id]);
  const batch = mapRow(b);
  if (!batch) return res.status(404).json({ error: "Batch not found" });

  const clusters = await query("SELECT * FROM import_clusters WHERE batch_id = $1 ORDER BY id", [id]);
  const members = await query(
    `SELECT m.cluster_id, m.assigned_framework_key, m.assigned_control_reference, s.*
       FROM import_cluster_members m
       JOIN import_staging_rows s ON s.id = m.staging_row_id
      WHERE s.batch_id = $1 ORDER BY m.cluster_id, s.id`,
    [id]
  );
  const canonical = await loadGlobalCanonical();
  const canonMap = new Map(canonical.map(c => [c.questId, c]));

  const memByCluster = new Map();
  for (const m of mapRows(members)) {
    if (!memByCluster.has(m.clusterId)) memByCluster.set(m.clusterId, []);
    memByCluster.get(m.clusterId).push(m);
  }

  res.json({
    batch,
    clusters: mapRows(clusters).map(c => ({
      ...c,
      members: (memByCluster.get(c.id) || []),
      existing: c.existingQuestId ? canonMap.get(c.existingQuestId) || null : null,
    })),
  });
}));

// PATCH /api/frameworks/import/batches/:id/clusters/:clusterId — record a decision.
router.patch("/import/batches/:id/clusters/:clusterId", authenticate, requireSuperAdmin,
  asyncHandler(async (req, res) => {
    const id = parseInt(req.params.id);
    const clusterId = parseInt(req.params.clusterId);
    const { decision, action, existingQuestId, canonicalQuestion, level3, memberOverrides } = req.body;
    if (!["ACCEPT", "REJECT", "MODIFIED"].includes(decision)) {
      return res.status(400).json({ error: "decision must be ACCEPT, REJECT or MODIFIED" });
    }
    const c = await query("SELECT * FROM import_clusters WHERE id = $1 AND batch_id = $2", [clusterId, id]);
    if (c.rows.length === 0) return res.status(404).json({ error: "Cluster not found" });

    const client = await getClient();
    try {
      await client.query("BEGIN");
      await client.query(
        `UPDATE import_clusters
            SET decision = $1,
                decided_action = COALESCE($2, decided_action, proposed_action),
                decided_canonical_question = COALESCE($3, decided_canonical_question, proposed_canonical_question),
                decided_level3 = COALESCE($4, decided_level3, proposed_level3),
                existing_quest_id = COALESCE($5, existing_quest_id),
                decided_by = $6, decided_at = NOW(), updated_at = NOW()
          WHERE id = $7`,
        [decision, action || null, canonicalQuestion || null, level3 || null,
         existingQuestId || null, req.user.userId || null, clusterId]
      );
      for (const o of (memberOverrides || [])) {
        await client.query(
          `UPDATE import_cluster_members
              SET assigned_framework_key = $1, assigned_control_reference = $2
            WHERE cluster_id = $3 AND staging_row_id = $4`,
          [o.frameworkKey || null, o.controlReference || null, clusterId, o.stagingRowId]
        );
      }
      await client.query("COMMIT");
    } catch (err) {
      await client.query("ROLLBACK");
      throw err;
    } finally {
      client.release();
    }
    res.json({ ok: true });
  }));

// POST /api/frameworks/import/batches/:id/commit — write canonical questions +
// question_framework_controls (company_id IS NULL) and rewrite the framework template.
router.post("/import/batches/:id/commit", authenticate, requireSuperAdmin, longRequestTimeout(120000),
  asyncHandler(async (req, res) => {
    const id = parseInt(req.params.id);
    const b = await query("SELECT * FROM import_batches WHERE id = $1", [id]);
    const batch = b.rows[0];
    if (!batch) return res.status(404).json({ error: "Batch not found" });
    if (batch.status === "COMMITTED") return res.status(409).json({ error: "Batch already committed" });

    const clusters = await query("SELECT * FROM import_clusters WHERE batch_id = $1 ORDER BY id", [id]);
    const undecided = clusters.rows.filter(c => !c.decision);
    if (undecided.length > 0) {
      return res.status(400).json({ error: `${undecided.length} cluster(s) still need a decision` });
    }
    const members = await query(
      `SELECT m.cluster_id, m.assigned_framework_key, m.assigned_control_reference, s.*
         FROM import_cluster_members m JOIN import_staging_rows s ON s.id = m.staging_row_id
        WHERE s.batch_id = $1`, [id]
    );
    const memByCluster = new Map();
    for (const m of members.rows) {
      if (!memByCluster.has(m.cluster_id)) memByCluster.set(m.cluster_id, []);
      memByCluster.get(m.cluster_id).push(m);
    }

    const summary = { canonicalCreated: 0, merged: 0, mappings: 0, skipped: 0 };
    // Per-framework canonical template payloads (RECONCILE touches many frameworks;
    // IMPORT just one).
    const tplByFw = new Map(); // frameworkKey -> { questions:[], modules:Map }
    const tplFor = (fw) => {
      if (!tplByFw.has(fw)) tplByFw.set(fw, { questions: [], modules: new Map() });
      return tplByFw.get(fw);
    };

    const client = await getClient();
    try {
      await client.query("BEGIN");

      for (const cl of clusters.rows) {
        const mem = memByCluster.get(cl.id) || [];
        if (cl.decision === "REJECT" || mem.length === 0) { summary.skipped++; continue; }

        const action = cl.decided_action || cl.proposed_action;
        const canonicalQuestion = cl.decided_canonical_question || cl.proposed_canonical_question || mem[0].baseline_question;
        const level3 = cl.decided_level3 || cl.proposed_level3 || mem[0].level3_yes_criteria || null;
        const rep = mem[0];

        let questId;
        if (action === "MERGE_INTO_EXISTING" && cl.existing_quest_id) {
          questId = cl.existing_quest_id;
          summary.merged++;
          if (cl.decision === "MODIFIED") {
            await client.query(
              `UPDATE questions SET baseline_question = $1, level3_yes_criteria = COALESCE($2, level3_yes_criteria), updated_at = NOW()
                 WHERE company_id IS NULL AND quest_id = $3`,
              [canonicalQuestion, level3, questId]
            );
          }
        } else {
          // Mint a stable canonical quest_id from the representative source id.
          const base = rep.source_quest_id || `${batch.primary_framework_key || rep.framework_key || "Q"}-${cl.id}`;
          questId = base;
          for (let n = 2; ; n++) {
            const clash = await client.query(
              "SELECT 1 FROM questions WHERE company_id IS NULL AND quest_id = $1", [questId]
            );
            if (clash.rows.length === 0) break;
            questId = `${base}-${n}`;
          }
          await client.query(
            `INSERT INTO questions (quest_id, company_id, module_id, module_name, control_area,
               iso_reference, baseline_question, level3_yes_criteria, required_evidence,
               default_owner, frequency, priority, tags)
             VALUES ($1, NULL, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)`,
            [questId, rep.module_id, rep.module_name || rep.module_id, rep.control_area,
             rep.control_reference || null, canonicalQuestion, level3, rep.required_evidence || null,
             rep.default_owner || null, rep.frequency || null,
             ["Critical", "High", "Medium", "Low"].includes(rep.priority) ? rep.priority : "Medium",
             rep.tags || null]
          );
          summary.canonicalCreated++;
        }

        await client.query(
          "UPDATE import_clusters SET decided_quest_id = $1, updated_at = NOW() WHERE id = $2",
          [questId, cl.id]
        );

        const controlsByFw = new Map();
        for (const m of mem) {
          const fw = m.assigned_framework_key || m.framework_key;
          const refs = m.assigned_control_reference
            ? [m.assigned_control_reference]
            : splitRefs(m.control_reference_raw || m.control_reference);
          const facets = (m.raw && m.raw.original_facets) || null;
          for (const ref of (refs.length ? refs : [m.control_reference])) {
            if (!fw || !ref) continue;
            const ins = await client.query(
              `INSERT INTO question_framework_controls
                 (company_id, quest_id, framework_key, control_reference,
                  original_quest_id, original_question, original_control_area, original_level3, original_facets)
               VALUES (NULL, $1, $2, $3, $4, $5, $6, $7, $8)
               ON CONFLICT ON CONSTRAINT qfc_uniq_nnd DO NOTHING RETURNING id`,
              [questId, fw, ref, m.source_quest_id, m.baseline_question, m.control_area,
               m.level3_yes_criteria, facets ? JSON.stringify(facets) : null]
            );
            if (ins.rows.length) summary.mappings++;
            const c = {
              framework_key: fw, control_reference: ref,
              original_quest_id: m.source_quest_id, original_question: m.baseline_question,
              original_control_area: m.control_area, original_facets: facets,
            };
            if (!controlsByFw.has(fw)) controlsByFw.set(fw, []);
            controlsByFw.get(fw).push(c);
          }
          if (fw) tplFor(fw).modules.set(m.module_id, { module_id: m.module_id, name: m.module_name || m.module_id, framework_key: fw });
        }

        // Add this canonical question to every framework template it touches.
        for (const [fw, controls] of controlsByFw) {
          tplFor(fw).questions.push({
            quest_id: questId, canonical: true,
            module_id: rep.module_id, module_name: rep.module_name || rep.module_id,
            control_area: rep.control_area, baseline_question: canonicalQuestion,
            level3_yes_criteria: level3, required_evidence: rep.required_evidence || "",
            default_owner: rep.default_owner || "", frequency: rep.frequency || "",
            priority: rep.priority || "Medium", tags: rep.tags || "",
            iso_reference: controls[0]?.control_reference || null,
            controls,
          });
        }
      }

      // Rewrite (or create) the canonical template for every framework touched.
      for (const [fw, payload] of tplByFw) {
        const fwRow = await client.query("SELECT name FROM frameworks WHERE key = $1", [fw]);
        const tplName = `${fwRow.rows[0]?.name || fw} (canonical)`;
        const modArr = [...payload.modules.values()];
        const existingTpl = await client.query(
          "SELECT id FROM module_templates WHERE framework_key = $1 AND name = $2", [fw, tplName]
        );
        if (existingTpl.rows.length > 0) {
          await client.query(
            "UPDATE module_templates SET module_data = $1, question_data = $2, updated_at = NOW() WHERE id = $3",
            [JSON.stringify(modArr), JSON.stringify(payload.questions), existingTpl.rows[0].id]
          );
        } else {
          await client.query(
            `INSERT INTO module_templates (name, description, file_name, module_data, question_data, framework_key, created_by)
             VALUES ($1, $2, $3, $4, $5, $6, $7)`,
            [tplName, "Canonical cross-framework question set", batch.source_file_name || null,
             JSON.stringify(modArr), JSON.stringify(payload.questions), fw, req.user.userId || null]
          );
        }
      }

      await client.query(
        "UPDATE import_batches SET status = 'COMMITTED', committed_at = NOW(), updated_at = NOW() WHERE id = $1",
        [id]
      );
      await client.query("COMMIT");
    } catch (err) {
      await client.query("ROLLBACK");
      await query("UPDATE import_batches SET status = 'FAILED', error = $2, updated_at = NOW() WHERE id = $1",
        [id, String(err.message).slice(0, 500)]).catch(() => {});
      throw err;
    } finally {
      client.release();
    }

    res.json({ batchId: id, status: "COMMITTED", summary });
  }));

// POST /api/frameworks/reconcile — one-time bulk pass over existing framework
// module_templates: stage every framework's questions into one RECONCILE batch so
// the reviewer can merge controls that repeat across frameworks. Body:
// { templateIds?: number[] }  (default: all templates that have a framework_key).
router.post("/reconcile", authenticate, requireSuperAdmin, asyncHandler(async (req, res) => {
  const { templateIds } = req.body || {};
  const tplRows = await query(
    templateIds && templateIds.length
      ? "SELECT * FROM module_templates WHERE id = ANY($1::int[]) AND framework_key IS NOT NULL"
      : "SELECT * FROM module_templates WHERE framework_key IS NOT NULL AND name NOT LIKE '%(canonical)%'",
    templateIds && templateIds.length ? [templateIds] : []
  );
  if (tplRows.rows.length === 0) {
    return res.status(400).json({ error: "No framework templates to reconcile. Assign framework_key to templates first." });
  }

  // Build staging units from each template's question_data, tagged with the
  // template's framework. Handles both the legacy (iso_reference) and canonical
  // (controls[]) question shapes.
  const units = [];
  for (const tpl of tplRows.rows) {
    const qd = typeof tpl.question_data === "string" ? JSON.parse(tpl.question_data) : (tpl.question_data || []);
    for (const q of qd) {
      const refs = Array.isArray(q.controls) && q.controls.length
        ? q.controls.map(c => ({ fw: c.framework_key, ref: c.control_reference, orig: c.original_quest_id }))
        : [{ fw: tpl.framework_key, ref: q.iso_reference || "", orig: q.quest_id }];
      for (const { fw, ref, orig } of refs) {
        units.push({
          framework_key: fw || tpl.framework_key,
          source_quest_id: orig || q.quest_id,
          module_id: q.module_id, module_name: q.module_name || q.module_id,
          control_area: q.control_area || "",
          control_reference: ref, control_reference_raw: ref,
          facet: "OTHER",
          baseline_question: q.baseline_question || "",
          level3_yes_criteria: q.level3_yes_criteria || "",
          required_evidence: q.required_evidence || "",
          default_owner: q.default_owner || "", frequency: q.frequency || "",
          priority: q.priority || "", tags: q.tags || "",
          collapse_group_key: null,
          raw: { fromTemplate: tpl.id },
        });
      }
    }
  }

  const client = await getClient();
  try {
    await client.query("BEGIN");
    const batch = await client.query(
      `INSERT INTO import_batches (kind, primary_framework_key, source_file_name, status, raw_stats, ai_provider, templates_snapshot, created_by)
       VALUES ('RECONCILE', NULL, $1, 'STAGED', $2, $3, $4, $5) RETURNING id`,
      [`reconcile:${tplRows.rows.map(t => t.framework_key).join(",")}`,
       JSON.stringify({ rows: units.length, controls: units.length, modules: new Set(units.map(u => u.module_id)).size, templates: tplRows.rows.length }),
       (process.env.PRISM_AI_PROVIDER || "bedrock"),
       JSON.stringify(tplRows.rows.map(t => ({ id: t.id, name: t.name, framework_key: t.framework_key, module_data: t.module_data, question_data: t.question_data }))),
       req.user.userId || null]
    );
    const batchId = batch.rows[0].id;
    for (const u of units) {
      await client.query(
        `INSERT INTO import_staging_rows
          (batch_id, framework_key, source_quest_id, module_id, module_name, control_area,
           control_reference, control_reference_raw, facet, baseline_question, level3_yes_criteria,
           required_evidence, default_owner, frequency, priority, tags, collapse_group_key, raw)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18)`,
        [batchId, u.framework_key, u.source_quest_id, u.module_id, u.module_name, u.control_area,
         u.control_reference, u.control_reference_raw, u.facet, u.baseline_question, u.level3_yes_criteria,
         u.required_evidence, u.default_owner, u.frequency, u.priority, u.tags, u.collapse_group_key,
         JSON.stringify(u.raw)]
      );
    }
    await client.query("COMMIT");
    res.status(201).json({
      batchId, kind: "RECONCILE",
      counts: { controls: units.length, templates: tplRows.rows.length,
        frameworks: [...new Set(units.map(u => u.framework_key))] },
    });
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  } finally {
    client.release();
  }
}));

// ─── Template update notices (company-facing) ─────────────────────────────────

// GET /api/frameworks/template-updates
// Pending "a new version of your template is available" notices for this company.
// Pass ?all=true to also include already-applied/dismissed notices (history).
router.get("/template-updates", authenticate, requireRole(["ADMIN", "LEAD"]), asyncHandler(async (req, res) => {
  const cid = req.user.companyId;
  const includeAll = req.query.all === "true";
  const result = await query(
    `SELECT n.id, n.template_id, n.from_version, n.to_version, n.status, n.diff_summary, n.created_at, n.applied_at,
            t.name AS template_name, t.framework_key
     FROM template_update_notices n
     JOIN module_templates t ON t.id = n.template_id
     WHERE n.company_id = $1 ${includeAll ? "" : "AND n.status = 'pending'"}
     ORDER BY n.created_at DESC`,
    [cid]
  );
  res.json(mapRows(result));
}));

// GET /api/frameworks/template-updates/:noticeId
// Full classified diff for one notice, enriched with whether each affected
// question already has a FINISHED/AUDITED answer under it.
router.get("/template-updates/:noticeId", authenticate, requireRole(["ADMIN", "LEAD"]), asyncHandler(async (req, res) => {
  const cid = req.user.companyId;
  const { noticeId } = req.params;

  const noticeResult = await query(
    `SELECT n.*, t.name AS template_name, t.framework_key, t.root_template_id
     FROM template_update_notices n JOIN module_templates t ON t.id = n.template_id
     WHERE n.id = $1 AND n.company_id = $2`,
    [noticeId, cid]
  );
  if (noticeResult.rows.length === 0) return res.status(404).json({ error: "Notice not found" });
  const notice = noticeResult.rows[0];

  const client = await getClient();
  let versionDiff;
  try {
    versionDiff = await computeVersionDiff(client, notice.root_template_id, notice.from_version, notice.to_version);
  } finally {
    client.release();
  }
  if (!versionDiff) return res.status(409).json({ error: "Template version history is missing for this notice" });

  const affectedIds = [
    ...versionDiff.diff.reworded.map((r) => r.questId),
    ...versionDiff.diff.renamed.map((r) => r.oldQuestId),
    ...versionDiff.diff.removed.map((r) => r.questId),
  ];
  let lockedStatusByQuestId = {};
  if (affectedIds.length > 0) {
    const statusResult = await query(
      `SELECT quest_id, review_status FROM assessments
       WHERE company_id = $1 AND quest_id = ANY($2::text[]) AND review_status IN ('FINISHED', 'AUDITED')`,
      [cid, affectedIds]
    );
    lockedStatusByQuestId = Object.fromEntries(statusResult.rows.map((r) => [r.quest_id, r.review_status]));
  }

  res.json({
    id: notice.id,
    templateName: notice.template_name,
    frameworkKey: notice.framework_key,
    fromVersion: notice.from_version,
    toVersion: notice.to_version,
    status: notice.status,
    appliedAt: notice.applied_at,
    summary: versionDiff.summary,
    reworded: versionDiff.diff.reworded.map((r) => ({ ...r, locked: lockedStatusByQuestId[r.questId] || null })),
    renamed: versionDiff.diff.renamed.map((r) => ({ ...r, locked: lockedStatusByQuestId[r.oldQuestId] || null })),
    added: versionDiff.diff.added,
    removed: versionDiff.diff.removed.map((r) => ({ ...r, locked: lockedStatusByQuestId[r.questId] || null })),
  });
}));

// POST /api/frameworks/template-updates/:noticeId/apply
// Company admin's explicit decision to take the new version. Recomputes the diff
// fresh from the immutable version snapshots (never trusts a cached copy) and
// applies it transactionally.
router.post("/template-updates/:noticeId/apply", authenticate, requireRole(["ADMIN", "LEAD"]), asyncHandler(async (req, res) => {
  const cid = req.user.companyId;
  const { noticeId } = req.params;

  const noticeResult = await query(
    `SELECT n.*, t.framework_key, t.root_template_id
     FROM template_update_notices n JOIN module_templates t ON t.id = n.template_id
     WHERE n.id = $1 AND n.company_id = $2 AND n.status = 'pending'`,
    [noticeId, cid]
  );
  if (noticeResult.rows.length === 0) return res.status(404).json({ error: "Pending notice not found" });
  const notice = noticeResult.rows[0];

  const client = await getClient();
  try {
    await client.query("BEGIN");
    const versionDiff = await computeVersionDiff(client, notice.root_template_id, notice.from_version, notice.to_version);
    if (!versionDiff) throw new Error("Template version history is missing for this notice");

    await applyTemplateDiff(client, {
      companyId: cid,
      diff: versionDiff.diff,
      toQuestions: versionDiff.toQuestions,
      toVersion: notice.to_version,
      frameworkKey: notice.framework_key,
    });

    await client.query(
      "UPDATE companies SET template_version = $1, updated_at = NOW() WHERE id = $2",
      [notice.to_version, cid]
    );
    await client.query(
      "UPDATE template_update_notices SET status = 'applied', applied_at = NOW(), diff_summary = $1 WHERE id = $2",
      [JSON.stringify(versionDiff.summary), noticeId]
    );
    await client.query("COMMIT");
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  } finally {
    client.release();
  }

  res.json({ applied: true, toVersion: notice.to_version });
}));

// POST /api/frameworks/template-updates/:noticeId/dismiss
// Company admin declines this version — no forced update, ever. They stay on
// their current version and can act on a later notice whenever they choose.
router.post("/template-updates/:noticeId/dismiss", authenticate, requireRole(["ADMIN", "LEAD"]), asyncHandler(async (req, res) => {
  const cid = req.user.companyId;
  const { noticeId } = req.params;
  const result = await query(
    "UPDATE template_update_notices SET status = 'dismissed' WHERE id = $1 AND company_id = $2 AND status = 'pending' RETURNING id",
    [noticeId, cid]
  );
  if (result.rows.length === 0) return res.status(404).json({ error: "Pending notice not found" });
  res.json({ dismissed: true });
}));

export default router;
