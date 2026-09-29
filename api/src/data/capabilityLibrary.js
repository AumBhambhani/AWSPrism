// The security / privacy capability master library for the environment-first
// assessment. STATIC, AI-drafted, human-reviewed — NOT a runtime AI dependency.
//
// Each capability carries:
//   rules        Applicability, evaluated against the environment answers (see
//                environmentQuestions.js). First-listed rule that matches at the
//                HIGHEST level wins; no match → "na". `when: []` always matches.
//                A clause is { key, is: "YES"|"NO" } or { key: "platforms", hasAny: [...] }.
//   tools        Suggested tools per ecosystem (microsoft | aws | gcp | other).
//                Only the platforms the user actually SELECTED contribute their native
//                tools (native first, so PRISM extends what they already license), then
//                the vendor-neutral list. A vendor is never listed for a platform the
//                user does not use. Put a native tool on a card ONLY where it is a
//                genuine fit for that capability — an empty native list is fine.
//   guidance     What the report renders when this capability is missing or partial:
//                domain, findingKey, impact, likelihood, whyItMatters, goodLooksLike,
//                remediation, evidenceAsks, review metadata. Same shape as an entry in
//                selfAssessQuestionGuidance.js so the readiness engine treats a
//                capability gap exactly like a questionnaire gap.
//
// RULES
//  - No regulatory provision id / URL / penalty lives here. Provisions come only from
//    the grounded regulatory-exposure mapping (utils/aiProvider.js → provisionIndex.js).
//  - `guidance.findingKey` must exist in FINDINGS (selfAssessmentCrosswalk.js);
//    `guidance.domain` must be a PRIVACY_DOMAINS id.
//  - Review metadata invariant (same as the question guidance):
//      ai_draft | needs_revision  → reviewedAt === null && reviewedBy === null
//      reviewed | approved        → reviewedAt !== null && reviewedBy !== null
//
// Bump CAPABILITY_LIBRARY_VERSION on any semantic content change — it feeds the AI
// cache fingerprint (routes/selfAssessment.js).

export const CAPABILITY_LIBRARY_VERSION = "2";

const DRAFT = { reviewStatus: "ai_draft", reviewedAt: null, reviewedBy: null };
const yes = (key) => ({ key, is: "YES" });
const any = (key, ...values) => ({ key, hasAny: values });
const CLOUD = ["m365", "azure", "aws", "gcp", "other_cloud", "hybrid"];

/** Ecosystem of the estate, used to order suggested tools. */
export const ECOSYSTEM_LABEL = {
  microsoft: "Microsoft-native",
  aws: "AWS-native",
  gcp: "Google-native",
  other: "Vendor-neutral",
};

export const CAPABILITY_AREAS = [
  "Identity & access", "Endpoint & devices", "Applications & perimeter", "Data protection",
  "Monitoring & response", "Resilience", "Third parties & SaaS", "Privacy operations", "Governance",
];

