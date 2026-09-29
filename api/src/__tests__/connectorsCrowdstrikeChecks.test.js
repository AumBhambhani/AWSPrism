import { describe, test, expect } from "vitest";

import { hostTests } from "../connectors/crowdstrike/tests/hosts.js";
import { sensorPolicyTests } from "../connectors/crowdstrike/tests/sensorPolicy.js";
import { detectionTests } from "../connectors/crowdstrike/tests/detections.js";
import { vulnerabilityTests } from "../connectors/crowdstrike/tests/vulnerabilities.js";
import { userTests } from "../connectors/crowdstrike/tests/users.js";
import { THRESHOLDS } from "../connectors/crowdstrike/index.js";

const run = (defs, key, clients) => defs.find((t) => t.key === key).run(clients);
const base = { THRESHOLDS };
const DAYS_AGO = (d) => new Date(Date.now() - d * 86400000).toISOString();
const HOURS_AGO = (h) => new Date(Date.now() - h * 3600000).toISOString();

describe("hosts.stale_endpoints_reviewed", () => {
  test("not_applicable when there are no hosts", async () => {
    const rows = await run(hostTests, "crowdstrike.host.stale_endpoints_reviewed", { ...base, listHosts: async () => [] });
    expect(rows[0].status).toBe("not_applicable");
  });

  test("pass when every host is fresh", async () => {
    const rows = await run(hostTests, "crowdstrike.host.stale_endpoints_reviewed", {
      ...base,
      listHosts: async () => [{ device_id: "a", hostname: "a", last_seen: DAYS_AGO(2) }],
    });
    expect(rows[0].status).toBe("pass");
  });

  test("one fail row per stale host, with age in the evidence", async () => {
    const rows = await run(hostTests, "crowdstrike.host.stale_endpoints_reviewed", {
      ...base,
      listHosts: async () => [
        { device_id: "a", hostname: "a", last_seen: DAYS_AGO(2) },
        { device_id: "b", hostname: "b", last_seen: DAYS_AGO(45) },
      ],
    });
    expect(rows).toHaveLength(1);
    expect(rows[0].status).toBe("fail");
    expect(rows[0].evidencePayload.details.daysSinceLastSeen).toBeGreaterThan(30);
  });
});

describe("sensorPolicy.policy_compliance", () => {
  const policies = [
    { id: "p1", name: "Windows - Production", enabled: true },
    { id: "def", name: "platform_default", enabled: true },
  ];

  test("fail when a host is on the platform_default policy", async () => {
    const rows = await run(sensorPolicyTests, "crowdstrike.sensor.policy_compliance", {
      ...base,
      listHosts: async () => [{ device_id: "h1", hostname: "h1", device_policies: { sensor_update: { policy_id: "def", applied: true } } }],
      listSensorUpdatePolicies: async () => policies,
    });
    expect(rows[0].status).toBe("fail");
    expect(rows[0].message).toMatch(/platform-default/);
  });

  test("fail when a host has no sensor update policy applied", async () => {
    const rows = await run(sensorPolicyTests, "crowdstrike.sensor.policy_compliance", {
      ...base,
      listHosts: async () => [{ device_id: "h1", hostname: "h1", device_policies: {} }],
      listSensorUpdatePolicies: async () => policies,
    });
    expect(rows[0].status).toBe("fail");
  });

  test("pass when every host has an explicit active policy", async () => {
    const rows = await run(sensorPolicyTests, "crowdstrike.sensor.policy_compliance", {
      ...base,
      listHosts: async () => [{ device_id: "h1", hostname: "h1", device_policies: { sensor_update: { policy_id: "p1", applied: true } } }],
      listSensorUpdatePolicies: async () => policies,
    });
    expect(rows[0].status).toBe("pass");
  });
});

