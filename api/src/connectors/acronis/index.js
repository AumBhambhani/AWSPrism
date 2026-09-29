import { resolveAcronisCredentials } from "./credentials.js";
import { acronisClient } from "./client.js";
import { backupTests } from "./tests/backup.js";
import { malwareTests } from "./tests/malware.js";
import { vulnerabilityTests } from "./tests/vulnerability.js";
import { monitoringTests } from "./tests/monitoring.js";

export const key = "acronis";

export const tests = [
  ...backupTests,
  ...malwareTests,
  ...vulnerabilityTests,
  ...monitoringTests,
];

// Thresholds. There is no per-connection config store for connector checks yet
// (see crowdstrike/index.js and servicenow/index.js which hard-code the same
// way), so these live in code and are echoed into each check's evidence payload
// so a reviewer can see exactly what was applied.
export const THRESHOLDS = {
  BACKUP_MAX_AGE_DAYS: 7,
  SCAN_MAX_AGE_DAYS: 7,
  VULN_MAX_AGE_DAYS: 30,
  PATCH_MAX_AGE_DAYS: 30,
};

// Groups checks by the segment of their key after "acronis."
// ("acronis.backup.protection_enabled" → "backup") so runTests() runs each area
// in its own isolation boundary — the API client's role may cover the resource
// inventory but not the alert manager, and a 403 on one collection should fall
// those checks back to not_applicable while every other area still runs. Mirrors
// crowdstrike/index.js's groupTestsByArea.
function groupTestsByArea(allTests) {
  const map = new Map();
  for (const test of allTests) {
    const area = test.key.split(".")[1];
    if (!map.has(area)) map.set(area, []);
    map.get(area).push(test);
  }
  return map;
}

// Assembles the per-run Acronis client plus lazily-memoised shared loaders. A
// loader is fetched at most once per collection run; its rejected promise is
// cached too, so a collection the API client can't read surfaces the same 403 to
// every check that needs it. Adapted from crowdstrike/index.js's buildClients.
function buildClients(creds) {
  const api = acronisClient(creds.datacenterUrl, creds.getToken);
  const memo = new Map();
  const once = (cacheKey, fn) => {
    if (!memo.has(cacheKey)) memo.set(cacheKey, fn());
    return memo.get(cacheKey);
  };

  return {
    api,
    datacenterUrl: creds.datacenterUrl,
    THRESHOLDS,

    listResourceStatuses: () =>
      once("resource-statuses", () =>
        api.fetchAll(
          "/api/resource_management/v4/resource_statuses?type=resource.machine&include_attributes=true"
        )
      ),

    getAlerts: () => once("alerts", () => api.fetchAll("/api/alert_manager/v1/alerts")),
  };
}

// A role / entitlement failure on an Acronis collection comes back as HTTP 403
// (the API client's role doesn't cover it) or 404 (the module isn't enabled on
// this tenant) — that's "not granted", not a Prism error, so runTests downgrades
// it to not_applicable rather than error.
function isScopeError(err) {
  const m = (err?.message || String(err)).toLowerCase();
  return (
    m.includes(" 403") ||
    m.includes(" 404") ||
    m.includes("forbidden") ||
    m.includes("access denied") ||
    m.includes("not authorized") ||
    m.includes("unauthorized scope")
  );
}

export function describeAcronisError(err) {
  const message = err?.message || String(err);
  const lower = message.toLowerCase();

  if (lower.includes(" 429") || lower.includes("rate limit") || lower.includes("too many requests")) {
    return (
      `${message} — Acronis rate limit hit. Reduce this connection's collection frequency if it recurs.`
    );
  }

  if (
    lower.includes(" 401") ||
    lower.includes("invalid_client") ||
    lower.includes("invalid_grant") ||
    lower.includes("unauthorized")
  ) {
    return (
      `${message} — Acronis authentication failed. Re-check the Client ID / Client Secret from ` +
      `Settings > API clients, and confirm the data-center URL matches the one your Cyber Protect ` +
      `console runs in — a credential pair only authenticates against the data center it was created in.`
    );
  }

  if (lower.includes(" 403") || lower.includes("forbidden") || lower.includes("access denied")) {
    return (
      `${message} — Acronis rejected the request. The API client's role is missing read access to a ` +
      `module (resource management or the alert manager). A module the role doesn't cover is skipped ` +
      `(its checks report not applicable). Grant the client a read-only administrator role.`
    );
  }

  if (lower.includes("config.datacenterurl") || lower.includes("datacenterurl")) {
    return message;
  }

  return `${message} — verify the Acronis data-center URL and that the API client holds a read-only administrator role.`;
}

export async function testConnection({ authType, config, secret }) {
  const creds = await resolveAcronisCredentials({ authType, config, secret });
  const api = acronisClient(creds.datacenterUrl, creds.getToken);
  try {
    // The OAuth2 token exchange is the primary connectivity + credential probe
    // (getToken() throws on a bad client or wrong data center). Follow it with
    // the identity endpoint to confirm the token is usable and yield the tenant
    // id as the external account id.
    const identity = await api.request("GET", `/api/2/clients/${encodeURIComponent(creds.clientId)}`);
    const tenantId = identity?.tenant_id ?? identity?.tenantId ?? identity?.tenant ?? null;
    return { ok: true, externalAccountId: tenantId ? String(tenantId) : creds.tenantHost };
  } catch (err) {
    throw new Error(describeAcronisError(err));
  }
}

export async function runTests({ authType, config, secret }) {
  const creds = await resolveAcronisCredentials({ authType, config, secret });
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
            ? `Acronis "${area}" checks could not run with this API client's role — ${describeAcronisError(err)}`
            : describeAcronisError(err),
          evidencePayload: {},
        });
      }
    }
  }

  return runResults;
}
