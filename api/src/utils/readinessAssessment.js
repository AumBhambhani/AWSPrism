// Deterministic engine for the Big-4 DPDPA readiness report. Pure functions over
// the self-assessment submissions + static data (selfAssessQuestionGuidance.js,
// selfAssessmentCrosswalk.js, dpdpaMethodology.js). NO AI, no DB, no I/O — so it
// is cheap to unit-test and reproducible run-to-run, and the report never
// depends on the AI layer (design spec §4).
//
// Produces: gaps (the spine), the thematic findings register, maturity, the
// traceability matrix, the role map, the exposure framing, and the deterministic
// cross-department contradictions.

import {
  PRIVACY_DOMAINS, FINDINGS, CONTRADICTION_RULES, DPDPA_TRACEABILITY, DATA_FLOW_TEMPLATES,
} from "../data/selfAssessmentCrosswalk.js";
import {
  RISK_BANDS, riskRating, riskPriority, EXPOSURE_TIERS, capabilityBand,
} from "../data/dpdpaMethodology.js";
import { scoreSubmission } from "./selfAssessmentScoring.js";
import { guidanceFor } from "./selfAssessQuestionGuidance.js";
import { buildCapabilityAssessment, capabilityMaturityContributions, applyCapabilityDerivation } from "./capabilityAssessment.js";

const STANDARD_DEPTS = ["IT", "HR", "SWE", "Finance", "Legal", "Operations", "Marketing"];
const DOMAIN_LABEL = Object.fromEntries(PRIVACY_DOMAINS.map(d => [d.id, d.label]));

const norm = (s) => String(s || "").trim();
const isStandardDept = (dept) =>
  STANDARD_DEPTS.some(d => d.toLowerCase() === norm(dept).toLowerCase());
const round1 = (n) => Math.round(n * 10) / 10;

/** Map<questionId, Array<{ dept, answer }>> across every submission. */
function indexAnswers(submissions) {
  const byQ = new Map();
  for (const s of submissions) {
    for (const [qid, answer] of Object.entries(s.answers || {})) {
      if (!byQ.has(qid)) byQ.set(qid, []);
      byQ.get(qid).push({ dept: s.department, answer });
    }
  }
  return byQ;
}

/** Flat list of every submitted answer as a {questionId, department, answer} triple. */
function answerTriples(submissions) {
  const out = [];
  for (const s of submissions) {
    for (const [questionId, answer] of Object.entries(s.answers || {})) {
      out.push({ questionId, department: s.department, answer });
    }
  }
  return out;
}

// ─── gaps — one per fired NO/PARTIAL question, worst-case across departments ──
/**
 * @param {Array<{department:string, answers:Record<string,string>}>} submissions
 * @returns {Array<{ gapId, questionId, worstAnswer, departments, guidance,
 *   domain, impact, likelihood, score, rating, ratingColor, priority }>}
 *   sorted worst-first (score desc → likelihood desc → impact desc → questionId asc)
 */
export function computeGaps(submissions, skipIds = new Set()) {
  const byQ = indexAnswers(submissions);
  const gaps = [];
  for (const [questionId, entries] of byQ) {
    // Answers derived from a capability card raise their gap via the card, not here.
    if (skipIds.has(questionId)) continue;
    const firing = entries.filter(e => e.answer === "NO" || e.answer === "PARTIAL");
    if (!firing.length) continue;
    const guidance = guidanceFor(questionId);
    if (!guidance) {
      // Should not happen for a valid question id — the coverage test guards it.
      // eslint-disable-next-line no-console
      console.warn(`[readinessAssessment] no guidance for fired question "${questionId}" — gap skipped`);
      continue;
    }
    const worstAnswer = firing.some(e => e.answer === "NO") ? "NO" : "PARTIAL";
    const impact = guidance.impact;
    // A NO in ANY department keeps full likelihood; only a PARTIAL-only gap is reduced.
    const likelihood = worstAnswer === "NO" ? guidance.likelihood : Math.max(1, guidance.likelihood - 1);
    const score = impact * likelihood;
    const rb = riskRating(score);
    gaps.push({
      gapId: questionId,
      questionId,
      worstAnswer,
      departments: firing.map(e => ({ dept: e.dept, answer: e.answer })),
      guidance,
      domain: guidance.domain,
      impact,
      likelihood,
      score,
      rating: rb.rating,
      ratingColor: rb.color,
      priority: riskPriority(rb.rating),
    });
  }
  gaps.sort(compareGaps);
  return gaps;
}

