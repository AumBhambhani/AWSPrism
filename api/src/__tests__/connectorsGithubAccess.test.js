import { describe, test, expect } from "vitest";
import { checkTwoFactorRequired, checkBranchProtectionRequiredReviews } from "../connectors/github/tests/access.js";

function notFoundError(message) {
  const err = new Error(message);
  err.status = 404;
  return err;
}

describe("checkTwoFactorRequired", () => {
  test("passes when the org requires two-factor authentication", async () => {
    const octokit = { rest: { orgs: { get: async () => ({ data: { id: 1, two_factor_requirement_enabled: true } }) } } };
    const results = await checkTwoFactorRequired(octokit, "acme");
    expect(results).toEqual([{
      resourceId: "acme", status: "pass",
      message: "acme requires two-factor authentication for all members",
      evidencePayload: { org: "acme", twoFactorRequirementEnabled: true },
    }]);
  });

  test("fails when the org does not require two-factor authentication", async () => {
    const octokit = { rest: { orgs: { get: async () => ({ data: { id: 1, two_factor_requirement_enabled: false } }) } } };
    const results = await checkTwoFactorRequired(octokit, "acme");
    expect(results[0].status).toBe("fail");
  });

  test("returns not_applicable when the field is entirely absent, instead of treating it as fail", async () => {
    const octokit = { rest: { orgs: { get: async () => ({ data: { id: 1 } }) } } };
    const results = await checkTwoFactorRequired(octokit, "acme");
    expect(results).toEqual([{
      resourceId: "acme", status: "not_applicable",
      message: "acme's two-factor enforcement status is not visible with this App's current permissions",
      evidencePayload: { org: "acme" },
    }]);
  });
});

describe("checkBranchProtectionRequiredReviews", () => {
  test("passes a repo whose default branch requires at least 1 approving review", async () => {
    const octokit = {
      rest: { repos: { getPullRequestReviewProtection: async () => ({ data: { required_approving_review_count: 2 } }) } },
    };
    const results = await checkBranchProtectionRequiredReviews(octokit, "acme", [{ name: "api", default_branch: "main" }]);
    expect(results).toEqual([{
      resourceId: "acme/api", status: "pass",
      message: "api requires 2 approving review(s) on main",
      evidencePayload: { repo: "api", branch: "main", requiredApprovingReviewCount: 2 },
    }]);
  });

  test("fails a repo whose review protection requires 0 approvals", async () => {
    const octokit = {
      rest: { repos: { getPullRequestReviewProtection: async () => ({ data: { required_approving_review_count: 0 } }) } },
    };
    const results = await checkBranchProtectionRequiredReviews(octokit, "acme", [{ name: "api", default_branch: "main" }]);
    expect(results[0].status).toBe("fail");
  });

  test("fails a repo with no branch protection configured at all (404)", async () => {
    const octokit = {
      rest: { repos: { getPullRequestReviewProtection: async () => { throw notFoundError("Branch not protected"); } } },
    };
    const results = await checkBranchProtectionRequiredReviews(octokit, "acme", [{ name: "web", default_branch: "main" }]);
    expect(results).toEqual([{
      resourceId: "acme/web", status: "fail",
      message: "web has no pull request review protection configured on main",
      evidencePayload: { repo: "web", branch: "main" },
    }]);
  });

  test("propagates a non-404 error instead of treating it as unprotected", async () => {
    const octokit = {
      rest: { repos: { getPullRequestReviewProtection: async () => { throw Object.assign(new Error("rate limited"), { status: 403 }); } } },
    };
    await expect(
      checkBranchProtectionRequiredReviews(octokit, "acme", [{ name: "web", default_branch: "main" }])
    ).rejects.toThrow("rate limited");
  });

  test("evaluates every repo independently", async () => {
    const octokit = {
      rest: {
        repos: {
          getPullRequestReviewProtection: async ({ repo }) =>
            repo === "api"
              ? { data: { required_approving_review_count: 1 } }
              : Promise.reject(notFoundError("Branch not protected")),
        },
      },
    };
    const results = await checkBranchProtectionRequiredReviews(octokit, "acme", [
      { name: "api", default_branch: "main" },
      { name: "web", default_branch: "main" },
    ]);
    expect(results.length).toBe(2);
    expect(results.find(r => r.evidencePayload.repo === "api").status).toBe("pass");
    expect(results.find(r => r.evidencePayload.repo === "web").status).toBe("fail");
  });

  test("returns not_applicable when the org has no repositories", async () => {
    const octokit = { rest: { repos: { getPullRequestReviewProtection: async () => { throw notFoundError("n/a"); } } } };
    const results = await checkBranchProtectionRequiredReviews(octokit, "acme", []);
    expect(results).toEqual([{ resourceId: "acme", status: "not_applicable", message: "No repositories found", evidencePayload: {} }]);
  });
});
