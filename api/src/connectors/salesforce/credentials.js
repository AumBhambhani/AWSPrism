import jwt from "jsonwebtoken";

// Salesforce authentication uses the OAuth 2.0 JWT Bearer flow — Salesforce's
// current recommendation for a background, unattended, server-to-server
// integration (the username-password flow is deprecated and must not be used).
//
// The connector signs a short-lived RS256 JWT with the private half of an
// uploaded X.509 keypair and POSTs it to `{loginUrl}/services/oauth2/token`.
// The token response carries both the bearer `access_token` and the org's
// `instance_url` — the pod-specific host every subsequent REST/SOQL call must
// target. The instance host is never hardcoded; it is whatever the token
// exchange returns for this org.
//
// This is a "beta" connector: the SOQL / Tooling queries in ./tests/*.js are
// built from the documented object model but have not been confirmed against a
// live production org. Confirm them before this connector leaves beta.

// JWT lifetime. Salesforce requires `exp` to be no more than 5 minutes in the
// future and rejects the assertion outright on clock skew (per Salesforce's
// docs, skew is the single most common cause of JWT auth failures). 3 minutes
// leaves headroom on both sides.
const JWT_TTL_SECONDS = 180;

// The JWT-issued access token has no `expires_in` in the response — its life is
// governed by the org's session timeout (default 2h, admin-configurable down to
// 15m). Re-mint every 15 minutes within a collection run rather than assume the
// token outlives the run; minting is one cheap signed POST.
const TOKEN_TTL_MS = 15 * 60 * 1000;

const JWT_BEARER_GRANT = "urn:ietf:params:oauth:grant-type:jwt-bearer";

// The customer records their My Domain login URL (e.g.
// "https://acme.my.salesforce.com"). Accept it with or without a scheme, a
// trailing slash, a stray path, or a port, and hand back the canonical
// `https://<host>` origin. Also accepts the generic Salesforce login hosts
// ("login.salesforce.com" for production, "test.salesforce.com" for sandboxes).
// Rejects anything that isn't a plausible Salesforce host so a typo fails at
// connect time rather than as an opaque JWT-audience mismatch mid-run.
export function normaliseLoginUrl(raw) {
  if (!raw || typeof raw !== "string") {
    throw new Error("Salesforce connection is missing config.loginUrl");
  }
  let host = raw.trim();
  host = host.replace(/^https?:\/\//i, ""); // scheme
  host = host.replace(/\/.*$/, ""); // path / trailing slash
  host = host.replace(/:\d+$/, ""); // port
  host = host.toLowerCase();

  const isSalesforceHost =
    /\.salesforce\.com$/.test(host) ||
    /\.force\.com$/.test(host) ||
    /\.cloudforce\.com$/.test(host);

  if (!isSalesforceHost || !/^[a-z0-9][a-z0-9.-]*\.[a-z]{2,}$/.test(host)) {
    throw new Error(
      `Salesforce connection has an invalid config.loginUrl: "${raw}". ` +
        `Use your My Domain login URL, e.g. "https://acme.my.salesforce.com" ` +
        `(or "login.salesforce.com" / "test.salesforce.com").`
    );
  }
  return `https://${host}`;
}

// Private keys pasted into a form often arrive with the newlines collapsed to
// the two-character sequence "\n". `jsonwebtoken` needs real newlines in the
// PEM, so restore them. A key that already has real newlines is left untouched.
export function normalisePrivateKey(raw) {
  if (!raw || typeof raw !== "string" || !raw.trim()) {
    throw new Error("Salesforce connection is missing secret.privateKey");
  }
  const key = raw.includes("\\n") && !raw.includes("\n") ? raw.replace(/\\n/g, "\n") : raw;
  if (!/-----BEGIN [A-Z ]*PRIVATE KEY-----/.test(key)) {
    throw new Error(
      "Salesforce connection secret.privateKey is not a PEM private key — " +
        "paste the full contents of the .key file generated alongside the certificate you uploaded to the Connected App."
    );
  }
  return key;
}

// Default REST/Tooling API version if the connection doesn't pin one. Pinning is
// preferred (a Salesforce release upgrade can change response shapes) but a sane
// recent default keeps a mis-configured connection working.
export const DEFAULT_API_VERSION = "v61.0";

export function normaliseApiVersion(raw) {
  if (raw == null || raw === "") return DEFAULT_API_VERSION;
  const s = String(raw).trim();
  const m = s.match(/^v?(\d{2,3})(?:\.0)?$/i);
  if (!m) {
    throw new Error(
      `Salesforce connection has an invalid config.apiVersion: "${raw}". Use a value like "v61.0".`
    );
  }
  return `v${m[1]}.0`;
}

function buildAssertion({ clientId, username, loginUrl, privateKey }) {
  const now = Math.floor(Date.now() / 1000);
  return jwt.sign(
    {
      iss: clientId, // Connected App consumer key
      sub: username, // the integration user to impersonate
      aud: loginUrl, // must match the token endpoint host exactly
      exp: now + JWT_TTL_SECONDS,
    },
    privateKey,
    { algorithm: "RS256" }
  );
}

async function fetchSalesforceToken({ clientId, username, loginUrl, privateKey }) {
  const assertion = buildAssertion({ clientId, username, loginUrl, privateKey });
  const res = await fetch(`${loginUrl}/services/oauth2/token`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded", Accept: "application/json" },
    body: new URLSearchParams({ grant_type: JWT_BEARER_GRANT, assertion }),
  });

  const text = await res.text();
  let body = {};
  try {
    body = text ? JSON.parse(text) : {};
  } catch {
    /* non-JSON error body — surfaced verbatim below */
  }

  if (!res.ok) {
    // Salesforce returns { error, error_description } — surface both so the
    // "user hasn't approved this consumer" / "invalid_grant" / clock-skew cases
    // are legible without a docs round-trip.
    const detail = body.error_description || text || `HTTP ${res.status}`;
    throw new Error(`Failed to acquire Salesforce access token: ${res.status} ${body.error || ""} ${detail}`.trim());
  }
  if (!body.access_token) throw new Error("Salesforce token response is missing access_token");
  if (!body.instance_url) throw new Error("Salesforce token response is missing instance_url");

  return { accessToken: body.access_token, instanceUrl: String(body.instance_url).replace(/\/$/, "") };
}

