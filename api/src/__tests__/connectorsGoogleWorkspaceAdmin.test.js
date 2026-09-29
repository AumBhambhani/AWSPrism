import { describe, test, expect } from "vitest";
import { checkSuperAdminRoleReviewed } from "../connectors/google_workspace/tests/admin.js";

function directoryWithUsers(users) {
  return { users: { list: async () => ({ data: { users } }) } };
}

describe("checkSuperAdminRoleReviewed", () => {
  test("passes when admin/delegated-admin count is within the expected maximum", async () => {
    const directory = directoryWithUsers([
      { primaryEmail: "admin1@acme.com", isAdmin: true, suspended: false },
      { primaryEmail: "delegate@acme.com", isDelegatedAdmin: true, suspended: false },
      { primaryEmail: "user@acme.com", suspended: false },
    ]);
    const results = await checkSuperAdminRoleReviewed(directory, "C0");
    expect(results).toEqual([{
      resourceId: "domain", status: "pass",
      message: "2 user(s) hold admin/delegated admin privileges, within the expected maximum of 5",
      evidencePayload: {
        adminCount: 2, maxExpected: 5,
        admins: [
          { email: "admin1@acme.com", isAdmin: true, isDelegatedAdmin: false },
          { email: "delegate@acme.com", isAdmin: false, isDelegatedAdmin: true },
        ],
      },
    }]);
  });

  test("fails when admin count exceeds the expected maximum", async () => {
    const users = Array.from({ length: 6 }, (_, i) => ({ primaryEmail: `admin${i}@acme.com`, isAdmin: true, suspended: false }));
    const directory = directoryWithUsers(users);
    const results = await checkSuperAdminRoleReviewed(directory, "C0");
    expect(results[0].status).toBe("fail");
    expect(results[0].evidencePayload.adminCount).toBe(6);
  });

  test("ignores suspended admins", async () => {
    const directory = directoryWithUsers([{ primaryEmail: "gone@acme.com", isAdmin: true, suspended: true }]);
    const results = await checkSuperAdminRoleReviewed(directory, "C0");
    expect(results[0].status).toBe("not_applicable");
  });
});
