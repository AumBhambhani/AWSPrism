import { describe, test, expect, vi, beforeEach } from "vitest";
import { generateKeyPairSync } from "crypto";

const { testConnection, runTests, tests, THRESHOLDS, describeSalesforceError } = await import(
  "../connectors/salesforce/index.js"
);

const { privateKey } = generateKeyPairSync("rsa", {
  modulusLength: 2048,
  privateKeyEncoding: { type: "pkcs8", format: "pem" },
  publicKeyEncoding: { type: "spki", format: "pem" },
});

const BASE = {
  authType: "oauth2",
  config: { loginUrl: "https://acme.my.salesforce.com", clientId: "cid", username: "u@acme.com", apiVersion: "v61.0" },
  secret: { privateKey },
};

const DAYS_AGO = (d) => new Date(Date.now() - d * 86400000).toISOString();

function res(body, { ok = true, status = 200 } = {}) {
  const text = typeof body === "string" ? body : JSON.stringify(body);
  return { ok, status, headers: { get: () => null }, json: async () => JSON.parse(text), text: async () => text };
}
const q = (records) => res({ records, done: true });
const errRes = (status, body) => res(body, { ok: false, status });

// A fully-healthy Salesforce org: every object readable, nothing failing.
function healthyRoutes(url) {
  if (url.includes("/services/oauth2/token")) {
    return res({ access_token: "tok", instance_url: "https://acme.my.salesforce.com" });
  }
  const decoded = decodeURIComponent(url);
  const tooling = decoded.includes("/tooling/query");

  if (decoded.includes("FROM Organization")) return q([{ Id: "00Dxx0000001gPFEAY", Name: "Acme" }]);

  if (tooling && decoded.includes("FROM SecuritySettings"))
    return q([{ DeveloperName: "SecuritySettings", Metadata: { sessionSettings: { hasMfaLoginPolicy: true } } }]);
  if (tooling && decoded.includes("FROM ProfilePasswordPolicy"))
    return q([{ ProfileId: "00exx1", MinimumPasswordLength: 12, PasswordComplexity: 2, PasswordExpiration: 3, MaxLoginAttempts: 5 }]);
  if (tooling && decoded.includes("FROM ConnectedApplication"))
    return q([{ Id: "ca1", Name: "Data Loader", OptionsAllowAdminApprovedUsersOnly: true, OauthConfig: { Scopes: ["Api", "RefreshToken"] } }]);
  if (tooling && decoded.includes("FROM LoginIp"))
    return q([{ Id: "li1", ProfileId: "00exx1", IpStartAddress: "10.0.0.0", IpEndAddress: "10.0.0.255" }]);

  if (decoded.includes("FROM User"))
    return q([
      { Id: "u1", Username: "admin@acme.com", Name: "Admin", IsActive: true, UserType: "Standard", ProfileId: "00exx1", Profile: { Name: "System Administrator" } },
      { Id: "u2", Username: "sales@acme.com", Name: "Sales", IsActive: true, UserType: "Standard", ProfileId: "00exx2", Profile: { Name: "Standard User" } },
    ]);
  if (decoded.includes("FROM Profile")) return q([{ Id: "00exx1", Name: "System Administrator", UserType: "Standard" }, { Id: "00exx2", Name: "Standard User", UserType: "Standard" }]);
  if (decoded.includes("FROM PermissionSetAssignment"))
    return q([
      {
        Id: "psa1", AssigneeId: "u1", Assignee: { Name: "Admin", Username: "admin@acme.com", IsActive: true },
        PermissionSetId: "ps1",
        PermissionSet: { Name: "AdminProfilePS", IsOwnedByProfile: true, ProfileId: "00exx1", Profile: { Name: "System Administrator" }, PermissionsModifyAllData: true, PermissionsViewAllData: true, PermissionsManageUsers: true, PermissionsAuthorApex: true },
      },
    ]);
  if (decoded.includes("FROM SetupAuditTrail"))
    return q([
      { Id: "sat1", Action: "changedProfile", Section: "Manage Users", CreatedDate: DAYS_AGO(1), CreatedBy: { Username: "admin@acme.com" } },
      { Id: "sat2", Action: "loginIpRanges", Section: "Manage Users", CreatedDate: DAYS_AGO(200), CreatedBy: { Username: "admin@acme.com" } },
    ]);
  if (decoded.includes("FROM LoginHistory"))
    return q([{ Id: "lh1", UserId: "u1", LoginTime: DAYS_AGO(1), Application: "Browser", SourceIp: "10.0.0.5", Status: "Success" }]);
  if (decoded.includes("FROM NetworkAccess")) return q([{ Id: "na1", StartAddress: "10.0.0.0", EndAddress: "10.0.0.255" }]);

  throw new Error(`unexpected request ${url}`);
}

