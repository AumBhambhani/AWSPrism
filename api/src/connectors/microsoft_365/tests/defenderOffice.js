import { buildEvidencePayload } from "../../shared/evidencePayload.js";

// Safe Links and Safe Attachments are Security & Compliance cmdlets exposed via
// the Exchange Online Admin API. The spec notes to verify these cmdlets appear in
// the current Exchange Online Admin API endpoint reference before assuming parity.
// We implement them here using the same cmdlet-proxy POST shape as exchange.js.

async function exchangePost(getToken, tenantId, cmdletName) {
  const token = await getToken();
  const url = `https://outlook.office365.com/adminapi/v2.0/${tenantId}/${cmdletName}`;
  const res = await fetch(url, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify({ CmdletInput: { CmdletName: cmdletName } }),
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Exchange Admin API ${cmdletName} failed: ${res.status} ${text}`);
  }
  return res.json();
}

// ──────────────────────────────────────────────────────────────────────────────
// microsoft_365.defenderoffice.safe_links_enabled
// ──────────────────────────────────────────────────────────────────────────────
async function checkSafeLinksEnabled(getToken, tenantId) {
  const data = await exchangePost(getToken, tenantId, "Get-SafeLinksPolicy");
  const policies = Array.isArray(data?.value) ? data.value : (data ? [data] : []);
  const activePolicies = policies.filter(
    (p) => p.IsEnabled === true || p.EnableSafeLinksForEmail === true || p.IsDefault === true
  );
  const pass = activePolicies.length > 0;
  return [{
    resourceId: tenantId,
    status: pass ? "pass" : "fail",
    message: pass
      ? `${activePolicies.length} active Safe Links policy found`
      : "No active Safe Links policies found — time-of-click URL protection is not enforced",
    evidencePayload: buildEvidencePayload({
      resourceType: "m365_defender_office",
      resourceId: tenantId,
      region: null,
      details: { totalPolicies: policies.length, activePolicies: activePolicies.length },
    }),
  }];
}

// ──────────────────────────────────────────────────────────────────────────────
// microsoft_365.defenderoffice.safe_attachments_enabled
// ──────────────────────────────────────────────────────────────────────────────
async function checkSafeAttachmentsEnabled(getToken, tenantId) {
  const data = await exchangePost(getToken, tenantId, "Get-SafeAttachmentPolicy");
  const policies = Array.isArray(data?.value) ? data.value : (data ? [data] : []);
  const activePolicies = policies.filter(
    (p) => p.Enable === true || p.Action === "DynamicDelivery" || p.Action === "Block" || p.Action === "Replace"
  );
  const pass = activePolicies.length > 0;
  return [{
    resourceId: tenantId,
    status: pass ? "pass" : "fail",
    message: pass
      ? `${activePolicies.length} active Safe Attachments policy found`
      : "No active Safe Attachments policies found — detonation scanning is not enforced",
    evidencePayload: buildEvidencePayload({
      resourceType: "m365_defender_office",
      resourceId: tenantId,
      region: null,
      details: { totalPolicies: policies.length, activePolicies: activePolicies.length },
    }),
  }];
}

export const defenderOfficeTests = [
  {
    key: "microsoft_365.defenderoffice.safe_links_enabled",
    title: "Safe Links protection is enabled for email and Office apps",
    failTitle: "No active Safe Links policy found — time-of-click URL protection is not enforced",
    severityDefault: "high",
    isoReferences: ["A.12.2.1"],
    dpdpaControlAreas: ["Security Safeguards Program"],
    run: (clients) => checkSafeLinksEnabled(clients.getExchangeToken, clients.tenantId),
  },
  {
    key: "microsoft_365.defenderoffice.safe_attachments_enabled",
    title: "Safe Attachments protection is enabled",
    failTitle: "No active Safe Attachments policy found — detonation scanning is not enforced",
    severityDefault: "high",
    isoReferences: ["A.12.2.1"],
    dpdpaControlAreas: ["Security Safeguards Program"],
    run: (clients) => checkSafeAttachmentsEnabled(clients.getExchangeToken, clients.tenantId),
  },
];
