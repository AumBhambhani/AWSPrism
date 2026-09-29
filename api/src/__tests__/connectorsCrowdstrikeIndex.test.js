import { describe, test, expect, vi, beforeEach } from "vitest";

const { testConnection, runTests, tests, describeCrowdstrikeError, THRESHOLDS } = await import(
  "../connectors/crowdstrike/index.js"
);

const BASE = {
  authType: "oauth2",
  config: { cloudRegion: "us-1", baseUrl: "https://api.crowdstrike.com" },
  secret: { clientId: "client-1", clientSecret: "shh" },
};

function json(body) {
  return { ok: true, json: async () => body, headers: { get: () => null } };
}
function err(status, text) {
  return { ok: false, status, text: async () => text, headers: { get: () => null } };
}

const ISO_DAYS_AGO = (d) => new Date(Date.now() - d * 86400000).toISOString();
const ISO_HOURS_AGO = (h) => new Date(Date.now() - h * 3600000).toISOString();

// A fully-healthy Falcon tenant: every collection readable, nothing failing.
function healthyRoutes(url, opts) {
  if (url.includes("/oauth2/token")) return json({ access_token: "tok", expires_in: 1800 });

  if (url.includes("/devices/queries/devices/v1")) return json({ resources: ["h1"], meta: { pagination: { total: 1 } } });
  if (url.includes("/devices/entities/devices/v2"))
    return json({
      resources: [
        {
          device_id: "h1",
          cid: "CID123",
          hostname: "web-01",
          platform_name: "Windows",
          agent_version: "7.10.0",
          last_seen: ISO_DAYS_AGO(1),
          reduced_functionality_mode: "no",
          device_policies: { sensor_update: { policy_id: "p1", applied: true } },
        },
      ],
    });

  if (url.includes("/policy/queries/sensor-update/v1")) return json({ resources: ["p1"], meta: { pagination: { total: 1 } } });
  if (url.includes("/policy/entities/sensor-update/v2"))
    return json({ resources: [{ id: "p1", name: "Windows - Production", enabled: true, platform_name: "Windows", settings: { build: "18110|n|tagged" } }] });
  if (url.includes("/policy/combined/sensor-update-builds/v1"))
    return json({ resources: [{ build: "18110", platform: "windows", stage: "prod" }] });

  if (url.includes("/alerts/queries/alerts/v2")) return json({ resources: ["a1"], meta: { pagination: { total: 1 } } });
  if (url.includes("/alerts/entities/alerts/v2"))
    return json({ resources: [{ composite_id: "a1", severity_name: "High", status: "closed", created_timestamp: ISO_HOURS_AGO(200), device: { hostname: "web-01" } }] });

  if (url.includes("/spotlight/queries/vulnerabilities/v2")) return json({ resources: ["v1"], meta: { pagination: { total: 1 } } });
  if (url.includes("/spotlight/entities/vulnerabilities/v2"))
    return json({ resources: [{ id: "v1", cve: { id: "CVE-2024-1", severity: "HIGH" }, status: "closed", created_timestamp: ISO_DAYS_AGO(200), host_info: { hostname: "web-01" } }] });

  if (url.includes("/user-management/combined/users/v1"))
    return json({ resources: [{ uuid: "u1", uid: "admin@acme.com", roles: ["falcon_administrator"] }] });

  throw new Error(`unexpected ${opts.method || "GET"} ${url}`);
}

function stub(routeFn) {
  vi.stubGlobal("fetch", vi.fn(async (u, o) => routeFn(String(u), o || {})));
}

beforeEach(() => vi.unstubAllGlobals());

