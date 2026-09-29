import { buildEvidencePayload } from "../../shared/evidencePayload.js";

// ──────────────────────────────────────────────────────────────────────────────
// Exchange Online Admin API helper
// Calls are POSTs to the cmdlet-proxy endpoint.
// ──────────────────────────────────────────────────────────────────────────────
async function exchangePost(getToken, tenantId, cmdletName, params = {}) {
  const token = await getToken();
  const url = `https://outlook.office365.com/adminapi/v2.0/${tenantId}/${cmdletName}`;
  const res = await fetch(url, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify({ CmdletInput: { CmdletName: cmdletName, Parameters: params } }),
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Exchange Admin API ${cmdletName} failed: ${res.status} ${text}`);
  }
  return res.json();
}

// ──────────────────────────────────────────────────────────────────────────────
// microsoft_365.exchange.mailbox_audit_logging_enabled
// ──────────────────────────────────────────────────────────────────────────────
async function checkMailboxAuditLoggingEnabled(getToken, tenantId) {
  const data = await exchangePost(getToken, tenantId, "Get-OrganizationConfig");
  const config = Array.isArray(data?.value) ? data.value[0] : data;
  const auditDisabled = config?.AuditDisabled === true;
  return [{
    resourceId: tenantId,
    status: auditDisabled ? "fail" : "pass",
    message: auditDisabled
      ? "Exchange Online mailbox audit logging is explicitly disabled for the tenant"
      : "Exchange Online mailbox audit logging is enabled",
    evidencePayload: buildEvidencePayload({
      resourceType: "m365_exchange_org",
      resourceId: tenantId,
      region: null,
      details: { auditDisabled: auditDisabled ?? false },
    }),
  }];
}

// ──────────────────────────────────────────────────────────────────────────────
// microsoft_365.exchange.no_external_auto_forwarding
// ──────────────────────────────────────────────────────────────────────────────
async function checkNoExternalAutoForwarding(getToken, tenantId) {
  const data = await exchangePost(getToken, tenantId, "Get-RemoteDomain", { Identity: "Default" });
  const domain = Array.isArray(data?.value) ? data.value[0] : data;
  const autoForwardEnabled = domain?.AutoForwardEnabled === true;
  return [{
    resourceId: tenantId,
    status: autoForwardEnabled ? "fail" : "pass",
    message: autoForwardEnabled
      ? "The default Exchange remote domain allows automatic email forwarding to external addresses"
      : "The default Exchange remote domain has automatic external forwarding disabled",
    evidencePayload: buildEvidencePayload({
      resourceType: "m365_exchange_remote_domain",
      resourceId: "Default",
      region: null,
      details: { autoForwardEnabled: autoForwardEnabled ?? false },
    }),
  }];
}

export const exchangeTests = [
  {
    key: "microsoft_365.exchange.mailbox_audit_logging_enabled",
    title: "Mailbox audit logging is enabled",
    failTitle: "Exchange Online mailbox audit logging is disabled for the tenant",
    severityDefault: "critical",
    isoReferences: ["A.12.4.1"],
    dpdpaControlAreas: ["Logging & Monitoring"],
    run: (clients) => checkMailboxAuditLoggingEnabled(clients.getExchangeToken, clients.tenantId),
  },
  {
    key: "microsoft_365.exchange.no_external_auto_forwarding",
    title: "Automatic forwarding to external domains is blocked",
    failTitle: "The default Exchange remote domain allows automatic email forwarding to external addresses",
    severityDefault: "high",
    isoReferences: ["A.13.2.1"],
    dpdpaControlAreas: ["DLP / Data Leakage Prevention"],
    run: (clients) => checkNoExternalAutoForwarding(clients.getExchangeToken, clients.tenantId),
  },
];
