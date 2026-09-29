import { ListDetectorsCommand, GetDetectorCommand, ListFindingsCommand } from "@aws-sdk/client-guardduty";

export async function checkGuardDutyEnabled(guardduty) {
  const { DetectorIds } = await guardduty.send(new ListDetectorsCommand({}));
  if (!DetectorIds || DetectorIds.length === 0) {
    return [{ resourceId: "account", status: "fail", message: "GuardDuty is not enabled — no detector found", evidencePayload: {} }];
  }
  const results = [];
  for (const detectorId of DetectorIds) {
    const detector = await guardduty.send(new GetDetectorCommand({ DetectorId: detectorId }));
    const pass = detector.Status === "ENABLED";
    results.push({
      resourceId: detectorId,
      status: pass ? "pass" : "fail",
      message: pass
        ? `GuardDuty detector ${detectorId} is ENABLED`
        : `GuardDuty detector ${detectorId} is ${detector.Status}`,
      evidencePayload: { detectorId, status: detector.Status },
    });
  }
  return results;
}

export async function checkGuardDutyHighSeverityFindingsResolved(guardduty) {
  const { DetectorIds } = await guardduty.send(new ListDetectorsCommand({}));
  if (!DetectorIds || DetectorIds.length === 0) {
    return [{ resourceId: "account", status: "fail", message: "GuardDuty is not enabled — no detector found", evidencePayload: {} }];
  }
  const results = [];
  for (const detectorId of DetectorIds) {
    let findingIds = [];
    let nextToken;
    do {
      const resp = await guardduty.send(new ListFindingsCommand({
        DetectorId: detectorId,
        FindingCriteria: { Criterion: { severity: { Gte: 7 } } },
        ...(nextToken ? { NextToken: nextToken } : {}),
      }));
      findingIds = findingIds.concat(resp.FindingIds || []);
      nextToken = resp.NextToken;
    } while (nextToken);

    const pass = findingIds.length === 0;
    results.push({
      resourceId: detectorId,
      status: pass ? "pass" : "fail",
      message: pass
        ? `No unresolved high-severity GuardDuty findings for detector ${detectorId}`
        : `${findingIds.length} unresolved high-severity GuardDuty finding(s) for detector ${detectorId}`,
      evidencePayload: { detectorId, highSeverityFindingCount: findingIds.length },
    });
  }
  return results;
}

export const guarddutyTests = [
  { key: "aws.guardduty.enabled", title: "GuardDuty is enabled", failTitle: "GuardDuty is not enabled", severityDefault: "critical", isoReferences: ["A.12.6.1"], dpdpaControlAreas: ["Vulnerability & Patch Management"], run: (clients) => checkGuardDutyEnabled(clients.guardduty) },
  { key: "aws.guardduty.high_severity_findings_resolved", title: "No unresolved high-severity GuardDuty findings", failTitle: "GuardDuty has unresolved high-severity findings", severityDefault: "high", isoReferences: ["A.16.1.2"], dpdpaControlAreas: ["Vulnerability & Patch Management"], run: (clients) => checkGuardDutyHighSeverityFindingsResolved(clients.guardduty) },
];
