export async function checkTwoFactorRequired(octokit, org) {
  const { data: orgData } = await octokit.rest.orgs.get({ org });

  // An absent field (undefined) means Prism's App permissions can't observe
  // this setting — not that the org failed to enforce it. Collapsing that
  // into "fail" would create a findings row asserting the org doesn't
  // enforce 2FA when Prism simply couldn't tell, on a critical-severity
  // check. Only an explicit true/false is a real pass/fail, same treatment
  // as checkSecretScanningEnabled's "entitlement not visible" case.
  if (orgData.two_factor_requirement_enabled === undefined) {
    return [{
      resourceId: org,
      status: "not_applicable",
      message: `${org}'s two-factor enforcement status is not visible with this App's current permissions`,
      evidencePayload: { org },
    }];
  }

  const enabled = orgData.two_factor_requirement_enabled === true;
  return [{
    resourceId: org,
    status: enabled ? "pass" : "fail",
    message: enabled
      ? `${org} requires two-factor authentication for all members`
      : `${org} does not require two-factor authentication for all members`,
    evidencePayload: { org, twoFactorRequirementEnabled: orgData.two_factor_requirement_enabled },
  }];
}

export async function checkBranchProtectionRequiredReviews(octokit, org, repos) {
  const results = [];
  for (const repo of repos) {
    try {
      const { data } = await octokit.rest.repos.getPullRequestReviewProtection({ owner: org, repo: repo.name, branch: repo.default_branch });
      const count = data.required_approving_review_count || 0;
      const enforced = count >= 1;
      results.push({
        resourceId: `${org}/${repo.name}`,
        status: enforced ? "pass" : "fail",
        message: enforced
          ? `${repo.name} requires ${count} approving review(s) on ${repo.default_branch}`
          : `${repo.name} does not require any approving reviews on ${repo.default_branch}`,
        evidencePayload: { repo: repo.name, branch: repo.default_branch, requiredApprovingReviewCount: count },
      });
    } catch (err) {
      // A 404 here specifically means "no branch protection rule at all" (verified
      // against the live REST reference during planning) — every other status is a
      // real failure (auth, rate limit, etc.) and must not be swallowed as "fail".
      if (err.status === 404) {
        results.push({
          resourceId: `${org}/${repo.name}`,
          status: "fail",
          message: `${repo.name} has no pull request review protection configured on ${repo.default_branch}`,
          evidencePayload: { repo: repo.name, branch: repo.default_branch },
        });
      } else {
        throw err;
      }
    }
  }
  if (results.length === 0) {
    results.push({ resourceId: org, status: "not_applicable", message: "No repositories found", evidencePayload: {} });
  }
  return results;
}

export const accessTests = [
  { key: "github.org.two_factor_required", title: "Organization requires two-factor authentication", failTitle: "Organization does not require two-factor authentication", severityDefault: "critical", isoReferences: ["A.9.4.2"], dpdpaControlAreas: ["MFA for Sensitive Systems"], run: (clients) => checkTwoFactorRequired(clients.octokit, clients.org) },
  { key: "github.repo.branch_protection_required_reviews", title: "Default branch requires pull request review before merging", failTitle: "Default branch does not require pull request review before merging", severityDefault: "high", isoReferences: ["A.14.2.2"], dpdpaControlAreas: ["Secure Development & API Security"], run: (clients) => checkBranchProtectionRequiredReviews(clients.octokit, clients.org, clients.repos) },
];
