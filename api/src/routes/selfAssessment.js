import { Router } from "express";
import { createHash } from "crypto";
import { query, mapRow } from "../db/index.js";
import { authenticate } from "../middleware/auth.js";
import { requireRole } from "../middleware/roles.js";
import { asyncHandler } from "../utils/asyncHandler.js";
import { sendEmail } from "../utils/email.js";
import { buildEmailHtml } from "../utils/emailTemplate.js";
import { getCompanyAiProvider, providerModelId } from "../utils/aiSettings.js";
import { mapRegulatoryExposure, generateReadinessNarrative, analyzeGapContext } from "../utils/aiProvider.js";
import { buildSelfAssessmentReport, buildDeptOpenItems } from "../utils/selfAssessmentReport.js";
import { buildReadinessAssessment } from "../utils/readinessAssessment.js";
import { GUIDANCE, GUIDANCE_VERSION, guidanceFor } from "../utils/selfAssessQuestionGuidance.js";
import { FINDINGS, WORKSTREAMS, PHASING, ROADMAP_DEFS_VERSION } from "../data/selfAssessmentCrosswalk.js";
import { GAP_CONTEXT_SCHEMA_VERSION } from "../utils/readinessGapContextPrompt.js";
import { writeAuditLog } from "../utils/auditLog.js";
import { ENVIRONMENT_QUESTIONS, ENVIRONMENT_QUESTIONS_VERSION, normaliseEnvironment } from "../data/environmentQuestions.js";
import { CAPABILITY_LIBRARY_VERSION, getCapability } from "../data/capabilityLibrary.js";
import { AVAILABILITY, buildCapabilityAssessment } from "../utils/capabilityAssessment.js";
import { IT_DERIVED_QUESTIONS } from "../data/itCapabilityMap.js";
import { REQUIRED_DEPARTMENTS } from "../data/deptOrder.js";
export { REQUIRED_DEPARTMENTS };

const sha = (v) => createHash("sha256").update(typeof v === "string" ? v : JSON.stringify(v)).digest("hex");

// The AI cache is invalidated by any change to the inputs OR the definitions the
// AI reasons over (guidance content, prompt schema, workstream / phasing /
// finding definitions) OR the resolved model — see design spec §7.6.
function narrativeFingerprint({ submissionsFingerprint, capabilityFingerprint = null, companyProfile, providerModelId }) {
  return sha([
    submissionsFingerprint,
    capabilityFingerprint, CAPABILITY_LIBRARY_VERSION, ENVIRONMENT_QUESTIONS_VERSION,
    sha({ name: companyProfile?.name, industry: companyProfile?.industry, companySize: companyProfile?.companySize, techStack: companyProfile?.techStack ?? null }),
    GUIDANCE_VERSION, sha(GUIDANCE),
    GAP_CONTEXT_SCHEMA_VERSION,
    ROADMAP_DEFS_VERSION, sha([WORKSTREAMS, PHASING, FINDINGS]),
    providerModelId,
  ]).slice(0, 32);
}

const router = Router();

// Internal address notified when a company finishes the whole self-assessment.
const TEAM_NOTIFY_EMAIL = process.env.TEAM_NOTIFY_EMAIL || "team@prismgrc.co";

function norm(dept) {
  return String(dept || "").trim();
}

// IT and HR are mandatory: every company assesses them, and the report stays gated
// until both have submitted. Enforced here as well as in the UI, since the UI can be bypassed.
// (REQUIRED_DEPARTMENTS itself lives in data/deptOrder.js, shared with the report's department
// ordering — see selfAssessmentDocument.js's annexureE.)

/** The expected-department list with IT and HR always present (case-insensitive de-dupe). */
export function withRequiredDepartments(departments) {
  const out = [...new Set((departments || []).map(norm).filter(Boolean))];
  const have = new Set(out.map(d => d.toLowerCase()));
  const missing = REQUIRED_DEPARTMENTS.filter(req => !have.has(req.toLowerCase()));
  return [...missing, ...out];
}

