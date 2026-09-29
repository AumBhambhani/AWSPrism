const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

// Thin bearer-token fetch client over a ServiceNow instance's Table API. Every
// call the connector makes is a read-only GET against `/api/now/table/{table}`;
// there is no write path. 429s are retried with a bounded exponential backoff,
// honouring `Retry-After` when the instance returns one (ServiceNow's REST rate
// limits are instance-configured, not universal).
export function serviceNowClient(baseUrl, getToken) {
  async function request(method, path) {
    for (let attempt = 0; ; attempt++) {
      const token = await getToken();
      const res = await fetch(`${baseUrl}${path}`, {
        method,
        headers: { Authorization: `Bearer ${token}`, Accept: "application/json" },
      });

      if (res.status === 429 && attempt < 3) {
        const retryAfterHeader = Number(res.headers?.get?.("Retry-After"));
        const waitSeconds =
          Number.isFinite(retryAfterHeader) && retryAfterHeader > 0 ? retryAfterHeader : 2 ** attempt;
        await sleep(Math.min(waitSeconds, 30) * 1000);
        continue;
      }

      if (!res.ok) {
        const text = await res.text();
        throw new Error(`ServiceNow request to ${method} ${path} failed: ${res.status} ${text}`);
      }

      try {
        return await res.json();
      } catch {
        return {};
      }
    }
  }

  // GET /api/now/table/{table} with `sysparm_offset` pagination. Stops on a short
  // page or once `maxRecords` is reached. Offset paging re-executes the query per
  // page on the ServiceNow side, so callers keep the page size modest and prefer
  // a narrow `query` filter over walking an entire table.
  async function listTable(
    table,
    { query, fields, displayValue, limit = 250, maxRecords = 10000 } = {}
  ) {
    const all = [];
    let offset = 0;
    for (;;) {
      const params = new URLSearchParams();
      if (query) params.set("sysparm_query", query);
      if (fields && fields.length) params.set("sysparm_fields", fields.join(","));
      if (displayValue) params.set("sysparm_display_value", String(displayValue));
      params.set("sysparm_exclude_reference_link", "true");
      params.set("sysparm_limit", String(limit));
      params.set("sysparm_offset", String(offset));
      const data = await request("GET", `/api/now/table/${table}?${params.toString()}`);
      const rows = Array.isArray(data?.result) ? data.result : [];
      all.push(...rows);
      if (rows.length < limit) break;
      offset += limit;
      if (all.length >= maxRecords) break;
    }
    return all;
  }

  // Aggregate count via the stats API — `sysparm_count` avoids paging a whole
  // table when a check only needs "how many". Returns `null` if the instance
  // doesn't expose the aggregate endpoint to this account.
  async function countTable(table, query) {
    const params = new URLSearchParams({ sysparm_count: "true" });
    if (query) params.set("sysparm_query", query);
    const data = await request("GET", `/api/now/stats/${table}?${params.toString()}`);
    const raw = data?.result?.stats?.count;
    const n = Number(raw);
    return Number.isFinite(n) ? n : null;
  }

  return { request, listTable, countTable };
}
