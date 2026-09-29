import { resolveGoogleWorkspaceCredentials } from "./credentials.js";
import { securityTests } from "./tests/security.js";
import { adminTests } from "./tests/admin.js";
import { oauthTests } from "./tests/oauth.js";
import { groupsTests } from "./tests/groups.js";
import { driveTests } from "./tests/drive.js";
import { gmailTests } from "./tests/gmail.js";
import { calendarTests } from "./tests/calendar.js";
import { devicesTests } from "./tests/devices.js";
import { usersTests } from "./tests/users.js";
import { auditTests } from "./tests/audit.js";

export const key = "google_workspace";

export const tests = [...securityTests, ...adminTests, ...oauthTests, ...groupsTests, ...driveTests, ...gmailTests, ...calendarTests, ...devicesTests, ...usersTests, ...auditTests];

// googleapis errors carry structured detail on `err.response.data.error`
// (Google's standard REST error envelope: { code, message, errors[] }) or,
// for auth-library failures (bad key, unauthorized Client ID/scope), a plain
// `err.message` from the token endpoint — neither is guaranteed to be present
// on every failure mode, so this checks progressively less-structured spots.
function describeGoogleWorkspaceError(err) {
  const fromResponse = err?.response?.data?.error?.message;
  if (fromResponse) return fromResponse;
  const fromErrors = err?.errors?.[0]?.message;
  if (fromErrors) return fromErrors;
  return err.message;
}

export async function testConnection({ authType, config, secret }) {
  try {
    const clients = await resolveGoogleWorkspaceCredentials({ authType, config, secret });
    return { ok: true, externalAccountId: clients.customerId };
  } catch (err) {
    throw new Error(describeGoogleWorkspaceError(err));
  }
}

export async function runTests({ authType, config, secret }) {
  let clients;
  try {
    clients = await resolveGoogleWorkspaceCredentials({ authType, config, secret });
  } catch (err) {
    throw new Error(describeGoogleWorkspaceError(err));
  }

  const runResults = [];
  for (const test of tests) {
    try {
      const results = await test.run(clients);
      for (const result of results) {
        runResults.push({ testKey: test.key, title: test.title, failTitle: test.failTitle, severity: test.severityDefault, ...result });
      }
    } catch (err) {
      runResults.push({ testKey: test.key, title: test.title, failTitle: test.failTitle, severity: test.severityDefault, resourceId: "error", status: "error", message: describeGoogleWorkspaceError(err), evidencePayload: {} });
    }
  }
  return runResults;
}