// Compares the departments the admin said they'd assess (stored on the company at
// /complete time) against the departments that actually have a submission row.
// `expectedRaw` is companies.self_assessment_departments (JSON array) or null.
export function departmentStatus(expectedRaw, submittedDepartments) {
  const submitted = [...new Set((submittedDepartments || []).map(norm).filter(Boolean))];
  const expected = Array.isArray(expectedRaw)
    ? [...new Set(expectedRaw.map(norm).filter(Boolean))]
    : submitted; // no recorded expectation → whatever was submitted is "all of it"
  const submittedSet = new Set(submitted.map(d => d.toLowerCase()));
  const missing = expected.filter(d => !submittedSet.has(d.toLowerCase()));
  return { expected, submitted, missing, complete: missing.length === 0 };
}

async function loadSubmittedDepartments(companyId) {
  const r = await query(
    "SELECT DISTINCT department FROM self_assessment_submissions WHERE company_id = $1",
    [companyId]
  );
  return r.rows.map(row => row.department);
}

// POST /api/self-assessment
// Upsert one department's answers for the calling user.
router.post("/", authenticate, asyncHandler(async (req, res) => {
  const { department, answers } = req.body;
  if (!department || typeof answers !== "object" || answers === null) {
    return res.status(400).json({ error: "department and answers required" });
  }

  const companyId = req.user.companyId;
  await query(
    `INSERT INTO self_assessment_submissions (company_id, user_id, user_email, department, answers, submitted_at)
     VALUES ($1, $2, $3, $4, $5, NOW())
     ON CONFLICT (company_id, user_email, department)
     DO UPDATE SET answers = EXCLUDED.answers, submitted_at = NOW()`,
    [companyId, req.user.userId, req.user.email, department.trim(), answers]
  );

  // If the admin has already finished their part but some delegated department
  // was still outstanding, this submission may be the one that completes the set.
  try {
    const companyResult = await query(
      "SELECT name, self_assessment_departments, self_assessment_all_departments_at FROM companies WHERE id = $1",
      [companyId]
    );
    const company = mapRow(companyResult);
    if (company && company.selfAssessmentDepartments && !company.selfAssessmentAllDepartmentsAt) {
      const status = departmentStatus(company.selfAssessmentDepartments, await loadSubmittedDepartments(companyId));
      if (status.complete) {
        await query(
          "UPDATE companies SET self_assessment_all_departments_at = NOW() WHERE id = $1 AND self_assessment_all_departments_at IS NULL",
          [companyId]
        );
        sendEmail({
          to: TEAM_NOTIFY_EMAIL,
          subject: `[PRISM] All departments now submitted — ${company.name}`,
          text: `Every selected department for ${company.name} has now submitted its self-assessment (${status.expected.join(", ")}). The gap-analysis report can be generated from the superadmin dashboard.`,
          html: buildEmailHtml({
            heading: "Self-assessment fully complete",
            preheader: `${company.name} — all departments are in`,
            body: [
              `Every selected department for ${company.name} has now submitted its self-assessment.`,
              "The gap-analysis report can be generated from the superadmin dashboard.",
            ],
            details: [{ label: "Departments", value: status.expected.join(", ") }],
          }),
        }).catch(err => console.error("[self-assessment] all-departments email failed:", err.message));
      }
    }
  } catch (err) {
    console.error("[self-assessment] department-status check failed:", err.message);
  }

  res.json({ ok: true });
}));

// A submission edit (new answers or a new/changed submitter) must invalidate the
// cached AI exposure mapping; department/submittedAt alone isn't enough since the
// same department+time could carry different answers across upserts.
export function fingerprintSubmissions(submissions) {
  const canonical = submissions
    .map(s => `${s.department}|${s.userEmail}|${JSON.stringify(s.answers, Object.keys(s.answers || {}).sort())}`)
    .sort();
  return createHash("sha256").update(canonical.join("\n")).digest("hex");
}

