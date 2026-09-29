import { describe, test, expect, vi, beforeEach } from "vitest";
import { peopleTests } from "../connectors/zoho/tests/people.js";

const [dataAccessTest, sensitiveFieldTest, adminRoleTest] = peopleTests;

function makeClients() {
  return { orgId: "60012345", people: { get: vi.fn() } };
}

beforeEach(() => vi.clearAllMocks());

describe("zoho.people.data_access_review", () => {
  test("returns pass when no forms have all-employee access", async () => {
    const clients = makeClients();
    clients.people.get.mockResolvedValueOnce({
      response: { result: [{ formLinkName: "employee", displayName: "Employee", viewPermission: "role_based" }] },
    });
    const results = await dataAccessTest.run(clients);
    expect(results[0].status).toBe("pass");
  });

  test("returns fail for a form with viewPermission=all", async () => {
    const clients = makeClients();
    clients.people.get.mockResolvedValueOnce({
      forms: [{ formLinkName: "salary", displayName: "Salary", viewPermission: "all" }],
    });
    const results = await dataAccessTest.run(clients);
    expect(results[0].status).toBe("fail");
    expect(results[0].resourceId).toBe("salary");
  });

  test("returns pass when forms list is empty", async () => {
    const clients = makeClients();
    clients.people.get.mockResolvedValueOnce({ forms: [] });
    const results = await dataAccessTest.run(clients);
    expect(results[0].status).toBe("pass");
  });
});

describe("zoho.people.sensitive_field_encryption", () => {
  test("returns not_applicable when no sensitive forms exist", async () => {
    const clients = makeClients();
    clients.people.get.mockResolvedValueOnce({
      forms: [{ formLinkName: "attendance", displayName: "Attendance" }],
    });
    const results = await sensitiveFieldTest.run(clients);
    expect(results[0].status).toBe("not_applicable");
  });

  test("returns pass when sensitive form has field-level permissions", async () => {
    const clients = makeClients();
    clients.people.get.mockResolvedValueOnce({
      forms: [{ formLinkName: "bank", displayName: "Bank Details", hasFieldPermissions: true }],
    });
    const results = await sensitiveFieldTest.run(clients);
    expect(results[0].status).toBe("pass");
  });

  test("returns fail when sensitive form lacks field-level permissions", async () => {
    const clients = makeClients();
    clients.people.get.mockResolvedValueOnce({
      forms: [{ formLinkName: "salary", displayName: "Salary", hasFieldPermissions: false }],
    });
    const results = await sensitiveFieldTest.run(clients);
    expect(results[0].status).toBe("fail");
    expect(results[0].resourceId).toBe("salary");
  });
});

describe("zoho.people.admin_role_review", () => {
  test("returns pass when admin role has 3 or fewer users", async () => {
    const clients = makeClients();
    clients.people.get.mockResolvedValueOnce({
      response: { result: [{ roleName: "Admin", is_admin: true, userCount: 2 }] },
    });
    const results = await adminRoleTest.run(clients);
    expect(results[0].status).toBe("pass");
  });

  test("returns fail when admin role has more than 3 users", async () => {
    const clients = makeClients();
    clients.people.get.mockResolvedValueOnce({
      roles: [{ name: "Admin", is_admin: true, userCount: 7 }],
    });
    const results = await adminRoleTest.run(clients);
    expect(results[0].status).toBe("fail");
  });

  test("returns pass when no admin role is found", async () => {
    const clients = makeClients();
    clients.people.get.mockResolvedValueOnce({ roles: [{ name: "Employee", is_admin: false }] });
    const results = await adminRoleTest.run(clients);
    expect(results[0].status).toBe("pass");
  });
});
