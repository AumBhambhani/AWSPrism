import { afterEach, describe, expect, test, vi } from "vitest";
import { THRESHOLDS, describeSophosError, runTests, testConnection, tests } from "../connectors/sophos/index.js";

afterEach(() => vi.restoreAllMocks());

describe("Sophos connector", () => {
  test("exports 39 checks across all nine planned areas", () => {
    expect(tests).toHaveLength(39);
    expect([...new Set(tests.map((t) => t.key.split(".")[1]))].sort()).toEqual([
      "audit", "common", "detections", "dns", "endpoint", "firewall", "siem", "web", "xdr",
    ]);
    for (const definition of tests) {
      expect(definition.key).toMatch(/^sophos\./);
      expect(definition.failTitle).toBeTruthy();
      expect(definition.failTitle).not.toBe(definition.title);
      expect(["critical", "high", "medium", "low"]).toContain(definition.severityDefault);
      expect(definition.isoReferences.length).toBeGreaterThan(0);
      expect(typeof definition.run).toBe("function");
    }
  });

  test("uses the plan's thresholds", () => {
    expect(THRESHOLDS).toMatchObject({ STALE_DEVICE_DAYS: 30, HIGH_SEV_ALERT_TRIAGE_HOURS: 48, ADMIN_COUNT_THRESHOLD: 5, SIEM_FRESHNESS_HOURS: 26 });
  });

  test("describes authentication, entitlement, and rate-limit failures", () => {
    expect(describeSophosError(new Error("HTTP 401"))).toMatch(/API Credentials/i);
    expect(describeSophosError(new Error("HTTP 403"))).toMatch(/read-only role/i);
    expect(describeSophosError(new Error("HTTP 429"))).toMatch(/rate limit/i);
  });

  test("testConnection discovers a tenant and probes endpoint read access", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch")
      .mockResolvedValueOnce({ ok: true, json: async () => ({ access_token: "jwt", expires_in: 3600 }) })
      .mockResolvedValueOnce({ ok: true, json: async () => ({ id: "tenant-1", idType: "tenant", apiHosts: { dataRegion: "https://api-us01.central.sophos.com" } }) })
      .mockResolvedValueOnce({ ok: true, status: 200, json: async () => ({ items: [], pages: {} }) });
    await expect(testConnection({ authType: "oauth2", config: {}, secret: { clientId: "id", clientSecret: "secret" } })).resolves.toEqual({ ok: true, externalAccountId: "tenant-1" });
    expect(fetchMock.mock.calls[2][0]).toContain("/endpoint/v1/endpoints");
  });

  test("an unlicensed area is isolated as not applicable", async () => {
    vi.spyOn(globalThis, "fetch")
      .mockResolvedValueOnce({ ok: true, json: async () => ({ access_token: "jwt", expires_in: 3600 }) })
      .mockResolvedValueOnce({ ok: true, json: async () => ({ id: "tenant-1", idType: "tenant", apiHosts: { dataRegion: "https://api-us01.central.sophos.com" } }) })
      .mockResolvedValue({ ok: false, status: 403, text: async () => "not licensed", headers: { get: () => null } });
    const rows = await runTests({ authType: "oauth2", config: {}, secret: { clientId: "id", clientSecret: "secret" } });
    expect(rows).toHaveLength(39);
    expect(rows.filter((row) => row.testKey !== "sophos.siem.integration_credential_active").every((row) => row.status === "not_applicable")).toBe(true);
    expect(rows.find((row) => row.testKey === "sophos.siem.integration_credential_active")?.status).toBe("pass");
  });
});
