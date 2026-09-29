// Deterministic engine for the environment-first capability assessment. Pure
// functions over the environment answers + the static capability library. NO AI,
// no DB, no I/O — cheap to unit-test and reproducible run-to-run.
//
//   environment answers ──► classifyEnvironment / deriveApplicability
//   capability statuses ──► deriveCapabilityGaps  (same shape as readinessAssessment.computeGaps)
//
// A capability gap is emitted in the SAME gap shape as a questionnaire gap so
// computeFindings, maturity, exposure framing and the roadmap consume it without a
// parallel pipeline (see readinessAssessment.buildReadinessAssessment).

import { CAPABILITIES, ECOSYSTEM_LABEL, capabilityGuidanceFor, getCapability } from "../data/capabilityLibrary.js";
import { riskRating, riskPriority } from "../data/dpdpaMethodology.js";
import { IT_DERIVED_QUESTIONS } from "../data/itCapabilityMap.js";

export const AVAILABILITY = ["YES", "PARTIAL", "NO", "UNKNOWN"];
const LEVEL_RANK = { na: 0, recommended: 1, mandatory: 2 };

// ─── environment ────────────────────────────────────────────────────────────
function clauseMatches(env, clause) {
  const v = env?.[clause.key];
  if (clause.hasAny) return Array.isArray(v) && v.some(x => clause.hasAny.includes(x));
  return v === clause.is;
}

/**
 * Classify the estate. Ecosystem drives which suggested tools are listed first.
 * @returns {{ ecosystem: "microsoft"|"aws"|"gcp"|"mixed"|"onprem"|"other", ecosystemLabel: string,
 *   tags: string[], label: string, rationale: string[] }}
 */
export function classifyEnvironment(env = {}) {
  const p = new Set(Array.isArray(env.platforms) ? env.platforms : []);
  const ms = p.has("m365") || p.has("azure");
  const aws = p.has("aws");
  const gcp = p.has("gcp");
  const otherCloud = p.has("other_cloud");
  const onprem = p.has("onprem") || p.has("hybrid");
  const clouds = [ms, aws, gcp, otherCloud].filter(Boolean).length;

  let ecosystem;
  if (clouds >= 2) ecosystem = "mixed";
  else if (ms) ecosystem = "microsoft";
  else if (aws) ecosystem = "aws";
  else if (gcp) ecosystem = "gcp";
  else if (onprem) ecosystem = "onprem";
  else ecosystem = "other";

  const label0 = {
    microsoft: "Microsoft-led", aws: "AWS-led", gcp: "Google-led", mixed: "Multi-platform (best-of-breed / mixed)",
    onprem: "On-premises / hybrid", other: "Platform not stated",
  }[ecosystem];

  const tags = [];
  const rationale = [];
  if (ecosystem === "microsoft") rationale.push("Microsoft 365 / Azure in use — Microsoft-native tools are suggested first wherever they fit a capability, before any new product.");
  if (ecosystem === "aws") rationale.push("AWS in use — AWS-native controls are recommended before third-party tools.");
  if (ecosystem === "gcp") rationale.push("Google Cloud / Workspace in use — Google-native controls are recommended first.");
  if (ecosystem === "mixed") rationale.push("More than one cloud platform in use — a vendor-neutral control layer avoids duplicated tooling per cloud.");
  if (onprem && ecosystem !== "onprem") rationale.push("On-premises or hybrid estate alongside cloud — controls must cover both.");
  if (env.legacyApps === "YES" || env.eolSystems === "YES") {
    tags.push("legacy-heavy");
    rationale.push("Legacy or end-of-life systems process personal data — compensating controls are required where native controls are not possible.");
  }
  if (env.publicWeb === "YES" || env.apis === "YES" || env.externalLogins === "YES") tags.push("externally exposed");
  if (env.customApps === "YES") tags.push("builds software");

  // The platform families the user actually selected. Suggested tools come from
  // these (native first) and never from a platform they don't use.
  const families = [ms && "microsoft", aws && "aws", gcp && "gcp"].filter(Boolean);

  return {
    ecosystem,
    families,
    ecosystemLabel: ECOSYSTEM_LABEL[ecosystem === "microsoft" || ecosystem === "aws" || ecosystem === "gcp" ? ecosystem : "other"],
    tags,
    label: tags.includes("legacy-heavy") ? `${label0}, legacy-heavy` : label0,
    rationale,
  };
}

/**
 * Suggested tools: the native tools of each platform family the user selected
 * (max two per family, so no single vendor floods the card), then vendor-neutral.
 * Vendors for platforms the user did not select are never listed.
 * @param {object} capability
 * @param {string[]} families e.g. ["microsoft", "aws"]
 */
