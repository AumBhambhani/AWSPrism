import { describe, test, expect } from "vitest";
import { userTests } from "../connectors/servicenow/tests/users.js";
import { aclTests } from "../connectors/servicenow/tests/acls.js";
import { accountTests } from "../connectors/servicenow/tests/accounts.js";
import { auditTests } from "../connectors/servicenow/tests/audit.js";
import { PRIVILEGED_ROLES, SENSITIVE_TABLES, THRESHOLDS } from "../connectors/servicenow/index.js";

const byKey = Object.fromEntries(
  [...userTests, ...aclTests, ...accountTests, ...auditTests].map((t) => [t.key, t])
);
const run = (key, overrides) => byKey[key].run(fakeClients(overrides));

const daysAgo = (n) => new Date(Date.now() - n * 86400000).toISOString();

// display_value=all wraps each field as { value, display_value }.
const dv = (value, display = value) => ({ value: String(value), display_value: String(display) });

function displayOf(field) {
  if (field == null) return null;
  if (typeof field === "object") return field.display_value ?? field.value ?? null;
  return field;
}
function valueOf(field) {
  if (field == null) return null;
  if (typeof field === "object") return field.value ?? field.display_value ?? null;
  return field;
}

function fakeClients(o = {}) {
  return {
    PRIVILEGED_ROLES,
    SENSITIVE_TABLES,
    THRESHOLDS,
    displayOf,
    valueOf,
    listUsers: async () => o.users ?? [],
    listPrivilegedGrants: async () => o.grants ?? [],
    listGroups: async () => o.groups ?? [],
    listGroupMembers: async () => o.members ?? [],
    listSensitiveAcls: async () => o.acls ?? [],
    getProperty: async (name) => (o.props ? o.props[name] ?? null : null),
    listPasswordPolicies: async () => {
      if (o.passwordPolicies instanceof Error) throw o.passwordPolicies;
      return o.passwordPolicies ?? [];
    },
    listApiAccessPolicies: async () => {
      if (o.apiPolicies instanceof Error) throw o.apiPolicies;
      return o.apiPolicies ?? [];
    },
    latestAudit: async (table) => {
      if (o.audit instanceof Error) throw o.audit;
      return o.audit ? o.audit[table] ?? null : null;
    },
  };
}

describe("servicenow.user.no_inactive_privileged", () => {
  test("no grants → not_applicable", async () => {
    const r = await run("servicenow.user.no_inactive_privileged", {});
    expect(r[0].status).toBe("not_applicable");
  });

  test("fails for an inactive user who still holds an admin-tier role", async () => {
    const r = await run("servicenow.user.no_inactive_privileged", {
      users: [
        { sys_id: "u1", user_name: "ex.employee", active: "false" },
        { sys_id: "u2", user_name: "current", active: "true" },
      ],
      grants: [
        { user: dv("u1"), role: dv("r-admin", "admin") },
        { user: dv("u2"), role: dv("r-admin", "admin") },
      ],
    });
    expect(r).toHaveLength(1);
    expect(r[0]).toMatchObject({ resourceId: "u1", status: "fail" });
  });

  test("all privileged grants belong to active users → pass", async () => {
    const r = await run("servicenow.user.no_inactive_privileged", {
      users: [{ sys_id: "u2", user_name: "current", active: "true" }],
      grants: [{ user: dv("u2"), role: dv("r", "security_admin") }],
    });
    expect(r[0].status).toBe("pass");
  });
});

describe("servicenow.user.mfa_enforced", () => {
  test("enabled property → pass", async () => {
    const r = await run("servicenow.user.mfa_enforced", {
      props: { "glide.authenticate.multifactor.enabled": "true" },
    });
    expect(r[0].status).toBe("pass");
  });

  test("property present but false → fail", async () => {
    const r = await run("servicenow.user.mfa_enforced", {
      props: { "glide.authenticate.multifactor.enabled": "false" },
    });
    expect(r[0].status).toBe("fail");
    expect(r[0].message).toMatch(/present but not enabled/);
  });

  test("no property at all → fail with manual-attestation guidance", async () => {
    const r = await run("servicenow.user.mfa_enforced", {});
    expect(r[0].status).toBe("fail");
    expect(r[0].message).toMatch(/manually/);
  });
});

