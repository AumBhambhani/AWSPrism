const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function addQuery(path, query) {
  const url = new URL(path, "https://placeholder.invalid");
  for (const [key, raw] of Object.entries(query || {})) {
    if (raw == null || raw === "") continue;
    for (const value of Array.isArray(raw) ? raw : [raw]) url.searchParams.append(key, String(value));
  }
  return `${url.pathname}${url.search}`;
}

export function sophosClient({ getToken, whoami }) {
  if (!whoami?.tenantId || !whoami?.dataRegionHost) throw new Error("Sophos client requires whoami tenant routing");

  async function request(method, path, { query, body, host } = {}) {
    const requestPath = addQuery(path, query);
    const baseUrl = (host || whoami.dataRegionHost).replace(/\/$/, "");
    for (let attempt = 0; ; attempt += 1) {
      const headers = {
        Authorization: `Bearer ${await getToken()}`,
        "X-Tenant-ID": whoami.tenantId,
        Accept: "application/json",
      };
      if (body !== undefined) headers["Content-Type"] = "application/json";
      const response = await fetch(`${baseUrl}${requestPath}`, {
        method,
        headers,
        body: body === undefined ? undefined : JSON.stringify(body),
      });
      if (response.status === 429 && attempt < 4) {
        const retryAfter = Number(response.headers?.get?.("Retry-After"));
        await sleep(Math.min(Number.isFinite(retryAfter) && retryAfter > 0 ? retryAfter : 2 ** attempt, 30) * 1_000);
        continue;
      }
      if (!response.ok) {
        const text = await response.text();
        throw new Error(`Sophos request to ${method} ${requestPath} failed: HTTP ${response.status} ${text}`);
      }
      if (response.status === 204) return {};
      try {
        return await response.json();
      } catch {
        return {};
      }
    }
  }

  async function paginate(path, { query = {}, itemKey = "items", pageSize = 100, maxRecords = 20_000 } = {}) {
    const out = [];
    let page = 1;
    let nextKey = null;
    let cursor = null;
    for (let calls = 0; calls < 200; calls += 1) {
      const pageQuery = { ...query, pageSize, pageTotal: true };
      if (nextKey) pageQuery.pageFromKey = nextKey;
      else if (cursor) pageQuery.cursor = cursor;
      else if (page > 1) pageQuery.page = page;
      const data = await request("GET", path, { query: pageQuery });
      const batch = Array.isArray(data?.[itemKey]) ? data[itemKey] : Array.isArray(data) ? data : null;
      if (!batch) throw new Error(`Sophos ${path} response did not contain an ${itemKey} array`);
      out.push(...batch);
      if (out.length >= maxRecords) break;

      nextKey = data?.pages?.nextKey || null;
      cursor = data?.next_cursor || null;
      const current = Number(data?.pages?.current);
      const total = Number(data?.pages?.total);
      if (nextKey || cursor) continue;
      if (Number.isFinite(current) && Number.isFinite(total) && current < total) {
        page = current + 1;
        continue;
      }
      break;
    }
    return out.slice(0, maxRecords);
  }

  return { request, paginate };
}
