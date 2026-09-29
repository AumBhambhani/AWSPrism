// The environment questionnaire that runs BEFORE the capability questions. These
// are simple facts about the estate (Yes/No, plus one multi-select) — they do not
// ask whether a control exists. capabilityLibrary.js turns the answers into a
// Mandatory / Recommended / Not-applicable decision per capability.
//
// Answers are stored as { platforms: ["m365", ...], mobile: "YES", ... } keyed by
// `key` (not by id) so the rules in capabilityLibrary.js read naturally.
//
// Only FACTS about the estate are asked here. Whether a control already exists
// (central monitoring, incident-response process, retention, deletion, asset
// inventory, …) is asked once, on the matching capability card in the IT section —
// never twice.

export const ENVIRONMENT_QUESTIONS_VERSION = "2";

export const PLATFORM_OPTIONS = [
  { value: "m365", label: "Microsoft 365" },
  { value: "azure", label: "Microsoft Azure" },
  { value: "aws", label: "AWS" },
  { value: "gcp", label: "Google Cloud / Workspace" },
  { value: "other_cloud", label: "Other cloud" },
  { value: "onprem", label: "On-premises" },
  { value: "hybrid", label: "Hybrid (cloud + on-prem)" },
];

export const ENVIRONMENT_QUESTIONS = [
  { id: "env-1", key: "platforms",           type: "multi", group: "Platforms", text: "Which platforms do you use?", options: PLATFORM_OPTIONS, why: "Determines the technology ecosystem, and therefore which native tools to recommend first." },
  { id: "env-2", key: "endpoints",           type: "yesno", group: "Users & devices", text: "Do employees access personal data through laptops or desktops?", why: "Triggers endpoint detection, device management, disk encryption and patching." },
  { id: "env-3", key: "mobile",              type: "yesno", group: "Users & devices", text: "Do employees access personal data from mobile devices?", why: "Triggers mobile device / application management." },
  { id: "env-4", key: "remote",              type: "yesno", group: "Users & devices", text: "Do you have remote or hybrid users?", why: "Triggers MFA, secure remote access and device-compliance controls." },
  { id: "env-5", key: "privileged",          type: "yesno", group: "Identity", text: "Do you have privileged or administrator users?", why: "Triggers privileged access management." },
  { id: "env-6", key: "multiApps",           type: "yesno", group: "Identity", text: "Do you have multiple business applications that employees need access to?", why: "Triggers centralised identity and joiner-mover-leaver automation." },
  { id: "env-7", key: "externalLogins",      type: "yesno", group: "Identity", text: "Do customers, vendors or partners log into your applications?", why: "Triggers customer / external identity management." },
  { id: "env-8", key: "publicWeb",           type: "yesno", group: "Applications", text: "Do you operate public-facing websites, portals or applications that process personal data?", why: "Triggers a web application firewall and continuous vulnerability management." },
  { id: "env-9", key: "apis",                type: "yesno", group: "Applications", text: "Do you expose APIs that process personal data?", why: "Triggers API security." },
  { id: "env-10", key: "customApps",          type: "yesno", group: "Applications", text: "Do you develop or maintain custom applications?", why: "Triggers application security testing, secure SDLC and secrets scanning." },
  { id: "env-11", key: "legacyApps",          type: "yesno", group: "Applications", text: "Do you have legacy applications processing personal data?", why: "Triggers compensating-control assessment where native controls are not possible." },
  { id: "env-12", key: "databases",           type: "yesno", group: "Data", text: "Is personal data stored in databases?", why: "Triggers database security, encryption, activity logging and deletion." },
  { id: "env-13", key: "unstructured",        type: "yesno", group: "Data", text: "Is personal data stored in files, email, SharePoint, cloud drives or local folders?", why: "Triggers discovery, classification, DLP and information protection." },
  { id: "env-14", key: "saas",                type: "yesno", group: "Third parties", text: "Do you use SaaS applications to process customer, employee or vendor data?", why: "Triggers SaaS inventory, access reviews and vendor risk." },
  { id: "env-15", key: "vendors",             type: "yesno", group: "Third parties", text: "Do third-party vendors or processors handle personal data?", why: "Triggers third-party risk management and processor contracts." },
  { id: "env-16", key: "consent",             type: "yesno", group: "Privacy operations", text: "Do you collect consent through websites, apps, forms or marketing channels?", why: "Triggers consent and preference management." },
  { id: "env-17", key: "backups",             type: "yesno", group: "Resilience", text: "Do you maintain backups of systems that contain personal data?", why: "Triggers backup protection, immutability and restore testing." },
  { id: "env-18", key: "criticalSystems",     type: "yesno", group: "Resilience", text: "Do you operate business-critical systems that contain personal data?", why: "Triggers disaster recovery and business continuity." },
  { id: "env-19", key: "hrms",                type: "yesno", group: "Identity", text: "Do you have an HRMS or an authoritative employee directory?", why: "Supports joiner-mover-leaver validation." },
  { id: "env-20", key: "eolSystems",          type: "yesno", group: "Applications", text: "Are there unsupported or end-of-life systems in the environment?", why: "Triggers legacy handling and compensating controls." },
];

export const ENVIRONMENT_KEYS = ENVIRONMENT_QUESTIONS.map(q => q.key);
export const ENVIRONMENT_YESNO = new Set(["YES", "NO"]);

/**
 * Validate and normalise an environment answer map.
 * Unknown keys are dropped; yes/no values must be YES|NO; platforms must be a
 * subset of PLATFORM_OPTIONS.
 * @returns {{ ok: true, value: object } | { ok: false, error: string }}
 */
export function normaliseEnvironment(raw) {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return { ok: false, error: "answers must be an object" };
  const platformValues = new Set(PLATFORM_OPTIONS.map(o => o.value));
  const out = {};
  for (const q of ENVIRONMENT_QUESTIONS) {
    const v = raw[q.key];
    if (v == null) continue;
    if (q.type === "multi") {
      if (!Array.isArray(v) || v.some(x => !platformValues.has(x))) return { ok: false, error: `${q.key}: invalid platform selection` };
      out[q.key] = [...new Set(v)];
    } else {
      if (!ENVIRONMENT_YESNO.has(v)) return { ok: false, error: `${q.key}: must be YES or NO` };
      out[q.key] = v;
    }
  }
  return { ok: true, value: out };
}
