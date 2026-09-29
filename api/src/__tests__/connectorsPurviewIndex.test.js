import { describe, test, expect, vi } from "vitest";

const { testConnection, runTests, tests } = await import("../connectors/purview/index.js");

const BASE_CONFIG = {
  authType: "oauth2",
  config: { tenantId: "tenant-1", purviewAccountName: "acct-1" },
  secret: { clientId: "client-1", clientSecret: "shh" },
};

function jsonResponse(body) {
  return { ok: true, json: async () => body };
}

function errorResponse(status, text) {
  return { ok: false, status, text: async () => text };
}

// Routes plain-fetch calls by URL substring: the token-fetch endpoint
// (credentials.js's fetchToken), the Data Map base URL, and the Audit base
// URL. Mirrors connectorsPurviewCredentials.test.js's token-fetch mocking
// pattern so both layers stay consistent.
function stubFetch(routeFn) {
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url) => routeFn(String(url)))
  );
}

describe("testConnection", () => {
  test("succeeds when both the Data Map and Audit probes succeed", async () => {
    stubFetch((url) => {
      if (url.includes("login.microsoftonline.com")) return jsonResponse({ access_token: "tok" });
      if (url.includes("purview.azure.com")) return jsonResponse({ value: [] });
      if (url.includes("manage.office.com")) return jsonResponse([]);
      throw new Error(`unexpected fetch to ${url}`);
    });

    const result = await testConnection(BASE_CONFIG);
    expect(result).toEqual({ ok: true, externalAccountId: "acct-1" });
  });

  test("names the Data Map grant as the problem when only Data Map access fails (Atlas-JSON error body)", async () => {
    stubFetch((url) => {
      if (url.includes("login.microsoftonline.com")) return jsonResponse({ access_token: "tok" });
      if (url.includes("purview.azure.com")) {
        return errorResponse(
          403,
          JSON.stringify({ error: { code: "Forbidden", message: "The caller does not have permission to read data sources." } })
        );
      }
      if (url.includes("manage.office.com")) return jsonResponse([]);
      throw new Error(`unexpected fetch to ${url}`);
    });

    await expect(testConnection(BASE_CONFIG)).rejects.toThrow(/Purview Data Map access failed \(Audit access is OK\)/);
    await expect(testConnection(BASE_CONFIG)).rejects.toThrow(/Data Reader \/ Data Source Administrator role assignment/);
    // Atlas-shaped JSON error body: describePurviewError should extract just
    // the nested .error.message, not dump the whole raw response text.
    await expect(testConnection(BASE_CONFIG)).rejects.toThrow(/The caller does not have permission to read data sources\./);
  });

  test("names the Audit grant as the problem when only Audit access fails (audit-logging-disabled signature)", async () => {
    stubFetch((url) => {
      if (url.includes("login.microsoftonline.com")) return jsonResponse({ access_token: "tok" });
      if (url.includes("purview.azure.com")) return jsonResponse({ value: [] });
      if (url.includes("manage.office.com")) {
        return errorResponse(401, "Microsoft.Office.Compliance.Audit.DataServiceException: Tenant does not have audit log search enabled.");
      }
      throw new Error(`unexpected fetch to ${url}`);
    });

    await expect(testConnection(BASE_CONFIG)).rejects.toThrow(/Purview Audit access failed \(Data Map access is OK\)/);
    await expect(testConnection(BASE_CONFIG)).rejects.toThrow(/ActivityFeed\.Read, ActivityFeed\.ReadDlp, ServiceHealth\.Read/);
    await expect(testConnection(BASE_CONFIG)).rejects.toThrow(/unified audit logging is disabled for the tenant/);
  });

  test("reports both grants failing when both probes fail, with a per-grant description for each", async () => {
    stubFetch((url) => {
      if (url.includes("login.microsoftonline.com")) return jsonResponse({ access_token: "tok" });
      if (url.includes("purview.azure.com")) return errorResponse(403, "forbidden by policy");
      if (url.includes("manage.office.com")) return errorResponse(403, "forbidden by policy");
      throw new Error(`unexpected fetch to ${url}`);
    });

    await expect(testConnection(BASE_CONFIG)).rejects.toThrow(/Both Purview grants failed/);
    await expect(testConnection(BASE_CONFIG)).rejects.toThrow(/Data Map: .*forbidden by policy/);
    await expect(testConnection(BASE_CONFIG)).rejects.toThrow(/Audit: .*forbidden by policy/);
    // Raw-text fallback (not Atlas-JSON-shaped, not the audit-disabled
    // signature): describePurviewError should append its generic
    // authorization-failure guidance rather than returning nothing extra.
    await expect(testConnection(BASE_CONFIG)).rejects.toThrow(/If this looks like an authorization failure/);
  });
});

describe("runTests", () => {
  test("flattens results from both datamapTests and auditTests, merging testKey/title/severity onto each result", async () => {
    stubFetch((url) => {
      if (url.includes("login.microsoftonline.com")) return jsonResponse({ access_token: "tok" });
      if (url.includes("purview.azure.com")) return jsonResponse({ value: [] });
      if (url.includes("manage.office.com")) return jsonResponse([]);
      throw new Error(`unexpected fetch to ${url}`);
    });

    const results = await runTests(BASE_CONFIG);

    for (const result of results) {
      const definition = tests.find((t) => t.key === result.testKey);
      expect(definition).toBeTruthy();
      expect(result.title).toBe(definition.title);
      expect(result.title).not.toBe(result.testKey);
      expect(result.severity).toBe(definition.severityDefault);
    }

    const resultKeys = results.map((r) => r.testKey);
    expect(resultKeys.some((k) => k.startsWith("purview.datamap."))).toBe(true);
    expect(resultKeys.some((k) => k.startsWith("purview.audit."))).toBe(true);
    // Every datamap check collapses to exactly one not_applicable result
    // against empty sources/entities (4 results); the audit checks against
    // an empty subscriptions list produce 1 (unified logging pass) + 4
    // (subscriptions_active, one per required content type) + 1 (DLP
    // not_applicable) + 1 (content_recently_available not_applicable) = 7.
    expect(results.length).toBe(11);
  });

  test("wraps a mid-run failure through describePurviewError into status=error results", async () => {
    stubFetch((url) => {
      if (url.includes("login.microsoftonline.com")) return jsonResponse({ access_token: "tok" });
      if (url.includes("purview.azure.com")) return errorResponse(403, "forbidden by policy");
      if (url.includes("manage.office.com")) return jsonResponse([]);
      throw new Error(`unexpected fetch to ${url}`);
    });

    const results = await runTests(BASE_CONFIG);
    const errors = results.filter((r) => r.status === "error");
    expect(errors.length).toBeGreaterThan(0);
    expect(errors[0].message).toMatch(/forbidden by policy/);
    expect(errors[0].message).toMatch(/If this looks like an authorization failure/);
  });
});
