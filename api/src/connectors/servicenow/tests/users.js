import { buildEvidencePayload } from "../../shared/evidencePayload.js";

const REVIEW_DAYS = 365;

function daysSince(value) {
  const t = Date.parse(value);
  return Number.isNaN(t) ? null : (Date.now() - t) / 86400000;
}

function isTrue(v) {
  const s = String(v ?? "").toLowerCase();
  return s === "true" || s === "1" || s === "yes";
}

function userPayload(user, details) {
  return buildEvidencePayload({
    resourceType: "servicenow_user",
    resourceId: String(user?.sys_id ?? user?.user_name ?? "unknown"),
    resourceName: user?.user_name ? String(user.user_name) : String(user?.name ?? user?.sys_id ?? "unknown"),
    region: null,
    details,
  });
}

// Inactive (active=false) users must not still hold an admin-tier role. When a
// user is deactivated their sys_user_has_role rows are supposed to be removed;
// a stale grant is a dormant privileged account.
async function checkNoInactivePrivileged(clients) {
  const [users, grants] = await Promise.all([clients.listUsers(), clients.listPrivilegedGrants()]);
  if (grants.length === 0) {
    return [
      {
        resourceId: "privileged-grants",
        status: "not_applicable",
        message: "No admin-tier role assignments exist to evaluate",
        evidencePayload: userPayload(null, { privilegedRoles: clients.PRIVILEGED_ROLES }),
      },
    ];
  }

  const userById = new Map(users.map((u) => [String(u.sys_id), u]));
  const rows = [];
  for (const g of grants) {
    const userId = clients.valueOf(g.user);
    const roleName = clients.displayOf(g.role);
    const user = userById.get(String(userId));
    // A grant whose user we can't resolve, or a user with no active flag we can
    // read, is not a confident fail.
    if (!user) continue;
    if (isTrue(user.active)) continue;
    rows.push({
      resourceId: String(user.sys_id),
      status: "fail",
      message: `Inactive user "${user.user_name ?? user.sys_id}" still holds the "${roleName}" role`,
      evidencePayload: userPayload(user, {
        active: false,
        role: roleName,
        lockedOut: isTrue(user.locked_out),
      }),
    });
  }

  if (rows.length === 0) {
    return [
      {
        resourceId: "privileged-grants",
        status: "pass",
        message: `All ${grants.length} admin-tier role assignment(s) belong to active users`,
        evidencePayload: userPayload(null, {
          privilegedRoles: clients.PRIVILEGED_ROLES,
          grantsChecked: grants.length,
        }),
      },
    ];
  }
  return rows;
}

// Multi-factor authentication must be enforced instance-wide. Prism can only
// read instance properties over the Table API, so this evidences the MFA
// enforcement property is present and enabled. If MFA is instead enforced via
// an IdP / SSO or user-criteria rules that don't set this property, the check
// fails with guidance to attest the control manually (same posture as
// onetrust's dpia_process_operating).
async function checkMfaEnforced(clients) {
  const props = {
    enabled: await clients.getProperty("glide.authenticate.multifactor.enabled"),
    legacy: await clients.getProperty("glide.authenticate.multifactor"),
    required: await clients.getProperty("glide.authenticate.multifactor.mandatory"),
  };
  const anyTrue = Object.values(props).some((v) => v != null && isTrue(v));
  const anySet = Object.values(props).some((v) => v != null);

  const payload = buildEvidencePayload({
    resourceType: "servicenow_instance_property",
    resourceId: "mfa-enforcement",
    resourceName: "Multi-factor authentication enforcement",
    region: null,
    details: { properties: props },
  });

  if (anyTrue) {
    return [{ resourceId: "mfa-enforcement", status: "pass", message: "An instance property enforces multi-factor authentication", evidencePayload: payload }];
  }
  if (anySet) {
    return [
      {
        resourceId: "mfa-enforcement",
        status: "fail",
        message: "The multi-factor authentication enforcement property is present but not enabled",
        evidencePayload: payload,
      },
    ];
  }
  return [
    {
      resourceId: "mfa-enforcement",
      status: "fail",
      message:
        "No instance property evidences instance-wide MFA enforcement. If MFA is enforced via SSO/IdP or user-criteria rules, record this control as met manually.",
      evidencePayload: payload,
    },
  ];
}

// The number of active users holding the full `admin` role must stay within
// policy — a large admin population is a least-privilege failure.
async function checkAdminCountWithinPolicy(clients) {
  const [users, grants] = await Promise.all([clients.listUsers(), clients.listPrivilegedGrants()]);
  const threshold = clients.THRESHOLDS.ADMIN_COUNT_THRESHOLD;
  const userById = new Map(users.map((u) => [String(u.sys_id), u]));

  const adminUserIds = new Set();
  for (const g of grants) {
    if (String(clients.displayOf(g.role)).toLowerCase() !== "admin") continue;
    const user = userById.get(String(clients.valueOf(g.user)));
    if (user && isTrue(user.active)) adminUserIds.add(String(user.sys_id));
  }

  const count = adminUserIds.size;
  const payload = buildEvidencePayload({
    resourceType: "servicenow_role",
    resourceId: "admin",
    resourceName: "admin role",
    region: null,
    details: { activeAdminUsers: count, threshold },
  });

  return [
    {
      resourceId: "admin",
      status: count > threshold ? "fail" : "pass",
      message:
        count > threshold
          ? `${count} active users hold the admin role, above the policy threshold of ${threshold}`
          : `${count} active user(s) hold the admin role, within the policy threshold of ${threshold}`,
      evidencePayload: payload,
    },
  ];
}

