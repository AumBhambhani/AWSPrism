// Pre-fill the compliance tracker (`assessments`) from a company's pre-onboarding
// self-assessment answers, so an approved company starts from a realistic
// baseline instead of every question "not started".
//
// Called from:
//   - routes/superadmin.js  PATCH /companies/:id/status -> approved   (scope: "framework")
//   - routes/auth.js        POST /complete-onboarding                 (scope: "dept")
//   - routes/superadmin.js  PATCH /companies/:id/seed-self-assessment (scope: "all", manual re-run)
//
// Every seeded row lands as review_status = 'WIP' — a DRAFT. WIP rows are
// excluded from every readiness / compliance dashboard (those filter
// review_status = 'FINISHED'), so seeding never moves the score. The company's
// first task becomes "confirm these and attach evidence".
//
// Status translation (per product decision):
//   YES  -> PARTIALLY_IMPLEMENTED   (self-attested, unverified)
//   PARTIAL -> PARTIALLY_IMPLEMENTED
//   NO   -> NOT_IMPLEMENTED
//   NA / anything else -> skipped
//
// Idempotent: an INSERT ... WHERE NOT EXISTS guard means a quest that already has
// an assessment row for the current month is never touched, so re-approval and
// the manual endpoint are safe.

import { deptQuestionBase, expandQuestions } from "./deptSelfAssessQuestions.js";
import { controlMapFor } from "../data/selfAssessmentControlMap.js";
import { mapSelfAssessmentToQuestions } from "./aiProvider.js";
import { getCompanyAiProvider } from "./aiSettings.js";
import { applyCapabilityDerivation } from "./capabilityAssessment.js";
import { IT_DERIVED_QUESTIONS } from "../data/itCapabilityMap.js";

const RANK = { NO: 0, PARTIAL: 1, YES: 2 };
const TRANSLATE = { YES: "PARTIALLY_IMPLEMENTED", PARTIAL: "PARTIALLY_IMPLEMENTED", NO: "NOT_IMPLEMENTED" };

function currentMonth() {
  const d = new Date();
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
}

function slugify(dept) {
  return String(dept || "").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
}

/** Normalise a control reference so "A.8.5", "8.5", "s.8(5)" and "8 5" compare equal. */
export function normRef(s) {
  return String(s || "")
    .toLowerCase()
    .replace(/^(a\.|art\.?\s*|s\.?\s*|clause\s*|sec\.?\s*)/i, "")
    .replace(/[()\s.\-–]/g, "");
}

/** Normalise a framework key: "ISO/IEC 27001:2022" -> "iso27001", "DPDP Act" -> "dpdpa". */
export function normFramework(s) {
  const t = String(s || "").toLowerCase().replace(/[^a-z0-9]/g, "");
  if (t.startsWith("iso")) return "iso27001";
  if (t.startsWith("dpdp")) return "dpdpa";
  if (t.startsWith("gdpr")) return "gdpr";
  return t;
}

const STOP = new Set(["the", "and", "for", "are", "you", "your", "with", "that", "this", "have",
  "from", "any", "all", "does", "who", "how", "can", "has", "our", "not", "personal", "data"]);

function tokens(s) {
  return new Set(
    String(s || "").toLowerCase().split(/[^a-z0-9]+/).filter(w => w.length > 2 && !STOP.has(w))
  );
}

function overlap(a, b) {
  if (!a.size || !b.size) return 0;
  let n = 0;
  for (const t of a) if (b.has(t)) n++;
  return n / Math.min(a.size, b.size);
}

/**
 * @param {import('pg').PoolClient} client  a client already inside a transaction
 * @param {number} companyId
 * @param {{ scope?: "framework" | "dept" | "all" }} [opts]
 * @returns {Promise<{ seeded:number, resolved:number, unresolved:string[], scope:string }>}
 */
