// Crosswalk: self-assessment question id  ->  framework control references
// (for the main compliance catalog) and department-onboarding categories.
//
// WHY THIS FILE EXISTS
// The pre-onboarding self-assessment (deptSelfAssessQuestions.js, answers stored
// as { "it-8": "YES" } in self_assessment_submissions) has no structural link to
// the real tracker (`questions` / `assessments`). When a superadmin approves a
// company we want to PRE-FILL the tracker from what the company already told us
// (see utils/seedAssessmentsFromSelfAssessment.js). This file is the static half
// of the hybrid mapping; anything it leaves unresolved falls through to the
// aiProvider.mapSelfAssessmentToQuestions() fallback.
//
// HOW THE MAPPING IS BUILT
//  - `domain` comes from selfAssessQuestionGuidance.GUIDANCE (a PRIVACY_DOMAINS id).
//  - ISO/IEC 27001:2022 Annex A + GDPR refs come from DOMAIN_CONTROLS below — a
//    curated domain -> control map aligned with the 31-control Annex A subset in
//    data/legal/iso-27001-2022-annex-a.json and the capability table in
//    data/dpdpaMethodology.js.
//  - DPDPA section refs are inverted from DPDPA_TRACEABILITY in
//    selfAssessmentCrosswalk.js (it already lists { section, triggers: [ids] }).
//  - `deptCats` (for the dept-<slug>-qNN onboarding questions) come from
//    DOMAIN_DEPT_CAT below, keyed by (onboarding department, domain).
//
// The resolver normalises both sides of a control reference before matching
// (strip whitespace / "A." / "Art." / "s." / parens), so "A.8.5", "8.5",
// "s.8(5)" and "8 5" all compare equal. Control-reference strings in a given
// company's question_framework_controls ultimately come from whatever framework
// spreadsheet the superadmin imported, so matching is deliberately fuzzy and the
// AI fallback covers the rest.

import { GUIDANCE } from "../utils/selfAssessQuestionGuidance.js";
import { DPDPA_TRACEABILITY } from "./selfAssessmentCrosswalk.js";
import { DEPT_QUESTIONS as SELF_ASSESS_QUESTIONS, fallbackDeptQuestions } from "../utils/deptSelfAssessQuestions.js";

// ─── domain -> curated framework controls ────────────────────────────────────
const DOMAIN_CONTROLS = {
  governance: { ISO27001: ["A.5.1", "A.5.31", "A.5.34"], GDPR: ["Art. 5", "Art. 24"] },
  inventory:  { ISO27001: ["A.5.9", "A.5.12"],           GDPR: ["Art. 30"] },
  notice:     { ISO27001: ["A.5.34"],                    GDPR: ["Art. 13", "Art. 14"] },
  consent:    { ISO27001: ["A.5.34"],                    GDPR: ["Art. 6", "Art. 7"] },
  rights:     { ISO27001: ["A.5.34", "A.8.3"],           GDPR: ["Art. 15", "Art. 16", "Art. 17"] },
  retention:  { ISO27001: ["A.5.33", "A.5.34", "A.7.10"], GDPR: ["Art. 5"] },
  security:   { ISO27001: ["A.5.15", "A.8.2", "A.8.5", "A.8.8", "A.8.9", "A.8.13", "A.8.16", "A.8.24"], GDPR: ["Art. 32"] },
  breach:     { ISO27001: ["A.5.24", "A.8.16"],          GDPR: ["Art. 33", "Art. 34"] },
  thirdparty: { ISO27001: ["A.5.19", "A.5.20", "A.5.23"], GDPR: ["Art. 28"] },
  children:   { ISO27001: ["A.5.34"],                    GDPR: ["Art. 8"] },
  training:   { ISO27001: ["A.6.3"],                     GDPR: ["Art. 39"] },
};

// ─── (onboarding department, domain) -> department-question control_area(s) ───
// control_area values are the `cat` fields in utils/departmentQuestions.js.
// The onboarding bank has no SWE department — SWE self-assessment answers are
// routed to IT here.
const DOMAIN_DEPT_CAT = {
  IT: {
    inventory:  ["Data Discovery & Classification"],
    notice:     ["Consent & Notice Management"],
    consent:    ["Consent & Notice Management"],
    rights:     ["Data Principal Requests"],
    retention:  ["Data Retention & Deletion"],
    security:   ["Personal Data Security", "Device Security", "Application & API Security",
                 "Cloud & Infrastructure Security", "Data Sharing & Leakage Control",
                 "Access & Identity Management"],
    breach:     ["Breach Detection", "Incident Response", "Recovery & Backup"],
    thirdparty: ["Vendor & Processor Management"],
    governance: ["Continuous Compliance Monitoring", "Evidence & Audit Trail"],
    training:   ["Evidence & Audit Trail"],
  },
  HR: {
    consent:    ["Employee Data & Consent"],
    notice:     ["Employee Data & Consent"],
    rights:     ["Employee Data & Consent"],
    governance: ["Employee Data & Consent", "Audit & Access Control"],
    security:   ["Sensitive Data Protection", "Audit & Access Control"],
    retention:  ["Data Retention"],
    thirdparty: ["Vendor & Third-Party"],
    training:   ["Training & Awareness"],
  },
  Finance: {
    inventory:  ["Data Inventory & Classification"],
    security:   ["Access Control", "Data Security"],
    retention:  ["Compliance & Retention"],
    thirdparty: ["Vendor & Third-Party"],
    breach:     ["Incident Response"],
    training:   ["Training & Awareness"],
  },
  Legal: {
    inventory:  ["Data Classification"],
    security:   ["Data Classification"],
    rights:     ["Data Subject Rights"],
    retention:  ["Legal Hold & Retention"],
    thirdparty: ["Vendor & Third-Party", "Contract Governance"],
    consent:    ["Contract Governance"],
    governance: ["Contract Governance"],
    breach:     ["Contract Governance"],
  },
  Operations: {
    inventory:  ["Data Inventory"],
    retention:  ["Data Retention", "Data Minimisation"],
    security:   ["Access Control", "System Security"],
    thirdparty: ["Vendor & Third-Party"],
    breach:     ["Incident Response"],
    governance: ["Data Inventory"],
    training:   ["Training & Awareness"],
  },
  Marketing: {
    consent:    ["Consent & Opt-in"],
    notice:     ["Consent & Opt-in"],
    rights:     ["CRM Data Governance"],
    governance: ["CRM Data Governance"],
    security:   ["CRM Data Governance", "Profiling & Targeting"],
    thirdparty: ["Vendor & Third-Party"],
    retention:  ["CRM Data Governance"],
    training:   ["Training & Awareness"],
  },
};
DOMAIN_DEPT_CAT.SWE = DOMAIN_DEPT_CAT.IT;

