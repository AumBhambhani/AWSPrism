import { buildEvidencePayload } from "../../shared/evidencePayload.js";

// GET https://vault.zoho.{dc}/api/rest/json/v1/policy/sharing
async function checkSecretSharingPolicy(clients) {
  const data = await clients.vault.get("/api/rest/json/v1/policy/sharing");
  const policy = data?.SHARE || data?.sharing_policy || data;
  const restricted =
    policy?.allowDirectSharing === false ||
    policy?.direct_sharing === "disabled" ||
    policy?.sharingType === "chamber_only" ||
    policy?.restrict_to_chamber === true;
  return [
    {
      resourceId: clients.orgId,
      status: restricted ? "pass" : "fail",
      message: restricted
        ? "Vault secret sharing is restricted to chamber/group-based sharing only"
        : "Vault allows direct secret sharing outside designated chambers",
      evidencePayload: buildEvidencePayload({
        resourceType: "zoho_vault_org",
        resourceId: clients.orgId,
        resourceName: `Org ${clients.orgId}`,
        region: null,
        details: { sharingPolicy: policy?.sharingType || policy?.sharing_policy || null },
      }),
    },
  ];
}

// GET https://vault.zoho.{dc}/api/rest/json/v1/policy/password
async function checkPasswordPolicyStrength(clients) {
  const data = await clients.vault.get("/api/rest/json/v1/policy/password");
  const policy = data?.PASSWORD || data?.password_policy || data;
  const minLength = policy?.minimumLength || policy?.min_length || 0;
  const hasComplexity =
    (policy?.requireUpperCase || policy?.require_uppercase) &&
    (policy?.requireLowerCase || policy?.require_lowercase) &&
    (policy?.requireNumbers || policy?.require_numbers);
  const compliant = minLength >= 14 && hasComplexity;
  return [
    {
      resourceId: clients.orgId,
      status: compliant ? "pass" : "fail",
      message: compliant
        ? `Vault password policy enforces minimum length ${minLength} with mixed character classes`
        : `Vault password policy does not meet minimum strength — length: ${minLength}, complexity: ${hasComplexity ? "ok" : "missing"}`,
      evidencePayload: buildEvidencePayload({
        resourceType: "zoho_vault_org",
        resourceId: clients.orgId,
        resourceName: `Org ${clients.orgId}`,
        region: null,
        details: { minimumLength: minLength, requiresComplexity: hasComplexity },
      }),
    },
  ];
}

// GET https://vault.zoho.{dc}/api/rest/json/v1/audit/settings
async function checkAccessLogReview(clients) {
  const data = await clients.vault.get("/api/rest/json/v1/audit/settings");
  const enabled = data?.AUDIT?.enabled === true || data?.audit_enabled === true || data?.auditEnabled === true;
  return [
    {
      resourceId: clients.orgId,
      status: enabled ? "pass" : "fail",
      message: enabled
        ? "Vault audit/access logging is enabled"
        : "Vault audit/access logging is not enabled",
      evidencePayload: buildEvidencePayload({
        resourceType: "zoho_vault_org",
        resourceId: clients.orgId,
        resourceName: `Org ${clients.orgId}`,
        region: null,
        details: { auditEnabled: enabled },
      }),
    },
  ];
}

export const vaultTests = [
  {
    key: "zoho.vault.secret_sharing_policy",
    title: "Secret sharing outside designated chambers is restricted",
    failTitle: "Vault allows direct secret sharing outside designated chambers",
    severityDefault: "high",
    isoReferences: ["A.9.4.1"],
    dpdpaControlAreas: ["Access Control & Least Privilege"],
    run: (clients) => checkSecretSharingPolicy(clients),
  },
  {
    key: "zoho.vault.password_policy_strength",
    title: "Vault-generated/stored passwords meet minimum strength policy",
    failTitle: "Vault password policy does not meet minimum strength requirements",
    severityDefault: "high",
    isoReferences: ["A.9.4.3"],
    dpdpaControlAreas: ["MFA for Sensitive Systems"],
    run: (clients) => checkPasswordPolicyStrength(clients),
  },
  {
    key: "zoho.vault.access_log_review",
    title: "Vault access logs are enabled and retained",
    failTitle: "Vault audit/access logging is not enabled",
    severityDefault: "medium",
    isoReferences: ["A.12.4.1"],
    dpdpaControlAreas: ["Logging & Monitoring"],
    run: (clients) => checkAccessLogReview(clients),
  },
];
