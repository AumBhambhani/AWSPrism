import { buildEvidencePayload } from "../../shared/evidencePayload.js";

// GET https://projects.zoho.{dc}/restapi/portal/{orgId}/users/ — check external/client users
async function checkExternalUserReview(clients) {
  const data = await clients.projects.get(`/restapi/portal/${clients.orgId}/users/?type=client`);
  const users = data?.users || data?.data || [];
  // Check each client user is only in specific projects (not the whole portal)
  const overlyBroadUsers = users.filter(
    (u) => u.access === "all_projects" || u.portalAccess === true || u.role?.includes("portal")
  );
  const results = overlyBroadUsers.map((u) => ({
    resourceId: String(u.id || u.zpuid),
    status: "fail",
    message: `External/client user ${u.email || u.id} has portal-wide project access rather than scoped project access`,
    evidencePayload: buildEvidencePayload({
      resourceType: "zoho_projects_user",
      resourceId: String(u.id || u.zpuid),
      resourceName: u.email || String(u.id),
      region: null,
      details: { email: u.email, access: u.access, portalAccess: u.portalAccess ?? false },
    }),
  }));
  if (results.length === 0) {
    results.push({
      resourceId: clients.orgId,
      status: "pass",
      message: "All external/client users have appropriately scoped project access",
      evidencePayload: buildEvidencePayload({
        resourceType: "zoho_projects_org",
        resourceId: clients.orgId,
        resourceName: `Org ${clients.orgId}`,
        region: null,
        details: { clientUsersChecked: users.length },
      }),
    });
  }
  return results;
}

// GET https://projects.zoho.{dc}/restapi/portal/{orgId}/projects/ — check client portal settings
async function checkClientPortalAccessRestricted(clients) {
  const data = await clients.projects.get(`/restapi/portal/${clients.orgId}/projects/`);
  const projects = data?.projects || data?.data || [];
  // Projects with client portal enabled — check each doesn't expose all-client visibility
  const openPortalProjects = projects.filter(
    (p) => p.client_portal === "all_clients" || p.portal_visibility === "all"
  );
  const results = openPortalProjects.map((p) => ({
    resourceId: String(p.id || p.id_string),
    status: "fail",
    message: `Project "${p.name}" client portal visibility is not restricted to intended clients`,
    evidencePayload: buildEvidencePayload({
      resourceType: "zoho_projects_project",
      resourceId: String(p.id || p.id_string),
      resourceName: p.name || String(p.id),
      region: null,
      details: { projectName: p.name, clientPortalSetting: p.client_portal || p.portal_visibility },
    }),
  }));
  if (results.length === 0) {
    results.push({
      resourceId: clients.orgId,
      status: "pass",
      message: "All Projects client portal settings are restricted to intended clients",
      evidencePayload: buildEvidencePayload({
        resourceType: "zoho_projects_org",
        resourceId: clients.orgId,
        resourceName: `Org ${clients.orgId}`,
        region: null,
        details: { projectsChecked: projects.length },
      }),
    });
  }
  return results;
}

// GET https://projects.zoho.{dc}/restapi/portal/{orgId}/projects/ — check role-based permissions
async function checkRoleBasedPermissionsEnforced(clients) {
  const data = await clients.projects.get(`/restapi/portal/${clients.orgId}/projects/`);
  const projects = data?.projects || data?.data || [];
  // Flag projects where all users are Manager (no employee/client role differentiation)
  const uniformManagerProjects = [];
  for (const project of projects) {
    const usersData = await clients.projects.get(
      `/restapi/portal/${clients.orgId}/projects/${project.id || project.id_string}/users/`
    );
    const users = usersData?.users || [];
    const managerCount = users.filter((u) => u.role === "manager" || u.role === "MANAGER").length;
    if (users.length > 0 && managerCount === users.length) {
      uniformManagerProjects.push({ project, managerCount, totalUsers: users.length });
    }
  }
  const results = uniformManagerProjects.map(({ project, managerCount }) => ({
    resourceId: String(project.id || project.id_string),
    status: "fail",
    message: `Project "${project.name}" has all ${managerCount} users assigned Manager role — role-based permission differentiation is missing`,
    evidencePayload: buildEvidencePayload({
      resourceType: "zoho_projects_project",
      resourceId: String(project.id || project.id_string),
      resourceName: project.name || String(project.id),
      region: null,
      details: { projectName: project.name, managerCount, allManagersOnly: true },
    }),
  }));
  if (results.length === 0) {
    results.push({
      resourceId: clients.orgId,
      status: "pass",
      message: "Projects use role-based permissions (not all-Manager) to gate access",
      evidencePayload: buildEvidencePayload({
        resourceType: "zoho_projects_org",
        resourceId: clients.orgId,
        resourceName: `Org ${clients.orgId}`,
        region: null,
        details: { projectsChecked: projects.length },
      }),
    });
  }
  return results;
}

export const projectsTests = [
  {
    key: "zoho.projects.external_user_review",
    title: "External/client users have scoped project access",
    failTitle: "External/client user has portal-wide project access rather than scoped project access",
    severityDefault: "medium",
    isoReferences: ["A.9.1.1"],
    dpdpaControlAreas: ["Access Control & Least Privilege"],
    run: (clients) => checkExternalUserReview(clients),
  },
  {
    key: "zoho.projects.client_portal_access_restricted",
    title: "Client portal access is restricted to intended projects",
    failTitle: "Project client portal visibility is not restricted to intended clients",
    severityDefault: "medium",
    isoReferences: ["A.9.4.1"],
    dpdpaControlAreas: ["Access Control & Least Privilege"],
    run: (clients) => checkClientPortalAccessRestricted(clients),
  },
  {
    key: "zoho.projects.role_based_permissions_enforced",
    title: "Role-based permissions are enforced per project",
    failTitle: "Project has all users assigned the Manager role — role-based permission differentiation is missing",
    severityDefault: "medium",
    isoReferences: ["A.9.2.3"],
    dpdpaControlAreas: ["Privileged Access Management"],
    run: (clients) => checkRoleBasedPermissionsEnforced(clients),
  },
];
