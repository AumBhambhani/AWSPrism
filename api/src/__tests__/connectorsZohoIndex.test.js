import { describe, test, expect, vi, beforeEach } from "vitest";

const { testConnection, runTests, tests } = await import("../connectors/zoho/index.js");

const BASE = {
  authType: "oauth2",
  config: { dataCenter: "com", orgId: "60012345" },
  secret: { clientId: "client-1", clientSecret: "shh", refreshToken: "rt-1" },
};

// Stub global fetch routing calls by URL substring.
function stubFetch(routeFn) {
  vi.stubGlobal("fetch", vi.fn(async (url) => routeFn(String(url))));
}

function json(body) {
  return { ok: true, json: async () => body };
}

function err(status, text) {
  return { ok: false, status, text: async () => text };
}

// Returns a minimal happy-path stub: token endpoint + org endpoint.
function happyFetch() {
  stubFetch((url) => {
    if (url.includes("accounts.zoho.com")) return json({ access_token: "tok", expires_in: 3600 });
    // Any product API call returns an empty response (pass/not_applicable everywhere)
    return json({});
  });
}

beforeEach(() => {
  vi.unstubAllGlobals();
});

describe("tests array", () => {
  test("exports exactly 42 test definitions", () => {
    expect(tests).toHaveLength(42);
  });

  test("all 14 product namespaces are represented", () => {
    const products = new Set(tests.map((t) => t.key.split(".")[1]));
    expect([...products].sort()).toEqual([
      "analytics",
      "books",
      "creator",
      "crm",
      "desk",
      "directory",
      "expense",
      "mail",
      "people",
      "projects",
      "recruit",
      "sign",
      "vault",
      "workdrive",
    ]);
  });

  test("every test has key, title, severityDefault, isoReferences, and run", () => {
    for (const t of tests) {
      expect(typeof t.key).toBe("string");
      expect(typeof t.title).toBe("string");
      expect(typeof t.severityDefault).toBe("string");
      expect(Array.isArray(t.isoReferences)).toBe(true);
      expect(typeof t.run).toBe("function");
    }
  });
});

describe("testConnection", () => {
  test("resolves with ok=true and externalAccountId=config.orgId on success", async () => {
    stubFetch((url) => {
      if (url.includes("accounts.zoho.com")) return json({ access_token: "tok", expires_in: 3600 });
      if (url.includes("/crm/v6/org")) return json({ org: [{ id: "60012345" }] });
      throw new Error(`Unexpected fetch: ${url}`);
    });
    const result = await testConnection(BASE);
    expect(result).toEqual({ ok: true, externalAccountId: "60012345" });
  });

  test("wraps a 401 error through describeZohoError with token guidance", async () => {
    stubFetch((url) => {
      if (url.includes("accounts.zoho.com")) return json({ access_token: "tok", expires_in: 3600 });
      return err(401, "INVALID_OAUTH_TOKEN");
    });
    await expect(testConnection(BASE)).rejects.toThrow(/INVALID_OAUTH_TOKEN/);
    await expect(testConnection(BASE)).rejects.toThrow(/re-generate credentials/i);
  });

  test("wraps a 429 error through describeZohoError with rate-limit guidance", async () => {
    stubFetch((url) => {
      if (url.includes("accounts.zoho.com")) return json({ access_token: "tok", expires_in: 3600 });
      return err(429, "RATE_LIMIT");
    });
    await expect(testConnection(BASE)).rejects.toThrow(/429/);
    await expect(testConnection(BASE)).rejects.toThrow(/rate limit/i);
  });
});

describe("runTests", () => {
  test("returns one result per test (42 total) when all API calls succeed with empty data", async () => {
    happyFetch();
    const results = await runTests(BASE);
    expect(results).toHaveLength(42);
  });

  test("each result carries testKey, title, severity, resourceId, status, and evidencePayload", async () => {
    happyFetch();
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

  test("title and severity on each result match the test definition", async () => {
    happyFetch();
    const results = await runTests(BASE);
    for (const r of results) {
      const def = tests.find((t) => t.key === r.testKey);
      expect(r.title).toBe(def.title);
      expect(r.severity).toBe(def.severityDefault);
    }
  });

  test("a per-test API failure records status=error and continues with the remaining tests in the product", async () => {
    let callCount = 0;
    stubFetch((url) => {
      if (url.includes("accounts.zoho.com")) return json({ access_token: "tok", expires_in: 3600 });
      // Fail the first real API call (directory MFA check), succeed everything else.
      callCount++;
      if (callCount === 1) return err(403, "ACCESS_DENIED");
      return json({});
    });

    const results = await runTests(BASE);
    // The first directory test should be error; the rest should be pass/not_applicable.
    const directoryMfa = results.find((r) => r.testKey === "zoho.directory.mfa_enforced");
    expect(directoryMfa.status).toBe("error");
    // All 42 results are still present (no test was skipped entirely).
    expect(results).toHaveLength(42);
  });

  test("a product-level 401 records all tests in that product as error and continues", async () => {
    let tokenCalled = false;
    stubFetch((url) => {
      if (url.includes("accounts.zoho.com")) {
        tokenCalled = true;
        return json({ access_token: "tok", expires_in: 3600 });
      }
      // Fail all directory calls (the first product) with a 401.
      if (url.includes("directory.zoho.com")) return err(401, "INVALID_OAUTH_TOKEN");
      return json({});
    });

    const results = await runTests(BASE);
    expect(tokenCalled).toBe(true);
    // All 3 directory tests should be error.
    const directoryResults = results.filter((r) => r.testKey.startsWith("zoho.directory."));
    expect(directoryResults).toHaveLength(3);
    for (const r of directoryResults) {
      expect(r.status).toBe("error");
    }
    // Non-directory products still run and produce results.
    const crmResults = results.filter((r) => r.testKey.startsWith("zoho.crm."));
    expect(crmResults).toHaveLength(3);
    expect(crmResults.some((r) => r.status !== "error")).toBe(true);
  });
});

describe("describeZohoError (via testConnection error surface)", () => {
  test("WRONG_DC in error message triggers authorization-failure guidance", async () => {
    stubFetch((url) => {
      if (url.includes("accounts.zoho.com")) return json({ access_token: "tok", expires_in: 3600 });
      return err(400, "WRONG_DC");
    });
    await expect(testConnection(BASE)).rejects.toThrow(/config\.dataCenter doesn't match/i);
  });

  test("generic error falls back to scope guidance", async () => {
    stubFetch((url) => {
      if (url.includes("accounts.zoho.com")) return json({ access_token: "tok", expires_in: 3600 });
      return err(500, "Internal server error");
    });
    await expect(testConnection(BASE)).rejects.toThrow(/scope list in the Zoho API Console/);
  });
});