describe("tests array", () => {
  test("exports exactly 8 checks across the expected areas", () => {
    expect(tests).toHaveLength(8);
    const areas = [...new Set(tests.map((t) => t.key.split(".")[1]))].sort();
    expect(areas).toEqual(["detection", "host", "sensor", "user", "vulnerability"]);
  });

  test("every check has key, title, failTitle, severityDefault, isoReferences, run", () => {
    for (const t of tests) {
      expect(t.key.startsWith("crowdstrike.")).toBe(true);
      expect(typeof t.title).toBe("string");
      expect(typeof t.failTitle).toBe("string");
      expect(t.failTitle).not.toBe(t.title);
      expect(["critical", "high", "medium", "low"]).toContain(t.severityDefault);
      expect(Array.isArray(t.isoReferences) && t.isoReferences.length).toBeTruthy();
      expect(typeof t.run).toBe("function");
    }
  });

  test("THRESHOLDS carries the documented defaults", () => {
    expect(THRESHOLDS.STALE_HOST_DAYS).toBe(30);
    expect(THRESHOLDS.CRITICAL_CVE_AGE_DAYS).toBe(30);
    expect(THRESHOLDS.HIGH_CVE_AGE_DAYS).toBe(90);
  });
});

describe("testConnection", () => {
  test("returns ok + the tenant CID as externalAccountId", async () => {
    stub(healthyRoutes);
    expect(await testConnection(BASE)).toEqual({ ok: true, externalAccountId: "CID123" });
  });

  test("falls back to the regional host when no device is present", async () => {
    stub((url) => {
      if (url.includes("/oauth2/token")) return json({ access_token: "tok", expires_in: 1800 });
      if (url.includes("/devices/queries/devices/v1")) return json({ resources: [], meta: { pagination: { total: 0 } } });
      throw new Error(`unexpected ${url}`);
    });
    expect(await testConnection(BASE)).toEqual({ ok: true, externalAccountId: "api.crowdstrike.com" });
  });

  test("maps a 401 to authentication + region guidance", async () => {
    stub((url) => {
      if (url.includes("/oauth2/token")) return err(401, "invalid_client");
      throw new Error(`unexpected ${url}`);
    });
    await expect(testConnection(BASE)).rejects.toThrow(/region is correct/);
  });

  test("maps a 403 on the Hosts probe to missing-scope guidance", async () => {
    stub((url) => {
      if (url.includes("/oauth2/token")) return json({ access_token: "tok", expires_in: 1800 });
      if (url.includes("/devices/queries/devices/v1")) return err(403, "access denied");
      throw new Error(`unexpected ${url}`);
    });
    await expect(testConnection(BASE)).rejects.toThrow(/hosts:read/);
  });
});

