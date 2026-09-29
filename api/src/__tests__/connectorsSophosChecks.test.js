import { describe, expect, test } from "vitest";
import { THRESHOLDS, tests } from "../connectors/sophos/index.js";

const now = () => new Date().toISOString();

function healthyClients() {
  const endpoint = {
    id: "endpoint-1",
    hostname: "workstation-1",
    health: { overall: "good", services: { status: "good" } },
    tamperProtectionEnabled: true,
    lastSeenAt: now(),
    isolationStatus: "notIsolated",
    overallEncryptionStatus: "encrypted",
    assignedProducts: [{ code: "deviceEncryption", status: "installed" }],
  };
  const policies = [
    { id: "threat-1", name: "Threat baseline", type: "threat-protection", settings: { realTimeScanningEnabled: true, liveProtectionEnabled: true, deepLearningEnabled: true } },
    { id: "web-1", name: "Web baseline", type: "web-control", assignedGroupIds: ["group-1"], blockedCategories: ["malware", "phishing", "command-and-control"], downloadScanningEnabled: true, allowedWebsites: [] },
  ];
  return {
    THRESHOLDS,
    listEndpoints: async () => [endpoint],
    listPolicies: async () => policies,
    listEndpointGroups: async () => [{ id: "group-1", name: "Workstations" }],
    listDetectedExploits: async () => [],
    listAlerts: async () => [],
    listAdmins: async () => [{ id: "admin-1", profile: { email: "security@example.com" }, roleAssignments: [{ roleId: "super-1" }] }],
    listRoles: async () => [{ id: "super-1", name: "Super Admin", permissionSets: ["central_admin"] }],
    getMfaSettings: async () => ({ enabled: true }),
    listDetections: async () => [{ id: "det-1", severity: 2, status: "resolved", sensorGeneratedAt: now() }],
    listAuditLogs: async () => [{ id: "audit-1", createdAt: now(), action: "admin updated policy" }],
    getXdrTelemetry: async () => ({ runId: "run-1", items: [{ id: "xdr-1", endpoint_id: "endpoint-1", timestamp: now() }] }),
    listSiemEvents: async () => [{ id: "event-1", when: now() }],
    listSiemAlerts: async () => [{ id: "alert-1", when: now() }],
    getCredentialInfo: async () => ({ active: true, tenantId: "tenant-1" }),
    listFirewalls: async () => [{ id: "fw-1", hostname: "edge-1", firmwareVersion: "SFOS 21", firmwareLifecycle: { status: "supported" }, status: { connected: true, suspended: false }, haExpected: true, cluster: { status: "primary" } }],
    listFirewallGroups: async () => [{ id: "fwg-1", name: "Production", syncStatus: "success" }],
    listDnsLocations: async () => [{ id: "loc-1", name: "HQ", enabled: true, policyId: "dns-1" }],
    listDnsPolicies: async () => [{ id: "dns-1", name: "DNS baseline", locationIds: ["loc-1"], rejectedWebCategories: ["malware", "phishing", "command-and-control"], safeSearchEnabled: true, blockedCustomDomainIds: ["domains-1"] }],
    listDnsDomainLists: async () => [{ id: "domains-1", name: "Threat blocklist", domains: ["bad.example"] }],
  };
}

describe("Sophos checks", () => {
  test("all 39 checks produce safe, non-error results for a healthy normalized tenant fixture", async () => {
    const clients = healthyClients();
    const rows = [];
    for (const definition of tests) rows.push(...await definition.run(clients));
    expect(rows).toHaveLength(39);
    expect(rows.filter((row) => row.status === "error")).toEqual([]);
    expect(rows.filter((row) => row.status === "fail")).toEqual([]);
    expect(rows.every((row) => row.evidencePayload?.details)).toBe(true);
  });

  test("an unconfirmed/missing field returns error rather than a guessed pass", async () => {
    const clients = healthyClients();
    clients.listEndpoints = async () => [{ id: "endpoint-1", hostname: "workstation-1", health: {} }];
    const definition = tests.find((item) => item.key === "sophos.endpoint.protection_health");
    const rows = await definition.run(clients);
    expect(rows[0].status).toBe("error");
    expect(rows[0].message).toMatch(/cannot be evaluated safely/i);
  });

  test("a concrete unhealthy endpoint produces a finding row with threshold evidence", async () => {
    const clients = healthyClients();
    clients.listEndpoints = async () => [{
      id: "endpoint-2",
      hostname: "stale-host",
      health: { overall: "bad", services: { status: "bad" } },
      tamperProtectionEnabled: false,
      lastSeenAt: new Date(Date.now() - 40 * 86_400_000).toISOString(),
      isolationStatus: "isolated",
      assignedProducts: [],
    }];
    const definition = tests.find((item) => item.key === "sophos.endpoint.no_stale_devices");
    const rows = await definition.run(clients);
    expect(rows[0].status).toBe("fail");
    expect(rows[0].evidencePayload.details.thresholdDays).toBe(30);
  });
});
