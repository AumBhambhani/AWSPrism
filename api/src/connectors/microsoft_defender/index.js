import { resolveDefenderCredentials, DEFENDER_BASE_URL } from "./credentials.js";
import { devicesTests } from "./tests/devices.js";
import { vulnerabilitiesTests } from "./tests/vulnerabilities.js";
import { recommendationsTests } from "./tests/recommendations.js";
import { alertsTests } from "./tests/alerts.js";
import { defenderGet } from "./oDataPaginate.js";

export const key = "microsoft_defender";

export const tests = [
  ...devicesTests,
  ...vulnerabilitiesTests,
  ...recommendationsTests,
  ...alertsTests,
];

// Distinguishes the common "token audience mismatch → 403" failure mode from
// genuine permission errors. The Defender for Endpoint API requires a token scoped
// to https://api.securitycenter.microsoft.com, NOT graph.microsoft.com — a
// misconfigured resource string is the most likely source of 403 errors here.
function describeDefenderError(err) {
  const msg = err?.message || String(err);
  if (msg.includes("403")) {
    return `${msg} — Defender for Endpoint authorization failure. Most commonly caused by a token audience mismatch: the token must be requested for resource "https://api.securitycenter.microsoft.com", not "https://graph.microsoft.com". Also verify Machine.Read.All, Vulnerability.Read.All, SecurityRecommendation.Read.All, and Alert.Read.All (or Alert.ReadWrite.All) are granted and admin-consented for the WindowsDefenderATP API resource.`;
  }
  if (msg.includes("401")) {
    return `${msg} — Token rejected. Verify the client secret is current and the tenant ID is correct.`;
  }
  if (msg.includes("429")) {
    return `${msg} — Defender API rate limit hit. Prism will retry on the next scheduled run.`;
  }
  return msg;
}

function buildClients(creds) {
  return {
    getToken: creds.getToken,
    baseUrl: DEFENDER_BASE_URL,
  };
}

export async function testConnection({ authType, config, secret }) {
  const creds = resolveDefenderCredentials({ authType, config, secret });
  const clients = buildClients(creds);
  try {
    await defenderGet(clients.getToken, clients.baseUrl, "/api/machines?$top=1");
  } catch (err) {
    throw new Error(describeDefenderError(err));
  }
  return { ok: true, externalAccountId: config.tenantId };
}

export async function runTests({ authType, config, secret }) {
  const creds = resolveDefenderCredentials({ authType, config, secret });
  const clients = buildClients(creds);
  const runResults = [];

  for (const test of tests) {
    try {
      const results = await test.run(clients);
      for (const result of results) {
        runResults.push({ testKey: test.key, title: test.title, failTitle: test.failTitle, severity: test.severityDefault, ...result });
      }
    } catch (err) {
      runResults.push({
        testKey: test.key,
        title: test.title,
        failTitle: test.failTitle,
        severity: test.severityDefault,
        resourceId: "error",
        status: "error",
        message: describeDefenderError(err),
        evidencePayload: {},
      });
    }
  }

  return runResults;
}
