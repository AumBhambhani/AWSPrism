// Static "author-once" scaffolding for the Big-4-standard DPDPA self-assessment
// readiness report (utils/selfAssessmentDocument.js). None of this is company-
// specific — it is the methodology, the statutory framing, the scales and the
// glossary that every generated report carries verbatim. Company-specific
// content is derived in utils/readinessAssessment.js (deterministic) and
// utils/readinessNarrativePrompt.js (AI narrative).
//
// Statutory text is abridged working reference, consistent with
// api/src/data/legal/dpdpa-2023.json and its README. This document is an
// advisory readiness assessment, not legal advice and not an assurance
// engagement — see BASIS_AND_RELIANCE_TEXT.

// ─── Engagement identity ───────────────────────────────────────────────────
// Defaults describe the PRISM Privacy Advisory practice (a service line of
// Neozaar Digital Private Limited). Individual names are overridable per
// engagement via buildSelfAssessmentReport({ engagement }); the roles are fixed.
export const ENGAGEMENT_META = {
  firm: "Neozaar Digital Private Limited",
  practice: "PRISM Privacy Advisory",
  productLine: "PRISM — Privacy & Compliance Platform",
  classification: "Confidential — Legally Privileged",
  classificationNote:
    "Prepared to assist the provision of legal advice.",
  versionDefault: "1.0",
  preparedBy: { name: "PRISM Privacy Advisory", role: "Consultant, Privacy & Data Protection" },
  reviewedBy: { name: "Engagement Manager", role: "Engagement Manager, Privacy & Data Protection" },
  approvedBy: { name: "Practice Head", role: "Partner / Practice Head" },
  footerLeft: "Neozaar Digital Private Limited",
  footerRight: "Confidential",
};

// ─── §1.2 Scope ────────────────────────────────────────────────────────────
export const SCOPE_TEXT = {
  inScope: [
    "The personal data processing activities of the Company as reported by its function heads through the PRISM team self-assessment questionnaire.",
    "The obligations of a Data Fiduciary under Chapter II of the DPDP Act (sections 4 to 10), the rights and grievance-redressal machinery under Chapter III (sections 11 to 14), cross-border transfer under section 16, and the penalty framework under section 33 and the Schedule.",
    "A current-state privacy maturity assessment across the domains in section 3, a consolidated findings register, a requirements traceability matrix, a Data Fiduciary / Data Processor role map, a Significant Data Fiduciary designation-likelihood assessment, and a remediation roadmap with an indicative target operating model.",
  ],
  outOfScope: [
    "Any examination, testing or verification of the Company's systems, controls, contracts, records or processing activities. No control testing, configuration review, penetration testing, data-flow tracing or code review was performed.",
    "Legal advice on the application of the DPDP Act or any other law to the Company's specific circumstances. This report is an advisory readiness assessment and is not a legal opinion.",
    "Sector-specific regimes except where expressly noted (for example, the Reserve Bank of India payment-data storage direction is referenced but not assessed).",
    "Employment law, the Information Technology Act 2000 and the SPDI Rules 2011, consumer-protection law, and any obligations of group or associate entities of the Company.",
    "Data protection regimes of jurisdictions outside India (for example the EU GDPR), except as an alignment reference in section 12.",
    "The Digital Personal Data Protection Rules and the Data Protection Board's enforcement practice, which were still maturing at the report date.",
  ],
};

// ─── §1.3 Approach ─────────────────────────────────────────────────────────
export const APPROACH_TEXT = [
  "Desk-based review of the completed self-assessment questionnaires held in the PRISM platform for the Company, extracted on the report date.",
  "Mapping of each questionnaire gap and partial response to the relevant DPDP Act provision using PRISM's regulatory-exposure routing logic and the checked-in DPDPA provision index.",
  "Construction of a current-state maturity baseline, a risk-rated findings register, and a requirements traceability matrix, applying the risk methodology set out in section 2.",
  "Analyst interpretation of the Company's business model from the information provided and public information, to frame role, transfer and designation-likelihood questions.",
];

