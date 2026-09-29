import { resolveOneTrustCredentials } from "./credentials.js";
import { assessmentsTests } from "./tests/assessments.js";
import { inventoryTests } from "./tests/inventory.js";
import { privacyRightsTests } from "./tests/privacyRights.js";
import { incidentsTests } from "./tests/incidents.js";
import { riskTests } from "./tests/risk.js";
import { vendorsTests } from "./tests/vendors.js";

export const key = "onetrust";

export const tests = [
  ...assessmentsTests,
  ...inventoryTests,
  ...privacyRightsTests,
  ...incidentsTests,
  ...riskTests,
  ...vendorsTests,
];

// Groups checks by the module segment of their key ("onetrust.dsar.progressing"
// → "dsar"), so runTests() can run each OneTrust module in its own isolation
// boundary — a scope the customer hasn't licensed makes that whole module's
// endpoints 403, and those checks fall back to not_applicable while every other
// module still runs (mirrors zoho/index.js's groupTestsByProduct).
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

// Bearer-token fetch client over the tenant base URL. Honours 429 + Retry-After
// (OneTrust's account-level limits are generous — 20k/min — so a 429 is rare and
// a short bounded backoff is enough); every endpoint the connector calls is
// read-only.
function otClient(baseUrl, getToken) {
  async function request(method, path, body) {
    for (let attempt = 0; ; attempt++) {
      const token = await getToken();
      const headers = { Authorization: `Bearer ${token}` };
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
        throw new Error(`OneTrust request to ${method} ${path} failed: ${res.status} ${text}`);
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

// 0-based `page` / `size` pagination (GET or POST). Stops on a short page or once
// a reported total / totalPages is reached. `itemsKey` and the page/size param
// names vary per OneTrust module, so they're all injectable.
async function paginatePage(
  ot,
  path,
  { itemsKey, size = 200, method = "GET", body = null, pageParam = "page", sizeParam = "size", totalPagesKey, totalKey, maxPages = 200 } = {}
) {
  const all = [];
  let page = 0;
  for (;;) {
    const sep = path.includes("?") ? "&" : "?";
    const url = `${path}${sep}${pageParam}=${page}&${sizeParam}=${size}`;
    const data = method === "POST" ? await ot.post(url, body || {}) : await ot.get(url);
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

// `limit` / `offset` pagination (GET or POST — for POST the limit/offset are also
// merged into the request body, which OneTrust's search endpoints expect).
async function paginateOffset(
  ot,
  path,
  { itemsKey, limit = 200, method = "GET", body = null, totalKey = "totalCount", maxRecords = 20000 } = {}
) {
  const all = [];
  let offset = 0;
  for (;;) {
    const sep = path.includes("?") ? "&" : "?";
    const url = `${path}${sep}limit=${limit}&offset=${offset}`;
    const data =
      method === "POST" ? await ot.post(url, { ...(body || {}), limit, offset }) : await ot.get(url);
    const items = getPath(data, itemsKey) || [];
    all.push(...items);
    offset += limit;
    if (items.length < limit) break;
    const total = totalKey != null ? getPath(data, totalKey) : undefined;
    if (total != null && all.length >= total) break;
    if (all.length >= maxRecords) break;
  }
  return all;
}

// Assembles the per-run client + the lazily-memoised shared list loaders. A
// loader is fetched at most once per collection run; its rejected promise is
// cached too, so a module-wide 403 surfaces to every check in that module
// without re-hitting the API (github/index.js's buildClients pre-fetch, adapted
// to lazy so an unlicensed module never blocks the licensed ones).
function buildClients(creds) {
  const ot = otClient(creds.baseUrl, creds.getToken);
  const memo = new Map();
  const once = (cacheKey, fn) => {
    if (!memo.has(cacheKey)) memo.set(cacheKey, fn());
    return memo.get(cacheKey);
  };

  return {
    ot,
    hostname: creds.hostname,

    listAssessments: () =>
      once("assessments", () =>
        paginatePage(ot, "/api/assessment/v2/assessments", {
          itemsKey: "assessments",
          size: 500,
          totalKey: "totalResults",
        })
      ),

    exportAssessment: (id) =>
      once(`assessment-export:${id}`, () => ot.get(`/api/assessment/v2/assessments/${id}/export`)),

    // NOTE: the exact base path for the data-inventory module (`/api/inventory/v2`
    // vs `/api/datamapping/v3`) should be confirmed against the live OneTrust API
    // reference for the target tenant when this is exercised end-to-end.
    listInventory: (type) =>
      once(`inventory:${type}`, () =>
        paginatePage(ot, `/api/inventory/v2/inventories/${type}`, {
          itemsKey: "data",
          size: 500,
          pageParam: "page",
          sizeParam: "pageSize",
          totalPagesKey: "meta.page.totalPages",
        })
      ),

    listDsarQueues: () =>
      once("dsar", () =>
        paginateOffset(ot, "/api/datasubject/v2/requestqueues", {
          itemsKey: "requestQueues",
          limit: 200,
        })
      ),

    listIncidents: () =>
      once("incidents", () =>
        paginateOffset(ot, "/api/incident/v2/incidents/search", {
          itemsKey: "incidents",
          method: "POST",
          body: { sortBy: "createdDate", sortOrder: "DESC" },
          limit: 200,
        })
      ),

    getIncident: (id) => once(`incident:${id}`, () => ot.get(`/api/incident/v2/incidents/${id}`)),

    listRisks: () =>
      once("risks", () =>
        paginatePage(ot, "/api/risk/v2/risks/pages", {
          itemsKey: "content",
          method: "POST",
          body: { filters: {}, fullTextSearch: "" },
          size: 50,
          totalPagesKey: "totalPages",
        })
      ),
  };
}

// A missing OAuth scope makes a whole OneTrust module's endpoints return 403 —
// that's "customer hasn't licensed / scoped this module", not a Prism error, so
// runTests downgrades it to not_applicable rather than error.
function isScopeError(err) {
  const m = (err?.message || String(err)).toLowerCase();
  return m.includes(" 403") || m.includes("forbidden") || m.includes("access denied") || m.includes("not authorized");
}

export function describeOneTrustError(err) {
  const message = err?.message || String(err);
  const lower = message.toLowerCase();

  if (lower.includes(" 429") || lower.includes("rate limit") || lower.includes("too many requests")) {
    return (
      `${message} — OneTrust rate limit hit. Limits are account-level (≈20,000/min, 200,000/hr); ` +
      `reduce the collection frequency for this connection if this recurs.`
    );
  }

  if (lower.includes(" 401") || lower.includes("invalid_client") || lower.includes("invalid token") || lower.includes("unauthorized")) {
    return (
      `${message} — OneTrust authentication failed. Re-check the Client ID / Client Secret, or mint a fresh ` +
      `Client Credential under Global Settings → Access Management → Client Credentials.`
    );
  }

  if (lower.includes(" 403") || lower.includes("forbidden")) {
    return (
      `${message} — OneTrust rejected the request as forbidden. The Client Credential is likely missing a ` +
      `read scope for this module (ASSESSMENT_READ, INVENTORY_READ, DSAR_READ, INCIDENT_READ, RISK, VRM_READ).`
    );
  }

  if (lower.includes("invalid config.hostname") || lower.includes("missing config.hostname")) {
    return message;
  }

  return `${message} — verify the tenant hostname and that the Client Credential carries every read scope Prism's OneTrust checks require.`;
}

export async function testConnection({ authType, config, secret }) {
  const creds = await resolveOneTrustCredentials({ authType, config, secret });
  const ot = otClient(creds.baseUrl, creds.getToken);
  try {
    const data = await ot.get("/api/access/v1/external/organizations");
    const orgs = Array.isArray(data) ? data : data?.organizations || data?.data || [];
    const first = orgs[0] || {};
    const externalAccountId = String(first.id ?? first.organizationId ?? first.name ?? creds.hostname);
    return { ok: true, externalAccountId };
  } catch (err) {
    throw new Error(describeOneTrustError(err));
  }
}

export async function runTests({ authType, config, secret }) {
  const creds = await resolveOneTrustCredentials({ authType, config, secret });
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
            ? `OneTrust "${module}" module is not accessible with the granted scopes — ${describeOneTrustError(err)}`
            : describeOneTrustError(err),
          evidencePayload: {},
        });
      }
    }
  }

  return runResults;
}
