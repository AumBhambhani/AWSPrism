import { describe, test, expect, vi, beforeEach } from "vitest";

const { resolveTeamsCredentials } = await import("../connectors/microsoft_teams/credentials.js");
const { testConnection, runTests, tests } = await import("../connectors/microsoft_teams/index.js");

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
  return json({ access_token: "tok", expires_in: 3600 });
}

// Stub the full TCM snapshot job lifecycle + any other Graph call.
// jobBody    — the result of createRes.json() (must include .id)
// statusBody — the result of polling (must include .status)
// resultBody — the result of the final GET
function tcmFetch(resultBody) {
  stubFetch((url) => {
    if (url.includes("login.microsoftonline.com")) return tokenOk();
    // Step 1: POST configurationSnapshotJobs → return job id
    if (url.includes("configurationSnapshotJobs") && !url.includes("/result") && !url.match(/\/[^/]+$/)) {
      return json({ id: "job-1" });
    }
    // Step 2: Poll job status
    if (url.includes("configurationSnapshotJobs/job-1") && !url.includes("/result")) {
      return json({ status: "succeeded" });
    }
    // Step 3: Read result
    if (url.includes("/result")) return json(resultBody);
    // Fallback for Graph GET (testConnection)
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
describe("resolveTeamsCredentials", () => {
  test("throws for unsupported auth type", () => {
    expect(() => resolveTeamsCredentials({ authType: "api_key", config: BASE.config, secret: BASE.secret }))
      .toThrow("Unsupported Microsoft Teams auth type: api_key");
  });

  test("returns getToken and tenantId", () => {
    const creds = resolveTeamsCredentials(BASE);
    expect(typeof creds.getToken).toBe("function");
    expect(creds.tenantId).toBe(BASE.config.tenantId);
  });
});

// ──────────────────────────────────────────────────────────────────────────────
// tests array shape
// ──────────────────────────────────────────────────────────────────────────────
describe("microsoft_teams tests array", () => {
  test("exports exactly 8 test definitions", () => {
    expect(tests).toHaveLength(8);
  });

  test("covers externalaccess, client, guests, and policies namespaces", () => {
    const namespaces = new Set(tests.map((t) => t.key.split(".")[1]));
    expect([...namespaces].sort()).toEqual(["client", "externalaccess", "guests", "policies"]);
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
describe("testConnection (microsoft_teams)", () => {
  test("resolves ok=true on successful Graph probe", async () => {
    stubFetch((url) => {
      if (url.includes("login.microsoftonline.com")) return tokenOk();
      return json({ value: [] });
    });
    const result = await testConnection(BASE);
    expect(result).toEqual({ ok: true, externalAccountId: BASE.config.tenantId });
  });

  test("wraps a 403 with TCM-specific guidance", async () => {
    stubFetch((url) => {
      if (url.includes("login.microsoftonline.com")) return tokenOk();
      return err(403, "Authorization_RequestDenied");
    });
    await expect(testConnection(BASE)).rejects.toThrow(/TCM/);
  });

  test("wraps a 401 with credential guidance", async () => {
    stubFetch((url) => {
      if (url.includes("login.microsoftonline.com")) return tokenOk();
      return err(401, "AADSTS7000215");
    });
    await expect(testConnection(BASE)).rejects.toThrow(/token rejected/i);
  });
});

// ──────────────────────────────────────────────────────────────────────────────
// runTests
// ──────────────────────────────────────────────────────────────────────────────
describe("runTests (microsoft_teams)", () => {
  test("returns 8 results when all TCM snapshots succeed with empty configs", async () => {
    // Provide a generic TCM stub for all tests
    stubFetch((url) => {
      if (url.includes("login.microsoftonline.com")) return tokenOk();
      if (url.includes("configurationSnapshotJobs") && !url.includes("/job-")) return json({ id: "job-1" });
      if (url.match(/configurationSnapshotJobs\/job-1$/) ) return json({ status: "succeeded" });
      if (url.includes("/result")) return json({});
      return json({ value: [] });
    });
    const results = await runTests(BASE);
    expect(results).toHaveLength(8);
  });

  test("each result carries testKey, title, severity, resourceId, status, evidencePayload", async () => {
    stubFetch((url) => {
      if (url.includes("login.microsoftonline.com")) return tokenOk();
      if (url.includes("configurationSnapshotJobs") && !url.includes("/job-")) return json({ id: "job-1" });
      if (url.match(/configurationSnapshotJobs\/job-1$/) ) return json({ status: "succeeded" });
      if (url.includes("/result")) return json({});
      return json({ value: [] });
    });
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
    stubFetch((url) => {
      if (url.includes("login.microsoftonline.com")) return tokenOk();
      if (url.includes("configurationSnapshotJobs") && !url.includes("/job-")) return json({ id: "job-1" });
      if (url.match(/configurationSnapshotJobs\/job-1$/) ) return json({ status: "succeeded" });
      if (url.includes("/result")) return json({});
      return json({ value: [] });
    });
    const results = await runTests(BASE);
    for (const r of results) {
      const def = tests.find((t) => t.key === r.testKey);
      expect(r.title).toBe(def.title);
      expect(r.severity).toBe(def.severityDefault);
    }
  });

  test("TCM snapshot failure records status=error and continues", async () => {
    let jobCount = 0;
    stubFetch((url) => {
      if (url.includes("login.microsoftonline.com")) return tokenOk();
      if (url.includes("configurationSnapshotJobs") && !url.includes("/job-")) {
        jobCount++;
        if (jobCount === 1) return err(500, "TCM_SNAPSHOT_ERROR");
        return json({ id: "job-1" });
      }
      if (url.match(/configurationSnapshotJobs\/job-1$/) ) return json({ status: "succeeded" });
      if (url.includes("/result")) return json({});
      return json({ value: [] });
    });
    const results = await runTests(BASE);
    expect(results).toHaveLength(8);
    const errors = results.filter((r) => r.status === "error");
    expect(errors.length).toBeGreaterThanOrEqual(1);
  });

  // ── Consumer Teams blocked → pass ──
  test("consumer Teams check passes when AllowTeamsConsumer and AllowTeamsConsumerInbound are false", async () => {
    stubFetch((url) => {
      if (url.includes("login.microsoftonline.com")) return tokenOk();
      if (url.includes("configurationSnapshotJobs") && !url.includes("/job-")) return json({ id: "job-1" });
      if (url.match(/configurationSnapshotJobs\/job-1$/) ) return json({ status: "succeeded" });
      if (url.includes("/result")) return json({ federationConfiguration: { AllowTeamsConsumer: false, AllowTeamsConsumerInbound: false } });
      return json({ value: [] });
    });
    const results = await runTests(BASE);
    const consumer = results.find((r) => r.testKey === "microsoft_teams.externalaccess.consumer_teams_blocked");
    expect(consumer.status).toBe("pass");
  });

  // ── Consumer Teams allowed → fail ──
  test("consumer Teams check fails when AllowTeamsConsumer is true", async () => {
    stubFetch((url) => {
      if (url.includes("login.microsoftonline.com")) return tokenOk();
      if (url.includes("configurationSnapshotJobs") && !url.includes("/job-")) return json({ id: "job-1" });
      if (url.match(/configurationSnapshotJobs\/job-1$/) ) return json({ status: "succeeded" });
      if (url.includes("/result")) return json({ federationConfiguration: { AllowTeamsConsumer: true } });
      return json({ value: [] });
    });
    const results = await runTests(BASE);
    const consumer = results.find((r) => r.testKey === "microsoft_teams.externalaccess.consumer_teams_blocked");
    expect(consumer.status).toBe("fail");
  });

  // ── No third-party storage → pass ──
  test("unsanctioned storage check passes when all storage flags are false", async () => {
    stubFetch((url) => {
      if (url.includes("login.microsoftonline.com")) return tokenOk();
      if (url.includes("configurationSnapshotJobs") && !url.includes("/job-")) return json({ id: "job-1" });
      if (url.match(/configurationSnapshotJobs\/job-1$/) ) return json({ status: "succeeded" });
      if (url.includes("/result")) return json({ clientConfiguration: { AllowBox: false, AllowDropBox: false, AllowGoogleDrive: false } });
      return json({ value: [] });
    });
    const results = await runTests(BASE);
    const storage = results.find((r) => r.testKey === "microsoft_teams.client.unsanctioned_storage_providers_disabled");
    expect(storage.status).toBe("pass");
  });
});
