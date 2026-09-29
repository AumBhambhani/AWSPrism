// Prompt + normaliser for the AI "gap context" layer of the DPDPA readiness
// report (design spec §7). Shared by the Bedrock and Azure providers so the
// wording cannot drift.
//
// The AI may ONLY: (1) add one optional context sentence per fired gap,
// (2) flag apparent cross-department contradictions (explanatory, "verify"),
// (3) assign EXISTING remediation-step references to Phase 0–3, (4) give a
// phasing rationale. It may not create/rewrite/delete/merge/modify remediation
// steps, effort values, findings, scores, ratings, impact, likelihood,
// regulatory mappings, domains, or workstream membership.

// Bump on any change to the prompt or the output schema — feeds the AI cache
// fingerprint (routes/selfAssessment.js).
export const GAP_CONTEXT_SCHEMA_VERSION = "1";

const TAILORING_MAX = 320;
const TENSION_MAX = 400;
const RATIONALE_MAX = 300;
const MAX_CONTRADICTIONS = 8;
const UNPLACED_DEFAULT_PHASE = 2;

const clip = (s, n) => (typeof s === "string" ? s.trim().replace(/\s+/g, " ").slice(0, n) : "");

/**
 * @param {{
 *   companyName: string,
 *   companyProfile?: { industry?: string, companySize?: string },
 *   techStack?: unknown,
 *   gaps: Array<{ gapId: string, worstAnswer: string, rating: string,
 *     guidance: { whyItMatters: string, remediation: {step:string,effort:string}[] } }>,
 *   contradictionCandidates?: Array<{ id: string, tension: string, departments: string[] }>,
 *   workstreams?: Array<{ id: string, name: string }>,
 * }} args
 * @returns {string}
 */
export function buildGapContextPrompt(args) {
  const { companyName, companyProfile = {}, techStack, gaps = [], contradictionCandidates = [], workstreams = [] } = args;

  const gapBlock = gaps.map(g => {
    const steps = (g.guidance?.remediation || [])
      .map((r, i) => `      [${i}] (${r.effort}) ${r.step}`)
      .join("\n");
    return `  gapId: ${g.gapId}  (${g.worstAnswer}, ${g.rating})\n    why it matters: ${g.guidance?.whyItMatters || ""}\n    remediation steps:\n${steps}`;
  }).join("\n\n") || "  (no open gaps)";

  const contradictionBlock = contradictionCandidates.length
    ? contradictionCandidates.map(c => `  - ${c.id}: ${c.tension} (departments: ${(c.departments || []).join(", ")})`).join("\n")
    : "  (none detected deterministically)";

  const wsBlock = workstreams.map(w => `  ${w.id} — ${w.name}`).join("\n") || "  (none)";

  const techStackStr = techStack
    ? (typeof techStack === "string" ? techStack : JSON.stringify(techStack))
    : "not stated";

  return `You are a privacy consultant adding CONTEXT to a DPDP Act, 2023 (India) readiness report for "${companyName}".

COMPANY (management representation, unverified):
  industry: ${companyProfile.industry || "not stated"}
  size: ${companyProfile.companySize || "not stated"}
  technology stack: ${techStackStr}

OPEN GAPS (already assessed — do NOT re-rate, re-word, or invent):
${gapBlock}

DETERMINISTIC CONTRADICTION CANDIDATES (already found — you may ADD to this, not replace it):
${contradictionBlock}

WORKSTREAMS (fixed — phasing groups steps under these):
${wsBlock}

YOUR OUTPUT — respond with ONLY valid JSON, no markdown fences, exactly this shape:
{
  "tailoring": [
    { "gapId": "<one of the gapIds above>", "sentence": "ONE sentence connecting this gap to the company's stack / industry / size. Context only — never a compliance verdict, never a rating." }
  ],
  "contradictions": [
    {
      "sourceRefs": [ { "questionId": "<a real question id>", "department": "<a real department name>", "answer": "YES|NO|PARTIAL|NA" } ],
      "departments": [ "<department>" ],
      "tension": "One or two sentences describing an APPARENT tension between departments' answers. Explanatory only — say 'appears' / 'apparent'. Never call it a finding or a breach."
    }
  ],
  "roadmapPhasing": [
    { "phase": 0, "rationale": "why these steps come first", "stepRefs": [ { "gapId": "<gapId>", "stepIndex": <integer index into that gap's remediation list> } ] },
    { "phase": 1, "rationale": "...", "stepRefs": [ ... ] },
    { "phase": 2, "rationale": "...", "stepRefs": [ ... ] },
    { "phase": 3, "rationale": "...", "stepRefs": [ ... ] }
  ]
}

RULES:
- tailoring: at most one entry per gapId. Skip a gap rather than pad.
- contradictions: only reference question ids, departments and answers that actually appear in the submissions. Do not invent any.
- roadmapPhasing: use ONLY (gapId, stepIndex) pairs that exist above. Phase 0 = 0–30 days (mobilise / unblock), Phase 1 = 30–90 days (foundations), Phase 2 = 90–180 days (build), Phase 3 = 180–365 days (operate & assure). Sequence by dependency and effort. Governance and data-inventory steps generally come first.`;
}

