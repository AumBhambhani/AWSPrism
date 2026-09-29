import { describe, test, expect, vi, beforeEach } from "vitest";
import { booksTests } from "../connectors/zoho/tests/books.js";

const [roleTest, tfaTest, auditTest] = booksTests;

function makeClients() {
  return { orgId: "60012345", books: { get: vi.fn() } };
}

beforeEach(() => vi.clearAllMocks());

describe("zoho.books.user_role_review", () => {
  test("returns pass when no non-owner users are assigned Admin role", async () => {
    const clients = makeClients();
    clients.books.get.mockResolvedValueOnce({
      users: [
        { user_id: "u1", email: "owner@example.com", role: "admin", is_org_owner: true },
        { user_id: "u2", email: "staff@example.com", role: "staff", is_org_owner: false },
      ],
    });
    const results = await roleTest.run(clients);
    expect(results[0].status).toBe("pass");
  });

  test("returns fail for a non-owner user assigned Admin role", async () => {
    const clients = makeClients();
    clients.books.get.mockResolvedValueOnce({
      users: [{ user_id: "u1", email: "other@example.com", role: "admin", is_org_owner: false }],
    });
    const results = await roleTest.run(clients);
    expect(results).toHaveLength(1);
    expect(results[0].status).toBe("fail");
    expect(results[0].resourceId).toBe("u1");
  });
});

describe("zoho.books.two_factor_auth_enforced", () => {
  test("returns pass when is_2fa_enabled is true under preferences", async () => {
    const clients = makeClients();
    clients.books.get.mockResolvedValueOnce({ preferences: { is_2fa_enabled: true } });
    const results = await tfaTest.run(clients);
    expect(results[0].status).toBe("pass");
  });

  test("returns pass when top-level is_2fa_enabled is true", async () => {
    const clients = makeClients();
    clients.books.get.mockResolvedValueOnce({ is_2fa_enabled: true });
    const results = await tfaTest.run(clients);
    expect(results[0].status).toBe("pass");
  });

  test("returns fail when 2FA is not enabled", async () => {
    const clients = makeClients();
    clients.books.get.mockResolvedValueOnce({ preferences: { is_2fa_enabled: false } });
    const results = await tfaTest.run(clients);
    expect(results[0].status).toBe("fail");
  });
});

describe("zoho.books.audit_trail_enabled", () => {
  test("returns pass when the audit trail endpoint returns a response", async () => {
    const clients = makeClients();
    clients.books.get.mockResolvedValueOnce({ audit_trail: [] });
    const results = await auditTest.run(clients);
    expect(results[0].status).toBe("pass");
  });

  test("returns fail when the response has an error flag", async () => {
    const clients = makeClients();
    clients.books.get.mockResolvedValueOnce({ error: "Audit trail not enabled" });
    const results = await auditTest.run(clients);
    expect(results[0].status).toBe("fail");
  });
});
