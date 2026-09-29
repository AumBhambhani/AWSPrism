import { resolveSalesforceCredentials } from "./credentials.js";
import { salesforceClient } from "./client.js";
import { userTests } from "./tests/users.js";
import { profileTests } from "./tests/profiles.js";
import { connectedAppTests } from "./tests/connectedApps.js";
import { auditTests } from "./tests/audit.js";
import { networkTests } from "./tests/network.js";
import { permissionSetTests } from "./tests/permissionSets.js";

export const key = "salesforce";

export const tests = [
  ...userTests,
  ...profileTests,
  ...connectedAppTests,
  ...auditTests,
  ...networkTests,
  ...permissionSetTests,
];

// Thresholds. There is no per-connection config store for connector checks yet
// (see servicenow/index.js and crowdstrike/index.js which hard-code the same
// way), so these live in code and are echoed into each check's evidence payload
// so a reviewer can see exactly what was applied.
export const THRESHOLDS = {
  ADMIN_PROFILE_COUNT_THRESHOLD: 5, // active System Administrator users
  PASSWORD_MIN_LENGTH: 8,
  PASSWORD_MAX_EXPIRE_DAYS: 90,
  SENSITIVE_PERMISSION_ASSIGNEE_THRESHOLD: 10,
  AUDIT_TRAIL_MIN_WINDOW_DAYS: 180, // Salesforce's standard SetupAuditTrail retention
  LOGIN_HISTORY_WINDOW_DAYS: 30,
};

// System permissions whose broad assignment is a segregation-of-duties finding.
// Keys are the PermissionSet field names Salesforce exposes in SOQL.
export const SENSITIVE_PERMISSIONS = [
  "PermissionsModifyAllData",
  "PermissionsViewAllData",
  "PermissionsManageUsers",
  "PermissionsAuthorApex",
];

// Groups checks by the segment of their key after "salesforce."
// ("salesforce.audit.login_history_available" → "audit") so runTests() runs each
// area in its own isolation boundary — the integration user may hold "View Setup
// and Configuration" but not read access to a specific Setup entity, and a
// permission error on one area should fall those checks back to not_applicable
// while every other area still runs. Mirrors servicenow/index.js's
// groupTestsByArea.
function groupTestsByArea(allTests) {
  const map = new Map();
  for (const test of allTests) {
    const area = test.key.split(".")[1];
    if (!map.has(area)) map.set(area, []);
    map.get(area).push(test);
  }
  return map;
}

