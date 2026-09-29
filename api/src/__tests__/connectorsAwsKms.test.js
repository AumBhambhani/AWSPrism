import { describe, test, expect, vi } from "vitest";
import { ListKeysCommand, DescribeKeyCommand, GetKeyRotationStatusCommand, GetKeyPolicyCommand } from "@aws-sdk/client-kms";
import { checkKmsKeyRotationEnabled, checkKmsNoWildcardKeyPolicy } from "../connectors/aws/tests/kms.js";

const KEY_ID = "1234abcd-12ab-34cd-56ef-1234567890ab";
const customerManagedKey = (overrides = {}) => ({
  KeyId: KEY_ID,
  Arn: `arn:aws:kms:us-east-1:123456789012:key/${KEY_ID}`,
  KeyManager: "CUSTOMER",
  KeyState: "Enabled",
  KeySpec: "SYMMETRIC_DEFAULT",
  ...overrides,
});

describe("checkKmsKeyRotationEnabled", () => {
  test("reports not_applicable with no keys", async () => {
    const kms = { send: vi.fn(async () => ({ Keys: [] })) };
    const results = await checkKmsKeyRotationEnabled(kms);
    expect(results[0].status).toBe("not_applicable");
  });

  test("skips AWS-managed keys, reporting not_applicable if that's all there is", async () => {
    const kms = {
      send: vi.fn(async (command) => {
        if (command instanceof ListKeysCommand) return { Keys: [{ KeyId: KEY_ID }] };
        if (command instanceof DescribeKeyCommand) return { KeyMetadata: { KeyId: KEY_ID, KeyManager: "AWS" } };
      }),
    };
    const results = await checkKmsKeyRotationEnabled(kms);
    expect(results[0].status).toBe("not_applicable");
  });

  test("passes a customer-managed key with rotation enabled", async () => {
    const kms = {
      send: vi.fn(async (command) => {
        if (command instanceof ListKeysCommand) return { Keys: [{ KeyId: KEY_ID }] };
        if (command instanceof DescribeKeyCommand) return { KeyMetadata: customerManagedKey() };
        if (command instanceof GetKeyRotationStatusCommand) return { KeyRotationEnabled: true };
      }),
    };
    const results = await checkKmsKeyRotationEnabled(kms);
    expect(results[0].status).toBe("pass");
  });

  test("fails a customer-managed key with rotation disabled", async () => {
    const kms = {
      send: vi.fn(async (command) => {
        if (command instanceof ListKeysCommand) return { Keys: [{ KeyId: KEY_ID }] };
        if (command instanceof DescribeKeyCommand) return { KeyMetadata: customerManagedKey() };
        if (command instanceof GetKeyRotationStatusCommand) return { KeyRotationEnabled: false };
      }),
    };
    const results = await checkKmsKeyRotationEnabled(kms);
    expect(results[0].status).toBe("fail");
  });
});

describe("checkKmsNoWildcardKeyPolicy", () => {
  test("reports not_applicable with no keys", async () => {
    const kms = { send: vi.fn(async () => ({ Keys: [] })) };
    const results = await checkKmsNoWildcardKeyPolicy(kms);
    expect(results[0].status).toBe("not_applicable");
  });

  test("skips AWS-managed keys, reporting not_applicable if that's all there is", async () => {
    const kms = {
      send: vi.fn(async (command) => {
        if (command instanceof ListKeysCommand) return { Keys: [{ KeyId: KEY_ID }] };
        if (command instanceof DescribeKeyCommand) return { KeyMetadata: { KeyId: KEY_ID, KeyManager: "AWS" } };
      }),
    };
    const results = await checkKmsNoWildcardKeyPolicy(kms);
    expect(results[0].status).toBe("not_applicable");
  });

  test("fails a key policy granting kms:* to a wildcard principal", async () => {
    const policy = { Statement: [{ Effect: "Allow", Principal: "*", Action: "kms:*" }] };
    const kms = {
      send: vi.fn(async (command) => {
        if (command instanceof ListKeysCommand) return { Keys: [{ KeyId: KEY_ID }] };
        if (command instanceof DescribeKeyCommand) return { KeyMetadata: customerManagedKey() };
        if (command instanceof GetKeyPolicyCommand) return { Policy: JSON.stringify(policy) };
      }),
    };
    const results = await checkKmsNoWildcardKeyPolicy(kms);
    expect(results[0].status).toBe("fail");
  });

  test("passes a key policy scoped to the account root principal", async () => {
    const policy = {
      Statement: [{ Effect: "Allow", Principal: { AWS: "arn:aws:iam::123456789012:root" }, Action: "kms:*" }],
    };
    const kms = {
      send: vi.fn(async (command) => {
        if (command instanceof ListKeysCommand) return { Keys: [{ KeyId: KEY_ID }] };
        if (command instanceof DescribeKeyCommand) return { KeyMetadata: customerManagedKey() };
        if (command instanceof GetKeyPolicyCommand) return { Policy: JSON.stringify(policy) };
      }),
    };
    const results = await checkKmsNoWildcardKeyPolicy(kms);
    expect(results[0].status).toBe("pass");
  });
});
