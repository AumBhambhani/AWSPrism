import { CloudWatchClient, DescribeAlarmsCommand } from "@aws-sdk/client-cloudwatch";
import { CloudWatchLogsClient, DescribeLogGroupsCommand } from "@aws-sdk/client-cloudwatch-logs";

export async function checkCloudWatchAlarmsConfigured(cloudwatch) {
  let alarms = [];
  let nextToken;
  do {
    const resp = await cloudwatch.send(new DescribeAlarmsCommand(nextToken ? { NextToken: nextToken } : {}));
    alarms = alarms.concat(resp.MetricAlarms || []).concat(resp.CompositeAlarms || []);
    nextToken = resp.NextToken;
  } while (nextToken);

  const pass = alarms.length > 0;
  return [{
    resourceId: "account",
    status: pass ? "pass" : "fail",
    message: pass
      ? `${alarms.length} CloudWatch alarm(s) are configured`
      : "No CloudWatch alarms are configured in this account/region",
    evidencePayload: { alarmCount: alarms.length },
  }];
}

export async function checkCloudWatchLogGroupRetention(cloudwatchLogs) {
  let logGroups = [];
  let nextToken;
  do {
    const resp = await cloudwatchLogs.send(new DescribeLogGroupsCommand(nextToken ? { nextToken } : {}));
    logGroups = logGroups.concat(resp.logGroups || []);
    nextToken = resp.nextToken;
  } while (nextToken);

  if (logGroups.length === 0) {
    return [{ resourceId: "account", status: "not_applicable", message: "No CloudWatch Logs log groups found", evidencePayload: {} }];
  }

  return logGroups.map((group) => {
    const pass = group.retentionInDays !== undefined && group.retentionInDays !== null;
    return {
      resourceId: group.logGroupName,
      status: pass ? "pass" : "fail",
      message: pass
        ? `${group.logGroupName} has a retention period of ${group.retentionInDays} days`
        : `${group.logGroupName} has no retention period set (Never expire)`,
      evidencePayload: { logGroupName: group.logGroupName, retentionInDays: group.retentionInDays ?? null },
    };
  });
}

export const cloudwatchTests = [
  { key: "aws.cloudwatch.alarms_configured", title: "CloudWatch alarms exist for account activity", failTitle: "No CloudWatch alarms are configured for account activity", severityDefault: "medium", isoReferences: ["A.12.4.1"], run: (clients) => checkCloudWatchAlarmsConfigured(clients.cloudwatch) },
  { key: "aws.cloudwatch.log_group_retention_configured", title: "CloudWatch Logs groups have a retention period set", failTitle: "CloudWatch Logs group has no retention period set", severityDefault: "medium", isoReferences: ["A.12.4.1"], run: (clients) => checkCloudWatchLogGroupRetention(clients.cloudwatchLogs) },
];