export function suggestedTools(capability, families = []) {
  const seen = new Set();
  const out = [];
  const add = (list, native) => {
    for (const t of list) if (!seen.has(t)) { seen.add(t); out.push({ tool: t, native }); }
  };
  for (const f of families) add((capability.tools?.[f] || []).slice(0, 2), true);
  add(capability.tools?.other || [], false);
  return out;
}

/**
 * Decide Mandatory / Recommended / Not-applicable for every capability.
 * @returns {Array<{ id, name, area, what, level, reason, suggestedTools }>}
 */
export function deriveApplicability(env = {}) {
  const { families } = classifyEnvironment(env);
  return CAPABILITIES.map(c => {
    let level = "na";
    let reason = "Not triggered by the environment described.";
    for (const rule of c.rules) {
      if (!rule.when.every(cl => clauseMatches(env, cl))) continue;
      if (LEVEL_RANK[rule.level] > LEVEL_RANK[level]) { level = rule.level; reason = rule.reason; }
    }
    return {
      id: c.id, name: c.name, area: c.area, what: c.what, level, reason,
      suggestedTools: suggestedTools(c, families),
    };
  });
}

// ─── gaps ───────────────────────────────────────────────────────────────────
const GAP_TYPE = { NO: "Missing capability", PARTIAL: "Partial coverage", UNKNOWN: "Status unknown — unverified" };

/**
 * A native-ecosystem tool the user already named means a PARTIAL gap is closed by
 * extending it, not by buying something new.
 */
function isNativeTool(tool, capability, families) {
  if (!tool || !families?.length) return false;
  const t = String(tool).toLowerCase();
  const native = families.flatMap(f => capability.tools?.[f] || []).map(x => x.toLowerCase());
  return native.some(n => n.includes(t) || t.split(/[\s,/+]+/).some(w => w.length > 3 && n.includes(w)));
}

/**
 * @param {object} env environment answers
 * @param {Record<string, {available: string, tool?: string}>} statuses keyed by capability id
 * @returns gaps in the readinessAssessment.computeGaps shape, plus a `capability` block
 */
export function deriveCapabilityGaps(env = {}, statuses = {}) {
  const { families } = classifyEnvironment(env);
  const gaps = [];
  for (const a of deriveApplicability(env)) {
    if (a.level === "na") continue;
    const status = statuses[a.id];
    if (!status || !AVAILABILITY.includes(status.available) || status.available === "YES") continue;

    const cap = getCapability(a.id);
    const guidance = capabilityGuidanceFor(a.id);
    const answer = status.available;
    // NO on a mandatory capability keeps full likelihood. PARTIAL / UNKNOWN, and a
    // merely-recommended capability, each reduce it by one (never below 1).
    let likelihood = guidance.likelihood;
    if (answer !== "NO") likelihood -= 1;
    if (a.level === "recommended") likelihood -= 1;
    likelihood = Math.max(1, likelihood);
    const impact = guidance.impact;
    const score = impact * likelihood;
    const rb = riskRating(score);

    const nativeInUse = answer === "PARTIAL" && isNativeTool(status.tool, cap, families);
    const newToolRequired = answer === "NO" ? true : answer === "PARTIAL" ? !nativeInUse : false;
    const tools = suggestedTools(cap, families);
    const note = answer === "NO"
      ? `Deploy this capability. ${tools[0] ? `Suggested first: ${tools[0].tool}${tools[0].native ? " (native to your environment)" : ""}.` : ""}`
      : answer === "PARTIAL"
        ? (nativeInUse
          ? `Extend ${status.tool} to the uncovered scope — no new tool is required.`
          : `Extend coverage of ${status.tool || "the existing tool"} to the uncovered scope; confirm it can before considering a new product.`)
        : "Confirm whether the capability exists and evidence it; treat as missing until shown.";

    gaps.push({
      gapId: a.id,
      questionId: a.id,
      worstAnswer: answer === "NO" ? "NO" : "PARTIAL", // renderers speak NO / PARTIAL; the true answer is on `capability`
      departments: [{ dept: "Environment", answer }],
      guidance,
      domain: guidance.domain,
      impact, likelihood, score,
      rating: rb.rating, ratingColor: rb.color, priority: riskPriority(rb.rating),
      capability: {
        id: a.id, name: a.name, area: a.area, level: a.level, reason: a.reason,
        available: answer, gapType: GAP_TYPE[answer], tool: status.tool || null,
        newToolRequired, note, suggestedTools: tools,
      },
    });
  }
  return gaps;
}

// ─── roll-ups ───────────────────────────────────────────────────────────────
/**
 * Everything the report and the UI need in one call.
 * @param {{ environment?: object, statuses?: Record<string,{available:string,tool?:string}> }} input
 */
