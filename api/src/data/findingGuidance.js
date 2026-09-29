import crypto from "crypto";

// Enriches an automated-collection finding for the compliance finding report:
//
//   1. CONTROL_CROSSWALK  — maps the ISO/IEC 27001:2013 Annex A control(s) a
//      test is tagged with to the equivalent control / article / section in
//      ISO/IEC 27001:2022, GDPR and DPDPA 2023.
//   2. REMEDIATION_PLAYBOOK — per-test executive summary, impact, immediate
//      action, target architecture and step list for the marquee checks, with
//      a generic builder covering every other test key.
//
// The ISO/IEC 27001:2022 column follows the official ISO/IEC 27002:2022 Annex B
// correspondence table. The GDPR and DPDPA columns give the article / section
// that is the primary home for the obligation the control addresses. These are
// indicative mappings to help a reader route and triage a finding — they are
// not a certified crosswalk and do not replace the control owner's assessment.

// ── Framework display metadata ────────────────────────────────────────────
export const FRAMEWORK_LABELS = {
  ISO2013: "ISO/IEC 27001:2013",
  ISO2022: "ISO/IEC 27001:2022",
  GDPR: "GDPR",
  DPDPA: "DPDPA 2023",
};

const FRAMEWORK_ORDER = ["ISO2013", "ISO2022", "GDPR", "DPDPA"];

// Display labels for the other frameworks that reach the finding report as raw
// test_control_mappings rows (derived at startup from
// data/crosswalk/iso27001-annexa-crosswalk.json). These are appended to the
// control table after the curated ISO/GDPR/DPDPA rows, in this order. A framework
// key with no entry here still renders, under its own uppercased key.
const EXTRA_FRAMEWORK_LABELS = {
  SOC2: "SOC 2",
  HIPAA: "HIPAA",
  CIS: "CIS Controls v8.1",
  PCIDSS: "PCI DSS v4.0.1",
  CERTIN: "CERT-In Directions 2022",
};
const EXTRA_FRAMEWORK_ORDER = ["SOC2", "HIPAA", "CIS", "PCIDSS", "CERTIN"];
// Frameworks the curated CONTROL_CROSSWALK already owns in the table — raw
// mapping rows for these are ignored here so the report keeps its reviewed
// wording (e.g. "Art. 32" rather than a connector's "Art. 32(1)(b)").
const CURATED_FRAMEWORKS = new Set(["ISO27001", "ISO2013", "ISO2022", "GDPR", "DPDPA"]);