// ─── §1.4 Limitations (fixed bullets; readinessAssessment adds data-driven ones) ──
export const LIMITATIONS_TEXT = [
  "The assessment is built entirely on unverified management self-reporting. Every score, gap and rating reflects what a respondent stated, not what PRISM observed. No corroborating evidence was requested or reviewed.",
  "A respondent may interpret a question differently from how it was intended, or may not have full visibility of their function's practice; answers can therefore over- or under-state the true position.",
  "Obligations the questionnaire does not test are marked “Not Assessed” and are a gap in assessment coverage, not a positive finding of compliance (see section 7).",
  "The DPDP Rules and the Data Protection Board's enforcement practice were still maturing at the report date. No Indian penalty precedent exists under the Act. Exposure figures are statutory maxima and illustrative analogues, not forecasts.",
  "This report is a point-in-time assessment. It does not consider changes in the Company's processing, the law or the Rules after the report date.",
];

// ─── §1.5 Basis of Assessment & Reliance ───────────────────────────────────
export const BASIS_AND_RELIANCE_TEXT = [
  "This engagement was not conducted as an assurance engagement under the Standards on Assurance Engagements issued by the ICAI (SAE 3000 (Revised)) or the equivalent international standard (ISAE 3000 (Revised)), or any other assurance or audit standard. Accordingly, PRISM expresses no assurance opinion and no conclusion designed to enhance the confidence of any party as to the Company's compliance with the DPDP Act.",
  "The work is advisory in nature and consisted of the procedures described in section 1.3, agreed with management. Had additional procedures been performed, other matters might have come to our attention.",
  "PRISM relied on information and representations provided by the Company's management through the self-assessment questionnaire without independent verification, and on publicly available information about the Company. PRISM has not audited or otherwise verified that information and assumes no responsibility for its accuracy or completeness.",
  "This report does not constitute legal advice and is not a substitute for advice from qualified Indian legal counsel on the Company's obligations. Statements about the meaning or application of the DPDP Act are the analyst's working interpretation for prioritisation purposes only.",
  "This report has been prepared solely for the internal use of the Board and management of the Company, to assist the Company (and its legal counsel) in planning its DPDP Act compliance programme. It is provided on the basis that it is confidential and, where prepared to assist the provision of legal advice, may be subject to legal privilege. It may not be relied upon by any other person, quoted or referred to, in whole or in part, without PRISM's prior written consent, and PRISM accepts no duty of care or liability to any party other than the Company.",
  "Nothing in this report should be read as a waiver of any legal privilege attaching to it.",
];

// ─── §2.1 Impact & Likelihood scales ───────────────────────────────────────
export const IMPACT_SCALE = [
  { level: 5, name: "Severe", definition: "A core DPDP Act obligation (security, breach notification, children's data, consent, erasure) is unmet at scale. Realistic prospect of a “significant breach” finding under s.33(1), remediation directions, Data Principal claims and sustained reputational damage." },
  { level: 4, name: "Major", definition: "A systemic obligation is unmet affecting a large population of Data Principals, or sensitive / large-volume data is exposed. Board inquiry, corrective directions and adverse publicity are likely on complaint or incident." },
  { level: 3, name: "Moderate", definition: "A clear obligation is unmet or only partially met, causing tangible detriment to an identifiable group of Data Principals. Plausible regulatory interest if raised by a complainant." },
  { level: 2, name: "Minor", definition: "A localised process or documentation gap with limited detriment, correctable within business-as-usual." },
  { level: 1, name: "Insignificant", definition: "A housekeeping or evidencing gap with negligible detriment to Data Principals and no realistic regulatory interest." },
];

