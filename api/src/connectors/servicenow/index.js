import { resolveServiceNowCredentials } from "./credentials.js";
import { serviceNowClient } from "./client.js";
import { userTests } from "./tests/users.js";
import { aclTests } from "./tests/acls.js";
import { accountTests } from "./tests/accounts.js";
import { auditTests } from "./tests/audit.js";

export const key = "servicenow";

export const tests = [...userTests, ...aclTests, ...accountTests, ...auditTests];

// Groups checks by the segment of their key after "servicenow." ("servicenow.
// audit.field_audit_enabled" → "audit") so runTests() can run each area in its
// own isolation boundary — the integration user may be able to read `sys_user`
// but not `sys_security_acl` or `sys_audit` (their out-of-box ACLs often need an
// elevated role), and a 403 on one table should fall those checks back to
// not_applicable while every other area still runs. Mirrors onetrust/index.js's
// groupTestsByModule.
function groupTestsByArea(allTests) {
  const map = new Map();
  for (const test of allTests) {
    const area = test.key.split(".")[1];
    if (!map.has(area)) map.set(area, []);
    map.get(area).push(test);
  }
  return map;
}

// Admin-tier roles whose assignment to an inactive user, or over-assignment to
// active users, is a segregation-of-duties finding.
export const PRIVILEGED_ROLES = ["admin", "security_admin", "user_admin"];

// Thresholds. There is no per-connection config store for connector checks yet
// (see onetrust/tests/* which hard-code the same way), so these live in code and
// are surfaced in the evidence payload so a reviewer can see what was applied.
const ADMIN_COUNT_THRESHOLD = 10;
const PRIVILEGED_GROUP_MEMBER_THRESHOLD = 15;
const REVIEW_DAYS = 365;
const LOGIN_ACTIVITY_DAYS = 30;

export const THRESHOLDS = {
  ADMIN_COUNT_THRESHOLD,
  PRIVILEGED_GROUP_MEMBER_THRESHOLD,
  REVIEW_DAYS,
  LOGIN_ACTIVITY_DAYS,
};

// Tables Prism reads. Sensitive-table checks (`acls`, `audit`) target this
// subset; keep it in sync with what tests/*.js actually inspects.
export const SENSITIVE_TABLES = ["sys_user", "sys_user_has_role", "sys_security_acl"];

function displayOf(field) {
  if (field == null) return null;
  if (typeof field === "object") return field.display_value ?? field.value ?? null;
  return field;
}
function valueOf(field) {
  if (field == null) return null;
  if (typeof field === "object") return field.value ?? field.display_value ?? null;
  return field;
}

// Assembles the per-run Table API client plus lazily-memoised shared loaders. A
// loader is fetched at most once per collection run; its rejected promise is
// cached too, so a table the integration user can't read surfaces the same 403
// to every check that needs it without re-hitting the API. Adapted from
// onetrust/index.js's buildClients.
function buildClients(creds) {
  const sn = serviceNowClient(creds.baseUrl, creds.getToken);
  const memo = new Map();
  const once = (cacheKey, fn) => {
    if (!memo.has(cacheKey)) memo.set(cacheKey, fn());
    return memo.get(cacheKey);
  };

  return {
    sn,
    host: creds.host,
    PRIVILEGED_ROLES,
    SENSITIVE_TABLES,
    THRESHOLDS,
    displayOf,
    valueOf,

    listUsers: () =>
      once("users", () =>
        sn.listTable("sys_user", {
          fields: [
            "sys_id",
            "user_name",
            "name",
            "active",
            "locked_out",
            "web_service_access_only",
            "internal_integration_user",
            "last_login_time",
          ],
          maxRecords: 20000,
        })
      ),

    // Every assignment of an admin-tier role, with both the user and role
    // sys_id + display value (sysparm_display_value=all).
    listPrivilegedGrants: () =>
      once("priv-grants", () =>
        sn.listTable("sys_user_has_role", {
          query: `role.nameIN${PRIVILEGED_ROLES.join(",")}`,
          fields: ["user", "role", "state", "granted_by"],
          displayValue: "all",
        })
      ),

    listGroups: () =>
      once("groups", () =>
        sn.listTable("sys_user_group", {
          fields: ["sys_id", "name", "description", "active", "sys_updated_on", "roles"],
          displayValue: "all",
        })
      ),

    listGroupMembers: () =>
      once("group-members", () =>
        sn.listTable("sys_user_grmember", {
          fields: ["group", "user"],
          displayValue: "all",
        })
      ),

    // ACL rules on the sensitive tables Prism cares about. `roles` is a
    // list field, so display_value gives a comma-joined role-name string.
    listSensitiveAcls: () =>
      once("sensitive-acls", () =>
        sn.listTable("sys_security_acl", {
          query: `nameIN${SENSITIVE_TABLES.join(",")}`,
          fields: ["name", "operation", "admin_overrides", "roles", "active", "script", "condition"],
          displayValue: "all",
        })
      ),

    getProperty: (name) =>
      once(`prop:${name}`, async () => {
        const rows = await sn.listTable("sys_properties", {
          query: `name=${name}`,
          fields: ["name", "value"],
          limit: 1,
        });
        return rows[0] ? String(rows[0].value ?? "") : null; // null => property not set
      }),

    // Password Policy plugin records (table may be absent on instances without
    // the plugin — the loader's rejection is cached and the check downgrades).
    listPasswordPolicies: () =>
      once("password-policies", () =>
        sn.listTable("sys_user_password_policy", {
          fields: ["name", "active", "minimum_length", "min_length", "password_need_regex", "days_to_expire"],
          displayValue: "all",
        })
      ),

    // REST API Access Policy records. The exact table name has varied across
    // releases (`sys_ws_api_access_policy`); a 404 here is treated as "feature
    // not in use / not readable" and the check reports not_applicable.
    listApiAccessPolicies: () =>
      once("api-access-policies", () =>
        sn.listTable("sys_ws_api_access_policy", {
          fields: ["name", "active", "authentication_profiles", "rest_api", "api_type"],
          displayValue: "all",
        })
      ),

    // Most recent sys_audit row for a table, or null if none exists / not
    // readable. Used to evidence field auditing is switched on for the table.
    latestAudit: (table) =>
      once(`audit:${table}`, async () => {
        const rows = await sn.listTable("sys_audit", {
          query: `tablename=${table}^ORDERBYDESCsys_created_on`,
          fields: ["tablename", "fieldname", "documentkey", "sys_created_on"],
          limit: 1,
        });
        return rows[0] || null;
      }),
  };
}

