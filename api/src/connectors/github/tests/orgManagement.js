const MAX_ORGANIZATION_OWNERS = 5;

export async function checkDefaultRepositoryPermissionRestricted(octokit, org) {
  const { data: orgData } = await octokit.rest.orgs.get({ org });

  // Same "absent means not observable, not failed" treatment as
  // checkTwoFactorRequired in access.js.
  if (orgData.default_repository_permission === undefined) {
    return [{
      resourceId: org,
      status: "not_applicable",
      message: `${org}'s default repository permission is not visible with this App's current permissions`,
      evidencePayload: { org },
    }];
  }

  const restricted = orgData.default_repository_permission !== "admin";
  return [{
    resourceId: org,
    status: restricted ? "pass" : "fail",
    message: restricted
      ? `${org}'s default repository permission is "${orgData.default_repository_permission}", not admin`
      : `${org}'s default repository permission is admin, granting every new member admin access to every repository by default`,
    evidencePayload: { org, defaultRepositoryPermission: orgData.default_repository_permission },
  }];
}

export async function checkOwnersCountMinimized(octokit, org) {
  const owners = await octokit.paginate(octokit.rest.orgs.listMembers, { org, role: "admin" });
  const count = owners.length;
  const withinThreshold = count <= MAX_ORGANIZATION_OWNERS;
  return [{
    resourceId: org,
    status: withinThreshold ? "pass" : "fail",
    message: withinThreshold
      ? `${org} has ${count} organization owner(s), within the threshold of ${MAX_ORGANIZATION_OWNERS}`
      : `${org} has ${count} organization owners, exceeding the threshold of ${MAX_ORGANIZATION_OWNERS}`,
    evidencePayload: { org, ownerCount: count, threshold: MAX_ORGANIZATION_OWNERS },
  }];
}

export const orgManagementTests = [
  { key: "github.org.default_repository_permission_restricted", title: "Default repository permission is not admin", failTitle: "Default repository permission is admin", severityDefault: "medium", isoReferences: ["A.9.2.3"], dpdpaControlAreas: ["Access Control & Least Privilege"], run: (clients) => checkDefaultRepositoryPermissionRestricted(clients.octokit, clients.org) },
  { key: "github.org.owners_count_minimized", title: "Organization owner role is limited to necessary personnel", failTitle: "Organization owner role is granted to more than the necessary personnel", severityDefault: "medium", isoReferences: ["A.9.2.3"], dpdpaControlAreas: ["Privileged Access Management"], run: (clients) => checkOwnersCountMinimized(clients.octokit, clients.org) },
];
