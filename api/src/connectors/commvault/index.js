import { resolveCommvaultCredentials } from "./credentials.js";
import { commvaultClient } from "./client.js";
import { backupTests } from "./tests/backup.js";
import { storageTests } from "./tests/storage.js";
import { monitoringTests } from "./tests/monitoring.js";

export const key = "commvault";

export const tests = [...backupTests, ...storageTests, ...monitoringTests];

// Groups checks by the segment of their key after "commvault."
// ("commvault.storage.worm_lock_enabled" → "storage") so runTests() runs each
// area in its own isolation boundary — a Custom-scope access token might
// allowlist /Alerts but not /StoragePolicy, and a 403 on one area's endpoint
// should fall those checks back to not_applicable while every other area still
// runs. Mirrors acronis/index.js's groupTestsByArea.
function groupTestsByArea(allTests) {
  const map = new Map();
  for (const test of allTests) {
    const area = test.key.split(".")[1];
    if (!map.has(area)) map.set(area, []);
    map.get(area).push(test);
  }
  return map;
}

// buildClients is trivial for Commvault (one thin REST client, no SDK, no
// per-area sub-clients) — unlike AWS/Azure/Acronis's multi-client buildClients.
function buildClients(creds) {
  return { commvault: commvaultClient(creds.apiRoot, creds.accessToken) };
}

// A Custom-scope access token that doesn't allowlist an endpoint comes back as
// HTTP 403 (path not in apiEndpoints) or 404 (feature not present) — that's "not
// granted", not a Prism error, so runTests downgrades it to not_applicable.
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

export function describeCommvaultError(err) {
  const message = err?.message || String(err);
  const lower = message.toLowerCase();

  if (lower.includes(" 429") || lower.includes("rate limit") || lower.includes("too many requests")) {
    return `${message} — Commvault rate limit hit. Reduce this connection's collection frequency if it recurs.`;
  }

  if (lower.includes(" 401") || lower.includes("unauthorized") || lower.includes("invalid token")) {
    return (
      `${message} — Commvault rejected the access token. Regenerate a Custom-scope access token in ` +
      `Command Center > your user > Access Tokens, confirm it has not expired, and check the ` +
      `WebConsole base URL matches the CommCell the token was created on.`
    );
  }

  if (lower.includes(" 403") || lower.includes("forbidden") || lower.includes("access denied")) {
    return (
      `${message} — Commvault rejected the request. The Custom-scope access token's apiEndpoints ` +
      `allowlist is missing one of the paths Prism reads (/Alerts, /dashboard, /StoragePolicy, ` +
      `/v2/StoragePolicy). An endpoint the token doesn't allow is skipped (its checks report not ` +
      `applicable). Regenerate the token with the full endpoint list from the setup instructions.`
    );
  }

  if (lower.includes("config.webconsoleurl") || lower.includes("webconsoleurl") || lower.includes("secret.accesstoken")) {
    return message;
  }

  return `${message} — verify the Commvault WebConsole base URL and that the Custom-scope access token is valid and allowlists every endpoint Prism reads.`;
}

export async function testConnection({ authType, config, secret }) {
  const creds = await resolveCommvaultCredentials({ authType, config, secret });
  const client = commvaultClient(creds.apiRoot, creds.accessToken);

  try {
    // GET /Alerts doubles as Commvault's connectivity / auth probe — it's
    // already required in the token's apiEndpoints allowlist for the monitoring
    // check, so validating the connection needs no extra allowlist entry.
    await client.request("/Alerts");

    // Commvault's REST API has no confirmed lightweight "CommCell identity"
    // endpoint reachable within a typical Custom-scope token allowlist, so the
    // WebConsole host is used as a stable, always-available identifier — not a
    // true CommCell GUID, but enough to distinguish connections in the UI
    // without an extra API call.
    return { ok: true, externalAccountId: creds.host };
  } catch (err) {
    throw new Error(describeCommvaultError(err));
  }
}

export async function runTests({ authType, config, secret }) {
  const creds = await resolveCommvaultCredentials({ authType, config, secret });
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
            ? `Commvault "${area}" checks could not run with this access token's endpoint allowlist — ${describeCommvaultError(err)}`
            : describeCommvaultError(err),
          evidencePayload: {},
        });
      }
    }
  }

  return runResults;
}