/** worst-first: score desc → likelihood desc → impact desc → questionId asc */
export function compareGaps(a, b) {
  return b.score - a.score || b.likelihood - a.likelihood || b.impact - a.impact || a.questionId.localeCompare(b.questionId);
}

// ─── thematic findings register — derived from gaps by findingKey ────────────
/**
 * @param {ReturnType<typeof computeGaps>} gaps
 * @param {{ singleContributor?: boolean }} ctx
 */
export function computeFindings(gaps, ctx = {}) {
  const { singleContributor = false } = ctx;

  // 1. Group fired gaps by their guidance.findingKey.
  const byKey = new Map();
  for (const g of gaps) {
    const key = g.guidance.findingKey;
    if (!byKey.has(key)) byKey.set(key, []);
    byKey.get(key).push(g);
  }

  const raw = [];
  for (const [key, members] of byKey) {
    const meta = FINDINGS[key];
    if (!meta) {
      // eslint-disable-next-line no-console
      console.warn(`[readinessAssessment] findingKey "${key}" from guidance not in FINDINGS — skipped`);
      continue;
    }
    // The finding's (impact, likelihood, score, rating) tuple is taken WHOLE from
    // the single winning member gap — never max() of each field independently.
    const winner = [...members].sort((a, b) =>
      b.score - a.score || b.impact - a.impact || b.likelihood - a.likelihood || a.gapId.localeCompare(b.gapId))[0];
    const rb = riskRating(winner.score);
    raw.push({
      key,
      title: meta.title,
      observation: meta.aggregateObservation,
      owner: meta.owner,
      targetWindow: meta.targetWindow,
      workstream: meta.workstream,
      domain: winner.domain,
      domainLabel: DOMAIN_LABEL[winner.domain] || winner.domain,
      impact: winner.impact,
      likelihood: winner.likelihood,
      score: winner.score,
      rating: rb.rating,
      ratingColor: rb.color,
      priority: riskPriority(rb.rating),
      synthetic: null,
      // member gaps in the gaps-array (worst-first) order — never re-sorted.
      memberGapIds: gaps.filter(g => g.guidance.findingKey === key).map(g => g.gapId),
    });
  }

  // 2. Append synthetic findings (no member gap) — coverage gaps and the
  //    single-contributor caveat. Their (impact, likelihood) come from FINDINGS.
  for (const [key, meta] of Object.entries(FINDINGS)) {
    if (!meta.synthetic) continue;
    if (byKey.has(key)) continue; // a real gap already materialised it
    if (meta.synthetic === "single-contributor" && !singleContributor) continue;
    const score = meta.impact * meta.likelihood;
    const rb = riskRating(score);
    raw.push({
      key,
      title: meta.title,
      observation: meta.aggregateObservation,
      owner: meta.owner,
      targetWindow: meta.targetWindow,
      workstream: meta.workstream,
      domain: null,
      domainLabel: meta.title,
      impact: meta.impact,
      likelihood: meta.likelihood,
      score,
      rating: rb.rating,
      ratingColor: rb.color,
      priority: riskPriority(rb.rating),
      synthetic: meta.synthetic,
      memberGapIds: [],
    });
  }

  // 3. Order worst-first; number F-01…
  raw.sort((a, b) =>
    b.score - a.score || b.likelihood - a.likelihood || b.impact - a.impact || a.key.localeCompare(b.key));
  raw.forEach((f, i) => { f.ref = `F-${String(i + 1).padStart(2, "0")}`; });

  const findingCounts = { critical: 0, high: 0, medium: 0, low: 0, total: raw.length };
  for (const f of raw) findingCounts[f.rating.toLowerCase()]++;
  return { findings: raw, findingCounts };
}