describe("runTests — healthy tenant", () => {
  test("produces at least one row for every check, and none error", async () => {
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
  test("flags a stale host, an RFM host, an SLA-breached alert and an aged CVE", async () => {
    stub((url) => {
      if (url.includes("/oauth2/token")) return json({ access_token: "tok", expires_in: 1800 });
      if (url.includes("/devices/queries/devices/v1")) return json({ resources: ["h1", "h2"], meta: { pagination: { total: 2 } } });
      if (url.includes("/devices/entities/devices/v2"))
        return json({
          resources: [
            { device_id: "h1", hostname: "old-01", last_seen: ISO_DAYS_AGO(90), reduced_functionality_mode: "no", device_policies: { sensor_update: { policy_id: "p1", applied: true } } },
            { device_id: "h2", hostname: "rfm-01", last_seen: ISO_DAYS_AGO(1), reduced_functionality_mode: "yes", device_policies: { sensor_update: { policy_id: "p1", applied: true } } },
          ],
        });
      if (url.includes("/policy/queries/sensor-update/v1")) return json({ resources: ["p1"], meta: { pagination: { total: 1 } } });
      if (url.includes("/policy/entities/sensor-update/v2"))
        return json({ resources: [{ id: "p1", name: "Prod", enabled: true, platform_name: "Windows", settings: { build: "18110" } }] });
      if (url.includes("/policy/combined/sensor-update-builds/v1")) return json({ resources: [{ build: "18110", platform: "windows", stage: "prod" }] });
      if (url.includes("/alerts/queries/alerts/v2")) return json({ resources: ["a1"], meta: { pagination: { total: 1 } } });
      if (url.includes("/alerts/entities/alerts/v2"))
        return json({ resources: [{ composite_id: "a1", severity_name: "Critical", status: "new", created_timestamp: ISO_HOURS_AGO(240), device: { hostname: "web-01" } }] });
      if (url.includes("/spotlight/queries/vulnerabilities/v2")) return json({ resources: ["v1"], meta: { pagination: { total: 1 } } });
      if (url.includes("/spotlight/entities/vulnerabilities/v2"))
        return json({ resources: [{ id: "v1", cve: { id: "CVE-2024-9", severity: "CRITICAL" }, status: "open", created_timestamp: ISO_DAYS_AGO(60), host_info: { hostname: "web-01" } }] });
      if (url.includes("/user-management/combined/users/v1")) return json({ resources: [{ uuid: "u1", uid: "a@acme.com", roles: ["falcon_administrator"] }] });
      throw new Error(`unexpected ${url}`);
    });

    const results = await runTests(BASE);
    const byKey = (k) => results.filter((r) => r.testKey === k);

    expect(byKey("crowdstrike.host.stale_endpoints_reviewed").some((r) => r.status === "fail")).toBe(true);
    expect(byKey("crowdstrike.host.unmanaged_reduced_functionality").some((r) => r.status === "fail")).toBe(true);
    expect(byKey("crowdstrike.detection.high_severity_backlog")[0].status).toBe("fail");
    expect(byKey("crowdstrike.detection.no_unresolved_incidents")[0].status).toBe("fail");
    expect(byKey("crowdstrike.vulnerability.critical_exposure_review")[0].status).toBe("fail");
  });
});

describe("runTests — scope isolation", () => {
  test("a 403 on Spotlight marks only the vulnerability check not_applicable", async () => {
    stub((url, opts) => {
      if (url.includes("/spotlight/")) return err(403, "access denied");
      return healthyRoutes(url, opts);
    });
    const results = await runTests(BASE);
    const vuln = results.filter((r) => r.testKey === "crowdstrike.vulnerability.critical_exposure_review");
    expect(vuln).toHaveLength(1);
    expect(vuln[0].status).toBe("not_applicable");
    expect(results.find((r) => r.testKey === "crowdstrike.host.stale_endpoints_reviewed").status).toBe("pass");
  });

  test("detections fall back from Alerts to Detects when alerts:read is missing", async () => {
    stub((url, opts) => {
      if (url.includes("/alerts/")) return err(403, "insufficient scope");
      if (url.includes("/detects/queries/detects/v1")) return json({ resources: ["d1"], meta: { pagination: { total: 1 } } });
      if (url.includes("/detects/entities/summaries/GET/v1"))
        return json({ resources: [{ detection_id: "d1", max_severity_displayname: "High", status: "closed", created_timestamp: ISO_HOURS_AGO(200) }] });
      return healthyRoutes(url, opts);
    });
    const results = await runTests(BASE);
    const backlog = results.find((r) => r.testKey === "crowdstrike.detection.high_severity_backlog");
    expect(backlog.status).toBe("pass");
    expect(backlog.evidencePayload.details.source).toBe("detects");
  });

  test("a 500 on Hosts records the host checks as error", async () => {
    stub((url, opts) => {
      if (url.includes("/devices/queries/devices/v1")) return err(500, "boom");
      return healthyRoutes(url, opts);
    });
    const results = await runTests(BASE);
    expect(results.find((r) => r.testKey === "crowdstrike.host.stale_endpoints_reviewed").status).toBe("error");
  });
});

describe("describeCrowdstrikeError", () => {
  test("429 → rate-limit guidance", () => {
    expect(describeCrowdstrikeError(new Error("failed: 429 slow down"))).toMatch(/rate limit/i);
  });
  test("generic → region/scope hint", () => {
    expect(describeCrowdstrikeError(new Error("failed: 502"))).toMatch(/cloud region/i);
  });
});
