import { describe, test, expect } from "vitest";

import { backupTests } from "../connectors/acronis/tests/backup.js";
import { malwareTests } from "../connectors/acronis/tests/malware.js";
import { vulnerabilityTests } from "../connectors/acronis/tests/vulnerability.js";
import { monitoringTests } from "../connectors/acronis/tests/monitoring.js";
import { THRESHOLDS } from "../connectors/acronis/index.js";

const run = (defs, key, clients) => defs.find((t) => t.key === key).run(clients);
const base = { THRESHOLDS };
const DAYS_AGO = (d) => new Date(Date.now() - d * 86400000).toISOString();

describe("backup.protection_enabled", () => {
  test("not_applicable when there are no machines", async () => {
    const rows = await run(backupTests, "acronis.backup.protection_enabled", { ...base, listResourceStatuses: async () => [] });
    expect(rows[0].status).toBe("not_applicable");
  });

  test("pass when every machine is Protected", async () => {
    const rows = await run(backupTests, "acronis.backup.protection_enabled", {
      ...base,
      listResourceStatuses: async () => [{ resourceId: "m1", protectionStatus: "Protected" }],
    });
    expect(rows[0].status).toBe("pass");
  });

  test("one fail row per unprotected machine", async () => {
    const rows = await run(backupTests, "acronis.backup.protection_enabled", {
      ...base,
      listResourceStatuses: async () => [
        { resourceId: "m1", protectionStatus: "Protected" },
        { resourceId: "m2", resourceName: "db-01", protectionStatus: "Error" },
      ],
    });
    expect(rows).toHaveLength(1);
    expect(rows[0].status).toBe("fail");
    expect(rows[0].resourceId).toBe("m2");
  });
});

describe("backup.recent_successful_backup", () => {
  test("fail when the last backup is older than the window", async () => {
    const rows = await run(backupTests, "acronis.backup.recent_successful_backup", {
      ...base,
      listResourceStatuses: async () => [
        { resourceId: "m1", lastSuccessfulBackup: { dateTime: DAYS_AGO(1) } },
        { resourceId: "m2", lastSuccessfulBackup: { dateTime: DAYS_AGO(30) } },
      ],
    });
    expect(rows).toHaveLength(1);
    expect(rows[0].resourceId).toBe("m2");
    expect(rows[0].evidencePayload.details.daysSinceLastBackup).toBeGreaterThan(7);
  });

  test("fail when a machine has never backed up", async () => {
    const rows = await run(backupTests, "acronis.backup.recent_successful_backup", {
      ...base,
      listResourceStatuses: async () => [{ resourceId: "m1" }],
    });
    expect(rows[0].status).toBe("fail");
    expect(rows[0].message).toMatch(/no recorded successful backup/);
  });

  test("pass when all backups are recent", async () => {
    const rows = await run(backupTests, "acronis.backup.recent_successful_backup", {
      ...base,
      listResourceStatuses: async () => [{ resourceId: "m1", lastSuccessfulBackup: { dateTime: DAYS_AGO(2) } }],
    });
    expect(rows[0].status).toBe("pass");
  });
});

describe("malware.scan_up_to_date", () => {
  test("fail on a stale scan", async () => {
    const rows = await run(malwareTests, "acronis.malware.scan_up_to_date", {
      ...base,
      listResourceStatuses: async () => [{ resourceId: "m1", lastSuccessfulAntimalwareScan: { dateTime: DAYS_AGO(20) } }],
    });
    expect(rows[0].status).toBe("fail");
  });

  test("pass on a fresh scan", async () => {
    const rows = await run(malwareTests, "acronis.malware.scan_up_to_date", {
      ...base,
      listResourceStatuses: async () => [{ resourceId: "m1", lastSuccessfulAntimalwareScan: { dateTime: DAYS_AGO(1) } }],
    });
    expect(rows[0].status).toBe("pass");
  });
});

describe("malware.no_open_detections", () => {
  test("pass when there are no malware alerts", async () => {
    const rows = await run(malwareTests, "acronis.malware.no_open_detections", {
      ...base,
      getAlerts: async () => [{ id: "a1", category: "System", type: "agent_offline", severity: "error" }],
    });
    expect(rows[0].status).toBe("pass");
  });

  test("one fail per open malware/ransomware alert; resolved ones are ignored", async () => {
    const rows = await run(malwareTests, "acronis.malware.no_open_detections", {
      ...base,
      getAlerts: async () => [
        { id: "a1", category: "Malware", type: "ransomware_detected", severity: "critical", createdAt: DAYS_AGO(1) },
        { id: "a2", category: "Anti-malware", type: "threat_found", state: "resolved" },
      ],
    });
    expect(rows).toHaveLength(1);
    expect(rows[0].resourceId).toBe("a1");
  });
});

describe("vulnerability.no_open_findings", () => {
  test("fail per open vulnerability finding older than the SLA", async () => {
    const rows = await run(vulnerabilityTests, "acronis.vulnerability.no_open_findings", {
      ...base,
      getAlerts: async () => [
        { id: "v1", category: "Software management", type: "vulnerability_found", createdAt: DAYS_AGO(45) },
        { id: "v2", category: "Software management", type: "vulnerability_found", createdAt: DAYS_AGO(5) },
      ],
    });
    expect(rows.map((r) => r.resourceId)).toEqual(["v1"]);
  });

  test("pass when the alert stream carries no vulnerability findings", async () => {
    const rows = await run(vulnerabilityTests, "acronis.vulnerability.no_open_findings", {
      ...base,
      getAlerts: async () => [{ id: "x", category: "Backup", type: "backup_failed" }],
    });
    expect(rows[0].status).toBe("pass");
  });
});

describe("vulnerability.patches_applied", () => {
  test("fail per open missing-patch alert past the window", async () => {
    const rows = await run(vulnerabilityTests, "acronis.vulnerability.patches_applied", {
      ...base,
      getAlerts: async () => [{ id: "p1", category: "Patch management", type: "patch_missing", createdAt: DAYS_AGO(60) }],
    });
    expect(rows[0].status).toBe("fail");
    expect(rows[0].resourceId).toBe("p1");
  });
});

describe("monitoring.no_open_critical_alerts", () => {
  test("pass when the only critical alerts are malware/vuln (counted elsewhere)", async () => {
    const rows = await run(monitoringTests, "acronis.monitoring.no_open_critical_alerts", {
      ...base,
      getAlerts: async () => [
        { id: "a1", category: "Malware", type: "ransomware_detected", severity: "critical" },
        { id: "a2", category: "Software management", type: "vulnerability_found", severity: "high" },
      ],
    });
    expect(rows[0].status).toBe("pass");
  });

  test("fail per open non-malware critical/error alert", async () => {
    const rows = await run(monitoringTests, "acronis.monitoring.no_open_critical_alerts", {
      ...base,
      getAlerts: async () => [
        { id: "a1", category: "System", type: "agent_offline", severity: "error", createdAt: DAYS_AGO(3) },
        { id: "a2", category: "Backup", type: "backup_failed", severity: "warning" },
      ],
    });
    expect(rows).toHaveLength(1);
    expect(rows[0].resourceId).toBe("a1");
  });
});
