import { buildEvidencePayload } from "../../shared/evidencePayload.js";

// GET https://mail.zoho.{dc}/api/accounts — check org mail policy for forwarding
async function checkForwardingRestricted(clients) {
  const data = await clients.mail.get("/api/accounts?category=org");
  const policy = data?.data?.policySettings || data?.policySettings || data;
  const restricted =
    policy?.blockExternalForwarding === true ||
    policy?.external_forwarding === "blocked" ||
    policy?.autoForwardingToExternalDomains === "disabled" ||
    policy?.block_auto_forward === true;
  return [
    {
      resourceId: clients.orgId,
      status: restricted ? "pass" : "fail",
      message: restricted
        ? "Mail org policy blocks auto-forwarding to external domains"
        : "Mail org policy does not restrict auto-forwarding to external domains",
      evidencePayload: buildEvidencePayload({
        resourceType: "zoho_mail_org",
        resourceId: clients.orgId,
        resourceName: `Org ${clients.orgId}`,
        region: null,
        details: {
          blockExternalForwarding: policy?.blockExternalForwarding ?? null,
          externalForwarding: policy?.external_forwarding ?? null,
        },
      }),
    },
  ];
}

// GET https://mail.zoho.{dc}/api/organization/security
async function checkTwoFactorAuthEnforced(clients) {
  const data = await clients.mail.get("/api/organization/security");
  const enforced =
    data?.data?.isTFAEnforced === true ||
    data?.tfa_enforced === true ||
    data?.two_factor_auth_required === true;
  return [
    {
      resourceId: clients.orgId,
      status: enforced ? "pass" : "fail",
      message: enforced
        ? "Mail org security policy enforces two-factor authentication for all mailboxes"
        : "Mail org security policy does not enforce two-factor authentication",
      evidencePayload: buildEvidencePayload({
        resourceType: "zoho_mail_org",
        resourceId: clients.orgId,
        resourceName: `Org ${clients.orgId}`,
        region: null,
        details: { isTfaEnforced: enforced },
      }),
    },
  ];
}

// GET https://mail.zoho.{dc}/api/organization/security
async function checkSpamPhishingFiltersEnabled(clients) {
  const data = await clients.mail.get("/api/organization/security");
  const spamEnabled =
    data?.data?.spamFilterEnabled === true ||
    data?.spam_filter_enabled === true ||
    data?.anti_spam_enabled === true;
  const phishingEnabled =
    data?.data?.phishingFilterEnabled === true ||
    data?.phishing_filter_enabled === true ||
    data?.anti_phishing_enabled === true;
  const allEnabled = spamEnabled && phishingEnabled;
  return [
    {
      resourceId: clients.orgId,
      status: allEnabled ? "pass" : "fail",
      message: allEnabled
        ? "Mail spam and phishing filters are both enabled for all mailboxes"
        : `Mail filters partially enabled — spam: ${spamEnabled}, phishing: ${phishingEnabled}`,
      evidencePayload: buildEvidencePayload({
        resourceType: "zoho_mail_org",
        resourceId: clients.orgId,
        resourceName: `Org ${clients.orgId}`,
        region: null,
        details: { spamFilterEnabled: spamEnabled, phishingFilterEnabled: phishingEnabled },
      }),
    },
  ];
}

export const mailTests = [
  {
    key: "zoho.mail.forwarding_restricted",
    title: "Auto-forwarding to external domains is restricted",
    failTitle: "Mail org policy does not restrict auto-forwarding to external domains",
    severityDefault: "high",
    isoReferences: ["A.13.2.3"],
    dpdpaControlAreas: ["DLP / Data Leakage Prevention"],
    run: (clients) => checkForwardingRestricted(clients),
  },
  {
    key: "zoho.mail.two_factor_auth_enforced",
    title: "Two-factor authentication is enforced for mailboxes",
    failTitle: "Mail org security policy does not enforce two-factor authentication",
    severityDefault: "critical",
    isoReferences: ["A.9.4.2"],
    dpdpaControlAreas: ["MFA for Sensitive Systems"],
    run: (clients) => checkTwoFactorAuthEnforced(clients),
  },
  {
    key: "zoho.mail.spam_phishing_filters_enabled",
    title: "Spam and phishing filters are enabled",
    failTitle: "Mail spam or phishing filters are not fully enabled",
    severityDefault: "medium",
    isoReferences: ["A.12.2.1"],
    dpdpaControlAreas: ["Security Safeguards Program"],
    run: (clients) => checkSpamPhishingFiltersEnabled(clients),
  },
];
