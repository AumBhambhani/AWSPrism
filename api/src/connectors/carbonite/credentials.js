import { callDashboardService, DEFAULT_SERVICE_NS, DEFAULT_CONTRACT } from "./soapClient.js";

// OpenText Carbonite Core Endpoint Backup (formerly "Carbonite Endpoint") is a
// cloud endpoint-backup platform. This connector runs read-only posture checks
// against a customer's tenant — recent successful backup per device and device
// protection coverage — to evidence information backup (ISO 27001 A.12.3.1) and,
// for the coverage check, monitoring for silent lapses (A.12.4.1).
//
// The only Carbonite API confirmed to expose backup-status fields is the legacy
// SOAP "Dashboard Service" (a WCF `.svc` endpoint) — there is no REST read
// endpoint and no Node SDK. Auth is a customer-generated API key + the account
// email, passed *inside* every SOAP envelope as a `CallingContext` object
// { ContextIdentity: email, AuthenticationToken: apiKey, TokenType }. This is
// structurally distinct from every other connector: Commvault/Carbonite Server
// use HTTP headers, the cloud connectors use SDKs.
//
// UNCONFIRMED (connector plan Task 0): the real per-tenant Dashboard host
// pattern (docs use a `servername` placeholder), the `TokenType` enum value, and
// whether the REST API key doubles as the SOAP `AuthenticationToken`. All are
// marked TODO CONFIRM; checks degrade to a visible `status: "error"` rather than
// a guessed pass/fail. Confirm against a live tenant before this leaves `beta`.

const DASHBOARD_SERVICE_PATH = "/Dashboard/DashboardService.v.1.0.svc"; // TODO CONFIRM (Task 0, item 4)

// Accepts the Dashboard host with or without a scheme, a trailing slash, a stray
// path, or a port, and returns the bare host. Mirrors
// commvault/credentials.js's resolveWebconsoleUrl.
export function resolveDashboardHost(config) {
  const raw = typeof config?.dashboardHost === "string" ? config.dashboardHost.trim() : "";
  if (!raw) {
    throw new Error("Carbonite connection is missing config.dashboardHost");
  }

  let host = raw.replace(/^https?:\/\//i, "");
  host = host.replace(/\/.*$/, "");
  host = host.replace(/:\d+$/, "");
  host = host.toLowerCase();

  if (!host || !/^[a-z0-9.-]+\.[a-z]{2,}$/.test(host)) {
    throw new Error(
      `Carbonite connection has an invalid config.dashboardHost: "${raw}". ` +
        `Use the host your Core Endpoint Backup dashboard is served from, e.g. ` +
        `https://dashboard.carbonite.com — copy it from the browser address bar while signed in.`
    );
  }
  return host;
}

export async function resolveCarboniteCredentials({ authType, config, secret }) {
  if (authType !== "api_key") {
    throw new Error(`Unsupported Carbonite auth type: ${authType}`);
  }

  const dashboardHost = resolveDashboardHost(config);

  if (!secret?.email || typeof secret.email !== "string" || !secret.email.trim()) {
    throw new Error("Carbonite connection is missing secret.email (the account email)");
  }
  if (!secret?.apiKey || typeof secret.apiKey !== "string" || !secret.apiKey.trim()) {
    throw new Error("Carbonite connection is missing secret.apiKey");
  }

  const endpoint = `https://${dashboardHost}${DASHBOARD_SERVICE_PATH}`;
  const callingContext = {
    ContextIdentity: secret.email.trim(),
    AuthenticationToken: secret.apiKey.trim(),
    TokenType: "ApiKey", // TODO CONFIRM (Task 0, item 3) — enum value unpublished
  };

  // `call(operation, params)` — one Dashboard Service SOAP round-trip. The
  // checks depend only on this; the SOAP wire details stay in soapClient.js.
  async function call(operation, params = {}) {
    return callDashboardService({
      endpoint,
      operation,
      serviceNs: DEFAULT_SERVICE_NS,
      contract: DEFAULT_CONTRACT,
      callingContext,
      params,
    });
  }

  return { dashboardHost, host: dashboardHost, endpoint, callingContext, call };
}