export const LIKELIHOOD_SCALE = [
  { level: 5, name: "Almost certain", indicative: ">80%", definition: "The exposure is materialising now or will almost certainly do so within 24 months absent remediation." },
  { level: 4, name: "Likely", indicative: "55–80%", definition: "More likely than not to result in an incident, complaint or adverse finding within 24 months." },
  { level: 3, name: "Possible", indicative: "30–55%", definition: "Could occur within 24 months; depends on complaint volume, an incident, or the timing of the Rules and Board activity." },
  { level: 2, name: "Unlikely", indicative: "10–30%", definition: "Not expected within 24 months but plausible." },
  { level: 1, name: "Rare", indicative: "<10%", definition: "Would require an unusual combination of events." },
];

// ─── §2.2 Risk rating matrix (5×5) ─────────────────────────────────────────
export const RISK_BANDS = [
  { rating: "Critical", min: 20, max: 25, color: "#B91C1C", response: "Unacceptable. Address immediately; escalate to the Board. Interim risk-reduction measures pending full remediation." },
  { rating: "High", min: 12, max: 19, color: "#C2410C", response: "Address within the current planning cycle (0–90 days). Named owner and target date required." },
  { rating: "Medium", min: 6, max: 11, color: "#B45309", response: "Plan remediation within 3–6 months. Monitor for change in likelihood." },
  { rating: "Low", min: 1, max: 5, color: "#15803D", response: "Accept, monitor, or address within business-as-usual." },
];

/** score (impact × likelihood, 1–25) → { rating, color } */
export function riskRating(score) {
  return RISK_BANDS.find(b => score >= b.min && score <= b.max) || RISK_BANDS[RISK_BANDS.length - 1];
}

// Priority letter from the rating, used in the findings register.
export function riskPriority(rating) {
  return { Critical: "P1", High: "P1", Medium: "P3", Low: "P4" }[rating] || "P3";
}

// ─── §3 Capability (maturity) scale ────────────────────────────────────────
export const CAPABILITY_SCALE = [
  { level: 0, name: "Absent", meaning: "No capability. The obligation is not addressed." },
  { level: 1, name: "Initial", meaning: "Ad hoc and undocumented. Any activity depends on individuals." },
  { level: 2, name: "Developing", meaning: "Some practice exists but is informal, inconsistent and not owned." },
  { level: 3, name: "Defined", meaning: "Documented, approved, communicated and consistently applied." },
  { level: 4, name: "Managed", meaning: "Measured with metrics and periodic review; issues are detected and corrected." },
  { level: 5, name: "Optimising", meaning: "Continuously improved; benchmarked; embedded in change and assurance." },
];

/** weighted 0–5 score → capability band name */
export function capabilityBand(score) {
  if (score == null) return "Not assessed";
  const rounded = Math.round(score);
  return (CAPABILITY_SCALE.find(c => c.level === rounded) || CAPABILITY_SCALE[1]).name;
}

// ─── §2.3 Framing regulatory exposure ──────────────────────────────────────
export const S33_INTRO =
  "The Schedule to the DPDP Act sets the maximum monetary penalty the Data Protection Board may impose for each class of breach. A maximum is not a forecast. Section 33(1) permits a penalty only where the Board, after inquiry and a hearing, determines the breach to be “significant”; section 33(2) then requires the Board to have regard to seven matters in fixing the amount. There is no Indian penalty precedent under the Act; the indicative ranges below are analogues drawn from comparable regulatory practice and are provided only to keep the statutory maxima in perspective.";

export const S33_FACTORS = [
  { ref: "(a)", matter: "the nature, gravity and duration of the breach" },
  { ref: "(b)", matter: "the type and nature of the personal data affected by the breach" },
  { ref: "(c)", matter: "the repetitive nature of the breach" },
  { ref: "(d)", matter: "whether the person has realised a gain or avoided a loss as a result of the breach" },
  { ref: "(e)", matter: "whether the person took action to mitigate the effects and consequences of the breach, and the timeliness and effectiveness of that action" },
  { ref: "(f)", matter: "whether the penalty is proportionate and effective, having regard to the need to secure observance of and deter breach of the Act" },
  { ref: "(g)", matter: "the likely impact of the penalty on the person" },
];

