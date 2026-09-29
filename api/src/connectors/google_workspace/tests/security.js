import { paginate } from "./pagination.js";

async function listActiveUsers(directory, customerId) {
  const users = await paginate(
    (params) => directory.users.list(params),
    { customer: customerId, maxResults: 500, projection: "basic" },
    "users"
  );
  return users.filter((u) => !u.suspended);
}

export async function checkTwoStepVerificationEnforced(directory, customerId) {
  const users = await listActiveUsers(directory, customerId);
  if (users.length === 0) {
    return [{ resourceId: "domain", status: "not_applicable", message: "No active users found", evidencePayload: {} }];
  }
  return users.map((user) => ({
    resourceId: user.primaryEmail,
    status: user.isEnforcedIn2Sv ? "pass" : "fail",
    message: user.isEnforcedIn2Sv
      ? `${user.primaryEmail} has 2-Step Verification enforced`
      : `${user.primaryEmail} does not have 2-Step Verification enforced`,
    evidencePayload: { email: user.primaryEmail, isEnforcedIn2Sv: Boolean(user.isEnforcedIn2Sv), isEnrolledIn2Sv: Boolean(user.isEnrolledIn2Sv) },
  }));
}

export const securityTests = [
  {
    key: "google_workspace.security.two_step_verification_enforced",
    title: "2-Step Verification is enforced for all users",
    failTitle: "User does not have 2-Step Verification enforced",
    severityDefault: "critical",
    isoReferences: ["A.9.4.2"],
    dpdpaControlAreas: ["MFA for Sensitive Systems"],
    run: (clients) => checkTwoStepVerificationEnforced(clients.directory, clients.customerId),
  },
];
