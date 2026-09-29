import { buildEvidencePayload } from "../../shared/evidencePayload.js";

async function checkMfaEnforced(clients) {
  const data = await clients.directory.get(`/api/v1/orgs/${clients.orgId}/security`);
  const enforced = data?.mfa_enabled === true || data?.mfa_required === true;
  return [
    {
      resourceId: clients.orgId,
      status: enforced ? "pass" : "fail",
      message: enforced
        ? "Org-wide MFA is enforced in Zoho Directory"
        : "Org-wide MFA is not enforced in Zoho Directory",
      evidencePayload: buildEvidencePayload({
        resourceType: "zoho_org",
        resourceId: clients.orgId,
        resourceName: clients.orgId,
        region: null,
        details: { mfa_enabled: data?.mfa_enabled ?? null, mfa_required: data?.mfa_required ?? null },
      }),
    },
  ];
}

async function checkSsoEnforced(clients) {
  const data = await clients.directory.get(`/api/v1/orgs/${clients.orgId}/sso`);
  const enforced = data?.sso_enabled === true && data?.sso_required === true;
  return [
    {
      resourceId: clients.orgId,
      status: enforced ? "pass" : "fail",
      message: enforced
        ? "SSO is configured and enforced as the required sign-in method"
        : "SSO is not enforced as the required sign-in method",
      evidencePayload: buildEvidencePayload({
        resourceType: "zoho_org",
        resourceId: clients.orgId,
        resourceName: clients.orgId,
        region: null,
        details: { sso_enabled: data?.sso_enabled ?? null, sso_required: data?.sso_required ?? null },
      }),
    },
  ];
}

async function checkInactiveUserReview(clients) {
  const data = await clients.directory.get(`/api/v1/orgs/${clients.orgId}/users?status=active`);
  const users = data?.users || data?.data || [];
  const ninetyDaysAgo = Date.now() - 90 * 24 * 60 * 60 * 1000;
  const results = [];
  for (const user of users) {
    const lastLogin = user.last_login_time || user.last_sign_in_time;
    const inactive = lastLogin ? new Date(lastLogin).getTime() < ninetyDaysAgo : false;
    if (inactive) {
      results.push({
        resourceId: user.user_id || user.email,
        status: "fail",
        message: `User ${user.email || user.user_id} has not signed in for 90+ days but is still active`,
        evidencePayload: buildEvidencePayload({
          resourceType: "zoho_user",
          resourceId: user.user_id || user.email,
          resourceName: user.email || user.display_name,
          region: null,
          details: { last_login_time: lastLogin, status: user.status },
        }),
      });
    }
  }
  if (results.length === 0) {
    results.push({
      resourceId: clients.orgId,
      status: "pass",
      message: "No active Directory users found with 90+ days of inactivity",
      evidencePayload: buildEvidencePayload({ resourceType: "zoho_org", resourceId: clients.orgId, region: null, details: { inactive_user_count: 0 } }),
    });
  }
  return results;
}

export const directoryTests = [
  {
    key: "zoho.directory.mfa_enforced",
    title: "Multi-factor authentication is enforced org-wide",
    failTitle: "Org-wide MFA is not enforced in Zoho Directory",
    severityDefault: "critical",
    isoReferences: ["A.9.4.2"],
    dpdpaControlAreas: ["MFA for Sensitive Systems"],
    run: (clients) => checkMfaEnforced(clients),
  },
  {
    key: "zoho.directory.sso_enforced",
    title: "Single sign-on is enforced for all applications",
    failTitle: "SSO is not enforced as the required sign-in method",
    severityDefault: "high",
    isoReferences: ["A.9.2.1"],
    dpdpaControlAreas: ["Access Control & Least Privilege"],
    run: (clients) => checkSsoEnforced(clients),
  },
  {
    key: "zoho.directory.inactive_user_review",
    title: "Inactive or terminated users are deprovisioned",
    failTitle: "User has not signed in for 90+ days but is still active",
    severityDefault: "medium",
    isoReferences: ["A.9.2.6"],
    dpdpaControlAreas: ["Access Control & Least Privilege"],
    run: (clients) => checkInactiveUserReview(clients),
  },
];
