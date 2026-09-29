// The static thematic / methodology crosswalk for the Big-4 DPDPA readiness
// report. Nothing here is company-specific.
//
// SOURCE-OF-TRUTH SPLIT (design spec 2026-09-03):
//   • Per-question analysis (why it matters / what good looks like / remediation
//     steps / evidence asks / domain / impact / likelihood) lives in
//     utils/selfAssessQuestionGuidance.js. NOT here.
//   • This file holds only the THEMATIC finding metadata (FINDINGS), the
//     deterministic cross-department CONTRADICTION_RULES, the traceability
//     matrix, the workstream / phasing / policy definitions, and the maturity
//     domain list. No regulatory provision id lives here — regulatoryExposure
//     (aiProvider.js → provisionIndex.js) is the sole source of provisions.
//
// How it is used (utils/readinessAssessment.js):
//   • FINDINGS          — keyed by findingKey. A finding is materialised by
//                         grouping the fired gaps whose guidance.findingKey ===
//                         key (computeFindings). A `synthetic` finding has no
//                         member gap and carries its own impact/likelihood.
//   • CONTRADICTION_RULES — deterministic apparent-tension rules; every `when`
//                         clause must be satisfied by a real submitted answer.
//   • DPDPA_TRACEABILITY — per obligation, a status derived from its trigger
//                         answers, or N/A where `naReason` is set.
//
// ROADMAP_DEFS_VERSION feeds the AI narrative cache fingerprint — bump it on any
// change to FINDINGS, WORKSTREAMS or PHASING.
export const ROADMAP_DEFS_VERSION = "2";

// ─── §3 privacy domains (weights sum to 100) ───────────────────────────────
export const PRIVACY_DOMAINS = [
  { id: "governance", label: "Governance & Accountability", weight: 12, target: 4 },
  { id: "inventory", label: "Data Inventory & Records of Processing", weight: 12, target: 4 },
  { id: "notice", label: "Notice & Transparency", weight: 8, target: 4 },
  { id: "consent", label: "Consent & Lawful Basis", weight: 12, target: 4 },
  { id: "rights", label: "Data Principal Rights & Grievance", weight: 10, target: 4 },
  { id: "retention", label: "Retention & Minimisation", weight: 9, target: 3 },
  { id: "security", label: "Security Safeguards", weight: 13, target: 4 },
  { id: "breach", label: "Personal Data Breach Management", weight: 10, target: 4 },
  { id: "thirdparty", label: "Third-Party / Processor Management", weight: 8, target: 4 },
  { id: "children", label: "Children's Data", weight: 3, target: 3 },
  { id: "training", label: "Training & Awareness", weight: 3, target: 3 },
];