// The company's environment answers + per-capability statuses, or null when the
// environment questionnaire hasn't been answered (the report is then questionnaire-only).
export async function loadCapabilityInput(companyId) {
  const env = mapRow(await query("SELECT answers FROM company_environment WHERE company_id = $1", [companyId]));
  const environment = env?.answers && typeof env.answers === "object" ? env.answers : {};
  if (!Object.keys(environment).length) return null;
  const rows = (await query(
    "SELECT capability_id, available, tool FROM company_capability_status WHERE company_id = $1", [companyId]
  )).rows;
  const statuses = {};
  for (const r of rows) statuses[r.capability_id] = { available: r.available, tool: r.tool || null };
  return { environment, statuses };
}

export function fingerprintCapabilityInput(input) {
  const sorted = (o) => Object.fromEntries(Object.entries(o || {}).sort(([a], [b]) => a.localeCompare(b)));
  return sha({ environment: sorted(input.environment), statuses: sorted(input.statuses) });
}

// Resolves the (possibly cached) validated AI regulatory-exposure mapping for this
// company's current submissions. Returns [] if AI is disabled/unconfigured, or if
// nothing validated against the provision index this round — callers should treat
// that as "use the static fallback reference", not as an error.
// `force` skips the fingerprint cache (superadmin "Regenerate").
async function resolveExposureMappings({ companyId, submissions, fingerprint, capabilityInput = null, force = false }) {
  if (!force) {
    const cached = await query(
      "SELECT submissions_fingerprint, mappings FROM self_assessment_reports WHERE company_id = $1",
      [companyId]
    );
    const row = mapRow(cached);
    if (row && row.submissionsFingerprint === fingerprint) {
      return row.mappings || [];
    }
  }

  const settingsResult = await query("SELECT ai_enabled, ai_provider FROM company_settings WHERE company_id = $1", [companyId]);
  const settings = mapRow(settingsResult);
  if (!settings?.aiEnabled) {
    return [];
  }

  const departments = buildDeptOpenItems(submissions, capabilityInput);
  const provider = settings?.aiProvider || await getCompanyAiProvider(companyId);
  const { mappings } = await mapRegulatoryExposure({ provider, departments });

  // Only cache a non-empty result. An empty array almost always means the AI
  // call failed or the model returned nothing usable (not "genuinely nothing
  // applies" — open gaps nearly always map to some provision), and caching
  // that would freeze the report on the static fallback until a submission
  // changes. Leaving it uncached lets the next view retry.
  if (mappings.length > 0) {
    await query(
      `INSERT INTO self_assessment_reports (company_id, submissions_fingerprint, mappings, ai_provider, generated_at)
       VALUES ($1, $2, $3, $4, NOW())
       ON CONFLICT (company_id) DO UPDATE SET
         submissions_fingerprint = EXCLUDED.submissions_fingerprint,
         mappings = EXCLUDED.mappings,
         ai_provider = EXCLUDED.ai_provider,
         generated_at = NOW()`,
      [companyId, fingerprint, JSON.stringify(mappings), provider || null]
    );
  }

  return mappings;
}

