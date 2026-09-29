// Check Point Infinity Portal authentication.
//
// A customer creates an API key in the Infinity Portal (Global Settings > API
// Keys). An *Account* API key is scoped to a single service, so a customer
// typically creates one key per service — Logs/Events, Endpoint, XDR/XPR — and
// pastes each pair. A broader *user* API key can cover several services with one
// pair. `secret` therefore accepts either:
//
//   { clientId, accessKey }                                  -- one key, all services
//   { events: { clientId, accessKey }, endpoint: {...}, xdr: {...} }  -- per service
//
// A service with no key configured is reported not_applicable, never an error.
//
// Auth: POST {gatewayUrl}/auth/external { clientId, accessKey } -> { data: { token } },
// a ~30-minute bearer JWT. The regional gateway host is captured explicitly
// (config.gatewayUrl) and never defaulted to a single global host.

export const REGION_GATEWAYS = {
  eu: "https://cloudinfra-gw.portal.checkpoint.com",
  us: "https://cloudinfra-gw-us.portal.checkpoint.com",
  ap: "https://cloudinfra-gw-ap.portal.checkpoint.com",
};

export const SERVICES = ["events", "endpoint", "xdr"];

export function normaliseGatewayUrl(rawUrl, rawRegion) {
  const region = rawRegion == null ? "" : String(rawRegion).trim().toLowerCase();
  if (!rawUrl || !String(rawUrl).trim()) {
    if (REGION_GATEWAYS[region]) return { gatewayUrl: REGION_GATEWAYS[region], region };
    throw new Error("Check Point Infinity connection is missing config.gatewayUrl (or a known config.region)");
  }
  let value = String(rawUrl).trim();
  if (!/^https?:\/\//i.test(value)) value = `https://${value}`;
  let url;
  try {
    url = new URL(value);
  } catch {
    throw new Error(`Check Point Infinity connection has an invalid config.gatewayUrl: "${rawUrl}"`);
  }
  if (url.protocol !== "https:") {
    throw new Error(`Check Point Infinity connection config.gatewayUrl must be https, got "${rawUrl}"`);
  }
  const inferred = Object.entries(REGION_GATEWAYS).find(([, host]) => host === url.origin)?.[0];
  return { gatewayUrl: url.origin, region: region || inferred || "" };
}

async function fetchInfinityToken(gatewayUrl, { clientId, accessKey }) {
  const response = await fetch(`${gatewayUrl}/auth/external`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Accept: "application/json" },
    body: JSON.stringify({ clientId, accessKey }),
  });
  const text = await response.text();
  let body = {};
  try {
    body = text ? JSON.parse(text) : {};
  } catch {
    body = {};
  }
  if (!response.ok) {
    throw new Error(`Check Point Infinity token request failed: HTTP ${response.status} ${body?.message || text}`);
  }
  const token = body?.data?.token || body?.token;
  if (!token) throw new Error("Check Point Infinity token response is missing data.token");
  // Documented lifetime is ~30 minutes; honour an explicit expiresIn if present.
  const expiresInSec = Number(body?.data?.expiresIn || body?.data?.expires || 0) || 30 * 60;
  return { token, expiresInSec };
}

const TOKEN_REFRESH_SKEW_MS = 60_000;

export function createCachedTokenGetter(gatewayUrl, keyPair) {
  let cached;
  return async () => {
    if (cached && cached.expiresAt > Date.now()) return cached.token;
    const { token, expiresInSec } = await fetchInfinityToken(gatewayUrl, keyPair);
    cached = { token, expiresAt: Date.now() + Math.max(1_000, expiresInSec * 1_000 - TOKEN_REFRESH_SKEW_MS) };
    return cached.token;
  };
}

function pickKeyPair(secret, service) {
  if (secret?.[service]?.clientId && secret[service]?.accessKey) {
    return { clientId: String(secret[service].clientId), accessKey: String(secret[service].accessKey) };
  }
  if (secret?.clientId && secret?.accessKey) {
    return { clientId: String(secret.clientId), accessKey: String(secret.accessKey) };
  }
  return null;
}

export async function resolveCheckPointCredentials({ authType, config, secret }) {
  if (authType !== "api_key") {
    throw new Error(`Unsupported Check Point Infinity auth type: ${authType}`);
  }
  const { gatewayUrl, region } = normaliseGatewayUrl(config?.gatewayUrl, config?.region);

  const anyKey = SERVICES.some((service) => pickKeyPair(secret, service));
  if (!anyKey) {
    throw new Error("Check Point Infinity connection has no API key — provide { clientId, accessKey } or a per-service block");
  }

  const services = {};
  for (const service of SERVICES) {
    const keyPair = pickKeyPair(secret, service);
    services[service] = keyPair ? createCachedTokenGetter(gatewayUrl, keyPair) : null;
  }

  return { gatewayUrl, region, services };
}
