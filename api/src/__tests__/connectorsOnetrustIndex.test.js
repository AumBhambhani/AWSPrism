import { describe, test, expect, vi, beforeEach } from "vitest";

const { testConnection, runTests, tests, describeOneTrustError } = await import("../connectors/onetrust/index.js");

const BASE = {
  authType: "oauth2",
  config: { hostname: "acme.my.onetrust.com" },
  secret: { clientId: "client-1", clientSecret: "shh" },
};

function stubFetch(routeFn) {
  vi.stubGlobal("fetch", vi.fn(async (url, opts) => routeFn(String(url), opts || {})));
}
function json(body) {
  return { ok: true, json: async () => body };
}
function err(status, text) {
  return { ok: false, status, text: async () => text, headers: { get: () => null } };
}
function happyFetch() {
  stubFetch((url) => {
    if (url.includes("/oauth/token")) return json({ access_token: "tok", expires_in: 3600 });
    return json({});
  });
}

beforeEach(() => vi.unstubAllGlobals());

describe("tests array", () => {
  test("exports exactly 18 checks across 6 modules", () => {
    expect(tests).toHaveLength(18);
    const modules = new Set(tests.map((t) => t.key.split(".")[1]));
    expect([...modules].sort()).toEqual(["assessments", "dsar", "incidents", "inventory", "risk", "vendors"]);
  });

  test("every check has key, title, failTitle, severityDefault, isoReferences, run", () => {
    for (const t of tests) {
      expect(t.key.startsWith("onetrust.")).toBe(true);
      expect(typeof t.title).toBe("string");
      expect(typeof t.failTitle).toBe("string");
      expect(t.failTitle).not.toBe(t.title);
      expect(["critical", "high", "medium", "low"]).toContain(t.severityDefault);
      expect(Array.isArray(t.isoReferences)).toBe(true);
      expect(typeof t.run).toBe("function");
    }
  });
});

describe("testConnection", () => {
  test("returns ok + externalAccountId from the first organization", async () => {
    stubFetch((url) => {
      if (url.includes("/oauth/token")) return json({ access_token: "tok", expires_in: 3600 });
      if (url.includes("/api/access/v1/external/organizations")) return json({ organizations: [{ id: "org-9" }] });
      throw new Error(`unexpected ${url}`);
    });
    expect(await testConnection(BASE)).toEqual({ ok: true, externalAccountId: "org-9" });
  });

  test("maps a 401 to authentication guidance", async () => {
    stubFetch((url) => {
      if (url.includes("/oauth/token")) return json({ access_token: "tok", expires_in: 3600 });
      return err(401, "unauthorized");
    });
    await expect(testConnection(BASE)).rejects.toThrow(/Client ID \/ Client Secret/);
  });

  test("maps a 403 to missing-scope guidance", async () => {
    stubFetch((url) => {
      if (url.includes("/oauth/token")) return json({ access_token: "tok", expires_in: 3600 });
      return err(403, "forbidden");
    });
    await expect(testConnection(BASE)).rejects.toThrow(/missing a read scope/);
  });
});

describe("runTests", () => {
  test("returns one row per check (18) when every endpoint is empty", async () => {
    happyFetch();
    const results = await runTests(BASE);
    expect(results).toHaveLength(18);
    for (const r of results) {
      expect(typeof r.testKey).toBe("string");
      expect(typeof r.status).toBe("string");
      expect(r.evidencePayload).toBeDefined();
    }
  });

  test("title/failTitle/severity propagate from the definition", async () => {
    happyFetch();
    const results = await runTests(BASE);
    for (const r of results) {
      const def = tests.find((t) => t.key === r.testKey);
      expect(r.title).toBe(def.title);
      expect(r.failTitle).toBe(def.failTitle);
      expect(r.severity).toBe(def.severityDefault);
    }
  });

  test("a 403 on one module marks only that module's checks not_applicable; others still run", async () => {
    stubFetch((url) => {
      if (url.includes("/oauth/token")) return json({ access_token: "tok", expires_in: 3600 });
      if (url.includes("/api/assessment/")) return err(403, "forbidden");
      return json({});
    });
    const results = await runTests(BASE);
    expect(results).toHaveLength(18);
    const assessmentRows = results.filter((r) => r.testKey.startsWith("onetrust.assessments."));
    expect(assessmentRows).toHaveLength(3);
    for (const r of assessmentRows) {
      expect(r.status).toBe("not_applicable");
      expect(r.message).toMatch(/not accessible with the granted scopes/);
    }
    // A different module still produced rows that are not scope-errors.
    const dsarRows = results.filter((r) => r.testKey.startsWith("onetrust.dsar."));
    expect(dsarRows).toHaveLength(3);
    expect(dsarRows.every((r) => r.status !== "not_applicable" || !/granted scopes/.test(r.message))).toBe(true);
  });

  test("a non-403 API failure on one check is recorded as error, not not_applicable", async () => {
    stubFetch((url) => {
      if (url.includes("/oauth/token")) return json({ access_token: "tok", expires_in: 3600 });
      if (url.includes("/api/risk/")) return err(500, "boom");
      return json({});
    });
    const results = await runTests(BASE);
    const riskRows = results.filter((r) => r.testKey.startsWith("onetrust.risk."));
    expect(riskRows).toHaveLength(3);
    for (const r of riskRows) expect(r.status).toBe("error");
  });
});

describe("describeOneTrustError", () => {
  test("429 → rate-limit guidance", () => {
    expect(describeOneTrustError(new Error("failed: 429 slow down"))).toMatch(/rate limit/i);
  });
  test("generic → hostname/scope hint", () => {
    expect(describeOneTrustError(new Error("failed: 500"))).toMatch(/every read scope/);
  });
});
