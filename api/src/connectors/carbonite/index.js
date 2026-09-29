import { resolveCarboniteCredentials } from "./credentials.js";
import { backupTests } from "./tests/backup.js";
import { coverageTests } from "./tests/coverage.js";

export const key = "carbonite";

export const tests = [...backupTests, ...coverageTests];

// A Dashboard Service call the API key isn't authorised for comes back either as
// an HTTP 401/403, a SOAP `Status: InvalidCredentials`, or a `Completed`
// response whose `OverallStatus` is `NotAllowed` / `InsufficientPermissions`.
// The first two are auth failures; the third is "not granted" and downgrades to
// not_applicable (mirrors commvault/index.js's isScopeError).
function isScopeError(err) {
  const m = (err?.message || String(err)).toLowerCase();
  return (
    m.includes("notallowed") ||
    m.includes("insufficientpermissions") ||
    m.includes(" 403") ||
    m.includes("forbidden")
  );
}

export function describeCarboniteError(err) {
  const message = err?.message || String(err);
  const lower = message.toLowerCase();

  if (lower.includes(" 429") || lower.includes("rate limit") || lower.includes("too many requests")) {
    return (
      `${message} — Carbonite rate limit hit. The Endpoint API enforces ~50 requests/hour/route; ` +
      `reduce this connection's collection frequency if it recurs.`
    );
  }

  if (
    lower.includes("invalidcredentials") ||
    lower.includes("rejected the credentials") ||
    lower.includes(" 401") ||
    lower.includes("unauthorized")
  ) {
    return (
      `${message} — Carbonite rejected the API key. Regenerate a read-only-scoped API key from the ` +
      `Core Endpoint Backup dashboard's Key Management page, confirm the account email matches, and ` +
      `confirm the dashboard host is correct.`
    );
  }

  if (lower.includes("notallowed") || lower.includes("insufficientpermissions") || lower.includes(" 403")) {
    return (
      `${message} — Carbonite rejected the request. The API key's scope does not cover the Dashboard ` +
      `Service read operations Prism uses (GetDeviceList, GetDashboardDeviceInfo). Regenerate the key ` +
      `with dashboard read access.`
    );
  }

  if (lower.includes("soap fault") || lower.includes("wsdl") || lower.includes("envelope shape")) {
    return (
      `${message} — the Carbonite Dashboard Service SOAP envelope shape could not be resolved. This ` +
      `connector's wire format is unverified (beta); it needs confirming against a live tenant's WSDL.`
    );
  }

  if (lower.includes("config.dashboardhost") || lower.includes("secret.email") || lower.includes("secret.apikey")) {
    return message;
  }

  return (
    `${message} — verify the Carbonite dashboard host (config.dashboardHost), the account email, and ` +
    `that the API key is valid and has dashboard read access.`
  );
}

export async function testConnection({ authType, config, secret }) {
  const creds = await resolveCarboniteCredentials({ authType, config, secret });
  try {
    // GetDeviceList is the cheapest read and the connectivity + credential probe
    // (parseSoapResponse throws on Status: InvalidCredentials / a SOAP fault).
    await creds.call("GetDeviceList", {});
    return { ok: true, externalAccountId: creds.host };
  } catch (err) {
    throw new Error(describeCarboniteError(err));
  }
}

export async function runTests({ authType, config, secret }) {
  const creds = await resolveCarboniteCredentials({ authType, config, secret });
  const runResults = [];

  for (const test of tests) {
    try {
      const results = await test.run(creds);
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
          ? `Carbonite check "${test.key}" could not run with this API key's scope — ${describeCarboniteError(err)}`
          : describeCarboniteError(err),
        evidencePayload: {},
      });
    }
  }

  return runResults;
}
