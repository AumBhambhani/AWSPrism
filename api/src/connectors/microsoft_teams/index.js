import { resolveTeamsCredentials } from "./credentials.js";
import { externalAccessTests, clientConfigTests, meetingPolicyTests, appPolicyTests } from "./tests/teamsConfig.js";
import { graphGet } from "../entra_id/tests/mfaAndAccess.js";

export const key = "microsoft_teams";

export const tests = [
  ...externalAccessTests,
  ...clientConfigTests,
  ...meetingPolicyTests,
  ...appPolicyTests,
];

function describeTeamsError(err) {
  const msg = err?.message || String(err);
  if (msg.includes("403") || msg.toLowerCase().includes("authorization_requestdenied")) {
    return `${msg} — Teams/TCM authorization failure. Verify Organization.Read.All permission is granted and admin consent was given. Note: TCM APIs also require the tenant's TCM service principal to be enrolled before Organization.Read.All unlocks policy reads.`;
  }
  if (msg.includes("401")) {
    return `${msg} — Token rejected. Verify the client secret and tenant ID are correct.`;
  }
  if (msg.includes("429")) {
    return `${msg} — Rate limit. Prism will retry on the next scheduled run.`;
  }
  return msg;
}

function buildClients(creds) {
  return { getToken: creds.getToken, tenantId: creds.tenantId };
}

export async function testConnection({ authType, config, secret }) {
  const creds = resolveTeamsCredentials({ authType, config, secret });
  const clients = buildClients(creds);
  try {
    // Probe with GET /teams?$top=1 — requires TeamSettings.Read.All
    await graphGet(clients.getToken, "/teams?$top=1");
  } catch (err) {
    throw new Error(describeTeamsError(err));
  }
  return { ok: true, externalAccountId: config.tenantId };
}

export async function runTests({ authType, config, secret }) {
  const creds = resolveTeamsCredentials({ authType, config, secret });
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
        message: describeTeamsError(err),
        evidencePayload: {},
      });
    }
  }

  return runResults;
}
