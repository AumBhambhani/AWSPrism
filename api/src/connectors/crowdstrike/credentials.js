// CrowdStrike Falcon uses OAuth2 client-credentials exclusively for API access
// (Support and resources > API Clients and Keys in the Falcon console). There is
// no API-key or username/password mode.
//
// The single sharpest edge in this connector: Falcon's regions are fully
// separate API hosts with no cross-region routing, so a client-credential pair
// created in an EU-1 tenant fails authentication entirely against
// api.crowdstrike.com. `config.baseUrl` is captured explicitly at connect time
// (derived from the region dropdown, not inferred at call time) so a tenant's
// region stays unambiguous even if CrowdStrike's region list changes.

const TOKEN_REFRESH_SKEW_MS = 60 * 1000;

// cloudRegion → API base URL. Kept here (not derived from the console URL at call
// time) so the mapping is auditable and a new region is a one-line change.
export const REGION_BASE_URLS = {
  "us-1": "https://api.crowdstrike.com",
  "us-2": "https://api.us-2.crowdstrike.com",
  "eu-1": "https://api.eu-1.crowdstrike.com",
  "us-gov-1": "https://api.laggar.gcw.crowdstrike.com",
  "us-gov-2": "https://api.us-gov-2.crowdstrike.mil",
};

export const CLOUD_REGIONS = Object.keys(REGION_BASE_URLS);

// Resolves the API base URL from an explicit `config.baseUrl` when present
// (canonical source once a connection is saved), else from `config.cloudRegion`.
// Accepts a base URL with or without a scheme / trailing slash / stray path and
// returns the bare `https://<host>` origin. Rejects anything that isn't one of
// CrowdStrike's known regional hosts so a copy-pasted wrong host fails at connect
// time rather than as an opaque auth failure mid-run.
export function resolveBaseUrl(config) {
  const region = typeof config?.cloudRegion === "string" ? config.cloudRegion.trim().toLowerCase() : null;
  let raw = typeof config?.baseUrl === "string" ? config.baseUrl.trim() : "";

  if (!raw && region) {
    if (!REGION_BASE_URLS[region]) {
      throw new Error(
        `CrowdStrike connection has an unknown config.cloudRegion: "${config.cloudRegion}". ` +
          `Expected one of: ${CLOUD_REGIONS.join(", ")}.`
      );
    }
    return REGION_BASE_URLS[region];
  }

  if (!raw) {
    throw new Error("CrowdStrike connection is missing config.baseUrl / config.cloudRegion");
  }

  let host = raw.replace(/^https?:\/\//i, "");
  host = host.replace(/\/.*$/, "");
  host = host.replace(/:\d+$/, "");
  host = host.toLowerCase();

  const known = new Set(Object.values(REGION_BASE_URLS).map((u) => u.replace(/^https:\/\//, "")));
  if (!known.has(host)) {
    throw new Error(
      `CrowdStrike connection has an unrecognised config.baseUrl: "${raw}". ` +
        `It must be one of CrowdStrike's regional API hosts (${[...known].join(", ")}) — ` +
        `a credential pair only authenticates against the region it was created in.`
    );
  }
  return `https://${host}`;
}

async function fetchCrowdstrikeToken({ baseUrl, clientId, clientSecret }) {
  const res = await fetch(`${baseUrl}/oauth2/token`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded", Accept: "application/json" },
    body: new URLSearchParams({ client_id: clientId, client_secret: clientSecret }),
  });
  if (!res.ok) {
    const errorText = await res.text();
    throw new Error(`Failed to acquire CrowdStrike access token: ${res.status} ${errorText}`);
  }
  const body = await res.json();
  if (!body.access_token) throw new Error("CrowdStrike token response is missing access_token");
  // Falcon bearer tokens live ~30 minutes; expires_in is in seconds. Default to
  // 1800 if absent.
  return { accessToken: body.access_token, expiresIn: Number(body.expires_in) || 1800 };
}

// Same createCachedTokenGetter pattern as servicenow/credentials.js and
// connectors/shared/microsoftGraphAuth.js — one client-credentials token is
// minted per collection run, not per API call, and refreshed proactively a
// minute before its ~30-minute TTL expires. The connector never assumes a token
// outlives a single runTests() invocation.
function createCachedTokenGetter(tokenParams) {
  let cached = null;
  return async () => {
    if (cached && cached.expiresAt > Date.now()) return cached.token;
    const { accessToken, expiresIn } = await fetchCrowdstrikeToken(tokenParams);
    cached = {
      token: accessToken,
      expiresAt: Date.now() + expiresIn * 1000 - TOKEN_REFRESH_SKEW_MS,
    };
    return cached.token;
  };
}

export async function resolveCrowdstrikeCredentials({ authType, config, secret }) {
  if (authType !== "oauth2") {
    throw new Error(`Unsupported CrowdStrike auth type: ${authType}`);
  }
  const baseUrl = resolveBaseUrl(config);
  if (!secret?.clientId) throw new Error("CrowdStrike connection is missing secret.clientId");
  if (!secret?.clientSecret) throw new Error("CrowdStrike connection is missing secret.clientSecret");

  const { clientId, clientSecret } = secret;
  const host = baseUrl.replace(/^https:\/\//, "");
  const cloudRegion =
    Object.entries(REGION_BASE_URLS).find(([, url]) => url === baseUrl)?.[0] ??
    (typeof config?.cloudRegion === "string" ? config.cloudRegion : null);

  return {
    getToken: createCachedTokenGetter({ baseUrl, clientId, clientSecret }),
    baseUrl,
    host,
    cloudRegion,
  };
}
