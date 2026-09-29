import { describe, test, expect } from "vitest";
import { checkVulnerabilityAlertsEnabled, checkSecretScanningEnabled } from "../connectors/github/tests/security.js";

function notFoundError(message) {
  const err = new Error(message);
  err.status = 404;
  return err;
}

describe("checkVulnerabilityAlertsEnabled", () => {
  test("passes a repo with vulnerability alerts enabled (204)", async () => {
    const octokit = { rest: { repos: { checkVulnerabilityAlerts: async () => undefined } } };
    const results = await checkVulnerabilityAlertsEnabled(octokit, "acme", [{ name: "api", default_branch: "main" }]);
    expect(results).toEqual([{ resourceId: "acme/api", status: "pass", message: "api has Dependabot vulnerability alerts enabled", evidencePayload: { repo: "api" } }]);
  });

  test("fails a repo with vulnerability alerts disabled (404)", async () => {
    const octokit = { rest: { repos: { checkVulnerabilityAlerts: async () => { throw notFoundError("disabled"); } } } };
    const results = await checkVulnerabilityAlertsEnabled(octokit, "acme", [{ name: "web", default_branch: "main" }]);
    expect(results).toEqual([{ resourceId: "acme/web", status: "fail", message: "web does not have Dependabot vulnerability alerts enabled", evidencePayload: { repo: "web" } }]);
  });

  test("propagates a non-404 error", async () => {
    const octokit = { rest: { repos: { checkVulnerabilityAlerts: async () => { throw Object.assign(new Error("forbidden"), { status: 403 }); } } } };
    await expect(
      checkVulnerabilityAlertsEnabled(octokit, "acme", [{ name: "web", default_branch: "main" }])
    ).rejects.toThrow("forbidden");
  });

  test("returns not_applicable when the org has no repositories", async () => {
    const octokit = { rest: { repos: { checkVulnerabilityAlerts: async () => undefined } } };
    const results = await checkVulnerabilityAlertsEnabled(octokit, "acme", []);
    expect(results).toEqual([{ resourceId: "acme", status: "not_applicable", message: "No repositories found", evidencePayload: {} }]);
  });
});

describe("checkSecretScanningEnabled", () => {
  test("passes a repo with secret scanning enabled", async () => {
    const octokit = { rest: { repos: { get: async () => ({ data: { security_and_analysis: { secret_scanning: { status: "enabled" } } } }) } } };
    const results = await checkSecretScanningEnabled(octokit, "acme", [{ name: "api", default_branch: "main" }]);
    expect(results).toEqual([{ resourceId: "acme/api", status: "pass", message: "api has secret scanning enabled", evidencePayload: { repo: "api", secretScanningStatus: "enabled" } }]);
  });

  test("fails a repo with secret scanning explicitly disabled", async () => {
    const octokit = { rest: { repos: { get: async () => ({ data: { security_and_analysis: { secret_scanning: { status: "disabled" } } } }) } } };
    const results = await checkSecretScanningEnabled(octokit, "acme", [{ name: "web", default_branch: "main" }]);
    expect(results[0].status).toBe("fail");
  });

  test("returns not_applicable when security_and_analysis is entirely absent (no GHAS license)", async () => {
    const octokit = { rest: { repos: { get: async () => ({ data: { name: "legacy" } }) } } };
    const results = await checkSecretScanningEnabled(octokit, "acme", [{ name: "legacy", default_branch: "main" }]);
    expect(results).toEqual([{ resourceId: "acme/legacy", status: "not_applicable", message: "legacy does not have GitHub Advanced Security available to report secret scanning status", evidencePayload: { repo: "legacy" } }]);
  });

  test("returns not_applicable when the org has no repositories", async () => {
    const octokit = { rest: { repos: { get: async () => ({ data: {} }) } } };
    const results = await checkSecretScanningEnabled(octokit, "acme", []);
    expect(results).toEqual([{ resourceId: "acme", status: "not_applicable", message: "No repositories found", evidencePayload: {} }]);
  });
});
