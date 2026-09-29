import { describe, test, expect } from "vitest";
import { checkTwoStepVerificationEnforced } from "../connectors/google_workspace/tests/security.js";

function directoryWithUsers(users) {
  return { users: { list: async () => ({ data: { users } }) } };
}

describe("checkTwoStepVerificationEnforced", () => {
  test("flags each active user without 2SV enforced and passes the rest", async () => {
    const directory = directoryWithUsers([
      { primaryEmail: "a@acme.com", isEnforcedIn2Sv: true, suspended: false },
      { primaryEmail: "b@acme.com", isEnforcedIn2Sv: false, suspended: false },
      { primaryEmail: "suspended@acme.com", isEnforcedIn2Sv: false, suspended: true },
    ]);
    const results = await checkTwoStepVerificationEnforced(directory, "C0");
    expect(results).toHaveLength(2);
    expect(results.find((r) => r.resourceId === "a@acme.com").status).toBe("pass");
    expect(results.find((r) => r.resourceId === "b@acme.com").status).toBe("fail");
    expect(results.find((r) => r.resourceId === "suspended@acme.com")).toBeUndefined();
  });

  test("returns not_applicable when there are no active users", async () => {
    const directory = directoryWithUsers([{ primaryEmail: "s@acme.com", suspended: true }]);
    const results = await checkTwoStepVerificationEnforced(directory, "C0");
    expect(results).toEqual([{ resourceId: "domain", status: "not_applicable", message: "No active users found", evidencePayload: {} }]);
  });

  test("paginates across multiple pages", async () => {
    let call = 0;
    const directory = {
      users: {
        list: async () => {
          call += 1;
          if (call === 1) return { data: { users: [{ primaryEmail: "a@acme.com", isEnforcedIn2Sv: true, suspended: false }], nextPageToken: "p2" } };
          return { data: { users: [{ primaryEmail: "b@acme.com", isEnforcedIn2Sv: true, suspended: false }] } };
        },
      },
    };
    const results = await checkTwoStepVerificationEnforced(directory, "C0");
    expect(results.map((r) => r.resourceId).sort()).toEqual(["a@acme.com", "b@acme.com"]);
  });
});