// ─── §5 findings register — THEMATIC metadata only ─────────────────────────
// Keyed by findingKey (matches guidance entries' `findingKey`). Each value:
//   title              short label
//   aggregateObservation  the observation sentence rendered in the register
//   owner, targetWindow   suggested owner + target window
//   workstream         fixed WS membership (deterministic, never AI)
//   synthetic          (optional) "not-assessed" | "single-contributor" — the
//                      finding has no member gap; impact/likelihood are then
//                      taken from this entry rather than a winning gap
//   impact, likelihood (only on synthetic entries)
export const FINDINGS = {
  "no-dpo": {
    title: "No Data Protection Officer or privacy lead",
    aggregateObservation: "No Data Protection Officer or privacy lead has been appointed and no contact for processing queries is published.",
    owner: "Legal / Company Secretary", targetWindow: "0–30 days", workstream: "WS1",
  },
  "no-inventory": {
    title: "No personal-data inventory",
    aggregateObservation: "No inventory of systems or applications that store personal data, and no discovery or classification tooling.",
    owner: "IT / DPO Office", targetWindow: "30–90 days", workstream: "WS2",
  },
  "no-ropa": {
    title: "No Records of Processing",
    aggregateObservation: "No consolidated Records of Processing (purposes, categories, recipients, retention, transfers).",
    owner: "DPO Office", targetWindow: "90–180 days", workstream: "WS2",
  },
  "locate-data": {
    title: "Cannot locate an individual's data across systems",
    aggregateObservation: "Ability to locate a specific individual's data, knowledge of data categories per system and the network segregation diagram are only partial.",
    owner: "IT", targetWindow: "90–180 days", workstream: "WS2",
  },
  "no-consent": {
    title: "No consent process; lawful basis not mapped",
    aggregateObservation: "No documented process to obtain or record consent; lawful basis is not mapped to processing activities.",
    owner: "DPO Office / IT", targetWindow: "90–180 days", workstream: "WS3",
  },
  "no-withdrawal": {
    title: "No consent-withdrawal mechanism",
    aggregateObservation: "Data Principals cannot withdraw consent as easily as they gave it, and opt-out does not reliably propagate.",
    owner: "DPO Office / IT", targetWindow: "90–180 days", workstream: "WS3",
  },
  "marketing-basis": {
    title: "Marketing data used without a verified basis",
    aggregateObservation: "Marketing consent and the basis for marketing data drawn from third-party sources are only partial.",
    owner: "Marketing / DPO Office", targetWindow: "90–180 days", workstream: "WS3",
  },
  "employee-consent": {
    title: "Employee / candidate data sharing without a clear basis",
    aggregateObservation: "Candidate and employee notice or consent before sharing data with third-party HR / payroll processors is only partial.",
    owner: "HR", targetWindow: "30–90 days", workstream: "WS3",
  },
  "notice-gap": {
    title: "Privacy notice not verified against s.5",
    aggregateObservation: "A privacy notice exists but has not been verified against s.5 — itemised data and purposes, language versions, and coverage of every processing activity.",
    owner: "DPO Office / Legal", targetWindow: "90–180 days", workstream: "WS3",
  },
  "no-grievance": {
    title: "No grievance-redressal mechanism",
    aggregateObservation: "No grievance-redressal mechanism for Data Principal complaints.",
    owner: "DPO Office", targetWindow: "30–90 days", workstream: "WS4",
  },
  "no-dsr": {
    title: "No Data Principal rights workflow",
    aggregateObservation: "No end-to-end workflow for the rights to a processing summary (s.11) and to correction / erasure (s.12); confidence in fulfilling a request is low.",
    owner: "DPO Office / IT", targetWindow: "90–180 days", workstream: "WS4",
  },
  "no-nomination": {
    title: "No process for the right to nominate (s.14)",
    aggregateObservation: "No process for the right to nominate another individual to exercise rights on death or incapacity (s.14). The questionnaire does not test s.14.",
    owner: "DPO Office", targetWindow: "90–180 days", workstream: "WS4",
    synthetic: "not-assessed", impact: 2, likelihood: 2,
  },
  "no-retention": {
    title: "No retention schedule",
    aggregateObservation: "No documented retention periods or retention schedule for personal data.",
    owner: "DPO Office / Legal", targetWindow: "90–180 days", workstream: "WS5",
  },
  "no-deletion": {
    title: "Cannot delete an individual's data across every system",
    aggregateObservation: "The organisation cannot reliably delete an individual's data across every relevant system; cross-system deletion and enforcement are only partial.",
    owner: "IT", targetWindow: "90–180 days", workstream: "WS5",
  },
  "minimisation": {
    title: "Data minimisation only partial",
    aggregateObservation: "Data minimisation is only partial and periodic “is this still needed” reviews are informal.",
    owner: "Function heads / DPO Office", targetWindow: "90–180 days", workstream: "WS5",
  },
  "physical-records": {
    title: "Physical records outside privacy controls",
    aggregateObservation: "Physical records containing personal data are not consistently inventoried, secured, scheduled for retention, or securely destroyed.",
    owner: "Finance / Admin", targetWindow: "90–180 days", workstream: "WS5",
  },
  "security-uneven": {
    title: "Uneven technical & organisational safeguards",
    aggregateObservation: "Technical and organisational safeguards are uneven — device management, controls against unauthorised sharing, encryption coverage and centralised monitoring are only partial.",
    owner: "CISO / IT", targetWindow: "90–180 days", workstream: "WS6",
  },
  "mfa-partial": {
    title: "MFA and access monitoring only partial",
    aggregateObservation: "MFA and controls to detect or prevent unauthorised access to personal or financial data are only partial in at least one function.",
    owner: "CISO / Finance", targetWindow: "90–180 days", workstream: "WS6",
  },
  "sdlc": {
    title: "Security & privacy not gated in the SDLC",
    aggregateObservation: "Secure SDLC gates, dependency review, application-log monitoring for personal-data misuse, automated exposure testing and secure decommissioning are only partial.",
    owner: "Engineering / CISO", targetWindow: "90–180 days", workstream: "WS6",
  },
  "pii-masking": {
    title: "PII not masked in outputs; sensitive-record handling weak",
    aggregateObservation: "PII is not masked in reports and communications; sensitive-record access restriction, segregation and test-data handling are only partial.",
    owner: "HR / CISO", targetWindow: "90–180 days", workstream: "WS6",
  },
  "rbac": {
    title: "Role-based access & review not enforced everywhere",
    aggregateObservation: "Role-based access control, periodic access review and the joiner-mover-leaver process are only partially enforced in at least one function.",
    owner: "CISO / IT", targetWindow: "30–90 days", workstream: "WS6",
  },
  "vuln-mgmt": {
    title: "Vulnerability & configuration management gaps",
    aggregateObservation: "VAPT, configuration-baseline review and application vulnerability scanning for personal-data systems are irregular or incomplete.",
    owner: "CISO / IT", targetWindow: "90–180 days", workstream: "WS6",
  },
  "cloud-security": {
    title: "Cloud posture not continuously monitored",
    aggregateObservation: "Cloud environments holding personal data are not continuously monitored for misconfiguration, excessive permissions or public exposure.",
    owner: "CISO / IT", targetWindow: "90–180 days", workstream: "WS6",
  },
  "no-breach-scoping": {
    title: "Cannot scope a personal-data breach",
    aggregateObservation: "The organisation cannot identify which data or individuals an incident affected, and incident response, monitoring and time-to-detect for personal-data scenarios are only partial.",
    owner: "CISO / DPO Office", targetWindow: "90–180 days", workstream: "WS7",
  },
  "no-breach-notification": {
    title: "No breach-notification procedure",
    aggregateObservation: "No documented procedure to notify the Data Protection Board and every affected Data Principal in the prescribed form and time, and no route for externally reported vulnerabilities into the incident process.",
    owner: "DPO Office / Legal", targetWindow: "30–90 days", workstream: "WS7",
  },
  "no-policy-framework": {
    title: "No privacy policy framework",
    aggregateObservation: "No documented privacy policy framework — no RoPA, retention schedule, DSR SOP, breach IR plan, DPA playbook, children's-data policy or transfer assessment template; onboarding/offboarding and contract clauses are only partial.",
    owner: "DPO Office", targetWindow: "30–90 days", workstream: "WS1",
  },
  "no-training": {
    title: "No recurring data-protection training",
    aggregateObservation: "No recurring data-protection training or awareness programme.",
    owner: "HR / DPO Office", targetWindow: "30–90 days", workstream: "WS11",
  },
  "processor-contracts": {
    title: "No standard DPA / processor clauses",
    aggregateObservation: "No standard Data Processing Agreement or processor clause set; DPAs are only partial for payroll, ad platforms and agencies, debt collection, development partners and financial-data sharing.",
    owner: "Legal / Procurement", targetWindow: "90–180 days", workstream: "WS8",
  },
  "processor-register": {
    title: "Processor / third-party register incomplete",
    aggregateObservation: "The register of processors and third parties that handle personal data is only partial, and procurement does not consistently capture personal-data processing.",
    owner: "Procurement / DPO Office", targetWindow: "90–180 days", workstream: "WS8",
  },
  "no-dpia": {
    title: "No DPIA process for high-risk processing",
    aggregateObservation: "No Data Protection Impact Assessment process, methodology or trigger criteria for high-risk processing.",
    owner: "DPO Office", targetWindow: "90–180 days", workstream: "WS11",
  },
  "children": {
    title: "Children's data not addressed",
    aggregateObservation: "Children's personal data is not addressed — no age assurance, no verifiable parental consent, and no control preventing tracking, behavioural monitoring or targeted advertising directed at minors. The questionnaire does not test s.9.",
    owner: "DPO Office / Marketing", targetWindow: "90–180 days", workstream: "WS9",
    synthetic: "not-assessed", impact: 4, likelihood: 3,
  },
  "transfer": {
    title: "Cross-border transfer & localisation not mapped",
    aggregateObservation: "No data map of where personal data is hosted, no transfer impact assessment, and the payment-data localisation position (RBI direction, 6 April 2018) has not been confirmed with payment partners. The questionnaire does not directly test s.16.",
    owner: "IT / Legal", targetWindow: "90–180 days", workstream: "WS10",
    synthetic: "not-assessed", impact: 3, likelihood: 3,
  },
  // ─── Capability-derived findings (environment-first assessment) ─────────────
  // Materialised by grouping fired capability gaps (capabilityLibrary.js →
  // guidance.findingKey), exactly like the question-derived findings above.
  "cap-identity": {
    title: "Identity & access capabilities not fully in place",
    aggregateObservation: "One or more identity and access capabilities the environment calls for — MFA, identity lifecycle automation, privileged access, external identity or secure remote access — are missing or only partial.",
    owner: "CISO / IT", targetWindow: "30–90 days", workstream: "WS6",
  },
  "cap-endpoint": {
    title: "Endpoint & device capabilities not fully in place",
    aggregateObservation: "Endpoint detection, device / mobile management or disk encryption that the environment calls for is missing or only partial on devices that reach personal data.",
    owner: "CISO / IT", targetWindow: "30–90 days", workstream: "WS6",
  },
  "cap-appsec": {
    title: "Application, perimeter & vulnerability capabilities not fully in place",
    aggregateObservation: "Web application firewall, API security, secure-SDLC tooling, vulnerability / patch management or compensating controls for legacy systems are missing or only partial where the environment calls for them.",
    owner: "CISO / Engineering", targetWindow: "90–180 days", workstream: "WS6",
  },
  "cap-data-protection": {
    title: "Data discovery, protection & cloud-posture capabilities not fully in place",
    aggregateObservation: "Data discovery and classification, DLP, database security or cloud posture management is missing or only partial for the personal data the environment holds.",
    owner: "CISO / DPO Office", targetWindow: "90–180 days", workstream: "WS6",
  },
  "cap-monitoring-ir": {
    title: "Security monitoring & incident-response capabilities not fully in place",
    aggregateObservation: "Centralised security monitoring or a rehearsed incident-response and breach-notification process is missing or only partial.",
    owner: "CISO / DPO Office", targetWindow: "30–90 days", workstream: "WS7",
  },
  "cap-resilience": {
    title: "Backup & recovery capabilities not fully in place",
    aggregateObservation: "Protected, restore-tested backups or a tested disaster-recovery capability for systems holding personal data is missing or only partial.",
    owner: "IT / Operations", targetWindow: "90–180 days", workstream: "WS6",
  },
  "cap-vendor-saas": {
    title: "Third-party & SaaS governance capabilities not fully in place",
    aggregateObservation: "Vendor risk management or SaaS discovery and access governance is missing or only partial for the processors and applications that handle personal data.",
    owner: "Procurement / DPO Office", targetWindow: "90–180 days", workstream: "WS8",
  },
  "cap-privacy-ops": {
    title: "Consent, retention & deletion tooling not fully in place",
    aggregateObservation: "Consent and preference management, or enforced retention and deletion, is missing or only partial where personal data is collected and kept.",
    owner: "DPO Office / IT", targetWindow: "90–180 days", workstream: "WS5",
  },
  "cap-asset-governance": {
    title: "Asset inventory not maintained",
    aggregateObservation: "No maintained asset inventory / CMDB, so coverage of every other control cannot be measured against a complete list of systems and devices.",
    owner: "IT / DPO Office", targetWindow: "30–90 days", workstream: "WS2",
  },
  "no-second-reviewer": {
    title: "Self-assessment lacks independent review",
    aggregateObservation: "The self-assessment was completed without an independent second-reviewer sign-off, and covers only part of the assessable DPDP Act obligations.",
    owner: "DPO Office", targetWindow: "0–30 days", workstream: "WS11",
    synthetic: "single-contributor", impact: 2, likelihood: 4,
  },
};