export const EXPOSURE_TIERS = [
  {
    tier: "Security safeguards", section: "s.8(5)", statutoryMax: "₹250 crore",
    mitigants: "The duty is preventive. Where no personal data breach has been reported: active remediation (factor (e)), no gain or avoided loss (d), first instance and non-repetitive (c), proportionality and going-concern impact (f, g).",
    indicativeRange: "If no breach occurs: most likely a direction and improvement notice, nil to low penalty. If a breach occurs before safeguards are uplifted: low tens of crore, scaling with the volume and sensitivity of data affected and the adequacy of the response.",
  },
  {
    tier: "Breach notification", section: "s.8(6)", statutoryMax: "₹200 crore",
    mitigants: "Engaged only once a breach occurs; turns heavily on factor (e) — whether the Board and affected Data Principals were told, in the prescribed form and time. Building the notification runbook now is the single largest lever on this tier.",
    indicativeRange: "Nil while no breach has occurred. On a notified, well-handled breach: low. On an unnotified or mishandled breach affecting a large population: mid-to-high tens of crore.",
  },
  {
    tier: "Children's data", section: "s.9", statutoryMax: "₹200 crore",
    mitigants: "Turns on whether children's data is in fact processed and whether tracking or targeted advertising reaches minors (factors (a), (b)). A documented determination that minors are excluded, or a working age-assurance and parental-consent control, is a strong mitigant.",
    indicativeRange: "Nil if a defensible “no children's data” position is documented. If minors are profiled or targeted without parental consent: high — a tier the Board is expected to treat seriously.",
  },
  {
    tier: "Significant Data Fiduciary duties", section: "s.10", statutoryMax: "₹150 crore",
    mitigants: "Only engaged on and after designation. Voluntarily standing up the s.10(2) controls (India-based DPO, independent data auditor, periodic DPIA and audit) ahead of designation removes this tier almost entirely.",
    indicativeRange: "Nil unless and until designated. Post-designation non-compliance: mid tens of crore.",
  },
  {
    tier: "Any other provision (residuary)", section: "Schedule item 7", statutoryMax: "₹50 crore",
    mitigants: "Covers notice, consent, retention, Data Principal rights, grievance redressal and transfer. Individually lower-gravity; aggregated non-compliance across several is what attracts attention. Cooperative remediation, no gain (d) and proportionality (f) all apply.",
    indicativeRange: "Nil to low for isolated, promptly-fixed gaps. Low-to-mid single-digit crore where several rights and consent duties remain unmet after the Rules are in force and complaints accumulate.",
  },
];

export const EXPOSURE_READING_NOTE =
  "The statutory maximum is a ceiling for the most serious, wilful, repeated breach by a large entity — not a base case. Where every finding is pre-breach and the Company is not a repeat offender, the s.33(2) factors all pull a first-instance outcome well below the maximum. The figures set the scale of the obligation, not the expected penalty.";

// ─── §10 Cross-border / localisation ───────────────────────────────────────
export const CROSS_BORDER_TEXT = {
  s16: "Section 16(1) lets the Central Government restrict, by notification, transfers of personal data to specified countries or territories (a “blacklist” model). Until such notifications are issued, transfers are permitted, subject to section 16(2), which preserves any Indian law that imposes a higher degree of protection or a stricter localisation requirement on a class of data or Fiduciary.",
  rbi: "The Reserve Bank of India direction “Storage of Payment System Data” (6 April 2018) requires the entire data relating to payment systems — end-to-end transaction details and information collected, carried or processed as part of the payment instruction — to be stored only in India. RBI's subsequent clarification permits a copy of the foreign leg of a cross-border transaction to be stored abroad, to be purged from foreign systems within the prescribed period. Section 16(2) preserves this requirement.",
  actions: [
    "Record the hosting country of every system in the personal-data inventory.",
    "Adopt a lightweight transfer assessment (TIA) template — recipient, country, data categories, safeguards, contract clauses — and complete one for each SaaS or vendor that stores personal data outside India.",
    "Obtain written confirmation from each payment aggregator, gateway and card processor that payment-system data is stored only in India per the RBI direction, and that any foreign-leg copy is purged on schedule.",
    "Add DPDPA-aligned data-transfer clauses (purpose limitation, security, sub-processing, audit, deletion, cooperation on Data Principal requests) to the standard Data Processing Agreement.",
    "Track the Central Government's section 16 notifications and re-run the transfer assessments when a country is restricted.",
  ],
  practicalPosition:
    "Section 16 is currently permissive — no countries restricted — so the immediate risk is not the Act but (a) not knowing where personal data is hosted and (b) the pre-existing RBI localisation duty for payment data, preserved by s.16(2).",
};