// Keyed by ISO/IEC 27001:2013 Annex A reference (the identifiers the automated
// tests are tagged with in `test_control_mappings`).
export const CONTROL_CROSSWALK = {
  "A.6.1.2": { ISO2022: ["A.5.3"], GDPR: ["Art. 32"], DPDPA: ["s. 8(5)"] },
  "A.6.2.1": { ISO2022: ["A.6.7", "A.8.1"], GDPR: ["Art. 32"], DPDPA: ["s. 8(5)"] },
  "A.8.1.1": { ISO2022: ["A.5.9"], GDPR: ["Art. 30"], DPDPA: ["s. 8(5)"] },
  "A.8.2.1": { ISO2022: ["A.5.12"], GDPR: ["Art. 5(1)(f)", "Art. 32"], DPDPA: ["s. 8(5)"] },
  "A.8.2.3": { ISO2022: ["A.5.10", "A.8.24"], GDPR: ["Art. 32(1)(a)"], DPDPA: ["s. 8(5)"] },
  "A.9.1.1": { ISO2022: ["A.5.15"], GDPR: ["Art. 32"], DPDPA: ["s. 8(5)"] },
  "A.9.1.2": { ISO2022: ["A.5.15", "A.8.3"], GDPR: ["Art. 32"], DPDPA: ["s. 8(5)"] },
  "A.9.2.1": { ISO2022: ["A.5.16"], GDPR: ["Art. 32"], DPDPA: ["s. 8(5)"] },
  "A.9.2.2": { ISO2022: ["A.5.18"], GDPR: ["Art. 32"], DPDPA: ["s. 8(5)"] },
  "A.9.2.3": { ISO2022: ["A.8.2"], GDPR: ["Art. 32"], DPDPA: ["s. 8(5)"] },
  "A.9.2.4": { ISO2022: ["A.5.17"], GDPR: ["Art. 32"], DPDPA: ["s. 8(5)"] },
  "A.9.2.6": { ISO2022: ["A.5.18"], GDPR: ["Art. 32"], DPDPA: ["s. 8(5)"] },
  "A.9.4.1": { ISO2022: ["A.8.3"], GDPR: ["Art. 32"], DPDPA: ["s. 8(5)"] },
  "A.9.4.2": { ISO2022: ["A.8.5"], GDPR: ["Art. 32"], DPDPA: ["s. 8(5)"] },
  "A.9.4.3": { ISO2022: ["A.8.5"], GDPR: ["Art. 32"], DPDPA: ["s. 8(5)"] },
  "A.9.4.4": { ISO2022: ["A.8.18"], GDPR: ["Art. 32"], DPDPA: ["s. 8(5)"] },
  "A.10.1.2": { ISO2022: ["A.8.24"], GDPR: ["Art. 32(1)(a)"], DPDPA: ["s. 8(5)"] },
  "A.12.1.1": { ISO2022: ["A.5.37"], GDPR: ["Art. 24"], DPDPA: ["s. 8(5)"] },
  "A.12.1.2": { ISO2022: ["A.8.32"], GDPR: ["Art. 32"], DPDPA: ["s. 8(5)"] },
  "A.12.2.1": { ISO2022: ["A.8.7"], GDPR: ["Art. 32"], DPDPA: ["s. 8(5)"] },
  "A.12.3.1": { ISO2022: ["A.8.13"], GDPR: ["Art. 32(1)(c)"], DPDPA: ["s. 8(5)"] },
  "A.12.4.1": { ISO2022: ["A.8.15"], GDPR: ["Art. 32"], DPDPA: ["s. 8(5)"] },
  "A.12.4.2": { ISO2022: ["A.8.15"], GDPR: ["Art. 32"], DPDPA: ["s. 8(5)"] },
  "A.12.5.1": { ISO2022: ["A.8.19"], GDPR: ["Art. 32"], DPDPA: ["s. 8(5)"] },
  "A.12.6.1": { ISO2022: ["A.8.8"], GDPR: ["Art. 32(1)(d)"], DPDPA: ["s. 8(5)"] },
  "A.13.1.1": { ISO2022: ["A.8.20"], GDPR: ["Art. 32"], DPDPA: ["s. 8(5)"] },
  "A.13.2.1": { ISO2022: ["A.5.14"], GDPR: ["Art. 32", "Art. 44"], DPDPA: ["s. 16"] },
  "A.13.2.3": { ISO2022: ["A.5.14"], GDPR: ["Art. 32"], DPDPA: ["s. 8(5)"] },
  "A.14.2.2": { ISO2022: ["A.8.32"], GDPR: ["Art. 32"], DPDPA: ["s. 8(5)"] },
  "A.14.2.5": { ISO2022: ["A.8.27"], GDPR: ["Art. 25"], DPDPA: ["s. 8(5)"] },
  "A.16.1.2": { ISO2022: ["A.6.8"], GDPR: ["Art. 33"], DPDPA: ["s. 8(6)"] },
  "A.16.1.5": { ISO2022: ["A.5.26"], GDPR: ["Art. 33", "Art. 34"], DPDPA: ["s. 8(6)"] },
  "A.18.1.3": { ISO2022: ["A.5.33"], GDPR: ["Art. 5(1)(e)", "Art. 32"], DPDPA: ["s. 8(7)"] },
  "A.18.2.2": { ISO2022: ["A.5.36"], GDPR: ["Art. 24"], DPDPA: ["s. 8(5)"] },
};

/**
 * Builds the ordered framework → control(s) table rows for the finding report.
 *
 * @param {Array<{framework?: string, isoReference?: string}>|string[]} mappings
 *   Rows from `test_control_mappings` (objects), or a bare list of ISO references.
 * @returns {Array<{ framework: string, controls: string[] }>}
 */