function stub(routeFn) {
  vi.stubGlobal("fetch", vi.fn(async (u) => routeFn(String(u))));
}

beforeEach(() => vi.unstubAllGlobals());

describe("tests array", () => {
  test("exports exactly 10 checks across the expected areas", () => {
    expect(tests).toHaveLength(10);
    const areas = [...new Set(tests.map((t) => t.key.split(".")[1]))].sort();
    expect(areas).toEqual(["audit", "connected_app", "network", "permissionset", "profile", "user"]);
  });

  test("every check has key, title, failTitle, severityDefault, isoReferences, run", () => {
    for (const t of tests) {
      expect(t.key.startsWith("salesforce.")).toBe(true);
      expect(typeof t.title).toBe("string");
      expect(t.failTitle && t.failTitle !== t.title).toBeTruthy();
      expect(["critical", "high", "medium", "low"]).toContain(t.severityDefault);
      expect(Array.isArray(t.isoReferences) && t.isoReferences.length).toBeTruthy();
      expect(typeof t.run).toBe("function");
    }
  });

  test("THRESHOLDS carries the documented defaults", () => {
    expect(THRESHOLDS.PASSWORD_MIN_LENGTH).toBe(8);
    expect(THRESHOLDS.AUDIT_TRAIL_MIN_WINDOW_DAYS).toBe(180);
  });
});

describe("testConnection", () => {
  test("returns ok + the org id as externalAccountId", async () => {
    stub(healthyRoutes);
    expect(await testConnection(BASE)).toEqual({ ok: true, externalAccountId: "00Dxx0000001gPFEAY" });
  });

  test("maps invalid_grant to JWT auth guidance", async () => {
    stub((url) => {
      if (url.includes("/services/oauth2/token")) return errRes(400, { error: "invalid_grant", error_description: "invalid assertion" });
      throw new Error(`unexpected ${url}`);
    });
    await expect(testConnection(BASE)).rejects.toThrow(/JWT authentication failed/);
  });

  test("maps a 403 on the Organization probe to missing-access guidance", async () => {
    stub((url) => {
      if (url.includes("/services/oauth2/token")) return res({ access_token: "tok", instance_url: "https://acme.my.salesforce.com" });
      if (url.includes("FROM+Organization") || url.includes("FROM%20Organization")) return errRes(403, [{ errorCode: "INSUFFICIENT_ACCESS", message: "no access" }]);
      throw new Error(`unexpected ${url}`);
    });
    await expect(testConnection(BASE)).rejects.toThrow(/missing read access|View Setup/);
  });
});

describe("runTests — healthy org", () => {
  test("produces at least one row for every check, and none error", async () => {
    stub(healthyRoutes);
    const results = await runTests(BASE);
    const seen = new Set(results.map((r) => r.testKey));
    for (const t of tests) expect(seen.has(t.key)).toBe(true);
    for (const r of results) {
      expect(r.status).not.toBe("error");
      expect(r.evidencePayload).toBeDefined();
    }
  });

  test("title/failTitle/severity propagate from the definition", async () => {
    stub(healthyRoutes);
    for (const r of await runTests(BASE)) {
      const def = tests.find((t) => t.key === r.testKey);
      expect(r.title).toBe(def.title);
      expect(r.failTitle).toBe(def.failTitle);
      expect(r.severity).toBe(def.severityDefault);
    }
  });

  test("MFA policy on, healthy org → mfa_enforced passes", async () => {
    stub(healthyRoutes);
    const results = await runTests(BASE);
    const mfa = results.find((r) => r.testKey === "salesforce.user.mfa_enforced");
    expect(mfa.status).toBe("pass");
  });
});

