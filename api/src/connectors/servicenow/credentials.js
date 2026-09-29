const TOKEN_REFRESH_SKEW_MS = 60 * 1000;

// The customer records the base URL of the instance they sign in to — accept it
// with or without a scheme, a trailing slash, or a stray path, and hand back the
// canonical `https://<host>` origin. Rejects anything that isn't a plausible
// ServiceNow instance host so a typo fails at connect time rather than as an
// opaque fetch error mid-run.
export function normaliseInstanceUrl(raw) {
  if (!raw || typeof raw !== "string") {
    throw new Error("ServiceNow connection is missing config.instanceUrl");
  }
  let host = raw.trim();
  host = host.replace(/^https?:\/\//i, ""); // scheme
  host = host.replace(/\/.*$/, ""); // path / trailing slash
  host = host.replace(/:\d+$/, ""); // port
  host = host.toLowerCase();
  if (!/^[a-z0-9][a-z0-9.-]*\.[a-z]{2,}$/.test(host)) {
    throw new Error(
      `ServiceNow connection has an invalid config.instanceUrl: "${raw}". ` +
        `Use the instance base URL you sign in with, e.g. "acme.service-now.com" or "https://acme.service-now.com".`
    );
  }
  return `https://${host}`;
}

async function fetchServiceNowToken({ baseUrl, clientId, clientSecret }) {
  const res = await fetch(`${baseUrl}/oauth_token.do`, {
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
    throw new Error(`Failed to acquire ServiceNow access token: ${res.status} ${errorText}`);
  }
  const body = await res.json();
  if (!body.access_token) throw new Error("ServiceNow token response is missing access_token");
  // ServiceNow returns expires_in in seconds (default OAuth token TTL is 1800);
  // default to 1800 if absent.
  return { accessToken: body.access_token, expiresIn: Number(body.expires_in) || 1800 };
}

// Same createCachedTokenGetter pattern as onetrust/credentials.js and
// connectors/shared/microsoftGraphAuth.js — one client-credentials token is
// minted per collection run, not per API call, and refreshed proactively a
// minute before its TTL expires.
function createCachedTokenGetter(tokenParams) {
  let cached = null;
  return async () => {
    if (cached && cached.expiresAt > Date.now()) return cached.token;
    const { accessToken, expiresIn } = await fetchServiceNowToken(tokenParams);
    cached = {
      token: accessToken,
      expiresAt: Date.now() + expiresIn * 1000 - TOKEN_REFRESH_SKEW_MS,
    };
    return cached.token;
  };
}

export async function resolveServiceNowCredentials({ authType, config, secret }) {
  if (authType !== "oauth2") {
    throw new Error(`Unsupported ServiceNow auth type: ${authType}`);
  }
  const baseUrl = normaliseInstanceUrl(config?.instanceUrl);
  if (!secret?.clientId) throw new Error("ServiceNow connection is missing secret.clientId");
  if (!secret?.clientSecret) throw new Error("ServiceNow connection is missing secret.clientSecret");

  const { clientId, clientSecret } = secret;

  return {
    getToken: createCachedTokenGetter({ baseUrl, clientId, clientSecret }),
    baseUrl,
    host: baseUrl.replace(/^https:\/\//, ""),
  };
}