// Groups that look privileged (an "admin" token in the name/description, or a
// mapped role) must not accumulate an unbounded membership.
async function checkPrivilegedGroupsReviewed(clients) {
  const [groups, members] = await Promise.all([clients.listGroups(), clients.listGroupMembers()]);
  const active = groups.filter((g) => {
    const flag = clients.displayOf(g.active);
    return flag == null || isTrue(flag);
  });

  const privileged = active.filter((g) => {
    const name = String(clients.displayOf(g.name) ?? "").toLowerCase();
    const desc = String(clients.displayOf(g.description) ?? "").toLowerCase();
    const roles = String(clients.displayOf(g.roles) ?? "").toLowerCase();
    return (
      /admin|security|privileg/.test(name) ||
      /admin|privileg/.test(desc) ||
      /\badmin\b|security_admin|user_admin/.test(roles)
    );
  });

  if (privileged.length === 0) {
    return [
      {
        resourceId: "groups",
        status: "not_applicable",
        message: groups.length === 0 ? "No groups exist to evaluate" : "No group is flagged as privileged by name, description or mapped role",
        evidencePayload: buildEvidencePayload({ resourceType: "servicenow_group", resourceId: "groups", resourceName: "Groups", region: null, details: { groups: groups.length } }),
      },
    ];
  }

  const threshold = clients.THRESHOLDS.PRIVILEGED_GROUP_MEMBER_THRESHOLD;
  const countByGroup = new Map();
  for (const m of members) {
    const gid = String(clients.valueOf(m.group));
    countByGroup.set(gid, (countByGroup.get(gid) || 0) + 1);
  }

  const rows = [];
  for (const g of privileged) {
    const gid = String(clients.valueOf(g.sys_id) ?? clients.displayOf(g.sys_id));
    const memberCount = countByGroup.get(gid) || 0;
    const stale = daysSince(clients.displayOf(g.sys_updated_on));
    const overThreshold = memberCount > threshold;
    const notReviewed = stale != null && stale > REVIEW_DAYS;
    if (overThreshold || notReviewed) {
      rows.push({
        resourceId: gid,
        status: "fail",
        message: `Privileged group "${clients.displayOf(g.name)}" has ${memberCount} member(s)${
          overThreshold ? ` (above the threshold of ${threshold})` : ""
        }${notReviewed ? ` and has not been updated in ${Math.round(stale)} days` : ""}`,
        evidencePayload: buildEvidencePayload({
          resourceType: "servicenow_group",
          resourceId: gid,
          resourceName: String(clients.displayOf(g.name) ?? gid),
          region: null,
          details: { memberCount, threshold, daysSinceUpdate: stale == null ? null : Math.round(stale) },
        }),
      });
    }
  }

  if (rows.length === 0) {
    return [
      {
        resourceId: "groups",
        status: "pass",
        message: `All ${privileged.length} privileged group(s) have a membership within the threshold of ${threshold}`,
        evidencePayload: buildEvidencePayload({ resourceType: "servicenow_group", resourceId: "groups", resourceName: "Privileged groups", region: null, details: { privilegedGroups: privileged.length, threshold } }),
      },
    ];
  }
  return rows;
}

export const userTests = [
  {
    key: "servicenow.user.no_inactive_privileged",
    title: "No inactive users retain a privileged role",
    failTitle: "Inactive user still holds an admin-tier role",
    severityDefault: "high",
    isoReferences: ["A.9.2.1"],
    dpdpaControlAreas: ["Access Control"],
    run: (clients) => checkNoInactivePrivileged(clients),
  },
  {
    key: "servicenow.user.mfa_enforced",
    title: "Multi-factor authentication is enforced instance-wide",
    failTitle: "Instance-wide MFA enforcement could not be evidenced",
    severityDefault: "critical",
    isoReferences: ["A.9.4.2"],
    dpdpaControlAreas: ["Access Control"],
    run: (clients) => checkMfaEnforced(clients),
  },
  {
    key: "servicenow.role.admin_count_within_policy",
    title: "Number of users with the admin role is within policy",
    failTitle: "The number of admin-role users exceeds the policy threshold",
    severityDefault: "medium",
    isoReferences: ["A.9.2.3"],
    dpdpaControlAreas: ["Access Control"],
    run: (clients) => checkAdminCountWithinPolicy(clients),
  },
  {
    key: "servicenow.group.privileged_groups_reviewed",
    title: "Privileged groups have a bounded, reviewed membership",
    failTitle: "A privileged group has an oversized or unreviewed membership",
    severityDefault: "medium",
    isoReferences: ["A.9.2.5"],
    dpdpaControlAreas: ["Access Control"],
    run: (clients) => checkPrivilegedGroupsReviewed(clients),
  },
];