// ─── cross-department contradictions (deterministic rules) ───────────────────
/**
 * @param {Array} submissions
 * @param {Set<string>} [firedGapIds] questionIds that are fired gaps (for relatedGapIds)
 * @returns {Array<{ id, source:"rule", departments:string[],
 *   sourceRefs:{questionId,department,answer}[], relatedGapIds:string[], tension }>}
 */
export function computeContradictions(submissions, firedGapIds = new Set()) {
  const byQ = indexAnswers(submissions);
  const out = [];
  for (const rule of CONTRADICTION_RULES) {
    const sourceRefs = [];
    let allMatched = true;
    for (const clause of rule.when) {
      const entries = byQ.get(clause.q) || [];
      const hit = entries.find(e => clause.answer.includes(e.answer));
      if (!hit) { allMatched = false; break; }
      sourceRefs.push({ questionId: clause.q, department: hit.dept, answer: hit.answer });
    }
    if (!allMatched) continue;
    const departments = [...new Set(sourceRefs.map(r => r.department))];
    const relatedGapIds = sourceRefs.map(r => r.questionId).filter(id => firedGapIds.has(id));
    out.push({ id: rule.id, source: "rule", departments, sourceRefs, relatedGapIds, tension: rule.tension });
  }
  return out;
}

// ─── §3 maturity ───────────────────────────────────────────────────────────
// Capability of a self-reported answer, with no evidence review: YES = 2
// ("Developing" — claimed but undocumented), PARTIAL = 1, NO = 0, NA excluded.
// A domain's now-score is the rounded mean; a domain that is all-YES with ≥4
// questions earns a 3. Nothing self-asserted reaches "Defined+" (needs an audit).
export function computeMaturity(submissions, capabilityContributions = null) {
  const byQ = indexAnswers(submissions);
  const contribByDomain = {};
  for (const [qid, entries] of byQ) {
    const domain = guidanceFor(qid)?.domain;
    if (!domain) continue;
    // worst-case value for this question across departments
    const rank = { NO: 0, PARTIAL: 1, YES: 2, NA: 3 };
    const v = entries.reduce((worst, e) => ((rank[e.answer] ?? 9) < (rank[worst] ?? 9) ? e.answer : worst), "NA");
    if (v === "NA") continue;
    const val = v === "YES" ? 2 : v === "PARTIAL" ? 1 : 0;
    (contribByDomain[domain] ||= []).push({ qid, val, answer: v });
  }

  // Capability answers (environment-first assessment) count toward the same domains.
  for (const [domain, items] of Object.entries(capabilityContributions || {})) {
    (contribByDomain[domain] ||= []).push(...items);
  }

  const domains = PRIVACY_DOMAINS.map(d => {
    const c = contribByDomain[d.id] || [];
    const assessed = c.length > 0;
    const mean = assessed ? c.reduce((a, x) => a + x.val, 0) / c.length : 0;
    const gaps = c.filter(x => x.answer === "NO").length;
    const partials = c.filter(x => x.answer === "PARTIAL").length;
    let now = assessed ? Math.round(mean) : 0;
    if (assessed && gaps === 0 && partials === 0 && c.length >= 4) now = 3;
    now = Math.max(0, Math.min(4, now));
    const basis = assessed
      ? `${c.length} question${c.length !== 1 ? "s" : ""} / capabilit${c.length !== 1 ? "ies" : "y"} answered — ${gaps} gap${gaps !== 1 ? "s" : ""}, ${partials} partial${partials !== 1 ? "s" : ""}. Self-reported, not verified.`
      : "Not addressed and not tested by the questionnaire.";
    return { id: d.id, label: d.label, weight: d.weight, target: d.target, now, gap: d.target - now, assessed, basis };
  });

  const totalWeight = domains.reduce((a, d) => a + d.weight, 0);
  const weightedNow = round1(domains.reduce((a, d) => a + d.weight * d.now, 0) / totalWeight);
  const weightedTarget = round1(domains.reduce((a, d) => a + d.weight * d.target, 0) / totalWeight);
  return {
    domains, weightedNow, weightedTarget,
    weightedNowBand: capabilityBand(weightedNow),
    weightedTargetBand: capabilityBand(weightedTarget),
  };
}