// ─── deterministic cross-department contradiction rules ────────────────────
// A rule fires when EVERY `when` clause is satisfied by a real submitted answer
// (any department). readinessAssessment.computeContradictions records the exact
// (questionId, department, answer) triples that matched. `tension` is
// explanatory text — never a compliance verdict.
export const CONTRADICTION_RULES = [
  {
    id: "delete-without-retention",
    when: [{ q: "it-14", answer: ["YES"] }, { q: "it-12", answer: ["NO", "PARTIAL"] }],
    departmentsHint: ["IT", "Legal"],
    tension: "One function reports it can fully delete an individual's data from all systems, but there is no documented retention schedule defining what a complete deletion covers or when data should be deleted.",
  },
  {
    id: "delete-without-legal-basis",
    when: [{ q: "it-14", answer: ["YES"] }, { q: "lg-2", answer: ["NO", "PARTIAL"] }],
    departmentsHint: ["IT", "Legal"],
    tension: "A full cross-system deletion capability is claimed, yet the legal basis for each category of personal data is not documented — so it is unclear which data must be retained versus deleted.",
  },
  {
    id: "consent-claim-without-process",
    when: [{ q: "lg-3", answer: ["YES"] }, { q: "it-8", answer: ["NO"] }],
    departmentsHint: ["Legal", "IT"],
    tension: "Legal reports that consent mechanisms are in place and recorded, but IT reports no documented process to collect or record consent.",
  },
  {
    id: "marketing-consent-vs-process",
    when: [{ q: "mk-2", answer: ["YES"] }, { q: "it-8", answer: ["NO"] }],
    departmentsHint: ["Marketing", "IT"],
    tension: "Marketing reports that explicit consent is obtained before communications, but there is no organisation-wide consent-capture or record process for that consent to be stored in.",
  },
  {
    id: "dpa-claim-without-register",
    when: [{ q: "lg-5", answer: ["YES"] }, { q: "it-26", answer: ["NO", "PARTIAL"] }],
    departmentsHint: ["Legal", "IT"],
    tension: "Legal reports data processing agreements are in place with all processors, but the list of third parties that process personal data is incomplete — so the population those DPAs should cover is not fully known.",
  },
  {
    id: "dpa-claim-without-op-register",
    when: [{ q: "lg-5", answer: ["YES"] }, { q: "op-2", answer: ["NO", "PARTIAL"] }],
    departmentsHint: ["Legal", "Operations"],
    tension: "DPAs are reported to be in place with all processors, but Operations does not maintain a complete register of processors — the two cannot both be fully true.",
  },
  {
    id: "training-without-policy",
    when: [{ q: "hr-4", answer: ["YES"] }, { q: "hr-2", answer: ["NO", "PARTIAL"] }],
    departmentsHint: ["HR"],
    tension: "Annual data-protection training is reported as delivered, but employment contracts do not consistently include data-protection obligations — the training has no contractual basis to reinforce.",
  },
  {
    id: "breach-understood-vs-scoping",
    when: [{ q: "lg-7", answer: ["YES"] }, { q: "it-29", answer: ["NO"] }],
    departmentsHint: ["Legal", "IT"],
    tension: "Breach-notification obligations are reported as understood and documented, but the organisation cannot identify which data or individuals an incident affected — a notification could not be made accurately.",
  },
  {
    id: "grievance-obligation-vs-mechanism",
    when: [{ q: "lg-7", answer: ["YES"] }, { q: "it-11", answer: ["NO"] }],
    departmentsHint: ["Legal", "IT"],
    tension: "Legal understands the grievance and notification duties, but there is no grievance-redressal mechanism for Data Principals to use.",
  },
  {
    id: "retention-schedule-hr-vs-it",
    when: [{ q: "hr-3", answer: ["YES"] }, { q: "it-12", answer: ["NO"] }],
    departmentsHint: ["HR", "IT"],
    tension: "HR reports a documented retention schedule for employee records, but IT reports no documented retention periods for personal data — retention appears to be defined for one function only.",
  },
  {
    id: "dsr-hr-vs-it",
    when: [{ q: "hr-7", answer: ["YES"] }, { q: "it-10", answer: ["NO", "PARTIAL"] }],
    departmentsHint: ["HR", "IT"],
    tension: "HR reports a process for employee subject-access requests, but there is no defined organisation-wide process for handling Data Principal correction or erasure requests.",
  },
  {
    id: "minimisation-vs-retention",
    when: [{ q: "op-4", answer: ["YES"] }, { q: "it-12", answer: ["NO"] }],
    departmentsHint: ["Operations", "IT"],
    tension: "Operations reports that data minimisation is applied, but with no retention schedule there is no defined point at which retained data is minimised or removed.",
  },
  {
    id: "dp-clauses-vs-standard-dpa",
    when: [{ q: "lg-1", answer: ["YES"] }, { q: "lg-5", answer: ["NO", "PARTIAL"] }],
    departmentsHint: ["Legal"],
    tension: "Data-protection clauses are reported to be in all agreements, but DPAs are not in place with all third-party processors — the clause coverage and the processor coverage do not match.",
  },
  {
    id: "vendor-onboarding-vs-register",
    when: [{ q: "op-1", answer: ["YES"] }, { q: "it-26", answer: ["NO", "PARTIAL"] }],
    departmentsHint: ["Operations", "IT"],
    tension: "Operations reports that data-protection requirements are in vendor onboarding, yet the processor register that onboarding should feed is incomplete.",
  },
  {
    id: "encryption-vs-security-standard",
    when: [{ q: "sw-3", answer: ["YES"] }, { q: "hr-5", answer: ["NO"] }],
    departmentsHint: ["SWE", "HR"],
    tension: "Engineering reports personal data is encrypted in transit and at rest, but PII is not masked in reports and communications — data is protected in storage but exposed in outputs.",
  },
  {
    id: "dpia-vs-methodology",
    when: [{ q: "op-6", answer: ["NO"] }, { q: "lg-2", answer: ["YES"] }],
    departmentsHint: ["Operations", "Legal"],
    tension: "Legal reports a documented legal basis for each category of personal data, but no DPIA process exists to assess the higher-risk processing where that basis is most likely to be contested.",
  },
  {
    id: "access-review-vs-rbac",
    when: [{ q: "it-17", answer: ["YES"] }, { q: "it-16", answer: ["PARTIAL", "NO"] }],
    departmentsHint: ["IT"],
    tension: "Access rights are reported to be periodically reviewed, but role-based access is only partially implemented — reviews without a role model tend to rubber-stamp accumulated access.",
  },
  {
    id: "legal-basis-vs-consent-record",
    when: [{ q: "lg-2", answer: ["YES"] }, { q: "lg-3", answer: ["NO", "PARTIAL"] }],
    departmentsHint: ["Legal"],
    tension: "A documented legal basis for each category of personal data is reported, but consent mechanisms and consent records are only partial — where consent is the stated basis, it may not be evidenced.",
  },
];

