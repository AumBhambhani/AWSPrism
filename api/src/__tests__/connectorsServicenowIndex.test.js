import { describe, test, expect, vi, beforeEach } from "vitest";

const { testConnection, runTests, tests, describeServiceNowError } = await import(
  "../connectors/servicenow/index.js"
);

const BASE = {
  authType: "oauth2",
  config: { instanceUrl: "acme.service-now.com" },
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
    if (url.includes("/oauth_token.do")) return json({ access_token: "tok", expires_in: 1800 });
    return json({ result: [] });
  });
}

beforeEach(() => vi.unstubAllGlobals());

describe("tests array", () => {
  test("exports exactly 10 checks across the expected areas", () => {
    expect(tests).toHaveLength(10);
    const areas = new Set(tests.map((t) => t.key.split(".")[1]));
    expect([...areas].sort()).toEqual([
      "acl",
      "audit",
      "group",
      "integrationuser",
      "oauth",
      "password_policy",
      "role",
      "user",
    ]);
  });

  test("every check has key, title, failTitle, severityDefault, isoReferences, run", () => {
    for (const t of tests) {
      expect(t.key.startsWith("servicenow.")).toBe(true);
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
  test("returns ok + externalAccountId of the instance host", async () => {
    stubFetch((url) => {
      if (url.includes("/oauth_token.do")) return json({ access_token: "tok", expires_in: 1800 });
      if (url.includes("/api/now/table/sys_user")) return json({ result: [{ sys_id: "1" }] });
      throw new Error(`unexpected ${url}`);
    });
    expect(await testConnection(BASE)).toEqual({ ok: true, externalAccountId: "acme.service-now.com" });
  });

  test("maps a 401 to authentication guidance", async () => {
    stubFetch((url) => {
      if (url.includes("/oauth_token.do")) return json({ access_token: "tok", expires_in: 1800 });
      return err(401, "unauthorized");
    });
    await expect(testConnection(BASE)).rejects.toThrow(/Client ID \/ Client Secret/);
  });

  test("maps a 403 to missing-role guidance", async () => {
    stubFetch((url) => {
      if (url.includes("/oauth_token.do")) return json({ access_token: "tok", expires_in: 1800 });
      return err(403, "Insufficient rights");
    });
    await expect(testConnection(BASE)).rejects.toThrow(/read-only role/);
  });
});

describe("runTests", () => {
  test("produces at least one row for every one of the 10 checks", async () => {
    happyFetch();
    const results = await runTests(BASE);
    const seen = new Set(results.map((r) => r.testKey));
    for (const t of tests) expect(seen.has(t.key)).toBe(true);
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

  test("a 403 on sys_security_acl marks only the acl check not_applicable", async () => {
    stubFetch((url) => {
      if (url.includes("/oauth_token.do")) return json({ access_token: "tok", expires_in: 1800 });
      if (url.includes("/api/now/table/sys_security_acl")) return err(403, "Insufficient rights (ACL)");
      return json({ result: [] });
    });
    const results = await runTests(BASE);
    const aclRows = results.filter((r) => r.testKey === "servicenow.acl.default_deny_sensitive_tables");
    expect(aclRows).toHaveLength(1);
    expect(aclRows[0].status).toBe("not_applicable");
    expect(aclRows[0].message).toMatch(/could not run with the integration user's current access/);
    // A user-table check still ran normally.
    const roleRows = results.filter((r) => r.testKey === "servicenow.role.admin_count_within_policy");
    expect(roleRows[0].status).toBe("pass");
  });

  test("a 500 on sys_user is recorded as error for the user-list checks", async () => {
    stubFetch((url) => {
      if (url.includes("/oauth_token.do")) return json({ access_token: "tok", expires_in: 1800 });
      if (url.includes("/api/now/table/sys_user?")) return err(500, "boom");
      if (url.includes("/api/now/table/sys_user_has_role")) return json({ result: [] });
      return json({ result: [] });
    });
    const results = await runTests(BASE);
    const noInactive = results.find((r) => r.testKey === "servicenow.user.no_inactive_privileged");
    expect(noInactive.status).toBe("error");
  });
});

describe("describeServiceNowError", () => {
  test("429 → rate-limit guidance", () => {
    expect(describeServiceNowError(new Error("failed: 429 slow down"))).toMatch(/rate limit/i);
  });
  test("generic → instance/role hint", () => {
    expect(describeServiceNowError(new Error("failed: 502"))).toMatch(/read access to every table/);
  });
});
