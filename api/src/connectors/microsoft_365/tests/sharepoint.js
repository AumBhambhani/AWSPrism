import { buildEvidencePayload } from "../../shared/evidencePayload.js";
import { graphGet, graphPaginate } from "../../entra_id/tests/mfaAndAccess.js";

// ──────────────────────────────────────────────────────────────────────────────
// microsoft_365.sharepoint.external_sharing_restricted
// ──────────────────────────────────────────────────────────────────────────────
async function checkExternalSharingRestricted(getToken, tenantId) {
  const settings = await graphGet(getToken, "/admin/sharepoint/settings");
  // sharingCapability: "disabled" | "existingExternalUserSharingOnly" | "externalUserSharingOnly" | "externalUserAndGuestSharing"
  const cap = settings?.sharingCapability;
  const isOpen = cap === "externalUserAndGuestSharing";
  return [{
    resourceId: tenantId,
    status: isOpen ? "fail" : "pass",
    message: isOpen
      ? `SharePoint/OneDrive external sharing is fully open (sharingCapability: "${cap}")`
      : `SharePoint/OneDrive external sharing is restricted (sharingCapability: "${cap}")`,
    evidencePayload: buildEvidencePayload({
      resourceType: "m365_sharepoint_tenant",
      resourceId: tenantId,
      region: null,
      details: { sharingCapability: cap ?? null },
    }),
  }];
}

// ──────────────────────────────────────────────────────────────────────────────
// microsoft_365.sharepoint.dlp_policy_configured
//
// NOTE: Microsoft Graph's beta `informationProtection/dataLossPreventionPolicies`
// API has no published documentation describing per-location (e.g. per-SharePoint-
// site) coverage fields, so this check validates DLP policy existence tenant-wide
// rather than per-site coverage. If Graph exposes a reliable site-coverage shape
// in the future, this can be tightened to a per-site pass/fail.
// ──────────────────────────────────────────────────────────────────────────────
async function checkDlpPolicyConfigured(getToken, tenantId) {
  const sites = await graphPaginate(getToken, "/sites?search=*");
  if (sites.length === 0) {
    return [{
      resourceId: tenantId,
      status: "not_applicable",
      message: "No SharePoint sites found",
      evidencePayload: buildEvidencePayload({
        resourceType: "m365_dlp_configuration",
        resourceId: tenantId,
        region: null,
        details: { siteCount: 0 },
      }),
    }];
  }

  const response = await graphGet(getToken, "/informationProtection/dataLossPreventionPolicies", "beta");
  const policies = response?.value ?? [];
  const hasPolicies = policies.length > 0;

  return [{
    resourceId: tenantId,
    status: hasPolicies ? "pass" : "fail",
    message: hasPolicies
      ? `${policies.length} Data Loss Prevention polic${policies.length === 1 ? "y is" : "ies are"} configured for this tenant`
      : "No Data Loss Prevention policies are configured for this tenant",
    evidencePayload: buildEvidencePayload({
      resourceType: "m365_dlp_configuration",
      resourceId: tenantId,
      region: null,
      details: { siteCount: sites.length, policyCount: policies.length },
    }),
  }];
}

// ──────────────────────────────────────────────────────────────────────────────
// microsoft_365.sharepoint.sensitivity_label_policy_enforced
//
// NOTE: Graph does not expose a mandatory-labeling enforcement flag on the
// sensitivityLabels endpoint, so this check validates label policy existence
// only (see docs/connectors/microsoft_365.md).
// ──────────────────────────────────────────────────────────────────────────────
async function checkSensitivityLabelPolicyEnforced(getToken, tenantId) {
  let response;
  try {
    response = await graphGet(getToken, "/security/informationProtection/sensitivityLabels", "beta");
  } catch (err) {
    return [{
      resourceId: tenantId,
      status: "not_applicable",
      message: `Could not check sensitivity label policies — this requires Microsoft Purview Information Protection licensing and permissions: ${err.message}`,
      evidencePayload: buildEvidencePayload({
        resourceType: "m365_label_policy",
        resourceId: tenantId,
        region: null,
        details: {},
      }),
    }];
  }

  const labels = response?.value ?? [];
  const hasLabels = labels.length > 0;

  return [{
    resourceId: tenantId,
    status: hasLabels ? "pass" : "fail",
    message: hasLabels
      ? `${labels.length} sensitivity label${labels.length === 1 ? "" : "s"} configured for this tenant`
      : "No sensitivity label policies are configured in this tenant",
    evidencePayload: buildEvidencePayload({
      resourceType: "m365_label_policy",
      resourceId: tenantId,
      region: null,
      details: { labelCount: labels.length },
    }),
  }];
}

export const sharepointTests = [
  {
    key: "microsoft_365.sharepoint.external_sharing_restricted",
    title: "SharePoint and OneDrive external sharing is restricted",
    failTitle: "SharePoint/OneDrive external sharing is fully open",
    severityDefault: "critical",
    isoReferences: ["A.13.2.1"],
    dpdpaControlAreas: ["DLP / Data Leakage Prevention"],
    run: (clients) => checkExternalSharingRestricted(clients.getGraphToken, clients.tenantId),
  },
  {
    key: "microsoft_365.sharepoint.dlp_policy_configured",
    title: "Data Loss Prevention policies are configured for the tenant",
    failTitle: "No Data Loss Prevention policies are configured",
    severityDefault: "critical",
    isoReferences: ["A.13.2.1"],
    dpdpaControlAreas: ["DLP / Data Leakage Prevention"],
    run: (clients) => checkDlpPolicyConfigured(clients.getGraphToken, clients.tenantId),
  },
  {
    key: "microsoft_365.sharepoint.sensitivity_label_policy_enforced",
    title: "Sensitivity label policies are configured",
    failTitle: "No sensitivity label policies are configured",
    severityDefault: "high",
    isoReferences: ["A.8.2.3"],
    dpdpaControlAreas: ["DLP / Data Leakage Prevention"],
    run: (clients) => checkSensitivityLabelPolicyEnforced(clients.getGraphToken, clients.tenantId),
  },
];
