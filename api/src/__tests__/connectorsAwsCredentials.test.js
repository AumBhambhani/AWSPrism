import { describe, test, expect, vi } from "vitest";

vi.mock("@aws-sdk/client-sts", () => {
  const send = vi.fn().mockResolvedValue({
    Credentials: {
      AccessKeyId: "ASIA-TEMP",
      SecretAccessKey: "temp-secret",
      SessionToken: "temp-token",
    },
  });
  return {
    STSClient: vi.fn(() => ({ send })),
    AssumeRoleCommand: vi.fn((input) => ({ input })),
  };
});

const { resolveAwsCredentials } = await import("../connectors/aws/credentials.js");

describe("resolveAwsCredentials", () => {
  test("returns static credentials for access_key auth", async () => {
    const credentials = await resolveAwsCredentials({
      authType: "access_key",
      config: {},
      secret: { accessKeyId: "AKIA123", secretAccessKey: "shh" },
    });
    expect(credentials).toEqual({ accessKeyId: "AKIA123", secretAccessKey: "shh", sessionToken: undefined });
  });

  test("assumes a role for iam_role auth", async () => {
    const credentials = await resolveAwsCredentials({
      authType: "iam_role",
      config: { roleArn: "arn:aws:iam::123456789012:role/PrismReadOnly", region: "us-east-1" },
      secret: { externalId: "ext-123" },
    });
    expect(credentials.accessKeyId).toBe("ASIA-TEMP");
    expect(credentials.sessionToken).toBe("temp-token");
  });

  test("throws for an unsupported auth type", async () => {
    await expect(
      resolveAwsCredentials({ authType: "oauth2", config: {}, secret: {} })
    ).rejects.toThrow("Unsupported AWS auth type: oauth2");
  });
});
