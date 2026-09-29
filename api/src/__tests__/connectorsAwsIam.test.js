import { describe, test, expect, vi } from "vitest";
import {
  ListUsersCommand,
  ListMFADevicesCommand,
  ListAccessKeysCommand,
  GetAccountPasswordPolicyCommand,
} from "@aws-sdk/client-iam";
import { checkMfaEnforced, checkPasswordPolicy, checkAccessKeyAge } from "../connectors/aws/tests/iam.js";

function fakeIamClient(responses) {
  return {
    send: vi.fn(async (command) => {
      if (command instanceof ListUsersCommand) return responses.listUsers;
      if (command instanceof ListMFADevicesCommand) return responses.listMfaDevices(command.input.UserName);
      if (command instanceof ListAccessKeysCommand) return responses.listAccessKeys(command.input.UserName);
      if (command instanceof GetAccountPasswordPolicyCommand) return responses.passwordPolicy();
      throw new Error("Unhandled command in fake IAM client");
    }),
  };
}

describe("checkMfaEnforced", () => {
  test("fails a user with no MFA device", async () => {
    const iam = fakeIamClient({
      listUsers: { Users: [{ UserName: "alice", Arn: "arn:aws:iam::123:user/alice" }] },
      listMfaDevices: () => ({ MFADevices: [] }),
    });
    const results = await checkMfaEnforced(iam);
    expect(results).toEqual([{
      resourceId: "arn:aws:iam::123:user/alice",
      status: "fail",
      message: "alice has no MFA device registered",
      evidencePayload: { userName: "alice", mfaDeviceCount: 0 },
    }]);
  });

  test("passes a user with an MFA device", async () => {
    const iam = fakeIamClient({
      listUsers: { Users: [{ UserName: "bob", Arn: "arn:aws:iam::123:user/bob" }] },
      listMfaDevices: () => ({ MFADevices: [{ SerialNumber: "arn:aws:iam::123:mfa/bob" }] }),
    });
    const results = await checkMfaEnforced(iam);
    expect(results[0].status).toBe("pass");
  });

  test("reports not_applicable when there are no IAM users", async () => {
    const iam = fakeIamClient({ listUsers: { Users: [] }, listMfaDevices: () => ({ MFADevices: [] }) });
    const results = await checkMfaEnforced(iam);
    expect(results).toEqual([{ resourceId: "account", status: "not_applicable", message: "No IAM users found", evidencePayload: {} }]);
  });
});

describe("checkPasswordPolicy", () => {
  test("passes a policy meeting the minimum bar", async () => {
    const iam = fakeIamClient({
      passwordPolicy: () => ({
        PasswordPolicy: {
          MinimumPasswordLength: 14, RequireSymbols: true, RequireNumbers: true,
          RequireUppercaseCharacters: true, RequireLowercaseCharacters: true,
        },
      }),
    });
    const results = await checkPasswordPolicy(iam);
    expect(results[0].status).toBe("pass");
  });

  test("fails a policy below the minimum length", async () => {
    const iam = fakeIamClient({
      passwordPolicy: () => ({
        PasswordPolicy: {
          MinimumPasswordLength: 8, RequireSymbols: false, RequireNumbers: true,
          RequireUppercaseCharacters: true, RequireLowercaseCharacters: true,
        },
      }),
    });
    const results = await checkPasswordPolicy(iam);
    expect(results[0].status).toBe("fail");
  });

  test("fails when no password policy is configured", async () => {
    const iam = fakeIamClient({
      passwordPolicy: () => { const err = new Error("no policy"); err.name = "NoSuchEntityException"; throw err; },
    });
    const results = await checkPasswordPolicy(iam);
    expect(results[0]).toEqual({
      resourceId: "account-password-policy", status: "fail",
      message: "No account password policy is configured", evidencePayload: {},
    });
  });
});

describe("checkAccessKeyAge", () => {
  test("fails a key older than 90 days", async () => {
    const oldDate = new Date(Date.now() - 120 * 24 * 60 * 60 * 1000).toISOString();
    const iam = fakeIamClient({
      listUsers: { Users: [{ UserName: "carol" }] },
      listAccessKeys: () => ({ AccessKeyMetadata: [{ AccessKeyId: "AKIAOLD", Status: "Active", CreateDate: oldDate }] }),
    });
    const results = await checkAccessKeyAge(iam);
    expect(results[0].status).toBe("fail");
  });

  test("passes a key within 90 days", async () => {
    const recentDate = new Date(Date.now() - 10 * 24 * 60 * 60 * 1000).toISOString();
    const iam = fakeIamClient({
      listUsers: { Users: [{ UserName: "dave" }] },
      listAccessKeys: () => ({ AccessKeyMetadata: [{ AccessKeyId: "AKIANEW", Status: "Active", CreateDate: recentDate }] }),
    });
    const results = await checkAccessKeyAge(iam);
    expect(results[0].status).toBe("pass");
  });

  test("skips inactive keys", async () => {
    const iam = fakeIamClient({
      listUsers: { Users: [{ UserName: "erin" }] },
      listAccessKeys: () => ({ AccessKeyMetadata: [{ AccessKeyId: "AKIAOLD", Status: "Inactive", CreateDate: new Date().toISOString() }] }),
    });
    const results = await checkAccessKeyAge(iam);
    expect(results).toEqual([{ resourceId: "account", status: "not_applicable", message: "No active IAM access keys found", evidencePayload: {} }]);
  });
});