describe("runTests — findings", () => {
  test("flags MFA off, an inactive admin, a self-authorizing app and no login IP ranges", async () => {
    stub((url) => {
      const decoded = decodeURIComponent(url);
      if (url.includes("/services/oauth2/token")) return res({ access_token: "tok", instance_url: "https://acme.my.salesforce.com" });
      if (decoded.includes("FROM Organization")) return q([{ Id: "00D1", Name: "Acme" }]);
      if (decoded.includes("FROM SecuritySettings")) return q([{ Metadata: { sessionSettings: { hasMfaLoginPolicy: false } } }]);
      if (decoded.includes("FROM ProfilePasswordPolicy")) return q([{ ProfileId: "p1", MinimumPasswordLength: 5, PasswordComplexity: 0, PasswordExpiration: 0 }]);
      if (decoded.includes("/tooling/query") && decoded.includes("FROM ConnectedApplication"))
        return q([{ Id: "ca1", Name: "Rogue", OptionsAllowAdminApprovedUsersOnly: false, OauthConfig: { Scopes: ["Full"] } }]);
      if (decoded.includes("FROM LoginIp")) return q([]);
      if (decoded.includes("FROM User"))
        return q([
          { Id: "u1", Username: "ghost@acme.com", IsActive: false, UserType: "Standard", ProfileId: "p1", Profile: { Name: "System Administrator" } },
        ]);
      if (decoded.includes("FROM Profile")) return q([{ Id: "p1", Name: "System Administrator" }]);
      if (decoded.includes("FROM PermissionSetAssignment"))
        return q([{ Id: "psa1", AssigneeId: "u1", Assignee: { Username: "ghost@acme.com", IsActive: false }, PermissionSet: { Name: "PS", IsOwnedByProfile: true, Profile: { Name: "System Administrator" }, PermissionsModifyAllData: true } }]);
      if (decoded.includes("FROM SetupAuditTrail")) return q([{ Id: "s1", CreatedDate: DAYS_AGO(2), Action: "x", Section: "y" }]);
      if (decoded.includes("FROM LoginHistory")) return q([]);
      if (decoded.includes("FROM NetworkAccess")) return q([]);
      throw new Error(`unexpected ${url}`);
    });

    const results = await runTests(BASE);
    const byKey = (k) => results.filter((r) => r.testKey === k);

    expect(byKey("salesforce.user.mfa_enforced")[0].status).toBe("fail");
    expect(byKey("salesforce.user.no_inactive_high_privilege").some((r) => r.status === "fail")).toBe(true);
    expect(byKey("salesforce.profile.password_policy_strength").some((r) => r.status === "fail")).toBe(true);
    expect(byKey("salesforce.connected_app.oauth_scopes_minimal").some((r) => r.status === "fail")).toBe(true);
    expect(byKey("salesforce.connected_app.admin_approval_required").some((r) => r.status === "fail")).toBe(true);
    expect(byKey("salesforce.audit.login_history_available")[0].status).toBe("fail");
    expect(byKey("salesforce.network.trusted_ip_ranges_configured")[0].status).toBe("fail");
  });
});

describe("runTests — scope isolation", () => {
  test("a 403 on SetupAuditTrail marks only the audit-trail check not_applicable", async () => {
    stub((url) => {
      const decoded = decodeURIComponent(url);
      if (decoded.includes("FROM SetupAuditTrail")) return errRes(403, [{ errorCode: "INSUFFICIENT_ACCESS", message: "denied" }]);
      return healthyRoutes(url);
    });
    const results = await runTests(BASE);
    const trail = results.filter((r) => r.testKey === "salesforce.audit.setup_audit_trail_retention");
    expect(trail).toHaveLength(1);
    expect(trail[0].status).toBe("not_applicable");
    // Other areas still run.
    expect(results.find((r) => r.testKey === "salesforce.audit.login_history_available").status).toBe("pass");
  });

  test("a 500 on the User query records the user checks as error", async () => {
    stub((url) => {
      const decoded = decodeURIComponent(url);
      if (decoded.includes("FROM User")) return errRes(500, "boom");
      return healthyRoutes(url);
    });
    const results = await runTests(BASE);
    expect(results.find((r) => r.testKey === "salesforce.user.no_inactive_high_privilege").status).toBe("error");
  });
});

describe("describeSalesforceError", () => {
  test("request limit → quota guidance", () => {
    expect(describeSalesforceError(new Error("failed: 429 REQUEST_LIMIT_EXCEEDED"))).toMatch(/request limit/i);
  });
  test("generic → setup guidance", () => {
    expect(describeSalesforceError(new Error("failed: 502"))).toMatch(/My Domain login URL/);
  });
});
