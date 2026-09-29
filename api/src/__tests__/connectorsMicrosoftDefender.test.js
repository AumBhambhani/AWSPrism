import { describe, test, expect, vi, beforeEach } from "vitest";

const { resolveDefenderCredentials, DEFENDER_BASE_URL } = await import("../connectors/microsoft_defender/credentials.js");
const { testConnection, runTests, tests } = await import("../connectors/microsoft_defender/index.js");

const BASE = {
  authType: "oauth2",
  config: { tenantId: "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee" },
  secret: { clientId: "client-1", clientSecret: "secret-1" },
};

function stubFetch(routeFn) {
  vi.stubGlobal("fetch", vi.fn(async (url, opts) => routeFn(String(url), opts)));
}

function json(body) {
  return { ok: true, json: async () => body };
}

function err(status, text) {
  return { ok: false, status, text: async () => text };
}

function tokenOk() {
  return json({ access_token: "defender-tok", expires_in: 3600 });
}

function happyFetch(defenderBody = { value: [] }) {
  stubFetch((url) => {
    if (url.includes("login.microsoftonline.com")) return tokenOk();
    if (url.includes("api.security.microsoft.com")) return json(defenderBody);
    return json({ value: [] });
  });
}

beforeEach(() => {
  vi.unstubAllGlobals();
  vi.resetModules();
});

// ──────────────────────────────────────────────────────────────────────────────
// credentials
// ──────────────────────────────────────────────────────────────────────────────
describe("resolveDefenderCredentials", () => {
  test("throws for unsupported auth type", () => {
    expect(() => resolveDefenderCredentials({ authType: "api_key", config: BASE.config, secret: BASE.secret }))
      .toThrow("Unsupported Microsoft Defender auth type: api_key");
  });

  test("returns getToken and tenantId", () => {
    const creds = resolveDefenderCredentials(BASE);
    expect(typeof creds.getToken).toBe("function");
    expect(creds.tenantId).toBe(BASE.config.tenantId);
  });

  test("uses the Defender resource audience (not Graph)", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => tokenOk()));
    const creds = resolveDefenderCredentials(BASE);
    await creds.getToken();
    const [, opts] = fetch.mock.calls[0];
    const body = new URLSearchParams(opts.body);
    expect(body.get("resource")).toBe("https://api.securitycenter.microsoft.com");
  });

  test("DEFENDER_BASE_URL is the unified endpoint (not the token audience)", () => {
    expect(DEFENDER_BASE_URL).toBe("https://api.security.microsoft.com");
    expect(DEFENDER_BASE_URL).not.toContain("securitycenter");
  });
});

// ──────────────────────────────────────────────────────────────────────────────
// tests array shape
// ──────────────────────────────────────────────────────────────────────────────
describe("microsoft_defender tests array", () => {
  test("exports exactly 7 test definitions", () => {
    expect(tests).toHaveLength(7);
  });

  test("covers devices, vulnerabilities, recommendations, and alerts namespaces", () => {
    const namespaces = new Set(tests.map((t) => t.key.split(".")[1]));
    expect([...namespaces].sort()).toEqual(["alerts", "devices", "recommendations", "vulnerabilities"]);
  });

  test("all tests have key, title, severityDefault, isoReferences, run", () => {
    for (const t of tests) {
      expect(typeof t.key).toBe("string");
      expect(typeof t.title).toBe("string");
      expect(typeof t.severityDefault).toBe("string");
      expect(Array.isArray(t.isoReferences)).toBe(true);
      expect(typeof t.run).toBe("function");
    }
  });
});

// ──────────────────────────────────────────────────────────────────────────────
// testConnection
// ──────────────────────────────────────────────────────────────────────────────
describe("testConnection (microsoft_defender)", () => {
  test("resolves ok=true on successful Defender probe", async () => {
    happyFetch();
    const result = await testConnection(BASE);
    expect(result).toEqual({ ok: true, externalAccountId: BASE.config.tenantId });
  });

  test("wraps a 403 with token-audience guidance", async () => {
    stubFetch((url) => {
      if (url.includes("login.microsoftonline.com")) return tokenOk();
      return err(403, "ACCESS_DENIED");
    });
    await expect(testConnection(BASE)).rejects.toThrow(/token audience mismatch/i);
  });

  test("wraps a 401 with credential guidance", async () => {
    stubFetch((url) => {
      if (url.includes("login.microsoftonline.com")) return tokenOk();
      return err(401, "TokenRejected");
    });
    await expect(testConnection(BASE)).rejects.toThrow(/token rejected/i);
  });

  test("wraps a 429 with rate-limit guidance", async () => {
    stubFetch((url) => {
      if (url.includes("login.microsoftonline.com")) return tokenOk();
      return err(429, "TooManyRequests");
    });
    await expect(testConnection(BASE)).rejects.toThrow(/rate limit/i);
  });

  test("probe hits api.security.microsoft.com (not securitycenter)", async () => {
    const urls = [];
    stubFetch((url) => {
      urls.push(url);
      if (url.includes("login.microsoftonline.com")) return tokenOk();
      return json({ value: [] });
    });
    await testConnection(BASE);
    const defenderCall = urls.find((u) => !u.includes("login.microsoftonline.com"));
    expect(defenderCall).toContain("api.security.microsoft.com");
    expect(defenderCall).not.toContain("securitycenter");
  });
});

