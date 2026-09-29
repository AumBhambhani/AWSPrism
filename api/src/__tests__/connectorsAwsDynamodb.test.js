import { describe, test, expect, vi } from "vitest";
import { ListTablesCommand, DescribeTableCommand, DescribeContinuousBackupsCommand } from "@aws-sdk/client-dynamodb";
import { checkDynamoDbPitrEnabled, checkDynamoDbEncryptionUsesCmk } from "../connectors/aws/tests/dynamodb.js";

const TABLE_ARN = "arn:aws:dynamodb:us-east-1:123456789012:table/sessions";

describe("checkDynamoDbPitrEnabled", () => {
  test("reports not_applicable with no tables", async () => {
    const dynamodb = { send: vi.fn(async () => ({ TableNames: [] })) };
    const results = await checkDynamoDbPitrEnabled(dynamodb);
    expect(results[0].status).toBe("not_applicable");
  });

  test("passes a table with PITR enabled", async () => {
    const dynamodb = {
      send: vi.fn(async (command) => {
        if (command instanceof ListTablesCommand) return { TableNames: ["sessions"] };
        if (command instanceof DescribeContinuousBackupsCommand) return {
          ContinuousBackupsDescription: { PointInTimeRecoveryDescription: { PointInTimeRecoveryStatus: "ENABLED" } },
        };
      }),
    };
    const results = await checkDynamoDbPitrEnabled(dynamodb);
    expect(results[0].status).toBe("pass");
  });

  test("fails a table with PITR disabled", async () => {
    const dynamodb = {
      send: vi.fn(async (command) => {
        if (command instanceof ListTablesCommand) return { TableNames: ["sessions"] };
        if (command instanceof DescribeContinuousBackupsCommand) return {
          ContinuousBackupsDescription: { PointInTimeRecoveryDescription: { PointInTimeRecoveryStatus: "DISABLED" } },
        };
      }),
    };
    const results = await checkDynamoDbPitrEnabled(dynamodb);
    expect(results[0].status).toBe("fail");
  });
});

describe("checkDynamoDbEncryptionUsesCmk", () => {
  test("reports not_applicable with no tables", async () => {
    const dynamodb = { send: vi.fn(async () => ({ TableNames: [] })) };
    const results = await checkDynamoDbEncryptionUsesCmk(dynamodb);
    expect(results[0].status).toBe("not_applicable");
  });

  test("passes a table encrypted with a customer-managed key", async () => {
    const dynamodb = {
      send: vi.fn(async (command) => {
        if (command instanceof ListTablesCommand) return { TableNames: ["sessions"] };
        if (command instanceof DescribeTableCommand) return {
          Table: { TableName: "sessions", TableArn: TABLE_ARN, SSEDescription: { Status: "ENABLED", SSEType: "KMS", KMSMasterKeyArn: "arn:aws:kms:us-east-1:123456789012:key/abc" } },
        };
      }),
    };
    const results = await checkDynamoDbEncryptionUsesCmk(dynamodb);
    expect(results[0].status).toBe("pass");
    expect(results[0].resourceId).toBe(TABLE_ARN);
  });

  test("fails a table using the default AWS-owned key", async () => {
    const dynamodb = {
      send: vi.fn(async (command) => {
        if (command instanceof ListTablesCommand) return { TableNames: ["sessions"] };
        if (command instanceof DescribeTableCommand) return {
          Table: { TableName: "sessions", TableArn: TABLE_ARN },
        };
      }),
    };
    const results = await checkDynamoDbEncryptionUsesCmk(dynamodb);
    expect(results[0].status).toBe("fail");
  });
});
