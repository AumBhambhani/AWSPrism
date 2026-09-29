import { resolveCarboniteServerCredentials } from "./credentials.js";
import { backupTests } from "./tests/backup.js";
import { monitoringTests } from "./tests/monitoring.js";

export const key = "carbonite-server";

export const tests = [...backupTests, ...monitoringTests];

// Groups checks by the segment of their key after "carbonite-server."
// ("carbonite-server.monitoring.agent_online" -> "monitoring") so runTests()
// runs each area in its own isolation boundary — a Reseller-scoped Keycloak
// client might read Safesets but not Agents, and a 403 on one area's endpoint
// should fall those checks back to not_applicable while every other area still
// runs. Mirrors commvault/index.js's groupTestsByArea.
function groupTestsByArea(allTests) {
  const map = new Map();
  for (const test of allTests) {
    const area = test.key.split(".")[1];
    if (!map.has(area)) map.set(area, []);
    map.get(area).push(test);
  }
  return map;
}

// One thin OData client per run (the request helper returned by
// resolveCarboniteServerCredentials already mints + caches the Keycloak token
// lazily). No SDK, no per-area sub-clients — mirrors commvault/index.js.
function buildClients(creds) {
  return { carboniteServer: { request: creds.request } };
}

// A Reseller-scoped Keycloak client that isn't authorised for an OData entity
// comes back as HTTP 403 (out of access-level scope) or 404 (entity not present
// on this install) — that's "not granted", not a Prism error, so runTests
// downgrades it to not_applicable.
function isScopeError(err) {
  const m = (err?.message || String(err)).toLowerCase();
  return (
    m.includes(" 403") ||
    m.includes(" 404") ||
    m.includes("forbidden") ||
    m.includes("access denied") ||
    m.includes("not authorized") ||
    m.includes("unauthorized")
  );
}

export function describeCarboniteServerError(err) {
  const message = err?.message || String(err);
  const lower = message.toLowerCase();

  if (lower.includes(" 429") || lower.includes("rate limit") || lower.includes("too many requests")) {
    return `${message} — Carbonite Server Backup rate limit hit. Reduce this connection's collection frequency if it recurs.`;
  }

  if (
    lower.includes("token request failed") ||
    lower.includes("invalid_client") ||
    lower.includes("missing access_token") ||
    lower.includes(" 401") ||
    lower.includes("unauthorized")
  ) {
    return (
      `${message} — Carbonite Server Backup rejected the Keycloak client credentials. Re-check the ` +
      `Client ID / Client secret from the vendor's client-registration script, confirm the realm name ` +
      `(config.keycloakRealm) matches the install, and confirm the API - Monitoring host is reachable.`
    );
  }

  if (lower.includes(" 403") || lower.includes("forbidden") || lower.includes("access denied")) {
    return (
      `${message} — Carbonite Server Backup rejected the request. The Keycloak client's access level ` +
      `(Admin / Partner / Reseller) does not cover one of the OData entities Prism reads (Safesets, ` +
      `Agents, Companies). An entity the client can't read is skipped (its checks report not ` +
      `applicable). Re-register the client at Reseller level scoped to the monitored company.`
    );
  }

  if (
    lower.includes("config.apidomain") ||
    lower.includes("config.keycloakrealm") ||
    lower.includes("secret.clientid") ||
    lower.includes("secret.clientsecret")
  ) {
    return message;
  }

  return (
    `${message} — verify the API - Monitoring host (config.apiDomain), the Keycloak realm ` +
    `(config.keycloakRealm), and that the registered client is valid and scoped to read Safesets and Agents.`
  );
}

export async function testConnection({ authType, config, secret }) {
  const creds = await resolveCarboniteServerCredentials({ authType, config, secret });

  try {
    // GET /odata/Companies doubles as the connectivity / auth probe — the token
    // exchange runs on this first call (creds.request mints it lazily), and
    // Companies is readable at every access level (Admin / Partner / Reseller).
    // TODO CONFIRM the path against a live install's Swagger UI.
    await creds.request("/odata/Companies");
    return { ok: true, externalAccountId: creds.host };
  } catch (err) {
    throw new Error(describeCarboniteServerError(err));
  }
}

export async function runTests({ authType, config, secret }) {
  const creds = await resolveCarboniteServerCredentials({ authType, config, secret });
  const clients = buildClients(creds);
  const runResults = [];

  for (const [area, areaTests] of groupTestsByArea(tests)) {
    for (const test of areaTests) {
      try {
        const results = await test.run(clients);
        for (const result of results) {
          runResults.push({
            testKey: test.key,
            title: test.title,
            failTitle: test.failTitle,
            severity: test.severityDefault,
            ...result,
          });
        }
      } catch (err) {
        const scoped = isScopeError(err);
        runResults.push({
          testKey: test.key,
          title: test.title,
          failTitle: test.failTitle,
          severity: test.severityDefault,
          resourceId: scoped ? "not_applicable" : "error",
          status: scoped ? "not_applicable" : "error",
          message: scoped
            ? `Carbonite Server Backup "${area}" checks could not run with this Keycloak client's access level — ${describeCarboniteServerError(err)}`
            : describeCarboniteServerError(err),
          evidencePayload: {},
        });
      }
    }
  }

  return runResults;
}