// ──────────────────────────────────────────────────────────────────────────────
// runTests
// ──────────────────────────────────────────────────────────────────────────────
describe("runTests (microsoft_defender)", () => {
  test("returns 7 results on happy-path with empty Defender responses", async () => {
    happyFetch({ value: [] });
    const results = await runTests(BASE);
    expect(results).toHaveLength(7);
  });

  test("each result carries testKey, title, severity, resourceId, status, evidencePayload", async () => {
    happyFetch({ value: [] });
    const results = await runTests(BASE);
    for (const r of results) {
      expect(typeof r.testKey).toBe("string");
      expect(typeof r.title).toBe("string");
      expect(typeof r.severity).toBe("string");
      expect(typeof r.resourceId).toBe("string");
      expect(typeof r.status).toBe("string");
      expect(r.evidencePayload).toBeDefined();
    }
  });

  test("title and severity match the test definition", async () => {
    happyFetch({ value: [] });
    const results = await runTests(BASE);
    for (const r of results) {
      const def = tests.find((t) => t.key === r.testKey);
      expect(r.title).toBe(def.title);
      expect(r.severity).toBe(def.severityDefault);
    }
  });

  test("a per-test API failure records status=error and continues", async () => {
    let callCount = 0;
    stubFetch((url) => {
      if (url.includes("login.microsoftonline.com")) return tokenOk();
      callCount++;
      if (callCount === 1) return err(403, "ACCESS_DENIED");
      return json({ value: [] });
    });
    const results = await runTests(BASE);
    expect(results).toHaveLength(7);
    const errors = results.filter((r) => r.status === "error");
    expect(errors.length).toBeGreaterThanOrEqual(1);
    expect(errors[0].message).toMatch(/token audience mismatch/i);
  });

  // ── All devices onboarded → pass ──
  test("onboarding coverage passes when no CanBeOnboarded devices", async () => {
    happyFetch({ value: [{ id: "m1", onboardingStatus: "Onboarded", computerDnsName: "host1" }] });
    const results = await runTests(BASE);
    const onboard = results.find((r) => r.testKey === "microsoft_defender.devices.onboarding_coverage_complete");
    expect(onboard.status).toBe("pass");
  });

  // ── A device not onboarded → fail ──
  test("onboarding coverage fails when a device is CanBeOnboarded", async () => {
    stubFetch((url) => {
      if (url.includes("login.microsoftonline.com")) return tokenOk();
      if (url.includes("onboardingStatus") || url.includes("/api/machines")) {
        return json({ value: [{ id: "m1", onboardingStatus: "CanBeOnboarded", computerDnsName: "host1" }] });
      }
      return json({ value: [] });
    });
    const results = await runTests(BASE);
    const onboard = results.find((r) => r.testKey === "microsoft_defender.devices.onboarding_coverage_complete");
    expect(onboard.status).toBe("fail");
  });

  // ── No critical CVEs → pass ──
  test("critical CVE check passes when no vulns returned", async () => {
    happyFetch({ value: [] });
    const results = await runTests(BASE);
    const vulns = results.find((r) => r.testKey === "microsoft_defender.vulnerabilities.critical_cves_remediated");
    expect(vulns.status).toBe("pass");
  });

  // ── All recommendations addressed → pass ──
  test("high-impact recommendations check passes when no open high-impact recommendations", async () => {
    happyFetch({ value: [] });
    const results = await runTests(BASE);
    const rec = results.find((r) => r.testKey === "microsoft_defender.recommendations.high_impact_open_reviewed");
    expect(rec.status).toBe("pass");
  });

  // ── No critical unassigned alerts → pass ──
  test("unassigned critical alerts check passes when no unassigned critical alerts", async () => {
    happyFetch({ value: [] });
    const results = await runTests(BASE);
    const alerts = results.find((r) => r.testKey === "microsoft_defender.alerts.no_unassigned_critical_alerts");
    expect(alerts.status).toBe("pass");
  });
});