export function buildControlMappings(mappings) {
  const isoRefs = [];
  const extraByFramework = new Map(); // framework key → ordered unique control refs
  for (const m of mappings || []) {
    if (typeof m === "string") {
      if (m) isoRefs.push(m);
    } else if (m && (m.framework == null || m.framework === "ISO27001") && m.isoReference) {
      isoRefs.push(m.isoReference);
    } else if (m && m.framework && m.isoReference && !CURATED_FRAMEWORKS.has(m.framework)) {
      if (!extraByFramework.has(m.framework)) extraByFramework.set(m.framework, []);
      const list = extraByFramework.get(m.framework);
      if (!list.includes(m.isoReference)) list.push(m.isoReference);
    }
  }
  const uniqueIso = [...new Set(isoRefs)];

  const buckets = { ISO2013: new Set(uniqueIso) };
  for (const key of FRAMEWORK_ORDER) {
    if (key === "ISO2013") continue;
    buckets[key] = new Set();
  }
  for (const iso of uniqueIso) {
    const xw = CONTROL_CROSSWALK[iso];
    if (!xw) continue;
    for (const key of Object.keys(xw)) {
      for (const ref of xw[key]) buckets[key].add(ref);
    }
  }

  const rows = [];
  for (const key of FRAMEWORK_ORDER) {
    const controls = [...buckets[key]];
    if (controls.length) rows.push({ framework: FRAMEWORK_LABELS[key], controls });
  }

  // Append the other frameworks carried on the raw mapping rows, known ones
  // first (in EXTRA_FRAMEWORK_ORDER), then any unrecognised key alphabetically.
  const seenExtra = new Set();
  for (const key of EXTRA_FRAMEWORK_ORDER) {
    if (extraByFramework.has(key)) {
      rows.push({ framework: EXTRA_FRAMEWORK_LABELS[key], controls: extraByFramework.get(key) });
      seenExtra.add(key);
    }
  }
  for (const key of [...extraByFramework.keys()].sort()) {
    if (seenExtra.has(key)) continue;
    rows.push({ framework: EXTRA_FRAMEWORK_LABELS[key] || key, controls: extraByFramework.get(key) });
  }
  return rows;
}

/**
 * Stable, human-readable reference for a finding. Derived from the finding's
 * identity tuple so it does not change between re-scans — the same
 * misconfiguration on the same resource always gets the same ID, which is what
 * makes it usable for lifecycle tracking.
 */
export function buildFindingRef({ companyId, connectionId, testKey, resourceId }) {
  const digest = crypto
    .createHash("sha1")
    .update(`${companyId ?? ""}:${connectionId ?? ""}:${testKey ?? ""}:${resourceId ?? ""}`)
    .digest("hex")
    .slice(0, 8)
    .toUpperCase();
  return `PRISM-F-${digest}`;
}

const SLA_DAYS = { critical: 7, high: 30, medium: 90, low: 180 };

/**
 * Suggested remediation SLA for a severity, and the resulting target date
 * measured from the detection date. Advisory only — the control owner sets the
 * committed date on the tracking line.
 */
export function remediationSla(severity, detectedAt) {
  const days = SLA_DAYS[String(severity || "").toLowerCase()] ?? 90;
  const base = detectedAt instanceof Date && !Number.isNaN(detectedAt.getTime()) ? detectedAt : new Date();
  const due = new Date(base.getTime() + days * 24 * 60 * 60 * 1000);
  return { days, label: `within ${days} days of detection`, dueDate: due.toLocaleDateString("en-GB") };
}

// ── Remediation playbooks ─────────────────────────────────────────────────
// Each entry: { summary, impact, immediate, target, steps }.
//   summary   — one plain-language sentence for the executive risk summary.
//   impact    — why the finding matters (the "Why it matters" section).
//   immediate — the containment action to take now.
//   target    — the recommended end-state architecture.
//   steps     — ordered remediation, rendered as a numbered list.
// `{resource}` / `{connection}` placeholders are substituted at build time.
// Keys are exact test keys; unlisted tests fall back to buildGenericPlan.

