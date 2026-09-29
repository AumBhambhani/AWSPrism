// OpenText Carbonite Server Backup (the self-hosted product line — distinct from
// Carbonite Core Endpoint Backup) exposes a read-only OData "API - Monitoring"
// component that a customer installs alongside their own Director/Portal. This
// connector runs read-only posture checks against it — recent successful safeset
// runs and backup-agent liveness — to evidence information backup (ISO 27001
// A.12.3.1) and monitoring (A.12.4.1) controls.
//
// Auth is Keycloak OIDC: the customer registers a client (vendor setup script)
// at the least-privilege "Reseller" access level, scoped to the one company
// being monitored, and Prism exchanges that client's id/secret for a short-lived
// bearer token per collection run (client-credentials grant). Structurally this
// is new for this codebase — Azure defers the token exchange into the SDK,
// Commvault and Carbonite Core Endpoint use static pre-generated secrets; this
// connector performs a live OAuth2 token-endpoint POST as part of credential
// resolution, closest to crowdstrike/credentials.js's cached-token getter.
//
// Carbonite Server Backup has no Node SDK and no public API docs — its
// authoritative reference is a per-install Swagger UI. Every OData path, entity
// field name, and the Keycloak realm / token-endpoint shape below is a
// documentation guess marked `TODO CONFIRM`; checks degrade to a visible
// `status: "error"` result rather than a guessed pass/fail. Confirm all of them
// against a live install (see the connector plan's Task 0) before this connector
// leaves `beta`.

const TOKEN_REFRESH_SKEW_MS = 60 * 1000;
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

// Accepts the API-Monitoring host with or without a scheme, a trailing slash, a
// stray path, or a port, and returns the bare host. Rejects anything that isn't
// a plausible hostname (or IPv4 — the vendor docs refer to
// "APIdomainNameOrIPaddress") so a copy-pasted wrong value fails at connect time
// rather than as an opaque fetch error mid-run. Mirrors
// commvault/credentials.js's resolveWebconsoleUrl.
export function resolveApiDomain(config) {
  const raw = typeof config?.apiDomain === "string" ? config.apiDomain.trim() : "";
  if (!raw) {
    throw new Error("Carbonite Server Backup connection is missing config.apiDomain");
  }

  let host = raw.replace(/^https?:\/\//i, "");
  host = host.replace(/\/.*$/, "");
  host = host.replace(/:\d+$/, "");
  host = host.toLowerCase();

  const isHostname = /^[a-z0-9.-]+\.[a-z]{2,}$/.test(host);
  const isIpv4 = /^\d{1,3}(\.\d{1,3}){3}$/.test(host);
  if (!host || (!isHostname && !isIpv4)) {
    throw new Error(
      `Carbonite Server Backup connection has an invalid config.apiDomain: "${raw}". ` +
        `Use the host the API - Monitoring component is served from, e.g. ` +
        `https://backup.example.com — the same host you open its Swagger UI on.`
    );
  }
  return host;
}

// TODO CONFIRM (connector plan Task 0, item 1): modern Keycloak (no /auth
// prefix) realm token endpoint. Legacy Keycloak (<=17) puts this under
// `/auth/realms/...`. `.well-known/openid-configuration` on the realm resolves
// this authoritatively.
export function keycloakTokenEndpoint(apiDomain, realm) {
  return `https://${apiDomain}/realms/${encodeURIComponent(realm)}/protocol/openid-connect/token`;
}

async function fetchKeycloakToken({ apiDomain, realm, clientId, clientSecret }) {
  const res = await fetch(keycloakTokenEndpoint(apiDomain, realm), {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded", Accept: "application/json" },
    // TODO CONFIRM (connector plan Task 0, item 2): client-credentials grant is
    // assumed. If the shipped client only permits resource-owner-password,
    // `secret` must also carry a username/password and this body changes.
    body: new URLSearchParams({
      grant_type: "client_credentials",
      client_id: clientId,
      client_secret: clientSecret,
    }),
  });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(
      `Carbonite Server Backup Keycloak token request failed: ${res.status} ${text.slice(0, 500)}`
    );
  }
  const body = await res.json().catch(() => ({}));
  if (!body.access_token) {
    throw new Error("Carbonite Server Backup Keycloak token response is missing access_token");
  }
  // Keycloak access tokens default to a 300s lifespan; expires_in is seconds.
  return { accessToken: body.access_token, expiresIn: Number(body.expires_in) || 300 };
}

