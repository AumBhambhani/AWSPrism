// Per-question remediation guidance for the DPDPA self-assessment readiness
// report. This module is the SOURCE OF TRUTH for the per-gap analysis rendered
// in Annexure G — Gap Remediation Detail and (grouped by `findingKey`) the
// thematic Findings Register.
//
// It is a STATIC dataset: AI-drafted, then human-reviewed. It is NOT a runtime
// AI dependency. The report's deterministic assessment reads `domain`,
// `impact`, `likelihood`, `findingKey`, and the four content fields off each
// entry; the AI layer may only add one optional "in your context" sentence per
// gap on top of this.
//
// RULES
//  - No regulatory provision id / URL / penalty lives here. Provisions come only
//    from the grounded regulatory-exposure mapping (utils/aiProvider.js →
//    provisionIndex.js). See the design spec §5.1 / §5.2.
//  - `findingKey` must exist in FINDINGS (selfAssessmentCrosswalk.js).
//  - `domain` must be a PRIVACY_DOMAINS id.
//  - `gapId` (assigned in readinessAssessment.computeGaps) always equals the
//    submission question id. guidanceFor() may resolve a `${dept}-N` custom
//    question to a shared `generic-N` entry; that never changes the gapId.
//  - Review metadata invariant:
//      ai_draft | needs_revision  → reviewedAt === null && reviewedBy === null
//      reviewed | approved        → reviewedAt !== null && reviewedBy !== null
//    Moving an entry back to needs_revision clears both fields.
//
// Bump GUIDANCE_VERSION on any semantic content change — it feeds the AI cache
// fingerprint (routes/selfAssessment.js resolveNarrative).

import { capabilityGuidanceFor } from "../data/capabilityLibrary.js";

export const GUIDANCE_VERSION = "1";

const DRAFT = { reviewStatus: "ai_draft", reviewedAt: null, reviewedBy: null };

/** @typedef {"S"|"M"|"L"} Effort  S: <2 person-weeks, M: 2–8, L: >8 */

