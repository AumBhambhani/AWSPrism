import { describe, expect, test } from "vitest";
import { THRESHOLDS, tests } from "../connectors/check_point/index.js";

const now = () => new Date().toISOString();
const daysAgo = (d) => new Date(Date.now() - d * 86_400_000).toISOString();

function healthyClients() {
  return {
    THRESHOLDS,
    queryEvents: async () => ({ records: [{ severity: "low", time: now() }, { severity: "medium", time: now() }], total: 42 }),
    listXdrIncidents: async () => [{ id: "i1", name: "Noise", severity: "low", status: "closed", creationTime: now(), lastUpdateTime: now() }],
    listEndpointComputers: async () => [{ id: "d1", name: "host-1", lastConnection: now(), antiMalware: { signatureUpdateTime: now() } }],
    listEndpointPolicies: async () => [{ name: "Default", capabilities: { antiMalware: true, antiRansomware: true, threatEmulation: true } }],
    listEndpointIncidents: async () => [],
  };
}

describe("Check Point Infinity checks", () => {
  test("all 10 checks are safe (no error/fail) for a healthy tenant fixture", async () => {
    const clients = healthyClients();
    const rows = [];
    for (const definition of tests) rows.push(...(await definition.run(clients)));
    expect(rows).toHaveLength(10);
    expect(rows.filter((r) => r.status === "error")).toEqual([]);
    expect(rows.filter((r) => r.status === "fail")).toEqual([]);
    expect(rows.every((r) => r.evidencePayload?.details)).toBe(true);
  });

  test("an empty Infinity Events feed is a finding", async () => {
    const clients = healthyClients();
    clients.queryEvents = async () => ({ records: [], total: 0 });
    const rows = await tests.find((t) => t.key === "check_point.events.feed_active").run(clients);
    expect(rows[0].status).toBe("fail");
  });

  test("an old open high-severity XDR incident is a finding", async () => {
    const clients = healthyClients();
    clients.listXdrIncidents = async () => [{ id: "i2", name: "Ransomware", severity: "critical", status: "new", creationTime: daysAgo(5) }];
    const rows = await tests.find((t) => t.key === "check_point.xdr.high_incidents_triaged").run(clients);
    expect(rows[0].status).toBe("fail");
  });

  test("a missing Infinity Events records array is reported as error", async () => {
    const clients = healthyClients();
    clients.queryEvents = async () => ({ records: null });
    const rows = await tests.find((t) => t.key === "check_point.events.query_retrievable").run(clients);
    expect(rows[0].status).toBe("error");
  });

  test("a policy that disables a required blade is a finding", async () => {
    const clients = healthyClients();
    clients.listEndpointPolicies = async () => [{ name: "Weak", capabilities: { antiMalware: true, antiRansomware: false, threatEmulation: true } }];
    const rows = await tests.find((t) => t.key === "check_point.endpoint.protection_blades_active").run(clients);
    expect(rows[0].status).toBe("fail");
  });
});
