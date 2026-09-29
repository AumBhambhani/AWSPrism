import { STSClient, AssumeRoleCommand } from "@aws-sdk/client-sts";

export async function resolveAwsCredentials({ authType, config, secret }) {
  if (authType === "access_key") {
    return {
      accessKeyId: secret.accessKeyId,
      secretAccessKey: secret.secretAccessKey,
      sessionToken: secret.sessionToken || undefined,
    };
  }

  if (authType === "iam_role") {
    const sts = new STSClient({ region: config.region || "us-east-1" });
    const result = await sts.send(new AssumeRoleCommand({
      RoleArn: config.roleArn,
      RoleSessionName: "prism-evidence-collection",
      ExternalId: secret.externalId,
      DurationSeconds: 3600,
    }));
    return {
      accessKeyId: result.Credentials.AccessKeyId,
      secretAccessKey: result.Credentials.SecretAccessKey,
      sessionToken: result.Credentials.SessionToken,
    };
  }

  throw new Error(`Unsupported AWS auth type: ${authType}`);
}
