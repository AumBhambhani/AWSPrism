import { resolveSophosCredentials, fetchWhoami } from "./credentials.js";
import { sophosClient } from "./client.js";
import { endpointTests } from "./tests/endpoint.js";
import { commonTests } from "./tests/common.js";
import { detectionsTests } from "./tests/detections.js";
import { auditTests } from "./tests/audit.js";
import { xdrTests } from "./tests/xdr.js";
import { siemTests } from "./tests/siem.js";
import { firewallTests } from "./tests/firewall.js";
import { webTests } from "./tests/web.js";
import { dnsTests } from "./tests/dns.js";

export const key = "sophos";

export const tests = [
  ...endpointTests,
  ...commonTests,
  ...detectionsTests,
  ...auditTests,
  ...xdrTests,
  ...siemTests,
  ...firewallTests,
  ...webTests,
  ...dnsTests,
];

export const THRESHOLDS = {
  STALE_DEVICE_DAYS: 30,
  HIGH_SEV_ALERT_TRIAGE_HOURS: 48,
  UNREVIEWED_DETECTION_DAYS: 7,
  AUDIT_LOOKBACK_DAYS: 30,
  SIEM_FRESHNESS_HOURS: 26,
  ADMIN_COUNT_THRESHOLD: 5,
  FIRMWARE_EOL_GRACE_DAYS: 90,
  DATALAKE_TELEMETRY_DAYS: 7,
};

const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function groupTestsByArea(allTests) {
  const groups = new Map();
  for (const test of allTests) {
    const area = test.key.split(".")[1];
    if (!groups.has(area)) groups.set(area, []);
    groups.get(area).push(test);
  }
  return groups;
}

export function isScopeError(error) {
  const message = (error?.message || String(error)).toLowerCase();
  return ["http 403", "http 404", "forbidden", "not licensed", "not entitled", "insufficient", "access denied"].some((part) => message.includes(part));
}

export function describeSophosError(error) {
  const message = error?.message || String(error);
  const lower = message.toLowerCase();
  if (lower.includes("http 429") || lower.includes("rate limit") || lower.includes("too many requests")) {
    return `${message} — Sophos Central rate limit reached; reduce this connection's collection frequency if it recurs.`;
  }
  if (lower.includes("http 401") || lower.includes("invalid_client") || lower.includes("unauthorized")) {
    return `${message} — Sophos authentication failed. Re-check the Client ID and Client Secret under Global Settings > API Credentials.`;
  }
  if (lower.includes("http 403") || lower.includes("forbidden") || lower.includes("insufficient")) {
    return `${message} — Sophos rejected this collection. Assign the API credential the narrowest read-only role covering the requested product; unlicensed areas are skipped.`;
  }
  return `${message} — verify the tenant-level Sophos API credential and the product licences assigned to this tenant.`;
}

async function pollRun(client, path, initial, { attempts = 20, delayMs = 500 } = {}) {
  let state = initial;
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    if (state?.status === "finished") {
      if (state.result !== "succeeded") throw new Error(`Sophos query ${state.id} finished with result ${state.result}`);
      return state;
    }
    await wait(delayMs);
    state = await client.request("GET", `${path}/${encodeURIComponent(state.id)}`);
  }
  throw new Error(`Sophos query ${initial?.id || "unknown"} did not finish before the collection timeout`);
}

