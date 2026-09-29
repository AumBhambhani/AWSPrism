import { describe, test, expect, vi, beforeEach } from "vitest";

const { resolveEntraIdCredentials } = await import("../connectors/entra_id/credentials.js");
const { testConnection, runTests, tests } = await import("../connectors/entra_id/index.js");

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
  return json({ access_token: "graph-tok", expires_in: 3600 });
}

// Returns a stub that serves a token for the login URL and a given body for any graph URL.
function happyFetch(graphBody = {}) {
  stubFetch((url) => {
    if (url.includes("login.microsoftonline.com")) return tokenOk();
    return json(graphBody);
  });
}

beforeEach(() => {
  vi.unstubAllGlobals();
  vi.resetModules();
});

// ──────────────────────────────────────────────────────────────────────────────
// credentials
// ──────────────────────────────────────────────────────────────────────────────
describe("resolveEntraIdCredentials", () => {
  test("throws for unsupported auth type", () => {
    expect(() => resolveEntraIdCredentials({ authType: "api_key", config: BASE.config, secret: BASE.secret }))
      .toThrow("Unsupported Entra ID auth type: api_key");
  });

  test("throws when tenantId is missing", () => {
    expect(() => resolveEntraIdCredentials({ authType: "oauth2", config: {}, secret: BASE.secret }))
      .toThrow("Microsoft connector is missing config.tenantId");
  });

  test("returns getToken and tenantId on valid input", () => {
    const creds = resolveEntraIdCredentials(BASE);
    expect(typeof creds.getToken).toBe("function");
    expect(creds.tenantId).toBe(BASE.config.tenantId);
  });
});

