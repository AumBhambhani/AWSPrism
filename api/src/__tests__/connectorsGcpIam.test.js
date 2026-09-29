import { describe, test, expect } from "vitest";
import { checkOwnerRoleAssignmentsLimited, checkServiceAccountKeysRotated } from "../connectors/gcp/tests/iam.js";

describe("checkOwnerRoleAssignmentsLimited", () => {
  test("passes when owner count is within the recommended maximum", async () => {
    const crm = { projects: { getIamPolicy: async () => ({ data: { bindings: [{ role: "roles/owner", members: ["user:a@acme.com", "user:b@acme.com"] }] } }) } };
    const results = await checkOwnerRoleAssignmentsLimited(crm, "my-project");
    expect(results[0].status).toBe("pass");
    expect(results[0].evidencePayload.ownerCount).toBe(2);
  });

  test("fails when owner count exceeds the recommended maximum", async () => {
    const members = Array.from({ length: 3 }, (_, i) => `user:o${i}@acme.com`);
    const crm = { projects: { getIamPolicy: async () => ({ data: { bindings: [{ role: "roles/owner", members }] } }) } };
    const results = await checkOwnerRoleAssignmentsLimited(crm, "my-project");
    expect(results[0].status).toBe("fail");
  });

  test("treats a missing roles/owner binding as zero owners (passing)", async () => {
    const crm = { projects: { getIamPolicy: async () => ({ data: { bindings: [] } }) } };
    const results = await checkOwnerRoleAssignmentsLimited(crm, "my-project");
    expect(results[0].status).toBe("pass");
    expect(results[0].evidencePayload.ownerCount).toBe(0);
  });
});

describe("checkServiceAccountKeysRotated", () => {
  function iamWith(accounts, keysByAccount) {
    return {
      projects: {
        serviceAccounts: {
          list: async () => ({ data: { accounts } }),
          keys: { list: async ({ name }) => ({ data: { keys: keysByAccount[name] || [] } }) },
        },
      },
    };
  }

  test("passes a key well within the rotation threshold", async () => {
    const recent = new Date(Date.now() - 5 * 24 * 60 * 60 * 1000).toISOString();
    const iam = iamWith(
      [{ name: "projects/p/serviceAccounts/svc@p.iam.gserviceaccount.com", email: "svc@p.iam.gserviceaccount.com" }],
      { "projects/p/serviceAccounts/svc@p.iam.gserviceaccount.com": [{ name: "key1", validAfterTime: recent }] }
    );
    const results = await checkServiceAccountKeysRotated(iam, "p");
    expect(results[0].status).toBe("pass");
  });

  test("fails a key older than the 90-day rotation threshold", async () => {
    const stale = new Date(Date.now() - 120 * 24 * 60 * 60 * 1000).toISOString();
    const iam = iamWith(
      [{ name: "projects/p/serviceAccounts/svc@p.iam.gserviceaccount.com", email: "svc@p.iam.gserviceaccount.com" }],
      { "projects/p/serviceAccounts/svc@p.iam.gserviceaccount.com": [{ name: "key1", validAfterTime: stale }] }
    );
    const results = await checkServiceAccountKeysRotated(iam, "p");
    expect(results[0].status).toBe("fail");
  });

  test("returns not_applicable when the project has no service accounts", async () => {
    const iam = iamWith([], {});
    const results = await checkServiceAccountKeysRotated(iam, "p");
    expect(results[0].status).toBe("not_applicable");
  });

  test("passes with no findings when no service account has a user-managed key", async () => {
    const iam = iamWith([{ name: "projects/p/serviceAccounts/svc@p.iam.gserviceaccount.com", email: "svc@p.iam.gserviceaccount.com" }], {});
    const results = await checkServiceAccountKeysRotated(iam, "p");
    expect(results[0].status).toBe("pass");
    expect(results[0].resourceId).toBe("p");
  });
});
