import { describe, test, expect, vi, afterEach } from "vitest";
import { tests, THRESHOLDS, runTests, testConnection, key } from "../connectors/akamai/index.js";

afterEach(() => vi.unstubAllGlobals());

// Stub global fetch, routing by URL path, to drive runTests end-to-end.
function stubAkamai(routes) {
  vi.stubGlobal("fetch", vi.fn(async (url) => {
    const u = new URL(url);
    const path = u.pathname + (u.search || "");
    const key = Object.keys(routes).find((k) => path === k || path.startsWith(k));
    if (!key) return { ok: true, status: 200, json: async () => ({}), headers: new Headers() };
    const r = routes[key];
    if (r.status && r.status >= 400) return { ok: false, status: r.status, text: async () => r.body || "", headers: new Headers() };
    return { ok: true, status: 200, json: async () => r, headers: new Headers() };
  }));
}

const CONN = {
  authType: "api_key",
  config: { host: "akab-abc.luna.akamaiapis.net" },
  secret: { clientToken: "akab-ct", clientSecret: "cs=", accessToken: "akab-at" },
};

describe("akamai connector", () => {
  test("key and test count", () => {
    expect(key).toBe("akamai");
    expect(tests).toHaveLength(18);
    expect(new Set(tests.map((t) => t.key)).size).toBe(18);
  });

  test("THRESHOLDS carry the documented values", () => {
    expect(THRESHOLDS).toEqual({
      CERT_EXPIRY_MIN_DAYS: 30,
      HSTS_MIN_MAX_AGE_SECONDS: 15552000,
      PROPERTY_VERSION_LAG_MAX: 2,
      STUCK_CHANGE_MAX_DAYS: 14,
    });
  });

  test("every test object has the fields testDefinitionSync needs", () => {
    for (const t of tests) {
      expect(typeof t.key).toBe("string");
      expect(typeof t.title).toBe("string");
      expect(["critical", "high", "medium", "low"]).toContain(t.severityDefault);
      expect(Array.isArray(t.isoReferences)).toBe(true);
      expect(t.isoReferences.length).toBeGreaterThan(0);
      expect(Array.isArray(t.dpdpaControlAreas)).toBe(true);
      expect(typeof t.run).toBe("function");
    }
  });

  test("runTests downgrades an entire area to not_applicable on a 403", async () => {
    stubAkamai({
      "/appsec/v1/configs": { status: 403, body: "forbidden" },
      "/papi/v1/contracts": { contracts: { items: [] } },
      "/papi/v1/groups": { groups: { items: [] } },
      "/api-definitions/v2/endpoints": { apiEndPoints: [] },
    });
    const results = await runTests(CONN);
    const appsec = results.filter((r) => r.testKey.startsWith("akamai.appsec."));
    expect(appsec.length).toBeGreaterThan(0);
    expect(appsec.every((r) => r.status === "not_applicable")).toBe(true);
    // a different area still produced rows
    expect(results.some((r) => r.testKey.startsWith("akamai.api."))).toBe(true);
  });

  test("runTests isolates a non-scope failure to the one check that hit it", async () => {
    // appsec area: discovery + the first checks succeed; a later check's endpoint 500s.
    stubAkamai({
      "/appsec/v1/configs/111/versions/3/security-policies/pol_1/rate-policies": { status: 500, body: "boom" },
      "/appsec/v1/configs/111/versions/3/security-policies/pol_1/attack-groups": { attackGroups: [{ group: "SQL", action: "deny" }] },
      "/appsec/v1/configs/111/versions/3/security-policies": { policies: [{ policyId: "pol_1", policyName: "Main" }] },
      "/appsec/v1/configs/111/activations": { activationHistory: [{ network: "PRODUCTION", status: "ACTIVATED", version: 3 }] },
      "/appsec/v1/configs/111/versions": { versionList: [{ version: 3 }] },
      "/appsec/v1/configs": { configurations: [{ id: 111, name: "prod-config" }] },
      "/papi/v1/contracts": { contracts: { items: [] } },
      "/papi/v1/groups": { groups: { items: [] } },
      "/api-definitions/v2/endpoints": { apiEndPoints: [] },
    });
    const results = await runTests(CONN);

    // the check that succeeded has exactly its real row — no duplicate error row
    const waf = results.filter((r) => r.testKey === "akamai.appsec.waf_policies_in_block_mode");
    expect(waf).toHaveLength(1);
    expect(waf[0].status).toBe("pass");

    const attack = results.filter((r) => r.testKey === "akamai.appsec.attack_groups_enabled");
    expect(attack).toHaveLength(1);
    expect(attack[0].status).not.toBe("error");

    // only the check whose endpoint 500'd is errored, and exactly once
    const rate = results.filter((r) => r.testKey === "akamai.appsec.rate_limiting_configured");
    expect(rate).toHaveLength(1);
    expect(rate[0].status).toBe("error");
  });

  test("testConnection returns ok + externalAccountId from the first contract", async () => {
    stubAkamai({ "/papi/v1/contracts": { contracts: { items: [{ contractId: "ctr_1-ABC" }] } } });
    const res = await testConnection(CONN);
    expect(res).toEqual({ ok: true, externalAccountId: "ctr_1-ABC" });
  });

  test("testConnection surfaces a 401 as a signing/clock hint", async () => {
    stubAkamai({
      "/papi/v1/contracts": { status: 401, body: "unauthorized" },
      "/appsec/v1/configs": { status: 401, body: "unauthorized" },
      "/cps/v2/enrollments": { status: 401, body: "unauthorized" },
    });
    await expect(testConnection(CONN)).rejects.toThrow(/signing|clock|host/i);
  });
});
