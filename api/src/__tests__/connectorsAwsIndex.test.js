import { describe, test, expect, vi } from "vitest";

const emptySend = vi.fn(async () => ({}));
const emptySendFactory = () => vi.fn(() => ({ send: emptySend }));

vi.mock("@aws-sdk/client-iam", async (importOriginal) => {
  const actual = await importOriginal();
  return {
    ...actual,
    IAMClient: vi.fn(() => ({
      send: vi.fn(async () => ({ Users: [], PasswordPolicy: {}, AccountSummary: {} })),
    })),
  };
});
vi.mock("@aws-sdk/client-cloudtrail", async (importOriginal) => {
  const actual = await importOriginal();
  return { ...actual, CloudTrailClient: vi.fn(() => ({ send: vi.fn(async () => ({ trailList: [], TrailList: [], eventSelectors: [] })) })) };
});
vi.mock("@aws-sdk/client-config-service", async (importOriginal) => {
  const actual = await importOriginal();
  return { ...actual, ConfigServiceClient: vi.fn(() => ({ send: vi.fn(async () => ({ ConfigRules: [], ComplianceByConfigRules: [], ConfigurationRecorders: [], ConfigurationRecordersStatus: [] })) })) };
});
vi.mock("@aws-sdk/client-s3", async (importOriginal) => {
  const actual = await importOriginal();
  return { ...actual, S3Client: vi.fn(() => ({ send: vi.fn(async () => ({ Buckets: [], PublicAccessBlockConfiguration: {}, ServerSideEncryptionConfiguration: {}, LoggingEnabled: {} })) })) };
});
vi.mock("@aws-sdk/client-ec2", async (importOriginal) => {
  const actual = await importOriginal();
  return { ...actual, EC2Client: vi.fn(() => ({ send: vi.fn(async () => ({ SecurityGroups: [], EbsEncryptionByDefault: true, FlowLogs: [], Vpcs: [] })) })) };
});
vi.mock("@aws-sdk/client-rds", async (importOriginal) => {
  const actual = await importOriginal();
  return { ...actual, RDSClient: vi.fn(() => ({ send: vi.fn(async () => ({ DBInstances: [] })) })) };
});
vi.mock("@aws-sdk/client-lambda", async (importOriginal) => {
  const actual = await importOriginal();
  return { ...actual, LambdaClient: vi.fn(() => ({ send: vi.fn(async () => ({ Functions: [] })) })) };
});
vi.mock("@aws-sdk/client-dynamodb", async (importOriginal) => {
  const actual = await importOriginal();
  return { ...actual, DynamoDBClient: vi.fn(() => ({ send: vi.fn(async () => ({ TableNames: [] })) })) };
});
vi.mock("@aws-sdk/client-kms", async (importOriginal) => {
  const actual = await importOriginal();
  return { ...actual, KMSClient: vi.fn(() => ({ send: vi.fn(async () => ({ Keys: [] })) })) };
});
vi.mock("@aws-sdk/client-ecr", async (importOriginal) => {
  const actual = await importOriginal();
  return { ...actual, ECRClient: vi.fn(() => ({ send: vi.fn(async () => ({ repositories: [] })) })) };
});
vi.mock("@aws-sdk/client-ecs", async (importOriginal) => {
  const actual = await importOriginal();
  return { ...actual, ECSClient: vi.fn(() => ({ send: vi.fn(async () => ({ clusterArns: [], taskDefinitionArns: [], clusters: [], taskDefinition: { containerDefinitions: [] } })) })) };
});
vi.mock("@aws-sdk/client-cloudwatch", async (importOriginal) => {
  const actual = await importOriginal();
  return {
    ...actual,
    CloudWatchClient: vi.fn(() => ({ send: vi.fn(async () => ({ MetricAlarms: [] })) })),
  };
});
vi.mock("@aws-sdk/client-cloudwatch-logs", async (importOriginal) => {
  const actual = await importOriginal();
  return {
    ...actual,
    CloudWatchLogsClient: vi.fn(() => ({ send: vi.fn(async () => ({ logGroups: [] })) })),
  };
});
vi.mock("@aws-sdk/client-guardduty", async (importOriginal) => {
  const actual = await importOriginal();
  return { ...actual, GuardDutyClient: vi.fn(() => ({ send: vi.fn(async () => ({ DetectorIds: [], findingIds: [], Findings: [] })) })) };
});
vi.mock("@aws-sdk/client-securityhub", async (importOriginal) => {
  const actual = await importOriginal();
  return { ...actual, SecurityHubClient: vi.fn(() => ({ send: vi.fn(async () => ({ Hub: {}, StandardsSubscriptions: [], Findings: [] })) })) };
});
vi.mock("@aws-sdk/client-secrets-manager", async (importOriginal) => {
  const actual = await importOriginal();
  return { ...actual, SecretsManagerClient: vi.fn(() => ({ send: vi.fn(async () => ({ SecretList: [] })) })) };
});
vi.mock("@aws-sdk/client-wafv2", async (importOriginal) => {
  const actual = await importOriginal();
  return { ...actual, WAFV2Client: vi.fn(() => ({ send: vi.fn(async () => ({ WebACLs: [], ResourceArns: [], LoggingConfiguration: {} })) })) };
});

const { runTests, tests } = await import("../connectors/aws/index.js");

describe("runTests", () => {
  // Timeout raised: AWS now has 45+ tests; the default 5s is not enough with all mocks in play.
  test("propagates each test's human-readable title alongside its key", { timeout: 30_000 }, async () => {
    const results = await runTests({
      authType: "access_key",
      config: {},
      secret: { accessKeyId: "AKIA123", secretAccessKey: "shh" },
    });

    expect(results.length).toBeGreaterThan(0);
    for (const result of results) {
      const definition = tests.find((t) => t.key === result.testKey);
      expect(result.title).toBe(definition.title);
      expect(result.title).not.toBe(result.testKey);
    }

    const s3Result = results.find((r) => r.testKey === "aws.network.s3_public_access_blocked");
    expect(s3Result.title).toBe("S3 buckets block public access");
  });

  // Findings are only ever created from a failing result, so a stale positive title
  // like "IAM users have MFA enabled" reads backwards on a finding. Every check must
  // define a failTitle so the Findings list describes what's actually wrong.
  test("every check defines a failTitle distinct from its (positive) title", () => {
    for (const definition of tests) {
      expect(definition.failTitle, `${definition.key} is missing a failTitle`).toBeTruthy();
      expect(definition.failTitle).not.toBe(definition.title);
    }
  });

  test("propagates each test's failTitle alongside its key", { timeout: 30_000 }, async () => {
    const results = await runTests({
      authType: "access_key",
      config: {},
      secret: { accessKeyId: "AKIA123", secretAccessKey: "shh" },
    });

    for (const result of results) {
      const definition = tests.find((t) => t.key === result.testKey);
      expect(result.failTitle).toBe(definition.failTitle);
    }

    const mfaResult = results.find((r) => r.testKey === "aws.iam.mfa_enforced");
    expect(mfaResult.failTitle).toBe("MFA is not enabled for this IAM user");
  });
});