export const GUIDANCE = {
  // ─────────────────────────────────────────────────────────────── IT ──
  "it-1": {
    findingKey: "no-inventory", domain: "inventory", impact: 4, likelihood: 5,
    whyItMatters: "Without a register of systems that hold personal data the organisation cannot answer a s.11 access request, scope a s.8(6) breach, apply retention, or evidence s.8(1) accountability. Every downstream privacy control depends on knowing where personal data lives.",
    goodLooksLike: "A maintained system-of-record inventory: each application/store, the personal-data categories it holds, record volume, business owner, hosting country, and processor status; reviewed at least quarterly and on any new system go-live.",
    remediation: [
      { step: "Run a personal-data discovery exercise across cloud, SaaS and on-prem file stores (tooling or a structured owner survey)", effort: "M" },
      { step: "Stand up the inventory register with the columns above (a controlled spreadsheet is acceptable for v1)", effort: "S" },
      { step: "Assign every system a named business owner accountable for keeping its row current", effort: "S" },
      { step: "Add a \"does this hold personal data?\" question to procurement / new-system intake so the inventory stays complete", effort: "S" },
    ],
    evidenceAsks: ["The current system-of-record inventory, dated", "The discovery scan output or the survey and its responses", "Evidence of the review cycle (change log or review minutes)"],
    ...DRAFT,
  },
  "it-2": {
    findingKey: "no-ropa", domain: "inventory", impact: 3, likelihood: 4,
    whyItMatters: "If the organisation does not know which personal-data categories each system holds, it cannot build Records of Processing, judge sensitivity, or respond accurately to a Data Principal.",
    goodLooksLike: "Each inventory entry is broken down to data-element level (identity, contact, financial, behavioural, special category) with the processing purpose recorded.",
    remediation: [
      { step: "Extend the system inventory to data-element level with each system's owner", effort: "M" },
      { step: "Tag elements that are financial, health, or otherwise sensitive for prioritised control", effort: "S" },
      { step: "Record the processing purpose(s) per system as the basis for the RoPA", effort: "S" },
    ],
    evidenceAsks: ["The data-element breakdown per system", "The sensitivity tagging criteria and results"],
    ...DRAFT,
  },
  "it-3": {
    findingKey: "locate-data", domain: "inventory", impact: 3, likelihood: 4,
    whyItMatters: "Inability to locate one individual's data across systems means s.11 (summary), s.12 (correction/erasure) and s.8(6) breach scoping cannot be met within statutory timelines.",
    goodLooksLike: "A documented method (identifiers, search runbooks, or a DSR tool) that returns every record for a given Data Principal across all in-scope systems within a defined SLA.",
    remediation: [
      { step: "Map the primary and secondary identifiers used for a person in each system (email, phone, customer id, employee id)", effort: "M" },
      { step: "Write a per-system search runbook or configure a DSR search capability", effort: "M" },
      { step: "Dry-run a mock access request end to end and time it", effort: "S" },
    ],
    evidenceAsks: ["The identifier map", "A completed mock-DSR search with timings"],
    ...DRAFT,
  },
  "it-4": {
    findingKey: "no-inventory", domain: "inventory", impact: 4, likelihood: 5,
    whyItMatters: "No discovery or classification tooling means the inventory will drift out of date and shadow data stores go untracked — the accountability gap under s.8(1) persists even after a one-off inventory.",
    goodLooksLike: "A repeatable discovery capability (scheduled scans or a classification service) that flags new stores of personal data and feeds the inventory.",
    remediation: [
      { step: "Select a data-discovery / classification approach proportionate to the estate (native cloud tools, a dedicated scanner, or a quarterly owner attestation)", effort: "M" },
      { step: "Schedule recurring discovery and route findings to the inventory owner", effort: "S" },
    ],
    evidenceAsks: ["The discovery tool configuration or the attestation schedule", "Two consecutive discovery run outputs showing the delta"],
    ...DRAFT,
  },
  "it-5": {
    findingKey: "locate-data", domain: "inventory", impact: 3, likelihood: 3,
    whyItMatters: "Without a current network and segregation diagram, incident responders cannot reason about blast radius and auditors cannot confirm that personal data is isolated from lower-trust zones.",
    goodLooksLike: "An up-to-date network / data-flow diagram showing zones, trust boundaries, and where personal data crosses them; refreshed on significant architecture change.",
    remediation: [
      { step: "Produce a current-state network and data-flow diagram covering the systems in the inventory", effort: "M" },
      { step: "Mark the segregation boundaries and any personal-data flows that cross them", effort: "S" },
      { step: "Put the diagram under change control tied to architecture review", effort: "S" },
    ],
    evidenceAsks: ["The current network / data-flow diagram, dated", "The change-control record for the diagram"],
    ...DRAFT,
  },
  "it-6": {
    findingKey: "vuln-mgmt", domain: "security", impact: 3, likelihood: 3,
    whyItMatters: "Irregular VAPT and configuration review leave exploitable weaknesses in systems holding personal data undetected, weakening the s.8(5) \"reasonable security safeguards\" position.",
    goodLooksLike: "Scheduled internal and independent VAPT (at least annually and on major change), configuration baselines checked continuously, findings tracked to closure with SLAs by severity.",
    remediation: [
      { step: "Define a VAPT schedule (annual independent test + pre-release tests for personal-data systems)", effort: "S" },
      { step: "Adopt hardening baselines (CIS or vendor) and monitor drift", effort: "M" },
      { step: "Track findings in a register with severity-based remediation SLAs", effort: "S" },
    ],
    evidenceAsks: ["The two most recent VAPT reports and the remediation tracker", "The configuration-baseline standard and a drift report"],
    ...DRAFT,
  },
  "it-7": {
    findingKey: "notice-gap", domain: "notice", impact: 3, likelihood: 3,
    whyItMatters: "A privacy notice that has not been tested against s.5 may omit itemised data and purposes, the withdrawal and grievance routes, or the required language versions — and it may not cover every collection touchpoint.",
    goodLooksLike: "A notice (or notice set) that itemises the personal data and specified purposes, states how to withdraw consent and complain, is available in English and the relevant Eighth Schedule languages, and is deployed at every collection point.",
    remediation: [
      { step: "Gap-review the current notice against s.5(1)–(3) clause by clause", effort: "S" },
      { step: "Re-draft to close the gaps; produce the required language versions", effort: "M" },
      { step: "Deploy the right notice at every touchpoint (web, app, wifi, careers, CCTV, in-venue, advertising)", effort: "M" },
    ],
    evidenceAsks: ["The s.5 clause-by-clause gap review", "The published notice(s) and their language versions", "A touchpoint-to-notice mapping"],
    ...DRAFT,
  },
  "it-8": {
    findingKey: "no-consent", domain: "consent", impact: 4, likelihood: 5,
    whyItMatters: "With no process to obtain or record consent, processing that relies on consent has no lawful basis under s.4/s.6 and the organisation cannot prove consent if challenged.",
    goodLooksLike: "Each processing activity is mapped to consent or a s.7 legitimate use; where consent applies, it is captured by clear affirmative action, bundled with the s.5 notice, and stored in a consent/preference record with timestamp and version.",
    remediation: [
      { step: "Build the lawful-basis map: every processing activity → consent or a named s.7 legitimate use", effort: "M" },
      { step: "Implement consent capture (affirmative action, no pre-ticks) presented with the s.5 notice", effort: "L" },
      { step: "Stand up a consent / preference store recording purpose, timestamp, notice version and channel", effort: "M" },
    ],
    evidenceAsks: ["The lawful-basis map", "A sample of consent records showing timestamp and notice version", "The consent-capture UI / script"],
    ...DRAFT,
  },
  "it-9": {
    findingKey: "no-withdrawal", domain: "consent", impact: 4, likelihood: 4,
    whyItMatters: "s.6(4)–(6) requires withdrawal to be as easy as giving consent and processing to stop within a reasonable time. No withdrawal channel is a direct non-compliance and a common complaint trigger.",
    goodLooksLike: "A self-service withdrawal route (and an assisted one) that propagates to every downstream system and processor within a defined SLA, with the withdrawal recorded.",
    remediation: [
      { step: "Add a withdrawal control to the preference centre and every consent point", effort: "M" },
      { step: "Define the downstream propagation path and SLA to systems and processors", effort: "M" },
      { step: "Log each withdrawal and its completion across systems", effort: "S" },
    ],
    evidenceAsks: ["The withdrawal UI / process", "The propagation design and SLA", "A sample withdrawal with the downstream completion log"],
    ...DRAFT,
  },
  "it-10": {
    findingKey: "no-dsr", domain: "rights", impact: 4, likelihood: 4,
    whyItMatters: "Without a defined process for correction and erasure requests (s.12), the organisation cannot meet statutory timelines and risks either ignoring valid requests or acting on unverified ones.",
    goodLooksLike: "A DSR SOP covering intake, identity verification, search, review, action, response templates and timelines — tested against every major system.",
    remediation: [
      { step: "Write the DSR SOP for access, correction, completion, updating and erasure", effort: "M" },
      { step: "Define the identity-verification step proportionate to risk", effort: "S" },
      { step: "Test the SOP end to end against each major system and record the result", effort: "M" },
    ],
    evidenceAsks: ["The DSR SOP", "The identity-verification procedure", "A completed test run per major system"],
    ...DRAFT,
  },
  "it-11": {
    findingKey: "no-grievance", domain: "rights", impact: 4, likelihood: 4,
    whyItMatters: "s.8(10) / s.13 require an effective grievance-redressal mechanism. Its absence means Data Principals must go straight to the Board, and the organisation has no early-warning signal for systemic issues.",
    goodLooksLike: "A published grievance channel with a named owner, a statutory-aligned response SLA, a triage process, and a complaints register reported to the privacy steering committee.",
    remediation: [
      { step: "Publish a grievance channel (form + email) with an owner and SLA in the privacy notice and website", effort: "S" },
      { step: "Define triage, escalation and response templates", effort: "S" },
      { step: "Maintain a complaints register and report volumes/trends to governance", effort: "S" },
    ],
    evidenceAsks: ["The published grievance channel", "The complaints register", "A governance report showing complaint trends"],
    ...DRAFT,
  },
  "it-12": {
    findingKey: "no-retention", domain: "retention", impact: 4, likelihood: 4,
    whyItMatters: "s.8(7) requires erasure once the purpose is served unless the law requires retention. With no documented retention periods, data is kept indefinitely by default — expanding breach exposure and DSR effort.",
    goodLooksLike: "A retention schedule by data category and purpose, citing the statutory minimum where one applies (tax, labour, sectoral), with review dates and a disposal method.",
    remediation: [
      { step: "Draft the retention schedule per data category and purpose with Legal input on statutory minimums", effort: "M" },
      { step: "Approve it at the privacy steering committee and publish internally", effort: "S" },
      { step: "Assign each category an owner and a periodic review date", effort: "S" },
    ],
    evidenceAsks: ["The approved retention schedule", "The legal basis notes for each retention period"],
    ...DRAFT,
  },
  "it-13": {
    findingKey: "no-deletion", domain: "retention", impact: 4, likelihood: 4,
    whyItMatters: "If retention/deletion rules are not technically enforced, the retention schedule is aspirational and s.8(7) erasure cannot be demonstrated.",
    goodLooksLike: "Retention is enforced per system by native TTL, scheduled purge jobs, or documented manual runbooks with evidence of execution.",
    remediation: [
      { step: "For each system, choose an enforcement mechanism (native lifecycle policy, scripted purge, or evidenced manual runbook)", effort: "M" },
      { step: "Implement and schedule the enforcement, starting with the highest-volume stores", effort: "L" },
      { step: "Capture execution evidence (job logs / completion records)", effort: "S" },
    ],
    evidenceAsks: ["The per-system enforcement design", "Purge-job logs or manual runbook completion records"],
    ...DRAFT,
  },
  "it-14": {
    findingKey: "no-deletion", domain: "retention", impact: 4, likelihood: 4,
    whyItMatters: "The ability to delete an individual's data from every relevant system is the operational test of s.8(7) and s.12 erasure. A claimed capability that is not proven end to end will fail under a real request.",
    goodLooksLike: "A demonstrated end-to-end deletion: given one Data Principal, every system (including backups, logs and processor copies) is purged or the retained copy is justified and time-boxed.",
    remediation: [
      { step: "Enumerate every system, backup set and processor that could hold a given person's data", effort: "M" },
      { step: "Define the deletion action and any lawful retention exception per location", effort: "M" },
      { step: "Execute a full end-to-end deletion for a test subject and evidence it", effort: "M" },
    ],
    evidenceAsks: ["The deletion coverage map (systems + backups + processors)", "An evidenced end-to-end deletion for a test subject"],
    ...DRAFT,
  },
  "it-15": {
    findingKey: "mfa-partial", domain: "security", impact: 4, likelihood: 3,
    whyItMatters: "MFA is a baseline s.8(5) safeguard against account takeover, the most common route to a personal-data breach. Partial coverage leaves the weakest accounts exposed.",
    goodLooksLike: "MFA enforced for all employees on all systems that can reach personal data, including admin consoles, VPN and email, with phishing-resistant factors for privileged accounts.",
    remediation: [
      { step: "Inventory every authentication surface that reaches personal data", effort: "S" },
      { step: "Enforce MFA org-wide with conditional-access policies; no exemptions without sign-off", effort: "M" },
      { step: "Upgrade privileged accounts to phishing-resistant MFA", effort: "M" },
    ],
    evidenceAsks: ["The MFA enforcement policy and coverage report", "The exception register with approvals"],
    ...DRAFT,
  },
  "it-16": {
    findingKey: "rbac", domain: "security", impact: 3, likelihood: 3,
    whyItMatters: "Role-based access is how least-privilege is achieved for personal data under s.8(5). Without it, access accretes and a single compromised account exposes far more data than necessary.",
    goodLooksLike: "Access to personal data is granted through defined roles mapped to job function, provisioned via the joiner-mover-leaver process, and reviewed periodically.",
    remediation: [
      { step: "Define roles and the personal-data entitlements each role carries", effort: "M" },
      { step: "Migrate direct grants to role assignments", effort: "M" },
      { step: "Wire role changes into the JML process", effort: "S" },
    ],
    evidenceAsks: ["The role-to-entitlement matrix", "A sample of users showing role-based (not ad hoc) access"],
    ...DRAFT,
  },
  "it-17": {
    findingKey: "rbac", domain: "security", impact: 3, likelihood: 3,
    whyItMatters: "Periodic access review is what keeps least-privilege true over time; stale access is a recurring audit finding and breach amplifier.",
    goodLooksLike: "Access to personal-data systems is recertified by data owners at least twice a year, with removals actioned and evidenced.",
    remediation: [
      { step: "Define the recertification cadence and owners per system", effort: "S" },
      { step: "Run the first review cycle and remediate the exceptions", effort: "M" },
      { step: "Automate the campaign where an IGA tool exists", effort: "M" },
    ],
    evidenceAsks: ["The last two access-review campaigns with sign-off", "The list of access removed as a result"],
    ...DRAFT,
  },
  "it-18": {
    findingKey: "rbac", domain: "security", impact: 3, likelihood: 3,
    whyItMatters: "A formal joiner-mover-leaver process ensures access to personal data is granted only when justified and revoked promptly on exit or role change — a core s.8(5) organisational measure.",
    goodLooksLike: "Documented JML with SLAs: access provisioned from the role on joining, adjusted on move, fully revoked within a short window on leaving, all logged.",
    remediation: [
      { step: "Document the JML workflow with owners and SLAs for each transition", effort: "S" },
      { step: "Integrate leaver triggers from HR to identity systems", effort: "M" },
      { step: "Add a periodic reconciliation of active accounts against active employees", effort: "S" },
    ],
    evidenceAsks: ["The JML procedure", "A leaver sample showing access revoked within SLA", "The account-to-employee reconciliation"],
    ...DRAFT,
  },
  "it-19": {
    findingKey: "security-uneven", domain: "security", impact: 3, likelihood: 3,
    whyItMatters: "Endpoint protection / EDR is a s.8(5) safeguard against malware and data theft from the devices where staff handle personal data.",
    goodLooksLike: "EDR deployed on all corporate endpoints and servers, centrally monitored, with alert triage and coverage reporting.",
    remediation: [
      { step: "Confirm EDR coverage against the device inventory and close gaps", effort: "S" },
      { step: "Route EDR alerts to a monitored queue with a triage runbook", effort: "M" },
    ],
    evidenceAsks: ["The EDR coverage report", "A sample of triaged EDR alerts"],
    ...DRAFT,
  },
  "it-20": {
    findingKey: "security-uneven", domain: "security", impact: 4, likelihood: 4,
    whyItMatters: "Unmanaged devices holding personal data cannot be patched, encrypted, or wiped on loss — a significant s.8(5) exposure, especially with remote work.",
    goodLooksLike: "All devices that access personal data are enrolled in MDM/UEM with disk encryption, patch enforcement, and remote wipe; unmanaged devices are blocked by conditional access.",
    remediation: [
      { step: "Complete MDM/UEM enrolment for every device that reaches personal data", effort: "M" },
      { step: "Enforce disk encryption, patch compliance and screen lock via policy", effort: "S" },
      { step: "Block unmanaged devices from personal-data systems with conditional access", effort: "M" },
    ],
    evidenceAsks: ["The MDM enrolment and compliance report", "The conditional-access policy blocking unmanaged devices"],
    ...DRAFT,
  },
  "it-21": {
    findingKey: "security-uneven", domain: "security", impact: 4, likelihood: 4,
    whyItMatters: "Without controls against unauthorised sharing (DLP, egress control, sharing restrictions), personal data leaves the organisation through email, uploads and over-shared links with no detection — a leading breach cause.",
    goodLooksLike: "DLP or equivalent egress controls on the main exfiltration channels (email, web upload, removable media, collaboration sharing) tuned for personal-data patterns, with alerting.",
    remediation: [
      { step: "Enable DLP policies for personal-data patterns on email and cloud collaboration", effort: "M" },
      { step: "Restrict removable media and external sharing by default", effort: "S" },
      { step: "Route DLP alerts to a monitored queue and tune out noise", effort: "M" },
    ],
    evidenceAsks: ["The DLP policy set and coverage", "A sample of DLP alerts and their disposition"],
    ...DRAFT,
  },
  "it-22": {
    findingKey: "security-uneven", domain: "security", impact: 3, likelihood: 3,
    whyItMatters: "Internet-facing apps holding personal data are the primary external attack surface; a WAF / API-security layer is a s.8(5) safeguard against common web attacks.",
    goodLooksLike: "All internet-facing applications and APIs that touch personal data sit behind a WAF / API-security control with tuned rules and monitoring.",
    remediation: [
      { step: "Enumerate internet-facing apps/APIs handling personal data", effort: "S" },
      { step: "Place them behind a WAF / API gateway with a tuned ruleset", effort: "M" },
      { step: "Monitor and periodically review WAF events", effort: "S" },
    ],
    evidenceAsks: ["The list of protected internet-facing apps/APIs", "The WAF configuration and a sample event review"],
    ...DRAFT,
  },
  "it-23": {
    findingKey: "cloud-security", domain: "security", impact: 3, likelihood: 3,
    whyItMatters: "Cloud misconfiguration (public buckets, open databases, over-broad roles) is one of the most common causes of large personal-data exposure; without continuous monitoring it is found by attackers first.",
    goodLooksLike: "Continuous cloud posture monitoring (CSPM or native) covering all accounts, with misconfigurations flagged and remediated to SLA.",
    remediation: [
      { step: "Enable a cloud posture / CSPM capability across all cloud accounts", effort: "M" },
      { step: "Prioritise findings that expose personal data and remediate to SLA", effort: "M" },
    ],
    evidenceAsks: ["The CSPM coverage and current findings", "The remediation SLA and recent closure evidence"],
    ...DRAFT,
  },
  "it-24": {
    findingKey: "cloud-security", domain: "security", impact: 3, likelihood: 3,
    whyItMatters: "Excessive permissions and publicly exposed resources are the specific misconfigurations most likely to turn into a breach; detecting them is part of reasonable s.8(5) safeguards for cloud-hosted personal data.",
    goodLooksLike: "Automated detection of over-privileged identities and public exposure, with least-privilege remediation and periodic entitlement review in cloud.",
    remediation: [
      { step: "Run an identity and exposure assessment across cloud accounts (CIEM or native analyzers)", effort: "M" },
      { step: "Remove public exposure of personal-data resources and right-size roles", effort: "M" },
    ],
    evidenceAsks: ["The identity / exposure assessment output", "Evidence of remediated public resources and role reductions"],
    ...DRAFT,
  },
  "it-25": {
    findingKey: "vuln-mgmt", domain: "security", impact: 3, likelihood: 3,
    whyItMatters: "Regular application vulnerability scanning is a s.8(5) safeguard; unscanned apps holding personal data accumulate known, patchable flaws.",
    goodLooksLike: "Authenticated vulnerability scanning of applications handling personal data on a defined cadence, with findings tracked to closure by severity.",
    remediation: [
      { step: "Bring all personal-data applications into the scanning scope", effort: "S" },
      { step: "Set scan frequency and severity-based remediation SLAs", effort: "S" },
      { step: "Track findings in the vulnerability register alongside VAPT", effort: "S" },
    ],
    evidenceAsks: ["The scan scope and schedule", "The vulnerability register with remediation timings"],
    ...DRAFT,
  },
  "it-26": {
    findingKey: "processor-register", domain: "thirdparty", impact: 3, likelihood: 4,
    whyItMatters: "s.8(1) makes the fiduciary accountable for processing done on its behalf. Without a complete list of processors and third parties that handle personal data, that accountability cannot be exercised or evidenced.",
    goodLooksLike: "A processor register: vendor, personal data shared, purpose, hosting location, contract/DPA status, risk tier and assurance date; owned by one function and updated at procurement.",
    remediation: [
      { step: "Build the processor register from AP records, SaaS spend and function interviews", effort: "M" },
      { step: "Assign an owner and tie updates to the procurement process", effort: "S" },
      { step: "Risk-tier the processors to prioritise DPA remediation and assurance", effort: "S" },
    ],
    evidenceAsks: ["The processor register", "The procurement step that adds new processors to it"],
    ...DRAFT,
  },
  "it-26b": {
    findingKey: "processor-register", domain: "thirdparty", impact: 3, likelihood: 3,
    whyItMatters: "Assessing vendors for security and privacy risk before and during engagement is how the fiduciary discharges its s.8(1) oversight duty; unassessed vendors are an unbounded exposure.",
    goodLooksLike: "A risk-tiered vendor assessment process (questionnaire, evidence review, or certification acceptance) run at onboarding and on a cadence for higher-tier processors.",
    remediation: [
      { step: "Define an assessment approach per risk tier", effort: "S" },
      { step: "Assess the highest-tier processors first and schedule the rest", effort: "M" },
    ],
    evidenceAsks: ["The vendor-assessment methodology", "Completed assessments for the top-tier processors"],
    ...DRAFT,
  },
  "it-27": {
    findingKey: "processor-register", domain: "thirdparty", impact: 3, likelihood: 3,
    whyItMatters: "Reviewing third-party access to personal data keeps processor access proportionate over the life of the relationship and detects scope creep — part of ongoing s.8(1)/s.8(2) oversight.",
    goodLooksLike: "Periodic review of what each processor can access, reconciled against the contracted purpose, with excess access removed.",
    remediation: [
      { step: "For each processor, document the personal data it can currently access", effort: "S" },
      { step: "Reconcile against the contracted purpose and remove excess", effort: "M" },
      { step: "Add processor access to the periodic access-review cycle", effort: "S" },
    ],
    evidenceAsks: ["The processor access inventory vs contracted purpose", "Evidence of access removed on review"],
    ...DRAFT,
  },
  "it-28": {
    findingKey: "no-breach-scoping", domain: "breach", impact: 5, likelihood: 4,
    whyItMatters: "s.8(6) requires notification of the Board and every affected Data Principal. A breach process built only for availability incidents cannot produce the personal-data facts a notification needs.",
    goodLooksLike: "A personal-data breach IR runbook: detection sources, severity criteria, a scoping method, Board and Data Principal notification templates and timelines, and an evidence log; exercised at least annually.",
    remediation: [
      { step: "Extend the IR plan with personal-data breach scenarios and severity criteria", effort: "M" },
      { step: "Add the s.8(6) notification workflow with templates and timelines", effort: "M" },
      { step: "Run a tabletop exercise on a personal-data breach scenario", effort: "S" },
    ],
    evidenceAsks: ["The personal-data breach IR runbook", "The last tabletop exercise report"],
    ...DRAFT,
  },
  "it-29": {
    findingKey: "no-breach-scoping", domain: "breach", impact: 5, likelihood: 4,
    whyItMatters: "If the organisation cannot identify which data and which individuals an incident affected, it cannot notify accurately under s.8(6) — and over- or under-notifying both carry consequences.",
    goodLooksLike: "A repeatable breach-scoping method that, given an incident, produces the affected systems, data categories and the list of affected Data Principals within the notification window.",
    remediation: [
      { step: "Define the scoping method: from indicators of compromise → affected systems → data categories → affected individuals", effort: "M" },
      { step: "Pre-build the queries/reports per system needed to enumerate affected individuals", effort: "M" },
      { step: "Validate the method in the tabletop exercise", effort: "S" },
    ],
    evidenceAsks: ["The documented scoping method", "The per-system enumeration queries", "The tabletop result exercising the method"],
    ...DRAFT,
  },
  "it-30": {
    findingKey: "no-breach-scoping", domain: "breach", impact: 4, likelihood: 4,
    whyItMatters: "Centralised security monitoring is what turns a personal-data breach from something discovered months later into something detected and contained quickly — directly relevant to the s.33(2) mitigation factor.",
    goodLooksLike: "Security-relevant logs from personal-data systems flow to a monitored SIEM with use cases for personal-data misuse and exfiltration, and an on-call triage rota.",
    remediation: [
      { step: "Onboard personal-data system logs (auth, data access, egress) to a SIEM", effort: "M" },
      { step: "Build detection use cases for bulk export, anomalous access and known exfiltration patterns", effort: "M" },
      { step: "Establish alert triage with an on-call rota and runbooks", effort: "M" },
    ],
    evidenceAsks: ["The SIEM log-source coverage for personal-data systems", "The personal-data detection use cases", "A sample of triaged alerts"],
    ...DRAFT,
  },
  "it-31": {
    findingKey: "security-uneven", domain: "security", impact: 3, likelihood: 2,
    whyItMatters: "Tested backups protect the availability and integrity limbs of a personal-data breach (loss of, or loss of access to, personal data) and support recovery after ransomware.",
    goodLooksLike: "Backups of personal-data systems are taken on a defined schedule, stored resiliently (including an immutable/offline copy), and restore-tested at least annually with documented results.",
    remediation: [
      { step: "Confirm backup coverage and retention for every personal-data system", effort: "S" },
      { step: "Add an immutable or offline copy for the critical stores", effort: "M" },
      { step: "Schedule and document restore tests", effort: "S" },
    ],
    evidenceAsks: ["The backup coverage and schedule", "The last restore-test results"],
    ...DRAFT,
  },
  "it-32": {
    findingKey: "no-dsr", domain: "rights", impact: 4, likelihood: 3,
    whyItMatters: "Low confidence in answering \"what do you hold about me\" means s.11 (right to a processing summary) cannot be met reliably — and it is the first request a Data Principal or regulator makes.",
    goodLooksLike: "The DSR process can produce, for any Data Principal, a summary of the personal data held, the processing activities, and the fiduciaries/processors it has been shared with, within the statutory timeline.",
    remediation: [
      { step: "Extend the DSR SOP to assemble the s.11 processing summary from the inventory + RoPA + processor register", effort: "M" },
      { step: "Template the summary output and test it for a real subject", effort: "S" },
    ],
    evidenceAsks: ["The s.11 summary template", "A completed summary for a test subject with timing"],
    ...DRAFT,
  },
  "it-33": {
    findingKey: "no-deletion", domain: "retention", impact: 4, likelihood: 3,
    whyItMatters: "Partial cross-system deletion means an erasure request under s.12 leaves residual copies — the request is not actually fulfilled and the organisation cannot say so honestly.",
    goodLooksLike: "An erasure request results in verified removal (or justified, time-boxed retention) across every system, backup and processor, with a completion record.",
    remediation: [
      { step: "Close the deletion coverage gaps identified for it-14 across the remaining systems", effort: "L" },
      { step: "Add a verification step that confirms removal per location", effort: "S" },
      { step: "Produce a per-request completion record", effort: "S" },
    ],
    evidenceAsks: ["The updated deletion coverage map", "A completed erasure request showing per-system verification"],
    ...DRAFT,
  },
  "it-34": {
    findingKey: "no-breach-scoping", domain: "breach", impact: 4, likelihood: 4,
    whyItMatters: "A long or unknown time-to-detect for a personal-data leak worsens both the impact and the s.33(2) mitigation position, and delays the s.8(6) notification clock.",
    goodLooksLike: "Detection coverage and mean-time-to-detect are measured for personal-data exfiltration scenarios, with a target and improvement plan.",
    remediation: [
      { step: "Baseline current detection coverage against common exfiltration paths", effort: "S" },
      { step: "Close the highest-risk detection gaps (bulk export, unusual egress, dormant-account use)", effort: "M" },
      { step: "Measure MTTD in exercises and track it", effort: "S" },
    ],
    evidenceAsks: ["The detection-coverage baseline", "The MTTD measurements from exercises"],
    ...DRAFT,
  },
  "it-35": {
    findingKey: "no-dpo", domain: "governance", impact: 4, likelihood: 5,
    whyItMatters: "If the organisation cannot produce evidence that its controls operate, it cannot demonstrate accountability under s.8(1) to the Board, an auditor, or the Data Protection Board after an incident.",
    goodLooksLike: "Each key control has a named owner and produces routine evidence (logs, review records, attestations) retained and retrievable on request.",
    remediation: [
      { step: "List the key privacy controls and assign each an owner", effort: "S" },
      { step: "Define the evidence each control produces and where it is retained", effort: "S" },
      { step: "Run an internal evidence-retrieval drill", effort: "S" },
    ],
    evidenceAsks: ["The control-to-owner-to-evidence register", "The result of an evidence-retrieval drill"],
    ...DRAFT,
  },

  // ─────────────────────────────────────────────────────────────── HR ──
  "hr-1": {
    findingKey: "processor-contracts", domain: "thirdparty", impact: 3, likelihood: 3,
    whyItMatters: "A third-party HRMS/payroll provider processes employee personal data on the organisation's behalf; under s.8(2) that engagement must be under a valid contract with data-protection terms.",
    goodLooksLike: "The HRMS/payroll provider is in the processor register, engaged under a DPA covering purpose limitation, security, sub-processing, breach notification, audit and deletion.",
    remediation: [
      { step: "Confirm the provider is in the processor register with its data scope and hosting location", effort: "S" },
      { step: "Check the current contract for DPDPA-aligned processor clauses and remediate gaps", effort: "M" },
    ],
    evidenceAsks: ["The processor-register entry for the HRMS/payroll provider", "The executed DPA / processor clauses"],
    ...DRAFT,
  },
  "hr-1a": {
    findingKey: "processor-contracts", domain: "thirdparty", impact: 4, likelihood: 4,
    whyItMatters: "If it is only partially confirmed that the HR/payroll processor is compliant with applicable data-protection law, the organisation carries the residual risk of that processor's non-compliance under s.8(1).",
    goodLooksLike: "Documented assurance that the processor meets DPDPA (and, where relevant, GDPR) obligations — via its DPA commitments, a completed assessment, or an accepted certification — refreshed periodically.",
    remediation: [
      { step: "Obtain the processor's data-protection assurance package (DPA, security summary, certifications)", effort: "S" },
      { step: "Assess it against the DPDPA processor obligations and record the conclusion", effort: "M" },
      { step: "Set a re-assessment date", effort: "S" },
    ],
    evidenceAsks: ["The processor assurance package", "The completed assessment and its conclusion"],
    ...DRAFT,
  },
  "hr-1b": {
    findingKey: "processor-contracts", domain: "thirdparty", impact: 3, likelihood: 3,
    whyItMatters: "A data processing agreement (or equivalent SLA clauses) is the s.8(2) mechanism that binds the processor to the organisation's instructions and DPDPA obligations.",
    goodLooksLike: "An executed DPA with the HR/payroll provider containing the standard processor clauses, referenced from the processor register.",
    remediation: [
      { step: "Put the standard DPA in place with the provider if not already executed", effort: "M" },
      { step: "Link it from the processor register with its renewal date", effort: "S" },
    ],
    evidenceAsks: ["The executed DPA", "The processor-register link and renewal date"],
    ...DRAFT,
  },
  "hr-1c": {
    findingKey: "employee-consent", domain: "consent", impact: 2, likelihood: 3,
    whyItMatters: "Sharing a candidate's or employee's personal data with a third-party processor needs a lawful basis and, at minimum, notice under s.5; a partial position risks processing without a clear basis.",
    goodLooksLike: "Onboarding includes an employee/candidate privacy notice covering the payroll and background-check processors, and — where consent is the basis rather than employment necessity — a recorded consent step.",
    remediation: [
      { step: "Add an employee/candidate privacy notice to onboarding naming the processors and purposes", effort: "S" },
      { step: "Determine the lawful basis (employment necessity vs consent) per data sharing and document it", effort: "S" },
      { step: "Where consent applies, add a recorded consent step", effort: "S" },
    ],
    evidenceAsks: ["The onboarding privacy notice", "The lawful-basis note for candidate/employee data sharing"],
    ...DRAFT,
  },
  "hr-2": {
    findingKey: "no-policy-framework", domain: "governance", impact: 4, likelihood: 4,
    whyItMatters: "Data-protection obligations in employment contracts make each employee individually accountable for handling personal data — a s.8(4) organisational measure and a prerequisite for enforcement action against misuse.",
    goodLooksLike: "Employment contracts and the staff handbook include confidentiality and data-protection clauses, acknowledged on joining and on material policy change.",
    remediation: [
      { step: "Add or update data-protection clauses in the standard employment contract and handbook", effort: "S" },
      { step: "Roll out an acknowledgement to existing staff", effort: "S" },
    ],
    evidenceAsks: ["The contract / handbook clauses", "The acknowledgement records"],
    ...DRAFT,
  },
  "hr-3": {
    findingKey: "no-retention", domain: "retention", impact: 3, likelihood: 3,
    whyItMatters: "Employee records carry statutory retention minimums (tax, provident fund, labour) and maximums (spent data); without a documented schedule, HR keeps everything and cannot satisfy s.8(7).",
    goodLooksLike: "An HR retention schedule by record type citing the statutory basis, with disposal actioned on schedule and evidenced.",
    remediation: [
      { step: "Build the HR retention schedule by record type with Legal input", effort: "S" },
      { step: "Apply it — dispose of records past their period and evidence it", effort: "M" },
    ],
    evidenceAsks: ["The HR retention schedule with statutory basis", "Disposal records for expired categories"],
    ...DRAFT,
  },
  "hr-4": {
    findingKey: "no-training", domain: "training", impact: 3, likelihood: 4,
    whyItMatters: "Annual data-protection training is a s.8(4) organisational measure; most personal-data incidents are staff error, and untrained staff cannot recognise a breach to report it.",
    goodLooksLike: "All staff complete privacy training on joining and annually, with role-specific modules for high-exposure functions (HR, Marketing, IT, Engineering, sales, collections) and completion tracked.",
    remediation: [
      { step: "Build an all-staff module plus role-specific modules for the high-exposure functions", effort: "M" },
      { step: "Add the module to onboarding and set an annual refresh", effort: "S" },
      { step: "Track completion and follow up non-completers", effort: "S" },
    ],
    evidenceAsks: ["The training curriculum", "The current completion report"],
    ...DRAFT,
  },
  "hr-5": {
    findingKey: "pii-masking", domain: "security", impact: 3, likelihood: 4,
    whyItMatters: "Unmasked PII in reports, dashboards and messages spreads personal data far beyond those who need it and into channels (chat, email, exports) that are hard to control — a s.8(5) safeguard gap.",
    goodLooksLike: "A data-handling standard requires PII to be masked, tokenised or aggregated in reports and communications unless full values are strictly necessary and access-controlled.",
    remediation: [
      { step: "Set a PII-in-outputs handling standard", effort: "S" },
      { step: "Mask or tokenise PII in the standard HR/finance reports and dashboards", effort: "M" },
      { step: "Train report authors on the standard", effort: "S" },
    ],
    evidenceAsks: ["The data-handling standard", "Before/after samples of masked reports"],
    ...DRAFT,
  },
  "hr-6": {
    findingKey: "pii-masking", domain: "security", impact: 3, likelihood: 3,
    whyItMatters: "If access to HR systems and employee data is not limited to HR, employee personal data (including sensitive records) is exposed to staff with no need — contrary to least-privilege under s.8(5).",
    goodLooksLike: "HR systems and shared drives are restricted to HR roles; any cross-function access (e.g. managers seeing their reports) is scoped and logged.",
    remediation: [
      { step: "Review who can access HR systems and employee data and remove non-HR access", effort: "S" },
      { step: "Scope manager access to their own reports only", effort: "M" },
      { step: "Enable access logging on the HR system", effort: "S" },
    ],
    evidenceAsks: ["The HR-system access list post-review", "The access-logging configuration"],
    ...DRAFT,
  },
  "hr-7": {
    findingKey: "no-dsr", domain: "rights", impact: 3, likelihood: 3,
    whyItMatters: "Employees are Data Principals; a process for employee subject-access requests is needed to meet s.11/s.12 for the workforce, which is often the largest single group of Data Principals.",
    goodLooksLike: "The DSR SOP explicitly covers employee requests, with HR as the intake point and the same verification, search, review and timeline steps.",
    remediation: [
      { step: "Extend the DSR SOP to employee requests with HR as intake", effort: "S" },
      { step: "Identify the HR systems in scope and their search method", effort: "S" },
    ],
    evidenceAsks: ["The employee-DSR section of the SOP", "A completed employee DSR (redacted)"],
    ...DRAFT,
  },
  "hr-8": {
    findingKey: "pii-masking", domain: "security", impact: 3, likelihood: 3,
    whyItMatters: "Background-check and other sensitive employee records carry higher harm potential; storing them without separation and access logging is a s.8(5) safeguard gap.",
    goodLooksLike: "Sensitive HR records are held in a segregated, access-logged repository with tighter access than general HR data and a shorter retention period.",
    remediation: [
      { step: "Move background-check and sensitive records to a segregated store", effort: "M" },
      { step: "Restrict access to a named few and enable logging", effort: "S" },
      { step: "Set a short retention period and enforce it", effort: "S" },
    ],
    evidenceAsks: ["The segregated-store design and access list", "The retention setting for sensitive records"],
    ...DRAFT,
  },
  "hr-9": {
    findingKey: "rbac", domain: "security", impact: 3, likelihood: 2,
    whyItMatters: "Prompt deactivation of devices and accounts on termination closes a common route to unauthorised access to personal data by former staff — a s.8(5) organisational measure.",
    goodLooksLike: "HR termination triggers automated account and device deactivation within a short SLA, reconciled periodically against active-employee lists.",
    remediation: [
      { step: "Wire the HR leaver event to identity and MDM deactivation", effort: "M" },
      { step: "Set and monitor a deactivation SLA", effort: "S" },
    ],
    evidenceAsks: ["The leaver-to-deactivation workflow", "A leaver sample showing deactivation within SLA"],
    ...DRAFT,
  },
  "hr-10": {
    findingKey: "no-policy-framework", domain: "governance", impact: 3, likelihood: 3,
    whyItMatters: "A defined onboarding/offboarding process is where privacy obligations, access, training and asset return are consistently applied or removed — its absence produces gaps that accumulate into s.8(4) findings.",
    goodLooksLike: "Documented onboarding and offboarding checklists covering contract clauses, training, access provisioning/removal, and device return, with completion tracked.",
    remediation: [
      { step: "Document the onboarding and offboarding checklists with privacy steps included", effort: "S" },
      { step: "Track completion and audit a sample quarterly", effort: "S" },
    ],
    evidenceAsks: ["The onboarding/offboarding checklists", "A sample of completed checklists"],
    ...DRAFT,
  },

  // ────────────────────────────────────────────────────────────── SWE ──
  "sw-1": {
    findingKey: "processor-contracts", domain: "thirdparty", impact: 3, likelihood: 3,
    whyItMatters: "Outsourced development often means external staff with access to code, test data and sometimes production personal data; that engagement is a s.8(2) processor relationship needing contractual control.",
    goodLooksLike: "Development partners are in the processor register, under a DPA, with access limited to non-production data and time-boxed, logged production access where unavoidable.",
    remediation: [
      { step: "Add development partners to the processor register with their access scope", effort: "S" },
      { step: "Put a DPA and secure-development addendum in place", effort: "M" },
      { step: "Restrict partner access to sanitised non-production data by default", effort: "M" },
    ],
    evidenceAsks: ["The processor-register entries for dev partners", "The DPA / secure-development addendum", "The access model for dev partners"],
    ...DRAFT,
  },
  "sw-2": {
    findingKey: "sdlc", domain: "security", impact: 3, likelihood: 4,
    whyItMatters: "Secure coding practices prevent the injection, access-control and crypto flaws that cause personal-data breaches in custom applications — foundational to s.8(5) for anything the organisation builds.",
    goodLooksLike: "A documented secure-coding standard, developer training, mandatory code review, and SAST in the pipeline for applications handling personal data.",
    remediation: [
      { step: "Adopt a secure-coding standard (e.g. OWASP ASVS-aligned) for personal-data apps", effort: "S" },
      { step: "Make peer code review mandatory and add SAST to CI", effort: "M" },
      { step: "Train developers on the standard annually", effort: "S" },
    ],
    evidenceAsks: ["The secure-coding standard", "CI configuration showing SAST and review gates", "Developer training records"],
    ...DRAFT,
  },
  "sw-3": {
    findingKey: "security-uneven", domain: "security", impact: 3, likelihood: 3,
    whyItMatters: "Encryption of personal data in transit and at rest within applications is an explicit reasonable safeguard under s.8(5); partial coverage leaves specific stores or channels exposed.",
    goodLooksLike: "TLS enforced for all personal-data traffic; personal data encrypted at rest in databases, object stores, backups and logs with managed keys.",
    remediation: [
      { step: "Audit personal-data flows and stores for encryption coverage", effort: "S" },
      { step: "Enable at-rest encryption on any uncovered store and enforce TLS everywhere", effort: "M" },
      { step: "Move to managed key rotation", effort: "M" },
    ],
    evidenceAsks: ["The encryption coverage audit", "Configuration evidence for at-rest and in-transit encryption"],
    ...DRAFT,
  },
  "sw-4": {
    findingKey: "sdlc", domain: "security", impact: 3, likelihood: 3,
    whyItMatters: "Vulnerable third-party libraries are a leading breach vector; without dependency review, personal-data applications ship known CVEs.",
    goodLooksLike: "Software composition analysis in CI with a policy to block or time-box known-vulnerable dependencies, plus a monthly review of outstanding items.",
    remediation: [
      { step: "Add SCA / dependency scanning to CI for personal-data applications", effort: "S" },
      { step: "Set a policy: critical/high vulns block release or get a time-boxed exception", effort: "S" },
      { step: "Review outstanding dependency risk monthly", effort: "S" },
    ],
    evidenceAsks: ["The CI SCA configuration and policy", "The current dependency-risk register"],
    ...DRAFT,
  },
  "sw-5": {
    findingKey: "no-breach-notification", domain: "breach", impact: 3, likelihood: 3,
    whyItMatters: "A process for externally-reported vulnerabilities (from users or researchers) is often the first warning of a flaw that could expose personal data; without one, reports are lost and the flaw stays open.",
    goodLooksLike: "A published security contact / disclosure policy, a triage SLA, and a link into the incident process if exploitation is suspected.",
    remediation: [
      { step: "Publish a vulnerability-disclosure policy and a security contact", effort: "S" },
      { step: "Define triage, acknowledgement and fix SLAs by severity", effort: "S" },
      { step: "Connect confirmed exploitation to the breach IR runbook", effort: "S" },
    ],
    evidenceAsks: ["The published disclosure policy", "A sample of handled external reports"],
    ...DRAFT,
  },
  "sw-6": {
    findingKey: "no-breach-scoping", domain: "breach", impact: 3, likelihood: 4,
    whyItMatters: "Application logs are often the only record of who accessed which personal data; without monitoring them for misuse, insider access and credential abuse go undetected and unscopable.",
    goodLooksLike: "Personal-data access is logged at the application layer, shipped to the SIEM, and covered by detection use cases for bulk access, off-hours access and dormant-account use.",
    remediation: [
      { step: "Add structured personal-data access logging to the applications", effort: "M" },
      { step: "Ship the logs to the SIEM and build misuse detections", effort: "M" },
    ],
    evidenceAsks: ["The application access-logging design", "The SIEM detections for personal-data misuse"],
    ...DRAFT,
  },
  "sw-7": {
    findingKey: "sdlc", domain: "security", impact: 3, likelihood: 3,
    whyItMatters: "If security and privacy are not gates in the SDLC, controls depend on individual diligence and regress over time — the organisational-measure limb of s.8(4)/s.8(5) is not met by design.",
    goodLooksLike: "Defined SDLC gates: threat modelling / privacy check at design, security review at code, security tests before release, with sign-off recorded.",
    remediation: [
      { step: "Define the SDLC security and privacy gates and their exit criteria", effort: "S" },
      { step: "Add a lightweight privacy/threat check to the design phase for personal-data features", effort: "M" },
      { step: "Record gate sign-offs in the delivery tool", effort: "S" },
    ],
    evidenceAsks: ["The SDLC gate definitions", "Gate sign-offs for a recent release"],
    ...DRAFT,
  },
  "sw-8": {
    findingKey: "sdlc", domain: "security", impact: 3, likelihood: 4,
    whyItMatters: "Automated data-leak / exposure tests catch the specific defects — over-broad API responses, unauthenticated endpoints, verbose errors — that leak personal data directly to the internet.",
    goodLooksLike: "DAST and targeted personal-data-exposure tests run in CI/CD for personal-data applications, with failures blocking release.",
    remediation: [
      { step: "Add DAST and API-security testing to the pipeline for personal-data apps", effort: "M" },
      { step: "Write tests asserting no personal data in error responses / unauthenticated routes", effort: "M" },
    ],
    evidenceAsks: ["The CI DAST / exposure-test configuration", "A sample test run"],
    ...DRAFT,
  },
  "sw-9": {
    findingKey: "no-deletion", domain: "retention", impact: 3, likelihood: 3,
    whyItMatters: "Decommissioning an application without a data-wipe step leaves personal data on disused databases, storage and backups — a persistent, forgotten s.8(7) exposure.",
    goodLooksLike: "A decommissioning runbook that includes data export where needed, certified destruction of the data and its backups, and an updated inventory entry.",
    remediation: [
      { step: "Add a mandatory data-handling step to the decommissioning runbook", effort: "S" },
      { step: "Require certified destruction evidence for the data and its backups", effort: "S" },
      { step: "Update the inventory / RoPA on decommission", effort: "S" },
    ],
    evidenceAsks: ["The decommissioning runbook", "A destruction certificate from a recent decommission"],
    ...DRAFT,
  },
  "sw-10": {
    findingKey: "pii-masking", domain: "security", impact: 3, likelihood: 3,
    whyItMatters: "Using real (or realistic) personal data in test and development environments multiplies the number of places personal data lives, usually with weaker controls — a common source of breaches.",
    goodLooksLike: "Non-production environments use synthetic or irreversibly masked data by default; any use of real personal data is exceptional, approved, time-boxed and equally protected.",
    remediation: [
      { step: "Adopt a test-data standard: synthetic or masked by default", effort: "S" },
      { step: "Build a masking/synthesis capability for the main datasets", effort: "M" },
      { step: "Purge existing real data from non-production environments", effort: "M" },
    ],
    evidenceAsks: ["The test-data standard", "Evidence non-production environments hold no real personal data"],
    ...DRAFT,
  },

  // ────────────────────────────────────────────────────────── Finance ──
  "fi-1": {
    findingKey: "security-uneven", domain: "security", impact: 3, likelihood: 2,
    whyItMatters: "Sectoral standards (RBI, SEBI, IRDAI) impose their own storage, localisation and security rules on financial and payment data; s.16(2) preserves the stricter of these, so a partial position risks both DPDPA and sectoral non-compliance.",
    goodLooksLike: "Financial and payment data storage is mapped against the applicable sectoral requirements, with localisation and security controls evidenced and reconciled with the DPDPA position.",
    remediation: [
      { step: "Identify which sectoral regimes apply to the organisation's financial/payment data", effort: "S" },
      { step: "Map current storage and controls against each and close gaps", effort: "M" },
    ],
    evidenceAsks: ["The applicable-regime analysis", "The storage-and-controls mapping against each regime"],
    ...DRAFT,
  },
  "fi-2": {
    findingKey: "mfa-partial", domain: "security", impact: 4, likelihood: 3,
    whyItMatters: "Financial records combine personal data with fraud value; MFA on finance systems is a baseline s.8(5) safeguard and partial coverage is a common route to both breach and fraud.",
    goodLooksLike: "MFA enforced on all finance and payment systems and on any account that can initiate payments or export financial data, with phishing-resistant factors for approvers.",
    remediation: [
      { step: "Enforce MFA on every finance/payment system and privileged finance account", effort: "S" },
      { step: "Require phishing-resistant MFA for payment approvers", effort: "M" },
    ],
    evidenceAsks: ["The MFA coverage report for finance systems", "The approver MFA configuration"],
    ...DRAFT,
  },
  "fi-3": {
    findingKey: "mfa-partial", domain: "security", impact: 4, likelihood: 3,
    whyItMatters: "Controls to detect and prevent unauthorised financial-data access or fraud (anomaly detection, segregation of duties, transaction monitoring) also detect personal-data misuse — their absence weakens the s.8(5) and s.8(6) positions.",
    goodLooksLike: "Segregation of duties enforced in finance systems, anomaly/transaction monitoring in place, and access to bulk financial data alerting to a monitored queue.",
    remediation: [
      { step: "Enforce segregation of duties for payment initiation and approval", effort: "M" },
      { step: "Enable anomaly / transaction monitoring and route alerts to a queue", effort: "M" },
      { step: "Alert on bulk export of financial/personal data", effort: "S" },
    ],
    evidenceAsks: ["The SoD matrix and its enforcement", "A sample of monitoring alerts and disposition"],
    ...DRAFT,
  },
  "fi-4": {
    findingKey: "processor-contracts", domain: "thirdparty", impact: 3, likelihood: 3,
    whyItMatters: "Sharing customer financial data with third parties without a formal data-sharing agreement leaves the purpose, security and deletion obligations unbound — a s.8(2) gap.",
    goodLooksLike: "Every third party that receives customer financial data is under a data-sharing agreement or DPA specifying purpose, security, sub-processing, retention and breach obligations, and the data is encrypted in transfer.",
    remediation: [
      { step: "List every third party that receives customer financial data and the purpose", effort: "S" },
      { step: "Put a data-sharing agreement / DPA in place for each", effort: "M" },
      { step: "Enforce encrypted transfer channels", effort: "S" },
    ],
    evidenceAsks: ["The financial-data sharing inventory", "The executed agreements"],
    ...DRAFT,
  },
  "fi-5": {
    findingKey: "no-retention", domain: "retention", impact: 3, likelihood: 3,
    whyItMatters: "Financial data has strong statutory retention drivers; a documented, enforced schedule is needed to satisfy both the retention minimums and the s.8(7) obligation to erase once the purpose (and legal need) ends.",
    goodLooksLike: "A finance retention schedule by record type citing the statutory basis, with disposal enforced and evidenced, including for any physical records.",
    remediation: [
      { step: "Document the finance retention schedule with statutory citations", effort: "S" },
      { step: "Enforce disposal on schedule (systems and physical) and evidence it", effort: "M" },
    ],
    evidenceAsks: ["The finance retention schedule", "Disposal evidence for expired records"],
    ...DRAFT,
  },
  "fi-6": {
    findingKey: "minimisation", domain: "retention", impact: 2, likelihood: 3,
    whyItMatters: "Without periodic \"is this still needed\" reviews, finance accumulates personal and financial data well beyond its purpose, increasing breach exposure and DSR effort — contrary to the minimisation principle behind s.8(7).",
    goodLooksLike: "An annual data-holding review per finance process that challenges each dataset against its current purpose and disposes of what is no longer needed.",
    remediation: [
      { step: "Define an annual data-holding review for finance", effort: "S" },
      { step: "Run the first review and dispose of unneeded data", effort: "M" },
    ],
    evidenceAsks: ["The data-holding review procedure", "The first review's outcomes"],
    ...DRAFT,
  },
  "fi-7": {
    findingKey: "physical-records", domain: "security", impact: 2, likelihood: 2,
    whyItMatters: "Physical financial records containing personal data are easy to overlook: they sit outside system controls, outside retention automation, and outside breach detection.",
    goodLooksLike: "Physical records are minimised, inventoried, stored in a secure access-controlled location, on the retention schedule, and securely destroyed on expiry.",
    remediation: [
      { step: "Inventory the physical records that contain personal data", effort: "S" },
      { step: "Move them to secure, access-controlled storage", effort: "S" },
      { step: "Digitise where practical and set a destruction schedule", effort: "M" },
    ],
    evidenceAsks: ["The physical-records inventory", "The storage and destruction procedure"],
    ...DRAFT,
  },
  "fi-7a": {
    findingKey: "physical-records", domain: "security", impact: 2, likelihood: 2,
    whyItMatters: "If physical records are not in a secure, access-controlled location, personal data can be taken or copied with no trace — the physical equivalent of an unrestricted system.",
    goodLooksLike: "A locked, access-logged storage area (or safe) for physical records containing personal data, with an access list reviewed periodically.",
    remediation: [
      { step: "Provide locked storage with an access log for physical personal-data records", effort: "S" },
      { step: "Restrict and review the access list", effort: "S" },
    ],
    evidenceAsks: ["A description or photo of the secure storage and its access log", "The access list and last review"],
    ...DRAFT,
  },
  "fi-7b": {
    findingKey: "physical-records", domain: "retention", impact: 2, likelihood: 2,
    whyItMatters: "Without a documented secure-disposal process, expired physical records are binned or stockpiled — either way the s.8(7) erasure obligation is not met for that data.",
    goodLooksLike: "A documented process for secure destruction of physical financial records (cross-cut shredding or a certified destruction vendor) with a destruction log.",
    remediation: [
      { step: "Document the secure-destruction process and choose a method/vendor", effort: "S" },
      { step: "Destroy the backlog of expired records and log it", effort: "M" },
    ],
    evidenceAsks: ["The secure-disposal procedure", "Destruction logs / certificates"],
    ...DRAFT,
  },
  "fi-7c": {
    findingKey: "physical-records", domain: "retention", impact: 2, likelihood: 2,
    whyItMatters: "Periodic review of physical records ensures they are still needed and compliant with retention — the manual counterpart to the systemic minimisation duty.",
    goodLooksLike: "An annual review of the physical-records inventory against the retention schedule, with expired records queued for destruction.",
    remediation: [
      { step: "Add the physical-records inventory to the annual data-holding review", effort: "S" },
      { step: "Queue expired items for destruction each cycle", effort: "S" },
    ],
    evidenceAsks: ["The last physical-records review", "The resulting destruction queue"],
    ...DRAFT,
  },
  "fi-8": {
    findingKey: "processor-contracts", domain: "thirdparty", impact: 4, likelihood: 4,
    whyItMatters: "Outsourced debt recovery means a third party contacts Data Principals using their personal data; without a DPA and oversight the organisation is accountable under s.8(1) for that agency's conduct, including any harassment or over-collection of data.",
    goodLooksLike: "The collections agency is in the processor register, under a DPA that limits purpose, mandates security and DPDPA-compliant contact practices, prohibits onward sharing, and requires deletion on contract end; with periodic assurance.",
    remediation: [
      { step: "Add the collections agency to the processor register with its data scope", effort: "S" },
      { step: "Put a DPA in place covering purpose limitation, contact conduct, security, deletion and audit", effort: "M" },
      { step: "Run a periodic assurance check on the agency's practices", effort: "M" },
    ],
    evidenceAsks: ["The processor-register entry and executed DPA for the collections agency", "The last assurance check"],
    ...DRAFT,
  },

  // ──────────────────────────────────────────────────────────── Legal ──
  "lg-1": {
    findingKey: "processor-contracts", domain: "thirdparty", impact: 3, likelihood: 3,
    whyItMatters: "Data-protection clauses in agreements are the contractual mechanism that makes s.8(2) enforceable; agreements without them leave the organisation reliant on goodwill for a processor's DPDPA compliance.",
    goodLooksLike: "A standard DPA / data-protection clause set is used in all agreements involving personal data, with a clause library for negotiation and a tracker of which contracts still need remediation.",
    remediation: [
      { step: "Adopt a standard DPA and clause library aligned to DPDPA processor obligations", effort: "M" },
      { step: "Make the clauses mandatory for new agreements involving personal data", effort: "S" },
      { step: "Build a remediation backlog of legacy contracts, prioritised by risk", effort: "S" },
    ],
    evidenceAsks: ["The standard DPA / clause library", "The contract-remediation tracker"],
    ...DRAFT,
  },
  "lg-2": {
    findingKey: "no-consent", domain: "consent", impact: 4, likelihood: 4,
    whyItMatters: "s.4 requires every processing activity to rest on a lawful ground (consent under s.6 or a legitimate use under s.7). Without a documented legal basis per data category, the organisation cannot show its processing is lawful.",
    goodLooksLike: "A lawful-basis register: each processing activity / data category mapped to consent or a specific s.7 legitimate use, with the reasoning recorded and reviewed on change.",
    remediation: [
      { step: "Build the lawful-basis register from the RoPA / processing inventory", effort: "M" },
      { step: "For each entry, record consent or the specific s.7 ground and the reasoning", effort: "M" },
      { step: "Review on any new or changed processing", effort: "S" },
    ],
    evidenceAsks: ["The lawful-basis register", "The review trigger tied to change management"],
    ...DRAFT,
  },
  "lg-3": {
    findingKey: "no-consent", domain: "consent", impact: 4, likelihood: 4,
    whyItMatters: "Consent mechanisms that are only partially in place, or consent that is not properly recorded, mean the organisation cannot demonstrate valid s.6 consent where it relies on it — the burden of proof is on the fiduciary.",
    goodLooksLike: "Where consent is the basis, it is captured by clear affirmative action with the s.5 notice, and every consent is recorded with purpose, timestamp, notice version and a withdrawal link.",
    remediation: [
      { step: "Identify every point where the organisation relies on consent", effort: "S" },
      { step: "Standardise the capture (affirmative action + notice) and the record fields", effort: "M" },
      { step: "Backfill or re-collect consent where the current record is inadequate", effort: "M" },
    ],
    evidenceAsks: ["The consent-capture standard", "A sample of consent records with all required fields"],
    ...DRAFT,
  },
  "lg-4": {
    findingKey: "processor-contracts", domain: "thirdparty", impact: 3, likelihood: 3,
    whyItMatters: "Data-sharing clauses in commercial contracts (JVs, partnerships) determine who is fiduciary, who is processor, and what each may do with the personal data; without legal review before execution these are set unfavourably or left silent.",
    goodLooksLike: "Legal reviews the data-sharing and data-protection provisions of every commercial contract involving personal data before signature, against a checklist.",
    remediation: [
      { step: "Add a mandatory data-protection review step to the contract-approval workflow", effort: "S" },
      { step: "Give reviewers a checklist (role determination, purpose, security, transfer, deletion)", effort: "S" },
    ],
    evidenceAsks: ["The contract-review checklist", "Evidence of the review step in the approval workflow"],
    ...DRAFT,
  },
  "lg-5": {
    findingKey: "processor-contracts", domain: "thirdparty", impact: 4, likelihood: 4,
    whyItMatters: "s.8(2) permits engaging a processor only under a valid contract. If DPAs are not in place with all third-party processors, some processing on the organisation's behalf is contractually ungoverned.",
    goodLooksLike: "Every processor in the register has an executed DPA; the register shows DPA status and renewal date; new processors cannot be onboarded without one.",
    remediation: [
      { step: "Cross-check the processor register against executed DPAs and list the gaps", effort: "S" },
      { step: "Run a prioritised DPA remediation programme (payroll, ad-tech, collections first)", effort: "M" },
      { step: "Gate processor onboarding on an executed DPA", effort: "S" },
    ],
    evidenceAsks: ["The processor-register DPA-status column", "The DPA remediation plan and progress"],
    ...DRAFT,
  },
  "lg-6": {
    findingKey: "no-dpo", domain: "governance", impact: 4, likelihood: 5,
    whyItMatters: "s.8(9) requires publishing the contact of a person able to answer processing questions, and s.10(2)(a) requires an India-based DPO for a Significant Data Fiduciary. With no designated privacy lead, there is no owner for the programme and no accountable point of contact.",
    goodLooksLike: "A named Data Protection Officer or senior privacy lead, based in India, answerable to the Board, whose contact is published in the privacy notice and on the website; supported by a defined privacy RACI.",
    remediation: [
      { step: "Appoint a DPO or, pending SDF designation, a senior privacy lead reporting to the Board", effort: "M" },
      { step: "Publish the contact in the privacy notice and website footer", effort: "S" },
      { step: "Define and approve the privacy RACI", effort: "S" },
    ],
    evidenceAsks: ["The appointment record / job description", "The published contact", "The approved privacy RACI"],
    ...DRAFT,
  },
  "lg-7": {
    findingKey: "no-breach-notification", domain: "breach", impact: 3, likelihood: 3,
    whyItMatters: "If breach-notification obligations are understood in principle but not documented, the s.8(6) duty will be performed slowly and inconsistently under pressure, worsening the s.33(2) position.",
    goodLooksLike: "A written breach-notification procedure: what triggers notification, the Board and Data Principal templates, timelines, the decision-maker, and an evidence log — kept current with the Rules.",
    remediation: [
      { step: "Document the breach-notification procedure with templates and timelines", effort: "M" },
      { step: "Name the notification decision-maker and their backup", effort: "S" },
      { step: "Review against the DPDP Rules once notified and after each incident", effort: "S" },
    ],
    evidenceAsks: ["The breach-notification procedure and templates", "The named decision-maker"],
    ...DRAFT,
  },

  // ─────────────────────────────────────────────────────── Operations ──
  "op-1": {
    findingKey: "processor-register", domain: "thirdparty", impact: 3, likelihood: 3,
    whyItMatters: "If data-protection requirements are not built into procurement and vendor onboarding, new processors enter without a DPA, a risk assessment, or an inventory entry — the s.8(1)/s.8(2) gaps recur with every purchase.",
    goodLooksLike: "Procurement onboarding includes a personal-data screening question, a risk assessment for vendors that will process personal data, and a mandatory DPA before go-live.",
    remediation: [
      { step: "Add a personal-data screening question to vendor onboarding", effort: "S" },
      { step: "Route positive answers to a risk assessment and DPA step", effort: "M" },
      { step: "Block go-live until the DPA is executed and the register updated", effort: "S" },
    ],
    evidenceAsks: ["The procurement onboarding form with the screening question", "The gate preventing go-live without a DPA"],
    ...DRAFT,
  },
  "op-2": {
    findingKey: "no-ropa", domain: "inventory", impact: 3, likelihood: 3,
    whyItMatters: "A register of third parties that process personal data on the organisation's behalf is the s.8(1) accountability record; without a maintained one, the organisation cannot say who holds its data or oversee them.",
    goodLooksLike: "A single, owned processor register (see it-26) that operations keeps current as vendors are added and removed.",
    remediation: [
      { step: "Consolidate any partial vendor lists into the one processor register", effort: "S" },
      { step: "Assign operations as the maintainer with a quarterly reconciliation against AP", effort: "S" },
    ],
    evidenceAsks: ["The consolidated processor register", "The quarterly reconciliation record"],
    ...DRAFT,
  },
  "op-3": {
    findingKey: "security-uneven", domain: "security", impact: 3, likelihood: 2,
    whyItMatters: "Documented and tested business-continuity and disaster-recovery plans protect the availability and integrity of personal data — a personal-data breach under the Act includes loss of, and loss of access to, personal data.",
    goodLooksLike: "BCP/DR plans covering the systems that hold personal data, with defined RTO/RPO, tested at least annually with documented results.",
    remediation: [
      { step: "Confirm BCP/DR coverage for personal-data systems and set RTO/RPO", effort: "S" },
      { step: "Run and document an annual test", effort: "M" },
    ],
    evidenceAsks: ["The BCP/DR plans for personal-data systems", "The last test report"],
    ...DRAFT,
  },
  "op-4": {
    findingKey: "minimisation", domain: "retention", impact: 2, likelihood: 3,
    whyItMatters: "Collecting more personal data than an operational process needs increases breach exposure and DSR effort with no benefit; minimisation is the principle behind s.4 (processing for a lawful purpose) and s.8(7).",
    goodLooksLike: "Operational forms and data captures collect only what the stated purpose requires, reviewed periodically, with optional fields marked and justified.",
    remediation: [
      { step: "Review the main operational data-capture points against their purpose", effort: "S" },
      { step: "Remove or make optional the fields not needed for the purpose", effort: "M" },
      { step: "Set a minimisation check into new-process design", effort: "S" },
    ],
    evidenceAsks: ["The data-capture review and its changes", "The minimisation step in process design"],
    ...DRAFT,
  },
  "op-5": {
    findingKey: "security-uneven", domain: "security", impact: 3, likelihood: 2,
    whyItMatters: "Physical access controls at premises where personal data is processed (server rooms, records stores, print areas) are an explicit part of reasonable security safeguards under s.8(5).",
    goodLooksLike: "Access to areas where personal data is processed or stored is restricted by badge/lock, logged, and reviewed; visitors are escorted; clear-desk applies.",
    remediation: [
      { step: "Restrict and log access to server rooms and records storage", effort: "S" },
      { step: "Apply a clear-desk / clear-screen policy in areas handling personal data", effort: "S" },
    ],
    evidenceAsks: ["The physical access-control and logging setup", "The clear-desk policy"],
    ...DRAFT,
  },
  "op-6": {
    findingKey: "no-dpia", domain: "governance", impact: 3, likelihood: 3,
    whyItMatters: "A DPIA process is required of a Significant Data Fiduciary under s.10(2)(c) and is good practice for any high-risk processing; without it, high-risk activities (profiling, large-scale monitoring, new tech) go live with unassessed privacy risk.",
    goodLooksLike: "A DPIA methodology with trigger criteria, a template, and sign-off, run for high-risk processing (audience measurement, ad targeting, analytics, any minors-facing processing) and retained.",
    remediation: [
      { step: "Adopt a DPIA methodology, trigger list and template", effort: "S" },
      { step: "Run DPIAs for the current high-risk processing activities", effort: "M" },
      { step: "Add a DPIA trigger check to project intake", effort: "S" },
    ],
    evidenceAsks: ["The DPIA methodology and template", "Completed DPIAs for the high-risk activities"],
    ...DRAFT,
  },

  // ──────────────────────────────────────────────────────── Marketing ──
  "mk-1": {
    findingKey: "marketing-basis", domain: "consent", impact: 3, likelihood: 4,
    whyItMatters: "Marketing data acquired from third-party sources often has no verifiable consent or lawful basis behind it; processing it under s.4 without that assurance means the organisation is relying on an unlawful upstream collection.",
    goodLooksLike: "Every acquired marketing dataset comes with documented proof of consent or lawful basis and permitted use; datasets without it are not used for marketing.",
    remediation: [
      { step: "Inventory the acquired marketing datasets and their sources", effort: "S" },
      { step: "Require and file proof of consent / lawful basis and permitted use per source", effort: "M" },
      { step: "Suppress or delete datasets that cannot be evidenced", effort: "S" },
    ],
    evidenceAsks: ["The acquired-data inventory with source and basis evidence", "The suppression list for un-evidenced data"],
    ...DRAFT,
  },
  "mk-1a": {
    findingKey: "marketing-basis", domain: "thirdparty", impact: 3, likelihood: 3,
    whyItMatters: "If the third-party data source's own DPDPA compliance is only partially confirmed, the organisation inherits the risk of that source's unlawful collection when it uses the data.",
    goodLooksLike: "Documented assurance (contractual warranties, a completed assessment, or certification) that each marketing-data source complies with DPDPA in how it collects and shares the data.",
    remediation: [
      { step: "Obtain DPDPA-compliance warranties from each data source in the contract", effort: "S" },
      { step: "Assess the higher-volume sources and record the conclusion", effort: "M" },
    ],
    evidenceAsks: ["The contractual DPDPA warranties", "Source assessments for the main providers"],
    ...DRAFT,
  },
  "mk-1b": {
    findingKey: "processor-contracts", domain: "thirdparty", impact: 3, likelihood: 3,
    whyItMatters: "Where a third-party data provider or ad platform processes personal data for the organisation, s.8(2) requires a data processing agreement defining purpose, security and deletion.",
    goodLooksLike: "An executed DPA with each marketing-data provider and ad platform that acts as a processor, referenced from the processor register.",
    remediation: [
      { step: "Determine which marketing partners are processors vs independent controllers", effort: "S" },
      { step: "Execute DPAs with the processors and link them from the register", effort: "M" },
    ],
    evidenceAsks: ["The processor/controller determination per partner", "The executed DPAs"],
    ...DRAFT,
  },
  "mk-2": {
    findingKey: "marketing-basis", domain: "consent", impact: 3, likelihood: 4,
    whyItMatters: "s.6 requires free, specific, informed consent before marketing communications where consent is the basis; a partial position means some campaigns send without a demonstrable basis, the most common source of marketing complaints.",
    goodLooksLike: "Marketing consent is captured explicitly (unbundled, opt-in) with the s.5 notice, recorded per contact, and checked before every send; withdrawal is honoured immediately.",
    remediation: [
      { step: "Standardise marketing opt-in capture (specific, unbundled, informed)", effort: "M" },
      { step: "Enforce a consent/suppression check in the send workflow", effort: "M" },
      { step: "Reconcile the marketing database against consent records and suppress the rest", effort: "M" },
    ],
    evidenceAsks: ["The opt-in capture design", "The pre-send consent-check step", "The suppression reconciliation"],
    ...DRAFT,
  },
  "mk-3": {
    findingKey: "marketing-basis", domain: "security", impact: 2, likelihood: 2,
    whyItMatters: "Using unofficial channels (personal email, personal messaging apps, unsanctioned tools) for marketing puts customer personal data outside the organisation's controls and retention, and undermines suppression.",
    goodLooksLike: "Marketing communications go only through sanctioned, access-controlled platforms integrated with the consent/suppression list; personal accounts and unsanctioned tools are prohibited.",
    remediation: [
      { step: "Confirm all marketing sends run through sanctioned platforms", effort: "S" },
      { step: "Prohibit personal accounts / unsanctioned tools for customer contact in the marketing policy", effort: "S" },
    ],
    evidenceAsks: ["The list of sanctioned marketing platforms", "The marketing communications policy"],
    ...DRAFT,
  },
  "mk-4": {
    findingKey: "marketing-basis", domain: "consent", impact: 2, likelihood: 2,
    whyItMatters: "Compliance with anti-spam and e-privacy rules (e.g. TRAI UCC regulations, plus DPDPA consent) is what keeps campaigns lawful; a gap here surfaces quickly as regulator complaints and blocklisting.",
    goodLooksLike: "Campaign templates and processes include the required identification, unsubscribe, timing and consent controls for each channel, with a pre-send compliance check.",
    remediation: [
      { step: "Map the anti-spam / e-privacy requirements per channel used", effort: "S" },
      { step: "Bake the controls into templates and add a pre-send checklist", effort: "S" },
    ],
    evidenceAsks: ["The per-channel compliance mapping", "The pre-send checklist"],
    ...DRAFT,
  },
  "mk-5": {
    findingKey: "security-uneven", domain: "security", impact: 3, likelihood: 3,
    whyItMatters: "Customer profiles and segmentation data are concentrated personal data attractive to attackers and easy to over-share internally; without secure storage and access control they are a s.8(5) exposure.",
    goodLooksLike: "Profile and segmentation data is held in an access-controlled platform, restricted to marketing roles, encrypted, and covered by the retention schedule.",
    remediation: [
      { step: "Restrict access to the profile/segmentation store to marketing roles", effort: "S" },
      { step: "Confirm encryption and add the store to the retention schedule", effort: "S" },
    ],
    evidenceAsks: ["The access list for the profile store", "Its encryption and retention configuration"],
    ...DRAFT,
  },
  "mk-6": {
    findingKey: "processor-contracts", domain: "thirdparty", impact: 4, likelihood: 4,
    whyItMatters: "Sharing personal data with marketing agencies or ad platforms without a DPA leaves the purpose, onward-use, security and deletion obligations unbound — and ad platforms in particular tend to reuse data for their own purposes absent a contract.",
    goodLooksLike: "Every agency and ad platform that receives personal data is under a DPA restricting use to the organisation's purposes, prohibiting independent use, and mandating security and deletion; audience uploads are minimised and hashed where possible.",
    remediation: [
      { step: "List every agency / ad platform that receives personal data and what is shared", effort: "S" },
      { step: "Execute DPAs restricting purpose and onward use", effort: "M" },
      { step: "Minimise and hash audience data before upload where the platform supports it", effort: "M" },
    ],
    evidenceAsks: ["The agency/ad-platform data-sharing inventory", "The executed DPAs", "The audience-upload minimisation approach"],
    ...DRAFT,
  },
  "mk-7": {
    findingKey: "no-withdrawal", domain: "rights", impact: 3, likelihood: 3,
    whyItMatters: "A process to remove customer data from marketing systems on request (unsubscribe, opt-out, erasure) is needed to honour s.6(4)–(6) withdrawal and s.12 erasure; a partial one leaves residual contact after opt-out — a frequent complaint.",
    goodLooksLike: "Unsubscribe and data-removal requests propagate to every marketing system and any synced ad-platform audience within a defined SLA, with a suppression record that prevents re-add.",
    remediation: [
      { step: "Map every marketing system and synced audience a contact can appear in", effort: "S" },
      { step: "Wire opt-out / removal to propagate to all of them with an SLA", effort: "M" },
      { step: "Maintain a durable suppression list checked on every import", effort: "S" },
    ],
    evidenceAsks: ["The propagation map and SLA", "The suppression list and the import-time check"],
    ...DRAFT,
  },

  // ─────────────────────────────────────── generic custom-department set ──
  // A `${dept}-N` question (e.g. `sales-3`) resolves here via guidanceFor();
  // its gapId stays `sales-3`. These are scoping questions, so guidance is
  // necessarily directional.
  "generic-1": {
    findingKey: "no-ropa", domain: "inventory", impact: 2, likelihood: 3,
    whyItMatters: "A department that shares data or tasks with other departments is a node in the organisation's personal-data flows; if those flows are not mapped, the RoPA and breach-scoping are incomplete for this function.",
    goodLooksLike: "This department's inbound and outbound personal-data flows (what, to/from whom, why) are captured in the RoPA and the data-flow diagram.",
    remediation: [
      { step: "Interview the department head to list the personal-data flows in and out", effort: "S" },
      { step: "Add the flows to the RoPA and the data-flow diagram", effort: "S" },
    ],
    evidenceAsks: ["The department's RoPA entries", "The updated data-flow diagram"],
    ...DRAFT,
  },
  "generic-2": {
    findingKey: "processor-register", domain: "thirdparty", impact: 2, likelihood: 3,
    whyItMatters: "A department that deals directly with clients or vendors collects and shares personal data outside the organisation; those parties and the data shared with them need to be in the processor / recipient register.",
    goodLooksLike: "The external parties this department exchanges personal data with, and the data involved, are recorded in the processor / recipient register with a contract reference.",
    remediation: [
      { step: "List the clients/vendors this department exchanges personal data with", effort: "S" },
      { step: "Add them to the register and check each has appropriate contract terms", effort: "S" },
    ],
    evidenceAsks: ["The department's external-party list", "The register entries and contract references"],
    ...DRAFT,
  },
  "generic-3": {
    findingKey: "rbac", domain: "security", impact: 2, likelihood: 3,
    whyItMatters: "If this department does not enforce role-based access, staff can reach personal data beyond their job need, widening the impact of any account compromise — a s.8(5) least-privilege gap.",
    goodLooksLike: "Access to this department's systems and shared stores is granted by role, provisioned through the JML process, and reviewed periodically.",
    remediation: [
      { step: "Define the department's access roles and their entitlements", effort: "S" },
      { step: "Migrate ad-hoc grants to roles and add the department to the access-review cycle", effort: "M" },
    ],
    evidenceAsks: ["The department's role definitions", "Its inclusion in the last access review"],
    ...DRAFT,
  },
  "generic-4": {
    findingKey: "no-inventory", domain: "inventory", impact: 3, likelihood: 3,
    whyItMatters: "If this department processes personal data (names, contact details, card details) it is in scope for the full Chapter II/III obligations; unrecorded, that processing sits outside every control the programme builds.",
    goodLooksLike: "The department's processing is in the inventory and RoPA with data categories, purpose, lawful basis, retention and recipients identified.",
    remediation: [
      { step: "Document what personal data the department processes, why, and on what basis", effort: "S" },
      { step: "Add it to the inventory / RoPA and apply the relevant controls (notice, retention, access)", effort: "M" },
    ],
    evidenceAsks: ["The department's inventory / RoPA entry", "Its lawful-basis and retention notes"],
    ...DRAFT,
  },
  "generic-5": {
    findingKey: "processor-register", domain: "thirdparty", impact: 2, likelihood: 3,
    whyItMatters: "Third-party software (ERP, SaaS, CRM) used by this department typically stores personal data with an external processor; under s.8(2) that needs a DPA, and the tool needs to be in the inventory.",
    goodLooksLike: "Each third-party tool this department uses is in the inventory and processor register with its data scope, hosting location and DPA status.",
    remediation: [
      { step: "List the third-party tools the department uses and what personal data each holds", effort: "S" },
      { step: "Add them to the inventory / processor register and check DPA status", effort: "S" },
    ],
    evidenceAsks: ["The department's third-party tool list", "The register entries with DPA status"],
    ...DRAFT,
  },
  "generic-6": {
    findingKey: "no-inventory", domain: "inventory", impact: 3, likelihood: 3,
    whyItMatters: "Handling employee, client or vendor data makes this department a processing point for personal data; if it is not in the inventory, notice, retention, access control and DSR fulfilment do not reach it.",
    goodLooksLike: "The department's holdings of employee/client/vendor personal data are inventoried, on the retention schedule, access-controlled, and reachable by the DSR process.",
    remediation: [
      { step: "Inventory the department's personal-data holdings by category and system", effort: "S" },
      { step: "Bring them under retention, access control and DSR search", effort: "M" },
    ],
    evidenceAsks: ["The department's personal-data holdings inventory", "Evidence it is covered by retention and DSR"],
    ...DRAFT,
  },
};

