import { describe, test, expect } from "vitest";
import { checkInactiveAccountsReviewed } from "../connectors/google_workspace/tests/users.js";

function directoryWithUsers(users) {
  return { users: { list: async () => ({ data: { users } }) } };
}

describe("checkInactiveAccountsReviewed", () => {
  test("flags a suspended user as retained-but-suspended", async () => {
    const directory = directoryWithUsers([{ primaryEmail: "gone@acme.com", suspended: true, lastLoginTime: "2026-08-20T00:00:00.000Z" }]);
    const results = await checkInactiveAccountsReviewed(directory, "C0");
    expect(results).toEqual([{
      resourceId: "gone@acme.com", status: "fail",
      message: "gone@acme.com is suspended but not deleted, and retains a Workspace license/account",
      evidencePayload: { email: "gone@acme.com", suspended: true },
    }]);
  });

  test("flags a user who has never signed in", async () => {
    const directory = directoryWithUsers([{ primaryEmail: "new@acme.com", suspended: false, lastLoginTime: "1970-01-01T00:00:00.000Z" }]);
    const results = await checkInactiveAccountsReviewed(directory, "C0");
    expect(results[0].status).toBe("fail");
    expect(results[0].message).toBe("new@acme.com has never signed in");
  });

  test("flags a user inactive beyond the 90-day threshold", async () => {
    const staleDate = new Date(Date.now() - 120 * 24 * 60 * 60 * 1000).toISOString();
    const directory = directoryWithUsers([{ primaryEmail: "stale@acme.com", suspended: false, lastLoginTime: staleDate }]);
    const results = await checkInactiveAccountsReviewed(directory, "C0");
    expect(results[0].status).toBe("fail");
    expect(results[0].message).toContain("has not signed in for");
  });

  test("passes when all active users have recent sign-in activity", async () => {
    const recentDate = new Date(Date.now() - 5 * 24 * 60 * 60 * 1000).toISOString();
    const directory = directoryWithUsers([{ primaryEmail: "active@acme.com", suspended: false, lastLoginTime: recentDate }]);
    const results = await checkInactiveAccountsReviewed(directory, "C0");
    expect(results).toEqual([{
      resourceId: "domain", status: "pass",
      message: "All 1 user(s) are active and signed in within 90 days",
      evidencePayload: { userCount: 1 },
    }]);
  });

  test("returns not_applicable when there are no users", async () => {
    const directory = directoryWithUsers([]);
    const results = await checkInactiveAccountsReviewed(directory, "C0");
    expect(results[0].status).toBe("not_applicable");
  });
});
