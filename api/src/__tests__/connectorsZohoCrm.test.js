import { describe, test, expect, vi, beforeEach } from "vitest";
import { crmTests } from "../connectors/zoho/tests/crm.js";

const [mfaTest, sharingTest, auditLogTest] = crmTests;

function makeClients() {
  return { orgId: "60012345", crm: { get: vi.fn() } };
}

beforeEach(() => vi.clearAllMocks());

describe("zoho.crm.mfa_enforced", () => {
  test("returns pass when all active users have MFA enabled", async () => {
    const clients = makeClients();
    clients.crm.get.mockResolvedValueOnce({
      users: [
        { id: "1", email: "a@example.com", isTFAEnabled: true },
        { id: "2", email: "b@example.com", isTFAEnabled: true },
      ],
    });
    const results = await mfaTest.run(clients);
    expect(results).toHaveLength(1);
    expect(results[0].status).toBe("pass");
    expect(results[0].resourceId).toBe("60012345");
  });

  test("returns fail for each user without MFA", async () => {
    const clients = makeClients();
    clients.crm.get.mockResolvedValueOnce({
      users: [
        { id: "1", email: "a@example.com", isTFAEnabled: false },
        { id: "2", email: "b@example.com", isTFAEnabled: true },
      ],
    });
    const results = await mfaTest.run(clients);
    expect(results).toHaveLength(1);
    expect(results[0].status).toBe("fail");
    expect(results[0].resourceId).toBe("1");
  });

  test("accepts two_factor_auth_enabled as the alternate field name", async () => {
    const clients = makeClients();
    clients.crm.get.mockResolvedValueOnce({
      users: [{ id: "1", email: "a@example.com", two_factor_auth_enabled: true }],
    });
    const results = await mfaTest.run(clients);
    expect(results[0].status).toBe("pass");
  });

  test("returns pass when user list is empty", async () => {
    const clients = makeClients();
    clients.crm.get.mockResolvedValueOnce({ users: [] });
    const results = await mfaTest.run(clients);
    expect(results[0].status).toBe("pass");
  });
});

describe("zoho.crm.data_sharing_rules_restricted", () => {
  test("returns pass when no public read/write rules exist", async () => {
    const clients = makeClients();
    clients.crm.get.mockResolvedValueOnce({
      data_sharing: [{ id: "r1", module: "Leads", access: "Private" }],
    });
    const results = await sharingTest.run(clients);
    expect(results[0].status).toBe("pass");
  });

  test("returns fail for each rule with Public_ReadWrite access", async () => {
    const clients = makeClients();
    clients.crm.get.mockResolvedValueOnce({
      data_sharing: [{ id: "r1", module: "Contacts", access: "Public_ReadWrite" }],
    });
    const results = await sharingTest.run(clients);
    expect(results).toHaveLength(1);
    expect(results[0].status).toBe("fail");
    expect(results[0].resourceId).toBe("r1");
  });

  test("returns pass when sharing_rules list is empty", async () => {
    const clients = makeClients();
    clients.crm.get.mockResolvedValueOnce({ sharing_rules: [] });
    const results = await sharingTest.run(clients);
    expect(results[0].status).toBe("pass");
  });
});

describe("zoho.crm.audit_log_enabled", () => {
  test("returns pass when audit_log.enabled is true", async () => {
    const clients = makeClients();
    clients.crm.get.mockResolvedValueOnce({ audit_log: { enabled: true } });
    const results = await auditLogTest.run(clients);
    expect(results[0].status).toBe("pass");
  });

  test("returns pass when top-level enabled is true (alternate shape)", async () => {
    const clients = makeClients();
    clients.crm.get.mockResolvedValueOnce({ enabled: true });
    const results = await auditLogTest.run(clients);
    expect(results[0].status).toBe("pass");
  });

  test("returns fail when audit log is disabled", async () => {
    const clients = makeClients();
    clients.crm.get.mockResolvedValueOnce({ audit_log: { enabled: false } });
    const results = await auditLogTest.run(clients);
    expect(results[0].status).toBe("fail");
  });
});
