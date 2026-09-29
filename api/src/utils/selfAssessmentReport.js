// Builds the HTML for the auto-emailed self-assessment "Team Report", and the
// same structured data GET /api/self-assessment returns for the in-app view —
// the two are built from one function so what's emailed and what's shown
// in-app never drift apart.
//
// Regulatory citations: this file itself never authors a provision id, a URL,
// or a penalty figure. The route (routes/selfAssessment.js) calls
// aiProvider.mapRegulatoryExposure() — which grounds every citation against
// the checked-in index in api/src/data/legal/ — and passes the already-
// validated result in as `aiExposureMappings`. If that's empty (AI
// unavailable/disabled, or nothing validated), buildRegulatoryExposure falls
// back to the static FALLBACK_REFERENCE table below, clearly labeled as such.

import { resolveDeptQuestionText } from "./deptSelfAssessQuestions.js";
import { PRISM_LOGO_DATA_URI } from "../data/prismLogo.js";
import { lookupProvision } from "./provisionIndex.js";
import { SCORE_VALUE, SCORE_BANDS, scoreBand, scoreSubmission } from "./selfAssessmentScoring.js";
import { buildReadinessAssessment } from "./readinessAssessment.js";
import { applyCapabilityDerivation } from "./capabilityAssessment.js";
import { buildReadinessDocument } from "./selfAssessmentDocument.js";

// Static regulatory/standard reference rows — last-resort fallback only, used
// when AI mapping is unavailable, disabled, or nothing validated against the
// provision index this round. Figures are commonly-cited public maxima as of
// authoring time — included for awareness, not as a substitute for legal
// advice. Matched to a department by static bucket, NOT by inspecting which
// question was actually answered NO/PARTIAL — the AI path (see above) is
// strictly more precise and should be preferred whenever AI is configured.
const FALLBACK_REFERENCE = [
  {
    framework: "DPDPA 2023 (India)",
    provision: "Sec. 8(5) — Reasonable security safeguards",
    summary: "Data fiduciaries must implement reasonable security safeguards to prevent personal data breaches.",
    penalty: "Up to ₹250 crore",
    relatedDepts: ["IT", "SWE", "Operations", "Finance"],
  },
  {
    framework: "DPDPA 2023 (India)",
    provision: "Sec. 5 & 6 — Notice and consent",
    summary: "Valid, informed, and specific consent must be obtained before processing personal data.",
    penalty: "Up to ₹50 crore (residuary — The Schedule to the DPDP Act, 2023)",
    relatedDepts: ["Marketing", "HR", "Legal"],
  },
  {
    framework: "GDPR",
    provision: "Art. 32 — Security of processing",
    summary: "Appropriate technical and organisational measures required to ensure a level of security appropriate to risk.",
    penalty: "Up to €20M or 4% of global annual turnover",
    relatedDepts: ["IT", "SWE"],
  },
  {
    framework: "GDPR",
    provision: "Art. 6 & 7 — Lawful basis and consent",
    summary: "Processing requires a documented lawful basis; consent must be freely given, specific, and revocable.",
    penalty: "Up to €20M or 4% of global annual turnover",
    relatedDepts: ["Marketing", "HR", "Legal"],
  },
  {
    framework: "ISO/IEC 27001:2022",
    provision: "Annex A.5.15–5.23 — Access control & supplier relationships",
    summary: "Access rights and third-party/supplier relationships must be controlled, reviewed, and documented.",
    penalty: "No statutory fine — noncompliance risks certification suspension / audit nonconformities",
    relatedDepts: ["IT", "Operations", "Finance"],
  },
];