// ──────────────────────────────────────────────────────────────────────────────
// tests array shape
// ──────────────────────────────────────────────────────────────────────────────
describe("entra_id tests array", () => {
  test("exports exactly 15 test definitions", () => {
    expect(tests).toHaveLength(15);
  });

  test("covers the expected namespaces", () => {
    const namespaces = new Set(tests.map((t) => t.key.split(".").slice(1, 2)[0]));
    expect([...namespaces].sort()).toEqual(["appregistrations", "audit", "authmethods", "conditionalaccess", "enterpriseapps", "groups", "mfa", "roles", "signins", "users"].filter((n) => namespaces.has(n)));
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
describe("testConnection (entra_id)", () => {
  test("resolves ok=true on successful Graph probe", async () => {
    happyFetch({ value: [{ id: BASE.config.tenantId, displayName: "Contoso" }] });
    const result = await testConnection(BASE);
    expect(result).toEqual({ ok: true, externalAccountId: BASE.config.tenantId });
  });

  test("wraps a 403 error with authorization guidance", async () => {
    stubFetch((url) => {
      if (url.includes("login.microsoftonline.com")) return tokenOk();
      return err(403, "Authorization_RequestDenied");
    });
    await expect(testConnection(BASE)).rejects.toThrow(/admin consent/i);
  });

  test("wraps a 401 error with credential-expiry guidance", async () => {
    stubFetch((url) => {
      if (url.includes("login.microsoftonline.com")) return tokenOk();
      return err(401, "AADSTS7000215");
    });
    await expect(testConnection(BASE)).rejects.toThrow(/client secret/i);
  });

  test("wraps a 429 error with rate-limit guidance", async () => {
    stubFetch((url) => {
      if (url.includes("login.microsoftonline.com")) return tokenOk();
      return err(429, "TooManyRequests");
    });
    await expect(testConnection(BASE)).rejects.toThrow(/rate limit/i);
  });
});

// ──────────────────────────────────────────────────────────────────────────────
// runTests
// ──────────────────────────────────────────────────────────────────────────────
describe("runTests (entra_id)", () => {
  test("returns one result per test (15 total) on happy-path empty Graph responses", async () => {
    happyFetch({ value: [] });
    const results = await runTests(BASE);
    expect(results).toHaveLength(15);
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

  test("a Graph 403 on a single test records status=error and continues", async () => {
    let callCount = 0;
    stubFetch((url) => {
      if (url.includes("login.microsoftonline.com")) return tokenOk();
      callCount++;
      if (callCount === 1) return err(403, "ACCESS_DENIED");
      return json({ value: [] });
    });
    const results = await runTests(BASE);
    expect(results).toHaveLength(15);
    const errors = results.filter((r) => r.status === "error");
    expect(errors.length).toBeGreaterThanOrEqual(1);
  });

  // ── Security Defaults → MFA pass ──
  test("mfa check passes when Security Defaults is enabled", async () => {
    stubFetch((url) => {
      if (url.includes("login.microsoftonline.com")) return tokenOk();
      if (url.includes("identitySecurityDefaultsEnforcementPolicy")) return json({ isEnabled: true });
      return json({ value: [] });
    });
    const results = await runTests(BASE);
    const mfa = results.find((r) => r.testKey === "entra_id.mfa.conditional_access_enforced");
    expect(mfa.status).toBe("pass");
  });

  // ── No MFA policy → fail ──
  test("mfa check fails when Security Defaults is off and no CA policy enforces MFA", async () => {
    stubFetch((url) => {
      if (url.includes("login.microsoftonline.com")) return tokenOk();
      if (url.includes("identitySecurityDefaultsEnforcementPolicy")) return json({ isEnabled: false });
      if (url.includes("conditionalAccess/policies")) return json({ value: [] });
      return json({ value: [] });
    });
    const results = await runTests(BASE);
    const mfa = results.find((r) => r.testKey === "entra_id.mfa.conditional_access_enforced");
    expect(mfa.status).toBe("fail");
  });

  // ── Weak auth methods disabled → pass ──
  test("weak methods check passes when SMS and voice are both disabled", async () => {
    stubFetch((url) => {
      if (url.includes("login.microsoftonline.com")) return tokenOk();
      if (url.includes("authenticationMethodsPolicy")) {
        return json({ authenticationMethodConfigurations: [
          { id: "sms", state: "disabled" },
          { id: "voice", state: "disabled" },
        ] });
      }
      return json({ value: [] });
    });
    const results = await runTests(BASE);
    const weak = results.find((r) => r.testKey === "entra_id.authmethods.weak_methods_disabled");
    expect(weak.status).toBe("pass");
  });

  // ── Weak auth methods enabled → fail ──
  test("weak methods check fails when SMS is enabled", async () => {
    stubFetch((url) => {
      if (url.includes("login.microsoftonline.com")) return tokenOk();
      if (url.includes("authenticationMethodsPolicy")) {
        return json({ authenticationMethodConfigurations: [
          { id: "sms", state: "enabled" },
          { id: "voice", state: "disabled" },
        ] });
      }
      return json({ value: [] });
    });
    const results = await runTests(BASE);
    const weak = results.find((r) => r.testKey === "entra_id.authmethods.weak_methods_disabled");
    expect(weak.status).toBe("fail");
  });

  // ── Privileged roles limited → pass ──
  test("privileged role check passes when Global Admin has ≤5 assignments", async () => {
    stubFetch((url) => {
      if (url.includes("login.microsoftonline.com")) return tokenOk();
      if (url.includes("/directoryRoles")) return json({ value: [{ id: "role-1", roleTemplateId: "62e90394-69f5-4237-9190-012177145e10", displayName: "Global Administrator" }] });
      if (url.includes("roleAssignments")) return json({ value: [{ id: "a1" }, { id: "a2" }] });
      return json({ value: [] });
    });
    const results = await runTests(BASE);
    const roles = results.find((r) => r.testKey === "entra_id.roles.privileged_role_assignments_limited");
    expect(roles.status).toBe("pass");
  });

  // ── Other privileged roles: within threshold → pass ──
  test("other privileged roles check passes when each active role is within its threshold", async () => {
    stubFetch((url) => {
      if (url.includes("login.microsoftonline.com")) return tokenOk();
      if (url.includes("/directoryRoles")) {
        return json({ value: [{ id: "role-pra", roleTemplateId: "e8611ab8-c189-46e8-94e1-60213ab1f814", displayName: "Privileged Role Administrator" }] });
      }
      if (url.includes("roleAssignments")) return json({ value: [{ id: "a1" }] });
      return json({ value: [] });
    });
    const results = await runTests(BASE);
    const roles = results.find((r) => r.testKey === "entra_id.roles.other_privileged_roles_reviewed");
    expect(roles.status).toBe("pass");
  });

  // ── Other privileged roles: over threshold → fail ──
  test("other privileged roles check fails when an active role exceeds its threshold", async () => {
    const manyAssignments = Array.from({ length: 6 }, (_, i) => ({ id: `a${i}` }));
    stubFetch((url) => {
      if (url.includes("login.microsoftonline.com")) return tokenOk();
      if (url.includes("/directoryRoles")) {
        return json({ value: [{ id: "role-pra", roleTemplateId: "e8611ab8-c189-46e8-94e1-60213ab1f814", displayName: "Privileged Role Administrator" }] });
      }
      if (url.includes("roleAssignments")) return json({ value: manyAssignments });
      return json({ value: [] });
    });
    const results = await runTests(BASE);
    const roles = results.find((r) => r.testKey === "entra_id.roles.other_privileged_roles_reviewed");
    expect(roles.status).toBe("fail");
  });

  // ── Privileged users MFA: admin has MFA registered → pass ──
  test("privileged users MFA check passes when every admin user has MFA registered", async () => {
    stubFetch((url) => {
      if (url.includes("login.microsoftonline.com")) return tokenOk();
      if (url.includes("/reports/authenticationMethods/userRegistrationDetails")) {
        return json({ value: [{ id: "u1", userPrincipalName: "admin@contoso.com", isAdmin: true, isMfaRegistered: true, userType: "member" }] });
      }
      return json({ value: [] });
    });
    const results = await runTests(BASE);
    const check = results.find((r) => r.testKey === "entra_id.roles.privileged_users_mfa_registered");
    expect(check.status).toBe("pass");
  });

  // ── Privileged users MFA: admin has no MFA registered → fail ──
  test("privileged users MFA check fails when an admin user has no MFA registered", async () => {
    stubFetch((url) => {
      if (url.includes("login.microsoftonline.com")) return tokenOk();
      if (url.includes("/reports/authenticationMethods/userRegistrationDetails")) {
        return json({ value: [{ id: "u1", userPrincipalName: "admin@contoso.com", isAdmin: true, isMfaRegistered: false, userType: "member" }] });
      }
      return json({ value: [] });
    });
    const results = await runTests(BASE);
    const check = results.find((r) => r.testKey === "entra_id.roles.privileged_users_mfa_registered");
    expect(check.status).toBe("fail");
    expect(check.resourceId).toBe("u1");
  });

  // ── Member user MFA: everyone registered → pass ──
  test("member user MFA check passes when every non-guest user has MFA registered", async () => {
    stubFetch((url) => {
      if (url.includes("login.microsoftonline.com")) return tokenOk();
      if (url.includes("/reports/authenticationMethods/userRegistrationDetails")) {
        return json({ value: [
          { id: "u1", userPrincipalName: "alice@contoso.com", isMfaRegistered: true, userType: "member" },
          { id: "u2", userPrincipalName: "guest@partner.com", isMfaRegistered: false, userType: "guest" },
        ] });
      }
      return json({ value: [] });
    });
    const results = await runTests(BASE);
    const check = results.find((r) => r.testKey === "entra_id.users.mfa_registration_reviewed");
    expect(check.status).toBe("pass");
  });

  // ── Member user MFA: a member user unregistered → fail ──
  test("member user MFA check fails when a non-guest user has no MFA registered", async () => {
    stubFetch((url) => {
      if (url.includes("login.microsoftonline.com")) return tokenOk();
      if (url.includes("/reports/authenticationMethods/userRegistrationDetails")) {
        return json({ value: [{ id: "u1", userPrincipalName: "alice@contoso.com", isMfaRegistered: false, userType: "member" }] });
      }
      return json({ value: [] });
    });
    const results = await runTests(BASE);
    const check = results.find((r) => r.testKey === "entra_id.users.mfa_registration_reviewed");
    expect(check.status).toBe("fail");
    expect(check.resourceId).toBe("u1");
  });

  // ── Legacy auth sign-ins: none observed → pass ──
  test("legacy auth sign-ins check passes when no legacy client apps appear in recent sign-ins", async () => {
    stubFetch((url) => {
      if (url.includes("login.microsoftonline.com")) return tokenOk();
      if (url.includes("/auditLogs/signIns")) {
        return json({ value: [{ id: "s1", clientAppUsed: "Mobile Apps and Desktop clients", userPrincipalName: "alice@contoso.com" }] });
      }
      return json({ value: [] });
    });
    const results = await runTests(BASE);
    const check = results.find((r) => r.testKey === "entra_id.signins.legacy_auth_signins_absent");
    expect(check.status).toBe("pass");
  });

  // ── Legacy auth sign-ins: legacy client observed → fail ──
  test("legacy auth sign-ins check fails when a legacy client app succeeded a sign-in", async () => {
    stubFetch((url) => {
      if (url.includes("login.microsoftonline.com")) return tokenOk();
      if (url.includes("/auditLogs/signIns")) {
        return json({ value: [{ id: "s1", clientAppUsed: "IMAP4", userPrincipalName: "alice@contoso.com" }] });
      }
      return json({ value: [] });
    });
    const results = await runTests(BASE);
    const check = results.find((r) => r.testKey === "entra_id.signins.legacy_auth_signins_absent");
    expect(check.status).toBe("fail");
  });

  // ── Risky sign-ins: none at-risk → pass ──
  test("risky sign-ins check passes when no users are flagged at-risk", async () => {
    happyFetch({ value: [] });
    const results = await runTests(BASE);
    const check = results.find((r) => r.testKey === "entra_id.signins.risky_signins_resolved");
    expect(check.status).toBe("pass");
  });

  // ── Risky sign-ins: an at-risk user is unresolved → fail ──
  test("risky sign-ins check fails when a user is flagged at-risk", async () => {
    stubFetch((url) => {
      if (url.includes("login.microsoftonline.com")) return tokenOk();
      if (url.includes("/identityProtection/riskyUsers")) {
        return json({ value: [{ id: "u1", userPrincipalName: "alice@contoso.com", riskLevel: "high", riskState: "atRisk" }] });
      }
      return json({ value: [] });
    });
    const results = await runTests(BASE);
    const check = results.find((r) => r.testKey === "entra_id.signins.risky_signins_resolved");
    expect(check.status).toBe("fail");
  });

  // ── Risky sign-ins: Identity Protection unavailable (no P2 license) → not_applicable ──
  test("risky sign-ins check is not_applicable when Identity Protection isn't licensed", async () => {
    stubFetch((url) => {
      if (url.includes("login.microsoftonline.com")) return tokenOk();
      if (url.includes("/identityProtection/riskyUsers")) return err(403, "Authorization_RequestDenied");
      return json({ value: [] });
    });
    const results = await runTests(BASE);
    const check = results.find((r) => r.testKey === "entra_id.signins.risky_signins_resolved");
    expect(check.status).toBe("not_applicable");
  });

  // ── Privileged change audit actor: entry has an actor → pass ──
  test("privileged change audit actor check passes when every RoleManagement entry has an actor", async () => {
    stubFetch((url) => {
      if (url.includes("login.microsoftonline.com")) return tokenOk();
      if (url.includes("/auditLogs/directoryAudits")) {
        return json({ value: [{ id: "e1", activityDisplayName: "Add member to role", initiatedBy: { user: { id: "admin-1" } } }] });
      }
      return json({ value: [] });
    });
    const results = await runTests(BASE);
    const check = results.find((r) => r.testKey === "entra_id.audit.privileged_role_changes_actor_captured");
    expect(check.status).toBe("pass");
  });

  // ── Privileged change audit actor: entry missing an actor → fail ──
  test("privileged change audit actor check fails when a RoleManagement entry has no actor", async () => {
    stubFetch((url) => {
      if (url.includes("login.microsoftonline.com")) return tokenOk();
      if (url.includes("/auditLogs/directoryAudits")) {
        return json({ value: [{ id: "e1", activityDisplayName: "Add member to role", initiatedBy: {} }] });
      }
      return json({ value: [] });
    });
    const results = await runTests(BASE);
    const check = results.find((r) => r.testKey === "entra_id.audit.privileged_role_changes_actor_captured");
    expect(check.status).toBe("fail");
    expect(check.resourceId).toBe("e1");
  });

  // ── Privileged groups: none exist in the tenant → not_applicable ──
  test("privileged groups check is not_applicable when no role-assignable groups exist", async () => {
    happyFetch({ value: [] });
    const results = await runTests(BASE);
    const groups = results.find((r) => r.testKey === "entra_id.groups.privileged_groups_have_owners");
    expect(groups.status).toBe("not_applicable");
  });

  // ── Privileged groups: every role-assignable group has an owner → pass ──
  test("privileged groups check passes when every role-assignable group has an owner", async () => {
    stubFetch((url) => {
      if (url.includes("login.microsoftonline.com")) return tokenOk();
      if (url.includes("/groups?$filter=isAssignableToRole")) {
        return json({ value: [{ id: "group-1", displayName: "Privileged Access Admins" }] });
      }
      if (url.includes("/groups/group-1/owners")) {
        return json({ value: [{ id: "owner-1" }] });
      }
      return json({ value: [] });
    });
    const results = await runTests(BASE);
    const groups = results.find((r) => r.testKey === "entra_id.groups.privileged_groups_have_owners");
    expect(groups.status).toBe("pass");
  });

  // ── Privileged groups: a role-assignable group has no owner → fail ──
  test("privileged groups check fails when a role-assignable group has no owner", async () => {
    stubFetch((url) => {
      if (url.includes("login.microsoftonline.com")) return tokenOk();
      if (url.includes("/groups?$filter=isAssignableToRole")) {
        return json({ value: [{ id: "group-1", displayName: "Privileged Access Admins" }] });
      }
      if (url.includes("/groups/group-1/owners")) {
        return json({ value: [] });
      }
      return json({ value: [] });
    });
    const results = await runTests(BASE);
    const groups = results.find((r) => r.testKey === "entra_id.groups.privileged_groups_have_owners");
    expect(groups.status).toBe("fail");
    expect(groups.resourceId).toBe("group-1");
  });

  // ── High-privilege Graph grants: no service principal holds one → pass ──
  test("high-privilege grants check passes when no reviewable SP has a high-priv Graph app role", async () => {
    const graphSpId = "graph-sp-1";
    stubFetch((url) => {
      if (url.includes("login.microsoftonline.com")) return tokenOk();
      if (url.includes("servicePrincipals?$filter=appId eq")) {
        return json({ value: [{ id: graphSpId, appRoles: [{ id: "role-directory-rw", value: "Directory.ReadWrite.All" }] }] });
      }
      if (url.includes("/servicePrincipals?$select=id,displayName,appOwnerOrganizationId")) {
        return json({ value: [{ id: "sp-1", displayName: "Contoso Integration", appOwnerOrganizationId: "tenant-1" }] });
      }
      if (url.includes("/appRoleAssignments")) {
        // Holds a Graph permission, but not one of the watched high-privilege ones.
        return json({ value: [{ appRoleId: "role-mail-read", resourceId: graphSpId }] });
      }
      return json({ value: [] });
    });
    const results = await runTests(BASE);
    const grants = results.find((r) => r.testKey === "entra_id.enterpriseapps.high_privilege_grants_reviewed");
    expect(grants.status).toBe("pass");
  });

  // ── High-privilege Graph grants: a reviewable SP holds one → fail ──
  test("high-privilege grants check fails when a non-Microsoft SP holds a high-priv Graph app role", async () => {
    const graphSpId = "graph-sp-1";
    stubFetch((url) => {
      if (url.includes("login.microsoftonline.com")) return tokenOk();
      if (url.includes("servicePrincipals?$filter=appId eq")) {
        return json({ value: [{ id: graphSpId, appRoles: [{ id: "role-directory-rw", value: "Directory.ReadWrite.All" }] }] });
      }
      if (url.includes("/servicePrincipals?$select=id,displayName,appOwnerOrganizationId")) {
        return json({
          value: [
            { id: "sp-microsoft", displayName: "Office 365 Exchange Online", appOwnerOrganizationId: "f8cdef31-a31e-4b4a-93e4-5f571e91255a" },
            { id: "sp-1", displayName: "Contoso Integration", appOwnerOrganizationId: "tenant-1" },
          ],
        });
      }
      if (url.includes("/servicePrincipals/sp-1/appRoleAssignments")) {
        return json({ value: [{ appRoleId: "role-directory-rw", resourceId: graphSpId }] });
      }
      if (url.includes("/appRoleAssignments")) return json({ value: [] });
      return json({ value: [] });
    });
    const results = await runTests(BASE);
    const grants = results.find((r) => r.testKey === "entra_id.enterpriseapps.high_privilege_grants_reviewed");
    expect(grants.status).toBe("fail");
    expect(grants.resourceId).toBe("sp-1");
    expect(grants.message).toContain("Directory.ReadWrite.All");
  });

  // ── High-privilege Graph grants: Microsoft Graph SP itself can't be resolved ──
  test("high-privilege grants check reports error when the Graph service principal can't be resolved", async () => {
    happyFetch({ value: [] });
    const results = await runTests(BASE);
    const grants = results.find((r) => r.testKey === "entra_id.enterpriseapps.high_privilege_grants_reviewed");
    expect(grants.status).toBe("error");
  });

  // ── App registration all valid → pass ──
  test("app registration check passes when no expired or expiring-soon credentials", async () => {
    const futureDate = new Date(Date.now() + 90 * 24 * 60 * 60 * 1000).toISOString();
    const pastStart = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();
    stubFetch((url) => {
      if (url.includes("login.microsoftonline.com")) return tokenOk();
      if (url.includes("/applications")) return json({ value: [{ id: "app-1", displayName: "MyApp", passwordCredentials: [{ startDateTime: pastStart, endDateTime: futureDate }], keyCredentials: [] }] });
      return json({ value: [] });
    });
    const results = await runTests(BASE);
    const appCreds = results.find((r) => r.testKey === "entra_id.appregistrations.credentials_not_expiring_soon");
    expect(appCreds.status).toBe("pass");
  });
});