// ─── §7 DPDPA traceability matrix (s.4–s.17) ───────────────────────────────
// status derived from triggers: any NO → Non-compliant; else any PARTIAL → Partial;
// else any YES → Compliant (subject to verification); else Not Assessed.
export const DPDPA_TRACEABILITY = [
  { section: "s.4", obligation: "Grounds for processing — personal data may be processed only for a lawful purpose, on consent (s.6) or a legitimate use (s.7).", triggers: ["it-8", "lg-2"], alwaysNotAssessed: true, notAssessedNote: "The questionnaire does not test whether each processing activity is mapped to a lawful ground." },
  { section: "s.5", obligation: "Notice — give the Data Principal an itemised notice of the personal data and purposes, and of how to withdraw consent and complain.", triggers: ["it-7"] },
  { section: "s.5(3)", obligation: "Notice available in English and each language in the Eighth Schedule to the Constitution.", triggers: [], notAssessedNote: "Not tested." },
  { section: "s.6", obligation: "Consent — free, specific, informed, unconditional and unambiguous, by clear affirmative action; limited to the necessary personal data.", triggers: ["it-8", "mk-2", "lg-3"] },
  { section: "s.6(4)-(6)", obligation: "Withdraw consent as easily as given; cease processing within a reasonable time on withdrawal.", triggers: ["it-9", "mk-7"] },
  { section: "s.7", obligation: "Legitimate uses — processing without fresh consent for specified purposes.", triggers: ["lg-2"], alwaysNotAssessed: true, notAssessedNote: "The questionnaire does not test reliance on, or documentation of, legitimate uses." },
  { section: "s.8(1)", obligation: "Accountability — responsible for compliance for all processing by the Fiduciary or a processor on its behalf.", triggers: ["it-1", "it-4", "it-26", "op-2"] },
  { section: "s.8(2)", obligation: "Engage a Data Processor only under a valid contract.", triggers: ["hr-1a", "hr-1b", "mk-6", "lg-5", "fi-8"] },
  { section: "s.8(4)", obligation: "Implement appropriate technical and organisational measures to give effect to the Act.", triggers: ["hr-2", "hr-4", "hr-10", "op-1"] },
  { section: "s.8(5)", obligation: "Protect personal data by reasonable security safeguards to prevent a personal data breach.", triggers: ["it-15", "it-16", "it-20", "it-21", "it-30", "fi-2", "sw-2", "hr-5", "hr-6"] },
  { section: "s.8(6)", obligation: "Notify the Board and each affected Data Principal of a personal data breach.", triggers: ["it-28", "it-29", "lg-7"] },
  { section: "s.8(7)", obligation: "Erase personal data on withdrawal of consent or when the purpose is no longer served, unless retention is legally required.", triggers: ["it-12", "it-13", "it-33", "hr-3", "fi-5"] },
  { section: "s.8(9)", obligation: "Publish the business contact of a Data Protection Officer or a person able to answer processing questions.", triggers: ["lg-6"] },
  { section: "s.8(10)", obligation: "Establish an effective mechanism to redress Data Principal grievances.", triggers: ["it-11"] },
  { section: "s.9", obligation: "Children — verifiable parental consent; no detrimental processing; no tracking, behavioural monitoring or targeted advertising directed at children.", triggers: [], notAssessedNote: "Coverage gap — the questionnaire contains no s.9 question. Not a finding of compliance." },
  { section: "s.10", obligation: "Additional obligations of a Significant Data Fiduciary — India-based DPO, independent data auditor, periodic DPIA and audit.", triggers: ["op-6"], naReason: "The Company has not been notified as a Significant Data Fiduciary. Designation likelihood is assessed in section 9." },
  { section: "s.11", obligation: "Right to a summary of personal data processed and of processing activities, and the identities of Fiduciaries / Processors with whom it has been shared.", triggers: ["it-32", "it-10"] },
  { section: "s.12", obligation: "Right to correction, completion, updating and erasure.", triggers: ["it-10", "it-33", "hr-7"] },
  { section: "s.13", obligation: "Right of grievance redressal, to be exercised first with the Fiduciary / Consent Manager.", triggers: ["it-11"] },
  { section: "s.14", obligation: "Right to nominate another individual to exercise rights on death or incapacity.", triggers: [], notAssessedNote: "Not tested; manner to be prescribed by the Rules." },
  { section: "s.15", obligation: "Duties of the Data Principal (no false particulars, no frivolous complaints, etc.).", triggers: [], naReason: "Obligations fall on the Data Principal, not the Data Fiduciary." },
  { section: "s.16", obligation: "Processing of personal data outside India — transfer may be restricted to countries notified by the Central Government; stricter sectoral localisation is preserved.", triggers: ["fi-1", "fi-4"], notAssessedNote: "No data-hosting map, no transfer assessment, RBI payment-data localisation not confirmed." },
  { section: "s.17", obligation: "Exemptions (certain state processing, legal claims, research/archiving/statistics, notified classes).", triggers: [], naReason: "No exemption is relied on for the processing in scope." },
];