export function buildCapabilityAssessment(input = {}) {
  const env = input.environment || {};
  const statuses = input.statuses || {};
  const classification = classifyEnvironment(env);
  const applicability = deriveApplicability(env);
  const gaps = deriveCapabilityGaps(env, statuses);

  const applicable = applicability.filter(a => a.level !== "na");
  const rows = applicable.map(a => {
    const st = statuses[a.id];
    return { ...a, available: st?.available || null, tool: st?.tool || null };
  });
  const answered = rows.filter(r => r.available);
  const counts = { YES: 0, PARTIAL: 0, NO: 0, UNKNOWN: 0, unanswered: rows.length - answered.length };
  for (const r of answered) counts[r.available]++;
  const mandatory = rows.filter(r => r.level === "mandatory");
  const mAnswered = mandatory.filter(r => r.available);
  const mScore = mAnswered.reduce((a, r) => a + (r.available === "YES" ? 1 : r.available === "PARTIAL" ? 0.5 : 0), 0);
  const coveragePct = mAnswered.length ? Math.round((mScore / mAnswered.length) * 100) : null;

  return {
    environment: env,
    classification,
    applicability,
    rows,
    gaps,
    summary: {
      applicable: applicable.length,
      mandatory: mandatory.length,
      recommended: applicable.length - mandatory.length,
      notApplicable: applicability.length - applicable.length,
      counts,
      coveragePct,
      newToolGaps: gaps.filter(g => g.capability.newToolRequired).length,
      nativeExtendGaps: gaps.filter(g => !g.capability.newToolRequired).length,
    },
  };
}

const MAPPED_CAPABILITY_IDS = new Set(IT_DERIVED_QUESTIONS.map(q => q.capabilityId));

/**
 * Contribution of capability answers to maturity domains: { [domainId]: [{ qid, val, answer }] }.
 * Capabilities that feed a derived IT answer are EXCLUDED — that answer already
 * counts toward the same domain through its own guidance, so counting the card
 * too would double-count it.
 */
export function capabilityMaturityContributions(env = {}, statuses = {}) {
  const out = {};
  for (const a of deriveApplicability(env)) {
    if (a.level === "na" || MAPPED_CAPABILITY_IDS.has(a.id)) continue;
    const st = statuses[a.id];
    if (!st || !["YES", "PARTIAL", "NO"].includes(st.available)) continue; // UNKNOWN is not evidence either way
    const domain = getCapability(a.id)?.guidance.domain;
    if (!domain) continue;
    (out[domain] ||= []).push({ qid: a.id, val: st.available === "YES" ? 2 : st.available === "PARTIAL" ? 1 : 0, answer: st.available });
  }
  return out;
}

// ─── deriving IT answers from capability cards ───────────────────────────────
/**
 * The IT answers implied by the capability cards: card YES/PARTIAL/NO → the same
 * answer for every IT question it covers; card not applicable to the environment
 * → NA; UNKNOWN or unanswered → no answer (not assessed).
 * @returns {Record<string, "YES"|"PARTIAL"|"NO"|"NA">}
 */
export function deriveITAnswers(env = {}, statuses = {}) {
  const level = new Map(deriveApplicability(env).map(a => [a.id, a.level]));
  const out = {};
  for (const q of IT_DERIVED_QUESTIONS) {
    const lv = level.get(q.capabilityId);
    if (!lv) continue;
    if (lv === "na") { out[q.id] = "NA"; continue; }
    const a = statuses[q.capabilityId]?.available;
    if (a === "YES" || a === "PARTIAL" || a === "NO") out[q.id] = a;
  }
  return out;
}

/**
 * Merge the derived IT answers into the IT submission so every downstream
 * consumer (score, traceability, contradictions, role map, tracker seeding, AI
 * mapping) sees the same it-* ids it always did. Idempotent. The derived ids are
 * returned so the gap engine can skip them — the capability card raises the (richer,
 * environment-aware) gap instead, so nothing is counted twice.
 *
 * With no environment answers this is a no-op and `derivedIds` is empty.
 * @param {Array<{department:string, answers:object}>} submissions
 * @param {{environment?:object, statuses?:object}|null} capabilityInput
 * @returns {{ submissions: Array, derivedIds: Set<string> }}
 */
export function applyCapabilityDerivation(submissions, capabilityInput) {
  const env = capabilityInput?.environment;
  if (!env || !Object.keys(env).length) return { submissions, derivedIds: new Set() };
  const derived = deriveITAnswers(env, capabilityInput.statuses || {});
  const ids = Object.keys(derived);
  if (!ids.length) return { submissions, derivedIds: new Set() };

  const idx = submissions.findIndex(s => String(s.department).trim().toLowerCase() === "it");
  let out;
  if (idx >= 0) {
    out = submissions.map((s, i) => (i === idx ? { ...s, answers: { ...(s.answers || {}), ...derived } } : s));
  } else {
    // IT is mandatory, so this is a safety net for legacy data only.
    out = [...submissions, { department: "IT", userEmail: null, userName: "Capability answers", answers: derived, submittedAt: null, synthetic: true }];
  }
  return { submissions: out, derivedIds: new Set(ids) };
}
