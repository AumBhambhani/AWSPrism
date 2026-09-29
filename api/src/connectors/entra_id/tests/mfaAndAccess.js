import { buildEvidencePayload } from "../../shared/evidencePayload.js";

const GRAPH_BASE = "https://graph.microsoft.com/v1.0";

// Follow @odata.nextLink until exhausted, returning all items.
export async function graphPaginate(getToken, path) {
  const items = [];
  let url = `${GRAPH_BASE}${path}`;
  while (url) {
    const token = await getToken();
    const res = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
    if (!res.ok) {
      const text = await res.text();
      throw new Error(`Graph request to ${url} failed: ${res.status} ${text}`);
    }
    const body = await res.json();
    if (Array.isArray(body.value)) items.push(...body.value);
    url = body["@odata.nextLink"] || null;
  }
  return items;
}

// Single GET returning the parsed response body.
export async function graphGet(getToken, path, version = "v1.0") {
  const base = `https://graph.microsoft.com/${version}`;
  const token = await getToken();
  const res = await fetch(`${base}${path}`, { headers: { Authorization: `Bearer ${token}` } });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Graph request to ${base}${path} failed: ${res.status} ${text}`);
  }
  return res.json();
}

// ──────────────────────────────────────────────────────────────────────────────
// entra_id.mfa.conditional_access_enforced
// Checks at least one enabled CA policy requires MFA for all users, OR Security
// Defaults is enabled.
// ──────────────────────────────────────────────────────────────────────────────
async function checkConditionalAccessMfaEnforced(getToken, orgId) {
  // First check Security Defaults
  const secDefaults = await graphGet(getToken, "/policies/identitySecurityDefaultsEnforcementPolicy");
  if (secDefaults?.isEnabled === true) {
    return [{
      resourceId: orgId,
      status: "pass",
      message: "Security Defaults is enabled, which enforces MFA for all users",
      evidencePayload: buildEvidencePayload({ resourceType: "entra_tenant", resourceId: orgId, region: null, details: { securityDefaultsEnabled: true } }),
    }];
  }

  // Fall back to Conditional Access policies
  const policies = await graphPaginate(getToken, "/identity/conditionalAccess/policies");
  const mfaPolicies = policies.filter((p) => {
    if (p.state !== "enabled") return false;
    const conditions = p.conditions;
    // Must target "All" users (not scoped to specific groups/users) or include "All"
    const allUsers =
      conditions?.users?.includeUsers?.includes("All") ||
      conditions?.users?.includeUsers?.includes("all");
    // Must have a grantControl requiring mfa
    const requiresMfa = p.grantControls?.builtInControls?.includes("mfa");
    return allUsers && requiresMfa;
  });

  const pass = mfaPolicies.length > 0;
  return [{
    resourceId: orgId,
    status: pass ? "pass" : "fail",
    message: pass
      ? `${mfaPolicies.length} enabled Conditional Access policy enforces MFA for all users`
      : "No enabled Conditional Access policy enforces MFA for all users and Security Defaults is disabled",
    evidencePayload: buildEvidencePayload({
      resourceType: "entra_tenant",
      resourceId: orgId,
      region: null,
      details: { mfaPoliciesFound: mfaPolicies.length, securityDefaultsEnabled: false },
    }),
  }];
}

// ──────────────────────────────────────────────────────────────────────────────
// entra_id.conditionalaccess.legacy_auth_blocked
// Checks an enabled CA policy blocks legacy authentication.
// ──────────────────────────────────────────────────────────────────────────────
async function checkLegacyAuthBlocked(getToken, orgId) {
  const policies = await graphPaginate(getToken, "/identity/conditionalAccess/policies");
  const blockPolicies = policies.filter((p) => {
    if (p.state !== "enabled") return false;
    // Must target legacy auth client apps
    const targetsLegacy =
      p.conditions?.clientAppTypes?.includes("exchangeActiveSync") ||
      p.conditions?.clientAppTypes?.includes("other");
    // Must block access
    const blocks = p.grantControls?.operator === "OR" && p.grantControls?.builtInControls?.includes("block");
    return targetsLegacy && blocks;
  });

  const pass = blockPolicies.length > 0;
  return [{
    resourceId: orgId,
    status: pass ? "pass" : "fail",
    message: pass
      ? `${blockPolicies.length} enabled CA policy blocks legacy authentication clients`
      : "No enabled Conditional Access policy blocks legacy authentication (EAS / Other clients)",
    evidencePayload: buildEvidencePayload({
      resourceType: "entra_tenant",
      resourceId: orgId,
      region: null,
      details: { legacyAuthBlockPoliciesFound: blockPolicies.length },
    }),
  }];
}

// ──────────────────────────────────────────────────────────────────────────────
// entra_id.authmethods.weak_methods_disabled
// Checks SMS and voice call auth methods are disabled.
// ──────────────────────────────────────────────────────────────────────────────
async function checkWeakMethodsDisabled(getToken, orgId) {
  const policy = await graphGet(getToken, "/policies/authenticationMethodsPolicy");
  const methods = policy?.authenticationMethodConfigurations || [];
  const sms = methods.find((m) => m.id === "sms");
  const voice = methods.find((m) => m.id === "voice");
  const smsEnabled = sms?.state === "enabled";
  const voiceEnabled = voice?.state === "enabled";
  const pass = !smsEnabled && !voiceEnabled;
  return [{
    resourceId: orgId,
    status: pass ? "pass" : "fail",
    message: pass
      ? "SMS and voice call authentication methods are both disabled"
      : `Weak auth methods still enabled — SMS: ${smsEnabled}, Voice: ${voiceEnabled}`,
    evidencePayload: buildEvidencePayload({
      resourceType: "entra_tenant",
      resourceId: orgId,
      region: null,
      details: { smsEnabled, voiceEnabled },
    }),
  }];
}

// ──────────────────────────────────────────────────────────────────────────────
// entra_id.roles.privileged_role_assignments_limited
// Checks Global Administrator assignments ≤ 5.
// ──────────────────────────────────────────────────────────────────────────────
async function checkPrivilegedRoleAssignmentsLimited(getToken, orgId) {
  // Get the Global Administrator role ID first
  const roles = await graphPaginate(getToken, "/directoryRoles");
  const globalAdmin = roles.find((r) => r.displayName === "Global Administrator");
  if (!globalAdmin) {
    return [{
      resourceId: orgId,
      status: "not_applicable",
      message: "Global Administrator directory role not found",
      evidencePayload: buildEvidencePayload({ resourceType: "entra_tenant", resourceId: orgId, region: null, details: { globalAdminRoleFound: false } }),
    }];
  }

  const assignments = await graphPaginate(getToken, `/roleManagement/directory/roleAssignments?$filter=roleDefinitionId eq '${globalAdmin.roleTemplateId || globalAdmin.id}'`);
  const count = assignments.length;
  const pass = count <= 5;
  return [{
    resourceId: orgId,
    status: pass ? "pass" : "fail",
    message: pass
      ? `Global Administrator has ${count} active assignment(s) — within the threshold`
      : `Global Administrator has ${count} active assignments — exceeds threshold of 5`,
    evidencePayload: buildEvidencePayload({
      resourceType: "entra_tenant",
      resourceId: orgId,
      region: null,
      details: { globalAdminCount: count },
    }),
  }];
}

// ──────────────────────────────────────────────────────────────────────────────
// entra_id.roles.other_privileged_roles_reviewed
// Extends the Global Administrator assignment-count check to the other
// built-in roles that grant tenant-wide or directory-wide write access.
// ──────────────────────────────────────────────────────────────────────────────
const OTHER_PRIVILEGED_ROLES = [
  { name: "Privileged Role Administrator", threshold: 5 },
  { name: "User Administrator", threshold: 10 },
  { name: "Application Administrator", threshold: 10 },
  { name: "Cloud Application Administrator", threshold: 10 },
  { name: "Security Administrator", threshold: 10 },
  { name: "Exchange Administrator", threshold: 10 },
];

async function checkOtherPrivilegedRolesLimited(getToken, orgId) {
  const roles = await graphPaginate(getToken, "/directoryRoles");
  const results = [];

  for (const { name, threshold } of OTHER_PRIVILEGED_ROLES) {
    const role = roles.find((r) => r.displayName === name);
    if (!role) continue; // role isn't activated in this tenant — nothing to check

    const assignments = await graphPaginate(getToken, `/roleManagement/directory/roleAssignments?$filter=roleDefinitionId eq '${role.roleTemplateId || role.id}'`);
    const count = assignments.length;
    const pass = count <= threshold;
    results.push({
      resourceId: role.id,
      status: pass ? "pass" : "fail",
      message: pass
        ? `${name} has ${count} active assignment(s) — within the threshold`
        : `${name} has ${count} active assignments — exceeds threshold of ${threshold}`,
      evidencePayload: buildEvidencePayload({
        resourceType: "entra_role",
        resourceId: role.id,
        resourceName: name,
        region: null,
        details: { roleName: name, assignmentCount: count, threshold },
      }),
    });
  }

  if (results.length === 0) {
    results.push({
      resourceId: orgId,
      status: "not_applicable",
      message: "None of the reviewed high-privilege roles are activated in this tenant",
      evidencePayload: buildEvidencePayload({ resourceType: "entra_tenant", resourceId: orgId, region: null, details: {} }),
    });
  }
  return results;
}

// ──────────────────────────────────────────────────────────────────────────────
// entra_id.roles.privileged_users_mfa_registered
// Checks every user holding an active, admin-eligible role (isAdmin=true in
// the registration report) has MFA registered — CA/Security Defaults only
// prompts registration at next sign-in, so an existing admin can still be
// unregistered until they do. Shares fetchUserRegistrationDetails with the
// tenant-wide member check below, defined further down in this file.
// ──────────────────────────────────────────────────────────────────────────────
async function checkPrivilegedUserMfaRegistered(getToken) {
  const details = await fetchUserRegistrationDetails(getToken);
  const admins = details.filter((u) => u.isAdmin === true);
  if (admins.length === 0) {
    return [{
      resourceId: "privileged_users",
      status: "not_applicable",
      message: "No users with an active admin role found in the MFA registration report",
      evidencePayload: buildEvidencePayload({ resourceType: "entra_users", resourceId: "privileged_users", region: null, details: { adminsChecked: 0 } }),
    }];
  }

  const unregistered = admins.filter((u) => u.isMfaRegistered !== true);
  if (unregistered.length === 0) {
    return [{
      resourceId: "privileged_users",
      status: "pass",
      message: `All ${admins.length} privileged user(s) have MFA registered`,
      evidencePayload: buildEvidencePayload({ resourceType: "entra_users", resourceId: "privileged_users", region: null, details: { adminsChecked: admins.length, unregisteredCount: 0 } }),
    }];
  }

  return unregistered.map((u) => ({
    resourceId: u.id,
    status: "fail",
    message: `Privileged user ${u.userPrincipalName || u.id} does not have MFA registered`,
    evidencePayload: buildEvidencePayload({
      resourceType: "entra_user",
      resourceId: u.id,
      resourceName: u.userPrincipalName || u.id,
      region: null,
      details: { isMfaRegistered: false, isAdmin: true },
    }),
  }));
}

// ──────────────────────────────────────────────────────────────────────────────
// entra_id.users.stale_guest_accounts_reviewed
// Checks guest users with no sign-in in 90 days are disabled or removed.
// ──────────────────────────────────────────────────────────────────────────────
async function checkStaleGuestAccountsReviewed(getToken) {
  const guests = await graphPaginate(
    getToken,
    "/users?$filter=userType eq 'Guest'&$select=id,displayName,mail,userPrincipalName,accountEnabled,signInActivity"
  );
  const ninetyDaysAgo = Date.now() - 90 * 24 * 60 * 60 * 1000;
  const staleActive = guests.filter((u) => {
    if (u.accountEnabled === false) return false; // already disabled
    const lastSignIn = u.signInActivity?.lastSignInDateTime;
    if (!lastSignIn) return false; // no sign-in data — conservatively skip
    return new Date(lastSignIn).getTime() < ninetyDaysAgo;
  });

  if (staleActive.length === 0) {
    return [{
      resourceId: "guest_accounts",
      status: "pass",
      message: `All ${guests.length} guest account(s) are active (signed in recently or already disabled)`,
      evidencePayload: buildEvidencePayload({ resourceType: "entra_guests", resourceId: "guest_accounts", region: null, details: { totalGuests: guests.length, staleActiveCount: 0 } }),
    }];
  }
  return staleActive.map((u) => ({
    resourceId: u.id,
    status: "fail",
    message: `Guest account ${u.mail || u.userPrincipalName || u.id} has had no sign-in activity for 90+ days and is still enabled`,
    evidencePayload: buildEvidencePayload({
      resourceType: "entra_user",
      resourceId: u.id,
      resourceName: u.displayName || u.userPrincipalName || u.id,
      region: null,
      details: { userType: "Guest", lastSignIn: u.signInActivity?.lastSignInDateTime ?? null, accountEnabled: u.accountEnabled },
    }),
  }));
}

// ──────────────────────────────────────────────────────────────────────────────
// Shared: bulk per-user MFA registration report, used by both the tenant-wide
// member check below and the privileged-user check in the roles section above.
// ──────────────────────────────────────────────────────────────────────────────
async function fetchUserRegistrationDetails(getToken) {
  return graphPaginate(getToken, "/reports/authenticationMethods/userRegistrationDetails");
}

// ──────────────────────────────────────────────────────────────────────────────
// entra_id.users.mfa_registration_reviewed
// Checks every active member (non-guest) user has at least one MFA method
// registered — defense-in-depth beyond the tenant-wide CA/Security Defaults
// policy check, since a policy only prompts registration at next sign-in and
// doesn't guarantee every existing user has actually completed it.
// ──────────────────────────────────────────────────────────────────────────────
async function checkMemberUserMfaRegistered(getToken) {
  const details = await fetchUserRegistrationDetails(getToken);
  const members = details.filter((u) => (u.userType || "").toLowerCase() !== "guest");
  if (members.length === 0) {
    return [{
      resourceId: "member_users",
      status: "not_applicable",
      message: "No member users found in the MFA registration report",
      evidencePayload: buildEvidencePayload({ resourceType: "entra_users", resourceId: "member_users", region: null, details: { usersChecked: 0 } }),
    }];
  }

  const unregistered = members.filter((u) => u.isMfaRegistered !== true);
  if (unregistered.length === 0) {
    return [{
      resourceId: "member_users",
      status: "pass",
      message: `All ${members.length} member user(s) have at least one MFA method registered`,
      evidencePayload: buildEvidencePayload({ resourceType: "entra_users", resourceId: "member_users", region: null, details: { usersChecked: members.length, unregisteredCount: 0 } }),
    }];
  }

  return unregistered.map((u) => ({
    resourceId: u.id,
    status: "fail",
    message: `User ${u.userPrincipalName || u.id} has no MFA method registered`,
    evidencePayload: buildEvidencePayload({
      resourceType: "entra_user",
      resourceId: u.id,
      resourceName: u.userPrincipalName || u.id,
      region: null,
      details: { isMfaRegistered: false, isAdmin: u.isAdmin ?? false },
    }),
  }));
}

// ──────────────────────────────────────────────────────────────────────────────
// entra_id.enterpriseapps.high_privilege_grants_reviewed
// Checks service principals holding high-privilege Graph application permissions.
// ──────────────────────────────────────────────────────────────────────────────
const HIGH_PRIV_PERMISSIONS = new Set([
  "RoleManagement.ReadWrite.Directory",
  "Directory.ReadWrite.All",
  "Application.ReadWrite.All",
  "AppRoleAssignment.ReadWrite.All",
  "User.ReadWrite.All",
]);

// Well-known application ID for the Microsoft Graph API — constant across every tenant.
const GRAPH_RESOURCE_APP_ID = "00000003-0000-0000-c000-000000000000";

// Microsoft's own tenant ID, which owns every first-party service principal (e.g.
// "Office 365 Exchange Online", "Microsoft Graph Change Tracking"). Excluded so
// pre-approved platform components — which nobody can act on — don't dominate the
// findings; this is the same well-known constant Microsoft's own sample scripts use
// to distinguish first-party from customer-installed enterprise apps.
const MICROSOFT_OWNER_TENANT_ID = "f8cdef31-a31e-4b4a-93e4-5f571e91255a";

// Resolves the tenant's Microsoft Graph service principal and maps each of our
// watched high-privilege permission names to its appRoleId — appRoleAssignments
// only carry the role's GUID, not its name, so this lookup is required to tell
// which grants are actually high-privilege.
async function resolveGraphHighPrivRoleIds(getToken) {
  const graphSps = await graphPaginate(getToken, `/servicePrincipals?$filter=appId eq '${GRAPH_RESOURCE_APP_ID}'&$select=id,appRoles`);
  const graphSp = graphSps[0];
  if (!graphSp) return { graphSpId: null, roleNameById: new Map() };
  const roleNameById = new Map();
  for (const role of graphSp.appRoles || []) {
    if (HIGH_PRIV_PERMISSIONS.has(role.value)) roleNameById.set(role.id, role.value);
  }
  return { graphSpId: graphSp.id, roleNameById };
}

async function checkHighPrivilegeGrantsReviewed(getToken) {
  const { graphSpId, roleNameById } = await resolveGraphHighPrivRoleIds(getToken);
  if (!graphSpId) {
    return [{
      resourceId: "enterprise_apps",
      status: "error",
      message: "Could not resolve the Microsoft Graph service principal to check granted API permissions",
      evidencePayload: buildEvidencePayload({ resourceType: "entra_enterprise_apps", resourceId: "enterprise_apps", region: null, details: {} }),
    }];
  }

  const sps = await graphPaginate(getToken, "/servicePrincipals?$select=id,displayName,appOwnerOrganizationId");
  const reviewable = sps.filter((sp) => sp.appOwnerOrganizationId !== MICROSOFT_OWNER_TENANT_ID);

  const flagged = [];
  for (const sp of reviewable) {
    // appRoleAssignments on a service principal = app roles (permissions) THIS SP
    // has been granted from a resource app (e.g. Microsoft Graph) — the opposite
    // direction from appRoleAssignedTo, which lists who's been granted access to
    // use this SP's own roles.
    const assignments = await graphPaginate(getToken, `/servicePrincipals/${sp.id}/appRoleAssignments`);
    const highPrivGrants = assignments.filter((a) => a.resourceId === graphSpId && roleNameById.has(a.appRoleId));
    if (highPrivGrants.length > 0) {
      flagged.push({ sp, permissionNames: highPrivGrants.map((g) => roleNameById.get(g.appRoleId)) });
    }
  }

  if (flagged.length === 0) {
    return [{
      resourceId: "enterprise_apps",
      status: "pass",
      message: `Reviewed ${reviewable.length} service principal(s) — none hold high-privilege Microsoft Graph application permissions`,
      evidencePayload: buildEvidencePayload({
        resourceType: "entra_enterprise_apps",
        resourceId: "enterprise_apps",
        region: null,
        details: { servicePrincipalsReviewed: reviewable.length, flaggedForReview: 0 },
      }),
    }];
  }

  return flagged.map(({ sp, permissionNames }) => ({
    resourceId: sp.id,
    status: "fail",
    message: `Service principal "${sp.displayName || sp.id}" has been granted high-privilege Graph permission(s): ${permissionNames.join(", ")}`,
    evidencePayload: buildEvidencePayload({
      resourceType: "entra_service_principal",
      resourceId: sp.id,
      resourceName: sp.displayName || sp.id,
      region: null,
      details: { permissionNames },
    }),
  }));
}

// ──────────────────────────────────────────────────────────────────────────────
// entra_id.appregistrations.credentials_not_expiring_soon
// Checks app registration secrets/certs aren't expired or expiring within 30 days.
// ──────────────────────────────────────────────────────────────────────────────
async function checkAppRegistrationCredentials(getToken) {
  const apps = await graphPaginate(
    getToken,
    "/applications?$select=id,displayName,keyCredentials,passwordCredentials"
  );
  const now = Date.now();
  const thirtyDaysOut = now + 30 * 24 * 60 * 60 * 1000;
  const twelveMonths = 366 * 24 * 60 * 60 * 1000;
  const results = [];

  for (const app of apps) {
    const creds = [
      ...(app.keyCredentials || []).map((c) => ({ ...c, type: "certificate" })),
      ...(app.passwordCredentials || []).map((c) => ({ ...c, type: "secret" })),
    ];
    for (const cred of creds) {
      const expiry = cred.endDateTime ? new Date(cred.endDateTime).getTime() : null;
      const created = cred.startDateTime ? new Date(cred.startDateTime).getTime() : null;
      const isExpired = expiry !== null && expiry < now;
      const isExpiringSoon = expiry !== null && expiry < thirtyDaysOut && !isExpired;
      const isLongLived = created !== null && expiry !== null && (expiry - created) > twelveMonths;

      if (isExpired || isExpiringSoon || isLongLived) {
        results.push({
          resourceId: app.id,
          status: isExpired ? "fail" : "fail",
          message: isExpired
            ? `App "${app.displayName}" has an expired ${cred.type} credential`
            : isExpiringSoon
            ? `App "${app.displayName}" has a ${cred.type} credential expiring within 30 days`
            : `App "${app.displayName}" has a ${cred.type} credential with validity > 12 months`,
          evidencePayload: buildEvidencePayload({
            resourceType: "entra_app_registration",
            resourceId: app.id,
            resourceName: app.displayName || app.id,
            region: null,
            details: { credentialType: cred.type, endDateTime: cred.endDateTime, isExpired, isExpiringSoon, isLongLived },
          }),
        });
      }
    }
  }

  if (results.length === 0) {
    results.push({
      resourceId: "app_registrations",
      status: "pass",
      message: `All ${apps.length} app registration credential(s) are valid and not expiring soon`,
      evidencePayload: buildEvidencePayload({
        resourceType: "entra_app_registrations",
        resourceId: "app_registrations",
        region: null,
        details: { appsChecked: apps.length },
      }),
    });
  }
  return results;
}

// ──────────────────────────────────────────────────────────────────────────────
// entra_id.audit.signin_and_directory_logs_available
// Checks sign-in and directory audit logs have entries in the last 7 days.
// A 7-day window (rather than 24h) avoids a false pass/fail purely from a
// quiet single day — it's a more robust "is logging actively flowing" signal.
// ──────────────────────────────────────────────────────────────────────────────
async function checkAuditLogsAvailable(getToken, orgId) {
  const since = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();
  let signInOk = false;
  let directoryOk = false;

  try {
    const signIns = await graphGet(getToken, `/auditLogs/signIns?$top=1&$filter=createdDateTime ge ${since}`);
    signInOk = (signIns?.value?.length ?? 0) > 0;
  } catch (_) { /* license/permission issue */ }

  try {
    const dirAudits = await graphGet(getToken, `/auditLogs/directoryAudits?$top=1&$filter=activityDateTime ge ${since}`);
    directoryOk = (dirAudits?.value?.length ?? 0) > 0;
  } catch (_) { /* license/permission issue */ }

  const pass = signInOk && directoryOk;
  return [{
    resourceId: orgId,
    status: pass ? "pass" : "fail",
    message: pass
      ? "Sign-in and directory audit logs both have entries within the last 7 days"
      : `Audit log availability issue — sign-in logs: ${signInOk ? "OK" : "no recent entries"}, directory audit: ${directoryOk ? "OK" : "no recent entries"}`,
    evidencePayload: buildEvidencePayload({
      resourceType: "entra_tenant",
      resourceId: orgId,
      region: null,
      details: { signInLogsOk: signInOk, directoryAuditOk: directoryOk },
    }),
  }];
}

// ──────────────────────────────────────────────────────────────────────────────
// entra_id.audit.privileged_role_changes_actor_captured
// Checks RoleManagement-category directory audit entries record an
// identifiable actor. If none are found, we can't distinguish "no role
// changes happened" from "the log window doesn't cover any" — that ambiguity
// is reported as not_applicable rather than a false pass/fail.
// ──────────────────────────────────────────────────────────────────────────────
async function checkPrivilegedChangeAuditActorCaptured(getToken, orgId) {
  let entries;
  try {
    entries = await graphPaginate(getToken, "/auditLogs/directoryAudits?$filter=category eq 'RoleManagement'&$top=50");
  } catch (err) {
    return [{
      resourceId: orgId,
      status: "error",
      message: `Could not query directory audit logs for role management activity: ${err.message}`,
      evidencePayload: buildEvidencePayload({ resourceType: "entra_tenant", resourceId: orgId, region: null, details: {} }),
    }];
  }

  if (entries.length === 0) {
    return [{
      resourceId: orgId,
      status: "not_applicable",
      message: "No RoleManagement directory audit entries found to review",
      evidencePayload: buildEvidencePayload({ resourceType: "entra_tenant", resourceId: orgId, region: null, details: { entriesChecked: 0 } }),
    }];
  }

  const missingActor = entries.filter((e) => !e.initiatedBy?.user?.id && !e.initiatedBy?.app?.appId);
  if (missingActor.length === 0) {
    return [{
      resourceId: orgId,
      status: "pass",
      message: `All ${entries.length} recent privileged role management audit entries record an identifiable actor`,
      evidencePayload: buildEvidencePayload({ resourceType: "entra_tenant", resourceId: orgId, region: null, details: { entriesChecked: entries.length, missingActorCount: 0 } }),
    }];
  }

  return missingActor.map((e) => ({
    resourceId: e.id,
    status: "fail",
    message: `Directory audit entry "${e.activityDisplayName || e.id}" for a role management change has no identifiable actor recorded`,
    evidencePayload: buildEvidencePayload({
      resourceType: "entra_audit_entry",
      resourceId: e.id,
      resourceName: e.activityDisplayName || e.id,
      region: null,
      details: { activityDateTime: e.activityDateTime, activityDisplayName: e.activityDisplayName },
    }),
  }));
}

// ──────────────────────────────────────────────────────────────────────────────
// entra_id.signins.legacy_auth_signins_absent
// Checks the actual sign-in logs for successful legacy-authentication traffic
// in the last 7 days — validates observed behavior, not just the Conditional
// Access policy configuration checked by legacy_auth_blocked (a policy can
// exist but carry exclusions, or not yet apply to every app).
// ──────────────────────────────────────────────────────────────────────────────
const LEGACY_AUTH_CLIENT_APPS = new Set([
  "Exchange ActiveSync",
  "IMAP4",
  "POP3",
  "Other clients",
  "Authenticated SMTP",
  "MAPI Over HTTP",
  "Offline Address Book",
  "Autodiscover",
]);

async function checkLegacyAuthSignInsAbsent(getToken, orgId) {
  const since = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();
  let signIns;
  try {
    signIns = await graphPaginate(getToken, `/auditLogs/signIns?$filter=createdDateTime ge ${since} and status/errorCode eq 0&$top=100`);
  } catch (err) {
    return [{
      resourceId: orgId,
      status: "error",
      message: `Could not check sign-in logs for legacy authentication usage: ${err.message}`,
      evidencePayload: buildEvidencePayload({ resourceType: "entra_tenant", resourceId: orgId, region: null, details: {} }),
    }];
  }

  const legacySignIns = signIns.filter((s) => LEGACY_AUTH_CLIENT_APPS.has(s.clientAppUsed));
  if (legacySignIns.length === 0) {
    return [{
      resourceId: orgId,
      status: "pass",
      message: "No successful legacy authentication sign-ins in the last 7 days",
      evidencePayload: buildEvidencePayload({ resourceType: "entra_tenant", resourceId: orgId, region: null, details: { signInsChecked: signIns.length, legacyAuthSignIns: 0 } }),
    }];
  }

  const distinctUsers = new Set(legacySignIns.map((s) => s.userPrincipalName || s.userId));
  return [{
    resourceId: orgId,
    status: "fail",
    message: `${legacySignIns.length} successful legacy authentication sign-in(s) from ${distinctUsers.size} user(s) in the last 7 days`,
    evidencePayload: buildEvidencePayload({
      resourceType: "entra_tenant",
      resourceId: orgId,
      region: null,
      details: { legacyAuthSignInCount: legacySignIns.length, distinctUserCount: distinctUsers.size, clientAppsUsed: [...new Set(legacySignIns.map((s) => s.clientAppUsed))] },
    }),
  }];
}

// ──────────────────────────────────────────────────────────────────────────────
// entra_id.signins.risky_signins_resolved
// Checks Identity Protection has no unresolved at-risk users. Requires an
// Entra ID P2 license — its absence isn't itself a compliance gap Prism can
// assert on, so a license/permission failure here is not_applicable, not fail.
// ──────────────────────────────────────────────────────────────────────────────
async function checkRiskySignInsResolved(getToken, orgId) {
  let riskyUsers;
  try {
    riskyUsers = await graphPaginate(getToken, "/identityProtection/riskyUsers?$filter=riskState eq 'atRisk'");
  } catch (err) {
    return [{
      resourceId: orgId,
      status: "not_applicable",
      message: `Could not check risky sign-in status — this requires an Entra ID P2 license and Identity Protection permissions: ${err.message}`,
      evidencePayload: buildEvidencePayload({ resourceType: "entra_tenant", resourceId: orgId, region: null, details: {} }),
    }];
  }

  if (riskyUsers.length === 0) {
    return [{
      resourceId: orgId,
      status: "pass",
      message: "No users are currently flagged at-risk by Identity Protection",
      evidencePayload: buildEvidencePayload({ resourceType: "entra_tenant", resourceId: orgId, region: null, details: { atRiskUserCount: 0 } }),
    }];
  }

  return riskyUsers.map((u) => ({
    resourceId: u.id,
    status: "fail",
    message: `User ${u.userPrincipalName || u.id} is flagged at-risk (risk level: ${u.riskLevel}) and has not been remediated`,
    evidencePayload: buildEvidencePayload({
      resourceType: "entra_user",
      resourceId: u.id,
      resourceName: u.userPrincipalName || u.id,
      region: null,
      details: { riskLevel: u.riskLevel, riskState: u.riskState, riskLastUpdatedDateTime: u.riskLastUpdatedDateTime },
    }),
  }));
}

// ──────────────────────────────────────────────────────────────────────────────
// entra_id.groups.privileged_groups_have_owners
// Checks role-assignable groups (isAssignableToRole=true) have at least one
// owner. Membership in one of these groups grants the group's Azure AD role
// to every member, so an ownerless one means nobody is accountable for
// reviewing who holds that privilege. Scoped to role-assignable groups
// specifically (rather than every security group) to avoid noise — ordinary
// groups without an owner are a much lower-stakes governance gap.
// ──────────────────────────────────────────────────────────────────────────────
async function checkPrivilegedGroupsHaveOwners(getToken) {
  const groups = await graphPaginate(getToken, "/groups?$filter=isAssignableToRole eq true&$select=id,displayName");
  if (groups.length === 0) {
    return [{
      resourceId: "role_assignable_groups",
      status: "not_applicable",
      message: "No role-assignable groups exist in this tenant",
      evidencePayload: buildEvidencePayload({ resourceType: "entra_groups", resourceId: "role_assignable_groups", region: null, details: { roleAssignableGroupCount: 0 } }),
    }];
  }

  const results = [];
  for (const group of groups) {
    const owners = await graphPaginate(getToken, `/groups/${group.id}/owners?$select=id`);
    const hasOwner = owners.length > 0;
    results.push({
      resourceId: group.id,
      status: hasOwner ? "pass" : "fail",
      message: hasOwner
        ? `Role-assignable group "${group.displayName || group.id}" has ${owners.length} owner(s)`
        : `Role-assignable group "${group.displayName || group.id}" has no owner`,
      evidencePayload: buildEvidencePayload({
        resourceType: "entra_group",
        resourceId: group.id,
        resourceName: group.displayName || group.id,
        region: null,
        details: { ownerCount: owners.length },
      }),
    });
  }
  return results;
}

export const mfaAndAccessTests = [
  {
    key: "entra_id.mfa.conditional_access_enforced",
    title: "Multi-factor authentication is enforced tenant-wide",
    failTitle: "Multi-factor authentication is not enforced tenant-wide",
    severityDefault: "critical",
    isoReferences: ["A.9.4.2"],
    dpdpaControlAreas: ["MFA for Sensitive Systems"],
    run: (clients) => checkConditionalAccessMfaEnforced(clients.getToken, clients.tenantId),
  },
  {
    key: "entra_id.conditionalaccess.legacy_auth_blocked",
    title: "Conditional Access blocks legacy authentication",
    failTitle: "Conditional Access does not block legacy authentication",
    severityDefault: "critical",
    isoReferences: ["A.9.4.2"],
    dpdpaControlAreas: ["MFA for Sensitive Systems"],
    run: (clients) => checkLegacyAuthBlocked(clients.getToken, clients.tenantId),
  },
  {
    key: "entra_id.authmethods.weak_methods_disabled",
    title: "Weak authentication methods are disabled",
    failTitle: "Weak authentication methods (SMS/voice) are still enabled",
    severityDefault: "medium",
    isoReferences: ["A.9.4.2"],
    dpdpaControlAreas: ["MFA for Sensitive Systems"],
    run: (clients) => checkWeakMethodsDisabled(clients.getToken, clients.tenantId),
  },
];

export const rolesTests = [
  {
    key: "entra_id.roles.privileged_role_assignments_limited",
    title: "Global Administrator assignments are limited and not permanent",
    failTitle: "Global Administrator assignments exceed the allowed threshold",
    severityDefault: "high",
    isoReferences: ["A.9.2.3"],
    dpdpaControlAreas: ["Privileged Access Management"],
    run: (clients) => checkPrivilegedRoleAssignmentsLimited(clients.getToken, clients.tenantId),
  },
  {
    key: "entra_id.roles.other_privileged_roles_reviewed",
    title: "Other built-in privileged roles have limited assignment counts",
    failTitle: "A built-in privileged role has more assignments than the allowed threshold",
    severityDefault: "medium",
    isoReferences: ["A.9.2.3"],
    dpdpaControlAreas: ["Privileged Access Management"],
    run: (clients) => checkOtherPrivilegedRolesLimited(clients.getToken, clients.tenantId),
  },
  {
    key: "entra_id.roles.privileged_users_mfa_registered",
    title: "Users with an active admin role have MFA registered",
    failTitle: "User with an active admin role does not have MFA registered",
    severityDefault: "critical",
    isoReferences: ["A.9.4.2"],
    dpdpaControlAreas: ["MFA for Sensitive Systems"],
    run: (clients) => checkPrivilegedUserMfaRegistered(clients.getToken),
  },
];

export const usersTests = [
  {
    key: "entra_id.users.stale_guest_accounts_reviewed",
    title: "Inactive guest accounts are disabled or removed",
    failTitle: "Guest account has had no sign-in activity for 90+ days and is still enabled",
    severityDefault: "high",
    isoReferences: ["A.9.2.6"],
    dpdpaControlAreas: ["Access Control & Least Privilege"],
    run: (clients) => checkStaleGuestAccountsReviewed(clients.getToken),
  },
  {
    key: "entra_id.users.mfa_registration_reviewed",
    title: "Member users have MFA registered",
    failTitle: "Member user has no MFA method registered",
    severityDefault: "high",
    isoReferences: ["A.9.4.2"],
    dpdpaControlAreas: ["MFA for Sensitive Systems"],
    run: (clients) => checkMemberUserMfaRegistered(clients.getToken),
  },
];

export const signInsTests = [
  {
    key: "entra_id.signins.legacy_auth_signins_absent",
    title: "No successful legacy authentication sign-ins are observed",
    failTitle: "Successful legacy authentication sign-ins were observed in the last 7 days",
    severityDefault: "high",
    isoReferences: ["A.9.4.2"],
    dpdpaControlAreas: ["MFA for Sensitive Systems"],
    run: (clients) => checkLegacyAuthSignInsAbsent(clients.getToken, clients.tenantId),
  },
  {
    key: "entra_id.signins.risky_signins_resolved",
    title: "Risky sign-ins are investigated and resolved",
    failTitle: "A user is flagged at-risk by Identity Protection and has not been remediated",
    severityDefault: "high",
    isoReferences: ["A.16.1.2"],
    dpdpaControlAreas: ["Breach Identification & Classification"],
    run: (clients) => checkRiskySignInsResolved(clients.getToken, clients.tenantId),
  },
];

export const groupsTests = [
  {
    key: "entra_id.groups.privileged_groups_have_owners",
    title: "Role-assignable groups have an assigned owner",
    failTitle: "Role-assignable group has no owner",
    severityDefault: "high",
    isoReferences: ["A.9.2.3"],
    dpdpaControlAreas: ["Privileged Access Management"],
    run: (clients) => checkPrivilegedGroupsHaveOwners(clients.getToken),
  },
];

export const enterpriseAppsTests = [
  {
    key: "entra_id.enterpriseapps.high_privilege_grants_reviewed",
    title: "Enterprise apps with high-privilege Graph permissions are reviewed",
    failTitle: "Service principal has been granted high-privilege Microsoft Graph permissions",
    severityDefault: "high",
    isoReferences: ["A.9.4.1"],
    dpdpaControlAreas: ["Privileged Access Management"],
    run: (clients) => checkHighPrivilegeGrantsReviewed(clients.getToken),
  },
  {
    key: "entra_id.appregistrations.credentials_not_expiring_soon",
    title: "App registration secrets and certificates are rotated before expiry",
    failTitle: "App registration credential is expired, expiring soon, or long-lived",
    severityDefault: "medium",
    isoReferences: ["A.9.2.4"],
    dpdpaControlAreas: ["Access Control & Least Privilege"],
    run: (clients) => checkAppRegistrationCredentials(clients.getToken),
  },
];

export const auditTests = [
  {
    key: "entra_id.audit.signin_and_directory_logs_available",
    title: "Sign-in and directory audit logs are actively retained",
    failTitle: "Sign-in or directory audit logs are not actively retained",
    severityDefault: "critical",
    isoReferences: ["A.12.4.1"],
    dpdpaControlAreas: ["Logging & Monitoring"],
    run: (clients) => checkAuditLogsAvailable(clients.getToken, clients.tenantId),
  },
  {
    key: "entra_id.audit.privileged_role_changes_actor_captured",
    title: "Privileged role management audit entries record an identifiable actor",
    failTitle: "A privileged role management audit entry has no identifiable actor recorded",
    severityDefault: "high",
    isoReferences: ["A.12.4.1"],
    dpdpaControlAreas: ["Logging & Monitoring"],
    run: (clients) => checkPrivilegedChangeAuditActorCaptured(clients.getToken, clients.tenantId),
  },
];
