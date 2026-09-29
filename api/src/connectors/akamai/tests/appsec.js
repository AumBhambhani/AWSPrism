// Actions that mean "not enforcing / not inspecting".
const NON_ENFORCING = new Set(["", "none", "alert", "monitor"]);

function isEnforcing(action) {
  return !NON_ENFORCING.has(String(action || "").toLowerCase());
}

// Iterate every security policy of every production-active security config.
// `fn({ akamai, configId, version, policyId, resourceId })` returns one result row.
// Returns a single not_applicable row when nothing is production-active.
async function forEachProdPolicy(akamai, fn) {
  const configs = await akamai.listSecurityConfigs();
  const rows = [];
  let sawProdConfig = false;

  for (const config of configs) {
    const configId = config.id ?? config.configId;
    const { productionVersion } = await akamai.resolveActiveConfig(configId);
    if (!productionVersion) continue;
    sawProdConfig = true;
    const policies = await akamai.listSecurityPolicies(configId, productionVersion);
    for (const policy of policies) {
      const policyId = policy.policyId ?? policy.id;
      const resourceId = `${config.name ?? configId}/${policy.policyName ?? policyId}`;
      rows.push(await fn({ akamai, configId, version: productionVersion, policyId, resourceId }));
    }
  }

  if (!sawProdConfig) {
    return [{ resourceId: "akamai", status: "not_applicable", message: "No security configuration is activated on the production network", evidencePayload: {} }];
  }
  return rows;
}

// NOTE: this evaluates attack-group actions only, not the separate
// `.../security-policies/{id}/mode` endpoint the spec §4 mentions. Attack-group
// actions are the real per-rule enforcement signal (a policy in "AAG"/KRS mode
// with every group alert-only is not blocking); revisit if `/mode` proves to
// carry independent signal.
export async function checkWafBlockMode({ akamai }) {
  return forEachProdPolicy(akamai, async ({ configId, version, policyId, resourceId }) => {
    const body = await akamai.get(
      `/appsec/v1/configs/${configId}/versions/${version}/security-policies/${policyId}/attack-groups`
    );
    const groups = body?.attackGroups || [];
    const alertOnlyGroups = groups.filter((g) => !isEnforcing(g.action)).map((g) => g.group);
    const enforcing = alertOnlyGroups.length === 0 && groups.length > 0;
    return {
      resourceId,
      status: groups.length === 0 ? "warn" : enforcing ? "pass" : "fail",
      message:
        groups.length === 0
          ? `${resourceId} exposes no attack-group actions to inspect`
          : enforcing
          ? `${resourceId}: all ${groups.length} attack groups enforce in deny mode`
          : `${resourceId}: ${alertOnlyGroups.length} attack group(s) are alert-only, not blocking`,
      evidencePayload: { totalGroups: groups.length, alertOnlyGroups },
    };
  });
}

export async function checkAttackGroupsEnabled({ akamai }) {
  return forEachProdPolicy(akamai, async ({ configId, version, policyId, resourceId }) => {
    const body = await akamai.get(
      `/appsec/v1/configs/${configId}/versions/${version}/security-policies/${policyId}/attack-groups`
    );
    const groups = body?.attackGroups || [];
    const disabledGroups = groups.filter((g) => String(g.action || "").toLowerCase() === "none").map((g) => g.group);
    return {
      resourceId,
      status: groups.length === 0 ? "warn" : disabledGroups.length === 0 ? "pass" : "fail",
      message:
        groups.length === 0
          ? `${resourceId} exposes no attack groups`
          : disabledGroups.length === 0
          ? `${resourceId}: every attack group has an action other than "none"`
          : `${resourceId}: ${disabledGroups.length} attack group(s) are set to "none" (not inspected)`,
      evidencePayload: { totalGroups: groups.length, disabledGroups },
    };
  });
}

export async function checkRateLimitingConfigured({ akamai }) {
  return forEachProdPolicy(akamai, async ({ configId, version, policyId, resourceId }) => {
    const body = await akamai.get(
      `/appsec/v1/configs/${configId}/versions/${version}/security-policies/${policyId}/rate-policies`
    );
    const actions = body?.ratePolicyActions || body?.ratePolicies || [];
    const enforcing = actions.filter((a) => isEnforcing(a.ipv4Action) || isEnforcing(a.ipv6Action) || isEnforcing(a.action));
    return {
      resourceId,
      status: enforcing.length > 0 ? "pass" : "fail",
      message:
        enforcing.length > 0
          ? `${resourceId}: ${enforcing.length} enforcing rate policy/policies configured`
          : `${resourceId}: no rate policy has an enforcing action`,
      evidencePayload: { totalRatePolicies: actions.length, enforcingRatePolicies: enforcing.length },
    };
  });
}

export async function checkConfigActivatedOnProduction({ akamai }) {
  const configs = await akamai.listSecurityConfigs();
  if (configs.length === 0) {
    return [{ resourceId: "akamai", status: "not_applicable", message: "No security configurations found for this account", evidencePayload: {} }];
  }
  const rows = [];
  for (const config of configs) {
    const configId = config.id ?? config.configId;
    const { productionVersion, latestVersion } = await akamai.resolveActiveConfig(configId);
    const resourceId = config.name ?? String(configId);
    if (!productionVersion) {
      rows.push({ resourceId, status: "fail", message: `${resourceId}: security configuration has never been activated on production`, evidencePayload: { productionVersion, latestVersion } });
      continue;
    }
    const lag = (latestVersion ?? productionVersion) - productionVersion;
    rows.push({
      resourceId,
      status: lag <= 0 ? "pass" : "fail",
      message:
        lag <= 0
          ? `${resourceId}: production is running the latest version (${productionVersion})`
          : `${resourceId}: production is ${lag} version(s) behind the latest editable version — undeployed security changes`,
      evidencePayload: { productionVersion, latestVersion },
    });
  }
  return rows;
}

export const appsecTests = [
  { key: "akamai.appsec.waf_policies_in_block_mode", title: "WAF security policies enforce in block/deny mode", failTitle: "A WAF security policy is not enforcing in block/deny mode", severityDefault: "high", isoReferences: ["A.14.1.2"], dpdpaControlAreas: ["Network Security"], run: (clients) => checkWafBlockMode(clients) },
  { key: "akamai.appsec.attack_groups_enabled", title: "All OWASP attack groups have an enforcing action", failTitle: "An OWASP attack group is disabled", severityDefault: "high", isoReferences: ["A.14.2.5"], dpdpaControlAreas: ["Secure Development & API Security"], run: (clients) => checkAttackGroupsEnabled(clients) },
  { key: "akamai.appsec.rate_limiting_configured", title: "A rate-limiting policy with an enforcing action exists", failTitle: "No enforcing rate-limiting policy is configured", severityDefault: "medium", isoReferences: ["A.13.1.1"], dpdpaControlAreas: ["Network Security"], run: (clients) => checkRateLimitingConfigured(clients) },
  { key: "akamai.appsec.config_activated_on_production", title: "Security configs are activated on production at their latest version", failTitle: "A security configuration has undeployed changes or is not activated on production", severityDefault: "high", isoReferences: ["A.12.1.2"], dpdpaControlAreas: ["Security Safeguards Program"], run: (clients) => checkConfigActivatedOnProduction(clients) },
];
