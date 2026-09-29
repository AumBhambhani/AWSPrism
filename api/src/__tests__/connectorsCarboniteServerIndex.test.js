import { describe, test, expect, vi, beforeEach } from "vitest";

const { testConnection, runTests, tests, describeCarboniteServerError } = await import(
  "../connectors/carbonite-server/index.js"
);

const BASE = {
  authType: "oauth2",
  config: { apiDomain: "backup.example.com", keycloakRealm: "carbonite" },
  secret: { clientId: "prism-reader", clientSecret: "s3cr3t" },
};

const hoursAgo = (h) => new Date(Date.now() - h * 3_600_000).toISOString();

function json(body) {
  return { ok: true, status: 200, json: async () => body, text: async () => JSON.stringify(body), headers: { get: () => null } };
}
function err(status, text) {
  return { ok: false, status, json: async () => ({}), text: async () => text, headers: { get: () => null } };
}

// Routes a request URL to a canned response, keyed by the path after
// /monitoring (Keycloak token requests are handled separately).
function route(handlers) {
  return (url) => {
    const s = String(url);
    if (s.endsWith("/protocol/openid-connect/token")) {
      return json({ access_token: "kc-token-1", expires_in: 300 });
    }
    const u = new URL(s);
    const path = u.pathname.replace(/^\/monitoring/, "");
    const handler = handlers[path];
    if (handler === undefined) throw new Error(`unexpected request: ${path}`);
    return handler;
  };
}

function stub(routeFn) {
  vi.stubGlobal("fetch", vi.fn(async (u) => routeFn(u)));
}

const HEALTHY = route({
  "/odata/Companies": json({ value: [{ Id: 1, Name: "Acme" }] }),
  "/odata/Safesets": json({ value: [{ Name: "SQL nightly", LastRunStatus: "Success", LastRunTime: hoursAgo(2) }] }),
  "/odata/Agents": json({ value: [{ Name: "web-01", IsOnline: true }] }),
});

beforeEach(() => vi.unstubAllGlobals());

describe("tests array", () => {
  test("exports exactly 2 checks across backup / monitoring", () => {
    expect(tests).toHaveLength(2);
    expect([...new Set(tests.map((t) => t.key.split(".")[1]))].sort()).toEqual(["backup", "monitoring"]);
  });

  test("every check has key, title, failTitle, severityDefault, isoReferences, dpdpaControlAreas, run", () => {
    for (const t of tests) {
      expect(t.key.startsWith("carbonite-server.")).toBe(true);
      expect(typeof t.title).toBe("string");
      expect(t.failTitle).not.toBe(t.title);
      expect(["critical", "high", "medium", "low"]).toContain(t.severityDefault);
      expect(Array.isArray(t.isoReferences) && t.isoReferences.length).toBeTruthy();
      expect(Array.isArray(t.dpdpaControlAreas) && t.dpdpaControlAreas.length).toBeTruthy();
      expect(typeof t.run).toBe("function");
    }
  });
});

describe("testConnection", () => {
  test("exchanges the Keycloak token, probes /odata/Companies, returns the host as externalAccountId", async () => {
    stub(HEALTHY);
    expect(await testConnection(BASE)).toEqual({ ok: true, externalAccountId: "backup.example.com" });
  });

  test("maps a failed token exchange to client-credentials guidance", async () => {
    vi.stubGlobal("fetch", vi.fn(async (u) => (String(u).endsWith("/token") ? err(401, "invalid_client") : json({}))));
    await expect(testConnection(BASE)).rejects.toThrow(/Client ID \/ Client secret/);
  });

  test("maps a 403 on the probe to access-level guidance", async () => {
    stub(route({ "/odata/Companies": err(403, "forbidden") }));
    await expect(testConnection(BASE)).rejects.toThrow(/access level/);
  });
});

describe("runTests — healthy install", () => {
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
  test("flags a failed safeset run and an offline agent", async () => {
    stub(
      route({
        "/odata/Safesets": json({ value: [{ Name: "SQL nightly", LastRunStatus: "Failed", LastRunTime: hoursAgo(2) }] }),
        "/odata/Agents": json({ value: [{ Name: "web-01", IsOnline: false }] }),
      })
    );
    const results = await runTests(BASE);
    expect(results.find((r) => r.testKey === "carbonite-server.backup.recent_successful_safeset").status).toBe("fail");
    expect(results.find((r) => r.testKey === "carbonite-server.monitoring.agent_online").status).toBe("fail");
  });
});

describe("runTests — access-level isolation", () => {
  test("a 403 on /odata/Agents marks only the monitoring check not_applicable", async () => {
    stub((url) => {
      if (String(url).includes("/odata/Agents")) return err(403, "forbidden");
      return HEALTHY(url);
    });
    const results = await runTests(BASE);
    expect(results.find((r) => r.testKey === "carbonite-server.backup.recent_successful_safeset").status).toBe("pass");
    expect(results.find((r) => r.testKey === "carbonite-server.monitoring.agent_online").status).toBe("not_applicable");
  });

  test("a 500 on /odata/Safesets records the backup check as error", async () => {
    stub((url) => {
      if (String(url).includes("/odata/Safesets")) return err(500, "boom");
      return HEALTHY(url);
    });
    const results = await runTests(BASE);
    expect(results.find((r) => r.testKey === "carbonite-server.backup.recent_successful_safeset").status).toBe("error");
  });
});

describe("describeCarboniteServerError", () => {
  test("429 → rate-limit guidance", () => {
    expect(describeCarboniteServerError(new Error("failed: 429 slow down"))).toMatch(/rate limit/i);
  });
  test("generic → apiDomain / realm hint", () => {
    expect(describeCarboniteServerError(new Error("failed: 502"))).toMatch(/config\.apiDomain/);
  });
});