// ─── §8 role map — generic data-flow templates ─────────────────────────────
export const DATA_FLOW_TEMPLATES = [
  { flow: "Employee, contractor and candidate data", personalData: "Identity, contact, payroll, bank, statutory IDs, background checks", role: "Data Fiduciary", counterparty: "HRMS / payroll provider, background-check vendor = Data Processors", touchpoints: "s.5, s.6/s.7, s.8(2), s.8(7), s.11–13", statusTriggers: ["hr-1", "hr-1a", "hr-1c"] },
  { flow: "Customer / booking / consumer data", personalData: "Name, contact, transaction / booking history, payment token", role: "Data Fiduciary for own-channel; potentially Data Processor where operated for a partner", counterparty: "Aggregator / platform / payment gateway", touchpoints: "s.8(2), s.8(5), s.8(7), s.16 (payment data)", statusTriggers: ["it-3", "it-32"] },
  { flow: "Marketing & campaign data from third-party sources", personalData: "Prospect contact, segments, enrichment attributes", role: "Data Fiduciary (joint-responsibility questions with data suppliers)", counterparty: "Data brokers / ad platforms / agencies = suppliers & Processors", touchpoints: "s.4, s.6, s.8(2), s.16", statusTriggers: ["mk-1", "mk-2", "mk-6"] },
  { flow: "Vendor & supplier master data (procurement)", personalData: "Business contact, bank, PAN/GST, MSME data", role: "Data Fiduciary", counterparty: "ERP / procurement SaaS = Processors", touchpoints: "s.8(1)-(2), s.8(5), s.8(7)", statusTriggers: ["op-1", "op-2"] },
  { flow: "Debt recovery / collections", personalData: "Debtor identity, contact, amount, communications", role: "Data Fiduciary", counterparty: "Collections agency = Data Processor", touchpoints: "s.8(2), s.8(5), s.8(7), s.6", statusTriggers: ["fi-8"] },
  { flow: "Financial & payment records", personalData: "Bank details, card/payment data, transaction records", role: "Data Fiduciary", counterparty: "Payment gateways, banks, card processors = Processors / co-Fiduciaries", touchpoints: "s.8(2), s.8(5), s.16 (RBI localisation)", statusTriggers: ["fi-1", "fi-2", "fi-4"] },
  { flow: "IT & SaaS platforms hosting personal data", personalData: "All of the above, at rest and in transit", role: "Data Fiduciary", counterparty: "Cloud / SaaS providers = Data Processors", touchpoints: "s.8(2), s.8(4)-(5), s.16", statusTriggers: ["it-1", "it-26"] },
];

