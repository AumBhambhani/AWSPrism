const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

// Thin bearer-token fetch client over a Salesforce org's REST + Tooling APIs.
// Every call the connector makes is a read-only SOQL/Tooling query or a metadata
// read; there is no write path.
//
// - `query()` runs SOQL via GET /services/data/{v}/query and follows
//   `nextRecordsUrl` until `done: true` (REST SOQL pages cap at 2,000 rows).
// - `toolingQuery()` runs the same shape against .../tooling/query — the Tooling
//   API is a SOQL superset that additionally exposes Setup-only entities
//   (ProfilePasswordPolicy, SecuritySettings, PermissionSet system flags) that
//   plain SOQL can't see.
// - The `Sforce-Limit-Info` response header (`api-usage=X/Y`) is parsed and a
//   warning logged as daily API consumption approaches the org ceiling.
//
// 429 / 503 responses are retried with a bounded backoff honouring `Retry-After`
// when present. `getAuth()` returns `{ accessToken, instanceUrl }` — the pod
// host comes from the JWT token exchange, never hardcoded.
export function salesforceClient(getAuth, apiVersion) {
  let lastApiUsage = null; // { used, limit } from the most recent response

  function parseLimitInfo(headers) {
    const raw = headers?.get?.("Sforce-Limit-Info") || headers?.get?.("sforce-limit-info");
    if (!raw) return;
    const m = String(raw).match(/api-usage=(\d+)\/(\d+)/i);
    if (!m) return;
    const used = Number(m[1]);
    const limit = Number(m[2]);
    lastApiUsage = { used, limit };
    if (limit > 0 && used / limit >= 0.9) {
      console.warn(
        `[salesforce] org API usage at ${used}/${limit} (${Math.round((used / limit) * 100)}%) — ` +
          `evidence collection is approaching the 24h request ceiling`
      );
    }
  }

  async function request(method, path, { body, absolute = false } = {}) {
    for (let attempt = 0; ; attempt++) {
      const { accessToken, instanceUrl } = await getAuth();
      const url = absolute ? (path.startsWith("http") ? path : `${instanceUrl}${path}`) : `${instanceUrl}${path}`;
      const headers = { Authorization: `Bearer ${accessToken}`, Accept: "application/json" };
      if (body !== undefined) headers["Content-Type"] = "application/json";

      const res = await fetch(url, {
        method,
        headers,
        body: body !== undefined ? JSON.stringify(body) : undefined,
      });
      parseLimitInfo(res.headers);

      if ((res.status === 429 || res.status === 503) && attempt < 3) {
        const retryAfter = Number(res.headers?.get?.("Retry-After"));
        const waitSeconds = Number.isFinite(retryAfter) && retryAfter > 0 ? retryAfter : 2 ** attempt;
        await sleep(Math.min(waitSeconds, 30) * 1000);
        continue;
      }

      if (!res.ok) {
        const text = await res.text();
        // Salesforce error bodies are a JSON array: [{ errorCode, message }].
        let detail = text;
        try {
          const parsed = JSON.parse(text);
          if (Array.isArray(parsed) && parsed[0]) {
            detail = `${parsed[0].errorCode || ""} ${parsed[0].message || ""}`.trim();
          }
        } catch {
          /* keep raw text */
        }
        throw new Error(`Salesforce request to ${method} ${path} failed: ${res.status} ${detail}`);
      }

      try {
        return await res.json();
      } catch {
        return {};
      }
    }
  }

  // Walk a SOQL result set, following `nextRecordsUrl` (an absolute-ish path like
  // /services/data/v61.0/query/01g...-2000) until `done`. `maxRecords` is a hard
  // safety stop.
  async function runQuery(basePath, soql, { maxRecords = 20000 } = {}) {
    const records = [];
    let data = await request("GET", `${basePath}?q=${encodeURIComponent(soql)}`);
    for (;;) {
      records.push(...(Array.isArray(data?.records) ? data.records : []));
      if (data?.done !== false || !data?.nextRecordsUrl) break;
      if (records.length >= maxRecords) break;
      data = await request("GET", data.nextRecordsUrl, { absolute: true });
    }
    return records;
  }

  const query = (soql, opts) => runQuery(`/services/data/${apiVersion}/query/`, soql, opts);
  const toolingQuery = (soql, opts) => runQuery(`/services/data/${apiVersion}/tooling/query/`, soql, opts);

  // GET an arbitrary REST resource (e.g. /services/data/{v}/limits or a specific
  // sobject row). Returns the parsed JSON body.
  const get = (path) => request("GET", path.startsWith("/services/") ? path : `/services/data/${apiVersion}${path}`);

  return {
    request,
    query,
    toolingQuery,
    get,
    getApiUsage: () => lastApiUsage,
  };
}
