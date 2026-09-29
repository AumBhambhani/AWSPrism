// Thin wrapper over the CloudGuard (Dome9) REST API. HTTP Basic auth on every
// call; most GET endpoints return an array directly, a few return
// { <items>, totalItems } with pageNumber/pageSize paging. 429s are retried.

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function addQuery(path, query) {
  const url = new URL(path, "https://placeholder.invalid");
  for (const [key, raw] of Object.entries(query || {})) {
    if (raw == null || raw === "") continue;
    for (const value of Array.isArray(raw) ? raw : [raw]) url.searchParams.append(key, String(value));
  }
  return `${url.pathname}${url.search}`;
}

export function checkPointCloudguardClient({ baseUrl, authHeader }) {
  const base = baseUrl.replace(/\/$/, "");

  async function request(method, path, { body, query } = {}) {
    const requestPath = addQuery(path, query);
    for (let attempt = 0; ; attempt += 1) {
      const headers = { Authorization: authHeader, Accept: "application/json" };
      if (body !== undefined) headers["Content-Type"] = "application/json";
      const response = await fetch(`${base}${requestPath}`, {
        method,
        headers,
        body: body === undefined ? undefined : JSON.stringify(body),
      });
      if (response.status === 429 && attempt < 4) {
        const retryAfter = Number(response.headers?.get?.("Retry-After"));
        await sleep(Math.min(Number.isFinite(retryAfter) && retryAfter > 0 ? retryAfter : 2 ** attempt, 30) * 1_000);
        continue;
      }
      const text = await response.text();
      let json = null;
      try {
        json = text ? JSON.parse(text) : null;
      } catch {
        json = null;
      }
      if (!response.ok) {
        const detail = json?.message || json?.error || text || `HTTP ${response.status}`;
        throw new Error(`CloudGuard ${method} ${requestPath} failed: HTTP ${response.status} ${detail}`);
      }
      return json;
    }
  }

  async function search(path, filter, { itemsKey = "findings", totalKey = "totalFindings", pageSize = 500, maxRecords = 5000 } = {}) {
    const out = [];
    let pageNumber = 0;
    for (let calls = 0; calls < 50; calls += 1) {
      const data = await request("POST", path, { body: { pageSize, pageNumber, filter: filter || {} } });
      const batch = Array.isArray(data?.[itemsKey]) ? data[itemsKey] : Array.isArray(data) ? data : null;
      if (!batch) throw new Error(`CloudGuard ${path} response is missing a ${itemsKey} array`);
      out.push(...batch);
      const total = Number(data?.[totalKey]);
      if (out.length >= maxRecords || batch.length === 0 || (Number.isFinite(total) && out.length >= total)) break;
      pageNumber += 1;
    }
    return out.slice(0, maxRecords);
  }

  return { request, search };
}
