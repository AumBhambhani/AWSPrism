import { resolvePrivyCredentials } from "./credentials.js";
import { consentTests } from "./tests/consent.js";
import { dataRightsTests } from "./tests/dataRights.js";
import { assessmentsTests } from "./tests/assessments.js";
import { incidentsTests } from "./tests/incidents.js";
import { tprmTests } from "./tests/tprm.js";
import { dataDiscoveryTests } from "./tests/dataDiscovery.js";

export const key = "privy";

export const tests = [
  ...consentTests,
  ...dataRightsTests,
  ...assessmentsTests,
  ...incidentsTests,
  ...tprmTests,
  ...dataDiscoveryTests,
];

// Groups checks by the module segment of their key ("privy.rights.progressing"
// → "rights"), so runTests() can run each Privy module in its own isolation
// boundary — a module the customer hasn't licensed makes that whole module's
// endpoints 403/404, and those checks fall back to not_applicable while every
// other module still runs (mirrors onetrust/index.js's groupTestsByModule).
function groupTestsByModule(allTests) {
  const map = new Map();
  for (const test of allTests) {
    const module = test.key.split(".")[1];
    if (!map.has(module)) map.set(module, []);
    map.get(module).push(test);
  }
  return map;
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function getPath(obj, path) {
  if (!path) return obj;
  return path.split(".").reduce((acc, k) => (acc == null ? acc : acc[k]), obj);
}

// Bearer-API-key fetch client over the tenant base URL. Honours 429 + Retry-After
// with a short bounded backoff; every endpoint the connector calls is read-only.
//
// NOTE: the header name (`Authorization: Bearer` vs `x-api-key`) and every path
// below are built from Privy's documented module behaviour — confirm against the
// target tenant's API reference before this connector leaves beta.
function privyClient(baseUrl, apiKey) {
  async function request(method, path, body) {
    for (let attempt = 0; ; attempt++) {
      const headers = { Authorization: `Bearer ${apiKey}`, Accept: "application/json" };
      if (body !== undefined) headers["Content-Type"] = "application/json";
      const res = await fetch(`${baseUrl}${path}`, {
        method,
        headers,
        body: body !== undefined ? JSON.stringify(body) : undefined,
      });

      if (res.status === 429 && attempt < 3) {
        const retryAfterHeader = Number(res.headers?.get?.("Retry-After"));
        const waitSeconds = Number.isFinite(retryAfterHeader) && retryAfterHeader > 0 ? retryAfterHeader : 2 ** attempt;
        await sleep(Math.min(waitSeconds, 30) * 1000);
        continue;
      }

      if (!res.ok) {
        const text = await res.text();
        throw new Error(`Privy request to ${method} ${path} failed: ${res.status} ${text}`);
      }

      try {
        return await res.json();
      } catch {
        return {}; // 204 / empty body
      }
    }
  }

  return {
    get: (path) => request("GET", path),
    post: (path, body) => request("POST", path, body ?? {}),
  };
}

// 0-based `page` / `pageSize` pagination. Stops on a short page or once a
// reported total / totalPages is reached. Param names / itemsKey vary per module
// so they're all injectable.
async function paginate(
  api,
  path,
  { itemsKey = "data", size = 200, method = "GET", body = null, pageParam = "page", sizeParam = "pageSize", totalPagesKey, totalKey, maxPages = 200 } = {}
) {
  const all = [];
  let page = 0;
  for (;;) {
    const sep = path.includes("?") ? "&" : "?";
    const url = `${path}${sep}${pageParam}=${page}&${sizeParam}=${size}`;
    const data = method === "POST" ? await api.post(url, body || {}) : await api.get(url);
    const items = getPath(data, itemsKey) || [];
    all.push(...items);
    page += 1;
    if (items.length < size) break;
    const totalPages = totalPagesKey != null ? getPath(data, totalPagesKey) : undefined;
    if (totalPages != null && page >= totalPages) break;
    const total = totalKey != null ? getPath(data, totalKey) : undefined;
    if (total != null && all.length >= total) break;
    if (page >= maxPages) break;
  }
  return all;
}

// Assembles the per-run client + the lazily-memoised shared list loaders. A
// loader is fetched at most once per collection run; its rejected promise is
// cached too, so a module-wide 403/404 surfaces to every check in that module
// without re-hitting the API (adapted from onetrust/index.js's buildClients).
function buildClients(creds) {
  const api = privyClient(creds.baseUrl, creds.apiKey);
  const memo = new Map();
  const once = (cacheKey, fn) => {
    if (!memo.has(cacheKey)) memo.set(cacheKey, fn());
    return memo.get(cacheKey);
  };

  return {
    api,
    host: creds.host,

    // --- consent ---
    listConsentCollectionPoints: () =>
      once("consent-points", () =>
        paginate(api, "/api/v1/consent/collection-points", { itemsKey: "data", totalKey: "totalCount" })
      ),
    listConsentArtifacts: () =>
      once("consent-artifacts", () =>
        paginate(api, "/api/v1/consent/artifacts", { itemsKey: "data", totalKey: "totalCount", maxPages: 25 })
      ),

    // --- rights (DPRM) ---
    listRightsRequests: () =>
      once("rights", () =>
        paginate(api, "/api/v1/dsar/requests", { itemsKey: "data", totalKey: "totalCount" })
      ),

    // --- assessments (PIA/DPIA) ---
    listAssessments: () =>
      once("assessments", () =>
        paginate(api, "/api/v1/assessments", { itemsKey: "data", totalKey: "totalCount" })
      ),
    exportAssessment: (id) =>
      once(`assessment-export:${id}`, () => api.get(`/api/v1/assessments/${id}`)),

    // --- incidents ---
    listIncidents: () =>
      once("incidents", () =>
        paginate(api, "/api/v1/incidents", { itemsKey: "data", totalKey: "totalCount" })
      ),
    getIncident: (id) => once(`incident:${id}`, () => api.get(`/api/v1/incidents/${id}`)),

    // --- tprm (third-party / processor risk) ---
    listVendors: () =>
      once("vendors", () =>
        paginate(api, "/api/v1/vendors", { itemsKey: "data", totalKey: "totalCount" })
      ),

    // --- inventory (Data Compass) ---
    listInventory: (type) =>
      once(`inventory:${type}`, () =>
        paginate(api, `/api/v1/data-inventory/${type}`, { itemsKey: "data", totalKey: "totalCount" })
      ),
  };
}

// A module the customer hasn't licensed makes its endpoints return 403 (or 404
// for a disabled module) — that's "not scoped", not a Prism error, so runTests
// downgrades it to not_applicable rather than error.
function isScopeError(err) {
  const m = (err?.message || String(err)).toLowerCase();
  return (
    m.includes(" 403") ||
    m.includes(" 404") ||
    m.includes("forbidden") ||
    m.includes("not found") ||
    m.includes("not enabled") ||
    m.includes("not licensed") ||
    m.includes("access denied")
  );
}

export function describePrivyError(err) {
  const message = err?.message || String(err);
  const lower = message.toLowerCase();

  if (lower.includes(" 429") || lower.includes("rate limit") || lower.includes("too many requests")) {
    return `${message} — Privy rate limit hit. Reduce the collection frequency for this connection if this recurs.`;
  }

  if (lower.includes(" 401") || lower.includes("invalid token") || lower.includes("unauthorized") || lower.includes("invalid api key")) {
    return (
      `${message} — Privy authentication failed. Re-check the API key, or issue a fresh one from ` +
      `Privy → Settings → API Keys (or ask your IDfy account team).`
    );
  }

  if (lower.includes(" 403") || lower.includes("forbidden") || lower.includes(" 404") || lower.includes("not found")) {
    return (
      `${message} — Privy rejected the request. The API key's tenant likely does not have this module ` +
      `(Consent, DPRM, Assessments, Incidents, TPRM, Data Discovery) enabled.`
    );
  }

  if (lower.includes("config.baseurl")) {
    return message;
  }

  return `${message} — verify the Privy tenant domain and that the API key can read every module Prism's Privy checks require.`;
}

export async function testConnection({ authType, config, secret }) {
  const creds = await resolvePrivyCredentials({ authType, config, secret });
  const api = privyClient(creds.baseUrl, creds.apiKey);
  try {
    // Cheapest list endpoint — the consent collection points.
    const data = await api.get("/api/v1/consent/collection-points?page=0&pageSize=1");
    const org = data?.organization ?? data?.tenant ?? data?.meta?.organization;
    const externalAccountId = String(org?.id ?? org?.name ?? org ?? creds.host);
    return { ok: true, externalAccountId };
  } catch (err) {
    throw new Error(describePrivyError(err));
  }
}

export async function runTests({ authType, config, secret }) {
  const creds = await resolvePrivyCredentials({ authType, config, secret });
  const clients = buildClients(creds);
  const runResults = [];

  for (const [module, moduleTests] of groupTestsByModule(tests)) {
    for (const test of moduleTests) {
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
            ? `Privy "${module}" module is not accessible with this API key — ${describePrivyError(err)}`
            : describePrivyError(err),
          evidencePayload: {},
        });
      }
    }
  }

  return runResults;
}
