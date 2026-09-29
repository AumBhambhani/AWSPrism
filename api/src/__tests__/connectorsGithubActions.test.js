import { describe, test, expect } from "vitest";
import { checkActionsDefaultWorkflowPermissionsReadonly, checkActionsThirdPartyRestricted } from "../connectors/github/tests/actions.js";

describe("checkActionsDefaultWorkflowPermissionsReadonly", () => {
  test("passes when default workflow permissions are read-only", async () => {
    const octokit = { rest: { actions: { getGithubActionsDefaultWorkflowPermissionsOrganization: async () => ({ data: { default_workflow_permissions: "read" } }) } } };
    const results = await checkActionsDefaultWorkflowPermissionsReadonly(octokit, "acme");
    expect(results).toEqual([{
      resourceId: "acme", status: "pass",
      message: "acme's default Actions workflow token permissions are read-only",
      evidencePayload: { org: "acme", defaultWorkflowPermissions: "read" },
    }]);
  });

  test("fails when default workflow permissions are read-write", async () => {
    const octokit = { rest: { actions: { getGithubActionsDefaultWorkflowPermissionsOrganization: async () => ({ data: { default_workflow_permissions: "write" } }) } } };
    const results = await checkActionsDefaultWorkflowPermissionsReadonly(octokit, "acme");
    expect(results[0].status).toBe("fail");
  });

  test("returns not_applicable when the field is entirely absent", async () => {
    const octokit = { rest: { actions: { getGithubActionsDefaultWorkflowPermissionsOrganization: async () => ({ data: {} }) } } };
    const results = await checkActionsDefaultWorkflowPermissionsReadonly(octokit, "acme");
    expect(results[0].status).toBe("not_applicable");
  });
});

describe("checkActionsThirdPartyRestricted", () => {
  test("passes when actions are restricted to selected sources", async () => {
    const octokit = { rest: { actions: { getGithubActionsPermissionsOrganization: async () => ({ data: { allowed_actions: "selected" } }) } } };
    const results = await checkActionsThirdPartyRestricted(octokit, "acme");
    expect(results).toEqual([{
      resourceId: "acme", status: "pass",
      message: `acme restricts which Actions and reusable workflows can run (allowed_actions: "selected")`,
      evidencePayload: { org: "acme", allowedActions: "selected" },
    }]);
  });

  test("fails when all actions are allowed", async () => {
    const octokit = { rest: { actions: { getGithubActionsPermissionsOrganization: async () => ({ data: { allowed_actions: "all" } }) } } };
    const results = await checkActionsThirdPartyRestricted(octokit, "acme");
    expect(results[0].status).toBe("fail");
  });

  test("returns not_applicable when the field is entirely absent", async () => {
    const octokit = { rest: { actions: { getGithubActionsPermissionsOrganization: async () => ({ data: {} }) } } };
    const results = await checkActionsThirdPartyRestricted(octokit, "acme");
    expect(results[0].status).toBe("not_applicable");
  });
});
