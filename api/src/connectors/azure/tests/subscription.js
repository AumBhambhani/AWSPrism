// This is Azure's globally stable built-in role definition GUID for "Owner" —
// identical across every tenant and subscription, so it's safe to hardcode
// rather than resolve via an extra roleDefinitions lookup.
const OWNER_ROLE_DEFINITION_ID_SUFFIX = "/roleDefinitions/8e3af657-a8ff-443c-a75c-2fe8c4bcb635";
const MAX_RECOMMENDED_OWNERS = 2;

export async function checkNoClassicAdministrators(authorization) {
  const admins = [];
  for await (const admin of authorization.classicAdministrators.list()) admins.push(admin);
  if (admins.length === 0) {
    return [{ resourceId: "subscription", status: "pass", message: "No classic (co-)administrators are assigned", evidencePayload: {} }];
  }
  return [{
    resourceId: "subscription",
    status: "fail",
    message: `${admins.length} classic administrator(s) are still assigned: ${admins.map((a) => a.emailAddress).join(", ")}`,
    evidencePayload: { administrators: admins.map((a) => ({ email: a.emailAddress, role: a.role })) },
  }];
}

export async function checkLimitedOwnerAssignments(authorization, subscriptionId) {
  const owners = new Set();
  for await (const assignment of authorization.roleAssignments.listForScope(`/subscriptions/${subscriptionId}`)) {
    if (assignment.roleDefinitionId?.endsWith(OWNER_ROLE_DEFINITION_ID_SUFFIX)) {
      owners.add(assignment.principalId);
    }
  }
  const pass = owners.size <= MAX_RECOMMENDED_OWNERS;
  return [{
    resourceId: "subscription",
    status: pass ? "pass" : "fail",
    message: pass
      ? `${owners.size} principal(s) hold the Owner role at subscription scope`
      : `${owners.size} principals hold the Owner role at subscription scope, exceeding the recommended maximum of ${MAX_RECOMMENDED_OWNERS}`,
    evidencePayload: { ownerCount: owners.size, maxRecommended: MAX_RECOMMENDED_OWNERS },
  }];
}

export const subscriptionTests = [
  { key: "azure.subscription.no_classic_administrators", title: "Subscription has no classic (co-)administrators", failTitle: "Subscription has classic (co-)administrators still assigned", severityDefault: "high", isoReferences: ["A.9.2.3"], dpdpaControlAreas: ["Access Control & Least Privilege"], run: (clients) => checkNoClassicAdministrators(clients.authorization) },
  { key: "azure.subscription.limited_owner_assignments", title: "Subscription-scope Owner role assignments are limited", failTitle: "Too many principals hold the Owner role at subscription scope", severityDefault: "medium", isoReferences: ["A.9.1.2"], run: (clients) => checkLimitedOwnerAssignments(clients.authorization, clients.subscriptionId) },
];
