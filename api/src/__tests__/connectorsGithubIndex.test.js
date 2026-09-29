import { describe, test, expect, vi } from "vitest";

vi.mock("@octokit/auth-app", () => ({ createAppAuth: vi.fn((auth) => auth) }));

const orgsGet = vi.fn(async () => ({ data: { id: 555, two_factor_requirement_enabled: true, default_repository_permission: "read" } }));
const getPullRequestReviewProtection = vi.fn(async () => { throw Object.assign(new Error("not protected"), { status: 404 }); });
const checkVulnerabilityAlerts = vi.fn(async () => { throw Object.assign(new Error("disabled"), { status: 404 }); });
const reposGet = vi.fn(async () => ({ data: {} }));
const paginate = vi.fn(async () => []);
const getGithubActionsDefaultWorkflowPermissionsOrganization = vi.fn(async () => ({ data: { default_workflow_permissions: "read" } }));
const getGithubActionsPermissionsOrganization = vi.fn(async () => ({ data: { allowed_actions: "selected" } }));
const getDefaultSetup = vi.fn(async () => ({ data: { state: "configured" } }));

vi.mock("@octokit/rest", () => ({
  Octokit: vi.fn(function () {
    this.rest = {
      orgs: { get: orgsGet, listMembers: vi.fn() },
      repos: { getPullRequestReviewProtection, checkVulnerabilityAlerts, get: reposGet, listForOrg: vi.fn() },
      actions: { getGithubActionsDefaultWorkflowPermissionsOrganization, getGithubActionsPermissionsOrganization },
      codeScanning: { getDefaultSetup },
    };
    this.paginate = paginate;
  }),
}));

const { runTests, testConnection, tests } = await import("../connectors/github/index.js");

describe("runTests", () => {
  test("propagates each test's human-readable title alongside its key, and returns not_applicable when the org has no repos", async () => {
    const results = await runTests({
      authType: "oauth2",
      config: { installationId: 99, org: "acme" },
      secret: { appId: "1", privateKey: "pem" },
    });

    expect(results.length).toBe(9);
    for (const result of results) {
      const definition = tests.find((t) => t.key === result.testKey);
      expect(result.title).toBe(definition.title);
      expect(result.title).not.toBe(result.testKey);
    }

    const branchResult = results.find((r) => r.testKey === "github.repo.branch_protection_required_reviews");
    expect(branchResult.status).toBe("not_applicable");

    const twoFactorResult = results.find((r) => r.testKey === "github.org.two_factor_required");
    expect(twoFactorResult.status).toBe("pass");
  });
});

describe("testConnection", () => {
  test("resolves the org id as externalAccountId", async () => {
    const result = await testConnection({ authType: "oauth2", config: { installationId: 99, org: "acme" }, secret: { appId: "1", privateKey: "pem" } });
    expect(result).toEqual({ ok: true, externalAccountId: "555" });
    expect(orgsGet).toHaveBeenCalledWith({ org: "acme" });
  });

  test("surfaces a forbidden error with guidance about the App's installed permissions", async () => {
    orgsGet.mockRejectedValueOnce(Object.assign(new Error("Resource not accessible by integration"), { status: 403 }));
    await expect(
      testConnection({ authType: "oauth2", config: { installationId: 99, org: "acme" }, secret: { appId: "1", privateKey: "pem" } })
    ).rejects.toThrow(/Double-check the App's installed permissions/);
  });

  test("surfaces a not-found error with guidance about the org login and installation scope", async () => {
    orgsGet.mockRejectedValueOnce(Object.assign(new Error("Not Found"), { status: 404 }));
    await expect(
      testConnection({ authType: "oauth2", config: { installationId: 99, org: "acme" }, secret: { appId: "1", privateKey: "pem" } })
    ).rejects.toThrow(/Double-check the organization login/);
  });

  test("falls back to the raw error message for anything else", async () => {
    orgsGet.mockRejectedValueOnce(new Error("connect ETIMEDOUT"));
    await expect(
      testConnection({ authType: "oauth2", config: { installationId: 99, org: "acme" }, secret: { appId: "1", privateKey: "pem" } })
    ).rejects.toThrow("connect ETIMEDOUT");
  });
});