// ─── §9 SDF designation-likelihood — the s.10(1) factors ───────────────────
export const SDF_FACTORS = [
  { ref: "(a)", factor: "Volume and sensitivity of personal data processed" },
  { ref: "(b)", factor: "Risk to the rights of Data Principals" },
  { ref: "(c)", factor: "Potential impact on the sovereignty and integrity of India" },
  { ref: "(d)", factor: "Risk to electoral democracy" },
  { ref: "(e)", factor: "Security of the State" },
  { ref: "(f)", factor: "Public order" },
];

// ─── §11.4 / Annexure C — policy & governance inventory ────────────────────
export const POLICY_INVENTORY = [
  { artifact: "Personal Data Protection Policy", pri: "P1", ws: "WS1", owner: "DPO", purpose: "Top-level policy stating principles, roles and the compliance framework." },
  { artifact: "Records of Processing (RoPA)", pri: "P1", ws: "WS2", owner: "DPO / function heads", purpose: "Living register of processing activities: purpose, categories, recipients, retention, transfers." },
  { artifact: "Data Retention Schedule", pri: "P1", ws: "WS5", owner: "DPO / Legal", purpose: "Retention period and disposal method per data category and purpose, with legal basis for retention." },
  { artifact: "Privacy Notice(s)", pri: "P1", ws: "WS3", owner: "DPO / Legal", purpose: "External s.5 notices per touchpoint, with language versions." },
  { artifact: "Consent & Preference Management Standard", pri: "P1", ws: "WS3", owner: "DPO / IT", purpose: "How consent is captured, recorded, refreshed and withdrawn; preference centre design." },
  { artifact: "Data Subject Rights (DSR) SOP", pri: "P1", ws: "WS4", owner: "DPO", purpose: "Intake, identity verification, search, review, response and timelines for s.11–14 requests." },
  { artifact: "Grievance Redressal Procedure", pri: "P1", ws: "WS4", owner: "DPO", purpose: "Channel, triage, ownership, SLA and register for Data Principal complaints (s.8(10), s.13)." },
  { artifact: "Personal Data Breach IR Plan", pri: "P1", ws: "WS7", owner: "CISO / DPO", purpose: "Detection, assessment, containment, breach scoping, Board and Data Principal notification, evidence log (s.8(6))." },
  { artifact: "Data Processor / DPA Playbook", pri: "P1", ws: "WS8", owner: "Legal / DPO", purpose: "Standard DPA, clause library, risk tiering and processor assurance cadence (s.8(2))." },
  { artifact: "Children's Data Policy", pri: "P2", ws: "WS9", owner: "DPO", purpose: "Position on minors' data, age assurance, parental consent and advertising exclusions (s.9)." },
  { artifact: "Cross-Border Transfer & Localisation Standard", pri: "P2", ws: "WS10", owner: "DPO / Legal", purpose: "Transfer assessment (TIA) template, approval workflow, RBI payment-data localisation controls (s.16)." },
  { artifact: "Data Classification & Handling Standard", pri: "P2", ws: "WS6", owner: "CISO", purpose: "Classification tiers and handling rules, including PII masking in outputs (s.8(5))." },
  { artifact: "DPIA Methodology & Template", pri: "P2", ws: "WS1", owner: "DPO", purpose: "Trigger criteria, assessment template and sign-off for high-risk processing (s.10(2)(c))." },
  { artifact: "Privacy Training Curriculum", pri: "P2", ws: "WS11", owner: "DPO / HR", purpose: "All-staff and role-based modules; onboarding module; refresh cadence." },
];

