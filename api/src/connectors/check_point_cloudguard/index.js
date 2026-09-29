import { resolveCheckPointCloudguardCredentials } from "./credentials.js";
import { checkPointCloudguardClient } from "./client.js";
import { postureTests } from "./tests/posture.js";

export const key = "check_point_cloudguard";

export const tests = [...postureTests];

export const THRESHOLDS = {
  ASSESSMENT_FRESHNESS_DAYS: 7,
  CRITICAL_REMEDIATION_SLA_DAYS: 7,
  HIGH_FINDING_COUNT_THRESHOLD: 25,
  EXCLUSION_MAX_FUTURE_DAYS: 365,
};

function groupTestsByArea(allTests) {
  const groups = new Map();
  for (const test of allTests) {
    const area = test.key.split(".")[1];
    if (!groups.has(area)) groups.set(area, []);
    groups.get(area).push(test);
  }
  return groups;
}

export function isScopeError(error) {
  const message = (error?.message || String(error)).toLowerCase();
  return ["http 403", "http 404", "forbidden", "not licensed", "not entitled", "access denied", "insufficient"].some((part) => message.includes(part));
}

export function describeCheckPointCloudguardError(error) {
  const message = error?.message || String(error);
  const lower = message.toLowerCase();
  if (lower.includes("http 429") || lower.includes("rate limit")) {
    return `${message} — CloudGuard is rate limiting; lower this connection's collection frequency.`;
  }
  if (lower.includes("http 401") || lower.includes("unauthorized")) {
    return `${message} — CloudGuard authentication failed. Re-check the API key id / secret and that config.baseUrl matches your data centre.`;
  }
  if (lower.includes("http 403") || lower.includes("forbidden")) {
    return `${message} — the API key's role does not permit this call. Grant a read-only role covering Cloud Accounts, Compliance and Posture Findings.`;
  }
  return `${message} — verify the CloudGuard API key and the data-centre base URL.`;
}

export function buildClients(api) {
  const memo = new Map();
  const once = (name, loader) => {
    if (!memo.has(name)) memo.set(name, loader());
    return memo.get(name);
  };

  return {
    THRESHOLDS,
    listCloudAccounts: () => once("accounts", () => api.request("GET", "/CloudAccounts")),
    listAssessmentHistory: () => once("history", async () => {
      const data = await api.request("GET", "/AssessmentHistoryV2", { query: { pageSize: 500, pageNumber: 0 } });
      return Array.isArray(data) ? data : Array.isArray(data?.items) ? data.items : data?.assessments ?? null;
    }),
    listContinuousCompliancePolicies: () => once("cc-policies", () => api.request("GET", "/Compliance/ContinuousCompliancePolicy")),
    searchFindings: () => once("findings", () => api.search("/Compliance/Finding/search", { severities: ["High", "Critical"], showExcluded: false }, { itemsKey: "findings", totalKey: "totalFindings" })),
    listExclusions: () => once("exclusions", () => api.request("GET", "/Compliance/Exclusion")),
  };
}

export async function testConnection({ authType, config, secret }) {
  const creds = await resolveCheckPointCloudguardCredentials({ authType, config, secret });
  const api = checkPointCloudguardClient({ baseUrl: creds.baseUrl, authHeader: creds.authHeader });
  try {
    const accounts = await api.request("GET", "/CloudAccounts");
    const count = Array.isArray(accounts) ? accounts.length : 0;
    return { ok: true, externalAccountId: `${creds.baseUrl}${creds.dataCenter ? ` (${creds.dataCenter})` : ""} — ${count} account(s)` };
  } catch (error) {
    throw new Error(describeCheckPointCloudguardError(error));
  }
}

export async function runTests({ authType, config, secret }) {
  const creds = await resolveCheckPointCloudguardCredentials({ authType, config, secret });
  const api = checkPointCloudguardClient({ baseUrl: creds.baseUrl, authHeader: creds.authHeader });
  const clients = buildClients(api);
  const rows = [];
  for (const [area, definitions] of groupTestsByArea(tests)) {
    for (const definition of definitions) {
      try {
        const results = await definition.run(clients);
        for (const result of results) {
          rows.push({ testKey: definition.key, title: definition.title, failTitle: definition.failTitle, severity: definition.severityDefault, ...result });
        }
      } catch (error) {
        const scoped = isScopeError(error);
        rows.push({
          testKey: definition.key,
          title: definition.title,
          failTitle: definition.failTitle,
          severity: definition.severityDefault,
          resourceId: scoped ? "not_applicable" : "error",
          status: scoped ? "not_applicable" : "error",
          message: scoped
            ? `CloudGuard "${area}" data is not available to this API key's role — ${describeCheckPointCloudguardError(error)}`
            : describeCheckPointCloudguardError(error),
          evidencePayload: {},
        });
      }
    }
  }
  return rows;
}