// ─── §7 traceability matrix ────────────────────────────────────────────────
const STATUS_COLOR = {
  "Compliant (subject to verification)": "#15803D",
  Partial: "#B45309",
  "Non-compliant": "#B91C1C",
  "Not Assessed": "#5A6270",
  "N/A": "#8B85A0",
};

export function computeTraceability(submissions, findings = []) {
  const byQ = indexAnswers(submissions);
  // Link a finding to a traceability row when the row's trigger questions
  // intersect the finding's member gap ids.
  const refsForTriggers = (triggers) => {
    const trg = new Set(triggers);
    return [...new Set(findings.filter(f => (f.memberGapIds || []).some(g => trg.has(g))).map(f => f.ref))];
  };

  const rows = DPDPA_TRACEABILITY.map(row => {
    const refs = refsForTriggers(row.triggers);
    if (row.naReason) {
      return { section: row.section, obligation: row.obligation, status: "N/A", statusColor: STATUS_COLOR["N/A"], basis: row.naReason, findingRefs: refs };
    }
    const answers = row.triggers.flatMap(q => (byQ.get(q) || []).map(e => e.answer));
    let status;
    if (row.alwaysNotAssessed && !answers.includes("NO")) status = "Not Assessed";
    else if (answers.includes("NO")) status = "Non-compliant";
    else if (answers.includes("PARTIAL")) status = "Partial";
    else if (answers.filter(a => a === "YES").length >= 2 || (answers.length === row.triggers.length && answers.every(a => a === "YES") && row.triggers.length >= 2)) status = "Compliant (subject to verification)";
    else if (answers.includes("YES")) status = row.triggers.length <= 1 ? "Compliant (subject to verification)" : "Not Assessed";
    else status = "Not Assessed";

    if (status === "Compliant (subject to verification)" && refs.length) status = "Partial";

    let basis;
    if (status === "Not Assessed") basis = row.notAssessedNote || "Not tested by the questionnaire — coverage gap.";
    else if (status === "Compliant (subject to verification)") basis = "Self-reported in place; not independently verified.";
    else {
      const g = answers.filter(a => a === "NO").length, pp = answers.filter(a => a === "PARTIAL").length;
      basis = `${g} gap${g !== 1 ? "s" : ""}, ${pp} partial${pp !== 1 ? "s" : ""} self-reported.`;
    }
    if (refs.length) basis += ` [${refs.join(", ")}]`;
    return { section: row.section, obligation: row.obligation, status, statusColor: STATUS_COLOR[status], basis, findingRefs: refs };
  });

  const counts = { "Compliant (subject to verification)": 0, Partial: 0, "Non-compliant": 0, "Not Assessed": 0, "N/A": 0 };
  for (const r of rows) counts[r.status]++;
  const assessable = rows.length - counts["N/A"];
  const assessed = counts["Compliant (subject to verification)"] + counts.Partial + counts["Non-compliant"];
  const coveragePct = assessable ? Math.round((assessed / assessable) * 100) : 0;
  return { rows, counts, coveragePct, assessable, assessed };
}

// ─── §8 role map ───────────────────────────────────────────────────────────
export function computeRoleMap(submissions) {
  const byQ = indexAnswers(submissions);
  return DATA_FLOW_TEMPLATES.map(f => {
    const answers = (f.statusTriggers || []).flatMap(q => (byQ.get(q) || []).map(e => e.answer));
    let status;
    if (!answers.length) status = "Not Assessed — flow not mapped";
    else if (answers.includes("NO")) status = "Non-compliant basis — self-reported gap";
    else if (answers.includes("PARTIAL")) status = "Partial — self-reported";
    else status = "In place (self-reported, not verified)";
    return {
      flow: f.flow, personalData: f.personalData, role: f.role,
      counterparty: f.counterparty, touchpoints: f.touchpoints, status,
    };
  });
}

