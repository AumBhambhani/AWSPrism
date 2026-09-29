import { buildEvidencePayload } from "../../shared/evidencePayload.js";

// GET https://www.zohoapis.{dc}/crm/v6/settings/security/users — check per-user MFA
async function checkCrmMfaEnforced(clients) {
  const data = await clients.crm.get("/crm/v6/users?type=ActiveUsers");
  const users = data?.users || [];
  const nonMfaUsers = users.filter((u) => !u.isTFAEnabled && !u.two_factor_auth_enabled);
  const results = nonMfaUsers.map((u) => ({
    resourceId: String(u.id),
    status: "fail",
    message: `CRM user ${u.email || u.id} does not have MFA enabled`,
    evidencePayload: buildEvidencePayload({
      resourceType: "zoho_crm_user",
      resourceId: String(u.id),
      resourceName: u.email || String(u.id),
      region: null,
      details: { email: u.email, isTFAEnabled: u.isTFAEnabled ?? u.two_factor_auth_enabled ?? false },
    }),
  }));
  if (results.length === 0) {
    results.push({
      resourceId: clients.orgId,
      status: "pass",
      message: "All active CRM users have MFA enabled",
      evidencePayload: buildEvidencePayload({
        resourceType: "zoho_crm_org",
        resourceId: clients.orgId,
        resourceName: `Org ${clients.orgId}`,
        region: null,
        details: { activeUsersChecked: users.length },
      }),
    });
  }
  return results;
}

// GET https://www.zohoapis.{dc}/crm/v6/settings/data_sharing
async function checkDataSharingRulesRestricted(clients) {
  const data = await clients.crm.get("/crm/v6/settings/data_sharing");
  const rules = data?.data_sharing || data?.sharing_rules || [];
  const publicRules = rules.filter(
    (r) => r.type === "public" || r.permission === "Read/Write" || r.access === "Public_ReadWrite"
  );
  const results = publicRules.map((r) => ({
    resourceId: r.id || r.module || "sharing_rule",
    status: "fail",
    message: `CRM data sharing rule for module "${r.module || r.name}" is set to Public Read/Write`,
    evidencePayload: buildEvidencePayload({
      resourceType: "zoho_crm_sharing_rule",
      resourceId: r.id || r.module || "sharing_rule",
      resourceName: r.module || r.name || "Unknown module",
      region: null,
      details: { module: r.module, access: r.access || r.permission || r.type },
    }),
  }));
  if (results.length === 0) {
    results.push({
      resourceId: clients.orgId,
      status: "pass",
      message: "No CRM data sharing rules are set to Public Read/Write",
      evidencePayload: buildEvidencePayload({
        resourceType: "zoho_crm_org",
        resourceId: clients.orgId,
        resourceName: `Org ${clients.orgId}`,
        region: null,
        details: { rulesChecked: rules.length },
      }),
    });
  }
  return results;
}

// GET https://www.zohoapis.{dc}/crm/v6/settings/audit_log
async function checkAuditLogEnabled(clients) {
  const data = await clients.crm.get("/crm/v6/settings/audit_log");
  const enabled = data?.audit_log?.enabled === true || data?.enabled === true;
  return [
    {
      resourceId: clients.orgId,
      status: enabled ? "pass" : "fail",
      message: enabled ? "CRM audit log tracking is enabled" : "CRM audit log tracking is not enabled",
      evidencePayload: buildEvidencePayload({
        resourceType: "zoho_crm_org",
        resourceId: clients.orgId,
        resourceName: `Org ${clients.orgId}`,
        region: null,
        details: { auditLogEnabled: enabled },
      }),
    },
  ];
}

export const crmTests = [
  {
    key: "zoho.crm.mfa_enforced",
    title: "CRM users have multi-factor authentication enabled",
    failTitle: "CRM user does not have MFA enabled",
    severityDefault: "critical",
    isoReferences: ["A.9.4.2"],
    dpdpaControlAreas: ["MFA for Sensitive Systems"],
    run: (clients) => checkCrmMfaEnforced(clients),
  },
  {
    key: "zoho.crm.data_sharing_rules_restricted",
    title: "Data sharing rules do not grant org-wide read/write",
    failTitle: "CRM data sharing rule is set to Public Read/Write",
    severityDefault: "high",
    isoReferences: ["A.13.1.1"],
    dpdpaControlAreas: ["Access Control & Least Privilege"],
    run: (clients) => checkDataSharingRulesRestricted(clients),
  },
  {
    key: "zoho.crm.audit_log_enabled",
    title: "Audit log tracking is enabled",
    failTitle: "CRM audit log tracking is not enabled",
    severityDefault: "medium",
    isoReferences: ["A.12.4.1"],
    dpdpaControlAreas: ["Logging & Monitoring"],
    run: (clients) => checkAuditLogEnabled(clients),
  },
];