export const REMEDIATION_PLAYBOOK = {
  "aws.network.security_groups_no_open_ingress": {
    summary:
      "A server administration port on this resource is currently reachable from anywhere on the internet, so any host can attempt to log in to the affected system.",
    impact:
      "An SSH (22) or RDP (3389) port open to 0.0.0.0/0 lets any host on the internet attempt authentication against the instance. This is one of the most heavily automated attack surfaces on AWS and a routine root cause of credential-stuffing, brute-force and ransomware incidents.",
    immediate:
      "Scope the offending inbound rule on {resource} to your corporate / VPN CIDR ranges now, or delete the rule entirely if the access is not currently in use.",
    target:
      "No security group allows 22/3389 from 0.0.0.0/0. Administrative access is brokered through AWS Systems Manager Session Manager or a hardened bastion in a dedicated subnet, and an SCP or AWS Config auto-remediation prevents a wide-open rule from being re-added.",
    steps: [
      "In the EC2 console, open Security Groups and locate {resource}; note every inbound rule with a source of 0.0.0.0/0 (or ::/0) covering port 22 or 3389.",
      "Scope those rules to the specific corporate CIDR ranges, VPN egress IPs, or a bastion / jump-host security group. If access is not currently needed, delete the rule entirely.",
      "For ongoing administrative access, adopt AWS Systems Manager Session Manager or EC2 Instance Connect so no inbound management port has to be exposed at all.",
      "Search the account (and every region) for other security groups with the same pattern using the AWS Config rules `restricted-ssh` / `restricted-common-ports` or `aws ec2 describe-security-groups`.",
      "Add a preventative guardrail — an SCP or AWS Config auto-remediation — so a wide-open management rule cannot be re-added.",
      "Re-run the PRISM collection for this connection and confirm the check passes, then attach the passing result to this report.",
    ],
  },
  "azure.network.nsg_no_open_ingress": {
    summary:
      "A server administration port (SSH / RDP) on this resource is currently reachable from anywhere on the internet, so any host can attempt to log in to the affected systems.",
    impact:
      "A network security group rule that allows inbound SSH (22) or RDP (3389) from Any / 0.0.0.0/0 exposes the attached VMs or subnets to the entire internet. Internet-facing RDP in particular is a leading initial-access vector for ransomware operators, and Microsoft Defender for Cloud flags it as a high-severity misconfiguration.",
    immediate:
      "Edit the offending inbound rule on {resource} to set its Source to your corporate / VPN address ranges, or change the rule action to Deny if the access is not required.",
    target:
      "No NSG allows 22/3389 from Any / Internet. Administrative access is provided through Azure Bastion or just-in-time VM access, and the built-in Azure Policy definitions that deny management-port exposure are assigned so the misconfiguration cannot recur.",
    steps: [
      "In the Azure portal, open Network security groups, select {resource}, and review Inbound security rules for any Allow rule whose Source is Any / Internet / 0.0.0.0/0 and whose Destination port range covers 22 or 3389.",
      "Edit each such rule to set Source to a specific IP address range (corporate / VPN CIDRs) or an Application Security Group, or change the action to Deny if the access is not required.",
      "Replace standing exposure with Azure Bastion or a just-in-time VM access policy in Microsoft Defender for Cloud, so management ports are only opened on request for a limited window.",
      "Use Azure Resource Graph (`resources | where type =~ 'microsoft.network/networksecuritygroups'`) or Defender for Cloud recommendations to find every other NSG with the same open rule.",
      "Assign the built-in Azure Policy definitions that audit or deny management-port exposure (for example \"Management ports should be closed on your virtual machines\").",
      "Re-run the PRISM collection for this connection, confirm the check passes, and attach the passing result to this report.",
    ],
  },
  "gcp.network.firewall_no_open_management_ports": {
    summary:
      "A server administration port on this resource is currently reachable from anywhere on the internet, so any host can attempt to log in to the affected instances.",
    impact:
      "A VPC firewall rule permitting SSH (22) or RDP (3389) ingress from 0.0.0.0/0 exposes every instance the rule targets to internet-wide scanning and brute force. Google's Security Command Center reports this as a high-severity `OPEN_SSH` / `OPEN_RDP` finding.",
    immediate:
      "Restrict the source ranges on firewall rule {resource} to known administrative CIDRs now, or delete the rule if the access is not required.",
    target:
      "No firewall rule allows 22/3389 from 0.0.0.0/0. SSH / RDP is reached through Identity-Aware Proxy (IAP) TCP forwarding, and an Organization Policy constraint blocks wide-open management rules.",
    steps: [
      "In the VPC network > Firewall page, find rule {resource} and note the source ranges and the allowed protocols / ports.",
      "Restrict the source ranges to known administrative CIDRs, or delete the rule if the access is not required.",
      "Adopt Identity-Aware Proxy (IAP) TCP forwarding for SSH / RDP so no instance needs a public ingress rule.",
      "Query all firewall rules (`gcloud compute firewall-rules list --format=json`) across every VPC and project for the same 0.0.0.0/0 management-port pattern.",
      "Add an Organization Policy constraint or a Security Health Analytics auto-remediation so wide-open management rules are blocked.",
      "Re-run the PRISM collection, confirm the check passes, and attach the passing result to this report.",
    ],
  },
  "aws.network.s3_public_access_blocked": {
    summary:
      "This storage bucket is not fully protected against being made public, so a policy or permission change could expose its contents to anonymous callers on the internet.",
    impact:
      "Without all four S3 Block Public Access settings enabled, a bucket policy or ACL can expose objects to anonymous callers. Public S3 buckets are a well-known source of large-scale data leaks and are trivially discoverable.",
    immediate:
      "Enable all four Block Public Access settings on {resource} now (S3 console > Permissions), unless a documented business case requires anonymous access.",
    target:
      "Block Public Access is enforced at the account level so it applies to every current and future bucket; content that must be public is served through CloudFront with an Origin Access Control rather than a public bucket.",
    steps: [
      "Open the S3 console for {resource} > Permissions and enable all four Block Public Access settings (BlockPublicAcls, IgnorePublicAcls, BlockPublicPolicy, RestrictPublicBuckets).",
      "Where possible, also enable Block Public Access at the account level (S3 > Account settings) so it applies to every current and future bucket.",
      "Review the bucket policy and object ACLs for any statement granting access to `*` or `AllUsers`; remove or tighten them.",
      "If the content genuinely must be public (e.g. a static site), serve it through CloudFront with an Origin Access Control instead of a public bucket.",
      "Use S3 Storage Lens or `s3control get-public-access-block` to confirm no other bucket in the account is exposed.",
      "Re-run the PRISM collection, confirm the check passes, and attach the passing result to this report.",
    ],
  },
  "azure.storage.public_access_blocked": {
    summary:
      "This storage account permits anonymous public access to blob data, so any container set to a public level serves its contents to callers on the internet with no authentication.",
    impact:
      "When a storage account allows public blob access, any container set to a public access level serves its blobs to anonymous callers over the internet. This bypasses every identity and network control on the account.",
    immediate:
      "Set \"Allow Blob public access\" to Disabled on {resource} now (Configuration blade), and set any Blob / Container-level containers back to Private.",
    target:
      "Anonymous access is disabled account-wide and enforced by the Azure Policy \"Storage account public access should be disallowed\"; shared content uses time-limited user-delegation SAS tokens or a CDN.",
    steps: [
      "In the storage account {resource} > Configuration, set \"Allow Blob public access\" to Disabled.",
      "Review each container's public access level and set any that are Blob or Container back to Private.",
      "For content that must be shared, issue time-limited user-delegation SAS tokens or front the account with a CDN, rather than enabling anonymous access.",
      "Use Azure Resource Graph or Defender for Cloud to find every other storage account with public access allowed.",
      "Assign the Azure Policy \"Storage account public access should be disallowed\" in Deny mode.",
      "Re-run the PRISM collection, confirm the check passes, and attach the passing result to this report.",
    ],
  },
  "aws.iam.mfa_enforced": {
    summary:
      "One or more user accounts can sign in with a password or key alone, with no second factor, making them a realistic target for phishing and credential reuse.",
    impact:
      "An IAM user without MFA is protected by a password or access key alone. Credential phishing and reuse are the most common cause of cloud account compromise, and single-factor console access materially raises that risk.",
    immediate:
      "Register an MFA device for the flagged user(s) on {resource}, or disable their console access until MFA is in place.",
    target:
      "Workforce access is federated through AWS IAM Identity Center (SSO) with MFA enforced at the identity provider; any remaining IAM users are denied all actions unless `aws:MultiFactorAuthPresent` is true.",
    steps: [
      "Identify the user(s) flagged for {resource} and confirm whether each still needs interactive access.",
      "For every human user, register a virtual or hardware MFA device (IAM > Users > Security credentials).",
      "Attach an IAM policy that denies all actions unless `aws:MultiFactorAuthPresent` is true, so access is blocked until MFA is set up.",
      "Migrate workforce access to AWS IAM Identity Center (SSO) with MFA enforced at the identity provider, and remove standalone IAM users where possible.",
      "Add a Config rule (`iam-user-mfa-enabled` / `mfa-enabled-for-iam-console-access`) to detect regressions.",
      "Re-run the PRISM collection, confirm the check passes, and attach the passing result to this report.",
    ],
  },
  "aws.rds.publicly_accessible": {
    summary:
      "This database is reachable directly from the internet on its database port, protected only by a network firewall rule.",
    impact:
      "A publicly accessible RDS instance is reachable from the internet on its database port, subject only to the security group. Databases should never be directly internet-facing — a single mis-scoped rule then exposes the data.",
    immediate:
      "Modify {resource} and set Publicly accessible to No, then confirm the security group only allows the database port from application security groups.",
    target:
      "The instance sits in private subnets with no public accessibility; clients reach it through VPC peering, PrivateLink, a VPN or a bastion, and the Config rule `rds-instance-public-access-check` catches regressions.",
    steps: [
      "In the RDS console, modify {resource} and set Publicly accessible to No (this changes the instance's DNS resolution to the private address).",
      "Confirm the instance's subnet group uses private subnets and that the security group only allows the database port from application security groups.",
      "Provide connectivity to legitimate clients through VPC peering, PrivateLink, a VPN, or a bastion host instead of public exposure.",
      "Check every other RDS instance and Aurora cluster in the account for the same setting.",
      "Add the Config rule `rds-instance-public-access-check` to catch regressions.",
      "Re-run the PRISM collection, confirm the check passes, and attach the passing result to this report.",
    ],
  },
  "azure.sql.public_network_access_disabled": {
    summary:
      "This database server accepts connections from outside your virtual network, gated only by firewall rules — a single broad rule then exposes every database on the server.",
    impact:
      "With public network access enabled, the Azure SQL logical server is reachable from outside your virtual network, gated only by firewall rules — a single 0.0.0.0 rule then exposes every database on the server.",
    immediate:
      "Set Public network access to Disabled on {resource} (Networking blade), and remove any firewall rule with a start address of 0.0.0.0.",
    target:
      "The server has public network access disabled and is reached only through a Private Endpoint; the Azure Policy \"Public network access on Azure SQL Database should be disabled\" is assigned.",
    steps: [
      "In the SQL server {resource} > Networking, set Public network access to Disabled.",
      "Remove any firewall rule with a start address of 0.0.0.0 (or the \"Allow Azure services\" toggle if it is not required).",
      "Create a Private Endpoint for the server and update application connection strings to use the private FQDN.",
      "Review every other SQL server in the subscription for open firewall rules or public access.",
      "Assign the Azure Policy \"Public network access on Azure SQL Database should be disabled\".",
      "Re-run the PRISM collection, confirm the check passes, and attach the passing result to this report.",
    ],
  },
  "github.org.two_factor_required": {
    summary:
      "The GitHub organisation does not require two-factor authentication, so a single phished or reused member password could give an attacker access to source code and release pipelines.",
    impact:
      "Without organisation-wide 2FA, a single phished or reused member password gives an attacker access to source code, CI secrets and release pipelines. Supply-chain compromises frequently begin with an unprotected maintainer account.",
    immediate:
      "Ask all members to enable 2FA, set a cut-over date, then turn on \"Require two-factor authentication for everyone\" in Organization settings > Authentication security.",
    target:
      "Organisation 2FA enforcement is on, and sign-in is additionally federated through the corporate identity provider with SSO required.",
    steps: [
      "Ask all members and outside collaborators to enable 2FA on their accounts (Settings > Password and authentication).",
      "In Organization settings > Authentication security, enable \"Require two-factor authentication for everyone\".",
      "Note that members without 2FA are removed when enforcement is turned on — coordinate a deadline and communicate it first.",
      "Re-invite any collaborators who were removed once they have 2FA configured.",
      "Consider requiring SSO through your identity provider for an additional enforced factor.",
      "Re-run the PRISM collection, confirm the check passes, and attach the passing result to this report.",
    ],
  },
};