function esc(str) {
  return String(str ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}

// ─── Deterministic derivations (no AI) ─────────────────────────────────────

/** submissions: [{ department, answers, userEmail, userName, submittedAt }] grouped by dept. */
function computeDeptRows(byDept) {
  return Object.entries(byDept).map(([dept, subs]) => {
    const scores = subs.map(s => scoreSubmission(s.answers)).filter(v => v !== null);
    const avgScore = scores.length ? Math.round(scores.reduce((a, b) => a + b, 0) / scores.length) : null;

    const textById = resolveDeptQuestionText(dept, subs);
    const answeredIds = new Set();
    for (const s of subs) for (const id of Object.keys(s.answers || {})) answeredIds.add(id);

    const gapQuestions = [];
    const partialQuestions = [];
    for (const id of answeredIds) {
      const hasNo = subs.some(s => s.answers?.[id] === "NO");
      const hasPartial = subs.some(s => s.answers?.[id] === "PARTIAL");
      const text = textById.get(id) || id;
      if (hasNo) gapQuestions.push({ id, text });
      else if (hasPartial) partialQuestions.push({ id, text });
    }

    return {
      dept,
      contributors: subs.length,
      avgScore,
      gapCount: gapQuestions.length,
      partialCount: partialQuestions.length,
      openItems: gapQuestions.length + partialQuestions.length,
      gapQuestions,
      partialQuestions,
    };
  }).sort((a, b) => (a.avgScore ?? 101) - (b.avgScore ?? 101));
}

function buildPriorityFocus(deptRows) {
  const totalOpen = deptRows.reduce((a, d) => a + d.openItems, 0);
  return deptRows
    .filter(d => d.openItems > 0)
    .map(d => ({
      dept: d.dept,
      avgScore: d.avgScore,
      openItems: d.openItems,
      gapCount: d.gapCount,
      partialCount: d.partialCount,
      shareOfOrgWideTotal: totalOpen ? Math.round((d.openItems / totalOpen) * 100) : 0,
    }))
    .sort((a, b) => b.openItems - a.openItems)
    .slice(0, 5);
}

function buildQuickWins(deptRows) {
  return deptRows
    .filter(d => d.avgScore !== null && d.avgScore < 100 && d.openItems > 0 && d.openItems <= 2)
    .map(d => ({ dept: d.dept, avgScore: d.avgScore, openItems: d.openItems, gapCount: d.gapCount, partialCount: d.partialCount }))
    .sort((a, b) => a.openItems - b.openItems);
}

function buildDataQualityNotes(deptRows) {
  const notes = [];

  const notAssessed = deptRows.filter(d => d.avgScore === null).map(d => d.dept);
  if (notAssessed.length) {
    notes.push({
      type: "not-assessed",
      text: `${notAssessed.join(", ")} ${notAssessed.length !== 1 ? "were" : "was"} treated as Not Assessed and excluded from the overall score — no scoreable answers were submitted.`,
    });
  }

  const singleContributor = deptRows.filter(d => d.contributors === 1).map(d => d.dept);
  if (singleContributor.length) {
    notes.push({
      type: "single-contributor",
      text: `Every submission was completed by a single contributor, with no independent peer or manager review built into this round (${singleContributor.length} department${singleContributor.length !== 1 ? "s" : ""}: ${singleContributor.join(", ")}).`,
    });
  }

  const bySignature = {};
  for (const d of deptRows) {
    if (d.avgScore === null) continue;
    const sig = `${d.avgScore}-${d.gapCount}-${d.partialCount}`;
    (bySignature[sig] ||= []).push(d.dept);
  }
  for (const [sig, depts] of Object.entries(bySignature)) {
    if (depts.length < 3) continue;
    const [score] = sig.split("-");
    notes.push({
      type: "identical-scores",
      text: `${depts.join(", ")} returned an identical result — ${score}% — which is worth a light sanity check before treating scores as fully independent assessments.`,
    });
  }

  notes.push({
    type: "trust-based",
    text: "This is a trust-based self-assessment: each department reported on its own controls, and no independent evidence review, technical testing, or third-party verification was performed as part of this exercise.",
  });

  return notes;
}

function buildExecutiveSummary({ companyName, deptRows, overallScore, priorityFocus, quickWins, regulatoryExposure, notAssessedDepts = [] }) {
  const totalGaps = deptRows.reduce((a, d) => a + d.gapCount, 0);
  const totalPartials = deptRows.reduce((a, d) => a + d.partialCount, 0);
  const scoredDeptCount = deptRows.filter(d => d.avgScore !== null).length;
  const notAssessedCount = notAssessedDepts.length;
  const scores = deptRows.map(d => d.avgScore).filter(v => v !== null);
  const co = companyName || "This organization";

  // The narrative paragraph + its self-reported caveat (the italic line under
  // the paragraph in the reference report).
  const range = scores.length > 1 ? `, with individual department scores ranging from ${Math.min(...scores)}% to ${Math.max(...scores)}%` : "";
  const narrative =
    `This report summarizes the actionable insights from ${co}'s PRISM team self-assessment ` +
    `(${deptRows.length} department submission${deptRows.length !== 1 ? "s" : ""}). ` +
    (notAssessedCount ? `Excluding ${notAssessedDepts.join(", ")} — treated as Not Assessed — the ` : "The ") +
    `assessed departments produced an overall compliance score of ` +
    `${overallScore !== null ? `${overallScore}%` : "—"} ("${scoreBand(overallScore).label}")${range}. ` +
    `Beyond the headline score, the underlying data points to a small number of departments driving most of the ` +
    `open items${quickWins.length ? ", a handful of low-effort \"quick win\" opportunities," : ""} and ` +
    `specific regulatory provisions that the self-reported gaps map to.`;
  const caveat = "All figures below are self-reported by the responsible department and have not been independently verified (see the Basis of Assessment note above and Section 6).";

  const bullets = [];
  bullets.push(
    `Org-wide totals: ${totalGaps} unresolved gap${totalGaps !== 1 ? "s" : ""} and ${totalPartials} partial control${totalPartials !== 1 ? "s" : ""} across ${scoredDeptCount} assessed department${scoredDeptCount !== 1 ? "s" : ""}` +
    (notAssessedCount ? ` (${notAssessedCount} not assessed — see Data Quality Notes).` : ".")
  );

  const top = priorityFocus[0];
  if (top && top.shareOfOrgWideTotal > 0) {
    bullets.push(`${top.dept} alone accounts for ${top.shareOfOrgWideTotal}% of all open items organization-wide — the single highest-leverage area for remediation.`);
  }

  if (quickWins.length) {
    bullets.push(`${quickWins.length} department${quickWins.length !== 1 ? "s are" : " is"} each one or two fixes away from a perfect score.`);
  }

  if (regulatoryExposure.length) {
    const topRows = [...regulatoryExposure].sort((a, b) => b.triggeredBy.length - a.triggeredBy.length).slice(0, 2);
    bullets.push(`Open items map most heavily to ${topRows.map(r => `${r.framework} ${r.provisionLabel}`).join(" and ")}.`);
  }

  return {
    headline: overallScore !== null ? `${overallScore}%` : "—",
    band: scoreBand(overallScore).label,
    narrative,
    caveat,
    bullets,
  };
}

// "DPDPA 2023 Sec. 8(5); GDPR Art. 6, Art. 32" per department, from the
// regulatory-exposure rows that name that department — for the Annexure B
// "Regulatory Scope" column. Provisions are grouped under their framework so a
// department mapped to several ISO controls reads "ISO/IEC 27001:2022 A.5.20,
// A.5.34" rather than repeating the framework name each time.
function regulatoryScopeByDept(regulatoryExposure) {
  const byDept = {};
  for (const row of regulatoryExposure) {
    const fw = row.framework.replace(/\s*\(.*\)$/, "").trim();
    for (const t of row.triggeredBy) {
      const deptFw = (byDept[t.dept] ||= {});
      (deptFw[fw] ||= new Set()).add(row.provisionLabel);
    }
  }
  const out = {};
  for (const [dept, frameworks] of Object.entries(byDept)) {
    out[dept] = Object.entries(frameworks)
      .map(([fw, provs]) => `${fw} ${[...provs].join(", ")}`)
      .join("; ");
  }
  return out;
}

function buildRoadmap({ priorityFocus, quickWins, notAssessedDepts, dataQualityNotes }) {
  const phase1 = [];
  const top = priorityFocus[0];
  if (top) {
    phase1.push(
      `Close ${top.dept}'s ${top.gapCount} unresolved gap${top.gapCount !== 1 ? "s" : ""}` +
      (top.partialCount ? ` and ${top.partialCount} partial${top.partialCount !== 1 ? "s" : ""}` : "") +
      ` first — the largest single concentration of open items organization-wide.`
    );
  }
  if (quickWins.length) {
    phase1.push(
      `Bank the ${quickWins.length} quick-win item${quickWins.length !== 1 ? "s" : ""} — ` +
      `${quickWins.map(q => `${q.dept} (${q.openItems} item${q.openItems !== 1 ? "s" : ""})`).join(", ")} — ` +
      `to move ${quickWins.length} department${quickWins.length !== 1 ? "s" : ""} to 100% with minimal effort.`
    );
  }
  if (dataQualityNotes.some(n => n.type === "identical-scores")) {
    phase1.push("Spot-check the departments flagged with identical scores in Data Quality Notes to confirm the self-assessment reflects each department's actual controls.");
  }
  phase1.push("Introduce a second-reviewer sign-off step for department self-assessments going forward.");
  if (notAssessedDepts.length) {
    phase1.push(`Obtain a validated self-assessment submission for ${notAssessedDepts.join(", ")}, currently treated as Not Assessed and excluded from the overall score.`);
  }

  const rest = priorityFocus.slice(1);
  const mid = Math.ceil(rest.length / 2);
  const phase2 = rest.slice(0, mid).map(d =>
    `Remediate ${d.dept}'s remaining ${d.openItems} open item${d.openItems !== 1 ? "s" : ""} ` +
    `(${d.gapCount} gap${d.gapCount !== 1 ? "s" : ""}, ${d.partialCount} partial${d.partialCount !== 1 ? "s" : ""}).`
  );

  const phase3Depts = rest.slice(mid);
  const phase3 = [
    ...(phase3Depts.length ? [`Close the remaining lower-priority open items in ${phase3Depts.map(d => d.dept).join(", ")}.`] : []),
    "Re-run the self-assessment organization-wide to produce an updated score set and measure movement against this baseline.",
    "Establish a recurring (quarterly or annual) self-assessment cadence with mandatory second-reviewer sign-off built in from the start.",
  ];

  return {
    phase1: { label: "Immediate (0–30 days)", actions: phase1 },
    phase2: { label: "Short-Term (30–90 days)", actions: phase2 },
    phase3: { label: "Medium-Term (90–180 days)", actions: phase3 },
  };
}

// ─── Regulatory exposure ────────────────────────────────────────────────────
// AI path: aiExposureMappings is already validated against the checked-in
// provision index (aiProvider.mapRegulatoryExposure -> validExposureMapping)
// before it ever reaches this file — title/url/penalty here are index values,
// never model-authored text. Fallback path: the static FALLBACK_REFERENCE
// table, dept-bucket matched, used only when nothing AI-validated is available.

// DPDPA ids in the index are bare ("8(5)"); GDPR/ISO already carry their own
// prefix ("Art. 32", "A.5.15"). Present DPDPA as "Sec. 8(5)" to match how the
// Act is normally cited.
function provisionLabelFor(framework, id) {
  return framework === "DPDPA" && !/^sec/i.test(id) ? `Sec. ${id}` : id;
}

function buildRegulatoryExposureFromAI(aiExposureMappings) {
  const byProvision = new Map();
  for (const m of aiExposureMappings) {
    const key = `${m.framework}|${m.provisionId}`;
    if (!byProvision.has(key)) {
      // Re-resolve title/url/penalty from the checked-in index at render time
      // rather than trusting the fields on the mapping — those may have been
      // cached (self_assessment_reports) before the index was last edited, and
      // the index is the single source of truth for citation text.
      const idx = lookupProvision(m.framework, m.provisionId) || {};
      byProvision.set(key, {
        source: "ai",
        framework: idx.frameworkName || m.frameworkName,
        provisionId: m.provisionId,
        provisionLabel: provisionLabelFor(m.framework, m.provisionId),
        summary: idx.title || m.title,
        penalty: idx.penalty || m.penalty || "Not specified — see official source",
        url: idx.url || m.url,
        _byDept: new Map(),
      });
    }
    // The model can emit more than one mapping for the same (provision, dept)
    // pair — merge them into one triggeredBy entry, unioning the question ids.
    const dedup = byProvision.get(key)._byDept;
    const existing = dedup.get(m.dept);
    if (existing) {
      existing.questionIds = [...new Set([...existing.questionIds, ...m.relatedQuestionIds])];
    } else {
      dedup.set(m.dept, { dept: m.dept, rationale: m.rationale, questionIds: [...m.relatedQuestionIds] });
    }
  }
  return [...byProvision.values()].map(({ _byDept, ...row }) => ({
    ...row,
    triggeredBy: [..._byDept.values()].map(e => ({ dept: e.dept, rationale: e.rationale, questionCount: e.questionIds.length })),
  }));
}

function buildFallbackExposure(deptRows) {
  const deptsWithGaps = new Set(deptRows.filter(d => d.openItems > 0).map(d => d.dept));
  return FALLBACK_REFERENCE
    .filter(row => row.relatedDepts.some(d => deptsWithGaps.has(d)))
    .map(row => ({
      source: "fallback",
      framework: row.framework,
      provisionId: null,
      provisionLabel: row.provision.split("—")[0].trim(),
      summary: row.summary,
      penalty: row.penalty,
      url: null,
      triggeredBy: deptRows
        .filter(d => row.relatedDepts.includes(d.dept) && d.openItems > 0)
        .map(d => ({ dept: d.dept, rationale: null, questionCount: d.openItems })),
    }));
}

function buildRiskRewardRows(deptRows, regulatoryExposure) {
  return deptRows.map(d => {
    const hasGaps = d.openItems > 0;
    const gapParts = [];
    if (d.gapCount) gapParts.push(`${d.gapCount} unresolved gap${d.gapCount !== 1 ? "s" : ""}`);
    if (d.partialCount) gapParts.push(`${d.partialCount} partial control${d.partialCount !== 1 ? "s" : ""}`);
    const gapsSummary = gapParts.join(" and ");

    const applicable = regulatoryExposure.filter(r => r.triggeredBy.some(t => t.dept === d.dept));

    let riskReasons = [], riskText;
    if (!hasGaps) {
      riskText = "No material gaps identified — low exposure.";
    } else if (applicable.length) {
      riskReasons = applicable.map(r => ({ framework: r.framework, provision: r.provisionLabel, why: r.summary, penalty: r.penalty, url: r.url }));
      riskText = `${gapsSummary} in ${d.dept} fall within scope of ${riskReasons.map(r => `${r.framework} ${r.provision}`).join("; ")} — penalty ${riskReasons.map(r => r.penalty).join("; ")}.`;
    } else {
      riskText = `${gapsSummary} identified, with no mapped regulatory reference for this department.`;
    }

    let rewardText;
    if (!hasGaps) {
      rewardText = "Already at low risk — maintain current controls.";
    } else {
      const frameworks = [...new Set(applicable.map(r => r.framework))];
      const scoreNote = d.avgScore !== null ? `raise score from ${d.avgScore}% to up to 100%` : "establish a baseline score";
      rewardText = `Closing ${gapsSummary} would ${scoreNote}, avoid the exposure above${frameworks.length ? `, and strengthen ${frameworks.join(" / ")} readiness` : ""}.`;
    }

    return { dept: d.dept, hasGaps, gapsSummary, riskReasons, riskText, rewardText };
  });
}


/**
 * @param {{ companyName?: string, companyProfile?: object, submissions: Array,
 *   requestedByEmail?: string, aiExposureMappings?: Array, narrative?: object|null,
 *   engagement?: object, capabilityInput?: { environment: object, statuses: object } }} args
 *   aiExposureMappings: already-validated output of
 *   aiProvider.mapRegulatoryExposure() (see aiProvider.js's validExposureMapping) —
 *   pass [] when AI is unavailable/disabled to use the static fallback table.
 *   narrative: normalised output of aiProvider.generateReadinessNarrative(), or
 *   null → the Big-4 `document` renders its templated fallback prose.
 *   capabilityInput: the company's environment answers + capability statuses
 *   (environment-first assessment). Omit / null → the report is questionnaire-only.
 *
 *   Returns the compact email `html`/`text`, the paginated Big-4 `document`, the
 *   headline `overallScore`/`overallBand` (consumed by POST /self-assessment/
 *   complete), and the structured `deptRows`/`priorityFocus`/`quickWins`/
 *   `dataQualityNotes`/`roadmap`/`regulatoryExposure`/`executiveSummary` plus the
 *   readiness engine's `maturity`/`findings`/`traceability`/`roleMap`.
 */
export function buildSelfAssessmentReport({ companyName, companyProfile = {}, submissions: rawSubmissions, requestedByEmail, aiExposureMappings = [], narrative = null, engagement = {}, capabilityInput = null }) {
  // IT answers implied by the capability cards (idempotent) — see capabilityAssessment.js.
  const { submissions } = applyCapabilityDerivation(rawSubmissions, capabilityInput);
  const byDept = {};
  for (const s of submissions) (byDept[s.department] ||= []).push(s);

  const deptRows = computeDeptRows(byDept);
  const validScores = deptRows.map(d => d.avgScore).filter(v => v !== null);
  const overallScore = validScores.length ? Math.round(validScores.reduce((a, b) => a + b, 0) / validScores.length) : null;

  const priorityFocus = buildPriorityFocus(deptRows);
  const quickWins = buildQuickWins(deptRows);
  const dataQualityNotes = buildDataQualityNotes(deptRows);
  const notAssessedDepts = deptRows.filter(d => d.avgScore === null).map(d => d.dept);
  const roadmap = buildRoadmap({ priorityFocus, quickWins, notAssessedDepts, dataQualityNotes });

  const regulatoryExposureSource = aiExposureMappings.length ? "ai" : "fallback";
  const regulatoryExposure = aiExposureMappings.length
    ? buildRegulatoryExposureFromAI(aiExposureMappings)
    : buildFallbackExposure(deptRows);

  // Annexure B "Regulatory Scope" column, per department.
  const scopeByDept = regulatoryScopeByDept(regulatoryExposure);
  for (const d of deptRows) d.regulatoryScope = scopeByDept[d.dept] || null;

  const executiveSummary = buildExecutiveSummary({
    companyName, deptRows, overallScore, priorityFocus, quickWins, regulatoryExposure, notAssessedDepts,
  });

  // The Big-4 readiness document — deterministic engine + optional AI narrative.
  // The document renders every section from `assessment` alone; `narrative`
  // ({ readiness, gapContext } | null) only adds optional lines.
  const assessment = buildReadinessAssessment(submissions, capabilityInput);
  let document = null;
  try {
    document = buildReadinessDocument({
      companyName, companyProfile, requestedByEmail, submissions, deptRows, overallScore,
      regulatoryExposure, regulatoryExposureSource, assessment, narrative, engagement,
      generatedAt: new Date(),
    });
  } catch (err) {
    console.error("[self-assessment/report] Big-4 document render failed:", err.message);
  }

  // `text` is the concise notification body for the ?email=1 mail — NOT a
  // rendered report (there is no compact HTML report any more).
  const fc = assessment.findingCounts;
  const text = [
    `The DPDP Act 2023 Readiness Assessment for ${companyName || "your organisation"} is ready.`,
    `Findings: ${fc.total} (${fc.critical} Critical, ${fc.high} High).`,
    `Weighted maturity: ${assessment.maturity.weightedNow} / 5 (target ${assessment.maturity.weightedTarget}).`,
    `Assessment coverage: ${assessment.traceability.coveragePct}% of assessable DPDP Act obligations.`,
    ...(assessment.capability?.summary.coveragePct != null
      ? [`Security capability coverage: ${assessment.capability.summary.coveragePct}% of mandatory capabilities (${assessment.capability.gaps.length} gap${assessment.capability.gaps.length !== 1 ? "s" : ""}).`]
      : []),
    `Open it in PRISM to view the full report.`,
  ].join("\n");

  return {
    text,
    document,
    overallScore,
    overallBand: scoreBand(overallScore).label,
    deptRows,
    priorityFocus,
    quickWins,
    dataQualityNotes,
    roadmap,
    regulatoryExposure,
    regulatoryExposureSource,
    executiveSummary,
    gaps: assessment.gaps,
    findings: assessment.findings,
    findingCounts: assessment.findingCounts,
    maturity: assessment.maturity,
    traceability: assessment.traceability,
    roleMap: assessment.roleMap,
    contradictions: assessment.contradictions,
    exposureFraming: assessment.exposureFraming,
    capability: assessment.capability,
  };
}

/**
 * The per-department gap/partial question text (id + text), needed by the
 * route to feed aiProvider.mapRegulatoryExposure() before calling
 * buildSelfAssessmentReport(). Kept separate so the report builder itself
 * stays synchronous and easy to unit test.
 */
export function buildDeptOpenItems(rawSubmissions, capabilityInput = null) {
  const { submissions } = applyCapabilityDerivation(rawSubmissions, capabilityInput);
  const byDept = {};
  for (const s of submissions) (byDept[s.department] ||= []).push(s);
  return computeDeptRows(byDept)
    .filter(d => d.openItems > 0) // no point spending a prompt on a department with nothing open
    .map(d => ({ dept: d.dept, gapQuestions: d.gapQuestions, partialQuestions: d.partialQuestions }));
}

export { scoreBand, scoreSubmission, FALLBACK_REFERENCE };