// Assembles the per-run REST/Tooling client plus lazily-memoised shared loaders.
// A loader is fetched at most once per collection run; its rejected promise is
// cached too, so an object the integration user can't read surfaces the same
// error to every check that needs it without re-hitting the API. Adapted from
// servicenow/index.js's buildClients.
function buildClients(creds) {
  const sf = salesforceClient(creds.getAuth, creds.apiVersion);
  const memo = new Map();
  const once = (cacheKey, fn) => {
    if (!memo.has(cacheKey)) memo.set(cacheKey, fn());
    return memo.get(cacheKey);
  };

  return {
    sf,
    host: creds.host,
    username: creds.username,
    THRESHOLDS,
    SENSITIVE_PERMISSIONS,

    listUsers: () =>
      once("users", () =>
        sf.query(
          "SELECT Id, Username, Name, IsActive, UserType, ProfileId, Profile.Name " +
            "FROM User WHERE UserType = 'Standard'"
        )
      ),

    listProfiles: () =>
      once("profiles", () => sf.query("SELECT Id, Name, UserType FROM Profile")),

    // Every permission-set assignment, with the assignee's active flag and the
    // permission set's sensitive system-permission booleans. Profile-granted
    // permissions surface here too as assignments whose PermissionSet has
    // IsOwnedByProfile = true.
    listPermissionSetAssignments: () =>
      once("psa", () =>
        sf.query(
          "SELECT Id, AssigneeId, Assignee.Name, Assignee.Username, Assignee.IsActive, " +
            "PermissionSetId, PermissionSet.Name, PermissionSet.Label, PermissionSet.IsOwnedByProfile, " +
            "PermissionSet.ProfileId, PermissionSet.Profile.Name, " +
            "PermissionSet.PermissionsModifyAllData, PermissionSet.PermissionsViewAllData, " +
            "PermissionSet.PermissionsManageUsers, PermissionSet.PermissionsAuthorApex, " +
            "PermissionSet.PermissionsApiEnabled " +
            "FROM PermissionSetAssignment"
        )
      ),

    // Per-profile password policies (Tooling API — ProfilePasswordPolicy is a
    // Setup-only entity). Rows are absent for profiles left on the org default.
    listProfilePasswordPolicies: () =>
      once("password-policies", () =>
        sf.toolingQuery(
          "SELECT ProfileId, MinimumPasswordLength, PasswordComplexity, PasswordExpiration, " +
            "MaxLoginAttempts, PasswordHistory, LockoutInterval FROM ProfilePasswordPolicy"
        )
      ),

    // Session/security settings via the Tooling API. `SecuritySettings` is a
    // singleton Setup entity; the MFA session policy lives on its
    // SessionSettings block. Field availability varies by release — the check
    // degrades to not_applicable if the shape doesn't resolve.
    getSecuritySettings: () =>
      once("security-settings", () =>
        sf.toolingQuery("SELECT DeveloperName, Metadata FROM SecuritySettings")
      ),

    listConnectedApps: () =>
      once("connected-apps", () =>
        sf
          .toolingQuery(
            "SELECT Id, Name, OptionsAllowAdminApprovedUsersOnly, OauthConfig FROM ConnectedApplication"
          )
          .catch(() =>
            // Older orgs / narrower access: fall back to the plain-SOQL shape,
            // which lacks OauthConfig (scopes) but still carries the
            // admin-approval flag.
            sf.query("SELECT Id, Name, OptionsAllowAdminApprovedUsersOnly FROM ConnectedApplication")
          )
      ),

    // SetupAuditTrail — Salesforce retains ~180 days. Ordered newest-first so a
    // single page is enough to find the oldest available entry.
    listSetupAuditTrail: () =>
      once("setup-audit-trail", () =>
        sf.query(
          "SELECT Id, Action, Section, CreatedDate, CreatedBy.Username FROM SetupAuditTrail ORDER BY CreatedDate DESC",
          { maxRecords: 5000 }
        )
      ),

    listLoginHistory: () =>
      once("login-history", () =>
        sf.query(
          `SELECT Id, UserId, LoginTime, Application, SourceIp, Status, LoginType ` +
            `FROM LoginHistory WHERE LoginTime = LAST_N_DAYS:${THRESHOLDS.LOGIN_HISTORY_WINDOW_DAYS} ` +
            `ORDER BY LoginTime DESC`,
          { maxRecords: 5000 }
        )
      ),

    // Org-wide trusted IP ranges (Setup > Network Access).
    listOrgTrustedIpRanges: () =>
      once("network-access", () => sf.query("SELECT Id, StartAddress, EndAddress FROM NetworkAccess")),

    // Per-profile Login IP Ranges (Tooling API).
    listProfileLoginIpRanges: () =>
      once("login-ip", () =>
        sf.toolingQuery("SELECT Id, ProfileId, IpStartAddress, IpEndAddress, Description FROM LoginIp")
      ),

    getOrganization: () =>
      once("organization", async () => {
        const rows = await sf.query(
          "SELECT Id, Name, OrganizationType, InstanceName, IsSandbox FROM Organization LIMIT 1"
        );
        return rows[0] || null;
      }),
  };
}

// A permission / access failure on a Salesforce object comes back as HTTP 403
// (INSUFFICIENT_ACCESS) or, for a Setup entity the integration user can't see at
// all, as a 400 with INVALID_TYPE / "sObject type ... is not supported". Either
// way it's "this integration user's permission set doesn't cover this object",
// not a Prism error, so runTests downgrades it to not_applicable rather than
// error. INVALID_FIELD is included too: this connector is beta and some Setup
// entity field names are unconfirmed against a live org — a missing field should
// skip the check, not fail the run.
function isScopeError(err) {
  const m = (err?.message || String(err)).toLowerCase();
  return (
    m.includes(" 403") ||
    m.includes("insufficient_access") ||
    m.includes("insufficient access") ||
    m.includes("invalid_type") ||
    m.includes("invalid_field") ||
    m.includes("is not supported") ||
    m.includes("not authorized") ||
    m.includes("no such column") ||
    m.includes("malformed_query")
  );
}