// Category defaults keyed by a substring of the test key — used to give the
// generic plan meaningful text when the test has no explicit playbook entry.
const CATEGORY_DEFAULTS = [
  {
    match: /\.(network|firewall|nsg)|_no_open_ingress|security_groups/,
    summary: "A network path that should be private is currently open more widely than it needs to be, letting untrusted hosts reach the affected service.",
    impact: "Overly permissive network exposure lets untrusted hosts reach services that should be private, widening the attack surface for scanning and intrusion.",
    immediate: "Restrict the offending rule on {resource} to specific trusted source ranges, or remove it if the access is not currently required.",
    target: "Access to the service is limited to known source ranges or a controlled path (bastion, VPN, private endpoint), with no 0.0.0.0/0 / Any source, enforced by a platform guardrail.",
    fix: "Restrict the offending rule to specific trusted source ranges or a controlled access path (bastion, VPN, private endpoint) and remove any 0.0.0.0/0 / Any source.",
  },
  {
    match: /iam|role|owner|privileg|access_key|secret|credential|wildcard|inline_polic|permission/,
    summary: "An identity, permission or credential on this resource is broader or older than least-privilege allows, enlarging the blast radius of any single compromise.",
    impact: "Excessive privilege, shared or stale credentials, and wildcard grants break least-privilege and enlarge the blast radius of any single compromised identity.",
    immediate: "Scope the permission or principal on {resource} to the minimum required, and disable any unused or stale access.",
    target: "Access follows least-privilege with no wildcard principals, long-lived credentials are rotated on a schedule, and standing privileged access is minimised.",
    fix: "Scope the permission or principal to the minimum required, remove unused or stale access, and rotate long-lived credentials.",
  },
  {
    match: /encrypt|\.tde|transparent_data|_cmk|kms|key_rotation/,
    summary: "Data or encryption keys on this resource are not protected by the expected encryption or key-rotation controls.",
    impact: "Data or keys without the expected encryption or rotation controls are more exposed if the underlying storage, snapshot or backup is accessed by an unauthorised party.",
    immediate: "Enable encryption at rest on {resource} with a customer-managed key where the platform supports it without a rebuild; otherwise schedule the encrypted rebuild.",
    target: "The resource is encrypted at rest with a customer-managed key and automatic key rotation is enabled.",
    fix: "Enable encryption at rest with a customer-managed key where supported, and turn on automatic key rotation.",
  },
  {
    match: /public|publicly_accessible|_not_public|external_sharing|anonymous/,
    summary: "This resource is reachable from outside your identity and network boundary, so it is discoverable and accessible on the public internet.",
    impact: "Publicly reachable resources are discoverable and accessible outside your identity and network boundary, a common cause of data exposure.",
    immediate: "Disable public access on {resource} now, unless a documented business case requires it.",
    target: "The resource is private; legitimate access is provided through private endpoints, scoped SAS / pre-signed URLs, or an authenticated gateway.",
    fix: "Disable public access and provide connectivity through private endpoints, scoped SAS / pre-signed URLs, or an authenticated gateway.",
  },
  {
    match: /mfa|two_factor|two_step|weak_methods|conditional_access|legacy_auth/,
    summary: "Accounts can authenticate without a strong second factor, or over a legacy protocol, making them a realistic target for phishing and credential reuse.",
    impact: "Single-factor or legacy authentication paths are the primary route to account takeover through phishing and credential reuse.",
    immediate: "Enforce multi-factor authentication for the affected accounts and disable legacy / basic authentication protocols.",
    target: "Phishing-resistant MFA is enforced for all users through the identity provider, and legacy authentication is blocked.",
    fix: "Enforce phishing-resistant multi-factor authentication for all users and block legacy / basic authentication protocols.",
  },
  {
    match: /log|audit|flow_logs|diagnostic|cloudtrail|monitor|alarm/,
    summary: "Security-relevant activity on this resource is not being logged or retained as expected, which weakens detection and audit evidence.",
    impact: "Missing or unprotected logging leaves security-relevant activity undetected and undermines incident investigation and audit evidence.",
    immediate: "Enable the relevant logging / diagnostic setting on {resource} and point it at a central retained log store.",
    target: "Logs are forwarded to a central, access-controlled store with a retention period that meets policy, protected from tampering and early deletion.",
    fix: "Enable the relevant logging / diagnostic setting, forward logs to a central retained store, and protect them from tampering or early deletion.",
  },
  {
    match: /backup|point_in_time|pitr|retention/,
    summary: "This resource does not have the expected backup or retention protection, so data loss from error, corruption or ransomware may be unrecoverable.",
    impact: "Without reliable backups or retention, data loss from error, corruption or ransomware may be unrecoverable.",
    immediate: "Enable automated backups / point-in-time recovery on {resource} with a retention period that meets your recovery objectives.",
    target: "Automated backups run on a schedule with policy-aligned retention, and restores are periodically tested.",
    fix: "Enable automated backups / point-in-time recovery with a retention period that meets your recovery objectives, and periodically test restores.",
  },
  {
    match: /vulnerab|cve|patch|scanning|dependabot|code_scanning|defender|securityhub|guardduty/,
    summary: "A vulnerability-detection or threat-detection capability is disabled, or known findings are unremediated, giving attackers a reliable path in.",
    impact: "Unremediated vulnerabilities and disabled threat detection give attackers a known, reliable path in and delay detection of active compromise.",
    immediate: "Enable the detection / scanning capability and triage the existing findings by severity and exploitability.",
    target: "The capability is enabled everywhere, and findings are remediated within a defined SLA with exceptions formally risk-accepted.",
    fix: "Enable the detection / scanning capability, triage the existing findings by severity and exploitability, and remediate within your defined SLA.",
  },
  {
    match: /branch_protection|review|change|workflow_permission|third_party_restricted|immutab/,
    summary: "A change control in the software delivery pipeline is weaker than policy requires, allowing unreviewed code or configuration to reach production.",
    impact: "Weak change controls in the delivery pipeline allow unreviewed or malicious code and configuration to reach production.",
    immediate: "Require peer review and status checks on the protected branch, and constrain CI token permissions to read-only by default.",
    target: "Protected branches require review and passing checks, CI tokens are least-privilege, and third-party actions are restricted to a vetted allow-list.",
    fix: "Require peer review and status checks on protected branches, and constrain CI token permissions and third-party actions to the minimum needed.",
  },
];