// Resolves the (possibly cached) AI layer for the Big-4 readiness report as TWO
// independently failure-isolated sub-tasks (design spec §7.5):
//   • readiness   — generateReadinessNarrative (business context, SDF factors, …)
//   • gapContext  — analyzeGapContext (per-gap tailoring, apparent contradictions,
//                   roadmap phase placement of existing remediation steps)
// The blob shape is { readiness, gapContext, fingerprint, generatedAt }. A failed
// sub-task never overwrites a previously successful one: on an unchanged
// fingerprint (i.e. `force`/refresh) the prior slot value is kept; on a changed
// fingerprint a failed slot is null (stale content must not survive an input
// change). Returns null only if the whole thing throws — buildCompanyReport
// tolerates a null narrative and every renderer has a deterministic fallback.
async function resolveNarrative({ companyId, companyProfile, submissions, fingerprint, capabilityInput = null, force = false }) {
  const settings = mapRow(await query("SELECT ai_enabled, ai_provider, technology_stack FROM company_settings WHERE company_id = $1", [companyId]));
  const provider = settings?.aiProvider || await getCompanyAiProvider(companyId);
  const profileWithStack = { ...companyProfile, techStack: settings?.technologyStack ?? null };
  const fp = narrativeFingerprint({ submissionsFingerprint: fingerprint, capabilityFingerprint: capabilityInput ? fingerprintCapabilityInput(capabilityInput) : null, companyProfile: profileWithStack, providerModelId: providerModelId(provider) });

  const prior = mapRow(await query(
    "SELECT narrative, narrative_fingerprint FROM self_assessment_reports WHERE company_id = $1", [companyId]
  ));
  const priorBlob = prior?.narrative && typeof prior.narrative === "object" ? prior.narrative : null;

  if (!force && prior?.narrativeFingerprint === fp && priorBlob) return priorBlob;
  if (!settings?.aiEnabled) {
    const blob = { readiness: null, gapContext: null, fingerprint: fp, generatedAt: new Date().toISOString() };
    await persistNarrative(companyId, fingerprint, blob);
    return blob;
  }

  // Pre-computed signal for both prompts — the model never recomputes it.
  const a = buildReadinessAssessment(submissions, capabilityInput);
  const deptSummary = a.deptRows.map(d => `  ${d.dept} (${d.type}): score ${d.selfScore ?? "n/a"}%, ${d.gaps} gaps / ${d.partials} partials`).join("\n");
  const maturitySummary = a.maturity.domains.map(d => `  ${d.label}: now ${d.assessed ? d.now : "n/a"} / target ${d.target}`).join("\n")
    + `\n  Weighted: now ${a.maturity.weightedNow} / target ${a.maturity.weightedTarget}`;
  const findingsSummary = a.findings.slice(0, 14).map(f => `  ${f.ref} [${f.rating}] ${f.domainLabel}: ${f.observation}`).join("\n");
  const firedGapIds = new Set(a.gaps.map(g => g.gapId));

  const [narrRes, gapRes] = await Promise.allSettled([
    generateReadinessNarrative({
      provider, companyName: companyProfile?.name, companyProfile,
      deptSummary, maturitySummary, findingsSummary, roleFlows: a.roleMap.map(r => r.flow),
    }),
    analyzeGapContext({
      provider, companyName: companyProfile?.name, companyProfile, techStack: profileWithStack.techStack,
      gaps: a.gaps.map(g => ({ gapId: g.gapId, worstAnswer: g.worstAnswer, rating: g.rating, guidance: g.guidance })),
      contradictionCandidates: a.contradictions,
      workstreams: WORKSTREAMS.map(w => ({ id: w.id, name: w.name })),
      ctx: {
        firedGapIds,
        remediationLen: (id) => (guidanceFor(id)?.remediation?.length ?? 0),
        submissionAnswers: submissions.flatMap(s => Object.entries(s.answers || {}).map(([questionId, answer]) => ({ questionId, department: s.department, answer }))),
      },
    }),
  ]);

  const fpUnchanged = prior?.narrativeFingerprint === fp;
  const readiness = narrRes.status === "fulfilled" && narrRes.value != null
    ? narrRes.value
    : (fpUnchanged ? (priorBlob?.readiness ?? null) : null);
  const gapContext = gapRes.status === "fulfilled" && gapRes.value != null
    ? gapRes.value
    : (fpUnchanged ? (priorBlob?.gapContext ?? null) : null);

  const blob = { readiness, gapContext, fingerprint: fp, generatedAt: new Date().toISOString() };
  await persistNarrative(companyId, fingerprint, blob);
  return blob;
}

async function persistNarrative(companyId, submissionsFingerprint, blob) {
  await query(
    `INSERT INTO self_assessment_reports (company_id, submissions_fingerprint, mappings, narrative, narrative_fingerprint, generated_at)
     VALUES ($1, $2, '[]', $3, $4, NOW())
     ON CONFLICT (company_id) DO UPDATE SET
       narrative = EXCLUDED.narrative,
       narrative_fingerprint = EXCLUDED.narrative_fingerprint`,
    [companyId, submissionsFingerprint, JSON.stringify(blob), blob.fingerprint]
  );
}

