const TOKEN_REFRESH_SKEW_MS = 60 * 1000;

async function fetchToken({ tenantId, clientId, clientSecret, resource }) {
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
    throw new Error(`Failed to acquire Purview token: ${res.status} ${errorText}`);
  }

  const body = await res.json();
  if (!body.access_token) throw new Error("Purview token response is missing access_token");
  return { accessToken: body.access_token, expiresIn: Number(body.expires_in) || 0 };
}

// Wraps fetchToken with a simple in-closure per-resource cache so a single
// runTests invocation (which can call getDataMapToken/getAuditToken many
// times across ~8-12 checks) doesn't mint a fresh AAD token on every call.
// Refreshes a bit early (TOKEN_REFRESH_SKEW_MS before actual expiry) to
// avoid handing out a token that's about to expire mid-request.
function createCachedTokenGetter(tokenParams) {
  let cached = null;

  return async () => {
    if (cached && cached.expiresAt > Date.now()) {
      return cached.token;
    }
    const { accessToken, expiresIn } = await fetchToken(tokenParams);
    cached = {
      token: accessToken,
      expiresAt: Date.now() + expiresIn * 1000 - TOKEN_REFRESH_SKEW_MS,
    };
    return cached.token;
  };
}

// Azure Purview account names: 3-63 chars, alphanumeric + hyphens, can't
// start/end with a hyphen (matches real Azure Purview naming rules).
const PURVIEW_ACCOUNT_NAME_PATTERN = /^[a-zA-Z0-9][a-zA-Z0-9-]{1,61}[a-zA-Z0-9]$/;
// Azure AD tenant ID: either a GUID, or a verified domain name
// (alphanumeric, dots, hyphens only — no path/host-breaking characters).
const TENANT_ID_PATTERN = /^[0-9a-fA-F-]{36}$|^[a-zA-Z0-9.-]+$/;

export async function resolvePurviewCredentials({ authType, config, secret }) {
  if (authType === "oauth2") {
    if (!config.tenantId) throw new Error("Purview connection is missing config.tenantId");
    if (!config.purviewAccountName) throw new Error("Purview connection is missing config.purviewAccountName");
    if (!secret.clientId) throw new Error("Purview connection is missing secret.clientId");
    if (!secret.clientSecret) throw new Error("Purview connection is missing secret.clientSecret");

    if (!PURVIEW_ACCOUNT_NAME_PATTERN.test(config.purviewAccountName))
      throw new Error("Purview connection has an invalid config.purviewAccountName");
    if (!TENANT_ID_PATTERN.test(config.tenantId))
      throw new Error("Purview connection has an invalid config.tenantId");

    const { tenantId, purviewAccountName } = config;
    const { clientId, clientSecret } = secret;

    return {
      getDataMapToken: createCachedTokenGetter({ tenantId, clientId, clientSecret, resource: "https://purview.azure.net" }),
      getAuditToken: createCachedTokenGetter({ tenantId, clientId, clientSecret, resource: "https://manage.office.com" }),
      dataMapBaseUrl: `https://${purviewAccountName}.purview.azure.com`,
      auditBaseUrl: `https://manage.office.com/api/v1.0/${tenantId}/activity/feed`,
    };
  }

  throw new Error(`Unsupported Purview auth type: ${authType}`);
}