// ─── §2.3 / §10 exposure framing ──────────────────────────────────────────
const DOMAIN_TIER = {
  security: "Security safeguards",
  breach: "Breach notification",
  children: "Children's data",
  governance: "Significant Data Fiduciary duties",
};
export function computeExposureFraming(findings = []) {
  const hits = {};
  for (const f of findings) {
    const tier = DOMAIN_TIER[f.domain] || "Any other provision (residuary)";
    (hits[tier] ||= new Set()).add(f.ref);
  }
  return EXPOSURE_TIERS.map(t => ({ ...t, hitByFindings: [...(hits[t.tier] || [])].sort() }));
}

// ─── per-department questionnaire completeness ─────────────────────────────
export function computeDeptCompleteness(submissions) {
  const byDept = {};
  for (const s of submissions) (byDept[s.department] ||= []).push(s);

  return Object.entries(byDept).map(([dept, subs]) => {
    const answeredIds = new Set();
    let gaps = 0, partials = 0;
    for (const s of subs) for (const id of Object.keys(s.answers || {})) answeredIds.add(id);
    for (const id of answeredIds) {
      const vals = subs.map(s => s.answers?.[id]).filter(Boolean);
      if (vals.includes("NO")) gaps++;
      else if (vals.includes("PARTIAL")) partials++;
    }
    const scores = subs.map(s => scoreSubmission(s.answers)).filter(v => v !== null);
    const selfScore = scores.length ? Math.round(scores.reduce((a, b) => a + b, 0) / scores.length) : null;
    const respondents = [...new Set(subs.map(s => s.userEmail).filter(Boolean))];
    return {
      dept,
      type: isStandardDept(dept) ? "Standard" : "Custom",
      answered: answeredIds.size,
      contributors: subs.length,
      gaps, partials, selfScore,
      completeness: 100,
      respondent: respondents.join(", "),
    };
  }).sort((a, b) => (a.selfScore ?? 101) - (b.selfScore ?? 101));
}

// ─── top-level ─────────────────────────────────────────────────────────────
/**
 * @param {Array} submissions department self-assessment submissions
 * @param {{ environment?: object, statuses?: object }|null} [capabilityInput]
 *   environment answers + capability statuses. When present, capability gaps join the
 *   questionnaire gaps and flow through findings / maturity / roadmap unchanged; when
 *   absent (null) the assessment is byte-identical to the questionnaire-only one.
 */