// Loads a company's submissions and builds the full structured Team Report.
// Shared by the (Admin/Lead) GET route and the superadmin report endpoint.
// Returns { company, submissions, report, deptStatus } — report is null when
// there are no submissions yet.
// `requestedByEmail` is only a last-resort fallback for the report's "Requested
// by" line — the company's own ADMIN always wins, so a superadmin-generated
// report still names the customer, not the platform account.
export async function buildCompanyReport(companyId, { requestedByEmail, refresh = false } = {}) {
  const companyResult = await query(
    "SELECT id, name, admin_email, industry, company_size, self_assessment_departments FROM companies WHERE id = $1",
    [companyId]
  );
  const company = mapRow(companyResult);
  if (!company) return null;
  const companyProfile = { name: company.name, industry: company.industry || null, companySize: company.companySize || null };

  const adminUser = mapRow(await query(
    "SELECT email FROM users WHERE company_id = $1 AND role = 'ADMIN' ORDER BY created_at LIMIT 1",
    [companyId]
  ));
  const reportRequestedBy = adminUser?.email || company.adminEmail || requestedByEmail || null;

  const result = await query(
    `SELECT s.id, s.department, s.answers, s.submitted_at,
            s.user_email,
            COALESCE(u.full_name, s.user_email) AS user_name
     FROM self_assessment_submissions s
     LEFT JOIN users u ON u.id = s.user_id
     WHERE s.company_id = $1
     ORDER BY s.department, s.submitted_at`,
    [companyId]
  );

  const submissions = result.rows.map(r => ({
    id: r.id,
    department: r.department,
    answers: r.answers,
    submittedAt: r.submitted_at,
    userEmail: r.user_email,
    userName: r.user_name,
  }));

  const deptStatus = departmentStatus(
    company.selfAssessmentDepartments,
    submissions.map(s => s.department)
  );

  let report = null;
  if (submissions.length > 0) {
    let capabilityInput = null;
    try {
      capabilityInput = await loadCapabilityInput(companyId);
    } catch (err) {
      console.error("[self-assessment/report] capability input load failed, report is questionnaire-only:", err.message);
    }
    // Capability answers now drive derived IT answers, so they are part of what the
    // cached exposure mapping was computed from.
    const submissionsFp = fingerprintSubmissions(submissions);
    const fingerprint = capabilityInput ? sha([submissionsFp, fingerprintCapabilityInput(capabilityInput)]) : submissionsFp;
    let aiExposureMappings = [];
    try {
      aiExposureMappings = await resolveExposureMappings({ companyId, submissions, fingerprint, capabilityInput, force: refresh });
    } catch (err) {
      console.error("[self-assessment/report] regulatory-exposure mapping failed, using static fallback:", err.message);
    }
    let narrative = null;
    try {
      narrative = await resolveNarrative({ companyId, companyProfile, submissions, fingerprint, capabilityInput, force: refresh });
    } catch (err) {
      console.error("[self-assessment/report] readiness narrative failed, using templated fallback:", err.message);
    }
    report = buildSelfAssessmentReport({
      companyName: company.name,
      companyProfile,
      submissions,
      requestedByEmail: reportRequestedBy,
      aiExposureMappings,
      narrative,
      capabilityInput,
    });
  }

  return { company, submissions, report, deptStatus };
}

