import { describe, test, expect } from "vitest";
import { checkPrivilegedGroupMembershipReviewed } from "../connectors/google_workspace/tests/groups.js";

function directoryWith(groups, membersByGroup = {}) {
  return {
    groups: { list: async () => ({ data: { groups } }) },
    members: {
      list: async ({ groupKey }) => {
        const members = membersByGroup[groupKey];
        if (members === undefined) {
          const err = new Error("Not Found");
          err.code = 404;
          throw err;
        }
        return { data: { members } };
      },
    },
  };
}

describe("checkPrivilegedGroupMembershipReviewed", () => {
  test("passes when a privileged group has an OWNER-role member", async () => {
    const directory = directoryWith(
      [{ email: "admins@acme.com", name: "Admins" }],
      { "admins@acme.com": [{ email: "a@acme.com", role: "OWNER" }, { email: "b@acme.com", role: "MEMBER" }] }
    );
    const results = await checkPrivilegedGroupMembershipReviewed(directory, "C0");
    expect(results).toEqual([{
      resourceId: "admins@acme.com",
      status: "pass",
      message: "admins@acme.com has at least one OWNER-role member",
      evidencePayload: { email: "admins@acme.com", name: "Admins", memberCount: 2, roles: ["OWNER", "MEMBER"] },
    }]);
  });

  test("fails when a privileged group has no OWNER-role member", async () => {
    const directory = directoryWith(
      [{ email: "security@acme.com", name: "Security Team" }],
      { "security@acme.com": [{ email: "a@acme.com", role: "MEMBER" }] }
    );
    const results = await checkPrivilegedGroupMembershipReviewed(directory, "C0");
    expect(results[0].status).toBe("fail");
    expect(results[0].message).toContain("no OWNER-role member");
  });

  test("returns not_applicable when no group matches the privileged-name heuristic", async () => {
    const directory = directoryWith([{ email: "everyone@acme.com", name: "Everyone" }]);
    const results = await checkPrivilegedGroupMembershipReviewed(directory, "C0");
    expect(results).toEqual([{
      resourceId: "domain",
      status: "not_applicable",
      message: "No groups matched the privileged-group naming heuristic",
      evidencePayload: { totalGroups: 1 },
    }]);
  });

  test("treats a members.list 404 as an empty member list", async () => {
    const directory = directoryWith([{ email: "root@acme.com", name: "Root" }]);
    const results = await checkPrivilegedGroupMembershipReviewed(directory, "C0");
    expect(results[0].status).toBe("fail");
    expect(results[0].evidencePayload.memberCount).toBe(0);
  });
});
