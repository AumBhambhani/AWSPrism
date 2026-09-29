import { describe, test, expect, vi, beforeEach } from "vitest";

const { testConnection, runTests, tests, describePrivyError } = await import("../connectors/privy/index.js");

const BASE = {
  authType: "api_key",
  config: { baseUrl: "acme.privybyidfy.com" },
  secret: { apiKey: "pk_live_abc123" },
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
  stubFetch(() => json({ data: [], totalCount: 0 }));
}

beforeEach(() => vi.unstubAllGlobals());

describe("tests array", () => {
  test("exports exactly 17 checks across 6 modules", () => {
    expect(tests).toHaveLength(17);
    const modules = new Set(tests.map((t) => t.key.split(".")[1]));
    expect([...modules].sort()).toEqual(["assessments", "consent", "incidents", "inventory", "rights", "tprm"]);
  });

  test("every check has key, title, failTitle, severityDefault, isoReferences, run", () => {
    for (const t of tests) {
      expect(t.key.startsWith("privy.")).toBe(true);
      expect(typeof t.title).toBe("string");
      expect(typeof t.failTitle).toBe("string");
      expect(t.failTitle).not.toBe(t.title);
      expect(["critical", "high", "medium", "low"]).toContain(t.severityDefault);
      expect(Array.isArray(t.isoReferences)).toBe(true);
      expect(Array.isArray(t.dpdpaControlAreas)).toBe(true);
      expect(typeof t.run).toBe("function");
    }
  });
});

describe("testConnection", () => {
  test("returns ok + externalAccountId", async () => {
    stubFetch((url) => {
      if (url.includes("/consent/collection-points")) return json({ data: [], organization: { id: "org-9" } });
      throw new Error(`unexpected ${url}`);
    });
    expect(await testConnection(BASE)).toEqual({ ok: true, externalAccountId: "org-9" });
  });

  test("falls back to the host when no organization is returned", async () => {
    stubFetch(() => json({ data: [] }));
    expect(await testConnection(BASE)).toEqual({ ok: true, externalAccountId: "acme.privybyidfy.com" });
  });

  test("maps a 401 to authentication guidance", async () => {
    stubFetch(() => err(401, "unauthorized"));
    await expect(testConnection(BASE)).rejects.toThrow(/API key/);
  });

  test("maps a 403 to module-not-enabled guidance", async () => {
    stubFetch(() => err(403, "forbidden"));
    await expect(testConnection(BASE)).rejects.toThrow(/module/);
  });
});

describe("runTests", () => {
  test("returns one row per check (17) when every endpoint is empty", async () => {
    happyFetch();
    const results = await runTests(BASE);
    expect(results).toHaveLength(17);
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
      if (url.includes("/assessments")) return err(403, "forbidden");
      return json({ data: [], totalCount: 0 });
    });
    const results = await runTests(BASE);
    expect(results).toHaveLength(17);
    const assessmentRows = results.filter((r) => r.testKey.startsWith("privy.assessments."));
    expect(assessmentRows).toHaveLength(3);
    for (const r of assessmentRows) {
      expect(r.status).toBe("not_applicable");
      expect(r.message).toMatch(/not accessible with this API key/);
    }
    const consentRows = results.filter((r) => r.testKey.startsWith("privy.consent."));
    expect(consentRows).toHaveLength(4);
    expect(consentRows.every((r) => !/not accessible with this API key/.test(r.message || ""))).toBe(true);
  });

  test("a non-scope API failure on one check is recorded as error", async () => {
    stubFetch((url) => {
      if (url.includes("/incidents")) return err(500, "boom");
      return json({ data: [], totalCount: 0 });
    });
    const results = await runTests(BASE);
    const incidentRows = results.filter((r) => r.testKey.startsWith("privy.incidents."));
    expect(incidentRows).toHaveLength(3);
    for (const r of incidentRows) expect(r.status).toBe("error");
  });
});

describe("describePrivyError", () => {
  test("429 → rate-limit guidance", () => {
    expect(describePrivyError(new Error("failed: 429 slow down"))).toMatch(/rate limit/i);
  });
  test("generic → tenant/module hint", () => {
    expect(describePrivyError(new Error("failed: 500"))).toMatch(/every module/);
  });
});