// An ACL / role failure on a ServiceNow table comes back as HTTP 403 (often with
// an "Insufficient rights" / "ACL" body) — that's "the integration user's role
// set can't read this table", not a Prism error, so runTests downgrades it to
// not_applicable rather than error. A 404 (table doesn't exist on this release /
// plugin not installed) gets the same treatment.
function isScopeError(err) {
  const m = (err?.message || String(err)).toLowerCase();
  return (
    m.includes(" 403") ||
    m.includes(" 404") ||
    m.includes("forbidden") ||
    m.includes("insufficient rights") ||
    m.includes("acl") ||
    m.includes("not authorized") ||
    m.includes("no record found")
  );
}

export function describeServiceNowError(err) {
  const message = err?.message || String(err);
  const lower = message.toLowerCase();

  if (lower.includes(" 429") || lower.includes("rate limit") || lower.includes("too many requests")) {
    return (
      `${message} — ServiceNow rate limit hit. REST limits are configured per instance ` +
      `(System Web Services → REST → Rate Limit Rules); reduce this connection's collection frequency if it recurs.`
    );
  }

  if (
    lower.includes(" 401") ||
    lower.includes("invalid_client") ||
    lower.includes("access_denied") ||
    lower.includes("unauthorized") ||
    lower.includes("invalid token")
  ) {
    return (
      `${message} — ServiceNow authentication failed. Re-check the Client ID / Client Secret from ` +
      `System OAuth → Application Registry, and confirm the Client Credentials grant is enabled on the ` +
      `instance (system property glide.oauth.inbound.client.credential.grant_type.enabled = true) and that ` +
      `an OAuth Application User is set on the registry record.`
    );
  }

  if (lower.includes(" 403") || lower.includes("forbidden") || lower.includes("insufficient rights")) {
    return (
      `${message} — ServiceNow rejected the request as forbidden. The integration user's roles can't read ` +
      `this table. Grant a read-only role covering sys_user, sys_user_has_role, sys_user_group, ` +
      `sys_user_grmember, sys_security_acl, sys_audit and sys_properties (plus snc_platform_rest_api_access).`
    );
  }

  if (lower.includes("invalid config.instanceurl") || lower.includes("missing config.instanceurl")) {
    return message;
  }

  return `${message} — verify the instance base URL and that the integration user has read access to every table Prism's ServiceNow checks require.`;
}

export async function testConnection({ authType, config, secret }) {
  const creds = await resolveServiceNowCredentials({ authType, config, secret });
  const sn = serviceNowClient(creds.baseUrl, creds.getToken);
  try {
    // Cheapest always-permitted probe: one row of sys_user. Confirms the OAuth
    // token mints and the integration user has table-API access.
    await sn.listTable("sys_user", { fields: ["sys_id"], limit: 1, maxRecords: 1 });
    // ServiceNow instances have no distinct "account id" the way an AWS account
    // or a Salesforce org does — the instance host is the natural identifier.
    return { ok: true, externalAccountId: creds.host };
  } catch (err) {
    throw new Error(describeServiceNowError(err));
  }
}

export async function runTests({ authType, config, secret }) {
  const creds = await resolveServiceNowCredentials({ authType, config, secret });
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
            ? `ServiceNow "${area}" checks could not run with the integration user's current access — ${describeServiceNowError(err)}`
            : describeServiceNowError(err),
          evidencePayload: {},
        });
      }
    }
  }

  return runResults;
}
