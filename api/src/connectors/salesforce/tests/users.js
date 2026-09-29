import { buildEvidencePayload } from "../../shared/evidencePayload.js";

// Profile names that denote full org administration. Salesforce ships exactly
// one ("System Administrator"); customers occasionally clone it under a
// different name, so match on the ModifyAllData permission too where the
// permission-set data is available.
const ADMIN_PROFILE_NAMES = ["system administrator"];

function isActive(user) {
  return user?.IsActive === true || String(user?.IsActive).toLowerCase() === "true";
}

function isAdminProfileName(name) {
  return ADMIN_PROFILE_NAMES.includes(String(name || "").trim().toLowerCase());
}

// ---------------------------------------------------------------------------
// salesforce.user.mfa_enforced
// ---------------------------------------------------------------------------
// MFA at UI login must be required for every user, not just high-assurance
// sessions. The org-wide switch lives on SecuritySettings.sessionSettings
// (`hasMfaLoginPolicy` / "Require multi-factor authentication (MFA) for all
// direct UI logins"). Field names on the SecuritySettings metadata blob have
// shifted across releases, so several candidate paths are probed and the check
// reports not_applicable rather than guessing when none resolve.
function readMfaPolicy(settingsRows) {
  for (const row of settingsRows || []) {
    const md = row?.Metadata ?? row?.metadata ?? row;
    if (!md || typeof md !== "object") continue;
    const session = md.sessionSettings ?? md.SessionSettings ?? md;
    const candidates = [
      session?.hasMfaLoginPolicy,
      session?.requireMfaForUiLogins,
      session?.enforceMfaForUiLogins,
      md?.canConfirmIdentityBySmsOnly === false ? undefined : undefined,
    ];
    for (const c of candidates) {
      if (typeof c === "boolean") return c;
    }
  }
  return null;
}

async function checkMfaEnforced(clients) {
  let settings;
  try {
    settings = await clients.getSecuritySettings();
  } catch {
    settings = null;
  }

  const policy = readMfaPolicy(settings);
  const payload = buildEvidencePayload({
    resourceType: "salesforce_security_settings",
    resourceId: "session-settings",
    resourceName: "Session Settings — MFA policy",
    region: null,
    details: { mfaLoginPolicy: policy, settingsReadable: Array.isArray(settings) && settings.length > 0 },
  });

  if (policy === null) {
    return [
      {
        resourceId: "session-settings",
        status: "not_applicable",
        message:
          "Could not read the org's MFA session policy from SecuritySettings — grant the integration user " +
          '"View Setup and Configuration" and confirm the Tooling API exposes SecuritySettings on this org release.',
        evidencePayload: payload,
      },
    ];
  }

  return [
    {
      resourceId: "session-settings",
      status: policy ? "pass" : "fail",
      message: policy
        ? "MFA is required for all direct UI logins (Session Settings > Require multi-factor authentication)"
        : 'The org does not require MFA for all UI logins — enable "Require multi-factor authentication (MFA) for all direct UI logins" under Setup > Session Settings',
      evidencePayload: payload,
    },
  ];
}

// ---------------------------------------------------------------------------
// salesforce.user.no_inactive_high_privilege
// ---------------------------------------------------------------------------
// A deactivated user must not still carry an admin-tier profile or an admin-tier
// permission set — a reactivated account would immediately regain full rights.
async function checkNoInactiveHighPrivilege(clients) {
  const users = await clients.listUsers();
  const inactive = users.filter((u) => !isActive(u));

  if (inactive.length === 0) {
    return [
      {
        resourceId: "users",
        status: "pass",
        message: "No inactive standard users are present",
        evidencePayload: buildEvidencePayload({
          resourceType: "salesforce_user",
          resourceId: "users",
          resourceName: "Inactive users",
          region: null,
          details: { totalUsers: users.length, inactiveUsers: 0 },
        }),
      },
    ];
  }

  // Admin-tier permission sets granted to each inactive user (both profile-owned
  // and standalone), from the permission-set assignment data when readable.
  let assignmentsByAssignee = new Map();
  try {
    const assignments = await clients.listPermissionSetAssignments();
    for (const a of assignments) {
      const ps = a.PermissionSet || {};
      const isAdminTier =
        ps.PermissionsModifyAllData === true ||
        ps.PermissionsManageUsers === true ||
        isAdminProfileName(ps.Profile?.Name);
      if (!isAdminTier) continue;
      const list = assignmentsByAssignee.get(a.AssigneeId) || [];
      list.push(ps.IsOwnedByProfile ? `profile:${ps.Profile?.Name || ps.ProfileId}` : `permset:${ps.Name}`);
      assignmentsByAssignee.set(a.AssigneeId, list);
    }
  } catch {
    assignmentsByAssignee = null; // fall back to profile-name-only evaluation
  }

  const offenders = inactive.filter((u) => {
    if (isAdminProfileName(u.Profile?.Name)) return true;
    if (assignmentsByAssignee && (assignmentsByAssignee.get(u.Id) || []).length > 0) return true;
    return false;
  });

  if (offenders.length === 0) {
    return [
      {
        resourceId: "users",
        status: "pass",
        message: `All ${inactive.length} inactive user(s) are on a non-privileged profile with no admin-tier permission sets`,
        evidencePayload: buildEvidencePayload({
          resourceType: "salesforce_user",
          resourceId: "users",
          resourceName: "Inactive users",
          region: null,
          details: { totalUsers: users.length, inactiveUsers: inactive.length, privilegedInactive: 0 },
        }),
      },
    ];
  }

  return offenders.map((u) => ({
    resourceId: String(u.Id),
    status: "fail",
    message:
      `Inactive user "${u.Username}" still holds ` +
      (isAdminProfileName(u.Profile?.Name)
        ? `the "${u.Profile?.Name}" profile`
        : `admin-tier permission set(s): ${(assignmentsByAssignee?.get(u.Id) || []).join(", ")}`) +
      " — move deactivated users to a minimal-access profile and remove privileged permission sets",
    evidencePayload: buildEvidencePayload({
      resourceType: "salesforce_user",
      resourceId: String(u.Id),
      resourceName: u.Username,
      region: null,
      details: {
        isActive: false,
        profile: u.Profile?.Name ?? null,
        adminPermissionSets: assignmentsByAssignee?.get(u.Id) ?? null,
      },
    }),
  }));
}

export const userTests = [
  {
    key: "salesforce.user.mfa_enforced",
    title: "Multi-factor authentication is enforced for all users",
    failTitle: "MFA is not enforced for all direct UI logins",
    severityDefault: "critical",
    isoReferences: ["A.9.4.2"],
    dpdpaControlAreas: ["Access Control"],
    run: (clients) => checkMfaEnforced(clients),
  },
  {
    key: "salesforce.user.no_inactive_high_privilege",
    title: "No inactive users retain a high-privilege profile or permission set",
    failTitle: "An inactive user still holds an admin-tier profile or permission set",
    severityDefault: "high",
    isoReferences: ["A.9.2.1"],
    dpdpaControlAreas: ["Access Control"],
    run: (clients) => checkNoInactiveHighPrivilege(clients),
  },
];
