// The appsec SIEM settings resource: GET /appsec/v1/configs/{id}/versions/{v}/siem
// Response carries the enable flag + (when not all-policies) a policy allowlist.
// TODO CONFIRM (plan Task 0): the exact "enabled" key. The appsec OpenAPI spec's
// SiemSettings schema shows `enableForAllPolicies`, `enableSiem`, `siemDefinitionId`
// and `firedRuleIds` — `enableSiem`/`enabled` are treated as the on-flag here;
// if a live account uses a different key, add it to ENABLE_KEYS.
const ENABLE_KEYS = ["enabled", "enableSiem", "enabledSiemSettings"];
const ALLOWLIST_KEYS = ["securityPolicyIds", "enabledPolicies", "policyIds"];

async function forEachProdConfig(akamai, fn) {
  const configs = await akamai.listSecurityConfigs();
  const rows = [];
  let saw = false;
  for (const config of configs) {
    const configId = config.id ?? config.configId;
    const { productionVersion } = await akamai.resolveActiveConfig(configId);
    if (!productionVersion) continue;
    saw = true;
    rows.push(await fn({ configId, version: productionVersion, name: config.name ?? String(configId) }));
  }
  if (!saw) return [{ resourceId: "akamai", status: "not_applicable", message: "No security configuration is activated on the production network", evidencePayload: {} }];
  return rows;
}

function readEnableFlag(body) {
  for (const k of ENABLE_KEYS) if (typeof body?.[k] === "boolean") return body[k];
  return undefined;
}

export async function checkSiemEnabled({ akamai }) {
  return forEachProdConfig(akamai, async ({ configId, version, name }) => {
    const body = await akamai.getSiemSettings(configId, version);
    const flag = readEnableFlag(body);
    if (flag === undefined) {
      return {
        resourceId: name,
        status: "error",
        message: `${name}: the SIEM settings response has no recognised enable flag (${ENABLE_KEYS.join("/")}) — this needs to be reconfirmed against a live Akamai account (see connector plan Task 0) before the check can be trusted.`,
        evidencePayload: { siemBodyKeys: Object.keys(body || {}) },
      };
    }
    return {
      resourceId: name,
      status: flag ? "pass" : "fail",
      message: flag ? `${name}: security-event SIEM export is enabled` : `${name}: security-event SIEM export is disabled`,
      evidencePayload: { enabled: flag },
    };
  });
}

export async function checkSiemAllPoliciesCovered({ akamai }) {
  return forEachProdConfig(akamai, async ({ configId, version, name }) => {
    const body = await akamai.getSiemSettings(configId, version);
    const flag = readEnableFlag(body);
    if (flag === false) {
      return { resourceId: name, status: "not_applicable", message: `${name}: SIEM export is disabled, policy coverage is moot`, evidencePayload: { enabled: false } };
    }
    if (body?.enableForAllPolicies === true) {
      return { resourceId: name, status: "pass", message: `${name}: SIEM export applies to all security policies`, evidencePayload: { enableForAllPolicies: true } };
    }
    const allowlist = ALLOWLIST_KEYS.map((k) => body?.[k]).find(Array.isArray) || [];
    const policies = await akamai.listSecurityPolicies(configId, version);
    const currentIds = policies.map((p) => p.policyId ?? p.id).filter(Boolean);
    const uncoveredPolicyIds = currentIds.filter((id) => !allowlist.includes(id));
    return {
      resourceId: name,
      status: uncoveredPolicyIds.length === 0 ? "pass" : "fail",
      message:
        uncoveredPolicyIds.length === 0
          ? `${name}: every current security policy is in the SIEM allowlist`
          : `${name}: ${uncoveredPolicyIds.length} security policy/policies are omitted from SIEM export`,
      evidencePayload: { allowlistSize: allowlist.length, currentPolicyCount: currentIds.length, uncoveredPolicyIds },
    };
  });
}

export const siemTests = [
  { key: "akamai.siem.integration_enabled", title: "Security-event SIEM export is enabled", failTitle: "Security-event SIEM export is disabled", severityDefault: "medium", isoReferences: ["A.12.4.1"], dpdpaControlAreas: ["Logging & Monitoring"], run: (clients) => checkSiemEnabled(clients) },
  { key: "akamai.siem.all_policies_covered", title: "SIEM export covers every security policy", failTitle: "A security policy is omitted from SIEM export", severityDefault: "medium", isoReferences: ["A.12.4.1"], dpdpaControlAreas: ["Logging & Monitoring"], run: (clients) => checkSiemAllPoliciesCovered(clients) },
];
