// Privy by IDfy (https://www.privybyidfy.com) is a DPDP-Act compliance platform —
// consent governance, data-principal rights (DPRM), PIA/DPIA, incident management,
// third-party risk, and data discovery ("Data Compass"). This connector runs
// read-only posture checks against a customer's Privy tenant, mirroring the
// OneTrust connector (api/src/connectors/onetrust/).
//
// Privy has no public API reference; the endpoint paths in index.js are built
// from the documented module behaviour and flagged `NOTE:` — confirm them against
// the target tenant's API reference before this connector leaves `beta`.
//
// Auth is a tenant API key (bearer). If a live tenant reference turns out to use
// OAuth2 client-credentials instead, switch authType to "oauth2" and lift the
// cached-token getter from onetrust/credentials.js verbatim.

// The customer types the Privy tenant domain they sign in with — accept it with
// or without a scheme, a trailing slash, a stray path, or a port, and hand back
// the bare host. Rejects anything that isn't a plausible hostname so a typo fails
// at connect time rather than as an opaque fetch error mid-run.
export function normalisePrivyHost(raw) {
  if (!raw || typeof raw !== "string") {
    throw new Error("Privy connection is missing config.baseUrl");
  }
  let host = raw.trim();
  host = host.replace(/^https?:\/\//i, ""); // scheme
  host = host.replace(/\/.*$/, ""); // path / trailing slash
  host = host.replace(/:\d+$/, ""); // port
  host = host.toLowerCase();
  if (!/^[a-z0-9.-]+\.[a-z]{2,}$/.test(host)) {
    throw new Error(
      `Privy connection has an invalid config.baseUrl: "${raw}". ` +
        `Use the tenant domain you sign in with, e.g. "acme.privybyidfy.com" or "app.privybyidfy.com".`
    );
  }
  return host;
}

export async function resolvePrivyCredentials({ authType, config, secret }) {
  if (authType !== "api_key") {
    throw new Error(`Unsupported Privy auth type: ${authType}`);
  }
  const host = normalisePrivyHost(config?.baseUrl);
  if (!secret?.apiKey || typeof secret.apiKey !== "string" || !secret.apiKey.trim()) {
    throw new Error("Privy connection is missing secret.apiKey");
  }

  return {
    apiKey: secret.apiKey.trim(),
    host,
    baseUrl: `https://${host}`,
  };
}
