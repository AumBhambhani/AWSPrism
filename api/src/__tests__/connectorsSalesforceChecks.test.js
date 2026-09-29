import { describe, test, expect } from "vitest";

import { userTests } from "../connectors/salesforce/tests/users.js";
import { profileTests } from "../connectors/salesforce/tests/profiles.js";
import { connectedAppTests } from "../connectors/salesforce/tests/connectedApps.js";
import { auditTests } from "../connectors/salesforce/tests/audit.js";
import { networkTests } from "../connectors/salesforce/tests/network.js";
import { permissionSetTests } from "../connectors/salesforce/tests/permissionSets.js";
import { THRESHOLDS, SENSITIVE_PERMISSIONS } from "../connectors/salesforce/index.js";

const run = (defs, key, clients) => defs.find((t) => t.key === key).run(clients);
const base = { THRESHOLDS, SENSITIVE_PERMISSIONS };
const DAYS_AGO = (d) => new Date(Date.now() - d * 86400000).toISOString();

describe("user.mfa_enforced", () => {
  test("pass when the session policy requires MFA", async () => {
    const rows = await run(userTests, "salesforce.user.mfa_enforced", {
      ...base,
      getSecuritySettings: async () => [{ Metadata: { sessionSettings: { hasMfaLoginPolicy: true } } }],
    });
    expect(rows[0].status).toBe("pass");
  });

  test("fail when the session policy does not require MFA", async () => {
    const rows = await run(userTests, "salesforce.user.mfa_enforced", {
      ...base,
      getSecuritySettings: async () => [{ Metadata: { sessionSettings: { hasMfaLoginPolicy: false } } }],
    });
    expect(rows[0].status).toBe("fail");
  });

  test("not_applicable when SecuritySettings is unreadable", async () => {
    const rows = await run(userTests, "salesforce.user.mfa_enforced", {
      ...base,
      getSecuritySettings: async () => {
        throw new Error("403 INSUFFICIENT_ACCESS");
      },
    });
    expect(rows[0].status).toBe("not_applicable");
  });
});

describe("user.no_inactive_high_privilege", () => {
  const activeUser = { Id: "a", Username: "a@x.com", IsActive: true, Profile: { Name: "Standard User" } };

  test("pass when no inactive user is privileged", async () => {
    const rows = await run(userTests, "salesforce.user.no_inactive_high_privilege", {
      ...base,
      listUsers: async () => [activeUser, { Id: "b", Username: "b@x.com", IsActive: false, Profile: { Name: "Standard User" } }],
      listPermissionSetAssignments: async () => [],
    });
    expect(rows[0].status).toBe("pass");
  });

  test("fail — inactive user still on the System Administrator profile", async () => {
    const rows = await run(userTests, "salesforce.user.no_inactive_high_privilege", {
      ...base,
      listUsers: async () => [{ Id: "b", Username: "ghost@x.com", IsActive: false, Profile: { Name: "System Administrator" } }],
      listPermissionSetAssignments: async () => [],
    });
    expect(rows).toHaveLength(1);
    expect(rows[0].status).toBe("fail");
    expect(rows[0].resourceId).toBe("b");
  });

  test("fail — inactive user retains an admin-tier permission set", async () => {
    const rows = await run(userTests, "salesforce.user.no_inactive_high_privilege", {
      ...base,
      listUsers: async () => [{ Id: "b", Username: "ghost@x.com", IsActive: false, Profile: { Name: "Standard User" } }],
      listPermissionSetAssignments: async () => [
        { AssigneeId: "b", Assignee: { IsActive: false }, PermissionSet: { Name: "SuperPS", PermissionsModifyAllData: true } },
      ],
    });
    expect(rows[0].status).toBe("fail");
  });
});