describe("sensorPolicy.build_currency", () => {
  test("fail on a deprecated build tag", async () => {
    const rows = await run(sensorPolicyTests, "crowdstrike.sensor.build_currency", {
      ...base,
      listSensorUpdatePolicies: async () => [{ id: "p1", name: "Prod", enabled: true, platform_name: "Windows", settings: { build: "17000|Deprecated" } }],
      listSensorBuilds: async () => [{ build: "18110", platform: "windows", stage: "prod" }],
    });
    expect(rows[0].status).toBe("fail");
    expect(rows[0].message).toMatch(/deprecated/i);
  });

  test("fail when pinned build is more than N releases behind newest prod", async () => {
    const rows = await run(sensorPolicyTests, "crowdstrike.sensor.build_currency", {
      ...base,
      listSensorUpdatePolicies: async () => [{ id: "p1", name: "Prod", enabled: true, platform_name: "Windows", settings: { build: "18100" } }],
      listSensorBuilds: async () => [{ build: "18110", platform: "windows", stage: "prod" }],
    });
    expect(rows[0].status).toBe("fail");
  });

  test("not_applicable when the build catalogue is unreadable", async () => {
    const rows = await run(sensorPolicyTests, "crowdstrike.sensor.build_currency", {
      ...base,
      listSensorUpdatePolicies: async () => [{ id: "p1", name: "Prod", enabled: true, platform_name: "Windows", settings: { build: "18108" } }],
      listSensorBuilds: async () => {
        throw new Error("403 forbidden");
      },
    });
    expect(rows[0].status).toBe("not_applicable");
  });
});

describe("detections", () => {
  test("high_severity_backlog passes when open high-sev alerts are within SLA", async () => {
    const rows = await run(detectionTests, "crowdstrike.detection.high_severity_backlog", {
      ...base,
      getDetectionData: async () => ({ source: "alerts", records: [{ composite_id: "a", severity_name: "High", status: "new", created_timestamp: HOURS_AGO(10) }] }),
    });
    expect(rows[0].status).toBe("pass");
  });

  test("no_unresolved_incidents flags an aged in_progress detection regardless of severity", async () => {
    const rows = await run(detectionTests, "crowdstrike.detection.no_unresolved_incidents", {
      ...base,
      getDetectionData: async () => ({ source: "detects", records: [{ detection_id: "d", max_severity_displayname: "Low", status: "in_progress", created_timestamp: DAYS_AGO(20) }] }),
    });
    expect(rows[0].status).toBe("fail");
  });
});

describe("vulnerabilities.critical_exposure_review", () => {
  test("critical open CVE older than 30d fails; high older than 90d fails; fresh passes", async () => {
    const clients = {
      ...base,
      listVulnerabilities: async () => [
        { id: "1", cve: { id: "CVE-A", severity: "CRITICAL" }, status: "open", created_timestamp: DAYS_AGO(40), host_info: { hostname: "h1" } },
        { id: "2", cve: { id: "CVE-B", severity: "HIGH" }, status: "open", created_timestamp: DAYS_AGO(100), host_info: { hostname: "h2" } },
        { id: "3", cve: { id: "CVE-C", severity: "CRITICAL" }, status: "open", created_timestamp: DAYS_AGO(5), host_info: { hostname: "h3" } },
      ],
    };
    const rows = await run(vulnerabilityTests, "crowdstrike.vulnerability.critical_exposure_review", clients);
    expect(rows).toHaveLength(2);
    expect(rows.every((r) => r.status === "fail")).toBe(true);
  });

  test("not_applicable when Spotlight returns nothing", async () => {
    const rows = await run(vulnerabilityTests, "crowdstrike.vulnerability.critical_exposure_review", { ...base, listVulnerabilities: async () => [] });
    expect(rows[0].status).toBe("not_applicable");
  });
});

describe("users.admin_role_review", () => {
  test("pass when admin count is within the threshold", async () => {
    const rows = await run(userTests, "crowdstrike.user.admin_role_review", {
      ...base,
      listConsoleUsers: async () => [
        { uuid: "1", uid: "a@x.com", roles: ["falcon_administrator"] },
        { uuid: "2", uid: "b@x.com", roles: ["falcon_analyst"] },
      ],
    });
    expect(rows[0].status).toBe("pass");
    expect(rows[0].evidencePayload.details.administrators).toBe(1);
  });

  test("fail when admin count exceeds the threshold", async () => {
    const many = Array.from({ length: 8 }, (_, i) => ({ uuid: String(i), uid: `u${i}@x.com`, roles: ["Falcon Administrator"] }));
    const rows = await run(userTests, "crowdstrike.user.admin_role_review", { ...base, listConsoleUsers: async () => many });
    expect(rows[0].status).toBe("fail");
  });

  test("not_applicable when no console users are readable", async () => {
    const rows = await run(userTests, "crowdstrike.user.admin_role_review", { ...base, listConsoleUsers: async () => [] });
    expect(rows[0].status).toBe("not_applicable");
  });
});
