import { describe, test, expect, vi, beforeEach } from "vitest";

const { testConnection, runTests, tests, describeAcronisError, THRESHOLDS } = await import(
  "../connectors/acronis/index.js"
);

const BASE = {
  authType: "oauth2",
  config: { datacenterUrl: "https://us5-cloud.acronis.com" },
  secret: { clientId: "client-1", clientSecret: "shh" },
};

function json(body) {
  return { ok: true, status: 200, json: async () => body, headers: { get: () => null } };
}
function err(status, text) {
  return { ok: false, status, text: async () => text, headers: { get: () => null } };
}
const ISO_DAYS_AGO = (d) => new Date(Date.now() - d * 86400000).toISOString();

function healthyRoutes(url) {
  if (url.includes("/api/2/idp/token")) return json({ access_token: "tok", expires_on: Date.now() / 1000 + 7200 });
  if (url.includes("/api/2/clients/")) return json({ tenant_id: "TENANT-123" });
  if (url.includes("/resource_statuses"))
    return json({
      items: [
        {
          resourceId: "m1",
          resourceName: "web-01",
          protectionStatus: "Protected",
          protectionPlanName: "Daily",
          lastSuccessfulBackup: { dateTime: ISO_DAYS_AGO(1) },
          lastSuccessfulAntimalwareScan: { dateTime: ISO_DAYS_AGO(2) },
        },
      ],
    });
  if (url.includes("/alert_manager/v1/alerts")) return json({ items: [], paging: { cursors: {} } });
  throw new Error(`unexpected ${url}`);
}

function stub(routeFn) {
  vi.stubGlobal("fetch", vi.fn(async (u) => routeFn(String(u))));
}

beforeEach(() => vi.unstubAllGlobals());

describe("tests array", () => {
  test("exports exactly 7 checks across the expected areas", () => {
    expect(tests).toHaveLength(7);
    const areas = [...new Set(tests.map((t) => t.key.split(".")[1]))].sort();
    expect(areas).toEqual(["backup", "malware", "monitoring", "vulnerability"]);
  });

  test("every check has key, title, failTitle, severityDefault, isoReferences, run", () => {
    for (const t of tests) {
      expect(t.key.startsWith("acronis.")).toBe(true);
      expect(typeof t.title).toBe("string");
      expect(t.failTitle).not.toBe(t.title);
      expect(["critical", "high", "medium", "low"]).toContain(t.severityDefault);
      expect(Array.isArray(t.isoReferences) && t.isoReferences.length).toBeTruthy();
      expect(typeof t.run).toBe("function");
    }
  });

  test("THRESHOLDS carries the documented defaults", () => {
    expect(THRESHOLDS.BACKUP_MAX_AGE_DAYS).toBe(7);
    expect(THRESHOLDS.VULN_MAX_AGE_DAYS).toBe(30);
  });
});

describe("testConnection", () => {
  test("returns ok + the tenant id as externalAccountId", async () => {
    stub(healthyRoutes);
    expect(await testConnection(BASE)).toEqual({ ok: true, externalAccountId: "TENANT-123" });
  });

  test("falls back to the data-center host when the identity payload has no tenant id", async () => {
    stub((url) => {
      if (url.includes("/api/2/idp/token")) return json({ access_token: "tok", expires_on: Date.now() / 1000 + 7200 });
      if (url.includes("/api/2/clients/")) return json({});
      throw new Error(`unexpected ${url}`);
    });
    expect(await testConnection(BASE)).toEqual({ ok: true, externalAccountId: "us5-cloud.acronis.com" });
  });

  test("maps a 401 to authentication + data-center guidance", async () => {
    stub((url) => {
      if (url.includes("/api/2/idp/token")) return err(401, "invalid_client");
      throw new Error(`unexpected ${url}`);
    });
    await expect(testConnection(BASE)).rejects.toThrow(/data-center URL matches/);
  });

  test("maps a 403 on the identity probe to missing-role guidance", async () => {
    stub((url) => {
      if (url.includes("/api/2/idp/token")) return json({ access_token: "tok", expires_on: Date.now() / 1000 + 7200 });
      if (url.includes("/api/2/clients/")) return err(403, "access denied");
      throw new Error(`unexpected ${url}`);
    });
    await expect(testConnection(BASE)).rejects.toThrow(/read-only administrator/i);
  });
});

