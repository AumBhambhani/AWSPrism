import { describe, test, expect, vi } from "vitest";
import {
  checkRdsPubliclyAccessible,
  checkRdsStorageEncrypted,
  checkRdsAutomatedBackupsEnabled,
} from "../connectors/aws/tests/rds.js";

const instance = (overrides = {}) => ({
  DBInstanceIdentifier: "prod-db",
  DBInstanceArn: "arn:aws:rds:us-east-1:123456789012:db:prod-db",
  PubliclyAccessible: false,
  StorageEncrypted: true,
  BackupRetentionPeriod: 7,
  ...overrides,
});

describe("checkRdsPubliclyAccessible", () => {
  test("reports not_applicable with no instances", async () => {
    const rds = { send: vi.fn(async () => ({ DBInstances: [] })) };
    const results = await checkRdsPubliclyAccessible(rds);
    expect(results[0].status).toBe("not_applicable");
  });

  test("passes an instance that is not publicly accessible", async () => {
    const rds = { send: vi.fn(async () => ({ DBInstances: [instance()] })) };
    const results = await checkRdsPubliclyAccessible(rds);
    expect(results[0].status).toBe("pass");
    expect(results[0].resourceId).toBe("arn:aws:rds:us-east-1:123456789012:db:prod-db");
  });

  test("fails an instance that is publicly accessible", async () => {
    const rds = { send: vi.fn(async () => ({ DBInstances: [instance({ PubliclyAccessible: true })] })) };
    const results = await checkRdsPubliclyAccessible(rds);
    expect(results[0].status).toBe("fail");
  });
});

describe("checkRdsStorageEncrypted", () => {
  test("passes an encrypted instance", async () => {
    const rds = { send: vi.fn(async () => ({ DBInstances: [instance({ StorageEncrypted: true })] })) };
    const results = await checkRdsStorageEncrypted(rds);
    expect(results[0].status).toBe("pass");
  });

  test("fails an unencrypted instance", async () => {
    const rds = { send: vi.fn(async () => ({ DBInstances: [instance({ StorageEncrypted: false })] })) };
    const results = await checkRdsStorageEncrypted(rds);
    expect(results[0].status).toBe("fail");
  });

  test("reports not_applicable with no instances", async () => {
    const rds = { send: vi.fn(async () => ({ DBInstances: [] })) };
    const results = await checkRdsStorageEncrypted(rds);
    expect(results[0].status).toBe("not_applicable");
  });
});

describe("checkRdsAutomatedBackupsEnabled", () => {
  test("passes an instance with a positive retention period", async () => {
    const rds = { send: vi.fn(async () => ({ DBInstances: [instance({ BackupRetentionPeriod: 7 })] })) };
    const results = await checkRdsAutomatedBackupsEnabled(rds);
    expect(results[0].status).toBe("pass");
  });

  test("fails an instance with backups disabled (retention 0)", async () => {
    const rds = { send: vi.fn(async () => ({ DBInstances: [instance({ BackupRetentionPeriod: 0 })] })) };
    const results = await checkRdsAutomatedBackupsEnabled(rds);
    expect(results[0].status).toBe("fail");
  });

  test("reports not_applicable with no instances", async () => {
    const rds = { send: vi.fn(async () => ({ DBInstances: [] })) };
    const results = await checkRdsAutomatedBackupsEnabled(rds);
    expect(results[0].status).toBe("not_applicable");
  });
});
