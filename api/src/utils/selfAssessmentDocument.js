// The Big-4-standard DPDPA readiness assessment as a fully paginated,
// self-contained HTML document — cover page, Document Control, auto Contents,
// §1–§13, Annexure A–F, a running PRISM letterhead, a faint watermark, and a
// "Neozaar Digital Private Limited / Confidential / Page X / Y" footer on every
// page. Pagination is done in the browser by the vendored Paged.js polyfill
// (api/src/vendor/pagedPolyfill.js); "Download PDF" is browser print → Save as
// PDF.
//
// This is `report.document`. It is NOT the email body — the compact
// `report.html` fragment (buildSelfAssessmentReportHtml) is what gets emailed.

import { PRISM_LOGO_DATA_URI } from "../data/prismLogo.js";
import { PAGED_POLYFILL } from "../vendor/pagedPolyfill.js";
import { lookupProvision } from "./provisionIndex.js";
import {
  ENGAGEMENT_META, SCOPE_TEXT, APPROACH_TEXT, LIMITATIONS_TEXT, BASIS_AND_RELIANCE_TEXT,
  IMPACT_SCALE, LIKELIHOOD_SCALE, RISK_BANDS, CAPABILITY_SCALE,
  S33_INTRO, S33_FACTORS, EXPOSURE_TIERS, EXPOSURE_READING_NOTE,
  CROSS_BORDER_TEXT, FRAMEWORK_ALIGNMENT, SECTOR_BENCHMARK_FALLBACK,
  METHODOLOGY_NOTES, GLOSSARY, DOCUMENTS_REVIEWED,
} from "../data/dpdpaMethodology.js";
import {
  POLICY_INVENTORY, WORKSTREAMS, TOM_ROLES, TOM_FORUMS, PHASING, CRITICAL_PATH_NOTE,
  SDF_FACTORS,
} from "../data/selfAssessmentCrosswalk.js";
import { deptQuestionBase, expandQuestions } from "./deptSelfAssessQuestions.js";
import { guidanceReviewCoverage } from "./selfAssessQuestionGuidance.js";
import { ENVIRONMENT_QUESTIONS, PLATFORM_OPTIONS } from "../data/environmentQuestions.js";
import { IT_DERIVED_QUESTIONS } from "../data/itCapabilityMap.js";
import { orderDepartments } from "../data/deptOrder.js";
import { getCapability } from "../data/capabilityLibrary.js";

const NAVY = "#1E3A5F";

