// Check Point CloudGuard (formerly Dome9) CSPM authentication.
//
// The connector calls the CloudGuard REST API with HTTP Basic auth — the API key
// id as the username and the API key secret as the password (CloudGuard console >
// Settings > Credentials > Create API Key, least-privilege / read-only role).
//
// The API host is fixed by the account's data centre; `config.baseUrl` is stored
// explicitly and never defaulted to a single global host.

export const DATA_CENTER_HOSTS = {
  us: "https://api.dome9.com",
  eu: "https://api.eu1.dome9.com",
  ap1: "https://api.ap1.dome9.com",
  ap2: "https://api.ap2.dome9.com",
  ap3: "https://api.ap3.dome9.com",
  ca: "https://api.cace1.dome9.com",
};

export function normaliseBaseUrl(rawUrl, rawDataCenter) {
  const dc = rawDataCenter == null ? "" : String(rawDataCenter).trim().toLowerCase();
  let origin;
  if (rawUrl && String(rawUrl).trim()) {
    let value = String(rawUrl).trim();
    if (!/^https?:\/\//i.test(value)) value = `https://${value}`;
    let url;
    try {
      url = new URL(value);
    } catch {
      throw new Error(`Check Point CloudGuard connection has an invalid config.baseUrl: "${rawUrl}"`);
    }
    if (url.protocol !== "https:") throw new Error(`Check Point CloudGuard connection config.baseUrl must be https, got "${rawUrl}"`);
    origin = url.origin + (url.pathname.replace(/\/+$/, "") || "");
  } else if (DATA_CENTER_HOSTS[dc]) {
    origin = DATA_CENTER_HOSTS[dc];
  } else {
    throw new Error("Check Point CloudGuard connection is missing config.baseUrl (or a known config.dataCenter)");
  }
  // Every CloudGuard REST path is under /v2.
  return /\/v2$/.test(origin) ? origin : `${origin}/v2`;
}

export async function resolveCheckPointCloudguardCredentials({ authType, config, secret }) {
  if (authType !== "api_key") {
    throw new Error(`Unsupported Check Point CloudGuard auth type: ${authType}`);
  }
  const keyId = typeof secret?.keyId === "string" ? secret.keyId.trim() : "";
  const keySecret = typeof secret?.keySecret === "string" ? secret.keySecret.trim() : "";
  if (!keyId) throw new Error("Check Point CloudGuard connection is missing secret.keyId");
  if (!keySecret) throw new Error("Check Point CloudGuard connection is missing secret.keySecret");

  return {
    baseUrl: normaliseBaseUrl(config?.baseUrl, config?.dataCenter),
    dataCenter: config?.dataCenter ? String(config.dataCenter).trim().toLowerCase() : "",
    authHeader: `Basic ${Buffer.from(`${keyId}:${keySecret}`).toString("base64")}`,
  };
}
