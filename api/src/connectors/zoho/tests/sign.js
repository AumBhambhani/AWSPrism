import { buildEvidencePayload } from "../../shared/evidencePayload.js";

// GET https://sign.zoho.{dc}/api/v1/settings — check audit trail setting
async function checkAuditTrailEnabled(clients) {
  const data = await clients.sign.get("/api/v1/settings");
  const settings = data?.settings || data;
  const enabled =
    settings?.includeAuditTrail === true ||
    settings?.audit_trail_enabled === true ||
    settings?.include_audit_trail === true;
  return [
    {
      resourceId: clients.orgId,
      status: enabled ? "pass" : "fail",
      message: enabled
        ? "Zoho Sign includes a full audit trail with every completed document"
        : "Zoho Sign does not include an audit trail with completed documents",
      evidencePayload: buildEvidencePayload({
        resourceType: "zoho_sign_org",
        resourceId: clients.orgId,
        resourceName: `Org ${clients.orgId}`,
        region: null,
        details: { auditTrailEnabled: enabled },
      }),
    },
  ];
}

// GET https://sign.zoho.{dc}/api/v1/templates — check template sharing
async function checkTemplateAccessRestricted(clients) {
  const data = await clients.sign.get("/api/v1/templates");
  const templates = data?.templates?.list || data?.templates || [];
  const openTemplates = templates.filter(
    (t) => t.sharedWith === "org" || t.share_type === "organization" || t.visibility === "all"
  );
  const results = openTemplates.map((t) => ({
    resourceId: String(t.template_id || t.id),
    status: "fail",
    message: `Sign template "${t.template_name || t.name}" is shared with the entire organization rather than specific users/groups`,
    evidencePayload: buildEvidencePayload({
      resourceType: "zoho_sign_template",
      resourceId: String(t.template_id || t.id),
      resourceName: t.template_name || t.name || String(t.id),
      region: null,
      details: { templateName: t.template_name, sharedWith: t.sharedWith || t.share_type || t.visibility },
    }),
  }));
  if (results.length === 0) {
    results.push({
      resourceId: clients.orgId,
      status: "pass",
      message: "All Sign templates restrict access to specific users/groups rather than the whole organization",
      evidencePayload: buildEvidencePayload({
        resourceType: "zoho_sign_org",
        resourceId: clients.orgId,
        resourceName: `Org ${clients.orgId}`,
        region: null,
        details: { templatesChecked: templates.length },
      }),
    });
  }
  return results;
}

// GET https://sign.zoho.{dc}/api/v1/settings — check document retention
async function checkCompletedDocumentRetention(clients) {
  const data = await clients.sign.get("/api/v1/settings");
  const settings = data?.settings || data;
  // Retention is compliant if auto-delete is disabled or retention period >= 7 years (2555 days)
  const autoDeleteEnabled = settings?.autoDelete === true || settings?.auto_delete === true;
  const retentionDays = settings?.retentionDays || settings?.retention_days || settings?.retentionPeriod || 0;
  const compliant = !autoDeleteEnabled || retentionDays >= 2555;
  return [
    {
      resourceId: clients.orgId,
      status: compliant ? "pass" : "fail",
      message: compliant
        ? "Sign completed document retention policy meets minimum retention requirements"
        : `Sign documents may be auto-deleted after ${retentionDays} days — verify this meets the required evidence retention period`,
      evidencePayload: buildEvidencePayload({
        resourceType: "zoho_sign_org",
        resourceId: clients.orgId,
        resourceName: `Org ${clients.orgId}`,
        region: null,
        details: { autoDeleteEnabled, retentionDays },
      }),
    },
  ];
}

export const signTests = [
  {
    key: "zoho.sign.audit_trail_enabled",
    title: "Document audit trail is enabled",
    failTitle: "Zoho Sign does not include an audit trail with completed documents",
    severityDefault: "high",
    isoReferences: ["A.12.4.1"],
    dpdpaControlAreas: ["Logging & Monitoring"],
    run: (clients) => checkAuditTrailEnabled(clients),
  },
  {
    key: "zoho.sign.template_access_restricted",
    title: "Template access is restricted to authorized users",
    failTitle: "Sign template is shared with the entire organization rather than specific users/groups",
    severityDefault: "medium",
    isoReferences: ["A.9.4.1"],
    dpdpaControlAreas: ["Access Control & Least Privilege"],
    run: (clients) => checkTemplateAccessRestricted(clients),
  },
  {
    key: "zoho.sign.completed_document_retention",
    title: "Completed document retention meets policy",
    failTitle: "Sign documents may be auto-deleted before the required evidence retention period",
    severityDefault: "medium",
    isoReferences: ["A.18.1.3"],
    dpdpaControlAreas: ["Retention Schedule"],
    run: (clients) => checkCompletedDocumentRetention(clients),
  },
];