function esc(s) {
  return String(s ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}
// Display-only: uppercase a built-in department's question-id prefix ("it-15" →
// "IT-15") so every department reads with consistent, proper capitalisation in
// the report — matching how a custom department's id already reads ("Admin-5",
// verbatim as the collaborator typed the department name). Never touches the
// underlying id used for lookups — only what gets rendered.
const BUILTIN_ID_PREFIXES = new Set(["it", "hr", "sw", "fi", "lg", "op", "mk"]);
function formatQuestionId(id) {
  const s = String(id ?? "");
  const m = /^([a-z]+)(-.*)$/.exec(s);
  return m && BUILTIN_ID_PREFIXES.has(m[1]) ? m[1].toUpperCase() + m[2] : s;
}
function escId(id) { return esc(formatQuestionId(id)); }
// Same capitalisation, but for a raw id embedded INSIDE a longer sentence — used
// only where the sentence itself is AI-authored free text (an "In your context"
// tailoring line or roadmap-phasing rationale) and may name a question id in
// prose. Runs after esc() since ids contain no characters esc() would touch.
const FREE_TEXT_ID_RE = /\b(it|hr|sw|fi|lg|op|mk)-(\d+[a-z]?)\b/g;
function capitalizeIdMentions(rawText) {
  return String(rawText ?? "").replace(FREE_TEXT_ID_RE, (_, prefix, rest) => `${prefix.toUpperCase()}-${rest}`);
}
function escFree(s) { return esc(capitalizeIdMentions(s)); }
const ANSWER_LABEL = { YES: "Yes", PARTIAL: "Partial", NO: "No", NA: "N/A" };
const ANSWER_CLASS = { YES: "a-yes", PARTIAL: "a-part", NO: "a-no", NA: "a-na" };
// Same colours as the .a-yes/.a-no/.a-part/.a-na CSS classes, added inline: html-to-docx (the
// Word export) doesn't read the <style> block at all, so a class-only colour renders as plain
// black text in Word. The class stays too, so PDF/screen rendering is unchanged.
const ANSWER_COLOR = { "a-yes": "#15803D", "a-no": "#B91C1C", "a-part": "#B45309", "a-na": "#8B85A0" };
function answerBadge(label, cls) {
  const weight = cls === "a-na" ? "" : "font-weight:700;";
  return `<span class="${cls}" style="color:${ANSWER_COLOR[cls]};${weight}">${esc(label)}</span>`;
}

// ─── small builders ───────────────────────────────────────────────────────
function h2(n, label) { return `<h2>${n != null ? `${n}&nbsp;&nbsp;` : ""}${esc(label)}</h2>`; }
function h3(label) { return `<h3>${esc(label)}</h3>`; }
function p(html) { return `<p>${html}</p>`; }
function note(html) { return `<p class="note" style="color:#6B4A0B">${html}</p>`; }
function ul(items) { return `<ul>${items.map(i => `<li>${typeof i === "string" ? esc(i) : i}</li>`).join("")}</ul>`; }
function ol(items) { return `<ol>${items.map(i => `<li>${esc(i)}</li>`).join("")}</ol>`; }

// Cells: a plain string is treated as trusted HTML (callers pass esc(...) for
// anything dynamic), or an object { html, ...attrs } for styling.
function td(c) {
  const { html, ...attrs } = (c && typeof c === "object" && "html" in c) ? c : { html: c ?? "" };
  const a = Object.entries(attrs).map(([k, v]) => ` ${k}="${esc(v)}"`).join("");
  return `<td${a}>${html}</td>`;
}
function table(headers, rows, cls = "", widths = null) {
  const cg = widths ? `<colgroup>${widths.map(w => `<col style="width:${w}">`).join("")}</colgroup>` : "";
  return `<table class="${cls}${widths ? " fixed" : ""}">${cg}<thead><tr>${headers.map(h => `<th>${esc(h)}</th>`).join("")}</tr></thead><tbody>${
    rows.map(r => `<tr>${r.map(td).join("")}</tr>`).join("")
  }</tbody></table>`;
}

const swatch = (color, label) => `<span class="swatch" style="background:${color}"></span>${esc(label)}`;

// ─── the document ─────────────────────────────────────────────────────────
export function buildReadinessDocument(input) {
  const {
    companyName, companyProfile = {}, requestedByEmail, submissions = [],
    deptRows = [], overallScore, regulatoryExposure = [], regulatoryExposureSource = "fallback",
    assessment, narrative = null, engagement = {}, generatedAt = new Date(),
  } = input;

  const co = companyName || "the Company";
  const eng = { ...ENGAGEMENT_META, ...engagement };
  const dateStr = generatedAt.toLocaleDateString("en-IN", { day: "numeric", month: "long", year: "numeric" });
  const { maturity, findings, findingCounts, traceability, roleMap, gaps, contradictions,
          deptRows: adr, keyFindings, theOneThing } = assessment;
  const deptCount = new Set(submissions.map(s => s.department)).size;
  // narrative is the { readiness, gapContext } blob (or null). Every section
  // renders from `assessment` alone; these only add optional lines.
  const readiness = narrative?.readiness ?? null;
  const gapContext = narrative?.gapContext ?? null;

  // The numbered body sections, in order. Numbering + the Contents list derive
  // from this array. NOTE: static text in data/dpdpaMethodology.js and
  // selfAssessmentCrosswalk.js refers to sections 2, 3, 7, 9 and 12 by number, so
  // any section inserted before §12 would break those references — the optional
  // capability section therefore sits after §12, just before the Conclusion.
  const capability = assessment.capability || null;
  const NUMBERED = [
    ["Executive Summary", (n) => section1(n, co, eng, submissions, deptCount, adr, maturity, findingCounts, traceability, keyFindings, assessment.limitationNotes, readiness, theOneThing)],
    ["Risk Assessment Methodology", (n) => section2(n)],
    ["Current-State Maturity Assessment", (n) => section3(n, maturity)],
    ["Assessment Dashboard", (n) => section4(n, maturity, findingCounts, submissions, deptCount, traceability, adr, capability)],
    ["Findings Register", (n) => section5(n, findings)],
    ["Cross-Department Consistency Checks", (n) => sectionConsistency(n, contradictions, gapContext)],
    ["Questionnaire Completeness Summary", (n) => section6(n, assessment)],
    ["DPDPA Requirements Traceability Matrix (s.4 – s.17)", (n) => section7(n, traceability)],
    ["Data Fiduciary / Data Processor Role Map", (n) => section8(n, roleMap, readiness)],
    ["Significant Data Fiduciary — Designation-Likelihood Assessment", (n) => section9(n, readiness)],
    ["Cross-Border Transfer (s.16) & Payment-Data Localisation", (n) => section10(n, findings)],
    ["Remediation Roadmap & Target Operating Model", (n) => section11(n, findings, gaps, gapContext)],
    ["Sector Benchmarking & Framework Alignment", (n) => section12(n, readiness)],
    ...(capability ? [["Environment Profile & Security Capability Assessment", (n) => sectionCapability(n, capability)]] : []),
    ["Conclusion & Overall Assessment", (n) => section13(n, co, maturity, findingCounts, theOneThing)],
  ];
  const ANNEXURES = [
    ["Annexure A — DPDPA Provision Index (s.4 – s.17)", () => annexureA()],
    ["Annexure B — Assessment Methodology & Scoring", () => annexureB()],
    ["Annexure C — Policy & Governance Inventory to Build", () => annexureC()],
    ["Annexure D — Documents Reviewed & Stakeholders Consulted", () => annexureD()],
    ["Annexure E — Full Questionnaire Responses by Department", () => annexureE(submissions)],
    ["Annexure F — Glossary", () => annexureF()],
    ["Annexure G — Gap Remediation Detail", () => annexureG(gaps, findings, gapContext)],
    ...(capability ? [["Annexure H — Environment & Capability Responses", () => annexureH(capability)]] : []),
  ];

  const body = [
    coverPage(co, eng, dateStr, companyProfile),
    documentControl(co, eng, dateStr, deptCount, submissions.length, requestedByEmail),
    contentsPage(NUMBERED.map(([t], i) => `${i + 1}  ${t}`).concat(ANNEXURES.map(([t]) => t))),
    ...NUMBERED.map(([, render], i) => render(i + 1)),
    ...ANNEXURES.map(([, render]) => render()),
  ].join("\n");

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(co)} — DPDP Act 2023 Readiness Assessment</title>
<style>${CSS}</style>
</head>
<body>
<div class="running-header" aria-hidden="true">
  <img src="${PRISM_LOGO_DATA_URI}" alt="PRISM"><span>${esc(co)} — DPDP Act 2023 Readiness Assessment</span>
</div>
<div class="watermark" aria-hidden="true"><img src="${PRISM_LOGO_DATA_URI}" alt=""></div>
<div class="toolbar no-print"><button onclick="window.print()">⬇ Download / Print PDF</button></div>
<main>
${body}
</main>
<script>
  window.PagedConfig = { auto: true, after: () => { window.__pagedDone = true; document.body.classList.add('paged-ready'); } };
</script>
<script>${PAGED_POLYFILL}</script>
</body>
</html>`;
}

// ─── cover ────────────────────────────────────────────────────────────────
function coverPage(co, eng, dateStr, profile) {
  return `<section class="cover">
    <img class="cover-logo" src="${PRISM_LOGO_DATA_URI}" alt="PRISM">
    <div class="cover-kicker">${esc(eng.practice)}</div>
    <h1 class="cover-title">DPDP Act 2023 Readiness Assessment</h1>
    <div class="cover-co">${esc(co)}</div>
    <div class="cover-sub">Digital Personal Data Protection Act, 2023 &nbsp;·&nbsp; Data Fiduciary readiness${profile.industry ? ` &nbsp;·&nbsp; ${esc(profile.industry)}` : ""}</div>
    <table class="cover-meta">
      <tr><th>Report version</th><td>${esc(eng.versionDefault)}</td></tr>
      <tr><th>Report date</th><td>${esc(dateStr)}</td></tr>
      <tr><th>Prepared by</th><td>${esc(eng.practice)} — ${esc(eng.firm)}</td></tr>
      <tr><th>Prepared for</th><td>The Board and management of ${esc(co)}</td></tr>
      <tr><th>Basis</th><td>Desk-based advisory assessment — not an assurance engagement</td></tr>
      <tr><th>Classification</th><td>${esc(eng.classification)}</td></tr>
    </table>
    <p class="cover-disclaimer">This report was not prepared as an assurance engagement under ISAE 3000 / SAE 3000 and does not constitute legal advice. It is confidential, may be legally privileged, and is for the internal use of ${esc(co)} only. See section 1.5.</p>
  </section>`;
}

function documentControl(coRaw, eng, dateStr, deptCount, subCount, requestedByEmail) {
  const co = esc(coRaw);
  return `<section>
    ${h2(null, "Document Control")}
    ${table(["Field", "Detail"], [
      ["Document", `${co} — DPDP Act 2023 Readiness Assessment`],
      ["Version", `${esc(eng.versionDefault)} (issued ${esc(dateStr)})`],
      ["Status", "Final — issued to the client"],
      ["Classification", `${esc(eng.classification)} — ${esc(eng.classificationNote)}`],
      ["Distribution", `${co} — Board, General Counsel, Chief Information Security Officer, Company Secretary. Not for external circulation without the written consent of ${esc(eng.firm)}.`],
      ...(requestedByEmail ? [["Requested by", esc(requestedByEmail)]] : []),
      ["Basis of preparation", `Desk-based review of ${subCount} self-assessment submission(s) across ${deptCount} department(s) held in the PRISM platform. No control testing, evidence review or interviews.`],
    ], "kv")}
    ${h3("Preparation, review and approval")}
    ${table(["Role", "Name / organisation", "Position"], [
      ["Prepared by", `${esc(eng.preparedBy.name)}, ${esc(eng.firm)}`, esc(eng.preparedBy.role)],
      ["Reviewed by", `${esc(eng.reviewedBy.name)}, ${esc(eng.firm)}`, esc(eng.reviewedBy.role)],
      ["Approved for release", `${esc(eng.approvedBy.name)}, ${esc(eng.firm)}`, esc(eng.approvedBy.role)],
      ["Recipient sponsor", co, "General Counsel & Company Secretary"],
    ])}
    ${h3("Version history")}
    ${table(["Ver.", "Date", "Summary of change"], [
      ["1.0", dateStr, "First issue — full DPDPA readiness assessment: risk methodology, maturity model, findings register, traceability matrix, role map, SDF and transfer analysis, workstream roadmap and target operating model, generated from the PRISM team self-assessment."],
    ])}
    ${note(`<strong>Reliance and use restriction.</strong> This report is addressed to and prepared solely for ${co}. It may not be relied upon by, or disclosed to, any other party without ${esc(eng.practice)}'s prior written consent. ${esc(eng.practice)} accepts no liability or duty of care to any party other than ${co}. Nothing herein waives any legal privilege attaching to this report.`)}
  </section>`;
}

// ─── contents ─────────────────────────────────────────────────────────────
function contentsPage(entries) {
  return `<section>${h2(null, "Contents")}<ul class="toc">${entries.map(t => `<li>${esc(t)}</li>`).join("")}</ul>
  ${note("Use the reading order above. Page numbers appear in the footer of every page.")}</section>`;
}

// ─── §1 executive summary ─────────────────────────────────────────────────
function section1(n, co, eng, submissions, deptCount, adr, maturity, fc, tr, keyFindings, limitationNotes, readiness, theOneThing) {
  return `<section>
    ${h2(n, "Executive Summary")}
    ${h3(`${n}.1  Engagement Background & Objectives`)}
    ${p(`${esc(co)} (“the Company”) engaged ${esc(eng.practice)}, a service line of ${esc(eng.firm)}, to assess the Company's readiness for the Digital Personal Data Protection Act, 2023 (“the DPDP Act” or “DPDPA”). This report gives the Board and management a structured, prioritised view of where the Company stands against the DPDP Act, what the exposure is in practical (not just maximum-penalty) terms, and a costed, sequenced path to a defensible compliance position within twelve months.`)}
    ${readiness?.businessContext ? p(`<em>Business context (analyst interpretation).</em> ${escFree(readiness.businessContext)}`) : ""}
    ${h3(`${n}.2  Scope`)}
    <p><strong>In scope</strong></p>${ul(SCOPE_TEXT.inScope)}
    <p><strong>Out of scope</strong></p>${ul(SCOPE_TEXT.outOfScope)}
    ${h3(`${n}.3  Approach`)}
    ${p("The assessment was desk-based and consisted of the following procedures:")}
    ${ol(APPROACH_TEXT)}
    ${h3(`${n}.4  Limitations`)}
    ${ul([...LIMITATIONS_TEXT, ...limitationNotes])}
    ${h3(`${n}.5  Basis of Assessment & Reliance`)}
    ${ul(BASIS_AND_RELIANCE_TEXT)}
    ${h3(`${n}.6  Summary of Key Findings & Overall Assessment`)}
    ${ul([...keyFindings, ...(readiness?.execBullets || []).map(capitalizeIdMentions)])}
    ${p("The Findings Register rates and sequences each finding, the Traceability Matrix shows obligation-level status, and Annexure G carries the per-gap remediation detail. The overall assessment and the single first action are in the Conclusion.")}
  </section>`;
}

// ─── §2 methodology ──────────────────────────────────────────────────────
function section2(n) {
  const matrixRows = [5, 4, 3, 2, 1].map(L => [
    { html: `<strong>L${L}</strong>`, class: "rowhead" },
    ...[1, 2, 3, 4, 5].map(I => {
      const s = L * I;
      const b = RISK_Bands(s);
      return { html: String(s), style: `background:${b.color}22;color:${b.color};font-weight:700;text-align:center` };
    }),
  ]);
  return `<section>
    ${h2(n, "Risk Assessment Methodology")}
    ${p("Each finding is rated for inherent risk as impact × likelihood, each 1–5. Impact is assessed from the perspective of Data Principals and of the Company's regulatory and reputational position; likelihood is the chance the exposure results in an incident, complaint or adverse finding within ~24 months absent further action.")}
    ${h3(`${n}.1  Impact & Likelihood Scales`)}
    <p><strong>Impact (1–5)</strong></p>
    ${table(["Level", "Descriptor", "Definition"], IMPACT_SCALE.map(x => [String(x.level), x.name, x.definition]))}
    <p><strong>Likelihood (1–5)</strong></p>
    ${table(["Level", "Descriptor", "Indicative", "Definition"], LIKELIHOOD_SCALE.map(x => [String(x.level), x.name, esc(x.indicative), x.definition]))}
    ${h3(`${n}.2  Risk Rating Matrix (5 × 5)`)}
    ${p("Risk score = impact × likelihood (1–25), mapped to a band that drives priority and target window.")}
    ${table(["L \\ I", "I1", "I2", "I3", "I4", "I5"], matrixRows, "matrix")}
    ${table(["Rating", "Score", "Response expected"], RISK_BANDS.map(b => [
      { html: swatch(b.color, b.rating) }, `${b.min}–${b.max}`, b.response,
    ]))}
    ${h3(`${n}.3  Framing Regulatory Exposure`)}
    ${p(esc(S33_INTRO))}
    <p><strong>The section 33(2) factors the Board must weigh</strong></p>
    ${table(["Ref", "Matter to be considered in fixing a penalty"], S33_FACTORS.map(f => [f.ref, f.matter]))}
    <p><strong>Exposure by tier — maxima vs. indicative first-instance range</strong></p>
    ${table(["Tier", "Statutory max", "Principal mitigating factors (s.33(2))", "Indicative first-instance range"],
      EXPOSURE_TIERS.map(t => [`${t.tier} — ${t.section}`, t.statutoryMax, t.mitigants, t.indicativeRange]))}
    ${note(`<strong>How to read the exposure figures.</strong> ${esc(EXPOSURE_READING_NOTE)}`)}
  </section>`;
}
// local alias so the matrix helper reads cleanly
function RISK_Bands(score) { return RISK_BANDS.find(b => score >= b.min && score <= b.max) || RISK_BANDS[RISK_BANDS.length - 1]; }

// ─── §3 maturity ─────────────────────────────────────────────────────────
function section3(n, maturity) {
  return `<section>
    ${h2(n, "Current-State Maturity Assessment")}
    ${p("Maturity is assessed across the privacy domains below on a 0–5 capability scale. Each domain is weighted for its contribution to DPDP Act compliance and to Data Principal harm. The current score is derived from the YES / PARTIAL / NO mix of that domain's questionnaire answers; the 12-month target is a realistic “Defined-to-Managed” end state. Scores are directional, not audited.")}
    <p><strong>Capability scale</strong></p>
    ${table(["Level", "Descriptor", "Meaning"], CAPABILITY_SCALE.map(c => [String(c.level), c.name, c.meaning]))}
    <p><strong>Domain scores</strong></p>
    ${table(["Domain", "Wt %", "Now", "Tgt", "Gap", "Basis for the current score"], maturity.domains.map(d => [
      d.label, String(d.weight),
      { html: d.assessed ? String(d.now) : "—", style: "text-align:center;font-weight:700" },
      { html: String(d.target), style: "text-align:center" },
      { html: d.assessed ? `+${d.gap}` : "n/a", style: "text-align:center" },
      d.basis,
    ]))}
    ${p(`<strong>Weighted current-state maturity: ${maturity.weightedNow} / 5 (“${maturity.weightedNowBand}”). &nbsp; Weighted 12-month target: ${maturity.weightedTarget} / 5 (“${maturity.weightedTargetBand}”).</strong>`)}
  </section>`;
}

// ─── §4 dashboard ────────────────────────────────────────────────────────
function section4(n, maturity, fc, submissions, deptCount, tr, adr, capability = null) {
  const gaps = adr.reduce((a, d) => a + d.gaps, 0);
  const partials = adr.reduce((a, d) => a + d.partials, 0);
  const contributors = new Set(submissions.map(s => s.userEmail).filter(Boolean)).size;
  return `<section>
    ${h2(n, "Assessment Dashboard")}
    ${p("A one-page view of the assessment outputs. All figures are self-reported and unverified.")}
    <div class="dash">
      <div class="dash-card">
        <div class="dash-h">Privacy maturity — current vs 12-month target</div>
        ${radarSvg(maturity.domains)}
        <div class="dash-legend"><span><span class="swatch" style="background:${NAVY}"></span>Now</span> <span><span class="swatch" style="background:#9CB4CE"></span>Target</span></div>
      </div>
      <div class="dash-card">
        <div class="dash-h">Findings by inherent risk rating</div>
        ${barsSvg(fc)}
      </div>
    </div>
    ${table(["Metric", "Value"], [
      ["Departmental questionnaires analysed", `${submissions.length} (across ${deptCount} departments; ${contributors} contributor${contributors !== 1 ? "s" : ""})`],
      ["Self-reported control-question gaps / partials", `${gaps} gaps, ${partials} partials`],
      ["DPDPA obligations — Compliant / Partial / Non-compliant / Not Assessed", `${tr.counts["Compliant (subject to verification)"]} / ${tr.counts.Partial} / ${tr.counts["Non-compliant"]} / ${tr.counts["Not Assessed"]}`],
      ["DPDPA obligation coverage of the questionnaire", `≈ ${tr.coveragePct}%`],
      ["Findings — Critical / High / Medium / Low", `${fc.critical} / ${fc.high} / ${fc.medium} / ${fc.low}`],
      ["Weighted maturity — now / target", `${maturity.weightedNow} / ${maturity.weightedTarget} (out of 5)`],
      ...(capability ? [
        ["Environment classification", esc(capability.classification.label)],
        ["Security capabilities — mandatory / recommended / not applicable", `${capability.summary.mandatory} / ${capability.summary.recommended} / ${capability.summary.notApplicable}`],
        ["Self-reported coverage of mandatory capabilities", capability.summary.coveragePct != null ? `≈ ${capability.summary.coveragePct}%` : "Not yet answered"],
        ["Capability gaps — new tool needed / extend or confirm existing", `${capability.summary.newToolGaps} / ${capability.summary.nativeExtendGaps}`],
      ] : []),
    ])}
  </section>`;
}

// ─── findings register (thematic; per-gap detail in Annexure G) ──────────
function section5(n, findings) {
  const rows = findings.map(f => [
    { html: `<strong>${f.ref}</strong>` },
    `${esc(f.title)}<br><span class="muted" style="color:#5A6270">${esc(f.domainLabel)}${f.synthetic ? " · coverage gap" : ""}</span>`,
    {
      html: `${esc(f.observation)}${f.memberGapIds.length
        ? `<br><span class="muted" style="color:#5A6270">Gaps: ${f.memberGapIds.map(escId).join(", ")} — see Annexure G</span>`
        : `<br><span class="muted" style="color:#5A6270">Coverage gap — not a finding of compliance.</span>`}`,
    },
    { html: `<span style="color:${f.ratingColor};font-weight:700">${f.rating}</span><br><span class="muted" style="color:#5A6270">I${f.impact}×L${f.likelihood}=${f.score}</span>` },
    `${esc(f.owner)}<br><span class="muted" style="color:#5A6270">${esc(f.targetWindow)} · ${esc(f.priority)} · ${esc(f.workstream)}</span>`,
  ]);
  return `<section>
    ${h2(n, "Findings Register")}
    ${p(`${findings.length} thematic findings, each rated for inherent risk (section 2) using the highest-risk of its member gaps, and assigned a suggested owner, target window, priority (P1 highest) and workstream. The per-gap analysis — why each matters, what good looks like, the ordered remediation steps and the evidence an auditor will ask for — is in Annexure G, cross-referenced by gap id. Ordered by risk, worst first.`)}
    ${table(["ID", "Finding", "Observation", "Risk", "Owner / window"], rows, "findings", ["6%", "20%", "40%", "10%", "24%"])}
  </section>`;
}

// ─── cross-department consistency checks ─────────────────────────────────
function mergeContradictions(ruleList = [], aiList = []) {
  const tupleKey = (c) => [...(c.sourceRefs || [])]
    .map(r => `${r.questionId}|${r.department}`).sort().join("~");
  const identityKey = (c) => c.source === "rule" ? `rule:${c.id}` : `ai:${(c.tension || "").toLowerCase().replace(/\s+/g, " ").trim()}`;
  const ruleTuples = new Set(ruleList.map(tupleKey));
  const seen = new Set();
  const out = [];
  for (const c of [...ruleList, ...aiList]) {
    if (c.source === "ai" && ruleTuples.has(tupleKey(c))) continue; // rule is authoritative for that answer set
    const k = `${tupleKey(c)}::${identityKey(c)}`;
    if (seen.has(k)) continue;
    seen.add(k);
    out.push(c);
  }
  return out;
}
function sectionConsistency(n, ruleContradictions, gapContext) {
  const merged = mergeContradictions(ruleContradictions || [], gapContext?.contradictions || []);
  const body = merged.length
    ? table(
        ["Departments involved", "Apparent tension", "Related gaps / questions"],
        merged.map(c => {
          const gapPart = (c.relatedGapIds || []).map(g => `${escId(g)} → Annexure G`).join("<br>");
          const nonGap = (c.sourceRefs || [])
            .filter(r => !(c.relatedGapIds || []).includes(r.questionId))
            .map(r => `${escId(r.questionId)} = ${esc(r.answer)} (${esc(r.department)})`).join("<br>");
          return [
            esc((c.departments || []).join(", ")),
            `${escFree(c.tension)}<br><span class="muted" style="color:#5A6270">Apparent tension from self-reported answers — verify with both functions.</span>`,
            { html: [gapPart, nonGap].filter(Boolean).join("<br>") || "—" },
          ];
        }),
        "", ["16%", "54%", "30%"]
      )
    : p("No cross-department inconsistencies were detected in this round.");
  return `<section>
    ${h2(n, "Cross-Department Consistency Checks")}
    ${p("Answers from different departments that <strong>appear</strong> inconsistent. These are prompts for <strong>verification</strong>, not findings — an apparent tension here is not a compliance conclusion.")}
    ${body}
  </section>`;
}

// ─── questionnaire completeness ─────────────────────────────────────────
function section6(n, assessment) {
  const rows = assessment.deptRows.map(d => [
    { html: `<strong>${esc(d.dept)}</strong>` }, d.type,
    `${d.answered}/${d.answered}`,
    "100% Complete",
    d.selfScore != null ? `${d.selfScore}%` : "—",
    `${d.gaps} / ${d.partials}`,
    esc(d.respondent || "—"),
  ]);
  return `<section>
    ${h2(n, "Questionnaire Completeness Summary")}
    ${p("The department view of the underlying self-assessment. These figures describe how completely each department answered its questionnaire and what it self-reported — they are <strong>not a compliance rating</strong>. The self-assessment score is a weighted count of YES / PARTIAL / NO answers as recorded by the respondent.")}
    ${table(["Department", "Type", "Answered", "Completeness", "Self-assmt. score", "Gaps / part.", "Respondent"], rows)}
    ${note("<strong>Why this is not a compliance score.</strong> A high self-assessment score means the respondent answered “yes” to most questions — not that the control is designed, operating and evidenced. The questionnaire is unverified, and for custom departments uses a generic six-question set. The Findings Register and the Traceability Matrix are the compliance view; this table is context.")}
  </section>`;
}

// ─── traceability ──────────────────────────────────────────────────────
function section7(n, tr) {
  return `<section>
    ${h2(n, "DPDPA Requirements Traceability Matrix (s.4 – s.17)")}
    ${p("Each substantive obligation of the DPDP Act that can bear on the Company as a Data Fiduciary, with the assessed status and its basis. “Not Assessed” means the questionnaire does not test the obligation — a coverage gap, not a finding of compliance.")}
    ${table(["s.", "Obligation", "Status", "Basis / related findings"], tr.rows.map(r => [
      { html: `<strong>${esc(r.section)}</strong>` },
      esc(r.obligation),
      { html: `<span style="color:${r.statusColor};font-weight:700">${esc(r.status)}</span>` },
      esc(r.basis),
    ]), "", ["7%", "44%", "16%", "33%"])}
    ${table(["Status", "Count", "Meaning"], [
      ["Compliant", String(tr.counts["Compliant (subject to verification)"]), "Obligation assessed as met (subject to verification)."],
      ["Partial", String(tr.counts.Partial), "Some capability exists but is incomplete, informal or unverified."],
      ["Non-compliant", String(tr.counts["Non-compliant"]), "Obligation assessed as not met."],
      ["Not Assessed", String(tr.counts["Not Assessed"]), "Not tested by the questionnaire — coverage gap."],
      ["N/A", String(tr.counts["N/A"]), "Not applicable to the Company's role or circumstances."],
    ])}
    ${p(`<strong>Assessment coverage of assessable obligations: approximately ${tr.coveragePct}%.</strong> ${tr.counts["Compliant (subject to verification)"] === 0 ? "No obligation is currently assessed as Compliant. " : ""}Closing the coverage gap is a finding in the Findings Register.`)}
  </section>`;
}

// ─── role map ──────────────────────────────────────────────────────────
function section8(n, roleMap, readiness) {
  const noteByFlow = Object.fromEntries((readiness?.roleMapNotes || []).map(x => [x.flow, x.note]));
  return `<section>
    ${h2(n, "Data Fiduciary / Data Processor Role Map")}
    ${p("The DPDP Act's obligations attach differently depending on whether the Company is the Data Fiduciary, a Data Processor (s.8(2)), or both, for a given flow. Roles have not been formally determined; the entries below are PRISM's provisional view, to be confirmed in WS2.")}
    ${table(["Data flow", "Personal data", "Provisional role", "Counterparty role", "Key DPDPA touchpoints", "Assessment status"], roleMap.map(f => [
      { html: `<strong>${esc(f.flow)}</strong>${noteByFlow[f.flow] ? `<br><span class="muted" style="color:#5A6270">${escFree(noteByFlow[f.flow])}</span>` : ""}` },
      esc(f.personalData), esc(f.role), esc(f.counterparty), esc(f.touchpoints), esc(f.status),
    ]))}
    ${note("<strong>Why the role determination matters.</strong> Where the Company is a Processor, its primary duty is s.8(2) contractual compliance and security. Where it is the Fiduciary, the full Chapter II and III burden applies. Several flows are dual-role. This determination is an early WS2 deliverable.")}
  </section>`;
}

// ─── SDF designation-likelihood ────────────────────────────────────────
function section9(n, readiness) {
  const factors = (readiness?.sdfFactors && readiness.sdfFactors.length >= 4)
    ? readiness.sdfFactors
    : SDF_FACTORS.map(f => ({ ref: f.ref, factor: f.factor, assessment: "Not assessed in this desk-based review — to be evaluated with management.", effect: "Neutral" }));
  const overall = readiness?.sdfOverall?.band || "Moderate";
  const rationale = readiness?.sdfOverall?.rationale
    || "The Company's data scale and processing model place it in the population plausibly within a future Significant Data Fiduciary tranche. The s.10(2) controls (India-based DPO, independent data auditor, periodic DPIA and audit) are already recommended by the findings register; standing them up now closes real gaps and makes any future designation a formality.";
  return `<section>
    ${h2(n, "Significant Data Fiduciary — Designation-Likelihood Assessment")}
    ${p("The Central Government may notify a Data Fiduciary as a Significant Data Fiduciary under s.10(1) on six factors; an SDF then has additional obligations under s.10(2) (India-based DPO answerable to the Board, independent data auditor, periodic DPIA and audit). The Company has not been designated. The assessment below is analyst interpretation, not a legal determination.")}
    ${table(["s.10(1) factor", "Assessment for the Company", "Effect on likelihood"], factors.map(f => [
      `${f.ref ? `${f.ref} ` : ""}${esc(f.factor)}`, escFree(f.assessment), escFree(f.effect),
    ]))}
    ${p(`<strong>Overall designation likelihood: ${esc(overall)}.</strong> ${escFree(rationale)}`)}
  </section>`;
}

// ─── cross-border transfer ─────────────────────────────────────────────
function section10(n, findings) {
  const transferF = findings.filter(f => f.key === "transfer" || f.key === "processor-contracts").map(f => f.ref);
  return `<section>
    ${h2(n, "Cross-Border Transfer (s.16) & Payment-Data Localisation")}
    ${h3("Section 16 — transfer of personal data outside India")}
    ${p(esc(CROSS_BORDER_TEXT.s16))}
    ${h3("Reserve Bank of India payment-data localisation")}
    ${p(esc(CROSS_BORDER_TEXT.rbi))}
    ${h3("Recommended actions")}
    ${ol(CROSS_BORDER_TEXT.actions)}
    ${note(`<strong>Practical position.</strong> ${esc(CROSS_BORDER_TEXT.practicalPosition)}${transferF.length ? ` Both are addressed by ${esc(transferF.join(", "))}.` : ""}`)}
  </section>`;
}

// ─── remediation roadmap & target operating model ──────────────────────
const PHASE_LABEL = ["Phase 0 — Mobilise (0–30 days)", "Phase 1 — Foundations (30–90 days)", "Phase 2 — Build (90–180 days)", "Phase 3 — Operate & Assure (180–365 days)"];

function section11(n, findings, gaps, gapContext) {
  const refByKey = Object.fromEntries(findings.map(f => [f.key, f.ref]));
  const firedKeys = new Set(findings.map(f => f.key));
  const wsRows = WORKSTREAMS.map(w => [
    { html: `<strong>${w.id}</strong>`, class: "nowrap" },
    { html: `<strong>${esc(w.name)}</strong><br><span class="muted" style="color:#5A6270">${esc(w.objective)}</span>` },
    esc(w.deps), esc(w.effort), esc(w.cost),
    w.findingKeys.filter(k => firedKeys.has(k)).map(k => refByKey[k]).join(", ") || "—",
  ]);

  // Phasing: AI-synthesised placement of the fired gaps when available, else the
  // static PHASING prose. This is the PHASE view — which gaps land in which
  // phase, grouped by workstream. The atomic remediation steps (and their
  // per-step phase tags) live once, in Annexure G — not repeated here.
  let phasingBody;
  if (gapContext?.roadmapPhasing?.length) {
    const gapById = Object.fromEntries(gaps.map(g => [g.gapId, g]));
    const wsByFindingKey = Object.fromEntries(
      WORKSTREAMS.flatMap(w => (w.findingKeys || []).map(k => [k, w.id]))
    );
    phasingBody = gapContext.roadmapPhasing.map(bucket => {
      // earliest phase a gap appears in wins, so a gap is listed under one phase only
      const gapIds = [...new Set(bucket.stepRefs.map(r => r.gapId))].filter(id => {
        const earliest = Math.min(...gapContext.roadmapPhasing
          .filter(b => b.stepRefs.some(r => r.gapId === id)).map(b => b.phase));
        return earliest === bucket.phase && gapById[id];
      });
      const byWs = {};
      for (const id of gapIds) {
        const ws = wsByFindingKey[gapById[id].guidance.findingKey] || "Other";
        (byWs[ws] ||= []).push(id);
      }
      const lines = Object.entries(byWs).sort().map(([ws, ids]) =>
        `<li><strong>${esc(ws)}</strong> — ${ids.sort().map(escId).join(", ")}</li>`).join("");
      return `<p><strong>${esc(PHASE_LABEL[bucket.phase] || `Phase ${bucket.phase}`)}</strong></p>` +
        (bucket.rationale ? p(`<em>${escFree(bucket.rationale)}</em>`) : "") +
        (lines ? `<ul>${lines}</ul>` : p("No new gaps enter remediation in this phase."));
    }).join("");
  } else {
    phasingBody = PHASING.map(ph => `<p><strong>${esc(ph.phase)}</strong></p>${ul(ph.items)}`).join("");
  }

  return `<section>
    ${h2(n, "Remediation Roadmap & Target Operating Model")}
    ${h3(`${n}.1  Workstreams`)}
    ${p("Eleven workstreams organise the findings. Effort: S (under 40 person-days), M (40 to 120), L (over 120). Indicative external cost bands (tooling, legal, advisory only; excludes internal effort): Low, Medium, High — planning placeholders, not quotes.")}
    ${table(["WS", "Workstream — objective & key deliverables", "Deps", "Effort", "Cost", "Findings"], wsRows, "ws")}
    ${h3(`${n}.2  Phasing & Dependencies`)}
    ${gapContext?.roadmapPhasing?.length
      ? p("Each open gap is placed in the earliest phase its remediation can realistically start, grouped below by workstream. The ordered steps for every gap, with their own phase tags, effort and evidence expectations, are in Annexure G.")
      : ""}
    ${phasingBody}
    ${note(`<strong>Critical path.</strong> ${esc(CRITICAL_PATH_NOTE)}`)}
    ${h3(`${n}.3  Target Operating Model`)}
    ${p("The target operating model is the “run” state the roadmap is building toward — a small DPO office coordinating a federated network of function owners, two governance forums, and a defined policy set.")}
    <p><strong>DPO office and partners</strong></p>
    ${table(["Role", "Responsibility"], TOM_ROLES.map(r => [r.role, r.responsibility]))}
    <p><strong>Governance forums</strong></p>
    ${table(["Forum", "Cadence", "Membership", "Remit"], TOM_FORUMS.map(f => [f.forum, f.cadence, f.membership, f.remit]))}
    ${h3(`${n}.4  Policy & Governance Inventory`)}
    ${(() => {
      const p1 = POLICY_INVENTORY.filter(a => a.pri === "P1");
      const p2 = POLICY_INVENTORY.filter(a => a.pri !== "P1");
      return p(`The target operating model needs ${POLICY_INVENTORY.length} documented artifacts. ${p1.length} are Priority 1 — required to demonstrate a functioning programme: ${esc(p1.map(a => a.artifact).join(", "))}. The remaining ${p2.length} (Priority 2) follow within the same 12-month window. The full inventory, with the purpose, owner and workstream of each, is at <strong>Annexure C</strong>.`);
    })()}
  </section>`;
}

// ─── sector benchmarking ───────────────────────────────────────────────
function section12(n, readiness) {
  return `<section>
    ${h2(n, "Sector Benchmarking & Framework Alignment")}
    ${h3("Sector context")}
    ${p(escFree(readiness?.sectorBenchmark || SECTOR_BENCHMARK_FALLBACK))}
    ${h3("Framework alignment")}
    ${p("Where the Company already uses ISO/IEC 27001 or maps to the NIST Privacy Framework or GDPR, this table bridges those to the DPDP Act so existing control work is not duplicated.")}
    ${table(["Capability", "DPDP Act", "ISO/IEC 27701", "NIST Privacy FW", "GDPR"], FRAMEWORK_ALIGNMENT.map(r => [r.capability, r.dpdpa, r.iso27701, r.nist, r.gdpr]))}
  </section>`;
}

// ─── conclusion ────────────────────────────────────────────────────────
function section13(n, co, maturity, fc, theOneThing) {
  return `<section>
    ${h2(n, "Conclusion & Overall Assessment")}
    ${ul([
      `${co} is at an early stage of DPDP Act readiness. The current-state maturity is weighted at approximately ${maturity.weightedNow} out of 5 (“${maturity.weightedNowBand}”), and ${fc.critical} of the ${fc.total} findings are rated Critical.`,
      "The exposure that matters is concentrated and addressable. Appointing a Data Protection Officer and building a personal-data inventory are prerequisites for most of the remaining work and can begin immediately.",
      "The security-safeguard and breach-notification tiers carry the largest statutory maxima, but a cooperative organisation that is visibly mid-remediation and has suffered no breach is, on the s.33(2) factors, unlikely to face a penalty at or near those maxima in the near term; the practical risk is regulatory direction, Data Principal complaints and reputational harm, rising sharply if a breach occurs before safeguards and the notification runbook are in place.",
      `The 12-month remediation roadmap would move the Company to a largely “Managed” maturity (target ~${maturity.weightedTarget} / 5) and make it able to become audit-ready quickly if it is designated a Significant Data Fiduciary.`,
    ])}
    ${note(`<strong>The one thing to do first.</strong> ${esc(theOneThing)}`)}
  </section>`;
}

// ─── annexures ──────────────────────────────────────────────────────────
function annexureA() {
  const ids = ["4", "5", "5(1)(i)", "5(3)", "6", "6(1)", "6(4)-(6)", "7", "8", "8(1)", "8(2)", "8(4)", "8(5)", "8(6)", "8(7)", "8(9)", "8(10)", "9", "10", "11", "12", "13", "14", "15", "16", "17"];
  const rows = ids.map(id => {
    const pr = lookupProvision("DPDPA", id);
    return pr ? [{ html: `<strong>s.${esc(id)}</strong>`, class: "nowrap" }, esc(pr.title), esc(pr.penalty || "—")] : null;
  }).filter(Boolean);
  return `<section>
    ${h2(null, "Annexure A — DPDPA Provision Index (s.4 – s.17)")}
    ${p("Working reference for the traceability matrix and findings. Statutory text abridged; consult the Act and the Rules for operative wording. Penalties are the Schedule ceilings; every provision without a dedicated Schedule entry inherits the ₹50 crore residuary.")}
    ${table(["s.", "Obligation (abridged)", "Indicative penalty"], rows)}
  </section>`;
}
function annexureB() {
  return `<section>${h2(null, "Annexure B — Assessment Methodology & Scoring")}${ul(METHODOLOGY_NOTES)}</section>`;
}
function annexureC() {
  return `<section>
    ${h2(null, "Annexure C — Policy & Governance Inventory to Build")}
    ${table(["Artifact", "Purpose", "Owner", "Pri.", "WS"], POLICY_INVENTORY.map(a => [a.artifact, a.purpose, a.owner, a.pri, a.ws]))}
  </section>`;
}
function annexureD() {
  return `<section>
    ${h2(null, "Annexure D — Documents Reviewed & Stakeholders Consulted")}
    ${note("<strong>Desk-based assessment — no documents reviewed, no interviews held.</strong> This assessment relied solely on the PRISM self-assessment questionnaire responses. No policies, contracts, system configurations, records, notices or other documents were requested or reviewed, and no interviews, walkthroughs or workshops were conducted with the Company's personnel.")}
    <p><strong>Documents reviewed</strong></p>
    ${table(["Document", "Status"], DOCUMENTS_REVIEWED.map(d => [d, "Not provided / not reviewed"]))}
    <p><strong>Stakeholders consulted</strong></p>
    ${table(["Function", "Engagement"], [
      ["Data Protection Officer / privacy lead", "None — role not appointed"],
      ["Legal / Company Secretary", "None"],
      ["Information security (CISO)", "None"],
      ["IT / Engineering", "None"],
      ["HR, Marketing, Finance, Operations", "None — questionnaire completed by the department respondent"],
    ])}
  </section>`;
}
function annexureE(submissions) {
  const byDept = {};
  for (const s of submissions) (byDept[s.department] ||= []).push(s);
  // IT first, then HR, then the rest — matching the order departments are assessed in.
  const blocks = orderDepartments(Object.keys(byDept)).map(dept => {
    const subs = byDept[dept];
    // union answers across submitters (worst-case per question), expand question text
    const base = deptQuestionBase(dept);
    const merged = {};
    for (const s of subs) for (const [id, a] of Object.entries(s.answers || {})) merged[id] = a;
    const questions = expandQuestions(base, merged);
    const rows = questions.map(q => {
      const a = merged[q.id] || "NA";
      return [
        { html: escId(q.id), class: "nowrap" },
        esc(q.text),
        { html: answerBadge(ANSWER_LABEL[a] || a, ANSWER_CLASS[a] || "a-na"), class: "nowrap" },
      ];
    });
    // IT items answered once on a capability card: listed here with their original
    // wording, flagged as derived (the card is the source — see Annexure H).
    if (String(dept).toLowerCase() === "it") {
      for (const q of IT_DERIVED_QUESTIONS) {
        const a = merged[q.id];
        if (!a) continue;
        const capName = getCapability(q.capabilityId)?.name || q.capabilityId;
        rows.push([
          { html: escId(q.id), class: "nowrap" },
          `${esc(q.text)}<br><span class="muted" style="color:#5A6270">Derived from the capability answer “${esc(capName)}”.</span>`,
          { html: answerBadge(ANSWER_LABEL[a] || a, ANSWER_CLASS[a] || "a-na"), class: "nowrap" },
        ]);
      }
    }
    const emails = [...new Set(subs.map(s => s.userEmail).filter(Boolean))].join(", ");
    return `${h3(dept)}<p class="muted" style="color:#5A6270">${rows.length} questions · respondent ${esc(emails || "—")}</p>${table(["ID", "Question", "Answer"], rows)}`;
  }).join("");
  return `<section>
    ${h2(null, "Annexure E — Full Questionnaire Responses by Department")}
    ${p(`The complete set of questions put to each department and the answer recorded, exactly as held in the PRISM platform. Colour: ${answerBadge("No", "a-no")}, ${answerBadge("Partial", "a-part")}, ${answerBadge("Yes", "a-yes")}, ${answerBadge("N/A", "a-na")}.`)}
    ${blocks}
  </section>`;
}
function annexureF() {
  return `<section>${h2(null, "Annexure F — Glossary")}${table(["Term", "Meaning"], GLOSSARY.map(g => [g.term, g.meaning]))}</section>`;
}

// ─── environment profile & security capability assessment ───────────────
const LEVEL_LABEL = { mandatory: "Mandatory", recommended: "Recommended", na: "Not applicable" };
const LEVEL_COLOR = { mandatory: "#B91C1C", recommended: "#B45309", na: "#5A6270" };
const AVAIL_LABEL = { YES: "Yes", PARTIAL: "Partial", NO: "No", UNKNOWN: "Unknown" };
const AVAIL_CLASS = { YES: "a-yes", PARTIAL: "a-part", NO: "a-no", UNKNOWN: "a-na" };
const levelCell = (level) => ({ html: `<strong style="color:${LEVEL_COLOR[level]}">${LEVEL_LABEL[level]}</strong>`, class: "nowrap" });
const toolsHtml = (tools, max = 3) => tools.slice(0, max).map(t => esc(t.tool) + (t.native ? ' <span class="muted" style="color:#5A6270">(native)</span>' : "")).join("<br>") || "—";

function sectionCapability(n, cap) {
  const { classification, rows, applicability, summary, gaps } = cap;
  const na = applicability.filter(a => a.level === "na");
  const c = summary.counts;
  const applicRows = applicability.filter(a => a.level !== "na").map(a => [
    { html: `<strong>${esc(a.name)}</strong><br><span class="muted" style="color:#5A6270">${esc(a.area)}</span>` },
    levelCell(a.level),
    esc(a.reason),
    { html: toolsHtml(a.suggestedTools) },
  ]);
  const coverageRows = rows.map(r => {
    const gap = gaps.find(g => g.gapId === r.id);
    return [
      { html: `<strong>${esc(r.name)}</strong>` },
      levelCell(r.level),
      { html: r.available ? answerBadge(AVAIL_LABEL[r.available], AVAIL_CLASS[r.available]) : '<span class="muted" style="color:#5A6270">Not answered</span>', class: "nowrap" },
      esc(r.tool || "—"),
      { html: gap ? `${esc(gap.capability.gapType)}<br><span class="muted" style="color:#5A6270">${gap.capability.newToolRequired ? "New tool likely required" : "No new tool required"} · ${esc(gap.rating)}</span>` : (r.available === "YES" ? "No gap" : "—") },
    ];
  });
  return `<section>
    ${h2(n, "Environment Profile & Security Capability Assessment")}
    ${p("Before any control questions were asked, the Company described its technology environment. That description determines which security capabilities are <strong>mandatory</strong>, <strong>recommended</strong> or <strong>not applicable</strong> for it. The Company then stated, for each applicable capability, whether it has it and which tool it uses. Every answer is self-reported and unverified.")}
    ${h3(`${n}.1  Environment Classification`)}
    ${p(`<strong>${esc(classification.label)}.</strong>`)}
    ${classification.rationale.length ? ul(classification.rationale) : ""}
    ${p("The full set of environment answers is at <strong>Annexure H</strong>.")}
    ${h3(`${n}.2  Capability Applicability`)}
    ${p(`${summary.mandatory} capabilities were judged mandatory and ${summary.recommended} recommended for this environment. Suggested tools list the platform the Company already uses first, so existing licences are extended before anything new is bought.`)}
    ${table(["Capability", "Level", "Why", "Suggested tools"], applicRows, "", ["24%", "13%", "39%", "24%"])}
    ${na.length ? note(`<strong>Not applicable to the environment described:</strong> ${na.map(a => esc(a.name)).join("; ")}.`) : ""}
    ${h3(`${n}.3  Capability Coverage`)}
    ${table(["Metric", "Value"], [
      ["Applicable capabilities (mandatory + recommended)", String(summary.applicable)],
      ["Available / Partial / Not available / Unknown / Not answered", `${c.YES} / ${c.PARTIAL} / ${c.NO} / ${c.UNKNOWN} / ${c.unanswered}`],
      ["Self-reported coverage of mandatory capabilities", summary.coveragePct != null ? `≈ ${summary.coveragePct}%` : "Not yet answered"],
      ["Gaps closed by deploying a new tool", String(summary.newToolGaps)],
      ["Gaps closed by extending or confirming an existing tool", String(summary.nativeExtendGaps)],
    ])}
    ${table(["Capability", "Level", "Available?", "Tool used", "Gap type"], coverageRows, "", ["30%", "13%", "12%", "17%", "28%"])}
    ${p(`Each capability gap is rated for inherent risk on the same scale as the questionnaire gaps and appears in the Findings Register${gaps.length ? "" : " (none were raised in this round)"}; the per-capability remediation, suggested tools and evidence expectations are in Annexure G.`)}
    ${note("A capability marked <strong>Yes</strong> means the Company reported having it. No configuration, coverage or effectiveness was tested. <strong>Unknown</strong> is treated as a gap until the capability is evidenced.")}
  </section>`;
}

function annexureH(cap) {
  const label = (q) => {
    const v = cap.environment?.[q.key];
    if (v == null) return '<span class="muted" style="color:#5A6270">Not answered</span>';
    if (q.type === "multi") return esc(v.map(x => PLATFORM_OPTIONS.find(o => o.value === x)?.label || x).join(", ") || "—");
    return answerBadge(v === "YES" ? "Yes" : "No", v === "YES" ? "a-yes" : "a-no");
  };
  const envRows = ENVIRONMENT_QUESTIONS.map(q => [
    { html: esc(q.id), class: "nowrap" }, esc(q.text),
    // Answer is NOT nowrap: the platforms row (env-1) can be a long comma list — under
    // table.fixed a nowrap cell overflows its column width and overlaps the next one.
    label(q),
    esc(q.why),
  ]);
  const statusRows = cap.rows.map(r => [
    { html: esc(r.id), class: "nowrap" }, esc(r.name), levelCell(r.level),
    { html: r.available ? answerBadge(AVAIL_LABEL[r.available], AVAIL_CLASS[r.available]) : '<span class="muted" style="color:#5A6270">Not answered</span>', class: "nowrap" },
    esc(r.tool || "—"),
  ]);
  return `<section>
    ${h2(null, "Annexure H — Environment & Capability Responses")}
    ${p("The environment questions put to the Company and its answers, then the availability and tool recorded for each capability that applies, exactly as held in the PRISM platform.")}
    ${h3("Environment answers")}
    ${table(["ID", "Question", "Answer", "Why PRISM asks"], envRows, "", ["7%", "36%", "20%", "37%"])}
    ${h3("Capability availability")}
    ${statusRows.length ? table(["ID", "Capability", "Level", "Available?", "Tool used"], statusRows) : p("No capabilities were judged applicable to the environment described.")}
  </section>`;
}

// ─── Annexure G — Gap Remediation Detail ────────────────────────────────
// One block per fired gap, in the SAME order as assessment.gaps (no re-sort).
function annexureG(gaps, findings, gapContext) {
  const refByKey = Object.fromEntries(findings.map(f => [f.key, f.ref]));
  const titleByKey = Object.fromEntries(findings.map(f => [f.key, f.title]));
  const tailoringByGap = Object.fromEntries((gapContext?.tailoring || []).map(t => [t.gapId, t.sentence]));
  // final validated phase per (gapId, stepIndex), earliest wins
  const phaseByStep = {};
  for (const bucket of gapContext?.roadmapPhasing || []) {
    for (const ref of bucket.stepRefs || []) {
      const k = `${ref.gapId}|${ref.stepIndex}`;
      if (phaseByStep[k] == null || bucket.phase < phaseByStep[k]) phaseByStep[k] = bucket.phase;
    }
  }
  const havePhasing = !!gapContext?.roadmapPhasing?.length;
  const cov = guidanceReviewCoverage();

  // resolve the question wording per gap (best-effort) so headings disambiguate
  const qTextCache = {};
  const questionText = (gap) => {
    const dept = gap.departments[0]?.dept || "";
    if (!(dept in qTextCache)) {
      qTextCache[dept] = Object.fromEntries((deptQuestionBase(dept) || []).flatMap(q => [
        [q.id, q.text],
        ...((q.followUps?.questions || []).map(fq => [fq.id, fq.text])),
      ]));
    }
    return qTextCache[dept][gap.questionId] || "";
  };

  // Group gaps that share the same guidance entry (the generic custom-department
  // questions all resolve to one shared `generic-N` entry) so the identical
  // Why / What-good / Remediation text is written once, not once per department.
  const groups = [];
  const byGuidance = new Map();
  for (const g of gaps) {
    let grp = byGuidance.get(g.guidance);
    if (!grp) { grp = { gd: g.guidance, members: [] }; byGuidance.set(g.guidance, grp); groups.push(grp); }
    grp.members.push(g);
  }

  const blocks = groups.map(({ gd, members }) => {
    const findingRef = refByKey[gd.findingKey] ? ` &nbsp;→&nbsp; ${esc(refByKey[gd.findingKey])}` : "";
    const lead = members[0];
    // earliest validated phase for a step index, across every member of the group
    const phaseForStep = (i) => {
      let best = null;
      for (const m of members) {
        const ph = phaseByStep[`${m.gapId}|${i}`];
        if (ph != null && (best == null || ph < best)) best = ph;
      }
      return best;
    };
    const steps = (gd.remediation || []).map((s, i) => {
      const ph = phaseForStep(i);
      const phTag = havePhasing && ph != null ? ` <span class="a-phase">Phase ${ph}</span>` : "";
      return `<li>${escFree(s.step)} <span class="muted" style="color:#5A6270">(${esc(s.effort)})</span>${phTag}</li>`;
    }).join("");
    const reviewNote = (gd.reviewStatus !== "reviewed" && gd.reviewStatus !== "approved")
      ? `<p class="muted" style="color:#5A6270">Guidance for this item is pending review.</p>` : "";

    let heading, subline, tailor;
    if (members.length === 1 && lead.capability) {
      // Capability gap (environment-first assessment) — no department / question wording.
      const c = lead.capability;
      heading = h3(`${escId(lead.gapId)} — ${esc(c.name)}`);
      subline = `<p class="muted" style="color:#5A6270">${esc(c.area)} · ${esc(LEVEL_LABEL[c.level])} for this environment · ${esc(c.gapType)}${c.tool ? ` · tool reported: ${esc(c.tool)}` : ""}</p>`;
      tailor = `<p><strong>Why it applies here.</strong> ${esc(c.reason)}</p>
        <p><strong>Recommended approach.</strong> ${esc(c.note)}</p>
        <p><strong>Suggested tools.</strong> ${c.suggestedTools.slice(0, 4).map(t => esc(t.tool) + (t.native ? " (native to your environment)" : "")).join("; ") || "—"}</p>`
        + (tailoringByGap[lead.gapId] ? `<p><strong>In your context.</strong> <em>${escFree(tailoringByGap[lead.gapId])}</em></p>` : "");
    } else if (members.length === 1) {
      const g = lead;
      const qt = questionText(g);
      const depts = g.departments.map(d => `${esc(d.dept)} (${esc(d.answer)})`).join(", ");
      heading = h3(`${escId(g.gapId)} — ${esc(titleByKey[gd.findingKey] || gd.findingKey)}`);
      subline = `<p class="muted" style="color:#5A6270">${qt ? esc(qt) + " · " : ""}answered ${depts}</p>`;
      tailor = tailoringByGap[g.gapId]
        ? `<p><strong>In your context.</strong> <em>${escFree(tailoringByGap[g.gapId])}</em></p>` : "";
    } else {
      const affected = members.map(m => `${escId(m.gapId)} (${esc(m.departments.map(d => d.dept).join("/"))} — ${esc(m.worstAnswer)})`).join(", ");
      const genQ = questionText(lead);
      heading = h3(`${esc(titleByKey[gd.findingKey] || gd.findingKey)} — ${members.length} departments`);
      subline = `<p class="muted" style="color:#5A6270">${genQ ? `Generic questionnaire item (“${esc(genQ)}”), ` : ""}answered NO or PARTIAL by ${members.length} custom departments. Affects: ${affected}.</p>`;
      const tl = members.filter(m => tailoringByGap[m.gapId]);
      // Built manually, not via ul(): each item already contains trusted <em> markup
      // from esc()/escFree() on its dynamic parts, and ul() would re-escape it.
      tailor = tl.length
        ? `<p><strong>In your context.</strong></p><ul>${tl.map(m => `<li><em>${esc(m.departments[0]?.dept || m.gapId)}:</em> ${escFree(tailoringByGap[m.gapId])}</li>`).join("")}</ul>` : "";
    }

    return `
      ${heading}
      ${subline}
      <p><span style="color:${lead.ratingColor};font-weight:700">${lead.rating}</span> <span class="muted" style="color:#5A6270">I${lead.impact}×L${lead.likelihood}=${lead.score}${findingRef}</span></p>
      <p><strong>Why it matters.</strong> ${escFree(gd.whyItMatters)}</p>
      <p><strong>What good looks like.</strong> ${escFree(gd.goodLooksLike)}</p>
      <p><strong>Remediation.</strong></p><ol>${steps}</ol>
      <p><strong>Evidence an auditor will ask for.</strong></p>${ul(gd.evidenceAsks.map(capitalizeIdMentions))}
      ${tailor}${reviewNote}`;
  }).join("<hr>");

  return `<section>
    ${h2(null, "Annexure G — Gap Remediation Detail")}
    ${p(`One entry per open gap (a self-reported NO or PARTIAL questionnaire answer, or a missing, partial or unverified security capability), ordered worst-first — the same order as the Findings Register member lists. Where several custom departments answered the same generic questionnaire item, they share one entry. Remediation guidance is drawn from PRISM's DPDPA control playbook (${cov.reviewed} of ${cov.total} entries reviewed · ${cov.approved} of ${cov.total} approved).`)}
    ${gaps.length ? blocks : p("No open gaps were identified in this round.")}
  </section>`;
}

// ─── inline SVG charts (no libraries) ────────────────────────────────────
function radarSvg(domains) {
  const cx = 160, cy = 150, R = 110, n = domains.length;
  const pt = (i, r) => {
    const ang = -Math.PI / 2 + (i / n) * 2 * Math.PI;
    return [cx + r * Math.cos(ang), cy + r * Math.sin(ang)];
  };
  const ring = (frac) => domains.map((_, i) => pt(i, R * frac).join(",")).join(" ");
  const poly = (sel) => domains.map((d, i) => pt(i, R * (sel(d) / 5)).join(",")).join(" ");
  const axes = domains.map((d, i) => {
    const [x, y] = pt(i, R);
    const [lx, ly] = pt(i, R + 16);
    return `<line x1="${cx}" y1="${cy}" x2="${x}" y2="${y}" stroke="#D9DEE7"/><text x="${lx}" y="${ly}" font-size="7" fill="#5A6270" text-anchor="middle">${esc(shortDomain(d.label))}</text>`;
  }).join("");
  return `<svg viewBox="0 0 320 300" class="chart">
    ${[0.25, 0.5, 0.75, 1].map(f => `<polygon points="${ring(f)}" fill="none" stroke="#E6E9F0"/>`).join("")}
    ${axes}
    <polygon points="${poly(d => d.target)}" fill="#9CB4CE55" stroke="#9CB4CE" stroke-width="1.5"/>
    <polygon points="${poly(d => d.now)}" fill="${NAVY}33" stroke="${NAVY}" stroke-width="2"/>
  </svg>`;
}
function shortDomain(label) {
  return label.replace(" & ", " & ").replace("Data Principal Rights & Grievance", "Rights").replace("Data Inventory & Records of Processing", "Inventory")
    .replace("Personal Data Breach Management", "Breach").replace("Third-Party / Processor Management", "Third-party")
    .replace("Governance & Accountability", "Governance").replace("Consent & Lawful Basis", "Consent")
    .replace("Retention & Minimisation", "Retention").replace("Security Safeguards", "Security")
    .replace("Notice & Transparency", "Notice").replace("Children's Data", "Children").replace("Training & Awareness", "Training");
}
function barsSvg(fc) {
  const data = [
    { label: "Critical", v: fc.critical, c: "#B91C1C" },
    { label: "High", v: fc.high, c: "#C2410C" },
    { label: "Medium", v: fc.medium, c: "#B45309" },
    { label: "Low", v: fc.low, c: "#15803D" },
  ];
  const max = Math.max(1, ...data.map(d => d.v));
  return `<svg viewBox="0 0 320 200" class="chart">
    ${data.map((d, i) => {
      const y = 20 + i * 44, w = (d.v / max) * 220;
      return `<text x="0" y="${y + 14}" font-size="10" fill="#22252E">${d.label}</text>
        <rect x="70" y="${y}" width="${Math.max(w, 2)}" height="22" fill="${d.c}"/>
        <text x="${76 + Math.max(w, 2)}" y="${y + 16}" font-size="11" font-weight="700" fill="#22252E">${d.v}</text>`;
    }).join("")}
  </svg>`;
}

// ─── stylesheet ─────────────────────────────────────────────────────────
const CSS = `
:root { --navy:${NAVY}; --ink:#22252E; --muted:#5A6270; --border:#D9DEE7; --soft:#F2F5F9; }
* { box-sizing:border-box; }
html,body { margin:0; padding:0; background:#F4F4F6; }
body { font-family:"Segoe UI",-apple-system,BlinkMacSystemFont,Roboto,Helvetica,Arial,sans-serif; color:var(--ink); font-size:10.5pt; line-height:1.5; }
main { max-width:210mm; margin:0 auto; background:#fff; }
@media screen { main { margin:16px auto; box-shadow:0 1px 8px rgba(0,0,0,.12); padding:18mm; } .running-header,.watermark { display:none; } }
@media print { html,body { background:#fff; } .toolbar,.no-print { display:none !important; } }

.toolbar { position:sticky; top:0; z-index:99; display:flex; justify-content:flex-end; padding:10px 16px; background:var(--navy); }
.toolbar button { font:600 13px "Segoe UI",sans-serif; padding:8px 18px; border:0; border-radius:6px; background:#fff; color:var(--navy); cursor:pointer; }

section { break-before:page; }
section.cover { break-before:avoid; }

h1 { font-size:22pt; }
h2 { font-size:15pt; color:var(--navy); border-bottom:2px solid var(--navy); padding-bottom:5px; margin:0 0 12px; break-after:avoid; }
h3 { font-size:11.5pt; color:var(--navy); margin:16px 0 6px; break-after:avoid; }
p { margin:0 0 9px; }
ul,ol { margin:0 0 10px; padding-left:20px; }
li { margin-bottom:5px; }
.note { background:#FEF6E7; border:1px solid #F3D48B; border-radius:5px; padding:9px 12px; font-size:9.5pt; color:#6B4A0B; }
.muted, span.muted { color:var(--muted); font-size:9pt; }
em { color:var(--muted); }

table { width:100%; border-collapse:collapse; margin:6px 0 14px; break-inside:auto; }
thead { display:table-header-group; }
tr { break-inside:avoid; }
th { background:var(--navy); color:#fff; font-size:8pt; font-weight:700; letter-spacing:.03em; text-transform:uppercase; text-align:left; padding:6px 8px; }
td { font-size:9pt; padding:5px 8px; border-bottom:1px solid var(--border); vertical-align:top; line-height:1.4; }
tbody tr:nth-child(odd) td { background:var(--soft); }
td.nowrap, th.nowrap { white-space:nowrap; }
table.fixed { table-layout:fixed; }
table.fixed td { overflow-wrap:break-word; }
table.kv td:first-child, table.matrix td.rowhead { font-weight:700; background:#fff; }
table.matrix td { text-align:center; }
table.findings td, table.ws td, table.findings th, table.ws th { font-size:8pt; padding:4px 6px; line-height:1.32; }
table.findings .muted { font-size:7.5pt; }

.swatch { display:inline-block; width:10px; height:10px; border-radius:2px; margin-right:6px; vertical-align:middle; }
.a-no { color:#B91C1C; font-weight:700; } .a-part { color:#B45309; font-weight:700; }
.a-yes { color:#15803D; font-weight:700; } .a-na { color:#8B85A0; }
.a-phase { display:inline-block; font-size:7.5pt; font-weight:700; color:#fff; background:var(--navy); border-radius:3px; padding:0 5px; margin-left:4px; }
section hr { border:0; border-top:1px solid var(--border); margin:14px 0; }

.toc { list-style:none; padding:0; }
.toc li { padding:4px 0; border-bottom:1px dotted var(--border); font-size:10.5pt; }

.cover { padding:32mm 24mm; min-height:296mm; background:#fff; }
@media screen { .cover { min-height:0; } }
.cover-logo { height:46px; margin-bottom:44mm; }
.cover-kicker { text-transform:uppercase; letter-spacing:.16em; font-size:9pt; color:var(--muted); }
.cover-title { font-size:26pt; color:var(--navy); margin:6px 0 2px; line-height:1.15; }
.cover-co { font-size:15pt; font-weight:600; }
.cover-sub { color:var(--muted); font-size:9.5pt; margin:6px 0 24px; }
.cover-meta { width:auto; }
.cover-meta th { background:none; color:var(--muted); text-transform:none; letter-spacing:0; font-weight:600; padding-right:18px; border-bottom:1px solid var(--border); }
.cover-meta td { border-bottom:1px solid var(--border); }
.cover-disclaimer { margin-top:26px; font-size:8.5pt; color:var(--muted); font-style:italic; max-width:150mm; }

.dash { display:flex; gap:14px; margin:10px 0 16px; }
.dash-card { flex:1; border:1px solid var(--border); border-radius:6px; padding:10px; }
.dash-h { font-size:9pt; font-weight:700; color:var(--navy); margin-bottom:4px; }
.dash-legend { font-size:8pt; color:var(--muted); text-align:center; }
.chart { width:100%; height:auto; }

.running-header { display:flex; align-items:center; gap:8px; font-size:7.5pt; color:var(--muted); }
.running-header img { height:12px; }
.watermark { position:fixed; top:0; left:0; right:0; bottom:0; display:flex; align-items:center; justify-content:center; z-index:0; pointer-events:none; }
.watermark img { width:120mm; opacity:.04; }

@page {
  size:A4; margin:22mm 16mm 18mm;
  @top-left { content: element(runningHeader); }
  @bottom-left { content:"${ENGAGEMENT_META.footerLeft}"; font-size:7.5pt; color:#8A8F99; }
  @bottom-right { content:"${ENGAGEMENT_META.footerRight}  ·  Page " counter(page) " / " counter(pages); font-size:7.5pt; color:#8A8F99; }
}
@page :first { @top-left { content:none; } @bottom-left { content:none; } @bottom-right { content:none; } margin:0; }
.running-header { position: running(runningHeader); }
.pagedjs_page .watermark { position:absolute; }
`;