const GENERIC_DEFAULT = {
  summary: "A configuration on this resource deviates from the expected security baseline for its type.",
  impact: "This control gap weakens the security posture of the affected resource and represents a deviation from the mapped compliance requirements.",
  immediate: "Confirm the reported configuration on {resource} and apply an interim restriction if it creates active exposure.",
  target: "The resource matches the expected baseline, and a platform guardrail prevents the setting from drifting again.",
  fix: "Apply the configuration change needed to bring the resource into line with the expected baseline.",
};

function categoryDefault(testKey) {
  for (const d of CATEGORY_DEFAULTS) {
    if (d.match.test(testKey)) return d;
  }
  return GENERIC_DEFAULT;
}

function buildGenericPlan({ testKey, dbRemediation }) {
  const cat = categoryDefault(testKey);
  const fixSentence = (dbRemediation && dbRemediation.trim()) || cat.fix;
  return {
    summary: cat.summary,
    impact: cat.impact,
    immediate: cat.immediate,
    target: cat.target,
    steps: [
      "Verify the finding: confirm the reported configuration on {resource} through the {connection} connection, and identify every other resource in the same account with the same misconfiguration.",
      "Contain (for high / critical severity): apply an interim restriction that removes the exposure while the full fix is planned and change-managed.",
      fixSentence,
      "Prevent recurrence: codify the corrected setting in infrastructure-as-code and add a preventative or detective guardrail (Azure Policy, AWS Config / SCP, GCP Org Policy, or the platform's native equivalent).",
      "Verify and document: re-run the PRISM collection for this connection, confirm the check passes, and attach the passing result to this report.",
    ],
  };
}

