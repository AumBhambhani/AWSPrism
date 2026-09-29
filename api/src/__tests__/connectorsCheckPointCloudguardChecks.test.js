import { describe, expect, test } from "vitest";
import { THRESHOLDS, tests } from "../connectors/check_point_cloudguard/index.js";

const now = () => new Date().toISOString();
const daysAgo = (d) => new Date(Date.now() - d * 86_400_000).toISOString();

function healthyClients() {
  return {
    THRESHOLDS,
    listCloudAccounts: async () => [{ id: "a1", name: "prod-aws", credentialsProtocol: "Ec2" }],
    listAssessmentHistory: async () => [{ cloudAccountId: "a1", createdTime: now() }],
    listContinuousCompliancePolicies: async () => [{ targetId: "a1", rulesetId: -5 }],
    searchFindings: async () => [],
    listExclusions: async () => [],
  };
}

describe("Check Point CloudGuard checks", () => {
  test("all 6 posture checks pass for a healthy CloudGuard fixture", async () => {
    const clients = healthyClients();
    const rows = [];
    for (const definition of tests) rows.push(...(await definition.run(clients)));
    expect(rows).toHaveLength(6);
    expect(rows.filter((r) => r.status === "error")).toEqual([]);
    expect(rows.filter((r) => r.status === "fail")).toEqual([]);
    expect(rows.every((r) => r.evidencePayload?.details)).toBe(true);
  });

  test("an account with missing credentials is a finding", async () => {
    const clients = healthyClients();
    clients.listCloudAccounts = async () => [{ id: "a2", name: "stale", credentialsProtocol: "Missing" }];
    const rows = await tests.find((t) => t.key === "check_point_cloudguard.posture.accounts_fetching").run(clients);
    expect(rows[0].status).toBe("fail");
  });

  test("an account with no recent assessment is a finding", async () => {
    const clients = healthyClients();
    clients.listAssessmentHistory = async () => [{ cloudAccountId: "a1", createdTime: daysAgo(40) }];
    const rows = await tests.find((t) => t.key === "check_point_cloudguard.posture.assessment_recent").run(clients);
    expect(rows[0].status).toBe("fail");
  });

  test("an open critical finding is a finding row", async () => {
    const clients = healthyClients();
    clients.searchFindings = async () => [{ id: "f1", ruleName: "S3 public", severity: "Critical", status: "Open", entityName: "bucket", createdTime: daysAgo(20) }];
    const rows = await tests.find((t) => t.key === "check_point_cloudguard.posture.critical_findings_addressed").run(clients);
    expect(rows[0].status).toBe("fail");
  });

  test("a non-array CloudAccounts response is reported as error", async () => {
    const clients = healthyClients();
    clients.listCloudAccounts = async () => ({ message: "boom" });
    const rows = await tests.find((t) => t.key === "check_point_cloudguard.posture.accounts_fetching").run(clients);
    expect(rows[0].status).toBe("error");
  });
});