export const CAPABILITIES = [
  // ───────────────────────────────────────────────── Identity & access ──
  {
    id: "cap-mfa", name: "Multi-factor authentication", area: "Identity & access",
    what: "MFA on every account that can reach personal data — employees, admins and remote users.",
    rules: [{ when: [], level: "mandatory", reason: "Any organisation holding personal data needs a second factor on the accounts that reach it; stolen passwords are the most common breach path." }],
    tools: {
      microsoft: ["Microsoft Entra ID MFA + Conditional Access"], aws: ["AWS IAM Identity Center"], gcp: ["Google Workspace 2-Step Verification"],
      other: ["Okta", "Duo", "Ping Identity"],
    },
    guidance: {
      findingKey: "cap-identity", domain: "security", impact: 4, likelihood: 4,
      whyItMatters: "Without MFA a single phished or reused password gives an attacker the same access as the employee. That is the most direct route to a personal-data breach and a weak answer to any 'reasonable security safeguards' question.",
      goodLooksLike: "MFA enforced by policy (not opt-in) for every user, with phishing-resistant methods for administrators; legacy protocols that bypass MFA blocked; exceptions documented and time-boxed.",
      remediation: [
        { step: "Inventory which applications and user groups are not yet behind MFA", effort: "S" },
        { step: "Enforce MFA through the identity provider's conditional-access / sign-on policy, starting with administrators and remote users", effort: "S" },
        { step: "Block legacy authentication protocols and app passwords that bypass MFA", effort: "S" },
        { step: "Move administrators to phishing-resistant factors (FIDO2 / passkeys)", effort: "M" },
      ],
      evidenceAsks: ["The MFA / conditional-access policy export", "A report of MFA registration and enforcement coverage by user", "The list and justification of any MFA exceptions"],
    },
  },
  {
    id: "cap-identity-lifecycle", name: "Identity lifecycle (joiner-mover-leaver / SCIM)", area: "Identity & access",
    what: "Automated provisioning and de-provisioning of access driven by the HR record of truth.",
    rules: [
      { when: [yes("multiApps")], level: "mandatory", reason: "Several business applications each hold their own access list; without lifecycle automation, leavers and movers keep access they should have lost." },
      { when: [yes("hrms")], level: "recommended", reason: "An HRMS exists and can act as the authoritative source that drives access changes." },
    ],
    tools: {
      microsoft: ["Microsoft Entra ID Governance (lifecycle workflows, SCIM provisioning)"], aws: ["AWS IAM Identity Center with SCIM"], gcp: ["Google Cloud Identity with SCIM"],
      other: ["SailPoint", "Okta Lifecycle Management", "Saviynt"],
    },
    guidance: {
      findingKey: "cap-identity", domain: "security", impact: 3, likelihood: 4,
      whyItMatters: "Manual on/offboarding leaves orphaned and over-privileged accounts. Access that outlives employment is a quiet, common source of unauthorised access to personal data and is hard to evidence to an auditor.",
      goodLooksLike: "HR system events (join, move, leave) automatically create, change and remove access in connected applications, with a periodic access review confirming the result.",
      remediation: [
        { step: "Name the HRMS / directory as the authoritative source and clean its role and department data", effort: "M" },
        { step: "Connect the highest-risk applications first via SCIM or the identity provider's connectors", effort: "M" },
        { step: "Automate same-day leaver disablement and a manager-approved mover workflow", effort: "M" },
        { step: "Run a quarterly access review and retain the sign-off", effort: "S" },
      ],
      evidenceAsks: ["The joiner-mover-leaver procedure", "A sample of leaver tickets showing time to access removal", "The latest access-review sign-off"],
    },
  },
  {
    id: "cap-pam", name: "Privileged access management", area: "Identity & access",
    what: "Just-in-time, approved and recorded use of administrator accounts.",
    rules: [{ when: [yes("privileged")], level: "mandatory", reason: "Administrator accounts can read or delete personal data at scale; standing, unmonitored admin access is a high-impact risk." }],
    tools: {
      microsoft: ["Microsoft Entra Privileged Identity Management"], aws: ["AWS IAM Identity Center permission sets + CloudTrail"], gcp: ["Google Cloud Privileged Access Manager"],
      other: ["CyberArk", "BeyondTrust", "Delinea"],
    },
    guidance: {
      findingKey: "cap-identity", domain: "security", impact: 4, likelihood: 3,
      whyItMatters: "Standing administrator rights mean one compromised account exposes every system it touches. Without recorded, time-limited elevation there is no way to show who accessed personal data or why.",
      goodLooksLike: "No standing admin rights for daily use; elevation is just-in-time, approved and logged; break-glass accounts are vaulted and alerted on; admin activity is reviewed.",
      remediation: [
        { step: "List all privileged accounts and remove those no longer needed", effort: "S" },
        { step: "Separate admin identities from daily-use identities", effort: "S" },
        { step: "Introduce just-in-time elevation with approval and session logging", effort: "M" },
        { step: "Vault and alert on break-glass credentials", effort: "S" },
      ],
      evidenceAsks: ["The privileged-account list with owners", "Elevation / approval logs for a sample period", "The break-glass procedure and last test"],
    },
  },
  {
    id: "cap-ciam", name: "Customer / external identity management (CIAM)", area: "Identity & access",
    what: "Sign-in, registration and consent-aware identity for customers, vendors and partners.",
    rules: [{ when: [yes("externalLogins")], level: "mandatory", reason: "External users authenticate to your applications, so account takeover of those users is a direct route to personal data." }],
    tools: {
      microsoft: ["Microsoft Entra External ID"], aws: ["Amazon Cognito"], gcp: ["Google Identity Platform"],
      other: ["Auth0", "Okta Customer Identity", "Ping Identity"],
    },
    guidance: {
      findingKey: "cap-identity", domain: "security", impact: 4, likelihood: 3,
      whyItMatters: "Home-grown login for customers usually lacks MFA, breach-password checks, rate limiting and account-recovery hardening. Account takeover exposes the customer's personal data and is attributable to the organisation.",
      goodLooksLike: "A managed CIAM service with adaptive MFA, credential-stuffing protection, secure recovery, and audit logs; consent and profile data held in one place.",
      remediation: [
        { step: "Inventory the external-facing applications and how each authenticates users", effort: "S" },
        { step: "Move authentication to a managed CIAM service with step-up MFA and bot protection", effort: "L" },
        { step: "Centralise profile and consent records so rights requests can be served from one place", effort: "M" },
      ],
      evidenceAsks: ["The list of external-facing applications and their sign-in method", "CIAM policy configuration (MFA, lockout, recovery)", "Sample authentication and anomaly logs"],
    },
  },
  {
    id: "cap-secure-access", name: "Secure remote access (Zero Trust / VPN / access proxy)", area: "Identity & access",
    what: "Identity- and device-aware access to internal applications, including legacy ones that cannot support MFA natively.",
    rules: [
      { when: [yes("remote")], level: "mandatory", reason: "Remote and hybrid users reach internal applications from networks you do not control." },
      { when: [yes("legacyApps")], level: "recommended", reason: "Legacy applications that cannot enforce MFA themselves can be fronted by an access proxy as a compensating control." },
    ],
    tools: {
      microsoft: ["Microsoft Entra Private Access / Application Proxy", "Conditional Access with device compliance"], aws: ["AWS Verified Access", "AWS Client VPN"], gcp: ["Google BeyondCorp Enterprise / Identity-Aware Proxy"],
      other: ["Cloudflare Access", "Zscaler Private Access", "Palo Alto Prisma Access"],
    },
    guidance: {
      findingKey: "cap-identity", domain: "security", impact: 4, likelihood: 3,
      whyItMatters: "Applications reachable from the internet, or through a flat VPN, let anyone with a stolen credential in. An access layer enforces identity and device posture and gives a compensating control for systems that cannot enforce MFA themselves.",
      goodLooksLike: "Internal and legacy applications are published only through an identity-aware access layer that enforces MFA and device compliance; no direct inbound exposure; access is logged.",
      remediation: [
        { step: "List internal and legacy applications currently reachable without MFA or directly from the internet", effort: "S" },
        { step: "Front them with an identity-aware access proxy or ZTNA service enforcing MFA and device compliance", effort: "M" },
        { step: "Retire broad network-level VPN access in favour of per-application access", effort: "L" },
      ],
      evidenceAsks: ["The application-publishing inventory", "Access-policy configuration showing MFA and device conditions", "Access logs for a sample period"],
    },
  },

  // ─────────────────────────────────────────────── Endpoint & devices ──
  {
    id: "cap-edr", name: "Endpoint detection and response (EDR)", area: "Endpoint & devices",
    what: "Behavioural malware/ransomware detection and response on laptops, desktops and servers.",
    rules: [
      { when: [yes("endpoints")], level: "mandatory", reason: "Employees access personal data from laptops and desktops, which are the usual entry point for ransomware and credential theft." },
      { when: [yes("mobile")], level: "recommended", reason: "Mobile devices also handle personal data; mobile threat defence is worthwhile where they do." },
    ],
    tools: {
      microsoft: ["Microsoft Defender for Endpoint"], aws: ["Amazon GuardDuty (runtime)"], gcp: [],
      other: ["CrowdStrike Falcon", "SentinelOne", "Sophos Intercept X"],
    },
    guidance: {
      findingKey: "cap-endpoint", domain: "security", impact: 3, likelihood: 4,
      whyItMatters: "Signature antivirus does not stop modern ransomware or credential theft. Without EDR an intrusion on a laptop can spread to file shares and databases holding personal data with no early warning.",
      goodLooksLike: "EDR on every managed endpoint and server, reporting to a console that is monitored, with automated isolation of compromised hosts and coverage tracked.",
      remediation: [
        { step: "Measure current EDR coverage against the asset inventory", effort: "S" },
        { step: "Deploy or extend the EDR agent to all uncovered endpoints and servers", effort: "M" },
        { step: "Enable automated containment and route high-severity alerts to a monitored queue", effort: "M" },
      ],
      evidenceAsks: ["EDR coverage report against the asset list", "Sample alert-to-response records", "Policy configuration showing prevention mode"],
    },
  },
  {
    id: "cap-device-management", name: "Device and mobile management (MDM / MAM)", area: "Endpoint & devices",
    what: "Central enrolment, configuration, compliance and remote-wipe of company and personal devices.",
    rules: [
      { when: [yes("mobile")], level: "mandatory", reason: "Personal data is reachable from mobile devices, which are easily lost or stolen and otherwise unmanaged." },
      { when: [yes("endpoints")], level: "mandatory", reason: "Laptops and desktops that reach personal data need enforced configuration, encryption and remote-wipe." },
    ],
    tools: {
      microsoft: ["Microsoft Intune"], aws: [], gcp: ["Google Endpoint Management"],
      other: ["Jamf", "VMware Workspace ONE", "Kandji"],
    },
    guidance: {
      findingKey: "cap-endpoint", domain: "security", impact: 4, likelihood: 4,
      whyItMatters: "Unmanaged devices cannot be encrypted, patched or wiped on demand. A lost laptop or phone with personal data on it is a reportable breach unless you can show it was encrypted and remotely wiped.",
      goodLooksLike: "All devices that reach personal data are enrolled, must pass compliance (encryption, patch level, screen lock) to access company data, and can be remotely wiped.",
      remediation: [
        { step: "Enrol all company laptops and phones; define a policy for personal (BYOD) devices", effort: "M" },
        { step: "Set compliance baselines (encryption, OS version, lock) and require them for access", effort: "M" },
        { step: "Test remote wipe and document the lost-device procedure", effort: "S" },
      ],
      evidenceAsks: ["Enrolment coverage report against the asset list", "Compliance policy configuration", "A recorded remote-wipe test"],
    },
  },
  {
    id: "cap-disk-encryption", name: "Endpoint disk encryption", area: "Endpoint & devices",
    what: "Full-disk encryption on laptops and desktops with recoverable, escrowed keys.",
    rules: [{ when: [yes("endpoints")], level: "mandatory", reason: "Employees hold personal data on laptops and desktops; encryption is what makes a lost device a non-event." }],
    tools: {
      microsoft: ["BitLocker via Microsoft Intune"], aws: [], gcp: [],
      other: ["BitLocker", "FileVault", "Sophos SafeGuard"],
    },
    guidance: {
      findingKey: "cap-endpoint", domain: "security", impact: 3, likelihood: 3,
      whyItMatters: "An unencrypted lost or stolen laptop that held personal data is a personal-data breach in its own right. Encryption turns it into a hardware loss.",
      goodLooksLike: "Full-disk encryption enforced by policy on every endpoint, keys escrowed centrally, and encryption status reported per device.",
      remediation: [
        { step: "Report current encryption status per device", effort: "S" },
        { step: "Enforce encryption through the device-management policy and escrow recovery keys", effort: "S" },
        { step: "Remediate or retire devices that cannot be encrypted", effort: "M" },
      ],
      evidenceAsks: ["Encryption status report by device", "Key-escrow configuration"],
    },
  },
  {
    id: "cap-patch-vuln", name: "Patch and vulnerability management", area: "Endpoint & devices",
    what: "Regular vulnerability scanning and timely patching of endpoints, servers and applications.",
    rules: [
      { when: [yes("publicWeb")], level: "mandatory", reason: "Internet-facing systems are scanned by attackers continuously; unpatched flaws are exploited within days." },
      { when: [yes("eolSystems")], level: "mandatory", reason: "Unsupported systems no longer receive patches, so their known flaws stay open." },
      { when: [], level: "mandatory", reason: "Known, unpatched vulnerabilities are a leading cause of personal-data breaches for any organisation." },
    ],
    tools: {
      microsoft: ["Microsoft Defender Vulnerability Management", "Microsoft Intune / Windows Update for Business"], aws: ["Amazon Inspector", "AWS Systems Manager Patch Manager"], gcp: ["Google Security Command Center", "OS Config patch management"],
      other: ["Tenable", "Qualys", "Rapid7"],
    },
    guidance: {
      findingKey: "cap-appsec", domain: "security", impact: 3, likelihood: 4,
      whyItMatters: "Most exploited vulnerabilities have a patch available. Without scanning and a patch SLA the organisation cannot say how exposed it is, and a breach through a known, unpatched flaw is hard to defend.",
      goodLooksLike: "Authenticated scans on a fixed cadence across endpoints, servers and applications; risk-ranked findings with patch SLAs (e.g. critical within 15 days); exceptions approved and tracked.",
      remediation: [
        { step: "Scan all in-scope assets and baseline the current backlog", effort: "S" },
        { step: "Define patch SLAs by severity and assign owners", effort: "S" },
        { step: "Automate patch deployment and report SLA breaches monthly", effort: "M" },
      ],
      evidenceAsks: ["Latest vulnerability scan report", "The patch-management SLA document", "SLA compliance metrics for the last quarter"],
    },
  },

  // ───────────────────────────────────────── Applications & perimeter ──
  {
    id: "cap-waf", name: "Web application firewall (WAF)", area: "Applications & perimeter",
    what: "Filtering of malicious traffic (injection, bots, DDoS) in front of public web applications.",
    rules: [{ when: [yes("publicWeb")], level: "mandatory", reason: "A public-facing site that processes personal data is continuously attacked; a WAF blocks common exploitation before it reaches the application." }],
    tools: {
      microsoft: ["Azure Front Door WAF", "Azure Application Gateway WAF"], aws: ["AWS WAF + Shield"], gcp: ["Google Cloud Armor"],
      other: ["Cloudflare", "Akamai App & API Protector", "Imperva"],
    },
    guidance: {
      findingKey: "cap-appsec", domain: "security", impact: 4, likelihood: 3,
      whyItMatters: "Public web applications are the most exposed asset. Without a WAF, injection and bot attacks reach the application directly, and a breach through a well-known attack class is hard to defend as 'reasonable' security.",
      goodLooksLike: "Every public application is behind a WAF in blocking mode with managed rule sets, bot and rate-limit controls, and logs sent to monitoring.",
      remediation: [
        { step: "List all public-facing applications and confirm which are behind a WAF", effort: "S" },
        { step: "Deploy the platform-native WAF (or a CDN-based WAF) in front of the uncovered ones, first in detect then block mode", effort: "M" },
        { step: "Enable bot and rate-limit rules and send WAF logs to central monitoring", effort: "S" },
      ],
      evidenceAsks: ["The list of public applications and their WAF status", "WAF policy in blocking mode", "Sample blocked-attack logs"],
    },
  },
  {
    id: "cap-api-security", name: "API security", area: "Applications & perimeter",
    what: "Discovery, authentication, rate-limiting and abuse detection for APIs that carry personal data.",
    rules: [{ when: [yes("apis")], level: "mandatory", reason: "APIs expose data directly, often without the protections a user interface provides, and shadow APIs are common." }],
    tools: {
      microsoft: ["Azure API Management", "Microsoft Defender for APIs"], aws: ["Amazon API Gateway + AWS WAF"], gcp: ["Apigee", "Cloud Armor"],
      other: ["Akamai API Security", "Salt Security", "Traceable"],
    },
    guidance: {
      findingKey: "cap-appsec", domain: "security", impact: 4, likelihood: 3,
      whyItMatters: "Broken object-level authorisation and unauthenticated endpoints are the most common way personal data leaks through APIs. Unknown 'shadow' APIs cannot be protected at all.",
      goodLooksLike: "A complete API inventory; every API authenticated and authorised per object; rate limiting and anomaly detection; schemas validated; logs monitored.",
      remediation: [
        { step: "Discover and inventory all APIs, including undocumented ones", effort: "M" },
        { step: "Front APIs with a gateway enforcing authentication, quotas and schema validation", effort: "M" },
        { step: "Test for broken authorisation and excessive data exposure as part of release", effort: "M" },
      ],
      evidenceAsks: ["The API inventory with owners and data classes", "Gateway policy showing authentication and rate limits", "Latest API security test report"],
    },
  },
  {
    id: "cap-appsec", name: "Application security testing and secure SDLC", area: "Applications & perimeter",
    what: "Code and dependency scanning, secrets detection and security gates in the build pipeline.",
    rules: [{ when: [yes("customApps")], level: "mandatory", reason: "You build or maintain custom applications, so flaws you introduce yourself must be caught before release." }],
    tools: {
      microsoft: ["GitHub Advanced Security", "Microsoft Defender for DevOps"], aws: ["Amazon CodeGuru Security", "Amazon Inspector (code)"], gcp: ["Google Cloud Build + Artifact Analysis"],
      other: ["Snyk", "SonarQube", "Checkmarx", "GitGuardian"],
    },
    guidance: {
      findingKey: "cap-appsec", domain: "security", impact: 3, likelihood: 4,
      whyItMatters: "Vulnerable code and leaked secrets ship straight to production and are the root cause of many personal-data breaches. Security added only after release is far costlier and often never happens.",
      goodLooksLike: "SAST, dependency (SCA) and secrets scanning in every pipeline with build-breaking thresholds; DAST on staging; findings tracked to closure; security requirements in the definition of done.",
      remediation: [
        { step: "Turn on dependency and secrets scanning across all repositories", effort: "S" },
        { step: "Add SAST to CI with severity thresholds that fail the build", effort: "M" },
        { step: "Run DAST against staging and track findings to closure", effort: "M" },
      ],
      evidenceAsks: ["CI pipeline configuration showing scanners and gates", "A findings-to-closure report", "Repository coverage list"],
    },
  },
  {
    id: "cap-legacy-compensating", name: "Compensating controls for legacy / unsupported systems", area: "Applications & perimeter",
    what: "Isolation, access proxying and monitoring for systems that cannot be patched or given native MFA.",
    rules: [
      { when: [yes("legacyApps")], level: "mandatory", reason: "Legacy applications that process personal data often cannot support MFA or modern controls, so protection must be added around them." },
      { when: [yes("eolSystems")], level: "mandatory", reason: "End-of-life systems no longer receive security fixes; risk must be reduced by isolation and monitoring until they are retired." },
    ],
    tools: {
      microsoft: ["Entra Application Proxy / Private Access", "Microsoft Defender for Identity"], aws: ["AWS Verified Access", "network segmentation with security groups"], gcp: ["Identity-Aware Proxy", "VPC Service Controls"],
      other: ["Cloudflare Access", "Zscaler", "Illumio (micro-segmentation)"],
    },
    guidance: {
      findingKey: "cap-appsec", domain: "security", impact: 4, likelihood: 4,
      whyItMatters: "Unsupported and legacy systems are the easiest targets and often hold long-lived personal data. Without compensating controls there is no defensible position on 'reasonable safeguards' for them.",
      goodLooksLike: "A register of legacy/EOL systems with a retirement plan; each isolated on a restricted segment, fronted by an access proxy enforcing MFA, and monitored; exceptions formally risk-accepted with an expiry.",
      remediation: [
        { step: "Register every legacy / end-of-life system with owner, data held and retirement date", effort: "S" },
        { step: "Isolate them on restricted network segments with least-privilege access", effort: "M" },
        { step: "Front them with an access proxy that enforces MFA where the application cannot", effort: "M" },
        { step: "Set a dated retirement or migration plan and get residual risk formally accepted", effort: "M" },
      ],
      evidenceAsks: ["The legacy / EOL register", "Network segmentation diagram for those systems", "Risk-acceptance sign-offs with expiry dates"],
    },
  },

  // ─────────────────────────────────────────────────── Data protection ──
  {
    id: "cap-data-discovery", name: "Data discovery and classification", area: "Data protection",
    what: "Automated discovery and labelling of personal and sensitive data across databases, files and cloud stores.",
    rules: [
      { when: [yes("unstructured")], level: "mandatory", reason: "Personal data sits in files, email and shared drives that no one has catalogued; you cannot protect or delete what you cannot find." },
      { when: [yes("databases")], level: "mandatory", reason: "Databases hold personal data at scale and need to be discovered and classified to be protected and searched for rights requests." },
    ],
    tools: {
      microsoft: ["Microsoft Purview Data Map + Information Protection"], aws: ["Amazon Macie"], gcp: ["Google Sensitive Data Protection (DLP API)"],
      other: ["BigID", "OneTrust Data Discovery", "Varonis"],
    },
    guidance: {
      findingKey: "cap-data-protection", domain: "inventory", impact: 4, likelihood: 4,
      whyItMatters: "Every downstream privacy control — access, retention, deletion, breach scoping, rights requests — depends on knowing where personal data is. Manual surveys miss most of it.",
      goodLooksLike: "Scheduled automated scans classify personal data across databases, file stores and SaaS; results feed the data inventory; sensitivity labels are applied and reviewed.",
      remediation: [
        { step: "Pick the highest-risk data stores and run a first discovery scan", effort: "M" },
        { step: "Define classification labels (e.g. Public / Internal / Personal / Sensitive) and apply them", effort: "M" },
        { step: "Feed results into the data inventory and schedule recurring scans", effort: "M" },
      ],
      evidenceAsks: ["The discovery scan output", "The classification scheme", "The data inventory populated from the scan"],
    },
  },
  {
    id: "cap-dlp", name: "Data loss prevention (DLP) / information protection", area: "Data protection",
    what: "Policies that detect and block personal data leaving through email, cloud storage, endpoints or SaaS.",
    rules: [
      { when: [yes("unstructured")], level: "mandatory", reason: "Personal data held in files, email and cloud drives can be shared externally by mistake or on purpose; DLP is the control that stops it." },
      { when: [yes("saas")], level: "recommended", reason: "Personal data flows into SaaS applications where sharing controls are weak by default." },
    ],
    tools: {
      microsoft: ["Microsoft Purview DLP + Information Protection"], aws: ["Amazon Macie + AWS Network Firewall"], gcp: ["Google Workspace DLP"],
      other: ["Forcepoint", "OpenText", "Proofpoint", "Netskope"],
    },
    guidance: {
      findingKey: "cap-data-protection", domain: "security", impact: 4, likelihood: 4,
      whyItMatters: "Accidental and deliberate oversharing is a leading cause of personal-data incidents. Without DLP, unauthorised sharing goes unnoticed until someone complains.",
      goodLooksLike: "DLP policies for personal-data types across email, cloud storage and endpoints, in blocking or warn-and-justify mode, with an incident queue that is reviewed.",
      remediation: [
        { step: "Turn on DLP in audit mode for the main personal-data types across email and cloud storage", effort: "S" },
        { step: "Tune policies against real hits, then move to warn/block", effort: "M" },
        { step: "Extend coverage to endpoints and connected SaaS; assign an owner for DLP incidents", effort: "M" },
      ],
      evidenceAsks: ["DLP policy configuration", "A report of DLP matches and their handling", "The coverage list by channel"],
    },
  },
  {
    id: "cap-db-security", name: "Database security (encryption, access and activity logging)", area: "Data protection",
    what: "Encryption at rest, least-privilege access and audit logging on databases holding personal data.",
    rules: [{ when: [yes("databases")], level: "mandatory", reason: "Databases are the central store of personal data; direct access and bulk export must be restricted and recorded." }],
    tools: {
      microsoft: ["Azure SQL TDE + Microsoft Defender for SQL", "Azure Key Vault"], aws: ["Amazon RDS encryption (KMS)", "AWS CloudTrail / Database Activity Streams"], gcp: ["Cloud SQL CMEK", "Cloud Audit Logs"],
      other: ["Imperva DAM", "IBM Guardium", "Delphix (masking)"],
    },
    guidance: {
      findingKey: "cap-data-protection", domain: "security", impact: 4, likelihood: 3,
      whyItMatters: "A database breach exposes everything at once. Without encryption, tight access and activity logs, you cannot prevent bulk extraction or show what was accessed.",
      goodLooksLike: "Encryption at rest with managed keys, named least-privilege database accounts, no shared admin logins, query/activity auditing to central logging, and masked data in non-production.",
      remediation: [
        { step: "Confirm encryption at rest on every database holding personal data", effort: "S" },
        { step: "Remove shared and standing admin accounts; enforce least privilege", effort: "M" },
        { step: "Enable audit logging and ship it to central monitoring", effort: "M" },
        { step: "Mask or synthesise personal data in test and development databases", effort: "M" },
      ],
      evidenceAsks: ["Encryption configuration per database", "Database account and privilege review", "Sample audit-log output"],
    },
  },
  {
    id: "cap-cloud-posture", name: "Cloud security posture management", area: "Data protection",
    what: "Continuous detection of misconfigurations, excessive permissions and publicly exposed cloud resources.",
    rules: [{ when: [any("platforms", ...CLOUD)], level: "mandatory", reason: "Cloud misconfiguration (public storage, over-permissive roles) is a leading cause of personal-data exposure and changes constantly." }],
    tools: {
      microsoft: ["Microsoft Defender for Cloud (CSPM)"], aws: ["AWS Security Hub + Config + IAM Access Analyzer"], gcp: ["Google Security Command Center"],
      other: ["Wiz", "Prisma Cloud", "Orca Security"],
    },
    guidance: {
      findingKey: "cap-data-protection", domain: "security", impact: 3, likelihood: 4,
      whyItMatters: "A single public storage bucket or over-permissive role can expose personal data to the internet with no attack needed. Cloud configuration drifts daily, so point-in-time reviews miss it.",
      goodLooksLike: "Continuous posture monitoring against a baseline (e.g. CIS), alerts on public exposure and excessive permissions, and findings tracked to closure.",
      remediation: [
        { step: "Enable the platform-native posture service across all subscriptions / accounts", effort: "S" },
        { step: "Fix public exposure and over-permissive roles found in the first scan", effort: "M" },
        { step: "Route posture alerts to an owner and track remediation SLAs", effort: "S" },
      ],
      evidenceAsks: ["Posture-management coverage across accounts", "The latest findings report", "Remediation-SLA metrics"],
    },
  },

  // ──────────────────────────────────────────── Monitoring & response ──
  {
    id: "cap-siem", name: "Centralised security monitoring (SIEM / SOC)", area: "Monitoring & response",
    what: "Central collection of logs with alerting and 24×7 or business-hours review.",
    rules: [{ when: [], level: "mandatory", reason: "You cannot detect or scope a personal-data breach without centralised logs and someone reviewing alerts." }],
    tools: {
      microsoft: ["Microsoft Sentinel"], aws: ["AWS Security Lake + Amazon GuardDuty"], gcp: ["Google Chronicle"],
      other: ["Splunk", "Elastic Security", "managed SOC / MDR provider"],
    },
    guidance: {
      findingKey: "cap-monitoring-ir", domain: "breach", impact: 4, likelihood: 4,
      whyItMatters: "Breach-notification duties run from the moment you become aware. Without central monitoring detection is delayed, scoping is guesswork and the notification clock is missed.",
      goodLooksLike: "Identity, endpoint, network, cloud and application logs feed one platform with tested detections for personal-data scenarios and a defined response owner and hours of cover.",
      remediation: [
        { step: "Onboard identity, endpoint and cloud audit logs first, with retention set to policy", effort: "M" },
        { step: "Enable detections for credential abuse, mass download and privilege escalation", effort: "M" },
        { step: "Name an alert owner and hours of coverage, or contract a managed SOC / MDR", effort: "M" },
      ],
      evidenceAsks: ["The log-source inventory", "Alert rules for personal-data scenarios", "The coverage / on-call arrangement"],
    },
  },
  {
    id: "cap-incident-response", name: "Incident response and breach-notification process", area: "Monitoring & response",
    what: "A documented, rehearsed process to contain an incident, scope affected personal data and notify on time.",
    rules: [{ when: [], level: "mandatory", reason: "Every organisation that holds personal data needs a rehearsed way to scope and notify a breach within the required time." }],
    tools: {
      microsoft: ["Microsoft Defender XDR (incident response)", "Microsoft Sentinel playbooks"], aws: ["AWS Security Incident Response"], gcp: ["Google Security Operations SOAR"],
      other: ["ServiceNow Security Incident Response", "PagerDuty", "external IR retainer"],
    },
    guidance: {
      findingKey: "cap-monitoring-ir", domain: "breach", impact: 5, likelihood: 4,
      whyItMatters: "A breach handled ad hoc misses statutory notification, scopes badly and compounds harm to individuals. This is the capability a regulator asks about first after an incident.",
      goodLooksLike: "A written IR plan with roles, severity levels, a personal-data scoping method, notification templates for the regulator and affected individuals, evidence logging, and an annual tabletop exercise.",
      remediation: [
        { step: "Draft the IR plan with a personal-data breach branch, named roles and escalation paths", effort: "M" },
        { step: "Add notification templates and decision criteria for the regulator and individuals", effort: "S" },
        { step: "Run a tabletop exercise and record the lessons and fixes", effort: "S" },
      ],
      evidenceAsks: ["The IR plan", "Notification templates", "The last tabletop exercise report"],
    },
  },

  // ─────────────────────────────────────────────────────── Resilience ──
  {
    id: "cap-backup", name: "Backup with immutability and tested restore", area: "Resilience",
    what: "Backups of personal-data systems that ransomware cannot alter, with restores actually tested.",
    rules: [{ when: [yes("backups")], level: "mandatory", reason: "You keep backups of systems holding personal data; they only help if they are protected from tampering and proven to restore." }],
    tools: {
      microsoft: ["Azure Backup (immutable vaults)", "Microsoft 365 Backup"], aws: ["AWS Backup with Vault Lock"], gcp: ["Google Backup and DR (immutable)"],
      other: ["Veeam", "Commvault", "Rubrik", "Acronis"],
    },
    guidance: {
      findingKey: "cap-resilience", domain: "security", impact: 3, likelihood: 3,
      whyItMatters: "Ransomware actively targets backups. Backups that are editable or never restore-tested give false comfort and can turn an incident into permanent loss of personal data.",
      goodLooksLike: "Backups follow 3-2-1 with an immutable or offline copy, backup accounts are separate from production, and a restore of a critical system is tested at least yearly.",
      remediation: [
        { step: "Confirm every personal-data system is in scope of a backup job", effort: "S" },
        { step: "Add an immutable / air-gapped copy and separate backup credentials", effort: "M" },
        { step: "Test restoration of a critical system and record the time achieved", effort: "S" },
      ],
      evidenceAsks: ["Backup coverage list", "Immutability configuration", "The last restore-test record"],
    },
  },
  {
    id: "cap-dr-bcp", name: "Disaster recovery and business continuity", area: "Resilience",
    what: "Documented, tested recovery plans and targets for business-critical systems.",
    rules: [{ when: [yes("criticalSystems")], level: "mandatory", reason: "Business-critical systems hold personal data; loss of availability or integrity is itself a personal-data harm." }],
    tools: {
      microsoft: ["Azure Site Recovery"], aws: ["AWS Elastic Disaster Recovery"], gcp: ["Google Backup and DR"],
      other: ["Zerto", "Veeam", "Commvault"],
    },
    guidance: {
      findingKey: "cap-resilience", domain: "security", impact: 3, likelihood: 2,
      whyItMatters: "Extended outages and corrupted data harm individuals and the organisation. Without tested recovery targets there is no assurance the business can resume within tolerable time.",
      goodLooksLike: "Documented RTO/RPO per critical system, a DR runbook, and an annual failover or recovery test with results reported to management.",
      remediation: [
        { step: "Set RTO and RPO for each business-critical system with the business owners", effort: "S" },
        { step: "Document the DR runbook and dependencies", effort: "M" },
        { step: "Run and report an annual recovery test", effort: "M" },
      ],
      evidenceAsks: ["RTO/RPO register", "The DR runbook", "The last DR test report"],
    },
  },

  // ────────────────────────────────────────────── Third parties & SaaS ──
  {
    id: "cap-tprm", name: "Third-party (vendor) risk management", area: "Third parties & SaaS",
    what: "A register of processors, risk-based due diligence and contracts with data-protection clauses.",
    rules: [{ when: [yes("vendors")], level: "mandatory", reason: "Vendors handle personal data on your behalf; you stay accountable for what they do with it." }],
    tools: {
      microsoft: [], aws: ["AWS Artifact (vendor evidence)"], gcp: ["Google Cloud compliance reports"],
      other: ["OneTrust Vendorpedia", "ServiceNow Vendor Risk", "Prevalent", "SecurityScorecard"],
    },
    guidance: {
      findingKey: "cap-vendor-saas", domain: "thirdparty", impact: 3, likelihood: 4,
      whyItMatters: "A processor's breach is your breach in the eyes of the individual and the regulator. Without a register, due diligence and contracts you cannot show you chose and oversaw processors properly.",
      goodLooksLike: "A complete processor register with data scope and hosting location, risk-tiered onboarding assessments, a standard data-processing agreement, and periodic reassessment of high-risk vendors.",
      remediation: [
        { step: "Build the processor register from procurement, finance and IT records", effort: "M" },
        { step: "Tier vendors by data sensitivity and assess the high-risk tier first", effort: "M" },
        { step: "Put a standard DPA in place and track renewals and reassessment dates", effort: "M" },
      ],
      evidenceAsks: ["The processor register", "Completed assessments for high-risk vendors", "Executed DPAs"],
    },
  },
  {
    id: "cap-saas-governance", name: "SaaS discovery and governance (CASB / access reviews)", area: "Third parties & SaaS",
    what: "Visibility of which SaaS applications hold personal data, who has access and how data is shared.",
    rules: [{ when: [yes("saas")], level: "mandatory", reason: "Teams adopt SaaS tools that store personal data outside IT's view; you cannot govern what you cannot see." }],
    tools: {
      microsoft: ["Microsoft Defender for Cloud Apps"], aws: ["AWS IAM Identity Center"], gcp: ["Google Workspace Marketplace controls + Chrome Enterprise"],
      other: ["Netskope", "Zscaler CASB", "Torii / Productiv (SaaS management)"],
    },
    guidance: {
      findingKey: "cap-vendor-saas", domain: "thirdparty", impact: 3, likelihood: 4,
      whyItMatters: "Shadow SaaS is where personal data quietly ends up with unassessed processors and without contracts. Unreviewed access to those tools persists after people change roles.",
      goodLooksLike: "A current SaaS inventory (discovered, not self-reported), sanctioned/unsanctioned status, SSO enforced where possible, and periodic access reviews for tools holding personal data.",
      remediation: [
        { step: "Discover SaaS usage from identity, browser and network telemetry", effort: "S" },
        { step: "Classify sanctioned versus unsanctioned and route the tools holding personal data into vendor review", effort: "M" },
        { step: "Enforce SSO and run periodic access reviews on the important ones", effort: "M" },
      ],
      evidenceAsks: ["The SaaS inventory", "SSO coverage report", "The latest SaaS access-review sign-off"],
    },
  },

  // ─────────────────────────────────────────────── Privacy operations ──
  {
    id: "cap-consent-management", name: "Consent and preference management", area: "Privacy operations",
    what: "Capturing, recording, refreshing and honouring consent and withdrawal across channels.",
    rules: [{ when: [yes("consent")], level: "mandatory", reason: "You collect consent through websites, apps, forms or marketing; it must be provable per person and withdrawable as easily as it was given." }],
    tools: {
      microsoft: ["Microsoft Dynamics 365 Customer Insights (consent)"], aws: ["Amazon Pinpoint / custom consent store"], gcp: ["Google Consent Mode + CMP"],
      other: ["OneTrust Consent", "Cookiebot", "Usercentrics", "Privy by IDfy"],
    },
    guidance: {
      findingKey: "cap-privacy-ops", domain: "consent", impact: 4, likelihood: 4,
      whyItMatters: "Consent that cannot be proven or withdrawn undermines the lawful basis for the processing that depends on it. Marketing sent after withdrawal is a common, avoidable complaint.",
      goodLooksLike: "A consent record per individual (what, when, how, which notice version), a self-service withdrawal route that propagates to downstream systems, and periodic reconciliation.",
      remediation: [
        { step: "Map every consent collection point and where the record is stored", effort: "S" },
        { step: "Centralise consent records in a consent-management platform", effort: "M" },
        { step: "Propagate withdrawal to marketing and downstream systems and test it end to end", effort: "M" },
      ],
      evidenceAsks: ["The consent collection-point map", "A sample consent record", "A tested withdrawal trace across systems"],
    },
  },
  {
    id: "cap-retention-deletion", name: "Retention and deletion enforcement", area: "Privacy operations",
    what: "Defined retention periods that are technically enforced, with the ability to delete an individual's data everywhere.",
    rules: [{ when: [], level: "mandatory", reason: "Personal data may be kept only as long as its purpose or law requires, and you must be able to erase it on request." }],
    tools: {
      microsoft: ["Microsoft Purview Data Lifecycle Management / Records Management"], aws: ["Amazon S3 Lifecycle + Macie"], gcp: ["Google Cloud Storage lifecycle rules"],
      other: ["OneTrust Data Retention", "BigID", "Varonis"],
    },
    guidance: {
      findingKey: "cap-privacy-ops", domain: "retention", impact: 4, likelihood: 4,
      whyItMatters: "Data kept beyond need increases both breach impact and legal exposure, and an erasure request you cannot fully honour is a rights failure.",
      goodLooksLike: "A retention schedule by data category, enforced by automated lifecycle rules per system, with a tested end-to-end deletion for one individual and evidence of it.",
      remediation: [
        { step: "Publish a retention schedule by data category and purpose", effort: "M" },
        { step: "Configure automated retention / deletion in the main systems", effort: "M" },
        { step: "Test deleting one individual across all systems and record the evidence", effort: "M" },
      ],
      evidenceAsks: ["The retention schedule", "Lifecycle rule configuration per system", "A recorded deletion test"],
    },
  },

  // ─────────────────────────────────────────────────────── Governance ──
  {
    id: "cap-asset-inventory", name: "Asset inventory / CMDB", area: "Governance",
    what: "A maintained inventory of systems, applications and devices with owners and data held.",
    rules: [{ when: [], level: "mandatory", reason: "Every other control is measured against the asset list; you cannot secure, patch or delete on systems you have not recorded." }],
    tools: {
      microsoft: ["Microsoft Intune + Defender asset inventory"], aws: ["AWS Systems Manager Inventory + AWS Config"], gcp: ["Google Cloud Asset Inventory"],
      other: ["ServiceNow CMDB", "Lansweeper", "Axonius"],
    },
    guidance: {
      findingKey: "cap-asset-governance", domain: "inventory", impact: 3, likelihood: 4,
      whyItMatters: "An incomplete asset list means uncovered systems in every other control — unpatched, unencrypted, unmonitored. It is also the base of the personal-data inventory and Records of Processing.",
      goodLooksLike: "A single, automatically refreshed inventory of devices, applications and cloud assets with named owners, business criticality and the personal-data categories held.",
      remediation: [
        { step: "Consolidate existing sources (identity, MDM, cloud, procurement) into one asset list", effort: "M" },
        { step: "Assign an owner and business criticality to every asset", effort: "M" },
        { step: "Automate refresh and reconcile monthly against discovery", effort: "M" },
      ],
      evidenceAsks: ["The current asset inventory export", "The reconciliation record", "The asset-ownership assignments"],
    },
  },
];

// ─── helpers ────────────────────────────────────────────────────────────────
const CAP_BY_ID = Object.fromEntries(CAPABILITIES.map(c => [c.id, c]));

/** Guidance entry for a capability id, in the same shape as selfAssessQuestionGuidance's GUIDANCE. */
export function capabilityGuidanceFor(id) {
  const c = CAP_BY_ID[id];
  return c ? { ...c.guidance, ...DRAFT } : null;
}

export function getCapability(id) {
  return CAP_BY_ID[id] || null;
}

/** Capability name lookup, used by report renderers. */
export const CAPABILITY_GUIDANCE = Object.fromEntries(CAPABILITIES.map(c => [c.id, { ...c.guidance, ...DRAFT }]));
