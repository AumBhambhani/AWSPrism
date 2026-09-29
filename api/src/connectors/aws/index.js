import { IAMClient } from "@aws-sdk/client-iam";
import { CloudTrailClient } from "@aws-sdk/client-cloudtrail";
import { ConfigServiceClient } from "@aws-sdk/client-config-service";
import { S3Client } from "@aws-sdk/client-s3";
import { EC2Client } from "@aws-sdk/client-ec2";
import { RDSClient } from "@aws-sdk/client-rds";
import { LambdaClient } from "@aws-sdk/client-lambda";
import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import { KMSClient } from "@aws-sdk/client-kms";
import { CloudWatchClient } from "@aws-sdk/client-cloudwatch";
import { CloudWatchLogsClient } from "@aws-sdk/client-cloudwatch-logs";
import { WAFV2Client } from "@aws-sdk/client-wafv2";
import { SecretsManagerClient } from "@aws-sdk/client-secrets-manager";
import { GuardDutyClient } from "@aws-sdk/client-guardduty";
import { SecurityHubClient } from "@aws-sdk/client-securityhub";
import { ECRClient } from "@aws-sdk/client-ecr";
import { ECSClient } from "@aws-sdk/client-ecs";
import { STSClient, GetCallerIdentityCommand } from "@aws-sdk/client-sts";
import { resolveAwsCredentials } from "./credentials.js";
import { iamTests } from "./tests/iam.js";
import { loggingTests } from "./tests/logging.js";
import { networkTests } from "./tests/network.js";
import { rdsTests } from "./tests/rds.js";
import { lambdaTests } from "./tests/lambda.js";
import { dynamodbTests } from "./tests/dynamodb.js";
import { kmsTests } from "./tests/kms.js";
import { configTests } from "./tests/config.js";
import { cloudwatchTests } from "./tests/cloudwatch.js";
import { wafTests } from "./tests/waf.js";
import { secretsManagerTests } from "./tests/secretsmanager.js";
import { guarddutyTests } from "./tests/guardduty.js";
import { securityHubTests } from "./tests/securityhub.js";
import { ecrTests } from "./tests/ecr.js";
import { ecsTests } from "./tests/ecs.js";

export const key = "aws";

export const tests = [
  ...iamTests,
  ...loggingTests,
  ...networkTests,
  ...rdsTests,
  ...lambdaTests,
  ...dynamodbTests,
  ...kmsTests,
  ...configTests,
  ...cloudwatchTests,
  ...wafTests,
  ...secretsManagerTests,
  ...guarddutyTests,
  ...securityHubTests,
  ...ecrTests,
  ...ecsTests,
];

function buildClients(credentials, region) {
  return {
    iam: new IAMClient({ credentials, region }),
    cloudtrail: new CloudTrailClient({ credentials, region }),
    configService: new ConfigServiceClient({ credentials, region }),
    s3: new S3Client({ credentials, region }),
    ec2: new EC2Client({ credentials, region }),
    rds: new RDSClient({ credentials, region }),
    lambda: new LambdaClient({ credentials, region }),
    dynamodb: new DynamoDBClient({ credentials, region }),
    kms: new KMSClient({ credentials, region }),
    cloudwatch: new CloudWatchClient({ credentials, region }),
    cloudwatchLogs: new CloudWatchLogsClient({ credentials, region }),
    wafRegional: new WAFV2Client({ credentials, region }),
    // wafCloudfront must always target us-east-1 regardless of the connection's configured region —
    // WAFv2 CLOUDFRONT-scoped API calls are only served by the us-east-1 endpoint.
    wafCloudfront: new WAFV2Client({ credentials, region: "us-east-1" }),
    secretsManager: new SecretsManagerClient({ credentials, region }),
    guardduty: new GuardDutyClient({ credentials, region }),
    securityHub: new SecurityHubClient({ credentials, region }),
    ecr: new ECRClient({ credentials, region }),
    ecs: new ECSClient({ credentials, region }),
  };
}

export async function testConnection({ authType, config, secret }) {
  const credentials = await resolveAwsCredentials({ authType, config, secret });
  const sts = new STSClient({ credentials, region: config.region || "us-east-1" });
  const identity = await sts.send(new GetCallerIdentityCommand({}));
  return { ok: true, externalAccountId: identity.Account };
}

export async function runTests({ authType, config, secret }) {
  const credentials = await resolveAwsCredentials({ authType, config, secret });
  const clients = buildClients(credentials, config.region || "us-east-1");
  const runResults = [];
  for (const test of tests) {
    try {
      const results = await test.run(clients);
      for (const result of results) {
        runResults.push({ testKey: test.key, title: test.title, failTitle: test.failTitle, severity: test.severityDefault, ...result });
      }
    } catch (err) {
      runResults.push({ testKey: test.key, title: test.title, failTitle: test.failTitle, severity: test.severityDefault, resourceId: "error", status: "error", message: err.message, evidencePayload: {} });
    }
  }
  return runResults;
}
