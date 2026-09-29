const TOKEN_REFRESH_SKEW_MS = 60 * 1000;

const VALID_DATA_CENTERS = ["com", "eu", "in", "com.au", "com.cn", "jp", "cloud.ca"];

function accountsDomain(dc) {
  if (dc === "cloud.ca") return "accounts.zohocloud.ca";
  return `accounts.zoho.${dc}`;
}

function apiDomain(dc) {
  if (dc === "cloud.ca") return "www.zohoapis.ca";
  return `www.zohoapis.${dc}`;
}

async function fetchZohoToken({ dataCenter, clientId, clientSecret, refreshToken }) {
  const url = `https://${accountsDomain(dataCenter)}/oauth/v2/token`;
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "refresh_token",
      client_id: clientId,
      client_secret: clientSecret,
      refresh_token: refreshToken,
    }),
  });
  if (!res.ok) {
    const errorText = await res.text();
    throw new Error(`Failed to acquire Zoho access token: ${res.status} ${errorText}`);
  }
  const body = await res.json();
  if (!body.access_token) throw new Error("Zoho token response is missing access_token");
  // Zoho returns expires_in in seconds; default to 3600 if absent.
  return { accessToken: body.access_token, expiresIn: Number(body.expires_in) || 3600 };
}

// Same createCachedTokenGetter pattern as purview/credentials.js — avoids
// minting a fresh access token on every API call within one collection run.
function createCachedTokenGetter(tokenParams) {
  let cached = null;

  return async () => {
    if (cached && cached.expiresAt > Date.now()) {
      return cached.token;
    }
    const { accessToken, expiresIn } = await fetchZohoToken(tokenParams);
    cached = {
      token: accessToken,
      expiresAt: Date.now() + expiresIn * 1000 - TOKEN_REFRESH_SKEW_MS,
    };
    return cached.token;
  };
}

export async function resolveZohoCredentials({ authType, config, secret }) {
  if (authType === "oauth2") {
    if (!config.dataCenter) throw new Error("Zoho connection is missing config.dataCenter");
    if (!VALID_DATA_CENTERS.includes(config.dataCenter))
      throw new Error(`Zoho connection has an invalid config.dataCenter: "${config.dataCenter}". Must be one of: ${VALID_DATA_CENTERS.join(", ")}`);
    if (!config.orgId) throw new Error("Zoho connection is missing config.orgId");
    if (!secret.clientId) throw new Error("Zoho connection is missing secret.clientId");
    if (!secret.clientSecret) throw new Error("Zoho connection is missing secret.clientSecret");
    if (!secret.refreshToken) throw new Error("Zoho connection is missing secret.refreshToken");

    const { dataCenter, orgId } = config;
    const { clientId, clientSecret, refreshToken } = secret;

    return {
      getToken: createCachedTokenGetter({ dataCenter, clientId, clientSecret, refreshToken }),
      apiDomain: apiDomain(dataCenter),
      dataCenter,
      orgId,
    };
  }

  throw new Error(`Unsupported Zoho auth type: ${authType}`);
}