/**
 * @param {unknown} parsed  the model's parsed JSON (or null)
 * @param {{
 *   firedGapIds: Set<string>,
 *   remediationLen: (gapId: string) => number,
 *   submissionAnswers: Array<{ questionId: string, department: string, answer: string }>,
 * }} ctx
 * @returns {{ tailoring: {gapId,sentence}[], contradictions: object[],
 *   roadmapPhasing: {phase:number, rationale:string, stepRefs:{gapId,stepIndex}[]}[] } | null}
 */
export function normaliseGapContext(parsed, ctx) {
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return null;
  const { firedGapIds, remediationLen, submissionAnswers } = ctx;
  const answerKey = new Set((submissionAnswers || []).map(a => `${a.questionId}|${a.department}|${a.answer}`));

  // ── tailoring: one entry per fired gap, first valid wins ──
  const tailoringSeen = new Set();
  const tailoring = [];
  for (const t of Array.isArray(parsed.tailoring) ? parsed.tailoring : []) {
    const gapId = typeof t?.gapId === "string" ? t.gapId : null;
    if (!gapId || !firedGapIds.has(gapId) || tailoringSeen.has(gapId)) continue;
    const sentence = clip(t.sentence, TAILORING_MAX);
    if (!sentence) continue;
    tailoringSeen.add(gapId);
    tailoring.push({ gapId, sentence });
  }

  // ── contradictions: every sourceRef must match a real submitted answer ──
  const contradictions = [];
  for (const c of Array.isArray(parsed.contradictions) ? parsed.contradictions : []) {
    const refsIn = Array.isArray(c?.sourceRefs) ? c.sourceRefs : [];
    if (!refsIn.length) continue;
    const sourceRefs = [];
    let ok = true;
    for (const r of refsIn) {
      const questionId = typeof r?.questionId === "string" ? r.questionId : "";
      const department = typeof r?.department === "string" ? r.department : "";
      const answer = typeof r?.answer === "string" ? r.answer : "";
      if (!answerKey.has(`${questionId}|${department}|${answer}`)) { ok = false; break; }
      sourceRefs.push({ questionId, department, answer });
    }
    if (!ok) continue;
    const tension = clip(c.tension, TENSION_MAX);
    if (!tension) continue;
    const departments = [...new Set(sourceRefs.map(r => r.department))];
    const relatedGapIds = [...new Set(sourceRefs.map(r => r.questionId).filter(id => firedGapIds.has(id)))];
    contradictions.push({ source: "ai", sourceRefs, departments, relatedGapIds, tension });
    if (contradictions.length >= MAX_CONTRADICTIONS) break;
  }

  // ── roadmapPhasing: validate step refs, earliest phase wins, unplaced → Phase 2 ──
  const placement = new Map(); // "gapId|stepIndex" -> phase
  const rationales = [null, null, null, null];
  for (const bucket of Array.isArray(parsed.roadmapPhasing) ? parsed.roadmapPhasing : []) {
    const phase = Number(bucket?.phase);
    if (!Number.isInteger(phase) || phase < 0 || phase > 3) continue;
    if (rationales[phase] == null) rationales[phase] = clip(bucket.rationale, RATIONALE_MAX);
    for (const ref of Array.isArray(bucket?.stepRefs) ? bucket.stepRefs : []) {
      const gapId = typeof ref?.gapId === "string" ? ref.gapId : null;
      const stepIndex = ref?.stepIndex;
      if (!gapId || !firedGapIds.has(gapId)) continue;
      if (!Number.isInteger(stepIndex) || stepIndex < 0 || stepIndex >= remediationLen(gapId)) continue;
      const k = `${gapId}|${stepIndex}`;
      const prev = placement.get(k);
      if (prev == null || phase < prev) placement.set(k, phase);
    }
  }
  // every fired-gap remediation step that the model did not place → default phase
  for (const gapId of firedGapIds) {
    const len = remediationLen(gapId);
    for (let i = 0; i < len; i++) {
      const k = `${gapId}|${i}`;
      if (!placement.has(k)) placement.set(k, UNPLACED_DEFAULT_PHASE);
    }
  }
  const roadmapPhasing = [0, 1, 2, 3].map(phase => ({
    phase,
    rationale: rationales[phase] || "",
    stepRefs: [...placement.entries()]
      .filter(([, p]) => p === phase)
      .map(([k]) => { const [gapId, s] = k.split("|"); return { gapId, stepIndex: Number(s) }; })
      .sort((a, b) => a.gapId.localeCompare(b.gapId) || a.stepIndex - b.stepIndex),
  }));

  return { tailoring, contradictions, roadmapPhasing };
}