describe("profile.password_policy_strength", () => {
  test("pass on a strong policy", async () => {
    const rows = await run(profileTests, "salesforce.profile.password_policy_strength", {
      ...base,
      listProfilePasswordPolicies: async () => [{ ProfileId: "p1", MinimumPasswordLength: 12, PasswordComplexity: 2, PasswordExpiration: 3 }],
      listProfiles: async () => [{ Id: "p1", Name: "Standard User" }],
    });
    expect(rows[0].status).toBe("pass");
  });

  test("fail on short + no complexity + never-expires", async () => {
    const rows = await run(profileTests, "salesforce.profile.password_policy_strength", {
      ...base,
      listProfilePasswordPolicies: async () => [{ ProfileId: "p1", MinimumPasswordLength: 5, PasswordComplexity: 0, PasswordExpiration: 0 }],
      listProfiles: async () => [{ Id: "p1", Name: "Weak Profile" }],
    });
    expect(rows[0].status).toBe("fail");
    expect(rows[0].message).toMatch(/minimum length/);
  });

  test("not_applicable when no profile policies exist", async () => {
    const rows = await run(profileTests, "salesforce.profile.password_policy_strength", {
      ...base,
      listProfilePasswordPolicies: async () => [],
      listProfiles: async () => [],
    });
    expect(rows[0].status).toBe("not_applicable");
  });
});

describe("profile.least_privilege_admin_count", () => {
  const mk = (n) => Array.from({ length: n }, (_, i) => ({ Id: `u${i}`, Username: `u${i}@x.com`, IsActive: true, Profile: { Name: "System Administrator" } }));

  test("pass within threshold", async () => {
    const rows = await run(profileTests, "salesforce.profile.least_privilege_admin_count", { ...base, listUsers: async () => mk(3) });
    expect(rows[0].status).toBe("pass");
  });

  test("fail over threshold", async () => {
    const rows = await run(profileTests, "salesforce.profile.least_privilege_admin_count", { ...base, listUsers: async () => mk(9) });
    expect(rows[0].status).toBe("fail");
  });

  test("not_applicable when no named System Administrator user exists", async () => {
    const rows = await run(profileTests, "salesforce.profile.least_privilege_admin_count", {
      ...base,
      listUsers: async () => [{ Id: "u", Username: "u@x.com", IsActive: true, Profile: { Name: "Custom Admin" } }],
    });
    expect(rows[0].status).toBe("not_applicable");
  });
});

describe("connected_app checks", () => {
  test("oauth_scopes_minimal fails a Full-scope app", async () => {
    const rows = await run(connectedAppTests, "salesforce.connected_app.oauth_scopes_minimal", {
      ...base,
      listConnectedApps: async () => [{ Id: "c1", Name: "Broad", OauthConfig: { Scopes: ["Api", "Full"] } }],
    });
    expect(rows[0].status).toBe("fail");
  });

  test("oauth_scopes_minimal not_applicable when scopes aren't returned", async () => {
    const rows = await run(connectedAppTests, "salesforce.connected_app.oauth_scopes_minimal", {
      ...base,
      listConnectedApps: async () => [{ Id: "c1", Name: "NoScopes" }],
    });
    expect(rows[0].status).toBe("not_applicable");
  });

  test("admin_approval_required fails a self-authorize app", async () => {
    const rows = await run(connectedAppTests, "salesforce.connected_app.admin_approval_required", {
      ...base,
      listConnectedApps: async () => [{ Id: "c1", Name: "Selfauth", OptionsAllowAdminApprovedUsersOnly: false }],
    });
    expect(rows[0].status).toBe("fail");
  });

  test("admin_approval_required passes when all apps are admin-approved", async () => {
    const rows = await run(connectedAppTests, "salesforce.connected_app.admin_approval_required", {
      ...base,
      listConnectedApps: async () => [{ Id: "c1", Name: "Ok", OptionsAllowAdminApprovedUsersOnly: true }],
    });
    expect(rows[0].status).toBe("pass");
  });
});

describe("audit checks", () => {
  test("setup_audit_trail_retention passes on a long span", async () => {
    const rows = await run(auditTests, "salesforce.audit.setup_audit_trail_retention", {
      ...base,
      listSetupAuditTrail: async () => [{ CreatedDate: DAYS_AGO(1) }, { CreatedDate: DAYS_AGO(200) }],
    });
    expect(rows[0].status).toBe("pass");
  });

  test("setup_audit_trail_retention fails on a short but active trail", async () => {
    const entries = Array.from({ length: 60 }, (_, i) => ({ CreatedDate: DAYS_AGO(i % 40) }));
    const rows = await run(auditTests, "salesforce.audit.setup_audit_trail_retention", { ...base, listSetupAuditTrail: async () => entries });
    expect(rows[0].status).toBe("fail");
  });

  test("setup_audit_trail_retention fails when empty", async () => {
    const rows = await run(auditTests, "salesforce.audit.setup_audit_trail_retention", { ...base, listSetupAuditTrail: async () => [] });
    expect(rows[0].status).toBe("fail");
  });

  test("login_history_available passes with records, fails without", async () => {
    const pass = await run(auditTests, "salesforce.audit.login_history_available", { ...base, listLoginHistory: async () => [{ LoginTime: DAYS_AGO(1) }] });
    expect(pass[0].status).toBe("pass");
    const fail = await run(auditTests, "salesforce.audit.login_history_available", { ...base, listLoginHistory: async () => [] });
    expect(fail[0].status).toBe("fail");
  });
});

