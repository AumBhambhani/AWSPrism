const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// Thin signed-fetch wrapper over an Akamai account's read-only APIs. Every call
// is a GET. `creds.sign()` computes the EG1-HMAC-SHA256 Authorization header per
// request (timestamp + nonce are regenerated each call, so we sign immediately
// before sending). 429/503 are retried with a bounded backoff honouring
// Retry-After. Discovery helpers are memoised once per client instance.
export function akamaiClient(creds) {
  const base = `https://${creds.host}`;

  function withAsk(path) {
    if (!creds.accountSwitchKey) return path;
    const sep = path.includes("?") ? "&" : "?";
    return `${path}${sep}accountSwitchKey=${encodeURIComponent(creds.accountSwitchKey)}`;
  }

  async function get(path, { accept = "application/json" } = {}) {
    const fullPath = withAsk(path);
    for (let attempt = 0; ; attempt++) {
      // Sign the un-prefixed path exactly as sent (EdgeGrid signs path + query).
      const authorization = creds.sign({ method: "GET", path: fullPath, headers: {}, body: "" });
      const res = await fetch(`${base}${fullPath}`, {
        method: "GET",
        headers: { Authorization: authorization, Accept: accept },
      });

      if ((res.status === 429 || res.status === 503) && attempt < 3) {
        const retryAfter = Number(res.headers?.get?.("Retry-After"));
        const waitSec = Number.isFinite(retryAfter) && retryAfter >= 0 ? retryAfter : 2 ** attempt;
        await sleep(Math.min(waitSec, 30) * 1000);
        continue;
      }

      if (!res.ok) {
        const text = await res.text().catch(() => "");
        throw new Error(`Akamai GET ${path} failed: ${res.status} ${text.slice(0, 400)}`);
      }
      try {
        return await res.json();
      } catch {
        return {};
      }
    }
  }

  async function getPaged(path, { pageParam = "page", pageSizeParam = "pageSize", pageSize = 100, itemsKey } = {}) {
    const out = [];
    for (let page = 1; ; page++) {
      const sep = path.includes("?") ? "&" : "?";
      const body = await get(`${path}${sep}${pageParam}=${page}&${pageSizeParam}=${pageSize}`);
      const items = itemsKey ? body?.[itemsKey] : Array.isArray(body) ? body : body?.apiEndPoints || body?.endpoints || [];
      const arr = Array.isArray(items) ? items : [];
      out.push(...arr);
      if (arr.length < pageSize) break;
      if (page > 200) break; // hard safety stop
    }
    return out;
  }

  function describeAkamaiError(err) {
    const m = (err?.message || String(err)).toLowerCase();
    if (m.includes(" 401")) {
      return `${err.message} — EdgeGrid authentication failed. Check config.host matches the .edgerc "host" exactly, the client/access tokens and client secret are correct, and the server clock is accurate (Akamai rejects requests with more than ~30s of skew).`;
    }
    if (m.includes(" 403")) {
      return `${err.message} — the EdgeGrid credential is valid but lacks the required product scope (permission). Grant the relevant READ-ONLY scope to the API client in Control Center → Identity & Access → API clients. Checks for this area report not applicable until then.`;
    }
    if (m.includes(" 429")) {
      return `${err.message} — Akamai API rate limit hit for this API client. Reduce this connection's collection frequency.`;
    }
    if (m.includes(" 406")) {
      return `${err.message} — missing or wrong versioned Accept header (CPS resources require e.g. application/vnd.akamai.cps.enrollments.v11+json).`;
    }
    return `${err.message} — verify the API host and that the API client has the READ-ONLY scopes Prism's Akamai checks require.`;
  }

  // ---- memoised discovery ------------------------------------------------------
  const memo = new Map();
  const once = (k, fn) => {
    if (!memo.has(k)) memo.set(k, fn());
    return memo.get(k);
  };

  const listSecurityConfigs = () =>
    once("configs", async () => {
      const body = await get("/appsec/v1/configs");
      return Array.isArray(body?.configurations) ? body.configurations : [];
    });

  const resolveActiveConfig = (configId) =>
    once(`activeConfig:${configId}`, async () => {
      const [versions, activations] = await Promise.all([
        get(`/appsec/v1/configs/${configId}/versions`),
        get(`/appsec/v1/configs/${configId}/activations`).catch(() => ({ activationHistory: [] })),
      ]);
      const versionNumbers = (versions?.versionList || versions?.versions || []).map((v) => v.version).filter(Number.isFinite);
      const latestVersion = versionNumbers.length ? Math.max(...versionNumbers) : null;
      const prod = (activations?.activationHistory || [])
        .filter((a) => a.network === "PRODUCTION" && /ACTIVATED/i.test(a.status || ""))
        .map((a) => a.version)
        .filter(Number.isFinite);
      const productionVersion = prod.length ? Math.max(...prod) : null;
      return { configId, productionVersion, latestVersion };
    });

  const listSecurityPolicies = (configId, versionNumber) =>
    once(`policies:${configId}:${versionNumber}`, async () => {
      const body = await get(`/appsec/v1/configs/${configId}/versions/${versionNumber}/security-policies`);
      return body?.policies || body?.securityPolicies || [];
    });

  const getSiemSettings = (configId, versionNumber) =>
    once(`siem:${configId}:${versionNumber}`, () =>
      get(`/appsec/v1/configs/${configId}/versions/${versionNumber}/siem`)
    );

  const listContractIds = () =>
    once("contracts", async () => {
      const body = await get("/papi/v1/contracts");
      return (body?.contracts?.items || []).map((c) => c.contractId).filter(Boolean);
    });

  const listProperties = () =>
    once("properties", async () => {
      const groups = await get("/papi/v1/groups");
      const out = [];
      for (const g of groups?.groups?.items || []) {
        for (const contractId of g.contractIds || []) {
          const body = await get(`/papi/v1/properties?contractId=${contractId}&groupId=${g.groupId}`).catch(() => null);
          for (const p of body?.properties?.items || []) out.push(p);
        }
      }
      // de-dupe by propertyId (a property can be listed under multiple contract/group pairs)
      return [...new Map(out.map((p) => [p.propertyId, p])).values()];
    });

  const resolveActivePropertyVersion = (propertyId) =>
    once(`propVersion:${propertyId}`, async () => {
      const body = await get(`/papi/v1/properties/${propertyId}/activations`);
      const prod = (body?.activations?.items || [])
        .filter((a) => a.network === "PRODUCTION" && /ACTIVE/i.test(a.status || ""))
        .map((a) => a.propertyVersion)
        .filter(Number.isFinite);
      return prod.length ? Math.max(...prod) : null;
    });

  const getRuleTree = (propertyId, versionNumber) =>
    once(`rules:${propertyId}:${versionNumber}`, () =>
      get(`/papi/v1/properties/${propertyId}/versions/${versionNumber}/rules`)
    );

  const listEnrollments = (contractIds) =>
    once(`enrollments:${(contractIds || []).join(",")}`, async () => {
      const out = [];
      for (const contractId of contractIds || []) {
        const body = await get(`/cps/v2/enrollments?contractId=${contractId}`, {
          accept: "application/vnd.akamai.cps.enrollments.v11+json",
        }).catch(() => null);
        for (const e of body?.enrollments || []) {
          out.push({ ...e, enrollmentId: String(e.location || "").split("/").pop() });
        }
      }
      return out;
    });

  const getProductionDeployment = (enrollmentId) =>
    once(`deployment:${enrollmentId}`, () =>
      get(`/cps/v2/enrollments/${enrollmentId}/deployments/production`, {
        accept: "application/vnd.akamai.cps.deployment.v8+json",
      })
    );

  return {
    get,
    getPaged,
    describeAkamaiError,
    listSecurityConfigs,
    resolveActiveConfig,
    listSecurityPolicies,
    getSiemSettings,
    listContractIds,
    listProperties,
    resolveActivePropertyVersion,
    getRuleTree,
    listEnrollments,
    getProductionDeployment,
  };
}