describe("servicenow.role.admin_count_within_policy", () => {
  test("count over threshold → fail", async () => {
    const n = THRESHOLDS.ADMIN_COUNT_THRESHOLD + 1;
    const users = Array.from({ length: n }, (_, i) => ({ sys_id: `u${i}`, user_name: `a${i}`, active: "true" }));
    const grants = users.map((u) => ({ user: dv(u.sys_id), role: dv("r", "admin") }));
    const r = await run("servicenow.role.admin_count_within_policy", { users, grants });
    expect(r[0].status).toBe("fail");
    expect(r[0].evidencePayload.details.activeAdminUsers).toBe(n);
  });

  test("inactive admins don't count → pass", async () => {
    const r = await run("servicenow.role.admin_count_within_policy", {
      users: [{ sys_id: "u1", user_name: "a", active: "false" }],
      grants: [{ user: dv("u1"), role: dv("r", "admin") }],
    });
    expect(r[0].status).toBe("pass");
    expect(r[0].evidencePayload.details.activeAdminUsers).toBe(0);
  });
});

describe("servicenow.group.privileged_groups_reviewed", () => {
  test("no privileged-looking group → not_applicable", async () => {
    const r = await run("servicenow.group.privileged_groups_reviewed", {
      groups: [{ sys_id: dv("g1"), name: dv("Service Desk"), description: dv(""), active: dv("true"), roles: dv("") }],
    });
    expect(r[0].status).toBe("not_applicable");
  });

  test("privileged group over the member threshold → fail", async () => {
    const over = THRESHOLDS.PRIVILEGED_GROUP_MEMBER_THRESHOLD + 1;
    const members = Array.from({ length: over }, (_, i) => ({ group: dv("g1"), user: dv(`u${i}`) }));
    const r = await run("servicenow.group.privileged_groups_reviewed", {
      groups: [
        { sys_id: dv("g1"), name: dv("Platform Admins"), description: dv("full admin"), active: dv("true"), roles: dv("admin"), sys_updated_on: dv(daysAgo(5)) },
      ],
      members,
    });
    expect(r[0].status).toBe("fail");
    expect(r[0].evidencePayload.details.memberCount).toBe(over);
  });
});

describe("servicenow.acl.default_deny_sensitive_tables", () => {
  test("no ACL rows returned → not_applicable (can't read sys_security_acl)", async () => {
    const r = await run("servicenow.acl.default_deny_sensitive_tables", { acls: [] });
    expect(r[0].status).toBe("not_applicable");
  });

  test("an open rule (active, no roles/script/condition) → fail", async () => {
    const acls = SENSITIVE_TABLES.map((t) => ({
      name: dv(t),
      operation: dv("read"),
      roles: dv(""),
      script: dv(""),
      condition: dv(""),
      active: dv("true"),
      admin_overrides: dv("true"),
    }));
    const r = await run("servicenow.acl.default_deny_sensitive_tables", { acls });
    expect(r.every((row) => row.status === "fail")).toBe(true);
    expect(r).toHaveLength(SENSITIVE_TABLES.length);
  });

  test("role-restricted rules on every table → pass", async () => {
    const acls = SENSITIVE_TABLES.map((t) => ({
      name: dv(t),
      operation: dv("read"),
      roles: dv("admin"),
      script: dv(""),
      condition: dv(""),
      active: dv("true"),
    }));
    const r = await run("servicenow.acl.default_deny_sensitive_tables", { acls });
    expect(r).toHaveLength(1);
    expect(r[0].status).toBe("pass");
  });
});

