import { resolveGcpCredentials } from "./credentials.js";
import { iamTests } from "./tests/iam.js";
import { storageTests } from "./tests/storage.js";
import { computeTests } from "./tests/compute.js";
import { sqlTests } from "./tests/sql.js";
import { kmsTests } from "./tests/kms.js";
import { networkTests } from "./tests/network.js";
import { loggingTests } from "./tests/logging.js";

export const key = "gcp";

export const tests = [...iamTests, ...storageTests, ...computeTests, ...sqlTests, ...kmsTests, ...networkTests, ...loggingTests];

// googleapis errors carry structured detail on `err.response.data.error`
// (Google's standard REST error envelope: { code, message, errors[] }) or,
// for auth-library failures (bad key, disabled service account), a plain
// `err.message` from the token endpoint.
function describeGcpError(err) {
  const fromResponse = err?.response?.data?.error?.message;
  if (fromResponse) return fromResponse;
  const fromErrors = err?.errors?.[0]?.message;
  if (fromErrors) return fromErrors;
  return err.message;
}

export async function testConnection({ authType, config, secret }) {
  try {
    const clients = await resolveGcpCredentials({ authType, config, secret });
    // Forces a real API call scoped to the project — throws if the service
    // account lacks any IAM role on it or the project doesn't exist. This is
    // GCP's analog of AWS's STS GetCallerIdentity connectivity probe.
    await clients.cloudresourcemanager.projects.getIamPolicy({ resource: `projects/${clients.projectId}`, requestBody: {} });
    return { ok: true, externalAccountId: clients.projectId };
  } catch (err) {
    throw new Error(describeGcpError(err));
  }
}

export async function runTests({ authType, config, secret }) {
  let clients;
  try {
    clients = await resolveGcpCredentials({ authType, config, secret });
  } catch (err) {
    throw new Error(describeGcpError(err));
  }

  const runResults = [];
  for (const test of tests) {
    try {
      const results = await test.run(clients);
      for (const result of results) {
        runResults.push({ testKey: test.key, title: test.title, failTitle: test.failTitle, severity: test.severityDefault, ...result });
      }
    } catch (err) {
      runResults.push({ testKey: test.key, title: test.title, failTitle: test.failTitle, severity: test.severityDefault, resourceId: "error", status: "error", message: describeGcpError(err), evidencePayload: {} });
    }
  }
  return runResults;
}
