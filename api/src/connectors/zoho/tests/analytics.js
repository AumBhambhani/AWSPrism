import { buildEvidencePayload } from "../../shared/evidencePayload.js";

// GET https://analyticsapi.zoho.{dc}/restapi/v2/workspaces — check workspace sharing
async function checkDataSharingReview(clients) {
  const data = await clients.analytics.get("/restapi/v2/workspaces");
  const workspaces = data?.data?.workspaces || data?.workspaces || [];
  const overSharedWorkspaces = workspaces.filter(
    (w) =>
      w.shareType === "org_wide" ||
      w.sharing === "everyone" ||
      w.access === "all_users"
  );
  const results = overSharedWorkspaces.map((w) => ({
    resourceId: String(w.id || w.workspaceId),
    status: "fail",
    message: `Analytics workspace "${w.name}" is shared with everyone in the organization rather than specific users/groups`,
    evidencePayload: buildEvidencePayload({
      resourceType: "zoho_analytics_workspace",
      resourceId: String(w.id || w.workspaceId),
      resourceName: w.name || String(w.id),
      region: null,
      details: { workspaceName: w.name, shareType: w.shareType || w.sharing || w.access },
    }),
  }));
  if (results.length === 0) {
    results.push({
      resourceId: clients.orgId,
      status: "pass",
      message: "All Analytics workspaces are scoped to specific users or groups rather than org-wide",
      evidencePayload: buildEvidencePayload({
        resourceType: "zoho_analytics_org",
        resourceId: clients.orgId,
        resourceName: `Org ${clients.orgId}`,
        region: null,
        details: { workspacesChecked: workspaces.length },
      }),
    });
  }
  return results;
}

// GET https://analyticsapi.zoho.{dc}/restapi/v2/workspaces — check public view links
async function checkPublicViewLinkRestricted(clients) {
  const data = await clients.analytics.get("/restapi/v2/workspaces");
  const workspaces = data?.data?.workspaces || data?.workspaces || [];
  const publicLinks = workspaces.filter(
    (w) => w.hasPublicLink === true || w.isPublished === true || w.publicAccess === true
  );
  const results = publicLinks.map((w) => ({
    resourceId: String(w.id || w.workspaceId),
    status: "fail",
    message: `Analytics workspace/view "${w.name}" has a public/embedded link that requires no authentication`,
    evidencePayload: buildEvidencePayload({
      resourceType: "zoho_analytics_workspace",
      resourceId: String(w.id || w.workspaceId),
      resourceName: w.name || String(w.id),
      region: null,
      details: { workspaceName: w.name, hasPublicLink: w.hasPublicLink ?? w.isPublished ?? false },
    }),
  }));
  if (results.length === 0) {
    results.push({
      resourceId: clients.orgId,
      status: "pass",
      message: "No Analytics workspaces or views have active public/unauthenticated embed links",
      evidencePayload: buildEvidencePayload({
        resourceType: "zoho_analytics_org",
        resourceId: clients.orgId,
        resourceName: `Org ${clients.orgId}`,
        region: null,
        details: { workspacesChecked: workspaces.length },
      }),
    });
  }
  return results;
}

// GET https://analyticsapi.zoho.{dc}/restapi/v2/workspaces — check admin/owner assignments
async function checkWorkspacePermissionReview(clients) {
  const data = await clients.analytics.get("/restapi/v2/workspaces");
  const workspaces = data?.data?.workspaces || data?.workspaces || [];
  const highPrivilegeWorkspaces = workspaces.filter((w) => {
    const adminCount = w.adminCount || w.ownerCount || 0;
    return adminCount > 5;
  });
  const results = highPrivilegeWorkspaces.map((w) => ({
    resourceId: String(w.id || w.workspaceId),
    status: "fail",
    message: `Analytics workspace "${w.name}" has ${w.adminCount || w.ownerCount} admin/owner assignments — consider limiting to designated report administrators`,
    evidencePayload: buildEvidencePayload({
      resourceType: "zoho_analytics_workspace",
      resourceId: String(w.id || w.workspaceId),
      resourceName: w.name || String(w.id),
      region: null,
      details: { workspaceName: w.name, adminOwnerCount: w.adminCount || w.ownerCount },
    }),
  }));
  if (results.length === 0) {
    results.push({
      resourceId: clients.orgId,
      status: "pass",
      message: "Analytics workspace Admin/Owner assignments are within acceptable limits",
      evidencePayload: buildEvidencePayload({
        resourceType: "zoho_analytics_org",
        resourceId: clients.orgId,
        resourceName: `Org ${clients.orgId}`,
        region: null,
        details: { workspacesChecked: workspaces.length },
      }),
    });
  }
  return results;
}

export const analyticsTests = [
  {
    key: "zoho.analytics.data_sharing_review",
    title: "Workspace/view sharing is scoped to intended users",
    failTitle: "Analytics workspace is shared with everyone in the organization rather than specific users/groups",
    severityDefault: "high",
    isoReferences: ["A.13.2.1"],
    dpdpaControlAreas: ["DLP / Data Leakage Prevention"],
    run: (clients) => checkDataSharingReview(clients),
  },
  {
    key: "zoho.analytics.public_view_link_restricted",
    title: "Public/embedded view links are disabled or reviewed",
    failTitle: "Analytics workspace/view has a public/embedded link that requires no authentication",
    severityDefault: "critical",
    isoReferences: ["A.9.4.1"],
    dpdpaControlAreas: ["Access Control & Least Privilege"],
    run: (clients) => checkPublicViewLinkRestricted(clients),
  },
  {
    key: "zoho.analytics.workspace_permission_review",
    title: "Workspace admin/owner assignment is minimized",
    failTitle: "Analytics workspace has an excessive number of admin/owner assignments",
    severityDefault: "medium",
    isoReferences: ["A.9.2.3"],
    dpdpaControlAreas: ["Privileged Access Management"],
    run: (clients) => checkWorkspacePermissionReview(clients),
  },
];