// One JWT assertion is signed and exchanged per ~15-minute window within a
// collection run, not per API call. Mirrors the createCachedTokenGetter pattern
// in servicenow/credentials.js and crowdstrike/credentials.js, but caches the
// `instance_url` alongside the token (JWT bearer returns the pod host in the
// same response) so the API client always has a base URL without a second call.
function createCachedAuthGetter(tokenParams) {
  let cached = null;
  return async () => {
    if (cached && cached.expiresAt > Date.now()) {
      return { accessToken: cached.accessToken, instanceUrl: cached.instanceUrl };
    }
    const { accessToken, instanceUrl } = await fetchSalesforceToken(tokenParams);
    cached = { accessToken, instanceUrl, expiresAt: Date.now() + TOKEN_TTL_MS };
    return { accessToken, instanceUrl };
  };
}

export async function resolveSalesforceCredentials({ authType, config, secret }) {
  if (authType !== "oauth2") {
    throw new Error(`Unsupported Salesforce auth type: ${authType}`);
  }
  const loginUrl = normaliseLoginUrl(config?.loginUrl);
  const apiVersion = normaliseApiVersion(config?.apiVersion);

  const clientId = typeof config?.clientId === "string" ? config.clientId.trim() : "";
  if (!clientId) throw new Error("Salesforce connection is missing config.clientId (the Connected App consumer key)");

  const username = typeof config?.username === "string" ? config.username.trim() : "";
  if (!username) throw new Error("Salesforce connection is missing config.username (the integration user to run as)");

  const privateKey = normalisePrivateKey(secret?.privateKey);

  return {
    getAuth: createCachedAuthGetter({ clientId, username, loginUrl, privateKey }),
    loginUrl,
    host: loginUrl.replace(/^https:\/\//, ""),
    apiVersion,
    username,
    clientId,
  };
}
