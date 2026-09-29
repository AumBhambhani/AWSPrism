import { resolveCrowdstrikeCredentials } from "./credentials.js";
import { crowdstrikeClient } from "./client.js";
import { hostTests } from "./tests/hosts.js";
import { sensorPolicyTests } from "./tests/sensorPolicy.js";
import { detectionTests } from "./tests/detections.js";
import { vulnerabilityTests } from "./tests/vulnerabilities.js";
import { userTests } from "./tests/users.js";

export const key = "crowdstrike";

export const tests = [
  ...hostTests,
  ...sensorPolicyTests,
  ...detectionTests,
  ...vulnerabilityTests,
  ...userTests,
];

// Thresholds. There is no per-connection config store for connector checks yet
// (see servicenow/index.js and onetrust/tests/* which hard-code the same way), so
// these live in code and are echoed into each check's evidence payload so a
// reviewer can see exactly what was applied.
export const THRESHOLDS = {
  STALE_HOST_DAYS: 30,
  HIGH_SEV_TRIAGE_HOURS: 48,
  UNRESOLVED_DETECTION_DAYS: 7,
  CRITICAL_CVE_AGE_DAYS: 30,
  HIGH_CVE_AGE_DAYS: 90,
  SENSOR_BUILDS_BEHIND: 2,
  ADMIN_COUNT_THRESHOLD: 5,
};

// Groups checks by the segment of their key after "crowdstrike."
// ("crowdstrike.host.stale_endpoints_reviewed" → "host") so runTests() runs each
// area in its own isolation boundary — the API client may hold Hosts read but
// not Spotlight or User Management, and a 403 on one collection should fall those
// checks back to not_applicable while every other area still runs. Mirrors
// servicenow/index.js's groupTestsByArea.
function groupTestsByArea(allTests) {
  const map = new Map();
  for (const test of allTests) {
    const area = test.key.split(".")[1];
    if (!map.has(area)) map.set(area, []);
    map.get(area).push(test);
  }
  return map;
}

// Assembles the per-run Falcon client plus lazily-memoised shared loaders. A
// loader is fetched at most once per collection run; its rejected promise is
// cached too, so a collection the API client can't read surfaces the same 403 to
// every check that needs it without re-hitting the API. Adapted from
// servicenow/index.js's buildClients.
function buildClients(creds) {
  const cs = crowdstrikeClient(creds.baseUrl, creds.getToken);
  const memo = new Map();
  const once = (cacheKey, fn) => {
    if (!memo.has(cacheKey)) memo.set(cacheKey, fn());
    return memo.get(cacheKey);
  };

  return {
    cs,
    host: creds.host,
    cloudRegion: creds.cloudRegion,
    THRESHOLDS,

    listHosts: () =>
      once("hosts", () =>
        cs.queryThenHydrate("/devices/queries/devices/v1", "/devices/entities/devices/v2", { limit: 500 })
      ),

    listSensorUpdatePolicies: () =>
      once("sensor-policies", () =>
        cs.queryThenHydrate("/policy/queries/sensor-update/v1", "/policy/entities/sensor-update/v2", { limit: 100 })
      ),

    // Sensor build catalogue for the currency check. A 4xx here is swallowed by
    // the check (falls back to not_applicable) rather than failing the area.
    listSensorBuilds: () =>
      once("sensor-builds", async () => {
        const data = await cs.request("GET", "/policy/combined/sensor-update-builds/v1");
        return Array.isArray(data?.resources) ? data.resources : [];
      }),

    // Detection data, Alerts-first with a Detects fallback (CrowdStrike is
    // deprecating the legacy Detects API — see the connector spec). Tries the
    // unified Alerts API; on a scope error (alerts:read not granted) falls back
    // to legacy Detects so the connector keeps working through the migration
    // window. Both detection checks share this one memoised loader.
    getDetectionData: () =>
      once("detections", async () => {
        try {
          const records = await cs.queryThenHydrate(
            "/alerts/queries/alerts/v2",
            "/alerts/entities/alerts/v2",
            { limit: 500, idField: "composite_ids" }
          );
          return { records, source: "alerts" };
        } catch (err) {
          if (!isScopeError(err)) throw err;
          const ids = await cs.queryIds("/detects/queries/detects/v1", { limit: 500 });
          const records = ids.length
            ? await cs.hydrate("/detects/entities/summaries/GET/v1", ids, { idField: "ids" })
            : [];
          return { records, source: "detects" };
        }
      }),

    listVulnerabilities: () =>
      once("vulnerabilities", () =>
        cs.queryThenHydrate("/spotlight/queries/vulnerabilities/v2", "/spotlight/entities/vulnerabilities/v2", {
          limit: 400,
          filter: "status:!'closed'",
        })
      ),

    // Falcon console users with their role assignments. `/user-management/
    // combined/users/v1` returns users with roles inline in one paginated call.
    listConsoleUsers: () =>
      once("console-users", async () => {
        const data = await cs.request("GET", "/user-management/combined/users/v1?limit=500");
        return Array.isArray(data?.resources) ? data.resources : [];
      }),
  };
}