describe("network.trusted_ip_ranges_configured", () => {
  test("pass with per-profile Login IP Ranges", async () => {
    const rows = await run(networkTests, "salesforce.network.trusted_ip_ranges_configured", {
      ...base,
      listOrgTrustedIpRanges: async () => [],
      listProfileLoginIpRanges: async () => [{ ProfileId: "p1", IpStartAddress: "1.1.1.1", IpEndAddress: "1.1.1.9" }],
    });
    expect(rows[0].status).toBe("pass");
  });

  test("fail with only org-wide ranges", async () => {
    const rows = await run(networkTests, "salesforce.network.trusted_ip_ranges_configured", {
      ...base,
      listOrgTrustedIpRanges: async () => [{ StartAddress: "1.1.1.1", EndAddress: "1.1.1.9" }],
      listProfileLoginIpRanges: async () => [],
    });
    expect(rows[0].status).toBe("fail");
  });

  test("fail with nothing configured", async () => {
    const rows = await run(networkTests, "salesforce.network.trusted_ip_ranges_configured", {
      ...base,
      listOrgTrustedIpRanges: async () => [],
      listProfileLoginIpRanges: async () => [],
    });
    expect(rows[0].status).toBe("fail");
  });

  test("not_applicable when neither object is readable", async () => {
    const rows = await run(networkTests, "salesforce.network.trusted_ip_ranges_configured", {
      ...base,
      listOrgTrustedIpRanges: async () => { throw new Error("403"); },
      listProfileLoginIpRanges: async () => { throw new Error("403"); },
    });
    expect(rows[0].status).toBe("not_applicable");
  });
});

describe("permissionset.sensitive_permissions_reviewed", () => {
  test("pass when each sensitive permission is within the assignee threshold", async () => {
    const rows = await run(permissionSetTests, "salesforce.permissionset.sensitive_permissions_reviewed", {
      ...base,
      listPermissionSetAssignments: async () => [
        { AssigneeId: "u1", Assignee: { Username: "a@x.com", IsActive: true }, PermissionSet: { PermissionsModifyAllData: true, PermissionsViewAllData: true } },
      ],
    });
    expect(rows.every((r) => r.status === "pass")).toBe(true);
    expect(rows.find((r) => r.resourceId === "PermissionsModifyAllData").status).toBe("pass");
  });

  test("fail when a permission is over-assigned", async () => {
    const assignments = Array.from({ length: 12 }, (_, i) => ({
      AssigneeId: `u${i}`, Assignee: { Username: `u${i}@x.com`, IsActive: true }, PermissionSet: { PermissionsViewAllData: true },
    }));
    const rows = await run(permissionSetTests, "salesforce.permissionset.sensitive_permissions_reviewed", {
      ...base,
      listPermissionSetAssignments: async () => assignments,
    });
    expect(rows.find((r) => r.resourceId === "PermissionsViewAllData").status).toBe("fail");
  });

  test("not_applicable when no assignments are readable", async () => {
    const rows = await run(permissionSetTests, "salesforce.permissionset.sensitive_permissions_reviewed", {
      ...base,
      listPermissionSetAssignments: async () => [],
    });
    expect(rows[0].status).toBe("not_applicable");
  });

  test("ModifyAllData held by nobody → not_applicable (data completeness signal)", async () => {
    const rows = await run(permissionSetTests, "salesforce.permissionset.sensitive_permissions_reviewed", {
      ...base,
      listPermissionSetAssignments: async () => [
        { AssigneeId: "u1", Assignee: { Username: "a@x.com", IsActive: true }, PermissionSet: { PermissionsManageUsers: true } },
      ],
    });
    expect(rows.find((r) => r.resourceId === "PermissionsModifyAllData").status).toBe("not_applicable");
  });
});