function substitute(text, { resource, connection }) {
  if (!text) return text;
  return text
    .replace(/\{resource\}/g, resource || "the affected resource")
    .replace(/\{connection\}/g, connection || "its source");
}

/**
 * Assembles the narrative sections for the compliance finding report.
 *
 * @returns {{
 *   executiveSummary: string,
 *   whatDetected: string,
 *   whyItMatters: string,
 *   complianceImpact: string,
 *   immediateAction: string,
 *   targetArchitecture: string,
 *   remediationSteps: string[],
 * }}
 */
export function buildFindingNarrative({
  testKey,
  title,
  message,
  severity,
  dbDescription,
  dbRemediation,
  resourceId,
  connectionName,
  frameworkNames = [],
}) {
  const plan = REMEDIATION_PLAYBOOK[testKey] || buildGenericPlan({ testKey, dbRemediation });
  const ctx = { resource: resourceId, connection: connectionName };
  const sev = (severity || "").toLowerCase();

  const urgency =
    sev === "critical"
      ? "This is rated critical severity; the recommended response is immediate, ahead of routine change windows."
      : sev === "high"
      ? "This is rated high severity; the recommended response is an expedited change."
      : sev === "medium"
      ? "This is rated medium severity; it should be scheduled into the normal remediation backlog."
      : "This is rated low severity; it can be addressed as part of routine hygiene work.";

  const executiveSummary = [substitute(plan.summary, ctx), urgency].filter(Boolean).join(" ");

  const whatItChecks =
    (dbDescription && dbDescription.trim()) ||
    `The automated check ${testKey} evaluates whether the resource meets the expected security baseline for its type.`;
  const whatFailed = message
    ? `On this resource the check returned a fail: "${message.trim().replace(/\.$/, "")}".`
    : "On this resource the check returned a fail: the resource did not meet the expected configuration.";
  const whatDetected = `${whatItChecks.trim().replace(/\.?$/, ".")} ${whatFailed}`;

  const whyItMatters = substitute(plan.impact, ctx);

  const prettyFrameworks = [
    ...new Set(frameworkNames.map((n) => (n.startsWith("ISO/IEC 27001") ? "ISO/IEC 27001" : n))),
  ];
  const complianceImpact = prettyFrameworks.length
    ? `This automated check is associated with ${prettyFrameworks.join(", ")}. The framework references in the table below are indicative mappings intended to help route this finding, not a certified crosswalk, and the applicable control owner should confirm scope. While the finding is open, it is reasonable to treat it as an unmet expectation against each associated framework.`
    : "No compliance framework mappings are recorded for this check.";

  return {
    executiveSummary,
    whatDetected,
    whyItMatters,
    complianceImpact,
    immediateAction: substitute(plan.immediate, ctx),
    targetArchitecture: substitute(plan.target, ctx),
    remediationSteps: plan.steps.map((s) => substitute(s, ctx)),
  };
}
