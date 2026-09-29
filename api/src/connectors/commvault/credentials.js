// Commvault (https://www.commvault.com) is an enterprise backup / data-protection
// platform. This connector runs read-only posture checks against a customer's
// CommCell through its WebConsole REST API — backup SLA health, storage-policy
// copy immutability (WORM / compliance lock) and encryption, and backup-failure
// alerting — to evidence information backup (ISO 27001 A.12.3), protection of
// records (A.18.1), cryptographic controls (A.10.1) and event logging (A.12.4)
// controls.
//
// Auth is a customer-generated **Custom-scope access token** (Command Center >
// user > Access Tokens). Every REST call authenticates with a flat
// `Authtoken: <token>` header — no /Login round-trip, no token exchange, no
// expiry handling here (the token's own scope/expiry, fixed when the customer
// generated it, governs access). Structurally this is closer to AWS's static
// access-key credential than Acronis/CrowdStrike's client-credentials exchange,
// so there is no cached-token getter.
//
// Commvault has no official Node SDK (`cvpysdk` is Python-only). The REST paths
// and response field names in this connector were researched against `cvpysdk`'s
// source during planning; the ones that could not be confirmed are marked
// `TODO CONFIRM` in tests/*.js and degrade to a visible `status: "error"` result
// rather than a guessed pass/fail. Confirm against a live CommCell's Swagger UI
// (`https://<webconsole>/webconsole/api/swagger/index.html`) before this
// connector leaves `beta`.

// Accepts the CommCell WebConsole base URL with or without a scheme, a trailing
// slash, a stray path, or a port, and returns the bare `https://<host>` origin.
// Rejects anything that isn't a plausible hostname so a copy-pasted wrong URL
// fails at connect time rather than as an opaque fetch error mid-run. Mirrors
// acronis/credentials.js's resolveDatacenterUrl / privy's normalisePrivyHost.
export function resolveWebconsoleUrl(config) {
  const raw = typeof config?.webconsoleUrl === "string" ? config.webconsoleUrl.trim() : "";
  if (!raw) {
    throw new Error("Commvault connection is missing config.webconsoleUrl");
  }

  let host = raw.replace(/^https?:\/\//i, "");
  host = host.replace(/\/.*$/, "");
  host = host.replace(/:\d+$/, "");
  host = host.toLowerCase();

  if (!host || !/^[a-z0-9.-]+\.[a-z]{2,}$/.test(host)) {
    throw new Error(
      `Commvault connection has an invalid config.webconsoleUrl: "${raw}". ` +
        `Use the CommCell WebConsole base URL you sign in to, e.g. https://commvault.example.com — ` +
        `copy it from the browser address bar while signed into Command Center.`
    );
  }
  return `https://${host}`;
}

export async function resolveCommvaultCredentials({ authType, config, secret }) {
  if (authType !== "api_key") {
    throw new Error(`Unsupported Commvault auth type: ${authType}`);
  }

  const webconsoleUrl = resolveWebconsoleUrl(config);

  if (!secret?.accessToken || typeof secret.accessToken !== "string" || !secret.accessToken.trim()) {
    throw new Error("Commvault connection is missing secret.accessToken");
  }

  const host = webconsoleUrl.replace(/^https:\/\//, "");

  return {
    accessToken: secret.accessToken.trim(),
    webconsoleUrl,
    host,
    // Commvault's REST API is served under /webconsole/api on the WebConsole host.
    apiRoot: `${webconsoleUrl}/webconsole/api`,
  };
}