// ─── §11.1 workstreams ────────────────────────────────────────────────────
export const WORKSTREAMS = [
  { id: "WS1", name: "Governance & DPO Office", objective: "Establish accountable ownership and the operating rhythm for the programme. DPO / privacy lead appointed and published; privacy RACI; steering committee and working group terms of reference; programme plan and budget; Board reporting pack.", deps: "—", effort: "M", cost: "Low", findingKeys: ["no-dpo", "no-policy-framework", "no-second-reviewer"] },
  { id: "WS2", name: "Data Discovery, RoPA & Mapping", objective: "Know what personal data exists, where, why and with whom. Personal-data discovery; system-of-record inventory (with hosting location); Records of Processing; current data-flow and segregation diagram; data-subject search capability.", deps: "WS1", effort: "L", cost: "Medium", findingKeys: ["no-inventory", "locate-data", "no-ropa", "processor-register", "cap-asset-governance"] },
  { id: "WS3", name: "Notice, Consent & Lawful Basis", objective: "Put every processing activity on a defensible legal footing with a compliant notice. Lawful-basis map; re-drafted s.5 notices with language versions; consent capture bundled with notice; consent / preference record; withdrawal channel with downstream propagation.", deps: "WS2", effort: "L", cost: "Medium", findingKeys: ["notice-gap", "no-consent", "no-withdrawal", "marketing-basis", "employee-consent"] },
  { id: "WS4", name: "Data Principal Rights & Grievance", objective: "Be able to receive and fulfil rights requests and complaints within statutory timelines. Published grievance channel and complaints register; DSR SOP (access, correction, erasure, nomination) with identity verification and response templates; per-system fulfilment testing.", deps: "WS2", effort: "M", cost: "Medium", findingKeys: ["no-grievance", "no-dsr", "no-nomination"] },
  { id: "WS5", name: "Retention & Minimisation", objective: "Keep personal data only as long as a purpose or law requires, and be able to delete it. Retention schedule by category and purpose; minimisation standard; retention / deletion enforcement per system; end-to-end deletion evidence; annual data-holding reviews; secure handling of physical records.", deps: "WS2", effort: "M", cost: "Medium", findingKeys: ["no-retention", "no-deletion", "minimisation", "physical-records", "cap-privacy-ops"] },
  { id: "WS6", name: "Security Safeguards Uplift", objective: "Close the data-centric security gaps and make safeguards demonstrable. MDM completion; DLP / egress controls for personal data; SIEM with personal-data use cases; MFA on all finance and payment systems; PII masking standard; RBAC and access-review extension; secure-SDLC and decommissioning gates; vulnerability management and cloud posture.", deps: "WS1", effort: "L", cost: "High", findingKeys: ["security-uneven", "mfa-partial", "sdlc", "pii-masking", "rbac", "vuln-mgmt", "cloud-security", "cap-identity", "cap-endpoint", "cap-appsec", "cap-data-protection", "cap-resilience"] },
  { id: "WS7", name: "Breach Management & IR", objective: "Detect, scope and notify a personal-data breach in the prescribed form and time. Personal-data breach IR runbook; breach-scoping method; Board and Data Principal notification templates and timelines; evidence log; tabletop exercise.", deps: "WS2, WS6", effort: "M", cost: "Medium", findingKeys: ["no-breach-scoping", "no-breach-notification", "cap-monitoring-ir"] },
  { id: "WS8", name: "Third-Party / Processor Governance", objective: "Ensure every processor is under a compliant contract and is overseen. Processor register completion; standard DPA and clause library; prioritised contract-remediation programme; procurement personal-data screening; periodic processor assurance.", deps: "WS2", effort: "M", cost: "Medium", findingKeys: ["processor-contracts", "processor-register", "cap-vendor-saas"] },
  { id: "WS9", name: "Children's Data & Age Assurance", objective: "Determine and control exposure to minors' personal data. Per-product determination and documented position; if in scope: age-assurance control, verifiable parental consent, exclusion of minors from tracking and targeted advertising; children's-data policy.", deps: "WS2, WS3", effort: "M", cost: "Medium", findingKeys: ["children"] },
  { id: "WS10", name: "Cross-Border Transfer & Localisation", objective: "Control and evidence where personal data goes. Hosting-location register; transfer assessment template and completed assessments; RBI payment-data localisation confirmations; transfer clauses in the DPA; section 16 notification watch.", deps: "WS2, WS8", effort: "S", cost: "Low", findingKeys: ["transfer"] },
  { id: "WS11", name: "Training, Awareness & Assurance", objective: "Build privacy capability and a repeatable assurance cycle. Role-based training curriculum and onboarding module; privacy champions network; annual self-assessment with function-head ownership and second-reviewer sign-off; readiness for an independent audit if designated.", deps: "WS1", effort: "M", cost: "Low", findingKeys: ["no-training", "no-dpia", "no-second-reviewer"] },
];

