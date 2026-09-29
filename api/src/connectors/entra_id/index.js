import { resolveEntraIdCredentials } from "./credentials.js";
import { mfaAndAccessTests, rolesTests, usersTests, signInsTests, groupsTests, enterpriseAppsTests, auditTests } from "./tests/mfaAndAccess.js";
import { graphGet } from "./tests/mfaAndAccess.js";

export const key = "entra_id";

export const tests = [
  ...mfaAndAccessTests,
  ...rolesTests,
  ...usersTests,
  ...signInsTests,
  ...groupsTests,
  ...enterpriseAppsTests,
  ...auditTests,
];

// Surfaces Graph API errors with actionable guidance.
function describeGraphError(err) {
  const msg = err?.message || String(err);
  if (msg.includes("403") || msg.toLowerCase().includes("authorization_requestdenied") || msg.toLowerCase().includes("insufficient privileges")) {
    return `${msg} — Graph authorization failure. Check that all required API permissions are granted and admin consent has been given for the tenant. Missing permissions cause 403 even when the app registration is otherwise valid.`;
  }
  if (msg.includes("429")) {
    return `${msg} — Microsoft Graph rate limit hit. Prism will retry on the next scheduled run.`;
  }
  if (msg.includes("401")) {
    return `${msg} — Invalid or expired token. Verify the client secret has not expired (check the app registration's Certificates & secrets blade) and that the tenant ID is correct.`;
  }
  return msg;
}

function buildClients(creds) {
  return {
    getToken: creds.getToken,
    tenantId: creds.tenantId,
  };
}

export async function testConnection({ authType, config, secret }) {
  const creds = resolveEntraIdCredentials({ authType, config, secret });
  const clients = buildClients(creds);
  try {
    await graphGet(clients.getToken, "/organization?$select=id,displayName");
  } catch (err) {
    throw new Error(describeGraphError(err));
  }
  return { ok: true, externalAccountId: config.tenantId };
}

export async function runTests({ authType, config, secret }) {
  const creds = resolveEntraIdCredentials({ authType, config, secret });
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
        message: describeGraphError(err),
        evidencePayload: {},
      });
    }
  }

  return runResults;
}