// A scope / entitlement failure on a Falcon collection comes back as HTTP 403
// (the API client's scopes don't cover it) or 404 (the collection / module isn't
// available on this tenant) — that's "not granted", not a Prism error, so
// runTests downgrades it to not_applicable rather than error.
function isScopeError(err) {
  const m = (err?.message || String(err)).toLowerCase();
  return (
    m.includes(" 403") ||
    m.includes(" 404") ||
    m.includes("forbidden") ||
    m.includes("access denied") ||
    m.includes("insufficient") ||
    m.includes("not authorized") ||
    m.includes("unauthorized scope")
  );
}

export function describeCrowdstrikeError(err) {
  const message = err?.message || String(err);
  const lower = message.toLowerCase();

  if (lower.includes(" 429") || lower.includes("rate limit") || lower.includes("too many requests")) {
    return (
      `${message} — CrowdStrike rate limit hit. Falcon enforces per-API-client limits that vary by ` +
      `endpoint and tenant tier; reduce this connection's collection frequency if it recurs.`
    );
  }

  if (
    lower.includes(" 401") ||
    lower.includes("invalid_client") ||
    lower.includes("access_denied") ||
    lower.includes("unauthorized")
  ) {
    return (
      `${message} — CrowdStrike authentication failed. Re-check the Client ID / Client Secret from ` +
      `Support and resources > API Clients and Keys, and confirm the region is correct — a credential ` +
      `pair only authenticates against the Falcon region it was created in.`
    );
  }

  if (lower.includes(" 403") || lower.includes("forbidden") || lower.includes("insufficient")) {
    return (
      `${message} — CrowdStrike rejected the request. The API client is missing a read scope: grant ` +
      `hosts:read, sensor-update-policies:read, alerts:read (and detects:read), spotlight-vulnerabilities:read, ` +
      `and user-management:read. A collection a scope doesn't cover is skipped (its checks report not applicable).`
    );
  }

  if (lower.includes("config.baseurl") || lower.includes("config.cloudregion") || lower.includes("regional api host")) {
    return message;
  }

  return `${message} — verify the Falcon cloud region and that the API client holds every read scope Prism's CrowdStrike checks require.`;
}

export async function testConnection({ authType, config, secret }) {
  const creds = await resolveCrowdstrikeCredentials({ authType, config, secret });
  const cs = crowdstrikeClient(creds.baseUrl, creds.getToken);
  try {
    // The OAuth2 token exchange is the primary connectivity + credential probe
    // (getToken() throws on a bad client or wrong region). Follow it with a
    // cheap Hosts query to confirm the granted scopes actually include Hosts
    // read — Falcon's token endpoint validates only that the client exists.
    const ids = await cs.queryIds("/devices/queries/devices/v1", { limit: 1, maxRecords: 1 });
    let externalAccountId = creds.host;
    if (ids.length) {
      const [device] = await cs.hydrate("/devices/entities/devices/v2", ids, { idField: "ids" });
      if (device?.cid) externalAccountId = String(device.cid);
    }
    return { ok: true, externalAccountId };
  } catch (err) {
    throw new Error(describeCrowdstrikeError(err));
  }
}

export async function runTests({ authType, config, secret }) {
  const creds = await resolveCrowdstrikeCredentials({ authType, config, secret });
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
            ? `CrowdStrike "${area}" checks could not run with this API client's scopes — ${describeCrowdstrikeError(err)}`
            : describeCrowdstrikeError(err),
          evidencePayload: {},
        });
      }
    }
  }

  return runResults;
}
