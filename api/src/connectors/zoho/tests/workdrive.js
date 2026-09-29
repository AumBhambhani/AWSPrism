import { buildEvidencePayload } from "../../shared/evidencePayload.js";

// GET https://www.zohoapis.{dc}/workdrive/v1/team/securitysettings
async function checkExternalSharingRestricted(clients) {
  const data = await clients.workdrive.get("/workdrive/v1/team/securitysettings");
  const settings = data?.data?.attributes || data?.attributes || data;
  const restricted =
    settings?.allow_external_sharing === false ||
    settings?.external_sharing === "disabled" ||
    settings?.external_sharing_requires_approval === true;
  return [
    {
      resourceId: clients.orgId,
      status: restricted ? "pass" : "fail",
      message: restricted
        ? "WorkDrive external sharing is restricted or requires admin approval"
        : "WorkDrive external sharing is unrestricted at the team level",
      evidencePayload: buildEvidencePayload({
        resourceType: "zoho_workdrive_team",
        resourceId: clients.orgId,
        resourceName: `Org ${clients.orgId}`,
        region: null,
        details: {
          allowExternalSharing: settings?.allow_external_sharing ?? null,
          externalSharing: settings?.external_sharing ?? null,
        },
      }),
    },
  ];
}

// GET https://www.zohoapis.{dc}/workdrive/v1/links — check public link security settings
async function checkLinkSharingPasswordProtected(clients) {
  const data = await clients.workdrive.get("/workdrive/v1/team/securitysettings");
  const settings = data?.data?.attributes || data?.attributes || data;
  const passwordRequired = settings?.require_link_password === true;
  const expiryRequired = settings?.require_link_expiry === true || settings?.link_expiry_required === true;
  const compliant = passwordRequired && expiryRequired;
  return [
    {
      resourceId: clients.orgId,
      status: compliant ? "pass" : "fail",
      message: compliant
        ? "WorkDrive public share links require both a password and an expiry date"
        : "WorkDrive public share links do not require a password and/or expiry date",
      evidencePayload: buildEvidencePayload({
        resourceType: "zoho_workdrive_team",
        resourceId: clients.orgId,
        resourceName: `Org ${clients.orgId}`,
        region: null,
        details: { requireLinkPassword: passwordRequired, requireLinkExpiry: expiryRequired },
      }),
    },
  ];
}

// GET https://www.zohoapis.{dc}/workdrive/v1/team/auditlogstatus
async function checkAdminActivityLogEnabled(clients) {
  const data = await clients.workdrive.get("/workdrive/v1/team/auditlogstatus");
  const enabled = data?.data?.attributes?.status === "enabled" || data?.enabled === true || data?.status === "enabled";
  return [
    {
      resourceId: clients.orgId,
      status: enabled ? "pass" : "fail",
      message: enabled
        ? "WorkDrive admin activity logging is enabled"
        : "WorkDrive admin activity logging is not enabled",
      evidencePayload: buildEvidencePayload({
        resourceType: "zoho_workdrive_team",
        resourceId: clients.orgId,
        resourceName: `Org ${clients.orgId}`,
        region: null,
        details: { auditLogEnabled: enabled },
      }),
    },
  ];
}

export const workdriveTests = [
  {
    key: "zoho.workdrive.external_sharing_restricted",
    title: "External sharing is restricted at the team level",
    failTitle: "WorkDrive external sharing is unrestricted at the team level",
    severityDefault: "critical",
    isoReferences: ["A.13.2.1"],
    dpdpaControlAreas: ["DLP / Data Leakage Prevention"],
    run: (clients) => checkExternalSharingRestricted(clients),
  },
  {
    key: "zoho.workdrive.link_sharing_password_protected",
    title: "Public share links require a password and expiry",
    failTitle: "WorkDrive public share links do not require a password and/or expiry date",
    severityDefault: "high",
    isoReferences: ["A.9.4.1"],
    dpdpaControlAreas: ["DLP / Data Leakage Prevention"],
    run: (clients) => checkLinkSharingPasswordProtected(clients),
  },
  {
    key: "zoho.workdrive.admin_activity_log_enabled",
    title: "Admin activity logging is enabled",
    failTitle: "WorkDrive admin activity logging is not enabled",
    severityDefault: "medium",
    isoReferences: ["A.12.4.1"],
    dpdpaControlAreas: ["Logging & Monitoring"],
    run: (clients) => checkAdminActivityLogEnabled(clients),
  },
];
