import { buildEvidencePayload } from "../../shared/evidencePayload.js";

// GET https://creator.zoho.{dc}/api/v2/{owner}/applications — check app permissions
async function checkAppPermissionReview(clients) {
  const data = await clients.creator.get("/api/v2/applications");
  const apps = data?.applications || data?.data || [];
  const overlyPermittedApps = apps.filter(
    (a) => (a.developerCount || 0) > 5 || (a.adminCount || 0) > 5
  );
  const results = overlyPermittedApps.map((a) => ({
    resourceId: String(a.link_name || a.id),
    status: "fail",
    message: `Creator app "${a.application_name || a.name}" has ${(a.developerCount || 0) + (a.adminCount || 0)} Developer/Admin users — exceeds expected threshold`,
    evidencePayload: buildEvidencePayload({
      resourceType: "zoho_creator_app",
      resourceId: String(a.link_name || a.id),
      resourceName: a.application_name || a.name || String(a.id),
      region: null,
      details: { appName: a.application_name, developerCount: a.developerCount, adminCount: a.adminCount },
    }),
  }));
  if (results.length === 0) {
    results.push({
      resourceId: clients.orgId,
      status: "pass",
      message: "All Creator apps have Admin/Developer permission assignments within acceptable limits",
      evidencePayload: buildEvidencePayload({
        resourceType: "zoho_creator_org",
        resourceId: clients.orgId,
        resourceName: `Org ${clients.orgId}`,
        region: null,
        details: { appsChecked: apps.length },
      }),
    });
  }
  return results;
}

// GET https://creator.zoho.{dc}/api/v2/applications — check for public forms with exposed reports
async function checkPublicFormDataExposure(clients) {
  const data = await clients.creator.get("/api/v2/applications");
  const apps = data?.applications || data?.data || [];
  const appsWithPublicForms = apps.filter(
    (a) => a.hasPublicForms === true || a.public_forms_count > 0
  );
  const results = appsWithPublicForms.map((a) => ({
    resourceId: String(a.link_name || a.id),
    status: "fail",
    message: `Creator app "${a.application_name || a.name}" has public-facing forms — verify they don't embed reports or lookups exposing other users' data`,
    evidencePayload: buildEvidencePayload({
      resourceType: "zoho_creator_app",
      resourceId: String(a.link_name || a.id),
      resourceName: a.application_name || a.name || String(a.id),
      region: null,
      details: { appName: a.application_name, publicFormsCount: a.public_forms_count || "unknown" },
    }),
  }));
  if (results.length === 0) {
    results.push({
      resourceId: clients.orgId,
      status: "pass",
      message: "No Creator apps with public-facing forms found that could expose existing records",
      evidencePayload: buildEvidencePayload({
        resourceType: "zoho_creator_org",
        resourceId: clients.orgId,
        resourceName: `Org ${clients.orgId}`,
        region: null,
        details: { appsChecked: apps.length },
      }),
    });
  }
  return results;
}

// GET https://creator.zoho.{dc}/api/v2/applications — check Deluge script edit access
async function checkDelugeScriptAccessReview(clients) {
  const data = await clients.creator.get("/api/v2/applications");
  const apps = data?.applications || data?.data || [];
  // Flag apps where script editors (developers) count exceeds a reasonable threshold
  const broadScriptAccess = apps.filter((a) => (a.developerCount || a.developer_count || 0) > 5);
  const results = broadScriptAccess.map((a) => ({
    resourceId: String(a.link_name || a.id),
    status: "fail",
    message: `Creator app "${a.application_name || a.name}" has ${a.developerCount || a.developer_count} users with Deluge script edit access`,
    evidencePayload: buildEvidencePayload({
      resourceType: "zoho_creator_app",
      resourceId: String(a.link_name || a.id),
      resourceName: a.application_name || a.name || String(a.id),
      region: null,
      details: { appName: a.application_name, developerCount: a.developerCount || a.developer_count },
    }),
  }));
  if (results.length === 0) {
    results.push({
      resourceId: clients.orgId,
      status: "pass",
      message: "Deluge script edit access is restricted to a small number of designated developers per Creator app",
      evidencePayload: buildEvidencePayload({
        resourceType: "zoho_creator_org",
        resourceId: clients.orgId,
        resourceName: `Org ${clients.orgId}`,
        region: null,
        details: { appsChecked: apps.length },
      }),
    });
  }
  return results;
}

export const creatorTests = [
  {
    key: "zoho.creator.app_permission_review",
    title: "App-level permissions follow least privilege",
    failTitle: "Creator app has Developer/Admin users exceeding the expected threshold",
    severityDefault: "medium",
    isoReferences: ["A.9.2.3"],
    dpdpaControlAreas: ["Privileged Access Management"],
    run: (clients) => checkAppPermissionReview(clients),
  },
  {
    key: "zoho.creator.public_form_data_exposure",
    title: "Public forms do not expose sensitive existing records",
    failTitle: "Creator app has public-facing forms that may expose other users' data",
    severityDefault: "critical",
    isoReferences: ["A.13.2.1"],
    dpdpaControlAreas: ["DLP / Data Leakage Prevention"],
    run: (clients) => checkPublicFormDataExposure(clients),
  },
  {
    key: "zoho.creator.deluge_script_access_review",
    title: "Custom (Deluge) script edit access is restricted",
    failTitle: "Creator app has an excessive number of users with Deluge script edit access",
    severityDefault: "medium",
    isoReferences: ["A.14.2.5"],
    dpdpaControlAreas: ["Secure Development & API Security"],
    run: (clients) => checkDelugeScriptAccessReview(clients),
  },
];