// ─── ids we deliberately do NOT try to map ───────────────────────────────────
// Stress-test / reflective questions and Data-Principal-duty items that have no
// clean control equivalent. Listed so the AI fallback does not chase them either.
const SKIP_IDS = new Set([
  "it-32", "it-33", "it-34", "it-35", // "Stress Test" section — reflective, not controls
]);

// ─── DPDPA section refs, inverted from DPDPA_TRACEABILITY ────────────────────
const DPDPA_BY_QUESTION = (() => {
  const m = {};
  for (const row of DPDPA_TRACEABILITY) {
    for (const t of row.triggers || []) {
      (m[t] ||= new Set()).add(row.section);
    }
  }
  return m;
})();

// ─── per-id keyword hints for text-similarity fallback ───────────────────────
// Only where the question text alone is a weak signal; most ids inherit an
// empty list and rely on the question text itself.
const KEYWORDS = {
  "it-1": ["inventory", "systems", "applications"],
  "it-5": ["network", "segregation", "diagram"],
  "it-6": ["vapt", "penetration", "configuration review"],
  "it-15": ["mfa", "multi-factor", "authentication"],
  "it-16": ["rbac", "role-based", "access"],
  "it-19": ["endpoint", "edr", "protection"],
  "it-22": ["waf", "api security", "web application firewall"],
  "it-30": ["siem", "monitoring", "centralised"],
  "it-31": ["backup", "recovery", "restore"],
  "sw-3": ["encryption", "in transit", "at rest"],
  "fi-2": ["mfa", "financial", "access"],
};

// Follow-up ids inherit their parent's domain when guidance has no entry.
const FOLLOWUP_PARENT = {
  "hr-1a": "hr-1", "hr-1b": "hr-1", "hr-1c": "hr-1",
  "fi-7a": "fi-7", "fi-7b": "fi-7", "fi-7c": "fi-7",
  "mk-1a": "mk-1", "mk-1b": "mk-1",
};

/** Resolve a self-assessment id to its PRIVACY_DOMAINS domain, or null. */
export function domainForSelfAssessId(id) {
  const g = GUIDANCE[id];
  if (g?.domain) return g.domain;
  const parent = FOLLOWUP_PARENT[id];
  if (parent && GUIDANCE[parent]?.domain) return GUIDANCE[parent].domain;
  // custom-department fallback question ("<dept>-3") -> shared generic-N entry
  const m = /-(\d)$/.exec(id);
  if (m && GUIDANCE[`generic-${m[1]}`]) return GUIDANCE[`generic-${m[1]}`].domain;
  return null;
}

/**
 * The full crosswalk entry for a self-assessment question id.
 * @returns {{ id, domain, skip, controls: Array<{framework,ref}>, deptCats: string[], keywords: string[] } | null}
 */
export function controlMapFor(id, { department } = {}) {
  const domain = domainForSelfAssessId(id);
  const skip = SKIP_IDS.has(id);

  const controls = [];
  if (domain && DOMAIN_CONTROLS[domain]) {
    for (const [framework, refs] of Object.entries(DOMAIN_CONTROLS[domain])) {
      for (const ref of refs) controls.push({ framework, ref });
    }
  }
  for (const section of DPDPA_BY_QUESTION[id] || []) {
    controls.push({ framework: "DPDPA", ref: section });
  }

  const deptCats = [];
  if (domain && department && DOMAIN_DEPT_CAT[department]?.[domain]) {
    deptCats.push(...DOMAIN_DEPT_CAT[department][domain]);
  }

  return { id, domain, skip, controls, deptCats, keywords: KEYWORDS[id] || [] };
}

/** Every id known to the self-assessment question bank (base + follow-ups + generic fallback). */
export function allSelfAssessIds() {
  const ids = new Set();
  for (const [dept, questions] of Object.entries(SELF_ASSESS_QUESTIONS)) {
    for (const q of questions) {
      ids.add(q.id);
      for (const fq of q.followUps?.questions || []) ids.add(fq.id);
    }
  }
  for (const q of fallbackDeptQuestions("generic")) ids.add(q.id);
  return [...ids];
}

export const _internal = { DOMAIN_CONTROLS, DOMAIN_DEPT_CAT, DPDPA_BY_QUESTION, SKIP_IDS };