/**
 * Resolve a submission question id to a guidance entry.
 * 1. exact key, else
 * 2. a capability library entry for a `cap-*` id, else
 * 3. `generic-N` for a `${dept}-N` custom-department question, else
 * 4. null (should not happen for a valid question id — see the coverage test).
 * @param {string} questionId
 * @returns {(typeof GUIDANCE)[string] | null}
 */
export function guidanceFor(questionId) {
  if (Object.prototype.hasOwnProperty.call(GUIDANCE, questionId)) return GUIDANCE[questionId];
  // Capability gaps (environment-first assessment) resolve through the capability library.
  if (String(questionId || "").startsWith("cap-")) return capabilityGuidanceFor(questionId);
  const m = /-(\d+)[a-z]?$/.exec(String(questionId || ""));
  if (m) {
    const generic = `generic-${m[1]}`;
    if (Object.prototype.hasOwnProperty.call(GUIDANCE, generic)) return GUIDANCE[generic];
  }
  return null;
}

/**
 * Review coverage across the whole guidance dataset.
 * `reviewed` counts reviewStatus ∈ {reviewed, approved}; `approved` counts
 * reviewStatus === "approved". By construction approved ⊆ reviewed ⊆ total.
 * @returns {{ total: number, reviewed: number, approved: number }}
 */
export function guidanceReviewCoverage() {
  const entries = Object.values(GUIDANCE);
  let reviewed = 0, approved = 0;
  for (const e of entries) {
    if (e.reviewStatus === "reviewed" || e.reviewStatus === "approved") reviewed++;
    if (e.reviewStatus === "approved") approved++;
  }
  return { total: entries.length, reviewed, approved };
}