export function describeSalesforceError(err) {
  const message = err?.message || String(err);
  const lower = message.toLowerCase();

  if (lower.includes(" 429") || lower.includes("request_limit_exceeded") || lower.includes("rate limit")) {
    return (
      `${message} — Salesforce API request limit hit. The org's 24-hour REST request quota is exhausted ` +
      `(see Setup > System Overview > API Usage); reduce this connection's collection frequency or wait for the quota to reset.`
    );
  }

  if (
    lower.includes("invalid_grant") ||
    lower.includes(" 400 invalid_grant") ||
    lower.includes("invalid_client") ||
    lower.includes(" 401") ||
    lower.includes("invalid_client_id") ||
    lower.includes("user hasn't approved")
  ) {
    return (
      `${message} — Salesforce JWT authentication failed. Check that (1) the integration user's profile or ` +
      `permission set is pre-authorized on the Connected App (OAuth Policies > Permitted Users = "Admin approved ` +
      `users are pre-authorized"), (2) config.username is the exact username of that user, (3) config.clientId is ` +
      `the Connected App consumer key, (4) the uploaded certificate matches secret.privateKey, and (5) the server ` +
      `clock is accurate — Salesforce rejects the assertion on more than 5 minutes of skew.`
    );
  }

  if (lower.includes(" 403") || lower.includes("insufficient_access") || lower.includes("invalid_type")) {
    return (
      `${message} — Salesforce rejected the request. The integration user is missing read access to a Setup ` +
      `object. Grant "API Enabled", "View Setup and Configuration", and "View All Users" (read-only) — an object ` +
      `the user can't read is skipped (its checks report not applicable).`
    );
  }

  if (lower.includes("invalid config.loginurl") || lower.includes("missing config.loginurl") || lower.includes("invalid config.apiversion")) {
    return message;
  }

  return `${message} — verify the My Domain login URL, the Connected App configuration, and that the integration user can read the Setup objects Prism's Salesforce checks require.`;
}

export async function testConnection({ authType, config, secret }) {
  const creds = await resolveSalesforceCredentials({ authType, config, secret });
  const sf = salesforceClient(creds.getAuth, creds.apiVersion);
  try {
    // The JWT token exchange is the primary connectivity + credential probe
    // (getAuth() throws on a bad assertion, unapproved consumer, or clock skew).
    // Follow it with the cheapest always-permitted read — one row of
    // Organization — to confirm the token actually carries API access, and to
    // recover the org id as the external account identifier.
    const rows = await sf.query("SELECT Id, Name FROM Organization LIMIT 1");
    const orgId = rows[0]?.Id ? String(rows[0].Id) : creds.host;
    return { ok: true, externalAccountId: orgId };
  } catch (err) {
    throw new Error(describeSalesforceError(err));
  }
}

export async function runTests({ authType, config, secret }) {
  const creds = await resolveSalesforceCredentials({ authType, config, secret });
  const clients = buildClients(creds);
  const runResults = [];

  for (const [area, areaTests] of groupTestsByArea(tests)) {
    for (const test of areaTests) {
      try {
        const results = await test.run(clients);
        for (const result of results) {
          runResults.push({
            testKey: test.key,
            title: test.title,
            failTitle: test.failTitle,
            severity: test.severityDefault,
            ...result,
          });
        }
      } catch (err) {
        const scoped = isScopeError(err);
        runResults.push({
          testKey: test.key,
          title: test.title,
          failTitle: test.failTitle,
          severity: test.severityDefault,
          resourceId: scoped ? "not_applicable" : "error",
          status: scoped ? "not_applicable" : "error",
          message: scoped
            ? `Salesforce "${area}" checks could not run with the integration user's current access — ${describeSalesforceError(err)}`
            : describeSalesforceError(err),
          evidencePayload: {},
        });
      }
    }
  }

  return runResults;
}
