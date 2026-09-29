import { resolveCheckPointCredentials } from "./credentials.js";
import { checkPointInfinityClient } from "./client.js";
import { eventsTests } from "./tests/events.js";
import { xdrTests } from "./tests/xdr.js";
import { endpointTests } from "./tests/endpoint.js";

export const key = "check_point";

export const tests = [...eventsTests, ...xdrTests, ...endpointTests];

export const THRESHOLDS = {
  EVENTS_LOOKBACK_HOURS: 24,
  EVENT_TRIAGE_SLA_HOURS: 48,
  XDR_LOOKBACK_DAYS: 14,
  XDR_TRIAGE_SLA_HOURS: 48,
  XDR_STALE_INVESTIGATION_DAYS: 7,
  STALE_DEVICE_DAYS: 30,
  SIGNATURE_MAX_AGE_DAYS: 7,
  ENDPOINT_INCIDENT_REVIEW_DAYS: 7,
};

const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

// Maps a check's area (events / xdr / endpoint) to the Infinity Portal service
// whose API key it needs.
const AREA_SERVICE = { events: "events", xdr: "xdr", endpoint: "endpoint" };

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
  return [
    "http 403",
    "http 404",
    "forbidden",
    "no api key configured",
    "not licensed",
    "not entitled",
    "not subscribed",
    "unauthorized for this service",
    "access denied",
  ].some((part) => message.includes(part));
}

export function describeCheckPointError(error) {
  const message = error?.message || String(error);
  const lower = message.toLowerCase();
  if (lower.includes("http 429") || lower.includes("rate limit")) {
    return `${message} — the Infinity Portal API is rate limiting; lower this connection's collection frequency.`;
  }
  if (lower.includes("http 401") || lower.includes("token request failed") || lower.includes("invalid_client")) {
    return `${message} — Infinity Portal authentication failed. Re-check the Client ID / Secret Key and that the key's region matches config.gatewayUrl.`;
  }
  if (lower.includes("no api key configured")) {
    return `${message} — add an Infinity Portal API key scoped to this service, or leave it unset to skip this area.`;
  }
  if (lower.includes("http 403") || lower.includes("forbidden")) {
    return `${message} — the API key is not authorised for this service. Scope the key to Logs/Events, Endpoint or XDR as needed.`;
  }
  return `${message} — verify the Infinity Portal API key and the regional gateway URL.`;
}

function serviceClient(gatewayUrl, getToken, service) {
  if (!getToken) {
    return null;
  }
  return checkPointInfinityClient({ gatewayUrl, getToken });
}