// ─── §12 Framework alignment ───────────────────────────────────────────────
export const FRAMEWORK_ALIGNMENT = [
  { capability: "Governance & accountability; DPO", dpdpa: "s.8(9), s.10(2)(a)", iso27701: "5.2, 6.3", nist: "GOVERN-P", gdpr: "Art. 37–39" },
  { capability: "Records of processing", dpdpa: "s.8(1)", iso27701: "7.2.8 / 8.2.6", nist: "ID.IM-P", gdpr: "Art. 30" },
  { capability: "Notice & transparency", dpdpa: "s.5", iso27701: "7.3", nist: "COMM-P", gdpr: "Art. 12–14" },
  { capability: "Consent & lawful basis", dpdpa: "s.4, s.6, s.7", iso27701: "7.2.2–7.2.4", nist: "CT.PO-P", gdpr: "Art. 6, 7" },
  { capability: "Data Principal rights", dpdpa: "s.11–14", iso27701: "7.3.6–7.3.9", nist: "CT.DM-P", gdpr: "Art. 15–22" },
  { capability: "Retention & minimisation", dpdpa: "s.8(7)", iso27701: "7.4.1, 7.4.7", nist: "CT.DM-P", gdpr: "Art. 5(1)(c),(e)" },
  { capability: "Security safeguards", dpdpa: "s.8(4), s.8(5)", iso27701: "6.x + ISO/IEC 27002", nist: "PR.DS-P, PR.PT-P", gdpr: "Art. 32" },
  { capability: "Breach management", dpdpa: "s.8(6)", iso27701: "6.13", nist: "—", gdpr: "Art. 33, 34" },
  { capability: "Processor management", dpdpa: "s.8(2)", iso27701: "7.2.6, 8.x", nist: "CT.DM-P", gdpr: "Art. 28" },
  { capability: "Children's data", dpdpa: "s.9", iso27701: "7.2.x (age)", nist: "—", gdpr: "Art. 8" },
  { capability: "Cross-border transfer", dpdpa: "s.16", iso27701: "7.5", nist: "—", gdpr: "Art. 44–49" },
  { capability: "DPIA", dpdpa: "s.10(2)(c)", iso27701: "7.2.5", nist: "ID.RA-P", gdpr: "Art. 35" },
];

export const SECTOR_BENCHMARK_FALLBACK =
  "Publicly, DPDPA maturity across Indian industry remains low: most organisations are between “Initial” and “Developing”, with programmes gated on the DPDP Rules being finalised. Common first moves are appointing a DPO, building a data inventory, standing up consent and rights machinery for consumer-facing channels, and remediating third-party and advertising-partner contracts. A weighted current-state maturity around 1–2 out of 5 is typical; organisations of larger data scale are expected to be further ahead.";

