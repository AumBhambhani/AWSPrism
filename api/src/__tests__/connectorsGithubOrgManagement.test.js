import { describe, test, expect } from "vitest";
import { checkDefaultRepositoryPermissionRestricted, checkOwnersCountMinimized } from "../connectors/github/tests/orgManagement.js";

describe("checkDefaultRepositoryPermissionRestricted", () => {
  test("passes when the default repository permission is not admin", async () => {
    const octokit = { rest: { orgs: { get: async () => ({ data: { default_repository_permission: "read" } }) } } };
    const results = await checkDefaultRepositoryPermissionRestricted(octokit, "acme");
    expect(results).toEqual([{
      resourceId: "acme", status: "pass",
      message: `acme's default repository permission is "read", not admin`,
      evidencePayload: { org: "acme", defaultRepositoryPermission: "read" },
    }]);
  });

  test("fails when the default repository permission is admin", async () => {
    const octokit = { rest: { orgs: { get: async () => ({ data: { default_repository_permission: "admin" } }) } } };
    const results = await checkDefaultRepositoryPermissionRestricted(octokit, "acme");
    expect(results[0].status).toBe("fail");
  });

  test("returns not_applicable when the field is entirely absent", async () => {
    const octokit = { rest: { orgs: { get: async () => ({ data: {} }) } } };
    const results = await checkDefaultRepositoryPermissionRestricted(octokit, "acme");
    expect(results).toEqual([{
      resourceId: "acme", status: "not_applicable",
      message: "acme's default repository permission is not visible with this App's current permissions",
      evidencePayload: { org: "acme" },
    }]);
  });
});

describe("checkOwnersCountMinimized", () => {
  test("passes when owner count is within the threshold", async () => {
    const octokit = { paginate: async () => [{ login: "a" }, { login: "b" }], rest: { orgs: { listMembers: () => {} } } };
    const results = await checkOwnersCountMinimized(octokit, "acme");
    expect(results).toEqual([{
      resourceId: "acme", status: "pass",
      message: "acme has 2 organization owner(s), within the threshold of 5",
      evidencePayload: { org: "acme", ownerCount: 2, threshold: 5 },
    }]);
  });

  test("fails when owner count exceeds the threshold", async () => {
    const owners = Array.from({ length: 6 }, (_, i) => ({ login: `owner${i}` }));
    const octokit = { paginate: async () => owners, rest: { orgs: { listMembers: () => {} } } };
    const results = await checkOwnersCountMinimized(octokit, "acme");
    expect(results[0].status).toBe("fail");
    expect(results[0].evidencePayload).toEqual({ org: "acme", ownerCount: 6, threshold: 5 });
  });

  test("passes at exactly the threshold", async () => {
    const owners = Array.from({ length: 5 }, (_, i) => ({ login: `owner${i}` }));
    const octokit = { paginate: async () => owners, rest: { orgs: { listMembers: () => {} } } };
    const results = await checkOwnersCountMinimized(octokit, "acme");
    expect(results[0].status).toBe("pass");
  });
});
