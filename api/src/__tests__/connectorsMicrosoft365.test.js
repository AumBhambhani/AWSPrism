import { describe, test, expect, vi, beforeEach } from "vitest";

const { resolveM365Credentials } = await import("../connectors/microsoft_365/credentials.js");
const { testConnection, runTests, tests } = await import("../connectors/microsoft_365/index.js");

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

function happyFetch() {
  stubFetch((url) => {
    if (url.includes("login.microsoftonline.com")) return tokenOk();
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
describe("resolveM365Credentials", () => {
  test("throws for unsupported auth type", () => {
    expect(() => resolveM365Credentials({ authType: "api_key", config: BASE.config, secret: BASE.secret }))
      .toThrow("Unsupported Microsoft 365 auth type: api_key");
  });

  test("returns getGraphToken, getExchangeToken, and tenantId", () => {
    const creds = resolveM365Credentials(BASE);
    expect(typeof creds.getGraphToken).toBe("function");
    expect(typeof creds.getExchangeToken).toBe("function");
    expect(creds.tenantId).toBe(BASE.config.tenantId);
  });

  test("getGraphToken and getExchangeToken are independent getters (separate caches)", async () => {
    vi.stubGlobal("fetch", vi.fn(async (url) => {
      if (url.includes("login.microsoftonline.com")) return tokenOk();
      return json({});
    }));
    const creds = resolveM365Credentials(BASE);
    await creds.getGraphToken();
    await creds.getExchangeToken();
    // Two separate token fetches — one per resource
    const tokenCalls = fetch.mock.calls.filter((c) => String(c[0]).includes("login.microsoftonline.com"));
    expect(tokenCalls).toHaveLength(2);
  });
});

// ──────────────────────────────────────────────────────────────────────────────
// tests array shape
// ──────────────────────────────────────────────────────────────────────────────
describe("microsoft_365 tests array", () => {
  test("exports exactly 9 test definitions", () => {
    expect(tests).toHaveLength(9);
  });

  test("covers exchange, sharepoint, intune, and defenderoffice namespaces", () => {
    const namespaces = new Set(tests.map((t) => t.key.split(".")[1]));
    expect([...namespaces].sort()).toEqual(["defenderoffice", "exchange", "intune", "sharepoint"]);
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
describe("testConnection (microsoft_365)", () => {
  test("resolves ok=true when both Graph and Exchange probes succeed", async () => {
    stubFetch((url) => {
      if (url.includes("login.microsoftonline.com")) return tokenOk();
      if (url.includes("graph.microsoft.com")) return json({ value: [{ id: BASE.config.tenantId }] });
      if (url.includes("outlook.office365.com")) return json({ value: [{}] });
      throw new Error(`Unexpected URL: ${url}`);
    });
    const result = await testConnection(BASE);
    expect(result).toEqual({ ok: true, externalAccountId: BASE.config.tenantId });
  });

  test("throws when both Graph and Exchange probes fail", async () => {
    stubFetch((url) => {
      if (url.includes("login.microsoftonline.com")) return tokenOk();
      return err(403, "ACCESS_DENIED");
    });
    await expect(testConnection(BASE)).rejects.toThrow(/Both Microsoft 365 endpoints failed/);
  });

  test("throws with Graph-specific message when only Graph fails", async () => {
    stubFetch((url) => {
      if (url.includes("login.microsoftonline.com")) return tokenOk();
      if (url.includes("graph.microsoft.com")) return err(403, "ACCESS_DENIED");
      return json({ value: [{}] });
    });
    await expect(testConnection(BASE)).rejects.toThrow(/Graph access failed/);
  });

  test("throws with Exchange-specific message when only Exchange fails", async () => {
    stubFetch((url) => {
      if (url.includes("login.microsoftonline.com")) return tokenOk();
      if (url.includes("graph.microsoft.com")) return json({ value: [{}] });
      return err(403, "Exchange_ACCESS_DENIED");
    });
    await expect(testConnection(BASE)).rejects.toThrow(/Exchange access failed/);
  });

  test("wraps 401 error with credential-expiry guidance", async () => {
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
describe("runTests (microsoft_365)", () => {
  test("returns 9 results on happy-path", async () => {
    happyFetch();
    const results = await runTests(BASE);
    expect(results).toHaveLength(9);
  });

  test("each result carries testKey, title, severity, resourceId, status, evidencePayload", async () => {
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

  test("title and severity match the test definition", async () => {
    happyFetch();
    const results = await runTests(BASE);
    for (const r of results) {
      const def = tests.find((t) => t.key === r.testKey);
      expect(r.title).toBe(def.title);
      expect(r.severity).toBe(def.severityDefault);
    }
  });

  test("a per-test API failure records status=error and continues", async () => {
    let exchangeCount = 0;
    stubFetch((url) => {
      if (url.includes("login.microsoftonline.com")) return tokenOk();
      if (url.includes("outlook.office365.com")) {
        exchangeCount++;
        if (exchangeCount === 1) return err(500, "Internal error");
        return json({ value: [] });
      }
      return json({ value: [] });
    });
    const results = await runTests(BASE);
    expect(results).toHaveLength(9);
    const errors = results.filter((r) => r.status === "error");
    expect(errors.length).toBeGreaterThanOrEqual(1);
  });

  // ── mailbox audit enabled → pass ──
  test("mailbox audit check passes when AuditDisabled is not true", async () => {
    stubFetch((url) => {
      if (url.includes("login.microsoftonline.com")) return tokenOk();
      if (url.includes("Get-OrganizationConfig")) return json({ value: [{ AuditDisabled: false }] });
      return json({ value: [] });
    });
    const results = await runTests(BASE);
    const audit = results.find((r) => r.testKey === "microsoft_365.exchange.mailbox_audit_logging_enabled");
    expect(audit.status).toBe("pass");
  });

  // ── external forwarding disabled → pass ──
  test("auto-forwarding check passes when AutoForwardEnabled is false", async () => {
    stubFetch((url) => {
      if (url.includes("login.microsoftonline.com")) return tokenOk();
      if (url.includes("Get-RemoteDomain")) return json({ value: [{ AutoForwardEnabled: false }] });
      return json({ value: [] });
    });
    const results = await runTests(BASE);
    const fwd = results.find((r) => r.testKey === "microsoft_365.exchange.no_external_auto_forwarding");
    expect(fwd.status).toBe("pass");
  });

  // ── SharePoint sharing restricted → pass ──
  test("sharepoint external sharing check passes when capability is not externalUserAndGuestSharing", async () => {
    stubFetch((url) => {
      if (url.includes("login.microsoftonline.com")) return tokenOk();
      if (url.includes("/admin/sharepoint/settings")) return json({ sharingCapability: "existingExternalUserSharingOnly" });
      return json({ value: [] });
    });
    const results = await runTests(BASE);
    const sp = results.find((r) => r.testKey === "microsoft_365.sharepoint.external_sharing_restricted");
    expect(sp.status).toBe("pass");
  });

  // ── DLP policy configured ──
  test("dlp policy check returns not_applicable when tenant has no SharePoint sites", async () => {
    stubFetch((url) => {
      if (url.includes("login.microsoftonline.com")) return tokenOk();
      if (url.includes("/sites?search=")) return json({ value: [] });
      return json({ value: [] });
    });
    const results = await runTests(BASE);
    const dlp = results.find((r) => r.testKey === "microsoft_365.sharepoint.dlp_policy_configured");
    expect(dlp.status).toBe("not_applicable");
  });

  test("dlp policy check fails when sites exist but no DLP policies are configured", async () => {
    stubFetch((url) => {
      if (url.includes("login.microsoftonline.com")) return tokenOk();
      if (url.includes("/sites?search=")) return json({ value: [{ id: "site-1", displayName: "Site 1" }] });
      if (url.includes("/informationProtection/dataLossPreventionPolicies")) return json({ value: [] });
      return json({ value: [] });
    });
    const results = await runTests(BASE);
    const dlp = results.find((r) => r.testKey === "microsoft_365.sharepoint.dlp_policy_configured");
    expect(dlp.status).toBe("fail");
  });

  test("dlp policy check passes when sites exist and at least one DLP policy is configured", async () => {
    stubFetch((url) => {
      if (url.includes("login.microsoftonline.com")) return tokenOk();
      if (url.includes("/sites?search=")) return json({ value: [{ id: "site-1", displayName: "Site 1" }] });
      if (url.includes("/informationProtection/dataLossPreventionPolicies")) return json({ value: [{ id: "policy-1" }] });
      return json({ value: [] });
    });
    const results = await runTests(BASE);
    const dlp = results.find((r) => r.testKey === "microsoft_365.sharepoint.dlp_policy_configured");
    expect(dlp.status).toBe("pass");
  });

  test("dlp policy check records status=error when the Graph sites API call fails", async () => {
    stubFetch((url) => {
      if (url.includes("login.microsoftonline.com")) return tokenOk();
      if (url.includes("/sites?search=")) return err(500, "Internal error");
      return json({ value: [] });
    });
    const results = await runTests(BASE);
    const dlp = results.find((r) => r.testKey === "microsoft_365.sharepoint.dlp_policy_configured");
    expect(dlp.status).toBe("error");
  });

  // ── Sensitivity label policy enforced ──
  test("sensitivity label check fails when no sensitivity labels are configured", async () => {
    stubFetch((url) => {
      if (url.includes("login.microsoftonline.com")) return tokenOk();
      if (url.includes("/security/informationProtection/sensitivityLabels")) return json({ value: [] });
      return json({ value: [] });
    });
    const results = await runTests(BASE);
    const label = results.find((r) => r.testKey === "microsoft_365.sharepoint.sensitivity_label_policy_enforced");
    expect(label.status).toBe("fail");
  });

  test("sensitivity label check passes when sensitivity labels are configured", async () => {
    stubFetch((url) => {
      if (url.includes("login.microsoftonline.com")) return tokenOk();
      if (url.includes("/security/informationProtection/sensitivityLabels")) return json({ value: [{ id: "label-1", name: "Confidential" }] });
      return json({ value: [] });
    });
    const results = await runTests(BASE);
    const label = results.find((r) => r.testKey === "microsoft_365.sharepoint.sensitivity_label_policy_enforced");
    expect(label.status).toBe("pass");
  });

  test("sensitivity label check returns not_applicable when the API call fails (e.g. missing Purview licensing)", async () => {
    stubFetch((url) => {
      if (url.includes("login.microsoftonline.com")) return tokenOk();
      if (url.includes("/security/informationProtection/sensitivityLabels")) return err(403, "MipLicenseMissing");
      return json({ value: [] });
    });
    const results = await runTests(BASE);
    const label = results.find((r) => r.testKey === "microsoft_365.sharepoint.sensitivity_label_policy_enforced");
    expect(label.status).toBe("not_applicable");
  });

  // ── Compliance policy coverage: an assigned policy of the right platform type → pass ──
  test("compliance policy coverage check passes when an assigned policy's @odata.type matches the managed platform", async () => {
    stubFetch((url) => {
      if (url.includes("login.microsoftonline.com")) return tokenOk();
      if (url.includes("/deviceManagement/deviceCompliancePolicies")) {
        return json({ value: [{
          id: "policy-1",
          "@odata.type": "#microsoft.graph.windows10CompliancePolicy",
          assignments: [{ id: "assignment-1" }],
        }] });
      }
      if (url.includes("/deviceManagement/managedDevices")) {
        return json({ value: [{ id: "device-1", operatingSystem: "Windows" }] });
      }
      return json({ value: [] });
    });
    const results = await runTests(BASE);
    const policy = results.find((r) => r.testKey === "microsoft_365.intune.compliance_policy_assigned_all_platforms");
    expect(policy.status).toBe("pass");
  });

  // ── Compliance policy coverage: policy exists but isn't assigned → fail ──
  test("compliance policy coverage check fails when the matching policy has no assignments", async () => {
    stubFetch((url) => {
      if (url.includes("login.microsoftonline.com")) return tokenOk();
      if (url.includes("/deviceManagement/deviceCompliancePolicies")) {
        return json({ value: [{
          id: "policy-1",
          "@odata.type": "#microsoft.graph.windows10CompliancePolicy",
          assignments: [],
        }] });
      }
      if (url.includes("/deviceManagement/managedDevices")) {
        return json({ value: [{ id: "device-1", operatingSystem: "Windows" }] });
      }
      return json({ value: [] });
    });
    const results = await runTests(BASE);
    const policy = results.find((r) => r.testKey === "microsoft_365.intune.compliance_policy_assigned_all_platforms");
    expect(policy.status).toBe("fail");
    expect(policy.resourceId).toBe("platform_windows");
  });

  // ── Compliance policy coverage: managed platform has no policy at all → fail ──
  test("compliance policy coverage check fails when a managed platform has no compliance policy", async () => {
    stubFetch((url) => {
      if (url.includes("login.microsoftonline.com")) return tokenOk();
      if (url.includes("/deviceManagement/deviceCompliancePolicies")) return json({ value: [] });
      if (url.includes("/deviceManagement/managedDevices")) {
        return json({ value: [{ id: "device-1", operatingSystem: "iOS" }] });
      }
      return json({ value: [] });
    });
    const results = await runTests(BASE);
    const policy = results.find((r) => r.testKey === "microsoft_365.intune.compliance_policy_assigned_all_platforms");
    expect(policy.status).toBe("fail");
    expect(policy.resourceId).toBe("platform_ios");
  });

  // ── Intune no managed devices → not_applicable ──
  test("intune noncompliant check returns not_applicable when no managed devices", async () => {
    stubFetch((url) => {
      if (url.includes("login.microsoftonline.com")) return tokenOk();
      if (url.includes("managedDevices")) return json({ value: [] });
      return json({ value: [] });
    });
    const results = await runTests(BASE);
    const intune = results.find((r) => r.testKey === "microsoft_365.intune.noncompliant_devices_remediated");
    expect(intune.status).toBe("not_applicable");
  });
});
