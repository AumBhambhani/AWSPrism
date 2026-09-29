import { describe, test, expect, vi } from "vitest";
import { DescribeTrailsCommand, GetTrailStatusCommand } from "@aws-sdk/client-cloudtrail";
import { DescribeConfigurationRecordersCommand, DescribeConfigurationRecorderStatusCommand } from "@aws-sdk/client-config-service";
import { checkCloudTrailEnabled, checkConfigEnabled } from "../connectors/aws/tests/logging.js";

describe("checkCloudTrailEnabled", () => {
  test("fails when no trails exist", async () => {
    const cloudtrail = { send: vi.fn(async () => ({ trailList: [] })) };
    const results = await checkCloudTrailEnabled(cloudtrail);
    expect(results).toEqual([{ resourceId: "account", status: "fail", message: "No CloudTrail trails are configured", evidencePayload: {} }]);
  });

  test("passes a logging, multi-region trail", async () => {
    const cloudtrail = {
      send: vi.fn(async (command) => {
        if (command instanceof DescribeTrailsCommand) return { trailList: [{ Name: "org-trail", TrailARN: "arn:trail/org-trail", IsMultiRegionTrail: true }] };
        if (command instanceof GetTrailStatusCommand) return { IsLogging: true };
      }),
    };
    const results = await checkCloudTrailEnabled(cloudtrail);
    expect(results[0].status).toBe("pass");
  });

  test("fails a single-region trail", async () => {
    const cloudtrail = {
      send: vi.fn(async (command) => {
        if (command instanceof DescribeTrailsCommand) return { trailList: [{ Name: "local-trail", TrailARN: "arn:trail/local-trail", IsMultiRegionTrail: false }] };
        if (command instanceof GetTrailStatusCommand) return { IsLogging: true };
      }),
    };
    const results = await checkCloudTrailEnabled(cloudtrail);
    expect(results[0].status).toBe("fail");
  });
});

describe("checkConfigEnabled", () => {
  test("fails when no recorder is configured", async () => {
    const configService = { send: vi.fn(async () => ({ ConfigurationRecorders: [] })) };
    const results = await checkConfigEnabled(configService);
    expect(results[0].status).toBe("fail");
  });

  test("passes an actively recording recorder", async () => {
    const configService = {
      send: vi.fn(async (command) => {
        if (command instanceof DescribeConfigurationRecordersCommand) return { ConfigurationRecorders: [{ name: "default" }] };
        if (command instanceof DescribeConfigurationRecorderStatusCommand) return { ConfigurationRecordersStatus: [{ name: "default", recording: true }] };
      }),
    };
    const results = await checkConfigEnabled(configService);
    expect(results[0].status).toBe("pass");
  });
});