// One client-credentials token is minted lazily on the first API call and cached
// for the rest of the collection run, refreshed a minute before its short TTL
// expires. Mirrors crowdstrike/credentials.js's createCachedTokenGetter — a run
// is short-lived, so there is no cross-run persistence and no mid-call refresh
// race to worry about.
function createCachedTokenGetter(tokenParams) {
  let cached = null;
  return async () => {
    if (cached && cached.expiresAt > Date.now()) return cached.token;
    const { accessToken, expiresIn } = await fetchKeycloakToken(tokenParams);
    cached = { token: accessToken, expiresAt: Date.now() + expiresIn * 1000 - TOKEN_REFRESH_SKEW_MS };
    return cached.token;
  };
}

export async function resolveCarboniteServerCredentials({ authType, config, secret }) {
  if (authType !== "oauth2") {
    throw new Error(`Unsupported Carbonite Server Backup auth type: ${authType}`);
  }

  const apiDomain = resolveApiDomain(config);

  const realm =
    typeof config?.keycloakRealm === "string" && config.keycloakRealm.trim()
      ? config.keycloakRealm.trim()
      : "";
  if (!realm) {
    throw new Error("Carbonite Server Backup connection is missing config.keycloakRealm");
  }

  if (!secret?.clientId || typeof secret.clientId !== "string" || !secret.clientId.trim()) {
    throw new Error("Carbonite Server Backup connection is missing secret.clientId");
  }
  if (!secret?.clientSecret || typeof secret.clientSecret !== "string" || !secret.clientSecret.trim()) {
    throw new Error("Carbonite Server Backup connection is missing secret.clientSecret");
  }

  const clientId = secret.clientId.trim();
  const clientSecret = secret.clientSecret.trim();
  const getToken = createCachedTokenGetter({ apiDomain, realm, clientId, clientSecret });

  // TODO CONFIRM (connector plan Task 0, item 3): the OData base path. The
  // vendor's Swagger UI lives at `/monitoring/swaggerui/index`, so `/monitoring`
  // is the assumed API root; the entity collections may sit at `/odata/<Entity>`
  // or `/api/v1/<Entity>` beneath it — tests/*.js prefix their own paths.
  const apiRoot = `https://${apiDomain}/monitoring`;

  // Read-only OData GET helper. Bounded 429 retry, lazy bearer injection, JSON
  // parse with a safe fallback (mirrors commvault/client.js). Every call this
  // connector makes is a GET — there is no write path.
  async function request(path) {
    for (let attempt = 0; ; attempt++) {
      const token = await getToken();
      const res = await fetch(`${apiRoot}${path}`, {
        method: "GET",
        headers: { Authorization: `Bearer ${token}`, Accept: "application/json" },
      });

      if (res.status === 429 && attempt < 3) {
        const retryAfter = Number(res.headers?.get?.("Retry-After"));
        const waitSeconds = Number.isFinite(retryAfter) && retryAfter > 0 ? retryAfter : 2 ** attempt;
        await sleep(Math.min(waitSeconds, 30) * 1000);
        continue;
      }

      if (!res.ok) {
        const text = await res.text().catch(() => "");
        throw new Error(
          `Carbonite Server Backup request to GET ${path} failed: ${res.status} ${text.slice(0, 500)}`
        );
      }

      try {
        return await res.json();
      } catch {
        return {};
      }
    }
  }

  return { apiDomain, host: apiDomain, realm, apiRoot, getToken, request };
}
