// Acronis Cyber Protect Cloud uses OAuth2 client-credentials exclusively for API
// access (Cyber Protect console > Settings > API clients). There is no API-key or
// username/password mode.
//
// Like CrowdStrike's regional API hosts, an Acronis data center is a distinct API
// origin — a client_id / client_secret pair issued in the `us5-cloud.acronis.com`
// data center does not authenticate against `eu2-cloud.acronis.com`. Unlike
// CrowdStrike the set of data centers is open and customer-specific, so the URL
// is captured as free text at connect time and validated to an `*.acronis.com`
// origin here rather than picked from a fixed dropdown.
//
// NOTE: the endpoint shapes in this connector come from developer.acronis.com's
// published docs, not a live tenant — confirm against a real Acronis Cyber
// Protect Cloud tenant before this connector leaves beta.

const TOKEN_REFRESH_SKEW_MS = 60 * 1000;

// Accepts a data-center URL with or without a scheme / trailing slash / stray
// path and returns the bare `https://<host>` origin. Rejects anything that is not
// an `acronis.com` host so a copy-pasted wrong URL fails at connect time rather
// than as an opaque auth failure mid-run. Mirrors crowdstrike/credentials.js's
// resolveBaseUrl.
export function resolveDatacenterUrl(config) {
  let raw = typeof config?.datacenterUrl === "string" ? config.datacenterUrl.trim() : "";
  if (!raw) {
    throw new Error("Acronis connection is missing config.datacenterUrl");
  }

  let host = raw.replace(/^https?:\/\//i, "");
  host = host.replace(/\/.*$/, "");
  host = host.replace(/:\d+$/, "");
  host = host.toLowerCase();

  if (!host || !/^[a-z0-9.-]+\.acronis\.com$/.test(host)) {
    throw new Error(
      `Acronis connection has an unrecognised config.datacenterUrl: "${raw}". ` +
        `It must be your Cyber Protect Cloud data-center host, e.g. https://us5-cloud.acronis.com — ` +
        `copy it from the browser address bar while signed into the management console. ` +
        `A client credential pair only authenticates against the data center it was created in.`
    );
  }
  return `https://${host}`;
}

async function fetchAcronisToken({ datacenterUrl, clientId, clientSecret }) {
  const basic = Buffer.from(`${clientId}:${clientSecret}`).toString("base64");
  const res = await fetch(`${datacenterUrl}/api/2/idp/token`, {
    method: "POST",
    headers: {
      Authorization: `Basic ${basic}`,
      "Content-Type": "application/x-www-form-urlencoded",
      Accept: "application/json",
    },
    body: new URLSearchParams({ grant_type: "client_credentials" }),
  });
  if (!res.ok) {
    const errorText = await res.text();
    throw new Error(`Failed to acquire Acronis access token: ${res.status} ${errorText}`);
  }
  const body = await res.json();
  if (!body.access_token) throw new Error("Acronis token response is missing access_token");
  // Acronis returns `expires_on` as an absolute epoch-seconds timestamp; some
  // deployments also return a relative `expires_in`. Prefer whichever yields a
  // sane future lifetime, else default to ~2 hours (documented token TTL).
  const nowSec = Date.now() / 1000;
  let expiresInSec = null;
  if (Number.isFinite(Number(body.expires_on)) && Number(body.expires_on) > nowSec) {
    expiresInSec = Number(body.expires_on) - nowSec;
  } else if (Number.isFinite(Number(body.expires_in)) && Number(body.expires_in) > 0) {
    expiresInSec = Number(body.expires_in);
  }
  return { accessToken: body.access_token, expiresIn: expiresInSec || 7200 };
}

// Same createCachedTokenGetter pattern as crowdstrike/servicenow credentials —
// one client-credentials token is minted per collection run, not per API call,
// and refreshed proactively a minute before it expires.
function createCachedTokenGetter(tokenParams) {
  let cached = null;
  return async () => {
    if (cached && cached.expiresAt > Date.now()) return cached.token;
    const { accessToken, expiresIn } = await fetchAcronisToken(tokenParams);
    cached = {
      token: accessToken,
      expiresAt: Date.now() + expiresIn * 1000 - TOKEN_REFRESH_SKEW_MS,
    };
    return cached.token;
  };
}

export async function resolveAcronisCredentials({ authType, config, secret }) {
  if (authType !== "oauth2") {
    throw new Error(`Unsupported Acronis auth type: ${authType}`);
  }
  const datacenterUrl = resolveDatacenterUrl(config);
  if (!secret?.clientId) throw new Error("Acronis connection is missing secret.clientId");
  if (!secret?.clientSecret) throw new Error("Acronis connection is missing secret.clientSecret");

  const { clientId, clientSecret } = secret;

  return {
    getToken: createCachedTokenGetter({ datacenterUrl, clientId, clientSecret }),
    datacenterUrl,
    tenantHost: datacenterUrl.replace(/^https:\/\//, ""),
    clientId,
  };
}
