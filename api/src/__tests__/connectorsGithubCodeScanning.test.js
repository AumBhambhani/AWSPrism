import { describe, test, expect } from "vitest";
import { checkCodeScanningDefaultSetupEnabled } from "../connectors/github/tests/codeScanning.js";

function notFoundError(message) {
  const err = new Error(message);
  err.status = 404;
  return err;
}

describe("checkCodeScanningDefaultSetupEnabled", () => {
  test("passes a repo with CodeQL default setup configured", async () => {
    const octokit = { rest: { codeScanning: { getDefaultSetup: async () => ({ data: { state: "configured" } }) } } };
    const results = await checkCodeScanningDefaultSetupEnabled(octokit, "acme", [{ name: "api" }]);
    expect(results).toEqual([{
      resourceId: "acme/api", status: "pass",
      message: "api has CodeQL default setup configured",
      evidencePayload: { repo: "api", codeScanningDefaultSetupState: "configured" },
    }]);
  });

  test("fails a repo with CodeQL default setup not configured", async () => {
    const octokit = { rest: { codeScanning: { getDefaultSetup: async () => ({ data: { state: "not-configured" } }) } } };
    const results = await checkCodeScanningDefaultSetupEnabled(octokit, "acme", [{ name: "web" }]);
    expect(results[0].status).toBe("fail");
  });

  test("returns not_applicable when code scanning is unavailable on the repo (404)", async () => {
    const octokit = { rest: { codeScanning: { getDefaultSetup: async () => { throw notFoundError("not found"); } } } };
    const results = await checkCodeScanningDefaultSetupEnabled(octokit, "acme", [{ name: "legacy" }]);
    expect(results).toEqual([{
      resourceId: "acme/legacy", status: "not_applicable",
      message: "legacy does not have code scanning available to report default setup status",
      evidencePayload: { repo: "legacy" },
    }]);
  });

  test("propagates a non-404 error", async () => {
    const octokit = { rest: { codeScanning: { getDefaultSetup: async () => { throw Object.assign(new Error("forbidden"), { status: 403 }); } } } };
    await expect(
      checkCodeScanningDefaultSetupEnabled(octokit, "acme", [{ name: "web" }])
    ).rejects.toThrow("forbidden");
  });

  test("returns not_applicable when the org has no repositories", async () => {
    const octokit = { rest: { codeScanning: { getDefaultSetup: async () => ({ data: { state: "configured" } }) } } };
    const results = await checkCodeScanningDefaultSetupEnabled(octokit, "acme", []);
    expect(results).toEqual([{ resourceId: "acme", status: "not_applicable", message: "No repositories found", evidencePayload: {} }]);
  });
});
