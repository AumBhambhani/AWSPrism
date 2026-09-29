const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

// Thin bearer-token fetch client over the Acronis Cyber Protect Cloud REST API.
// Every call the connector makes is a read-only GET; there is no write path.
//
// Acronis has no official Node SDK, so unlike the AWS / Azure connectors this
// client hand-rolls what an SDK would give for free: bearer-token injection,
// bounded 429 retry, and cursor pagination.
//
// Two pagination shapes appear:
//   - alert_manager/v1/alerts        → { items: [...], paging: { cursors: { next } } }
//   - resource_management/v4/...      → { items: [...] } (not documented as
//     paginated; `fetchAll` still follows a cursor if one appears, defensively).
export function acronisClient(datacenterUrl, getToken) {
  async function request(method, path) {
    for (let attempt = 0; ; attempt++) {
      const token = await getToken();
      const res = await fetch(`${datacenterUrl}${path}`, {
        method,
        headers: { Authorization: `Bearer ${token}`, Accept: "application/json" },
      });

      if (res.status === 429 && attempt < 3) {
        const retryAfter = Number(res.headers?.get?.("Retry-After"));
        const waitSeconds = Number.isFinite(retryAfter) && retryAfter > 0 ? retryAfter : 2 ** attempt;
        await sleep(Math.min(waitSeconds, 30) * 1000);
        continue;
      }

      if (!res.ok) {
        const text = await res.text();
        throw new Error(`Acronis request to ${method} ${path} failed: ${res.status} ${text}`);
      }

      try {
        return await res.json();
      } catch {
        return {};
      }
    }
  }

  // Walk a collection endpoint and return the flat array of items. Follows
  // `paging.cursors.next` (an opaque cursor) when present, capping total records
  // and page count so a misbehaving cursor can't loop forever.
  async function fetchAll(path, { limit = 200, maxRecords = 20000 } = {}) {
    const items = [];
    let cursor = null;
    for (let page = 0; page < 200; page++) {
      const sep = path.includes("?") ? "&" : "?";
      let url = `${path}${sep}limit=${limit}`;
      if (cursor) url += `&cursor=${encodeURIComponent(cursor)}`;

      const data = await request("GET", url);
      const batch = Array.isArray(data?.items)
        ? data.items
        : Array.isArray(data?.data)
        ? data.data
        : Array.isArray(data)
        ? data
        : [];
      items.push(...batch);

      cursor = data?.paging?.cursors?.next ?? data?.paging?.next ?? null;
      if (!cursor || batch.length === 0 || items.length >= maxRecords) break;
    }
    return items;
  }

  return { request, fetchAll };
}
