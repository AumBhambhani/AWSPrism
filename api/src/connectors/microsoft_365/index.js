import { resolveM365Credentials } from "./credentials.js";
import { exchangeTests } from "./tests/exchange.js";
import { sharepointTests } from "./tests/sharepoint.js";
import { intuneTests } from "./tests/intune.js";
import { defenderOfficeTests } from "./tests/defenderOffice.js";
import { graphGet } from "../entra_id/tests/mfaAndAccess.js";

export const key = "microsoft_365";

export const tests = [
  ...exchangeTests,
  ...sharepointTests,
  ...intuneTests,
  ...defenderOfficeTests,
];

function describeM365Error(err) {
  const msg = err?.message || String(err);
  if (msg.includes("403") || msg.toLowerCase().includes("insufficient privileges")) {
    return `${msg} — Authorization failure. For Exchange checks: confirm the app's service principal has the "Global Reader" Entra ID role and that Exchange.ManageAsApp permission was granted. For Graph checks: verify all required Graph application permissions are consented.`;
  }
  if (msg.includes("401")) {
    return `${msg} — Token rejected. Verify the client secret is current and the tenant ID is correct.`;
  }
  if (msg.includes("429")) {
    return `${msg} — Rate limit. Prism will retry on the next scheduled run.`;
  }
  return msg;
}

function buildClients(creds) {
  return {
    getGraphToken: creds.getGraphToken,
    getExchangeToken: creds.getExchangeToken,
    tenantId: creds.tenantId,
  };
}

export async function testConnection({ authType, config, secret }) {
  const creds = resolveM365Credentials({ authType, config, secret });
  const clients = buildClients(creds);

  // Probe both resources with allSettled so one failure doesn't hide the other.
  const [graphResult, exchangeResult] = await Promise.allSettled([
    graphGet(clients.getGraphToken, "/organization?$select=id,displayName"),
    (async () => {
      const token = await clients.getExchangeToken();
      const res = await fetch(`https://outlook.office365.com/adminapi/v2.0/${clients.tenantId}/GetOrganizationConfig`, {
        method: "POST",
        headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
        body: JSON.stringify({ CmdletInput: { CmdletName: "Get-OrganizationConfig" } }),
      });
      if (!res.ok) throw new Error(`Exchange probe failed: ${res.status}`);
    })(),
  ]);

  const graphOk = graphResult.status === "fulfilled";
  const exchangeOk = exchangeResult.status === "fulfilled";

  if (!graphOk && !exchangeOk) {
    throw new Error(`Both Microsoft 365 endpoints failed. Graph: ${describeM365Error(graphResult.reason)}. Exchange: ${describeM365Error(exchangeResult.reason)}`);
  }
  if (!graphOk) {
    throw new Error(`Microsoft 365 Graph access failed (Exchange is OK). ${describeM365Error(graphResult.reason)}`);
  }
  if (!exchangeOk) {
    throw new Error(`Microsoft 365 Exchange access failed (Graph is OK). ${describeM365Error(exchangeResult.reason)}`);
  }
  return { ok: true, externalAccountId: config.tenantId };
}

export async function runTests({ authType, config, secret }) {
  const creds = resolveM365Credentials({ authType, config, secret });
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
        message: describeM365Error(err),
        evidencePayload: {},
      });
    }
  }

  return runResults;
}