export function buildReadinessAssessment(rawSubmissions, capabilityInput = null) {
  // IT answers implied by the capability cards are merged in first (idempotent).
  const { submissions, derivedIds } = applyCapabilityDerivation(rawSubmissions, capabilityInput);
  const byQ = indexAnswers(submissions);
  const deptRows = computeDeptCompleteness(submissions);
  const customCount = deptRows.filter(d => d.type === "Custom").length;
  const singleContributor = deptRows.every(d => d.contributors === 1);
  const uniqueRespondents = new Set(submissions.map(s => s.userEmail).filter(Boolean)).size;

  const hasDpo = ["lg-6", "it-35"].some(q => (byQ.get(q) || []).some(e => e.answer === "YES"))
    && !["lg-6", "it-35"].some(q => (byQ.get(q) || []).some(e => e.answer === "NO"));

  const hasCapability = !!(capabilityInput && Object.keys(capabilityInput.environment || {}).length);
  const capability = hasCapability ? buildCapabilityAssessment(capabilityInput) : null;
  const gaps = capability
    ? [...computeGaps(submissions, derivedIds), ...capability.gaps].sort(compareGaps)
    : computeGaps(submissions);
  const firedGapIds = new Set(gaps.map(g => g.gapId));
  const maturity = computeMaturity(
    submissions,
    capability ? capabilityMaturityContributions(capabilityInput.environment, capabilityInput.statuses) : null,
  );
  const { findings, findingCounts } = computeFindings(gaps, { singleContributor });
  const traceability = computeTraceability(submissions, findings);
  const roleMap = computeRoleMap(submissions);
  const exposureFraming = computeExposureFraming(findings);
  const contradictions = computeContradictions(submissions, firedGapIds);

  const limitationNotes = [];
  if (uniqueRespondents === 1 && deptRows.length > 1) {
    limitationNotes.push(`All ${deptRows.length} questionnaires were completed by one individual rather than by the accountable function heads.`);
  } else if (singleContributor) {
    limitationNotes.push(`Each department's questionnaire was completed by a single contributor, with no independent second-reviewer sign-off within the platform.`);
  }
  if (customCount) {
    limitationNotes.push(`${customCount} of ${deptRows.length} submissions are from non-standard (“custom”) departments answering a generic six-question set that is largely scoping rather than control-testing; their maturity and exposure indications are directional only.`);
  }
  if (capability) {
    limitationNotes.push(`The environment profile and the availability of each security capability were self-reported and have not been verified against the systems themselves; a capability marked available is taken at face value and no tool configuration or coverage was tested.`);
  }
  limitationNotes.push(`The questionnaire covers approximately ${traceability.coveragePct}% of the assessable obligations of the DPDP Act. Obligations it does not test are marked “Not Assessed”.`);

  const criticals = findings.filter(f => f.rating === "Critical");
  const compliant = traceability.counts["Compliant (subject to verification)"];
  const keyFindings = [
    `Overall DPDPA readiness is ${maturity.weightedNow < 2 ? "low" : maturity.weightedNow < 3 ? "developing" : "moderate"}. Weighted current-state maturity is approximately ${maturity.weightedNow} out of 5 (“${maturity.weightedNowBand}”), against a realistic 12-month target of approximately ${maturity.weightedTarget} (“${maturity.weightedTargetBand}”).`,
    `${findingCounts.total} findings were raised: ${findingCounts.critical} Critical, ${findingCounts.high} High, ${findingCounts.medium} Medium, ${findingCounts.low} Low.` +
      (criticals.length ? ` The Critical findings are ${criticals.map(f => `${f.ref} (${f.domainLabel.toLowerCase()})`).join(", ")}.` : ""),
    `On the DPDPA traceability matrix, ${compliant === 0 ? "no obligation is assessed as fully Compliant" : `${compliant} ${compliant === 1 ? "obligation is" : "obligations are"} assessed as Compliant subject to verification`}; ${traceability.counts["Non-compliant"]} ${traceability.counts["Non-compliant"] === 1 ? "is" : "are"} Non-compliant and ${traceability.counts.Partial} Partial. Coverage of assessable obligations is approximately ${traceability.coveragePct}%.`,
    ...(capability && capability.summary.coveragePct != null ? [
      `The environment profile classifies the estate as ${capability.classification.label}. Of ${capability.summary.mandatory} capabilities judged mandatory for it, self-reported coverage is approximately ${capability.summary.coveragePct}%; ${capability.gaps.length} capability gap${capability.gaps.length !== 1 ? "s were" : " was"} raised (${capability.summary.newToolGaps} would need a new tool, ${capability.summary.nativeExtendGaps} can be closed by extending or confirming an existing one).`,
    ] : []),
    `The statutory maxima (₹250 crore for security, ₹200 crore for breach notification and children's data) are ceilings, not forecasts. Framed against the s.33(2) factors, near-term practical exposure for a cooperating first mover with no reported breach is regulatory direction and reputational risk rather than a maximum penalty.`,
  ];

  return {
    gaps, findings, findingCounts, maturity, traceability, roleMap, exposureFraming, contradictions, capability,
    deptRows, customCount, singleContributor, hasDpo,
    limitationNotes, keyFindings,
    theOneThing: criticals[0]
      ? `Address ${criticals[0].ref} — ${criticals[0].observation.replace(/\.$/, "")} — and appoint an accountable owner for the programme.`
      : "Appoint an accountable owner for the programme — a Data Protection Officer or, pending designation, a senior privacy lead answerable to the Board.",
  };
}

export { RISK_BANDS };
