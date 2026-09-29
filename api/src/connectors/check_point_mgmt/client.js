// Thin wrapper over the Check Point Management API (`web_api`). Every command is
// a POST; a session is opened once per collection run with `login` (read-only)
// and closed with `logout` in a finally. The session id rides in the
// `X-chkp-sid` header. 429s are retried with Retry-After honoured.

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

export function checkPointMgmtClient({ mgmtOrigin, apiVersion = "" }) {
  const base = `${mgmtOrigin.replace(/\/$/, "")}/web_api${apiVersion ? `/${apiVersion}` : ""}`;

  async function call(command, body, sid) {
    for (let attempt = 0; ; attempt += 1) {
      const headers = { "Content-Type": "application/json", Accept: "application/json" };
      if (sid) headers["X-chkp-sid"] = sid;
      const response = await fetch(`${base}/${command}`, {
        method: "POST",
        headers,
        body: JSON.stringify(body || {}),
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
        const detail = json?.message || text || `HTTP ${response.status}`;
        throw new Error(`Check Point Management ${command} failed: HTTP ${response.status} ${detail}`);
      }
      return json;
    }
  }

  return {
    // Opens a read-only session and returns a command runner bound to its sid.
    async openSession({ apiKey, domain }) {
      const loginBody = { "api-key": apiKey, "read-only": true };
      if (domain) loginBody.domain = domain;
      const login = await call("login", loginBody);
      if (!login?.sid) throw new Error("Check Point Management login response is missing sid");
      const sid = login.sid;

      const post = (command, payload) => call(command, payload, sid);

      // show-*-rulebase / show-* collection commands page with limit+offset and
      // report `total` / `to`. `collectionKey` names the array on the response.
      async function paginate(command, payload = {}, collectionKeys = ["objects"]) {
        const out = [];
        let offset = 0;
        const limit = 500;
        for (let calls = 0; calls < 100; calls += 1) {
          const page = await post(command, { ...payload, limit, offset });
          let batch = null;
          for (const key of collectionKeys) {
            if (Array.isArray(page?.[key])) {
              batch = page[key];
              break;
            }
          }
          if (!batch) {
            throw new Error(`Check Point Management ${command} response is missing a collection array (${collectionKeys.join("/")})`);
          }
          out.push(...batch);
          const total = Number(page?.total);
          const to = Number(page?.to);
          if (!Number.isFinite(total) || !Number.isFinite(to) || to >= total || batch.length === 0) break;
          offset = to;
        }
        return out;
      }

      return {
        sid,
        apiServerVersion: login["api-server-version"] || null,
        post,
        paginate,
        logout: () => call("logout", {}, sid).catch(() => {}),
      };
    },
  };
}
