import { describe, expect, test } from "vitest";
import { THRESHOLDS, tests } from "../connectors/check_point_mgmt/index.js";

const DICT = [
  { uid: "any", name: "Any" },
  { uid: "accept", name: "Accept" },
  { uid: "drop", name: "Drop" },
  { uid: "log", name: "Log" },
  { uid: "none", name: "None" },
  { uid: "gw", name: "gw-cluster" },
  { uid: "http", name: "http" },
];

function healthyClients() {
  return {
    THRESHOLDS,
    getAccessRulebase: async () => ({
      packageName: "Standard",
      dictionary: DICT,
      rulebase: [
        { "rule-number": 1, enabled: true, name: "Stealth", type: "access-rule", source: ["any"], destination: ["gw"], service: ["any"], action: "drop", track: { type: "log" } },
        { "rule-number": 2, enabled: true, name: "Web", type: "access-rule", source: ["any"], destination: ["any"], service: ["http"], action: "accept", track: { type: "log" } },
        { "rule-number": 3, enabled: true, name: "Cleanup", type: "access-rule", source: ["any"], destination: ["any"], service: ["any"], action: "drop", track: { type: "log" } },
      ],
    }),
    getGateways: async () => [
      { name: "gw-cluster", type: "CpmiGatewayCluster", version: "R81.20", policy: { "access-policy-installed": true } },
    ],
    getThreatProfiles: async () => [{ name: "Optimized", "confidence-level-high": "prevent" }],
    getThreatRulebase: async () => ({ dictionary: [], rulebase: [{ "rule-number": 1, type: "threat-rule", enabled: true, name: "TP" }] }),
    getIpsStatus: async () => ({ "update-available": false, "installed-version": "635155796", "last-updated": { posix: Date.now() } }),
  };
}

describe("Check Point Management checks", () => {
  test("all 11 checks pass for a healthy management fixture", async () => {
    const clients = healthyClients();
    const rows = [];
    for (const definition of tests) rows.push(...(await definition.run(clients)));
    expect(rows).toHaveLength(11);
    expect(rows.filter((r) => r.status === "error")).toEqual([]);
    expect(rows.filter((r) => r.status === "fail")).toEqual([]);
    expect(rows.every((r) => r.evidencePayload?.details)).toBe(true);
  });

  test("a permissive Any/Any/Any Accept rule is a finding", async () => {
    const clients = healthyClients();
    const base = await clients.getAccessRulebase();
    clients.getAccessRulebase = async () => ({
      ...base,
      rulebase: [...base.rulebase, { "rule-number": 4, enabled: true, name: "Bad", type: "access-rule", source: ["any"], destination: ["any"], service: ["any"], action: "accept", track: { type: "log" } }],
    });
    const rows = await tests.find((t) => t.key === "check_point_mgmt.policy.no_permissive_any_rule").run(clients);
    expect(rows[0].status).toBe("fail");
    expect(rows[0].message).toMatch(/Any source to Any destination/);
  });

  test("an out-of-support gateway version is a finding", async () => {
    const clients = healthyClients();
    clients.getGateways = async () => [{ name: "old-gw", type: "simple-gateway", version: "R80.40", policy: { "access-policy-installed": true } }];
    const rows = await tests.find((t) => t.key === "check_point_mgmt.gateway.software_supported").run(clients);
    expect(rows[0].status).toBe("fail");
  });

  test("a malformed rulebase is reported as error, not a guessed pass", async () => {
    const clients = healthyClients();
    clients.getAccessRulebase = async () => ({ rulebase: null, dictionary: [] });
    const rows = await tests.find((t) => t.key === "check_point_mgmt.policy.cleanup_rule_present").run(clients);
    expect(rows[0].status).toBe("error");
  });

  test("an IPS database with an update available is a finding", async () => {
    const clients = healthyClients();
    clients.getIpsStatus = async () => ({ "update-available": true, "installed-version": "1", "latest-version": "2" });
    const rows = await tests.find((t) => t.key === "check_point_mgmt.threat.ips_signatures_current").run(clients);
    expect(rows[0].status).toBe("fail");
  });
});