// GET /api/self-assessment
// Returns the company's own submissions — Admin/Lead only. The rendered readiness
// report is superadmin-only (GET /api/superadmin/companies/:id/self-assessment)
// and is not built here (it is expensive and has no in-app consumer for this role).
router.get("/", authenticate, requireRole(["ADMIN", "LEAD"]), asyncHandler(async (req, res) => {
  const rows = (await query(
    `SELECT s.id, s.department, s.answers, s.submitted_at, s.user_email,
            COALESCE(u.full_name, s.user_email) AS user_name
     FROM self_assessment_submissions s LEFT JOIN users u ON u.id = s.user_id
     WHERE s.company_id = $1 ORDER BY s.department, s.submitted_at`,
    [req.user.companyId]
  )).rows;
  res.json({
    submissions: rows.map(r => ({
      id: r.id, department: r.department, answers: r.answers,
      submittedAt: r.submitted_at, userEmail: r.user_email, userName: r.user_name,
    })),
  });
}));

// ─── Environment-first capability assessment ────────────────────────────────
// 1. GET/PUT /environment   — the ~25 environment questions and the company's answers.
// 2. GET/PUT /capabilities  — PRISM's Mandatory / Recommended / N-A decision per
//                             capability, and the company's Available? + tool answers.
// 3. POST /capabilities/actions — turn the open capability gaps into tracker actions.
// Everything here is self-reported; see utils/capabilityAssessment.js.
// Reading and answering the environment + capability cards is part of the IT section, which
// may be delegated to a CONTRIBUTOR — so these need authentication only (like POST /), not
// ADMIN/LEAD. Creating tracker actions stays ADMIN/LEAD.
const capabilityAccess = [authenticate];
const capabilityAdminAccess = [authenticate, requireRole(["ADMIN", "LEAD"])];

router.get("/environment", ...capabilityAccess, asyncHandler(async (req, res) => {
  const row = mapRow(await query("SELECT answers, updated_at FROM company_environment WHERE company_id = $1", [req.user.companyId]));
  res.json({ questions: ENVIRONMENT_QUESTIONS, answers: row?.answers || {}, updatedAt: row?.updatedAt || null });
}));

router.put("/environment", ...capabilityAccess, asyncHandler(async (req, res) => {
  const parsed = normaliseEnvironment(req.body?.answers);
  if (!parsed.ok) return res.status(400).json({ error: parsed.error });
  await query(
    `INSERT INTO company_environment (company_id, answers, updated_by, updated_at)
     VALUES ($1, $2, $3, NOW())
     ON CONFLICT (company_id) DO UPDATE SET answers = EXCLUDED.answers, updated_by = EXCLUDED.updated_by, updated_at = NOW()`,
    [req.user.companyId, JSON.stringify(parsed.value), req.user.email]
  );
  res.json({ ok: true, answers: parsed.value });
}));

router.get("/capabilities", ...capabilityAccess, asyncHandler(async (req, res) => {
  const input = await loadCapabilityInput(req.user.companyId);
  if (!input) return res.json({ hasEnvironment: false, classification: null, capabilities: [], summary: null });
  const a = buildCapabilityAssessment(input);
  const covers = {};
  for (const q of IT_DERIVED_QUESTIONS) (covers[q.capabilityId] ||= []).push(q.text);
  res.json({
    hasEnvironment: true,
    classification: a.classification,
    // Not-applicable capabilities are returned too (level "na") so the UI can show what PRISM ruled out and why.
    capabilities: a.applicability.map(c => ({
      id: c.id, name: c.name, area: c.area, what: c.what, level: c.level, reason: c.reason,
      suggestedTools: c.suggestedTools,
      available: input.statuses[c.id]?.available || null,
      tool: input.statuses[c.id]?.tool || null,
      covers: covers[c.id] || [],
    })),
    summary: a.summary,
    gaps: a.gaps.map(g => ({ id: g.gapId, name: g.capability.name, rating: g.rating, gapType: g.capability.gapType, newToolRequired: g.capability.newToolRequired, note: g.capability.note })),
  });
}));

