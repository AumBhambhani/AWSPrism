import { DescribeHubCommand, GetEnabledStandardsCommand, GetFindingsCommand } from "@aws-sdk/client-securityhub";

export async function checkSecurityHubEnabled(securityHub) {
  try {
    await securityHub.send(new DescribeHubCommand({}));
  } catch (err) {
    // InvalidAccessException means Security Hub is not enabled in this region
    if (err.name === "InvalidAccessException") {
      return [{ resourceId: "account", status: "fail", message: "Security Hub is not enabled in this region", evidencePayload: {} }];
    }
    throw err;
  }

  const { StandardsSubscriptions } = await securityHub.send(new GetEnabledStandardsCommand({}));
  const readyStandards = (StandardsSubscriptions || []).filter((s) => s.StandardsStatus === "READY");
  const pass = readyStandards.length > 0;
  return [{
    resourceId: "account",
    status: pass ? "pass" : "fail",
    message: pass
      ? `Security Hub is enabled with ${readyStandards.length} READY standard(s)`
      : "Security Hub is enabled but no standards are in READY state",
    evidencePayload: { readyStandardCount: readyStandards.length, standards: readyStandards.map((s) => s.StandardsArn) },
  }];
}

export async function checkSecurityHubCriticalFindingsResolved(securityHub) {
  // Return not_applicable if Security Hub is not enabled
  try {
    await securityHub.send(new DescribeHubCommand({}));
  } catch (err) {
    if (err.name === "InvalidAccessException") {
      return [{ resourceId: "account", status: "not_applicable", message: "Security Hub is not enabled in this region", evidencePayload: {} }];
    }
    throw err;
  }

  let findings = [];
  let nextToken;
  do {
    const resp = await securityHub.send(new GetFindingsCommand({
      Filters: {
        SeverityLabel: [
          { Value: "CRITICAL", Comparison: "EQUALS" },
          { Value: "HIGH", Comparison: "EQUALS" },
        ],
        RecordState: [{ Value: "ACTIVE", Comparison: "EQUALS" }],
        WorkflowStatus: [{ Value: "NEW", Comparison: "EQUALS" }],
      },
      ...(nextToken ? { NextToken: nextToken } : {}),
    }));
    findings = findings.concat(resp.Findings || []);
    nextToken = resp.NextToken;
  } while (nextToken);

  const pass = findings.length === 0;
  return [{
    resourceId: "account",
    status: pass ? "pass" : "fail",
    message: pass
      ? "No active critical/high Security Hub findings"
      : `${findings.length} active critical/high Security Hub finding(s) with workflow status NEW`,
    evidencePayload: { activeCriticalHighFindingCount: findings.length },
  }];
}

export const securityHubTests = [
  { key: "aws.securityhub.enabled", title: "Security Hub is enabled with a standard subscribed", failTitle: "Security Hub is not enabled or has no standard subscribed", severityDefault: "high", isoReferences: ["A.12.6.1"], dpdpaControlAreas: ["Security Safeguards Program"], run: (clients) => checkSecurityHubEnabled(clients.securityHub) },
  { key: "aws.securityhub.critical_findings_resolved", title: "No active critical/high Security Hub findings", failTitle: "Security Hub has active critical/high findings", severityDefault: "high", isoReferences: ["A.16.1.2"], dpdpaControlAreas: ["Vulnerability & Patch Management"], run: (clients) => checkSecurityHubCriticalFindingsResolved(clients.securityHub) },
];
