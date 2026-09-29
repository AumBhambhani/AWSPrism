import { paginate } from "./pagination.js";

const MAX_EXPECTED_SUPER_ADMINS = 5;

export async function checkSuperAdminRoleReviewed(directory, customerId) {
  const users = await paginate(
    (params) => directory.users.list(params),
    { customer: customerId, maxResults: 500, projection: "basic" },
    "users"
  );
  const admins = users.filter((u) => !u.suspended && (u.isAdmin || u.isDelegatedAdmin));
  const pass = admins.length > 0 && admins.length <= MAX_EXPECTED_SUPER_ADMINS;
  return [{
    resourceId: "domain",
    status: admins.length === 0 ? "not_applicable" : pass ? "pass" : "fail",
    message: admins.length === 0
      ? "No users hold admin or delegated admin privileges"
      : pass
        ? `${admins.length} user(s) hold admin/delegated admin privileges, within the expected maximum of ${MAX_EXPECTED_SUPER_ADMINS}`
        : `${admins.length} user(s) hold admin/delegated admin privileges, exceeding the expected maximum of ${MAX_EXPECTED_SUPER_ADMINS}`,
    evidencePayload: {
      adminCount: admins.length,
      maxExpected: MAX_EXPECTED_SUPER_ADMINS,
      admins: admins.map((u) => ({ email: u.primaryEmail, isAdmin: Boolean(u.isAdmin), isDelegatedAdmin: Boolean(u.isDelegatedAdmin) })),
    },
  }];
}

export const adminTests = [
  {
    key: "google_workspace.admin.super_admin_role_reviewed",
    title: "Super admin role is assigned to a minimal, reviewed set of users",
    failTitle: "Too many users hold admin or delegated admin privileges",
    severityDefault: "high",
    isoReferences: ["A.9.2.3"],
    dpdpaControlAreas: ["Privileged Access Management"],
    run: (clients) => checkSuperAdminRoleReviewed(clients.directory, clients.customerId),
  },
];
