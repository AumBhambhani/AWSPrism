import { describe, test, expect, vi, beforeEach } from "vitest";

const { testConnection, runTests, tests, describeCommvaultError } = await import(
  "../connectors/commvault/index.js"
);

const BASE = {
  authType: "api_key",
  config: { webconsoleUrl: "https://commvault.example.com" },
  secret: { accessToken: "tok-abc123" },
};

function json(body) {
  return { ok: true, status: 200, json: async () => body, headers: { get: () => null } };
}
function err(status, text) {
  return { ok: false, status, text: async () => text, headers: { get: () => null } };
}

// Maps a full request URL to a canned response, keyed by the path after
// /webconsole/api (query string included).
function routeByPath(handlers) {
  return (url) => {
    const u = new URL(url);
    const path = u.pathname.replace(/^\/webconsole\/api/, "") + u.search;
    const handler = handlers[path] ?? handlers[u.pathname.replace(/^\/webconsole\/api/, "")];
    if (handler === undefined) throw new Error(`unexpected request: ${path}`);
    return handler;
  };
}

function stub(routeFn) {
  vi.stubGlobal("fetch", vi.fn(async (u) => routeFn(String(u))));
}

const HEALTHY = routeByPath({
  "/Alerts": json({ alertList: [{ alert: { name: "Backup Job Failed" }, alertCategory: { name: "Job Management" }, description: "job failure" }] }),
  "/dashboard?slaNumberOfDays=1": json({ solutionSummary: { slaSummary: { totalEntities: 10, slaNotMetEntities: 0, neverBackedupEntities: 0 } } }),
  "/StoragePolicy": json({ policies: [{ storagePolicyName: "Primary", storagePolicyId: 1 }] }),
  "/v2/StoragePolicy/1?propertyLevel=10": json({ storagePolicyCopy: [{ copyName: "Primary Copy", copyFlags: { wormCopy: 1, encryptData: 1 } }] }),
});

beforeEach(() => vi.unstubAllGlobals());

describe("tests array", () => {
  test("exports exactly 4 checks across backup / storage / monitoring", () => {
    expect(tests).toHaveLength(4);
    const areas = [...new Set(tests.map((t) => t.key.split(".")[1]))].sort();
    expect(areas).toEqual(["backup", "monitoring", "storage"]);
  });

  test("every check has key, title, failTitle, severityDefault, isoReferences, run", () => {
    for (const t of tests) {
      expect(t.key.startsWith("commvault.")).toBe(true);
      expect(typeof t.title).toBe("string");
      expect(t.failTitle).not.toBe(t.title);
      expect(["critical", "high", "medium", "low"]).toContain(t.severityDefault);
      expect(Array.isArray(t.isoReferences) && t.isoReferences.length).toBeTruthy();
      expect(typeof t.run).toBe("function");
    }
  });
});

describe("testConnection", () => {
  test("probes GET /Alerts and returns the webconsole host as externalAccountId", async () => {
    stub(HEALTHY);
    expect(await testConnection(BASE)).toEqual({ ok: true, externalAccountId: "commvault.example.com" });
  });

  test("maps a 401 to token / WebConsole-URL guidance", async () => {
    stub(routeByPath({ "/Alerts": err(401, "invalid token") }));
    await expect(testConnection(BASE)).rejects.toThrow(/Regenerate a Custom-scope access token/);
  });

  test("maps a 403 to the apiEndpoints allowlist guidance", async () => {
    stub(routeByPath({ "/Alerts": err(403, "forbidden") }));
    await expect(testConnection(BASE)).rejects.toThrow(/apiEndpoints/);
  });
});

describe("runTests — healthy CommCell", () => {
  test("produces a row for every check, none error, title/failTitle/severity propagate", async () => {
    stub(HEALTHY);
    const results = await runTests(BASE);
    const seen = new Set(results.map((r) => r.testKey));
    for (const t of tests) expect(seen.has(t.key)).toBe(true);
    for (const r of results) {
      expect(r.status).not.toBe("error");
      const def = tests.find((t) => t.key === r.testKey);
      expect(r.title).toBe(def.title);
      expect(r.failTitle).toBe(def.failTitle);
      expect(r.severity).toBe(def.severityDefault);
    }
  });
});

describe("runTests — findings", () => {
  test("flags a missed SLA, a copy without WORM lock, and no failure alert", async () => {
    stub(
      routeByPath({
        "/Alerts": json({ alertList: [{ alert: { name: "Disk Low" }, alertCategory: { name: "Media Management" }, description: "disk" }] }),
        "/dashboard?slaNumberOfDays=1": json({ solutionSummary: { slaSummary: { totalEntities: 10, slaNotMetEntities: 2, neverBackedupEntities: 1 } } }),
        "/StoragePolicy": json({ policies: [{ storagePolicyName: "Primary", storagePolicyId: 1 }] }),
        "/v2/StoragePolicy/1?propertyLevel=10": json({ storagePolicyCopy: [{ copyName: "Primary Copy", copyFlags: { wormCopy: 0, encryptData: 0 } }] }),
      })
    );
    const results = await runTests(BASE);
    const byKey = (k) => results.filter((r) => r.testKey === k);
    expect(byKey("commvault.backup.sla_compliance")[0].status).toBe("fail");
    expect(byKey("commvault.storage.worm_lock_enabled")[0].status).toBe("fail");
    expect(byKey("commvault.storage.encryption_enabled")[0].status).toBe("fail");
    expect(byKey("commvault.monitoring.alerts_configured")[0].status).toBe("fail");
  });
});

describe("runTests — token scope isolation", () => {
  test("a 403 on /StoragePolicy marks only the storage checks not_applicable", async () => {
    stub((url) => {
      if (url.includes("/StoragePolicy")) return err(403, "forbidden");
      return HEALTHY(url);
    });
    const results = await runTests(BASE);
    expect(results.find((r) => r.testKey === "commvault.backup.sla_compliance").status).toBe("pass");
    expect(results.find((r) => r.testKey === "commvault.storage.worm_lock_enabled").status).toBe("not_applicable");
    expect(results.find((r) => r.testKey === "commvault.storage.encryption_enabled").status).toBe("not_applicable");
    expect(results.find((r) => r.testKey === "commvault.monitoring.alerts_configured").status).toBe("pass");
  });

  test("a 500 on the SLA dashboard records the backup check as error", async () => {
    stub((url) => {
      if (url.includes("/dashboard")) return err(500, "boom");
      return HEALTHY(url);
    });
    const results = await runTests(BASE);
    expect(results.find((r) => r.testKey === "commvault.backup.sla_compliance").status).toBe("error");
  });
});

describe("describeCommvaultError", () => {
  test("429 → rate-limit guidance", () => {
    expect(describeCommvaultError(new Error("failed: 429 slow down"))).toMatch(/rate limit/i);
  });
  test("generic → WebConsole/token hint", () => {
    expect(describeCommvaultError(new Error("failed: 502"))).toMatch(/WebConsole base URL/i);
  });
});