router.put("/capabilities", ...capabilityAccess, asyncHandler(async (req, res) => {
  const statuses = req.body?.statuses;
  if (!Array.isArray(statuses)) return res.status(400).json({ error: "statuses must be an array" });
  for (const st of statuses) {
    if (!getCapability(st?.capabilityId)) return res.status(400).json({ error: `Unknown capability: ${st?.capabilityId}` });
    if (!AVAILABILITY.includes(st?.available)) return res.status(400).json({ error: `${st.capabilityId}: available must be one of ${AVAILABILITY.join(", ")}` });
  }
  for (const st of statuses) {
    const tool = typeof st.tool === "string" ? st.tool.trim().slice(0, 200) : "";
    await query(
      `INSERT INTO company_capability_status (company_id, capability_id, available, tool, source, updated_by, updated_at)
       VALUES ($1, $2, $3, $4, 'self', $5, NOW())
       ON CONFLICT (company_id, capability_id) DO UPDATE SET
         available = EXCLUDED.available, tool = EXCLUDED.tool, updated_by = EXCLUDED.updated_by, updated_at = NOW()`,
      [req.user.companyId, st.capabilityId, st.available, st.available === "NO" ? null : (tool || null), req.user.email]
    );
  }
  res.json({ ok: true, saved: statuses.length });
}));

// Creates one tracker action per open capability gap. Idempotent: an action whose
// action_id is CAP-<capabilityId> is never created twice for a company.
router.post("/capabilities/actions", ...capabilityAdminAccess, asyncHandler(async (req, res) => {
  const input = await loadCapabilityInput(req.user.companyId);
  if (!input) return res.status(409).json({ error: "Answer the environment questions first" });
  const gaps = buildCapabilityAssessment(input).gaps;
  const existing = new Set((await query(
    "SELECT action_id FROM actions WHERE company_id = $1 AND action_id LIKE 'CAP-%'", [req.user.companyId]
  )).rows.map(r => r.action_id));

  const created = [];
  for (const g of gaps) {
    const actionId = `CAP-${g.gapId}`;
    if (existing.has(actionId)) continue;
    const notes = [
      `${g.capability.gapType} — ${g.capability.level === "mandatory" ? "mandatory" : "recommended"} for this environment (${g.rating} risk).`,
      g.capability.note,
      "Steps:", ...g.guidance.remediation.map((r, i) => `${i + 1}. ${r.step} (${r.effort})`),
    ].join("\n");
    const r = await query(
      `INSERT INTO actions (action_id, company_id, defeated_quest, status, notes)
       VALUES ($1, $2, $3, 'OPEN', $4) RETURNING id`,
      [actionId, req.user.companyId, `${g.capability.name} — ${g.capability.gapType}`, notes]
    );
    created.push({ actionId, id: r.rows[0].id, capabilityId: g.gapId });
  }
  if (created.length) {
    await writeAuditLog({ userId: req.user.userId, companyId: req.user.companyId, action: "CAPABILITY_GAPS_TO_ACTIONS", resource: "actions", detail: { count: created.length } });
  }
  res.status(201).json({ created, skipped: gaps.length - created.length });
}));

