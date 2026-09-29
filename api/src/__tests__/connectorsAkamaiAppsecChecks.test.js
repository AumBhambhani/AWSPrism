import { describe, test, expect, vi } from "vitest";
import {
  checkWafBlockMode,
  checkAttackGroupsEnabled,
  checkRateLimitingConfigured,
  checkConfigActivatedOnProduction,
} from "../connectors/akamai/tests/appsec.js";

// Minimal fake akamaiClient covering just the discovery + endpoint calls the
// appsec checks make.
function fakeAkamai({ configs = [], active = {}, policies = {}, modes = {}, attackGroups = {}, ratePolicies = {} } = {}) {
  return {
    listSecurityConfigs: async () => configs,
    resolveActiveConfig: async (id) => active[id] ?? { configId: id, productionVersion: null, latestVersion: null },
    listSecurityPolicies: async (id, v) => policies[`${id}:${v}`] ?? [],
    get: vi.fn(async (path) => {
      if (path.endsWith("/mode")) return modes[path] ?? { mode: "KRS" };
      if (path.endsWith("/attack-groups")) return attackGroups[path] ?? { attackGroups: [] };
      if (path.endsWith("/rate-policies")) return ratePolicies[path] ?? { ratePolicyActions: [] };
      if (path.includes("/activations")) return { activationHistory: [] };
      return {};
    }),
    describeAkamaiError: (e) => e.message,
  };
}

describe("checkWafBlockMode", () => {
  test("passes when every attack group on the policy has action 'deny'", async () => {
    const akamai = fakeAkamai({
      configs: [{ id: 1, name: "main" }],
      active: { 1: { configId: 1, productionVersion: 3, latestVersion: 3 } },
      policies: { "1:3": [{ policyId: "abc1_123", policyName: "default" }] },
      attackGroups: {
        "/appsec/v1/configs/1/versions/3/security-policies/abc1_123/attack-groups": {
          attackGroups: [
            { group: "SQL", action: "deny" },
            { group: "XSS", action: "deny" },
          ],
        },
      },
    });
    const results = await checkWafBlockMode({ akamai });
    expect(results).toHaveLength(1);
    expect(results[0].status).toBe("pass");
    expect(results[0].resourceId).toBe("main/default");
  });

  test("fails when any attack group is alert-only", async () => {
    const akamai = fakeAkamai({
      configs: [{ id: 1, name: "main" }],
      active: { 1: { configId: 1, productionVersion: 3, latestVersion: 3 } },
      policies: { "1:3": [{ policyId: "abc1_123", policyName: "default" }] },
      attackGroups: {
        "/appsec/v1/configs/1/versions/3/security-policies/abc1_123/attack-groups": {
          attackGroups: [
            { group: "SQL", action: "deny" },
            { group: "XSS", action: "alert" },
          ],
        },
      },
    });
    const results = await checkWafBlockMode({ akamai });
    expect(results[0].status).toBe("fail");
    expect(results[0].evidencePayload.alertOnlyGroups).toEqual(["XSS"]);
  });

  test("returns a single not_applicable row when no config is production-active", async () => {
    const akamai = fakeAkamai({
      configs: [{ id: 1, name: "main" }],
      active: { 1: { configId: 1, productionVersion: null, latestVersion: 2 } },
    });
    const results = await checkWafBlockMode({ akamai });
    expect(results).toEqual([
      { resourceId: "akamai", status: "not_applicable", message: "No security configuration is activated on the production network", evidencePayload: {} },
    ]);
  });
});

describe("checkAttackGroupsEnabled", () => {
  test("fails a policy that has an attack group with action 'none'", async () => {
    const akamai = fakeAkamai({
      configs: [{ id: 1, name: "main" }],
      active: { 1: { configId: 1, productionVersion: 3, latestVersion: 3 } },
      policies: { "1:3": [{ policyId: "p1", policyName: "default" }] },
      attackGroups: {
        "/appsec/v1/configs/1/versions/3/security-policies/p1/attack-groups": {
          attackGroups: [{ group: "SQL", action: "deny" }, { group: "CMD", action: "none" }],
        },
      },
    });
    const results = await checkAttackGroupsEnabled({ akamai });
    expect(results[0].status).toBe("fail");
    expect(results[0].evidencePayload.disabledGroups).toEqual(["CMD"]);
  });
});

describe("checkRateLimitingConfigured", () => {
  test("passes when the policy has at least one enforcing rate policy", async () => {
    const akamai = fakeAkamai({
      configs: [{ id: 1, name: "main" }],
      active: { 1: { configId: 1, productionVersion: 3, latestVersion: 3 } },
      policies: { "1:3": [{ policyId: "p1", policyName: "default" }] },
      ratePolicies: {
        "/appsec/v1/configs/1/versions/3/security-policies/p1/rate-policies": {
          ratePolicyActions: [{ id: 9, ipv4Action: "deny", ipv6Action: "deny" }],
        },
      },
    });
    const results = await checkRateLimitingConfigured({ akamai });
    expect(results[0].status).toBe("pass");
  });

  test("fails when every rate policy action is 'none'", async () => {
    const akamai = fakeAkamai({
      configs: [{ id: 1, name: "main" }],
      active: { 1: { configId: 1, productionVersion: 3, latestVersion: 3 } },
      policies: { "1:3": [{ policyId: "p1", policyName: "default" }] },
      ratePolicies: {
        "/appsec/v1/configs/1/versions/3/security-policies/p1/rate-policies": {
          ratePolicyActions: [{ id: 9, ipv4Action: "none", ipv6Action: "none" }],
        },
      },
    });
    const results = await checkRateLimitingConfigured({ akamai });
    expect(results[0].status).toBe("fail");
  });
});

describe("checkConfigActivatedOnProduction", () => {
  test("passes when the production version equals the latest version", async () => {
    const akamai = fakeAkamai({
      configs: [{ id: 1, name: "main" }],
      active: { 1: { configId: 1, productionVersion: 5, latestVersion: 5 } },
    });
    const results = await checkConfigActivatedOnProduction({ akamai });
    expect(results[0].status).toBe("pass");
  });

  test("fails when there is undeployed drift (latest > production)", async () => {
    const akamai = fakeAkamai({
      configs: [{ id: 1, name: "main" }],
      active: { 1: { configId: 1, productionVersion: 4, latestVersion: 6 } },
    });
    const results = await checkConfigActivatedOnProduction({ akamai });
    expect(results[0].status).toBe("fail");
    expect(results[0].message).toMatch(/2 version/);
  });

  test("fails when the config has never been activated on production", async () => {
    const akamai = fakeAkamai({
      configs: [{ id: 1, name: "main" }],
      active: { 1: { configId: 1, productionVersion: null, latestVersion: 3 } },
    });
    const results = await checkConfigActivatedOnProduction({ akamai });
    expect(results[0].status).toBe("fail");
  });
});