// ─── §11.3 target operating model ─────────────────────────────────────────
export const TOM_ROLES = [
  { role: "Data Protection Officer / Privacy Lead", responsibility: "Owns the programme; single point of accountability to the Board; grievance point of contact; regulator liaison; approves policies, DPIAs and transfer assessments." },
  { role: "Privacy Analyst(s) (1–2)", responsibility: "Run the RoPA, DSR queue, consent records, processor register and training; support DPIAs; prepare Board reporting." },
  { role: "Privacy Champions (federated)", responsibility: "One named person per function maintaining their RoPA entries and first-line queries." },
  { role: "CISO (partner)", responsibility: "Owns s.8(4)-(5) security safeguards, breach detection and the SIEM; joint owner of the breach IR plan." },
  { role: "Legal / Company Secretary (partner)", responsibility: "Owns statutory interpretation, contract clauses, Board governance and privilege." },
];

export const TOM_FORUMS = [
  { forum: "Privacy Steering Committee", cadence: "Quarterly", membership: "GC (chair), DPO, CISO, CFO, CHRO, Head of IT, Head of Sales", remit: "Approves the plan and budget; accepts or challenges residual risk; reviews the findings register, breach log and complaints trend; sponsors escalations." },
  { forum: "Privacy Working Group", cadence: "Monthly", membership: "DPO (chair), privacy champions, IT, Engineering, Procurement", remit: "Runs delivery of the workstreams; clears blockers; reviews new or changed processing and DPIA triggers." },
  { forum: "Board / Risk Committee", cadence: "Half-yearly or on a significant event", membership: "Board / Risk Committee members", remit: "Receives the maturity and residual-risk position; approves risk appetite; is notified of any significant personal data breach." },
];

export const PHASING = [
  { phase: "Phase 0 — Mobilise (0–30 days)", items: ["WS1: appoint and publish the DPO / privacy lead; convene the steering committee.", "WS7: interim breach-notification checklist so the s.8(6) duty can be met if an incident occurs before the full runbook is ready.", "WS11: re-run the self-assessment with function-head ownership and second-reviewer sign-off; scope the coverage gaps.", "Board: approve the programme, budget and risk appetite."] },
  { phase: "Phase 1 — Foundations (30–90 days)", items: ["WS2: data discovery and the system inventory (the dependency for almost everything else).", "WS1: approve the policy framework and RACI.", "WS4: publish the grievance channel and register.", "WS6: MFA on finance / payment systems; RBAC remediation.", "WS8: adopt the standard DPA; start contract remediation with payroll, ad-tech and collections."] },
  { phase: "Phase 2 — Build (90–180 days)", items: ["WS3: lawful-basis map, re-drafted notices, consent capture and withdrawal.", "WS4: DSR SOP and per-system fulfilment testing.", "WS5: retention schedule and first deletion enforcement.", "WS7: full breach IR runbook and tabletop.", "WS9: children's-data determination and, if needed, age-assurance design.", "WS10: hosting-location register and transfer assessments."] },
  { phase: "Phase 3 — Operate & Assure (180–365 days)", items: ["WS5: deletion enforcement across remaining systems; first annual data-holding review.", "WS6: DLP, SIEM use cases, secure-SDLC gates.", "WS8: complete the contract-remediation programme; first processor assurance cycle.", "WS11: annual training delivered; readiness for an independent data audit if designation follows.", "Programme: second maturity assessment to measure movement against this baseline."] },
];

export const CRITICAL_PATH_NOTE =
  "WS1 (governance / DPO) and WS2 (data discovery / inventory) gate almost everything else. Consent, rights, retention, breach-scoping, processor governance and transfers all depend on knowing what personal data exists and where. Start both in Phase 0–1 and resource WS2 properly.";