export async function seedAssessmentsFromSelfAssessment(client, companyId, { scope = "all" } = {}) {
  const subsRes = await client.query(
    `SELECT department, answers FROM self_assessment_submissions WHERE company_id = $1`,
    [companyId]
  );
  if (!subsRes.rows.length) return { seeded: 0, resolved: 0, unresolved: [], scope };

  // IT answers implied by the capability cards (MFA, EDR, SIEM, …) are not stored on the IT
  // submission — derive them so the tracker pre-fill sees the same it-* ids as before.
  const envRes = await client.query(`SELECT answers FROM company_environment WHERE company_id = $1`, [companyId]);
  let capabilityInput = null;
  if (envRes.rows[0]?.answers && Object.keys(envRes.rows[0].answers).length) {
    const stRes = await client.query(`SELECT capability_id, available, tool FROM company_capability_status WHERE company_id = $1`, [companyId]);
    const statuses = {};
    for (const r of stRes.rows) statuses[r.capability_id] = { available: r.available, tool: r.tool };
    capabilityInput = { environment: envRes.rows[0].answers, statuses };
  }
  const { submissions: derivedSubs } = applyCapabilityDerivation(
    subsRes.rows.map(r => ({ department: r.department, answers: r.answers && typeof r.answers === "object" ? r.answers : {} })),
    capabilityInput,
  );

  // 1. Merge answers across departments — weakest wins (a gap reported by any
  //    team is a gap). Remember a representative department + question text.
  const merged = new Map();      // selfAssessId -> { answer, rank, department, text }
  const perDept = [];            // { department, answers } — for dept scope
  for (const row of derivedSubs) {
    const answers = row.answers;
    perDept.push({ department: row.department, answers });
    const textById = new Map(
      expandQuestions(deptQuestionBase(row.department), answers).map(q => [q.id, q.text])
    );
    for (const dq of IT_DERIVED_QUESTIONS) if (answers[dq.id] !== undefined && !textById.has(dq.id)) textById.set(dq.id, dq.text);
    for (const [id, raw] of Object.entries(answers)) {
      const a = String(raw || "").trim().toUpperCase();
      if (!(a in RANK)) continue;
      const prev = merged.get(id);
      if (!prev || RANK[a] < prev.rank) {
        merged.set(id, { answer: a, rank: RANK[a], department: row.department, text: textById.get(id) || id });
      }
    }
  }
  if (!merged.size) return { seeded: 0, resolved: 0, unresolved: [], scope };

  // 2. Load the company's catalog once.
  const [qfcRes, questRes] = await Promise.all([
    client.query(
      `SELECT quest_id, framework_key, control_reference FROM question_framework_controls WHERE company_id = $1`,
      [companyId]
    ),
    client.query(
      `SELECT quest_id, module_id, control_area, iso_reference, baseline_question FROM questions WHERE company_id = $1 AND archived_at IS NULL`,
      [companyId]
    ),
  ]);

  const questById = new Map(questRes.rows.map(r => [r.quest_id, r]));

  // control-reference index: framework -> normRef -> Set<quest_id>
  const refIndex = new Map();
  const addRef = (fw, ref, questId) => {
    if (!ref) return;
    const f = refIndex.get(fw) || refIndex.set(fw, new Map()).get(fw);
    (f.get(normRef(ref)) || f.set(normRef(ref), new Set()).get(normRef(ref))).add(questId);
  };
  for (const r of qfcRes.rows) addRef(normFramework(r.framework_key), r.control_reference, r.quest_id);
  for (const r of questRes.rows) if (r.iso_reference) addRef("*", r.iso_reference, r.quest_id);

  const isFrameworkQuest = (questId) => !questId.startsWith("dept-");
  const wantFramework = scope === "framework" || scope === "all";
  const wantDept = scope === "dept" || scope === "all";

  // quest_id -> { answer, rank, department, text } — weakest wins here too
  const seedForQuest = new Map();
  const claim = (questId, src) => {
    const prev = seedForQuest.get(questId);
    if (!prev || src.rank < prev.rank) seedForQuest.set(questId, src);
  };

  const unresolved = [];

  // 3a. Framework-catalog resolution (id-based, department-independent).
  if (wantFramework) {
    for (const [id, src] of merged) {
      const map = controlMapFor(id);
      if (map.skip) continue;
      const hits = new Set();
      for (const { framework, ref } of map.controls) {
        const fw = normFramework(framework);
        const r = normRef(ref);
        for (const qid of refIndex.get(fw)?.get(r) || []) if (isFrameworkQuest(qid)) hits.add(qid);
      }
      if (!hits.size) {
        // secondary: match the reference regardless of framework (framework-less iso_reference rows)
        for (const { ref } of map.controls) {
          for (const qid of refIndex.get("*")?.get(normRef(ref)) || []) if (isFrameworkQuest(qid)) hits.add(qid);
        }
      }
      if (!hits.size) {
        // tertiary: text similarity against baseline_question / control_area
        const needle = tokens([src.text, ...(map.keywords || [])].join(" "));
        let best = null, bestScore = 0;
        for (const q of questRes.rows) {
          if (!isFrameworkQuest(q.quest_id)) continue;
          const s = overlap(needle, tokens(`${q.baseline_question} ${q.control_area}`));
          if (s > bestScore) { bestScore = s; best = q.quest_id; }
        }
        if (best && bestScore >= 0.5) hits.add(best);
      }
      if (hits.size) for (const qid of hits) claim(qid, src);
      else unresolved.push(id);
    }
  }

  // 3b. Department-onboarding resolution (per submitting department).
  if (wantDept) {
    for (const { department, answers } of perDept) {
      const slug = slugify(department);
      const prefix = `dept-${slug}-`;
      for (const [id, raw] of Object.entries(answers)) {
        const a = String(raw || "").trim().toUpperCase();
        if (!(a in RANK)) continue;
        const map = controlMapFor(id, { department });
        if (map.skip || !map.deptCats.length) continue;
        const src = merged.get(id) || { answer: a, rank: RANK[a], department, text: id };
        for (const q of questRes.rows) {
          if (!q.quest_id.startsWith(prefix)) continue;
          if (map.deptCats.some(cat => cat.toLowerCase() === String(q.control_area || "").toLowerCase())) {
            claim(q.quest_id, src);
          }
        }
      }
    }
  }

  // 4. AI fallback for framework ids the static map could not place. Skipped
  //    entirely when AI is not enabled for the company (opt-in) — no model call.
  const aiProvider = wantFramework && unresolved.length ? await getCompanyAiProvider(companyId) : "none";
  if (wantFramework && unresolved.length && aiProvider !== "none") {
    try {
      const catalog = questRes.rows
        .filter(q => isFrameworkQuest(q.quest_id))
        .map(q => ({ questId: q.quest_id, baselineQuestion: q.baseline_question, controlArea: q.control_area }));
      if (catalog.length) {
        const { map: aiMap } = await mapSelfAssessmentToQuestions({
          provider: aiProvider,
          questions: unresolved.map(id => ({ id, text: merged.get(id)?.text || id })),
          catalog,
        });
        const valid = new Set(catalog.map(c => c.questId));
        for (const [id, questIds] of Object.entries(aiMap || {})) {
          const src = merged.get(id);
          if (!src) continue;
          for (const qid of Array.isArray(questIds) ? questIds : []) {
            if (valid.has(qid)) claim(qid, src);
          }
        }
      }
    } catch (err) {
      console.warn(`[selfAssessSeed] AI fallback failed for company ${companyId}:`, err.message); // nosemgrep
    }
  }

  // 5. Insert WIP draft rows, skipping quests already assessed this month.
  const month = currentMonth();
  let seeded = 0;
  for (const [questId, src] of seedForQuest) {
    const answer = TRANSLATE[src.answer];
    if (!answer) continue;
    const q = questById.get(questId) || {};
    const comment = `Pre-filled from self-assessment — ${src.department} answered ${src.answer}: "${src.text}"`;
    const res = await client.query(
      `INSERT INTO assessments
         (assessment_id, month, module_id, quest_id, company_id, control_area, answer, submitted_by, review_status, comments)
       SELECT $1, $2, $3, $4, $5, $6, $7, 'self-assessment', 'WIP', $8
       WHERE NOT EXISTS (
         SELECT 1 FROM assessments WHERE company_id = $5 AND quest_id = $4 AND month = $2
       )`,
      [`selfassess-${questId}`, month, q.module_id || null, questId, companyId, q.control_area || null, answer, comment]
    );
    seeded += res.rowCount || 0;
  }

  if (seeded > 0) {
    await client.query(
      `UPDATE companies SET self_assessment_seeded_at = NOW(), updated_at = NOW() WHERE id = $1`,
      [companyId]
    );
  }

  return { seeded, resolved: seedForQuest.size, unresolved, scope };
}
