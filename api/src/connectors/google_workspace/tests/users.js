import { paginate } from "./pagination.js";

const INACTIVITY_THRESHOLD_DAYS = 90;
// Google's documented sentinel for "this user has never signed in".
const NEVER_LOGGED_IN_TIMESTAMP = "1970-01-01T00:00:00.000Z";

function daysSince(isoTimestamp) {
  return (Date.now() - new Date(isoTimestamp).getTime()) / (1000 * 60 * 60 * 24);
}

export async function checkInactiveAccountsReviewed(directory, customerId) {
  const users = await paginate(
    (params) => directory.users.list(params),
    { customer: customerId, maxResults: 500, projection: "basic" },
    "users"
  );
  if (users.length === 0) {
    return [{ resourceId: "domain", status: "not_applicable", message: "No users found", evidencePayload: {} }];
  }

  const results = [];
  for (const user of users) {
    if (user.suspended) {
      results.push({
        resourceId: user.primaryEmail,
        status: "fail",
        message: `${user.primaryEmail} is suspended but not deleted, and retains a Workspace license/account`,
        evidencePayload: { email: user.primaryEmail, suspended: true },
      });
      continue;
    }
    const neverLoggedIn = !user.lastLoginTime || user.lastLoginTime === NEVER_LOGGED_IN_TIMESTAMP;
    const inactiveDays = neverLoggedIn ? null : daysSince(user.lastLoginTime);
    const stale = neverLoggedIn || inactiveDays > INACTIVITY_THRESHOLD_DAYS;
    if (stale) {
      results.push({
        resourceId: user.primaryEmail,
        status: "fail",
        message: neverLoggedIn
          ? `${user.primaryEmail} has never signed in`
          : `${user.primaryEmail} has not signed in for ${Math.floor(inactiveDays)} days (threshold: ${INACTIVITY_THRESHOLD_DAYS})`,
        evidencePayload: { email: user.primaryEmail, lastLoginTime: user.lastLoginTime, neverLoggedIn },
      });
    }
  }

  if (results.length === 0) {
    return [{ resourceId: "domain", status: "pass", message: `All ${users.length} user(s) are active and signed in within ${INACTIVITY_THRESHOLD_DAYS} days`, evidencePayload: { userCount: users.length } }];
  }
  return results;
}

export const usersTests = [
  {
    key: "google_workspace.users.inactive_accounts_reviewed",
    title: "Suspended or long-inactive user accounts are reviewed",
    failTitle: "Suspended or long-inactive user account is retained",
    severityDefault: "medium",
    isoReferences: ["A.9.2.6"],
    dpdpaControlAreas: ["Access Control & Least Privilege"],
    run: (clients) => checkInactiveAccountsReviewed(clients.directory, clients.customerId),
  },
];
