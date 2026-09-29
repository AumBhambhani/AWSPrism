// IT questionnaire items that are no longer asked directly.
//
// Each is answered by exactly one security-capability card in the IT section
// (see capabilityLibrary.js): the user says whether they HAVE the capability and
// which tool they use, once. The matching IT answer is then DERIVED from that
// card (utils/capabilityAssessment.js → applyCapabilityDerivation) so the DPDPA
// traceability matrix, cross-department consistency checks, role map, score and
// tracker pre-fill keep working with the same question ids they always used.
//
// The original question text is kept here so reports, the AI regulatory mapper
// and Annexure E still show the real wording.
//
// Derived value: card YES→YES, PARTIAL→PARTIAL, NO→NO; UNKNOWN or unanswered →
// no answer (not assessed); card not applicable to the environment → NA.

export const IT_DERIVED_QUESTIONS = [
  { id: "it-4", capabilityId: "cap-data-discovery", section: "Data & Systems", text: "Do you have any tool for discovering/classifying personal data?" },
  { id: "it-6", capabilityId: "cap-patch-vuln", section: "Data & Systems", text: "Are regular VAPT and Configuration Reviews conducted?" },
  { id: "it-8", capabilityId: "cap-consent-management", section: "Privacy & Consent", text: "Do you have a documented process for collecting and recording consent?" },
  { id: "it-9", capabilityId: "cap-consent-management", section: "Privacy & Consent", text: "Can individuals withdraw consent?" },
  { id: "it-12", capabilityId: "cap-retention-deletion", section: "Retention & Deletion", text: "Do you have documented retention periods for personal data?" },
  { id: "it-13", capabilityId: "cap-retention-deletion", section: "Retention & Deletion", text: "Are retention/deletion rules technically enforced?" },
  { id: "it-14", capabilityId: "cap-retention-deletion", section: "Retention & Deletion", text: "Can you actually delete an individual's data from all relevant systems?" },
  { id: "it-15", capabilityId: "cap-mfa", section: "Access & Security", text: "Is MFA enabled for employees?" },
  { id: "it-18", capabilityId: "cap-identity-lifecycle", section: "Access & Security", text: "Is there a formal Joiner-Mover-Leaver process?" },
  { id: "it-19", capabilityId: "cap-edr", section: "Access & Security", text: "Do you have endpoint protection/EDR?" },
  { id: "it-20", capabilityId: "cap-device-management", section: "Access & Security", text: "Are employee devices centrally managed?" },
  { id: "it-21", capabilityId: "cap-dlp", section: "Access & Security", text: "Do you have controls to prevent unauthorised sharing of personal data?" },
  { id: "it-22", capabilityId: "cap-waf", section: "Applications & Cloud", text: "Are internet-facing applications containing personal data protected by a WAF/API security solution?" },
  { id: "it-23", capabilityId: "cap-cloud-posture", section: "Applications & Cloud", text: "Do you continuously monitor cloud environments for misconfigurations and exposure?" },
  { id: "it-24", capabilityId: "cap-cloud-posture", section: "Applications & Cloud", text: "Are excessive permissions and publicly exposed resources detected?" },
  { id: "it-25", capabilityId: "cap-patch-vuln", section: "Applications & Cloud", text: "Do you scan applications for vulnerabilities?" },
  { id: "it-26", capabilityId: "cap-tprm", section: "Third Parties", text: "Do you maintain a list of third parties/vendors that process personal data?" },
  { id: "it-26b", capabilityId: "cap-tprm", section: "Third Parties", text: "Are vendors assessed for security/privacy risks?" },
  { id: "it-27", capabilityId: "cap-tprm", section: "Third Parties", text: "Do you review third-party access to personal data?" },
  { id: "it-28", capabilityId: "cap-incident-response", section: "Breach & Incident Response", text: "Do you have a documented personal-data breach/incident response process?" },
  { id: "it-30", capabilityId: "cap-siem", section: "Breach & Incident Response", text: "Do you have centralised security monitoring?" },
  { id: "it-31", capabilityId: "cap-backup", section: "Breach & Incident Response", text: "Are backups regularly tested for recovery?" },
];

export const IT_DERIVED_BY_ID = Object.fromEntries(IT_DERIVED_QUESTIONS.map(q => [q.id, q]));
export const IT_DERIVED_IDS = new Set(IT_DERIVED_QUESTIONS.map(q => q.id));