export function buildClients(resolved) {
  const { gatewayUrl, services } = resolved;
  const eventsApi = serviceClient(gatewayUrl, services.events, "events");
  const xdrApi = serviceClient(gatewayUrl, services.xdr, "xdr");
  const endpointApi = serviceClient(gatewayUrl, services.endpoint, "endpoint");

  const memo = new Map();
  const once = (name, loader) => {
    if (!memo.has(name)) memo.set(name, loader());
    return memo.get(name);
  };

  const requireApi = (api, service) => {
    if (!api) throw new Error(`Check Point Infinity service "${service}" has no API key configured (HTTP 404)`);
    return api;
  };

  // Harmony Endpoint issues its own session token from the Infinity bearer.
  const endpointToken = () => once("endpoint-session", async () => {
    const api = requireApi(endpointApi, "endpoint");
    const login = await api.request("POST", "/app/endpoint-web-mgmt/harmony/endpoint/api/v1/session/login/cloud", { body: {} });
    const token = login?.token || login?.apiToken || login?.data?.token || login?.["x-mgmt-api-token"];
    if (!token) throw new Error("Harmony Endpoint session/login response is missing an api token");
    return token;
  });

  const endpointRequest = async (method, path, opts = {}) => {
    const api = requireApi(endpointApi, "endpoint");
    const token = await endpointToken();
    return api.request(method, path, { ...opts, headers: { ...(opts.headers || {}), "x-mgmt-api-token": token } });
  };

  // Harmony Endpoint list endpoints run as async jobs — POST returns a job id,
  // GET .../jobs/{id} yields the result. Poll briefly, then hand back the data.
  const endpointJob = async (path, body) => {
    const started = await endpointRequest("POST", path, { body: body || {} });
    if (Array.isArray(started?.objects) || Array.isArray(started?.data)) return started;
    const jobId = started?.jobId || started?.id || started?.data?.jobId;
    if (!jobId) throw new Error(`Harmony Endpoint ${path} did not return data or a job id`);
    for (let attempt = 0; attempt < 20; attempt += 1) {
      await wait(500);
      const status = await endpointRequest("GET", `/app/endpoint-web-mgmt/harmony/endpoint/api/v1/jobs/${encodeURIComponent(jobId)}`);
      const state = String(status?.status ?? status?.state ?? "").toLowerCase();
      if (state === "done" || state === "completed" || state === "success") return status?.data ?? status;
      if (state === "failed" || state === "error") throw new Error(`Harmony Endpoint job ${jobId} failed`);
    }
    throw new Error(`Harmony Endpoint job ${jobId} did not finish before the collection timeout`);
  };

  const collectionOf = (data, keys = ["objects", "data", "records", "items", "computers", "policies"]) => {
    if (Array.isArray(data)) return data;
    for (const k of keys) if (Array.isArray(data?.[k])) return data[k];
    return null;
  };

  return {
    THRESHOLDS,
    queryEvents: () => once("events", async () => {
      const api = requireApi(eventsApi, "events");
      const fromIso = new Date(Date.now() - THRESHOLDS.EVENTS_LOOKBACK_HOURS * 3_600_000).toISOString();
      const started = await api.request("POST", "/app/laas-logs-api/api/logs_query", {
        body: { limit: 1000, timeframe: { startTime: fromIso, endTime: new Date().toISOString() }, pageLimit: 1000 },
      });
      const queryId = started?.queryId || started?.id || started?.data?.queryId;
      let result = started;
      if (queryId && !Array.isArray(started?.records)) {
        for (let attempt = 0; attempt < 20; attempt += 1) {
          await wait(600);
          result = await api.request("GET", `/app/laas-logs-api/api/logs_query/${encodeURIComponent(queryId)}`);
          const state = String(result?.status ?? result?.state ?? "").toLowerCase();
          if (!state || state === "ready" || state === "done" || state === "completed" || state === "success") break;
          if (state === "failed" || state === "error") throw new Error("Infinity Events query failed");
        }
      }
      const records = collectionOf(result, ["records", "logs", "data", "objects", "results"]);
      if (!records) throw new Error("Infinity Events query response is missing a records array");
      return { records, total: Number(result?.total ?? result?.recordsCount ?? records.length) };
    }),
    listXdrIncidents: () => once("xdr", async () => {
      const api = requireApi(xdrApi, "xdr");
      const fromIso = new Date(Date.now() - THRESHOLDS.XDR_LOOKBACK_DAYS * 86_400_000).toISOString();
      const data = await api.request("POST", "/app/xdr/api/xdr/v1/incidents", { body: { since: fromIso, limit: 500 } });
      const list = collectionOf(data, ["incidents", "objects", "data", "records", "items"]);
      if (!list) throw new Error("Infinity XDR/XPR incidents response is missing an array");
      return list;
    }),
    listEndpointComputers: () => once("endpoint-computers", async () => {
      const data = await endpointJob("/app/endpoint-web-mgmt/harmony/endpoint/api/v1/asset-management/computers/filtered", { filters: [], paging: { pageSize: 500, offset: 0 } });
      const list = collectionOf(data, ["computers", "objects", "data", "records", "items"]);
      if (!list) throw new Error("Harmony Endpoint computers response is missing an array");
      return list;
    }),
    listEndpointPolicies: () => once("endpoint-policies", async () => {
      const data = await endpointRequest("GET", "/app/endpoint-web-mgmt/harmony/endpoint/api/v1/policy");
      const list = collectionOf(data, ["policies", "objects", "data", "rules", "items"]);
      if (!list) throw new Error("Harmony Endpoint policy response is missing an array");
      return list;
    }),
    listEndpointIncidents: () => once("endpoint-incidents", async () => {
      const data = await endpointJob("/app/endpoint-web-mgmt/harmony/endpoint/api/v1/incidents/filtered", { filters: [], paging: { pageSize: 500, offset: 0 } });
      const list = collectionOf(data, ["incidents", "objects", "data", "records", "items"]);
      if (!list) throw new Error("Harmony Endpoint incidents response is missing an array");
      return list;
    }),
  };
}

export async function testConnection({ authType, config, secret }) {
  const resolved = await resolveCheckPointCredentials({ authType, config, secret });
  try {
    // Mint a token for whichever service has a key — a successful /auth/external
    // exchange confirms connectivity and credential validity.
    const getter = resolved.services.events || resolved.services.xdr || resolved.services.endpoint;
    await getter();
    return { ok: true, externalAccountId: resolved.region ? `${resolved.gatewayUrl} (${resolved.region})` : resolved.gatewayUrl };
  } catch (error) {
    throw new Error(describeCheckPointError(error));
  }
}

export async function runTests({ authType, config, secret }) {
  const resolved = await resolveCheckPointCredentials({ authType, config, secret });
  const clients = buildClients(resolved);
  const rows = [];
  for (const [area, definitions] of groupTestsByArea(tests)) {
    const service = AREA_SERVICE[area];
    const hasKey = Boolean(resolved.services[service]);
    for (const definition of definitions) {
      if (!hasKey) {
        rows.push({
          testKey: definition.key,
          title: definition.title,
          failTitle: definition.failTitle,
          severity: definition.severityDefault,
          resourceId: "not_applicable",
          status: "not_applicable",
          message: `No Infinity Portal API key is configured for the "${service}" service, so this check was skipped.`,
          evidencePayload: {},
        });
        continue;
      }
      try {
        const results = await definition.run(clients);
        for (const result of results) {
          rows.push({ testKey: definition.key, title: definition.title, failTitle: definition.failTitle, severity: definition.severityDefault, ...result });
        }
      } catch (error) {
        const scoped = isScopeError(error);
        rows.push({
          testKey: definition.key,
          title: definition.title,
          failTitle: definition.failTitle,
          severity: definition.severityDefault,
          resourceId: scoped ? "not_applicable" : "error",
          status: scoped ? "not_applicable" : "error",
          message: scoped
            ? `The Check Point Infinity "${area}" service is unavailable to this API key — ${describeCheckPointError(error)}`
            : describeCheckPointError(error),
          evidencePayload: {},
        });
      }
    }
  }
  return rows;
}
