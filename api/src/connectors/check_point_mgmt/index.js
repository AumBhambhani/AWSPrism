import { resolveCheckPointMgmtCredentials } from "./credentials.js";
import { checkPointMgmtClient } from "./client.js";
import { policyTests } from "./tests/policy.js";
import { gatewayTests } from "./tests/gateway.js";
import { threatTests } from "./tests/threat.js";

export const key = "check_point_mgmt";

export const tests = [...policyTests, ...gatewayTests, ...threatTests];

export const THRESHOLDS = {
  IPS_DB_MAX_AGE_DAYS: 30,
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
  return [
    "http 403",
    "http 404",
    "forbidden",
    "err_forbidden",
    "generic_err_no_permissions",
    "not_implemented",
    "command not found",
    "not licensed",
  ].some((part) => message.includes(part));
}

export function describeCheckPointMgmtError(error) {
  const message = error?.message || String(error);
  const lower = message.toLowerCase();
  if (lower.includes("http 429") || lower.includes("rate limit")) {
    return `${message} — the Check Point Management API is rate limiting; lower this connection's collection frequency.`;
  }
  if (lower.includes("http 401") || lower.includes("wrong_username_or_password") || lower.includes("login_failed") || lower.includes("missing sid")) {
    return `${message} — Check Point Management authentication failed. Re-check the administrator API key and that the API key is not expired.`;
  }
  if (lower.includes("http 403") || lower.includes("no_permissions") || lower.includes("forbidden")) {
    return `${message} — the administrator does not have permission for this command. Grant a read-only administrator role.`;
  }
  if (lower.includes("fetch failed") || lower.includes("econnrefused") || lower.includes("enotfound") || lower.includes("timeout")) {
    return `${message} — Prism could not reach the Management API at the configured URL. For a self-managed server the api-server must accept connections from Prism's egress; Smart-1 Cloud tenants use the tenant service URL from the Infinity Portal.`;
  }
  return `${message} — verify config.mgmtUrl and the administrator API key.`;
}

export function buildClients(session) {
  const memo = new Map();
  const once = (name, loader) => {
    if (!memo.has(name)) memo.set(name, loader());
    return memo.get(name);
  };

  const firstPackageName = once("package-name", async () => {
    const data = await session.post("show-packages", { "details-level": "full", limit: 100, offset: 0 });
    const packages = Array.isArray(data?.packages) ? data.packages : [];
    if (!packages.length) throw new Error("show-packages returned no policy packages");
    return packages[0].name;
  });

  return {
    THRESHOLDS,
    apiServerVersion: session.apiServerVersion,
    getAccessRulebase: () => once("access-rulebase", async () => {
      const name = await firstPackageName;
      const data = await session.post("show-access-rulebase", {
        name: `${name} Network`,
        "use-object-dictionary": true,
        "details-level": "standard",
        limit: 500,
        offset: 0,
      });
      return {
        rulebase: Array.isArray(data?.rulebase) ? data.rulebase : null,
        dictionary: data?.["objects-dictionary"] || [],
        packageName: name,
      };
    }),
    getGateways: () => once("gateways", async () => {
      const data = await session.post("show-gateways-and-servers", { "details-level": "full", limit: 500, offset: 0 });
      return Array.isArray(data?.objects) ? data.objects : null;
    }),
    getThreatProfiles: () => once("threat-profiles", async () => {
      const data = await session.post("show-threat-profiles", { "details-level": "full", limit: 500, offset: 0 });
      return Array.isArray(data?.objects) ? data.objects : Array.isArray(data?.packages) ? data.packages : null;
    }),
    getThreatRulebase: () => once("threat-rulebase", async () => {
      const name = await firstPackageName;
      const data = await session.post("show-threat-rulebase", {
        name: `${name} Threat Prevention`,
        "use-object-dictionary": true,
        limit: 500,
        offset: 0,
      });
      return {
        rulebase: Array.isArray(data?.rulebase) ? data.rulebase : null,
        dictionary: data?.["objects-dictionary"] || [],
      };
    }),
    getIpsStatus: () => once("ips-status", () => session.post("show-ips-status", {})),
  };
}

export async function testConnection({ authType, config, secret }) {
  const creds = await resolveCheckPointMgmtCredentials({ authType, config, secret });
  const api = checkPointMgmtClient({ mgmtOrigin: creds.mgmtOrigin, apiVersion: creds.apiVersion });
  let session;
  try {
    session = await api.openSession({ apiKey: creds.apiKey, domain: creds.domain });
    await session.post("show-packages", { limit: 1, offset: 0, "details-level": "standard" });
    return { ok: true, externalAccountId: creds.mgmtOrigin };
  } catch (error) {
    throw new Error(describeCheckPointMgmtError(error));
  } finally {
    if (session) await session.logout();
  }
}

export async function runTests({ authType, config, secret }) {
  const creds = await resolveCheckPointMgmtCredentials({ authType, config, secret });
  const api = checkPointMgmtClient({ mgmtOrigin: creds.mgmtOrigin, apiVersion: creds.apiVersion });
  const session = await api.openSession({ apiKey: creds.apiKey, domain: creds.domain });
  const clients = buildClients(session);
  const rows = [];
  try {
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
              ? `The Check Point Management "${area}" commands are not available to this administrator — ${describeCheckPointMgmtError(error)}`
              : describeCheckPointMgmtError(error),
            evidencePayload: {},
          });
        }
      }
    }
  } finally {
    await session.logout();
  }
  return rows;
}
