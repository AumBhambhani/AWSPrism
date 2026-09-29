import { describe, test, expect } from "vitest";
import { checkSiemEnabled, checkSiemAllPoliciesCovered } from "../connectors/akamai/tests/siem.js";

function fakeAkamai({ configs = [], active = {}, policies = {}, siem = {} } = {}) {
  return {
    listSecurityConfigs: async () => configs,
    resolveActiveConfig: async (id) => active[id] ?? { configId: id, productionVersion: null, latestVersion: null },
    listSecurityPolicies: async (id, v) => policies[`${id}:${v}`] ?? [],
    getSiemSettings: async (id, v) => siem[`${id}:${v}`] ?? {},
  };
}

describe("checkSiemEnabled", () => {
  test("passes when SIEM settings report enabled: true", async () => {
    const akamai = fakeAkamai({
      configs: [{ id: 1, name: "main" }],
      active: { 1: { configId: 1, productionVersion: 2, latestVersion: 2 } },
      siem: { "1:2": { enabled: true, enableForAllPolicies: true } },
    });
    const results = await checkSiemEnabled({ akamai });
    expect(results[0].status).toBe("pass");
  });

  test("fails when SIEM settings report disabled", async () => {
    const akamai = fakeAkamai({
      configs: [{ id: 1, name: "main" }],
      active: { 1: { configId: 1, productionVersion: 2, latestVersion: 2 } },
      siem: { "1:2": { enabled: false } },
    });
    const results = await checkSiemEnabled({ akamai });
    expect(results[0].status).toBe("fail");
  });

  test("returns error (not a guess) when the SIEM body has no recognised enable flag", async () => {
    const akamai = fakeAkamai({
      configs: [{ id: 1, name: "main" }],
      active: { 1: { configId: 1, productionVersion: 2, latestVersion: 2 } },
      siem: { "1:2": { somethingElse: 1 } },
    });
    const results = await checkSiemEnabled({ akamai });
    expect(results[0].status).toBe("error");
    expect(results[0].message).toMatch(/reconfirm|live/i);
  });

  test("not_applicable when nothing is production-active", async () => {
    const akamai = fakeAkamai({ configs: [{ id: 1, name: "main" }], active: { 1: { productionVersion: null } } });
    const results = await checkSiemEnabled({ akamai });
    expect(results[0].status).toBe("not_applicable");
  });
});

describe("checkSiemAllPoliciesCovered", () => {
  test("passes when enableForAllPolicies is true", async () => {
    const akamai = fakeAkamai({
      configs: [{ id: 1, name: "main" }],
      active: { 1: { configId: 1, productionVersion: 2, latestVersion: 2 } },
      siem: { "1:2": { enabled: true, enableForAllPolicies: true } },
    });
    const results = await checkSiemAllPoliciesCovered({ akamai });
    expect(results[0].status).toBe("pass");
  });

  test("fails when a current policy id is missing from the SIEM allowlist", async () => {
    const akamai = fakeAkamai({
      configs: [{ id: 1, name: "main" }],
      active: { 1: { configId: 1, productionVersion: 2, latestVersion: 2 } },
      policies: { "1:2": [{ policyId: "p1" }, { policyId: "p2" }] },
      siem: { "1:2": { enabled: true, enableForAllPolicies: false, firedRuleIds: [], securityPolicyIds: ["p1"] } },
    });
    const results = await checkSiemAllPoliciesCovered({ akamai });
    expect(results[0].status).toBe("fail");
    expect(results[0].evidencePayload.uncoveredPolicyIds).toEqual(["p2"]);
  });
});
