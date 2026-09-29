const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

// Thin bearer-token fetch client over the Falcon REST API. Every call the
// connector makes is a read-only query or entity hydration; there is no write
// path.
//
// Falcon's collection endpoints follow a two-step "query then hydrate" shape:
//   GET  .../queries/<thing>/v1   → { resources: [id, id, ...], meta.pagination }
//   POST .../entities/<thing>/v2  → { resources: [ {full object}, ... ] }  (body: { ids: [...] })
//
// Pagination on the query step is offset-based (numeric `offset` + `limit`, with
// `meta.pagination.total` as the stop signal); Spotlight instead returns an
// opaque `meta.pagination.after` token, which this client also handles.
//
// 429s are retried with a bounded backoff, honouring CrowdStrike's
// `X-RateLimit-RetryAfter` (epoch-seconds) / `Retry-After` headers rather than
// assuming a fixed request budget — CrowdStrike publishes no numeric limits.
export function crowdstrikeClient(baseUrl, getToken) {
  async function request(method, path, { body } = {}) {
    for (let attempt = 0; ; attempt++) {
      const token = await getToken();
      const headers = { Authorization: `Bearer ${token}`, Accept: "application/json" };
      if (body !== undefined) headers["Content-Type"] = "application/json";
      const res = await fetch(`${baseUrl}${path}`, {
        method,
        headers,
        body: body !== undefined ? JSON.stringify(body) : undefined,
      });

      if (res.status === 429 && attempt < 4) {
        const retryAfterEpoch = Number(res.headers?.get?.("X-RateLimit-RetryAfter"));
        const retryAfter = Number(res.headers?.get?.("Retry-After"));
        let waitSeconds;
        if (Number.isFinite(retryAfterEpoch) && retryAfterEpoch > 0) {
          waitSeconds = Math.max(1, Math.ceil(retryAfterEpoch - Date.now() / 1000));
        } else if (Number.isFinite(retryAfter) && retryAfter > 0) {
          waitSeconds = retryAfter;
        } else {
          waitSeconds = 2 ** attempt;
        }
        await sleep(Math.min(waitSeconds, 30) * 1000);
        continue;
      }

      if (!res.ok) {
        const text = await res.text();
        throw new Error(`CrowdStrike request to ${method} ${path} failed: ${res.status} ${text}`);
      }

      try {
        return await res.json();
      } catch {
        return {};
      }
    }
  }

  // Walk a `.../queries/.../v1` endpoint and return the flat array of resource
  // IDs. `filter` is an FQL string; `extraParams` covers endpoint-specific query
  // params (e.g. Spotlight's `facet`).
  async function queryIds(queryPath, { filter, sort, limit = 500, maxRecords = 20000, extraParams } = {}) {
    const ids = [];
    let offset = 0;
    let after = null;
    for (;;) {
      const params = new URLSearchParams();
      if (filter) params.set("filter", filter);
      if (sort) params.set("sort", sort);
      params.set("limit", String(limit));
      if (after) params.set("after", after);
      else if (offset) params.set("offset", String(offset));
      for (const [k, v] of Object.entries(extraParams || {})) params.set(k, String(v));

      const data = await request("GET", `${queryPath}?${params.toString()}`);
      const page = Array.isArray(data?.resources) ? data.resources : [];
      ids.push(...page);

      const pag = data?.meta?.pagination || {};
      if (page.length < limit) break;
      if (pag.after) {
        after = pag.after;
      } else if (Number.isFinite(Number(pag.offset)) && Number(pag.offset) > offset + page.length - 1) {
        offset = Number(pag.offset);
      } else {
        offset += page.length;
      }
      if (pag.total != null && ids.length >= Number(pag.total)) break;
      if (ids.length >= maxRecords) break;
    }
    return ids;
  }

  // Hydrate resource IDs via a `.../entities/.../v2` endpoint in batches.
  // `idField` is the request-body key (`ids` for most endpoints, `composite_ids`
  // for the Alerts v2 API). `method`/`asQuery` cover the few entity endpoints
  // that are GET-with-`?ids=` rather than POST-with-body.
  async function hydrate(entityPath, resourceIds, { idField = "ids", batchSize = 250, method = "POST", asQuery = false } = {}) {
    const out = [];
    for (let i = 0; i < resourceIds.length; i += batchSize) {
      const batch = resourceIds.slice(i, i + batchSize);
      let data;
      if (asQuery || method === "GET") {
        const params = new URLSearchParams();
        for (const id of batch) params.append(idField, id);
        data = await request("GET", `${entityPath}?${params.toString()}`);
      } else {
        data = await request(method, entityPath, { body: { [idField]: batch } });
      }
      out.push(...(Array.isArray(data?.resources) ? data.resources : []));
    }
    return out;
  }

  // The common case: query for IDs then hydrate them. Returns [] without hitting
  // the entity endpoint when the query yields nothing.
  async function queryThenHydrate(queryPath, entityPath, opts = {}) {
    const ids = await queryIds(queryPath, opts);
    if (ids.length === 0) return [];
    return hydrate(entityPath, ids, opts);
  }

  return { request, queryIds, hydrate, queryThenHydrate };
}
