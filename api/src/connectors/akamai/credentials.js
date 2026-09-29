import EdgeGrid from "akamai-edgegrid";

// Akamai APIs authenticate with the EdgeGrid (EG1-HMAC-SHA256) request-signing
// scheme. There is no bearer token and no token exchange — every request carries
// an Authorization header computed from a four-part credential (client token,
// client secret, access token, and the per-credential API host). We use the
// official `akamai-edgegrid` package purely as a signer: `.auth()` populates
// `eg.request.headers.Authorization`, which we hand back to the HTTP client.
//
// `config.host` is per-credential and is NOT a single global Akamai hostname —
// it looks like `akab-xxxx.luna.akamaiapis.net` and must be captured verbatim.

// Accept a host with or without scheme / trailing slash / stray path and return
// the bare hostname. Reject anything that is not an `*.akamaiapis.net` host so a
// typo fails at connect time rather than as an opaque signing failure mid-run.
export function normaliseAkamaiHost(raw) {
  const value = typeof raw === "string" ? raw.trim() : "";
  if (!value) throw new Error("Akamai connection is missing config.host");
  let host = value.replace(/^https?:\/\//i, "");
  host = host.replace(/\/.*$/, "");
  host = host.replace(/:\d+$/, "");
  host = host.toLowerCase();
  if (!/^[a-z0-9][a-z0-9.-]*\.akamaiapis\.net$/.test(host)) {
    throw new Error(
      `Akamai connection has an invalid config.host: "${raw}". Use the "host" value from your ` +
        `Control Center API-client .edgerc block, e.g. "akab-xxxx.luna.akamaiapis.net".`
    );
  }
  return host;
}

export async function resolveAkamaiCredentials({ authType, config, secret }) {
  if (authType !== "api_key") {
    throw new Error(`Unsupported Akamai auth type: ${authType}`);
  }
  const host = normaliseAkamaiHost(config?.host);

  const clientToken = typeof secret?.clientToken === "string" ? secret.clientToken.trim() : "";
  const clientSecret = typeof secret?.clientSecret === "string" ? secret.clientSecret.trim() : "";
  const accessToken = typeof secret?.accessToken === "string" ? secret.accessToken.trim() : "";
  if (!clientToken) throw new Error("Akamai connection is missing secret.clientToken");
  if (!clientSecret) throw new Error("Akamai connection is missing secret.clientSecret");
  if (!accessToken) throw new Error("Akamai connection is missing secret.accessToken");

  const accountSwitchKey =
    typeof config?.accountSwitchKey === "string" && config.accountSwitchKey.trim()
      ? config.accountSwitchKey.trim()
      : null;

  // One EdgeGrid instance is reused for the whole collection run; `.auth()` is
  // stateless per call — it recomputes timestamp + nonce + signature each time.
  const eg = new EdgeGrid(clientToken, clientSecret, accessToken, `https://${host}`);

  function sign({ method, path, headers = {}, body = "" }) {
    eg.auth({
      path,
      method: (method || "GET").toUpperCase(),
      headers: { ...headers },
      body: body || "",
    });
    return eg.request.headers.Authorization;
  }

  return { host, accountSwitchKey, sign };
}