describe("servicenow.integrationuser.web_service_only", () => {
  test("service account without web_service_access_only → fail", async () => {
    const r = await run("servicenow.integrationuser.web_service_only", {
      users: [{ sys_id: "s1", user_name: "svc.integration", active: "true", web_service_access_only: "false" }],
    });
    expect(r[0]).toMatchObject({ resourceId: "s1", status: "fail" });
  });

  test("service account correctly restricted → pass", async () => {
    const r = await run("servicenow.integrationuser.web_service_only", {
      users: [{ sys_id: "s1", user_name: "svc.integration", active: "true", web_service_access_only: "true" }],
    });
    expect(r[0].status).toBe("pass");
  });

  test("no service-account-shaped users → not_applicable", async () => {
    const r = await run("servicenow.integrationuser.web_service_only", {
      users: [{ sys_id: "p1", user_name: "jane.doe", active: "true" }],
    });
    expect(r[0].status).toBe("not_applicable");
  });
});

describe("servicenow.password_policy.strength_enforced", () => {
  test("policy minimum length below baseline → fail", async () => {
    const r = await run("servicenow.password_policy.strength_enforced", {
      passwordPolicies: [{ name: dv("Default"), active: dv("true"), minimum_length: dv("6") }],
    });
    expect(r[0].status).toBe("fail");
  });

  test("policy minimum length meets baseline → pass", async () => {
    const r = await run("servicenow.password_policy.strength_enforced", {
      passwordPolicies: [{ name: dv("Default"), active: dv("true"), minimum_length: dv("12") }],
    });
    expect(r[0].status).toBe("pass");
  });

  test("no readable policy or property → not_applicable", async () => {
    const r = await run("servicenow.password_policy.strength_enforced", { passwordPolicies: new Error("boom 403") });
    expect(r[0].status).toBe("not_applicable");
  });
});

describe("servicenow.oauth.basic_auth_restricted", () => {
  test("an active REST API Access Policy → pass", async () => {
    const r = await run("servicenow.oauth.basic_auth_restricted", {
      apiPolicies: [{ name: dv("Block basic"), active: dv("true") }],
    });
    expect(r[0].status).toBe("pass");
  });

  test("no active policy → fail", async () => {
    const r = await run("servicenow.oauth.basic_auth_restricted", { apiPolicies: [] });
    expect(r[0].status).toBe("fail");
  });

  test("policy table not readable → not_applicable", async () => {
    const r = await run("servicenow.oauth.basic_auth_restricted", { apiPolicies: new Error("failed: 404") });
    expect(r[0].status).toBe("not_applicable");
  });
});

describe("servicenow.audit.field_audit_enabled", () => {
  test("no audit history for a table → fail row for that table", async () => {
    const r = await run("servicenow.audit.field_audit_enabled", {
      audit: { sys_user: { sys_created_on: daysAgo(3), fieldname: "active" } },
    });
    const userRow = r.find((row) => row.resourceId === "audit:sys_user");
    const aclRow = r.find((row) => row.resourceId === "audit:sys_security_acl");
    expect(userRow.status).toBe("pass");
    expect(aclRow.status).toBe("fail");
  });

  test("sys_audit not readable at all → single not_applicable", async () => {
    const r = await run("servicenow.audit.field_audit_enabled", { audit: new Error("Insufficient rights") });
    expect(r).toHaveLength(1);
    expect(r[0].status).toBe("not_applicable");
  });
});

describe("servicenow.audit.login_activity_logged", () => {
  test("a recent last_login_time → pass", async () => {
    const r = await run("servicenow.audit.login_activity_logged", {
      users: [{ sys_id: "u1", user_name: "a", active: "true", last_login_time: daysAgo(2) }],
    });
    expect(r[0].status).toBe("pass");
  });

  test("active users but no login timestamps anywhere → fail", async () => {
    const r = await run("servicenow.audit.login_activity_logged", {
      users: [{ sys_id: "u1", user_name: "a", active: "true" }],
    });
    expect(r[0].status).toBe("fail");
  });
});
