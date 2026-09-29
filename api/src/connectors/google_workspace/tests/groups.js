import { paginate } from "./pagination.js";

// Google Groups has no built-in "privileged" flag (unlike Entra ID's
// isAssignableToRole) — this heuristic mirrors what admin teams actually name
// their sensitive groups. Adjust/extend if your org uses different naming.
const PRIVILEGED_NAME_PATTERN = /admin|security|sudo|root|superuser|it-?ops|helpdesk/i;

function isPrivileged(group) {
  return PRIVILEGED_NAME_PATTERN.test(group.name || "") || PRIVILEGED_NAME_PATTERN.test(group.email || "");
}

async function listGroupMembers(directory, groupKey) {
  try {
    return await paginate(
      (params) => directory.members.list(params),
      { groupKey, maxResults: 200 },
      "members"
    );
  } catch {
    // A group with zero members returns 404 on some accounts rather than an
    // empty list — treat either shape as "no members".
    return [];
  }
}

export async function checkPrivilegedGroupMembershipReviewed(directory, customerId) {
  const groups = await paginate(
    (params) => directory.groups.list(params),
    { customer: customerId, maxResults: 200 },
    "groups"
  );
  const privilegedGroups = groups.filter(isPrivileged);

  if (privilegedGroups.length === 0) {
    return [{ resourceId: "domain", status: "not_applicable", message: "No groups matched the privileged-group naming heuristic", evidencePayload: { totalGroups: groups.length } }];
  }

  const results = [];
  for (const group of privilegedGroups) {
    const members = await listGroupMembers(directory, group.email);
    const hasOwner = members.some((m) => m.role === "OWNER");
    results.push({
      resourceId: group.email,
      status: hasOwner ? "pass" : "fail",
      message: hasOwner
        ? `${group.email} has at least one OWNER-role member`
        : `${group.email} appears privileged but has no OWNER-role member (orphaned group risk)`,
      evidencePayload: { email: group.email, name: group.name, memberCount: members.length, roles: members.map((m) => m.role) },
    });
  }
  return results;
}

export const groupsTests = [
  {
    key: "google_workspace.groups.privileged_group_membership_reviewed",
    title: "Privileged groups have at least one owner",
    failTitle: "Privileged group has no owner-role member",
    severityDefault: "medium",
    isoReferences: ["A.9.2.2"],
    dpdpaControlAreas: ["Privileged Access Management"],
    run: (clients) => checkPrivilegedGroupMembershipReviewed(clients.directory, clients.customerId),
  },
];
