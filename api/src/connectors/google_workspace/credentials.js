import { google } from "googleapis";

// Domain-wide delegation scopes — every one is read-only, matching Prism's
// "evidence collection never mutates a customer tenant" convention. Drive /
// Gmail / Calendar sharing-default checks read via the Cloud Identity Policy
// API (cloud-identity.policies.readonly), NOT the Chrome Policy API — Google
// splits these into two separate APIs/hosts even though both are configured
// from the same Admin Console "Additional Google services" policy screens.
// chrome.management.policy.readonly is reserved for actual ChromeOS/Chrome
// browser device policy (see tests/devices.js).
const SCOPES = [
  "https://www.googleapis.com/auth/admin.directory.customer.readonly",
  "https://www.googleapis.com/auth/admin.directory.user.readonly",
  "https://www.googleapis.com/auth/admin.directory.user.security",
  "https://www.googleapis.com/auth/admin.directory.group.readonly",
  "https://www.googleapis.com/auth/admin.directory.group.member.readonly",
  "https://www.googleapis.com/auth/admin.directory.domain.readonly",
  "https://www.googleapis.com/auth/admin.directory.device.chromeos.readonly",
  "https://www.googleapis.com/auth/admin.directory.device.mobile.readonly",
  "https://www.googleapis.com/auth/admin.reports.audit.readonly",
  "https://www.googleapis.com/auth/chrome.management.policy.readonly",
  "https://www.googleapis.com/auth/cloud-identity.policies.readonly",
];

export async function resolveGoogleWorkspaceCredentials({ authType, config, secret }) {
  if (authType !== "oauth2") throw new Error(`Unsupported Google Workspace auth type: ${authType}`);
  if (!config.adminEmail) throw new Error("Google Workspace connection is missing config.adminEmail");
  if (!secret.clientEmail) throw new Error("Google Workspace connection is missing secret.clientEmail");
  if (!secret.privateKey) throw new Error("Google Workspace connection is missing secret.privateKey");

  const auth = new google.auth.JWT({
    email: secret.clientEmail,
    key: secret.privateKey,
    scopes: SCOPES,
    subject: config.adminEmail,
  });
  // Forces the first token mint — throws if the private key is malformed, the
  // service account's Client ID wasn't authorized for these exact scopes in
  // the Workspace Admin Console, or the impersonated adminEmail is invalid.
  await auth.authorize();

  const directory = google.admin({ version: "directory_v1", auth });

  // Directory API list endpoints accept the "my_customer" alias directly,
  // but the Cloud Identity Policy API's `customer==` filter and the Chrome
  // Policy API's `customer` path segment both expect a real customers/Cxxxx
  // resource name — the alias isn't documented as accepted there. Resolving
  // it once up front (customers.get honors "my_customer" as customerKey)
  // keeps every downstream call working the same way regardless of whether
  // config.customerId was set explicitly.
  const { data: customer } = await directory.customers.get({ customerKey: config.customerId || "my_customer" });

  return {
    directory,
    reports: google.admin({ version: "reports_v1", auth }),
    chromepolicy: google.chromepolicy({ version: "v1", auth }),
    cloudidentity: google.cloudidentity({ version: "v1", auth }),
    customerId: customer.id,
    adminEmail: config.adminEmail,
  };
}
