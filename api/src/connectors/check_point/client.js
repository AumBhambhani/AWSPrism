// Thin fetch wrapper for the Check Point Infinity Portal cloud APIs (Infinity
// Events, Infinity XDR/XPR, Harmony Endpoint). Every call carries a bearer token
// from /auth/external; Harmony Endpoint additionally issues its own
// `x-mgmt-api-token` which callers pass through `headers`. 429s are retried with
// Retry-After honoured.

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function addQuery(path, query) {
  const url = new URL(path, "https://placeholder.invalid");
  for (const [key, raw] of Object.entries(query || {})) {
    if (raw == null || raw === "") continue;
    for (const value of Array.isArray(raw) ? raw : [raw]) url.searchParams.append(key, String(value));
  }
  return `${url.pathname}${url.search}`;
}

export function checkPointInfinityClient({ gatewayUrl, getToken }) {
  const base = gatewayUrl.replace(/\/$/, "");

  async function request(method, path, { body, query, headers } = {}) {
    const requestPath = addQuery(path, query);
    for (let attempt = 0; ; attempt += 1) {
      const finalHeaders = {
        Authorization: `Bearer ${await getToken()}`,
        Accept: "application/json",
        ...(headers || {}),
      };
      if (body !== undefined) finalHeaders["Content-Type"] = "application/json";
      const response = await fetch(`${base}${requestPath}`, {
        method,
        headers: finalHeaders,
        body: body === undefined ? undefined : JSON.stringify(body),
      });
      if (response.status === 429 && attempt < 4) {
        const retryAfter = Number(response.headers?.get?.("Retry-After"));
        await sleep(Math.min(Number.isFinite(retryAfter) && retryAfter > 0 ? retryAfter : 2 ** attempt, 30) * 1_000);
        continue;
      }
      const text = await response.text();
      let json = {};
      try {
        json = text ? JSON.parse(text) : {};
      } catch {
        json = {};
      }
      if (!response.ok) {
        const detail = json?.message || json?.error || text || `HTTP ${response.status}`;
        throw new Error(`Check Point Infinity ${method} ${requestPath} failed: HTTP ${response.status} ${detail}`);
      }
      return json;
    }
  }

  // Cursor / nextPage pagination used by the cloud list endpoints.
  async function paginate(method, path, { body = {}, query = {}, itemKeys = ["objects", "records", "data", "items"], headers } = {}) {
    const out = [];
    let cursor = null;
    for (let calls = 0; calls < 50; calls += 1) {
      const pageBody = method === "GET" ? undefined : { ...body, ...(cursor ? { cursor, pageToken: cursor } : {}) };
      const pageQuery = method === "GET" ? { ...query, ...(cursor ? { cursor } : {}) } : query;
      const data = await request(method, path, { body: pageBody, query: pageQuery, headers });
      let batch = null;
      for (const key of itemKeys) {
        if (Array.isArray(data?.[key])) {
          batch = data[key];
          break;
        }
      }
      if (!batch && Array.isArray(data)) batch = data;
      if (!batch) throw new Error(`Check Point Infinity ${path} response did not contain a records array (${itemKeys.join("/")})`);
      out.push(...batch);
      cursor = data?.nextPageToken || data?.next_cursor || data?.cursor || data?.pagination?.next || null;
      if (!cursor || batch.length === 0) break;
    }
    return out;
  }

  return { request, paginate };
}
