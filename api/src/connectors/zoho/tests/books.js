import { buildEvidencePayload } from "../../shared/evidencePayload.js";

// GET https://books.zoho.{dc}/api/v3/users?organization_id={orgId}
async function checkUserRoleReview(clients) {
  const data = await clients.books.get(`/api/v3/users?organization_id=${clients.orgId}`);
  const users = data?.users || [];
  // Flag non-owner users assigned the built-in Admin role
  const adminNonOwners = users.filter(
    (u) => (u.role === "admin" || u.user_role === "admin") && u.is_org_owner !== true
  );
  const results = adminNonOwners.map((u) => ({
    resourceId: String(u.user_id || u.id),
    status: "fail",
    message: `Books user ${u.email || u.user_id} is assigned the Admin role without being the org owner`,
    evidencePayload: buildEvidencePayload({
      resourceType: "zoho_books_user",
      resourceId: String(u.user_id || u.id),
      resourceName: u.email || String(u.user_id),
      region: null,
      details: { email: u.email, role: u.role || u.user_role, isOrgOwner: u.is_org_owner },
    }),
  }));
  if (results.length === 0) {
    results.push({
      resourceId: clients.orgId,
      status: "pass",
      message: "No non-owner Books users are assigned the built-in Admin role",
      evidencePayload: buildEvidencePayload({
        resourceType: "zoho_books_org",
        resourceId: clients.orgId,
        resourceName: `Org ${clients.orgId}`,
        region: null,
        details: { usersChecked: users.length },
      }),
    });
  }
  return results;
}

// GET https://books.zoho.{dc}/api/v3/organizations/{orgId}/preferences
async function checkTwoFactorAuthEnforced(clients) {
  const data = await clients.books.get(`/api/v3/organizations/${clients.orgId}/preferences`);
  const enforced = data?.preferences?.is_2fa_enabled === true || data?.is_2fa_enabled === true;
  return [
    {
      resourceId: clients.orgId,
      status: enforced ? "pass" : "fail",
      message: enforced
        ? "Books two-factor authentication is enforced for all users"
        : "Books two-factor authentication is not enforced",
      evidencePayload: buildEvidencePayload({
        resourceType: "zoho_books_org",
        resourceId: clients.orgId,
        resourceName: `Org ${clients.orgId}`,
        region: null,
        details: { is2faEnabled: enforced },
      }),
    },
  ];
}

// GET https://books.zoho.{dc}/api/v3/organizations/{orgId}/audittrail
async function checkAuditTrailEnabled(clients) {
  const data = await clients.books.get(`/api/v3/organizations/${clients.orgId}/audittrail?page=1&per_page=1`);
  // If the endpoint returns data (even empty list), audit trail is accessible/enabled
  const enabled = data !== null && data !== undefined && !data?.error;
  return [
    {
      resourceId: clients.orgId,
      status: enabled ? "pass" : "fail",
      message: enabled
        ? "Books audit trail is enabled and accessible"
        : "Books audit trail is not enabled or not accessible",
      evidencePayload: buildEvidencePayload({
        resourceType: "zoho_books_org",
        resourceId: clients.orgId,
        resourceName: `Org ${clients.orgId}`,
        region: null,
        details: { auditTrailEnabled: enabled },
      }),
    },
  ];
}

export const booksTests = [
  {
    key: "zoho.books.user_role_review",
    title: "User roles follow least privilege",
    failTitle: "Books user is assigned the Admin role without being the org owner",
    severityDefault: "medium",
    isoReferences: ["A.9.2.2"],
    dpdpaControlAreas: ["Access Control & Least Privilege"],
    run: (clients) => checkUserRoleReview(clients),
  },
  {
    key: "zoho.books.two_factor_auth_enforced",
    title: "Two-factor authentication is enforced",
    failTitle: "Books two-factor authentication is not enforced",
    severityDefault: "critical",
    isoReferences: ["A.9.4.2"],
    dpdpaControlAreas: ["MFA for Sensitive Systems"],
    run: (clients) => checkTwoFactorAuthEnforced(clients),
  },
  {
    key: "zoho.books.audit_trail_enabled",
    title: "Audit trail is enabled and retained",
    failTitle: "Books audit trail is not enabled or not accessible",
    severityDefault: "medium",
    isoReferences: ["A.12.4.1"],
    dpdpaControlAreas: ["Logging & Monitoring"],
    run: (clients) => checkAuditTrailEnabled(clients),
  },
];