describe("runTests — healthy tenant", () => {
  test("produces a row for every check, and none error", async () => {
    stub(healthyRoutes);
    const results = await runTests(BASE);
    const seen = new Set(results.map((r) => r.testKey));
    for (const t of tests) expect(seen.has(t.key)).toBe(true);
    for (const r of results) {
      expect(r.status).not.toBe("error");
      expect(r.evidencePayload).toBeDefined();
    }
  });

  test("title/failTitle/severity propagate from the definition", async () => {
    stub(healthyRoutes);
    for (const r of await runTests(BASE)) {
      const def = tests.find((t) => t.key === r.testKey);
      expect(r.title).toBe(def.title);
      expect(r.failTitle).toBe(def.failTitle);
      expect(r.severity).toBe(def.severityDefault);
    }
  });
});

describe("runTests — findings", () => {
  test("flags an unprotected workload, a stale backup, and open alerts", async () => {
    stub((url) => {
      if (url.includes("/api/2/idp/token")) return json({ access_token: "tok", expires_on: Date.now() / 1000 + 7200 });
      if (url.includes("/api/2/clients/")) return json({ tenant_id: "T" });
      if (url.includes("/resource_statuses"))
        return json({
          items: [
            { resourceId: "m1", resourceName: "old-01", protectionStatus: "Unprotected", lastSuccessfulBackup: { dateTime: ISO_DAYS_AGO(30) } },
          ],
        });
      if (url.includes("/alert_manager/v1/alerts"))
        return json({
          items: [
            { id: "al1", category: "Malware", type: "ransomware_detected", severity: "critical", createdAt: ISO_DAYS_AGO(1), resourceName: "old-01" },
            { id: "al2", category: "System", type: "agent_offline", severity: "error", createdAt: ISO_DAYS_AGO(5), resourceName: "old-01" },
            { id: "al3", category: "Software management", type: "vulnerability_found", severity: "high", createdAt: ISO_DAYS_AGO(40), resourceName: "old-01" },
          ],
          paging: { cursors: {} },
        });
      throw new Error(`unexpected ${url}`);
    });

    const results = await runTests(BASE);
    const byKey = (k) => results.filter((r) => r.testKey === k);

    expect(byKey("acronis.backup.protection_enabled")[0].status).toBe("fail");
    expect(byKey("acronis.backup.recent_successful_backup")[0].status).toBe("fail");
    expect(byKey("acronis.malware.no_open_detections")[0].status).toBe("fail");
    expect(byKey("acronis.vulnerability.no_open_findings")[0].status).toBe("fail");
    expect(byKey("acronis.monitoring.no_open_critical_alerts")[0].status).toBe("fail");
    // The malware alert must not also be counted by the monitoring catch-all.
    expect(byKey("acronis.monitoring.no_open_critical_alerts").every((r) => r.resourceId !== "al1")).toBe(true);
  });
});

describe("runTests — role isolation", () => {
  test("a 403 on the alert manager marks only the alert-backed checks not_applicable", async () => {
    stub((url) => {
      if (url.includes("/alert_manager/")) return err(403, "access denied");
      return healthyRoutes(url);
    });
    const results = await runTests(BASE);
    const backup = results.find((r) => r.testKey === "acronis.backup.protection_enabled");
    const malwareAlert = results.find((r) => r.testKey === "acronis.malware.no_open_detections");
    expect(backup.status).toBe("pass");
    expect(malwareAlert.status).toBe("not_applicable");
  });

  test("a 500 on resource management records the backup checks as error", async () => {
    stub((url) => {
      if (url.includes("/resource_statuses")) return err(500, "boom");
      return healthyRoutes(url);
    });
    const results = await runTests(BASE);
    expect(results.find((r) => r.testKey === "acronis.backup.protection_enabled").status).toBe("error");
  });
});

describe("describeAcronisError", () => {
  test("429 → rate-limit guidance", () => {
    expect(describeAcronisError(new Error("failed: 429 slow down"))).toMatch(/rate limit/i);
  });
  test("generic → data-center/role hint", () => {
    expect(describeAcronisError(new Error("failed: 502"))).toMatch(/data-center URL/i);
  });
});