export function buildClients(creds, whoami) {
  const api = sophosClient({ getToken: creds.getToken, whoami });
  const memo = new Map();
  const once = (name, loader) => {
    if (!memo.has(name)) memo.set(name, loader());
    return memo.get(name);
  };
  const hydrate = async (items, basePath) => Promise.all(items.map(async (item) => {
    if (!item?.id) return item;
    try {
      return await api.request("GET", `${basePath}/${encodeURIComponent(item.id)}`);
    } catch (error) {
      if (isScopeError(error)) return item;
      throw error;
    }
  }));

  return {
    api,
    whoami,
    THRESHOLDS,
    listEndpoints: () => once("endpoints", () => api.paginate("/endpoint/v1/endpoints", { query: { view: "full" }, maxRecords: 20_000 })),
    listEndpointGroups: () => once("endpoint-groups", () => api.paginate("/endpoint/v1/endpoint-groups")),
    listPolicies: () => once("policies", async () => hydrate(await api.paginate("/endpoint/v1/policies"), "/endpoint/v1/policies")),
    listDetectedExploits: () => once("exploits", () => api.paginate("/endpoint/v1/settings/exploit-mitigation/detected-exploits")),
    listAlerts: () => once("alerts", () => api.paginate("/common/v1/alerts", { query: { from: new Date(Date.now() - THRESHOLDS.AUDIT_LOOKBACK_DAYS * 86_400_000).toISOString() } })),
    listAdmins: () => once("admins", () => api.paginate("/common/v1/admins")),
    listRoles: () => once("roles", () => api.paginate("/common/v1/roles")),
    // Sophos has not documented a stable tenant-MFA settings route. Keep this
    // isolated: a 404 becomes not_applicable and an unexpected shape is error.
    getMfaSettings: () => once("mfa", () => api.request("GET", "/common/v1/settings/mfa")),
    listDetections: () => once("detections", async () => {
      const path = "/detections/v1/queries/detections";
      const initial = await api.request("POST", path, { body: { from: new Date(Date.now() - THRESHOLDS.AUDIT_LOOKBACK_DAYS * 86_400_000).toISOString(), to: new Date().toISOString(), showSuppressed: true } });
      if (!initial?.id) throw new Error("Sophos detections query response is missing id");
      const run = await pollRun(api, path, initial);
      return api.paginate(`${path}/${encodeURIComponent(run.id)}/results`);
    }),
    // Audit Logs remains explicitly defensive until verified against a live
    // tenant: a missing entitlement/path is not_applicable, never a guessed pass.
    listAuditLogs: () => once("audit", () => api.paginate("/audit-logs/v1/audit-logs", { query: { from: new Date(Date.now() - THRESHOLDS.AUDIT_LOOKBACK_DAYS * 86_400_000).toISOString(), to: new Date().toISOString() } })),
    getXdrTelemetry: () => once("xdr", async () => {
      const path = "/xdr-query/v1/queries/runs";
      const initial = await api.request("POST", path, { body: { adHocQuery: { query: "SELECT meta_hostname, endpoint_id, timestamp FROM xdr_data LIMIT 1000" } } });
      if (!initial?.id && !initial?.runId) throw new Error("Sophos XDR query response is missing run id");
      if (!initial.id) initial.id = initial.runId;
      await pollRun(api, path, initial);
      const data = await api.request("GET", `${path}/${encodeURIComponent(initial.id)}/results`);
      const items = Array.isArray(data?.items) ? data.items : Array.isArray(data?.results) ? data.results : null;
      if (!items) throw new Error("Sophos XDR results response is missing items/results array");
      return { items, runId: initial.id };
    }),
    listSiemEvents: () => once("siem-events", () => api.paginate("/siem/v1/events", { query: { limit: 1000, from_date: Math.floor((Date.now() - 86_400_000) / 1000) } })),
    listSiemAlerts: () => once("siem-alerts", () => api.paginate("/siem/v1/alerts", { query: { limit: 1000, from_date: Math.floor((Date.now() - 86_400_000) / 1000) } })),
    getCredentialInfo: async () => ({ active: Boolean(await creds.getToken()), tenantId: whoami.tenantId }),
    listFirewalls: () => once("firewalls", () => api.paginate("/firewall/v1/firewalls", { pageSize: 100 })),
    listFirewallGroups: () => once("firewall-groups", () => api.paginate("/firewall/v1/firewall-groups", { pageSize: 100 })),
    listDnsLocations: () => once("dns-locations", () => api.paginate("/dns-protection/v2/locations", { pageSize: 200 })),
    listDnsPolicies: () => once("dns-policies", async () => hydrate(await api.paginate("/dns-protection/v2/policies", { pageSize: 200 }), "/dns-protection/v2/policies")),
    listDnsDomainLists: () => once("dns-domains", async () => hydrate(await api.paginate("/dns-protection/v2/custom-domains", { pageSize: 200 }), "/dns-protection/v2/custom-domains")),
  };
}

export async function testConnection({ authType, config, secret }) {
  const creds = await resolveSophosCredentials({ authType, config, secret });
  try {
    const whoami = await fetchWhoami(creds.getToken);
    const api = sophosClient({ getToken: creds.getToken, whoami });
    await api.paginate("/endpoint/v1/endpoints", { query: { view: "basic" }, pageSize: 1, maxRecords: 1 });
    return { ok: true, externalAccountId: whoami.tenantId };
  } catch (error) {
    throw new Error(describeSophosError(error));
  }
}

export async function runTests({ authType, config, secret }) {
  const creds = await resolveSophosCredentials({ authType, config, secret });
  const whoami = await fetchWhoami(creds.getToken);
  const clients = buildClients(creds, whoami);
  const rows = [];
  for (const [area, definitions] of groupTestsByArea(tests)) {
    for (const definition of definitions) {
      try {
        const results = await definition.run(clients);
        for (const result of results) rows.push({ testKey: definition.key, title: definition.title, failTitle: definition.failTitle, severity: definition.severityDefault, ...result });
      } catch (error) {
        const scoped = isScopeError(error);
        rows.push({
          testKey: definition.key,
          title: definition.title,
          failTitle: definition.failTitle,
          severity: definition.severityDefault,
          resourceId: scoped ? "not_applicable" : "error",
          status: scoped ? "not_applicable" : "error",
          message: scoped ? `Sophos "${area}" is unavailable for this tenant or read-only role — ${describeSophosError(error)}` : describeSophosError(error),
          evidencePayload: {},
        });
      }
    }
  }
  return rows;
}
