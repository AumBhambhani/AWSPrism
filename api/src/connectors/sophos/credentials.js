const TOKEN_URL = "https://id.sophos.com/api/v2/oauth2/token";
const WHOAMI_URL = "https://api.central.sophos.com/whoami/v1";
const TOKEN_REFRESH_SKEW_MS = 60_000;

export function normaliseRegion(value) {
  if (value == null || String(value).trim() === "") return null;
  const region = String(value).trim().toLowerCase();
  if (!/^[a-z]{2}[0-9]{2}$/.test(region)) {
    throw new Error(`Sophos region hint "${value}" is invalid (expected a value such as us01 or eu01)`);
  }
  return region;
}

async function fetchToken({ clientId, clientSecret }) {
  const response = await fetch(TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded", Accept: "application/json" },
    body: new URLSearchParams({
      grant_type: "client_credentials",
      client_id: clientId,
      client_secret: clientSecret,
      scope: "token",
    }),
  });
  if (!response.ok) {
    const text = await response.text();
    throw new Error(`Sophos token request failed: HTTP ${response.status} ${text}`);
  }
  const body = await response.json();
  if (!body?.access_token) throw new Error("Sophos token response is missing access_token");
  return { token: body.access_token, expiresIn: Number(body.expires_in) || 3600 };
}

export function createCachedTokenGetter(params) {
  let cached;
  return async () => {
    if (cached && cached.expiresAt > Date.now()) return cached.token;
    const token = await fetchToken(params);
    cached = {
      token: token.token,
      expiresAt: Date.now() + Math.max(1_000, token.expiresIn * 1_000 - TOKEN_REFRESH_SKEW_MS),
    };
    return cached.token;
  };
}

function normaliseApiOrigin(value, field) {
  let url;
  try {
    url = new URL(value);
  } catch {
    throw new Error(`Sophos whoami response has an invalid ${field}`);
  }
  if (url.protocol !== "https:" || !url.hostname.endsWith(".central.sophos.com")) {
    throw new Error(`Sophos whoami response has an untrusted ${field}`);
  }
  return url.origin;
}

export async function fetchWhoami(getToken) {
  const token = await getToken();
  const response = await fetch(WHOAMI_URL, {
    headers: { Authorization: `Bearer ${token}`, Accept: "application/json" },
  });
  if (!response.ok) {
    const text = await response.text();
    throw new Error(`Sophos whoami request failed: HTTP ${response.status} ${text}`);
  }
  const body = await response.json();
  if (body?.idType !== "tenant") {
    throw new Error(
      `Sophos ${body?.idType || "unknown"} credentials are not supported — create a tenant-level API credential`
    );
  }
  if (!body.id) throw new Error("Sophos whoami response is missing the tenant id");
  if (!body.apiHosts?.dataRegion) throw new Error("Sophos whoami response is missing apiHosts.dataRegion");
  return {
    tenantId: String(body.id),
    dataRegionHost: normaliseApiOrigin(body.apiHosts.dataRegion, "apiHosts.dataRegion"),
    globalHost: body.apiHosts.global ? normaliseApiOrigin(body.apiHosts.global, "apiHosts.global") : null,
  };
}

export async function resolveSophosCredentials({ authType, config, secret }) {
  if (authType !== "oauth2") throw new Error(`Unsupported Sophos auth type: ${authType}`);
  if (!secret?.clientId) throw new Error("Sophos connection is missing secret.clientId");
  if (!secret?.clientSecret) throw new Error("Sophos connection is missing secret.clientSecret");
  return {
    regionHint: normaliseRegion(config?.region),
    getToken: createCachedTokenGetter({ clientId: secret.clientId, clientSecret: secret.clientSecret }),
  };
}
