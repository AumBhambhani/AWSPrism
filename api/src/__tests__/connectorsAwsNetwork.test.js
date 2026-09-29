import { describe, test, expect, vi } from "vitest";
import { ListBucketsCommand, GetPublicAccessBlockCommand } from "@aws-sdk/client-s3";
import { checkS3PublicAccessBlocked, checkSecurityGroupsNoOpenIngress } from "../connectors/aws/tests/network.js";

describe("checkS3PublicAccessBlocked", () => {
  test("reports not_applicable with no buckets", async () => {
    const s3 = { send: vi.fn(async () => ({ Buckets: [] })) };
    const results = await checkS3PublicAccessBlocked(s3);
    expect(results[0].status).toBe("not_applicable");
  });

  test("passes a bucket with all four blocks enabled", async () => {
    const s3 = {
      send: vi.fn(async (command) => {
        if (command instanceof ListBucketsCommand) return { Buckets: [{ Name: "prism-evidence" }] };
        if (command instanceof GetPublicAccessBlockCommand) return {
          PublicAccessBlockConfiguration: { BlockPublicAcls: true, BlockPublicPolicy: true, IgnorePublicAcls: true, RestrictPublicBuckets: true },
        };
      }),
    };
    const results = await checkS3PublicAccessBlocked(s3);
    expect(results[0].status).toBe("pass");
  });

  test("fails a bucket with no public access block configuration", async () => {
    const s3 = {
      send: vi.fn(async (command) => {
        if (command instanceof ListBucketsCommand) return { Buckets: [{ Name: "legacy-bucket" }] };
        if (command instanceof GetPublicAccessBlockCommand) { const err = new Error("none"); err.name = "NoSuchPublicAccessBlockConfiguration"; throw err; }
      }),
    };
    const results = await checkS3PublicAccessBlocked(s3);
    expect(results[0]).toEqual({ resourceId: "legacy-bucket", status: "fail", message: "legacy-bucket has no public access block configuration", evidencePayload: {} });
  });
});

describe("checkSecurityGroupsNoOpenIngress", () => {
  test("fails a group open to 0.0.0.0/0 on port 22", async () => {
    const ec2 = { send: vi.fn(async () => ({
      SecurityGroups: [{ GroupId: "sg-1", GroupName: "web", IpPermissions: [{ FromPort: 22, ToPort: 22, IpRanges: [{ CidrIp: "0.0.0.0/0" }] }] }],
    })) };
    const results = await checkSecurityGroupsNoOpenIngress(ec2);
    expect(results[0].status).toBe("fail");
  });

  test("passes a group restricted to a specific CIDR", async () => {
    const ec2 = { send: vi.fn(async () => ({
      SecurityGroups: [{ GroupId: "sg-2", GroupName: "internal", IpPermissions: [{ FromPort: 22, ToPort: 22, IpRanges: [{ CidrIp: "10.0.0.0/8" }] }] }],
    })) };
    const results = await checkSecurityGroupsNoOpenIngress(ec2);
    expect(results[0].status).toBe("pass");
  });

  test("passes a group open on an unrelated port", async () => {
    const ec2 = { send: vi.fn(async () => ({
      SecurityGroups: [{ GroupId: "sg-3", GroupName: "web", IpPermissions: [{ FromPort: 443, ToPort: 443, IpRanges: [{ CidrIp: "0.0.0.0/0" }] }] }],
    })) };
    const results = await checkSecurityGroupsNoOpenIngress(ec2);
    expect(results[0].status).toBe("pass");
  });
});
