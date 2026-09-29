import { ListTablesCommand, DescribeTableCommand, DescribeContinuousBackupsCommand } from "@aws-sdk/client-dynamodb";

async function listTableNames(dynamodb) {
  const { TableNames } = await dynamodb.send(new ListTablesCommand({}));
  return TableNames || [];
}

export async function checkDynamoDbPitrEnabled(dynamodb) {
  const tableNames = await listTableNames(dynamodb);
  if (tableNames.length === 0) {
    return [{ resourceId: "account", status: "not_applicable", message: "No DynamoDB tables found", evidencePayload: {} }];
  }
  const results = [];
  for (const tableName of tableNames) {
    const { ContinuousBackupsDescription } = await dynamodb.send(new DescribeContinuousBackupsCommand({ TableName: tableName }));
    const status = ContinuousBackupsDescription?.PointInTimeRecoveryDescription?.PointInTimeRecoveryStatus;
    const pass = status === "ENABLED";
    results.push({
      resourceId: tableName,
      status: pass ? "pass" : "fail",
      message: pass
        ? `${tableName} has point-in-time recovery enabled`
        : `${tableName} does not have point-in-time recovery enabled`,
      evidencePayload: { tableName, pointInTimeRecoveryStatus: status || "DISABLED" },
    });
  }
  return results;
}

export async function checkDynamoDbEncryptionUsesCmk(dynamodb) {
  const tableNames = await listTableNames(dynamodb);
  if (tableNames.length === 0) {
    return [{ resourceId: "account", status: "not_applicable", message: "No DynamoDB tables found", evidencePayload: {} }];
  }
  const results = [];
  for (const tableName of tableNames) {
    const { Table } = await dynamodb.send(new DescribeTableCommand({ TableName: tableName }));
    const sse = Table.SSEDescription;
    const pass = sse?.SSEType === "KMS";
    results.push({
      resourceId: Table.TableArn || tableName,
      status: pass ? "pass" : "fail",
      message: pass
        ? `${tableName} is encrypted with a customer-managed KMS key`
        : `${tableName} uses the default AWS-owned encryption key, not a customer-managed KMS key`,
      evidencePayload: { tableName, sseType: sse?.SSEType || "DEFAULT", kmsMasterKeyArn: sse?.KMSMasterKeyArn || null },
    });
  }
  return results;
}

export const dynamodbTests = [
  { key: "aws.dynamodb.point_in_time_recovery_enabled", title: "DynamoDB tables have point-in-time recovery enabled", failTitle: "DynamoDB table does not have point-in-time recovery enabled", severityDefault: "high", isoReferences: ["A.12.3.1"], dpdpaControlAreas: ["Backup & Recovery"], run: (clients) => checkDynamoDbPitrEnabled(clients.dynamodb) },
  { key: "aws.dynamodb.encryption_uses_cmk", title: "DynamoDB tables are encrypted with a customer-managed key", failTitle: "DynamoDB table is not encrypted with a customer-managed key", severityDefault: "medium", isoReferences: ["A.8.2.3"], run: (clients) => checkDynamoDbEncryptionUsesCmk(clients.dynamodb) },
];
