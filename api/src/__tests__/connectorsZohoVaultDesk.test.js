import { describe, test, expect, vi, beforeEach } from "vitest";
import { vaultTests } from "../connectors/zoho/tests/vault.js";
import { deskTests } from "../connectors/zoho/tests/desk.js";

const [sharingPolicyTest, passwordPolicyTest, accessLogTest] = vaultTests;
const [agentRoleTest, piiFieldTest, ticketAccessTest] = deskTests;

function makeClients(extras = {}) {
  return {
    orgId: "60012345",
    vault: { get: vi.fn() },
    desk: { get: vi.fn() },
    ...extras,
  };
}

beforeEach(() => vi.clearAllMocks());

// ── Vault ─────────────────────────────────────────────────────────────────────

describe("zoho.vault.secret_sharing_policy", () => {
  test("returns pass when allowDirectSharing is false", async () => {
    const clients = makeClients();
    clients.vault.get.mockResolvedValueOnce({ SHARE: { allowDirectSharing: false } });
    const results = await sharingPolicyTest.run(clients);
    expect(results[0].status).toBe("pass");
  });

  test("returns pass when sharingType is chamber_only", async () => {
    const clients = makeClients();
    clients.vault.get.mockResolvedValueOnce({ sharing_policy: { sharingType: "chamber_only" } });
    const results = await sharingPolicyTest.run(clients);
    expect(results[0].status).toBe("pass");
  });

  test("returns fail when sharing is not restricted", async () => {
    const clients = makeClients();
    clients.vault.get.mockResolvedValueOnce({ SHARE: { allowDirectSharing: true } });
    const results = await sharingPolicyTest.run(clients);
    expect(results[0].status).toBe("fail");
  });
});

describe("zoho.vault.password_policy_strength", () => {
  test("returns pass when length >= 14 with all complexity flags", async () => {
    const clients = makeClients();
    clients.vault.get.mockResolvedValueOnce({
      PASSWORD: { minimumLength: 16, requireUpperCase: true, requireLowerCase: true, requireNumbers: true },
    });
    const results = await passwordPolicyTest.run(clients);
    expect(results[0].status).toBe("pass");
  });

  test("returns fail when length is below 14", async () => {
    const clients = makeClients();
    clients.vault.get.mockResolvedValueOnce({
      PASSWORD: { minimumLength: 8, requireUpperCase: true, requireLowerCase: true, requireNumbers: true },
    });
    const results = await passwordPolicyTest.run(clients);
    expect(results[0].status).toBe("fail");
  });

  test("returns fail when complexity flags are missing even with long length", async () => {
    const clients = makeClients();
    clients.vault.get.mockResolvedValueOnce({
      PASSWORD: { minimumLength: 20, requireUpperCase: false, requireLowerCase: true, requireNumbers: true },
    });
    const results = await passwordPolicyTest.run(clients);
    expect(results[0].status).toBe("fail");
  });
});

describe("zoho.vault.access_log_review", () => {
  test("returns pass when AUDIT.enabled is true", async () => {
    const clients = makeClients();
    clients.vault.get.mockResolvedValueOnce({ AUDIT: { enabled: true } });
    const results = await accessLogTest.run(clients);
    expect(results[0].status).toBe("pass");
  });

  test("returns pass when audit_enabled is true (alternate field)", async () => {
    const clients = makeClients();
    clients.vault.get.mockResolvedValueOnce({ audit_enabled: true });
    const results = await accessLogTest.run(clients);
    expect(results[0].status).toBe("pass");
  });

  test("returns fail when audit is disabled", async () => {
    const clients = makeClients();
    clients.vault.get.mockResolvedValueOnce({ AUDIT: { enabled: false } });
    const results = await accessLogTest.run(clients);
    expect(results[0].status).toBe("fail");
  });
});

// ── Desk ──────────────────────────────────────────────────────────────────────

describe("zoho.desk.agent_role_audit", () => {
  test("returns pass when no admin profiles are found", async () => {
    const clients = makeClients();
    // First call: profiles (none named administrator), no follow-up agent calls needed.
    clients.desk.get.mockResolvedValueOnce({ data: [{ id: "p1", name: "Support Agent", permissions: [] }] });
    const results = await agentRoleTest.run(clients);
    expect(results[0].status).toBe("pass");
  });

  test("returns fail for each agent in the administrator profile", async () => {
    const clients = makeClients();
    // profiles call returns one admin profile
    clients.desk.get
      .mockResolvedValueOnce({ data: [{ id: "p1", name: "Administrator" }] })
      // agents call for that profile
      .mockResolvedValueOnce({ data: [{ id: "a1", emailId: "admin@example.com" }] });
    const results = await agentRoleTest.run(clients);
    expect(results).toHaveLength(1);
    expect(results[0].status).toBe("fail");
    expect(results[0].resourceId).toBe("a1");
  });
});

describe("zoho.desk.customer_data_field_restricted", () => {
  test("returns not_applicable when no sensitive fields are found", async () => {
    const clients = makeClients();
    clients.desk.get.mockResolvedValueOnce({ data: [{ id: "f1", apiName: "subject", label: "Subject" }] });
    const results = await piiFieldTest.run(clients);
    expect(results[0].status).toBe("not_applicable");
  });

  test("returns fail for a sensitive field without profile restriction", async () => {
    const clients = makeClients();
    clients.desk.get.mockResolvedValueOnce({
      data: [{ id: "f1", apiName: "government_id", label: "Government ID", profileRestricted: false }],
    });
    const results = await piiFieldTest.run(clients);
    expect(results[0].status).toBe("fail");
    expect(results[0].resourceId).toBe("f1");
  });

  test("returns pass when all sensitive fields are profile-restricted", async () => {
    const clients = makeClients();
    clients.desk.get.mockResolvedValueOnce({
      data: [{ id: "f1", apiName: "government_id", label: "Government ID", profileRestricted: true }],
    });
    const results = await piiFieldTest.run(clients);
    expect(results[0].status).toBe("pass");
  });
});

describe("zoho.desk.ticket_access_control_enabled", () => {
  test("returns pass when departments exist", async () => {
    const clients = makeClients();
    clients.desk.get.mockResolvedValueOnce({ data: [{ id: "d1", name: "Support" }] });
    const results = await ticketAccessTest.run(clients);
    expect(results[0].status).toBe("pass");
  });

  test("returns fail when no active departments are found", async () => {
    const clients = makeClients();
    clients.desk.get.mockResolvedValueOnce({ data: [] });
    const results = await ticketAccessTest.run(clients);
    expect(results[0].status).toBe("fail");
  });
});