// POST /api/self-assessment/complete
// Called once the admin has submitted every department they answer themselves.
// Records the full expected department set, emails a thank-you to the user, and —
// the first time — notifies the internal team and stamps
// companies.self_assessment_completed_at (and self_assessment_all_departments_at
// too, if nothing is still delegated out).
router.post("/complete", authenticate, asyncHandler(async (req, res) => {
  const companyId = req.user.companyId;
  const requestedDepartments = Array.isArray(req.body?.departments)
    ? [...new Set(req.body.departments.map(norm).filter(Boolean))]
    : [];

  const companyResult = await query(
    `SELECT id, name, admin_email, industry, company_size,
            self_assessment_completed_at, self_assessment_departments
     FROM companies WHERE id = $1`,
    [companyId]
  );
  const company = mapRow(companyResult);
  if (!company) return res.status(404).json({ error: "Company not found" });

  const submittedDepartments = await loadSubmittedDepartments(companyId);

  // Record the expected set (merge anything already submitted, so a department a
  // collaborator answered before the admin hit "submit" is never dropped).
  const expected = withRequiredDepartments([
    ...(Array.isArray(company.selfAssessmentDepartments) ? company.selfAssessmentDepartments.map(norm) : []),
    ...requestedDepartments,
    ...submittedDepartments.map(norm),
  ]);

  const status = departmentStatus(expected, submittedDepartments);

  await query(
    "UPDATE companies SET self_assessment_departments = $2 WHERE id = $1",
    [companyId, JSON.stringify(expected)]
  );
  if (status.complete) {
    await query(
      "UPDATE companies SET self_assessment_all_departments_at = COALESCE(self_assessment_all_departments_at, NOW()) WHERE id = $1",
      [companyId]
    );
  }

  const pendingLine = status.missing.length
    ? `We're still waiting on responses for: ${status.missing.join(", ")}. Your report will be prepared once every department is in.`
    : "";

  // Thank-you to the person who just finished — every time.
  sendEmail({
    to: req.user.email,
    subject: "Thanks for completing the PRISM self-assessment",
    text: `Hi,\n\nThanks for completing the PRISM self-assessment for ${company.name}. Our team is now reviewing your responses and preparing your gap-analysis report — we'll be in touch soon.${pendingLine ? `\n\n${pendingLine}` : ""}\n\n— PRISM`,
    html: buildEmailHtml({
      heading: "Thanks — we've got your responses",
      preheader: "Our team is preparing your gap-analysis report",
      body: [
        `Thanks for completing the PRISM self-assessment for ${company.name}.`,
        pendingLine || "Our team is now reviewing your responses and preparing your gap-analysis report. We'll contact you soon with the results and next steps.",
      ],
      note: "You don't need to do anything else right now.",
    }),
  }).catch(err => console.error("[self-assessment/complete] thank-you email failed:", err.message));

  const firstCompletion = !company.selfAssessmentCompletedAt;
  if (firstCompletion) {
    await query("UPDATE companies SET self_assessment_completed_at = NOW() WHERE id = $1 AND self_assessment_completed_at IS NULL", [companyId]);

    let scoreLine = "";
    try {
      const data = await buildCompanyReport(companyId, { requestedByEmail: req.user.email });
      if (data?.report) {
        scoreLine = `Overall self-assessed score: ${data.report.overallScore ?? "—"}% (${data.report.overallBand}).`;
      }
    } catch (err) {
      console.error("[self-assessment/complete] report warm-up failed:", err.message);
    }

    const details = [
      { label: "Company", value: company.name || "—" },
      { label: "Admin email", value: company.adminEmail || "—" },
      { label: "Industry", value: company.industry || "—" },
      { label: "Company size", value: company.companySize || "—" },
      { label: "Departments selected", value: expected.join(", ") || "—" },
      { label: "Submitted", value: status.submitted.join(", ") || "—" },
      { label: "Still pending", value: status.missing.join(", ") || "None — all in" },
    ];

    sendEmail({
      to: TEAM_NOTIFY_EMAIL,
      subject: `[PRISM] New company completed the self-assessment — ${company.name}`,
      text:
        `${company.name} has completed the PRISM self-assessment.\n\n` +
        details.map(d => `${d.label}: ${d.value}`).join("\n") +
        (scoreLine ? `\n\n${scoreLine}` : "") +
        (status.complete
          ? `\n\nAll departments are in — generate the gap-analysis report from the superadmin dashboard.`
          : `\n\nWaiting on ${status.missing.length} department(s) before the report can be generated.`),
      html: buildEmailHtml({
        heading: "New self-assessment completed",
        preheader: `${company.name} finished the PRISM self-assessment`,
        body: [
          `${company.name} has completed the PRISM self-assessment.`,
          scoreLine || (status.complete
            ? "All departments are in — the gap-analysis report can be generated from the superadmin dashboard."
            : `Waiting on ${status.missing.length} department(s) before the report can be generated.`),
        ],
        details,
      }),
    }).catch(err => console.error("[self-assessment/complete] team notification failed:", err.message));
  }

  res.json({ ok: true, firstCompletion, departmentStatus: status });
}));

export default router;
