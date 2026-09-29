import { describe, test, expect } from "vitest";
import { checkNoClassicAdministrators, checkLimitedOwnerAssignments } from "../connectors/azure/tests/subscription.js";

function asyncIterable(items) {
  return { [Symbol.asyncIterator]: async function* () { for (const item of items) yield item; } };
}

const OWNER_ROLE_ID = "/subscriptions/sub-1/providers/Microsoft.Authorization/roleDefinitions/8e3af657-a8ff-443c-a75c-2fe8c4bcb635";

describe("checkNoClassicAdministrators", () => {
  test("passes when there are no classic administrators", async () => {
    const authorization = { classicAdministrators: { list: () => asyncIterable([]) } };
    const results = await checkNoClassicAdministrators(authorization);
    expect(results).toEqual([{ resourceId: "subscription", status: "pass", message: "No classic (co-)administrators are assigned", evidencePayload: {} }]);
  });

  test("fails when a classic administrator is assigned", async () => {
    const authorization = { classicAdministrators: { list: () => asyncIterable([{ emailAddress: "admin@example.com", role: "CoAdministrator" }]) } };
    const results = await checkNoClassicAdministrators(authorization);
    expect(results[0].status).toBe("fail");
    expect(results[0].evidencePayload.administrators).toEqual([{ email: "admin@example.com", role: "CoAdministrator" }]);
  });
});

describe("checkLimitedOwnerAssignments", () => {
  test("passes when at or below the recommended maximum", async () => {
    const authorization = {
      roleAssignments: {
        listForScope: () => asyncIterable([
          { roleDefinitionId: OWNER_ROLE_ID, principalId: "p1" },
          { roleDefinitionId: OWNER_ROLE_ID, principalId: "p2" },
        ]),
      },
    };
    const results = await checkLimitedOwnerAssignments(authorization, "sub-1");
    expect(results).toEqual([{ resourceId: "subscription", status: "pass", message: "2 principal(s) hold the Owner role at subscription scope", evidencePayload: { ownerCount: 2, maxRecommended: 2 } }]);
  });

  test("fails when exceeding the recommended maximum", async () => {
    const authorization = {
      roleAssignments: {
        listForScope: () => asyncIterable([
          { roleDefinitionId: OWNER_ROLE_ID, principalId: "p1" },
          { roleDefinitionId: OWNER_ROLE_ID, principalId: "p2" },
          { roleDefinitionId: OWNER_ROLE_ID, principalId: "p3" },
        ]),
      },
    };
    const results = await checkLimitedOwnerAssignments(authorization, "sub-1");
    expect(results[0].status).toBe("fail");
  });

  test("deduplicates repeated assignments to the same principal", async () => {
    const authorization = {
      roleAssignments: {
        listForScope: () => asyncIterable([
          { roleDefinitionId: OWNER_ROLE_ID, principalId: "p1" },
          { roleDefinitionId: OWNER_ROLE_ID, principalId: "p1" },
        ]),
      },
    };
    const results = await checkLimitedOwnerAssignments(authorization, "sub-1");
    expect(results[0].evidencePayload.ownerCount).toBe(1);
  });

  test("ignores non-Owner role assignments", async () => {
    const authorization = {
      roleAssignments: {
        listForScope: () => asyncIterable([
          { roleDefinitionId: "/subscriptions/sub-1/providers/Microsoft.Authorization/roleDefinitions/reader-role-id", principalId: "p1" },
        ]),
      },
    };
    const results = await checkLimitedOwnerAssignments(authorization, "sub-1");
    expect(results[0].evidencePayload.ownerCount).toBe(0);
    expect(results[0].status).toBe("pass");
  });
});