// ─── Annexure B — methodology & scoring ────────────────────────────────────
export const METHODOLOGY_NOTES = [
  "Source data: the completed self-assessment questionnaires held in the PRISM platform for the Company, extracted on the report date.",
  "Questionnaire scoring: YES = 1.0, PARTIAL = 0.5, NO = 0.0; N/A excluded; department score = mean of scoreable answers.",
  "Questionnaire completeness: answered (including N/A) ÷ applicable questions, including triggered follow-ups.",
  "Gap = any submission answered NO; Partial = any submission answered PARTIAL and none NO.",
  "Maturity: a 0–5 capability score per privacy domain, derived from the YES / PARTIAL / NO mix of that domain's questions, then weighted (weights sum to 100).",
  "Findings risk = impact (1–5) × likelihood (1–5); bands Critical 20–25, High 12–19, Medium 6–11, Low 1–5. A PARTIAL answer lowers the finding's likelihood by one level versus a NO.",
  "Traceability: each obligation assessed from the questionnaire evidence; coverage = assessed ÷ applicable (non-N/A) obligations.",
  "Section text taken from the Digital Personal Data Protection Act, 2023 and PRISM's maintained provision index.",
  "No information was independently verified. This is an advisory assessment, not an assurance engagement (section 1.5).",
];

// ─── Annexure F — glossary ─────────────────────────────────────────────────
export const GLOSSARY = [
  { term: "DPDP Act / DPDPA", meaning: "The Digital Personal Data Protection Act, 2023 (India)." },
  { term: "DPDP Rules", meaning: "Subordinate rules made under the DPDP Act, prescribing operational detail (form of notice, breach notification, timelines, Consent Managers, etc.)." },
  { term: "Data Principal", meaning: "The individual to whom the personal data relates (equivalent to “data subject”)." },
  { term: "Data Fiduciary", meaning: "The person who alone or with others determines the purpose and means of processing personal data (equivalent to “controller”)." },
  { term: "Data Processor", meaning: "A person who processes personal data on behalf of a Data Fiduciary under a contract." },
  { term: "Significant Data Fiduciary (SDF)", meaning: "A Data Fiduciary or class notified by the Central Government under s.10(1), subject to additional obligations under s.10(2)." },
  { term: "Data Protection Board (DPB / the Board)", meaning: "The adjudicatory body established under the Act to inquire into breaches and impose penalties." },
  { term: "DPO", meaning: "Data Protection Officer — for an SDF, an India-based individual answerable to the Board of Directors and the grievance point of contact (s.10(2)(a))." },
  { term: "Consent Manager", meaning: "A Board-registered entity through which a Data Principal can give, manage and withdraw consent (s.6(7))." },
  { term: "RoPA", meaning: "Records of Processing Activities — the internal register of what personal data is processed, why, and with whom it is shared." },
  { term: "DSR", meaning: "Data Subject Request — a Data Principal exercising a right under s.11–14 (access, correction, erasure, nomination)." },
  { term: "DPIA", meaning: "Data Protection Impact Assessment — a structured assessment of the privacy risk of a processing activity (s.10(2)(c))." },
  { term: "TIA", meaning: "Transfer Impact Assessment — assessment of the risk of transferring personal data outside India (s.16)." },
  { term: "Personal data breach", meaning: "Unauthorised processing, or accidental disclosure, acquisition, sharing, use, alteration, destruction or loss of access to personal data that compromises its confidentiality, integrity or availability." },
  { term: "Legitimate use", meaning: "A ground in s.7 permitting processing without fresh consent for a specified purpose (e.g. voluntary provision, employment, compliance with law)." },
  { term: "ISAE 3000 / SAE 3000", meaning: "Assurance-engagement standards (international / ICAI). This engagement was not performed under either — see section 1.5." },
  { term: "Questionnaire completeness", meaning: "The proportion of a department's applicable questions that received a scoreable answer; distinct from any measure of compliance." },
];

export const DOCUMENTS_REVIEWED = [
  "Privacy notice(s)",
  "Data processing agreements / vendor contracts",
  "Retention schedule / policy",
  "Information security policy set",
  "Incident response plan",
  "Records of processing / data inventory",
  "Prior audit or assessment reports",
];
