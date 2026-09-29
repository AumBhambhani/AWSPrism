import { resolveGithubCredentials } from "./credentials.js";
import { accessTests } from "./tests/access.js";
import { securityTests } from "./tests/security.js";
import { orgManagementTests } from "./tests/orgManagement.js";
import { actionsTests } from "./tests/actions.js";
import { codeScanningTests } from "./tests/codeScanning.js";

export const key = "github";

export const tests = [...accessTests, ...securityTests, ...orgManagementTests, ...actionsTests, ...codeScanningTests];

// Octokit's RequestError carries the useful detail in `.status`/`.message`
// (and, on rate-limit responses, `.response.headers["x-ratelimit-*"]`) — none
// of this is guaranteed readable from `.message` alone the way ARM's errors
// are handled in describeAzureError, so this distinguishes the cases that
// actually change what an admin should go do about it.
function describeGithubError(err) {
  if (err?.response?.headers?.["x-ratelimit-remaining"] === "0") {
    const resetAt = new Date(Number(err.response.headers["x-ratelimit-reset"]) * 1000).toISOString();
    return `GitHub API rate limit exhausted for this installation token (resets at ${resetAt}).`;
  }
  if (err?.status === 403) {
    return `GitHub rejected this request as forbidden (${err.message}). Double-check the App's installed permissions match what Prism's checks require.`;
  }
  if (err?.status === 404) {
    return `GitHub returned Not Found (${err.message}). Double-check the organization login and that the App installation includes the expected repositories.`;
  }
  return err.message;
}

async function buildClients(octokit, org) {
  const repos = await octokit.paginate(octokit.rest.repos.listForOrg, { org, type: "all" });
  return { octokit, org, repos };
}

export async function testConnection({ authType, config, secret }) {
  const octokit = await resolveGithubCredentials({ authType, config, secret });
  try {
    const { data: orgData } = await octokit.rest.orgs.get({ org: config.org });
    return { ok: true, externalAccountId: String(orgData.id) };
  } catch (err) {
    throw new Error(describeGithubError(err));
  }
}

export async function runTests({ authType, config, secret }) {
  const octokit = await resolveGithubCredentials({ authType, config, secret });
  try {
    const clients = await buildClients(octokit, config.org);
    const runResults = [];
    for (const test of tests) {
      try {
        const results = await test.run(clients);
        for (const result of results) {
          runResults.push({ testKey: test.key, title: test.title, failTitle: test.failTitle, severity: test.severityDefault, ...result });
        }
      } catch (err) {
        runResults.push({ testKey: test.key, title: test.title, failTitle: test.failTitle, severity: test.severityDefault, resourceId: "error", status: "error", message: describeGithubError(err), evidencePayload: {} });
      }
    }
    return runResults;
  } catch (err) {
    throw new Error(describeGithubError(err));
  }
}
