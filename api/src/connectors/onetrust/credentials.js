const TOKEN_REFRESH_SKEW_MS = 60 * 1000;

// The customer types the tenant domain they sign in with — accept it with or
// without a scheme, a trailing slash, or a stray path, and hand back the bare
// host. Rejects anything that isn't a plausible hostname so a typo fails at
// connect time rather than as an opaque fetch error mid-run.
export function normaliseHostname(raw) {
  if (!raw || typeof raw !== "string") {
    throw new Error("OneTrust connection is missing config.hostname");
  }
  let host = raw.trim();
  host = host.replace(/^https?:\/\//i, ""); // scheme
  host = host.replace(/\/.*$/, ""); // path / trailing slash
  host = host.replace(/:\d+$/, ""); // port
  host = host.toLowerCase();
  if (!/^[a-z0-9.-]+\.[a-z]{2,}$/.test(host)) {
    throw new Error(
      `OneTrust connection has an invalid config.hostname: "${raw}". ` +
        `Use the tenant domain you sign in with, e.g. "acme.my.onetrust.com" or "app-eu.onetrust.com".`
    );
  }
  return host;
}

async function fetchOneTrustToken({ hostname, clientId, clientSecret }) {
  const res = await fetch(`https://${hostname}/api/access/v1/oauth/token`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "client_credentials",
      client_id: clientId,
      client_secret: clientSecret,
    }),
  });
  if (!res.ok) {
    const errorText = await res.text();
    throw new Error(`Failed to acquire OneTrust access token: ${res.status} ${errorText}`);
  }
  const body = await res.json();
  if (!body.access_token) throw new Error("OneTrust token response is missing access_token");
  // OneTrust returns expires_in in seconds; default to 3600 if absent.
  return { accessToken: body.access_token, expiresIn: Number(body.expires_in) || 3600 };
}

// Same createCachedTokenGetter pattern as zoho/credentials.js and
// connectors/shared/microsoftGraphAuth.js — one client-credentials token is
// minted per collection run, not per API call.
function createCachedTokenGetter(tokenParams) {
  let cached = null;
  return async () => {
    if (cached && cached.expiresAt > Date.now()) return cached.token;
    const { accessToken, expiresIn } = await fetchOneTrustToken(tokenParams);
    cached = {
      token: accessToken,
      expiresAt: Date.now() + expiresIn * 1000 - TOKEN_REFRESH_SKEW_MS,
    };
    return cached.token;
  };
}

export async function resolveOneTrustCredentials({ authType, config, secret }) {
  if (authType !== "oauth2") {
    throw new Error(`Unsupported OneTrust auth type: ${authType}`);
  }
  const hostname = normaliseHostname(config?.hostname);
  if (!secret?.clientId) throw new Error("OneTrust connection is missing secret.clientId");
  if (!secret?.clientSecret) throw new Error("OneTrust connection is missing secret.clientSecret");

  const { clientId, clientSecret } = secret;

  return {
    getToken: createCachedTokenGetter({ hostname, clientId, clientSecret }),
    hostname,
    baseUrl: `https://${hostname}`,
  };
}
