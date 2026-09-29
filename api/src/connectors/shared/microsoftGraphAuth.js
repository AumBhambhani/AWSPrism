// Shared Microsoft credential resolution for all four Graph-adjacent connectors:
// entra_id, microsoft_365, microsoft_teams, microsoft_defender.
//
// Design:
// - `resource` is the OAuth2 token audience (passed to login.microsoftonline.com).
//   For entra_id/microsoft_365/microsoft_teams this is "https://graph.microsoft.com".
//   For microsoft_defender this is "https://api.securitycenter.microsoft.com".
// - `resource` is NOT assumed to equal the API base URL — Defender's token
//   audience and request base URL are two different strings.
//
// Usage:
//   const creds = await resolveMicrosoftGraphCredentials({ config, secret, resource });
//   // creds.getToken() → cached bearer token for `resource`
//   // creds.tenantId  → for connectors that need it in URLs (e.g. Exchange Admin API)

const TOKEN_REFRESH_SKEW_MS = 60 * 1000;

async function fetchMicrosoftToken({ tenantId, clientId, clientSecret, resource }) {
  const res = await fetch(`https://login.microsoftonline.com/${tenantId}/oauth2/token`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "client_credentials",
      client_id: clientId,
      client_secret: clientSecret,
      resource,
    }),
  });
  if (!res.ok) {
    const errorText = await res.text();
    throw new Error(`Failed to acquire Microsoft token (resource=${resource}): ${res.status} ${errorText}`);
  }
  const body = await res.json();
  if (!body.access_token) throw new Error("Microsoft token response is missing access_token");
  return { accessToken: body.access_token, expiresIn: Number(body.expires_in) || 3600 };
}

function createCachedTokenGetter(tokenParams) {
  let cached = null;
  return async () => {
    if (cached && cached.expiresAt > Date.now()) return cached.token;
    const { accessToken, expiresIn } = await fetchMicrosoftToken(tokenParams);
    cached = {
      token: accessToken,
      expiresAt: Date.now() + expiresIn * 1000 - TOKEN_REFRESH_SKEW_MS,
    };
    return cached.token;
  };
}

// Azure AD tenant ID: GUID or verified-domain shape (alphanumeric + dots/hyphens, no slashes).
const TENANT_ID_PATTERN = /^[0-9a-fA-F-]{36}$|^[a-zA-Z0-9][a-zA-Z0-9.-]*[a-zA-Z0-9]$/;

export function resolveMicrosoftGraphCredentials({ config, secret, resource = "https://graph.microsoft.com" }) {
  if (!config.tenantId) throw new Error("Microsoft connector is missing config.tenantId");
  if (!TENANT_ID_PATTERN.test(config.tenantId))
    throw new Error("Microsoft connector has an invalid config.tenantId");
  if (!secret.clientId) throw new Error("Microsoft connector is missing secret.clientId");
  if (!secret.clientSecret) throw new Error("Microsoft connector is missing secret.clientSecret");

  const { tenantId } = config;
  const { clientId, clientSecret } = secret;

  return {
    getToken: createCachedTokenGetter({ tenantId, clientId, clientSecret, resource }),
    tenantId,
  };
}
