import { ListBucketsCommand, GetPublicAccessBlockCommand, GetBucketEncryptionCommand, GetBucketLoggingCommand } from "@aws-sdk/client-s3";
import { DescribeSecurityGroupsCommand, GetEbsEncryptionByDefaultCommand, DescribeFlowLogsCommand, DescribeVpcsCommand } from "@aws-sdk/client-ec2";

export async function checkS3PublicAccessBlocked(s3) {
  const { Buckets } = await s3.send(new ListBucketsCommand({}));
  const buckets = Buckets || [];
  if (buckets.length === 0) {
    return [{ resourceId: "account", status: "not_applicable", message: "No S3 buckets found", evidencePayload: {} }];
  }
  const results = [];
  for (const bucket of buckets) {
    try {
      const { PublicAccessBlockConfiguration: config } = await s3.send(new GetPublicAccessBlockCommand({ Bucket: bucket.Name }));
      const pass = Boolean(
        config?.BlockPublicAcls && config?.BlockPublicPolicy &&
        config?.IgnorePublicAcls && config?.RestrictPublicBuckets
      );
      results.push({
        resourceId: bucket.Name,
        status: pass ? "pass" : "fail",
        message: pass ? `${bucket.Name} blocks all public access` : `${bucket.Name} does not fully block public access`,
        evidencePayload: config || {},
      });
    } catch (err) {
      if (err.name === "NoSuchPublicAccessBlockConfiguration") {
        results.push({ resourceId: bucket.Name, status: "fail", message: `${bucket.Name} has no public access block configuration`, evidencePayload: {} });
      } else {
        throw err;
      }
    }
  }
  return results;
}

const SENSITIVE_PORTS = [22, 3389];

function ruleExposesSensitivePort(perm) {
  const hasOpenCidr = (perm.IpRanges || []).some((r) => r.CidrIp === "0.0.0.0/0");
  if (!hasOpenCidr) return false;
  const from = perm.FromPort ?? 0;
  const to = perm.ToPort ?? 65535;
  return SENSITIVE_PORTS.some((port) => port >= from && port <= to);
}

export async function checkSecurityGroupsNoOpenIngress(ec2) {
  const { SecurityGroups } = await ec2.send(new DescribeSecurityGroupsCommand({}));
  const groups = SecurityGroups || [];
  const results = [];
  for (const group of groups) {
    const openRules = (group.IpPermissions || []).filter(ruleExposesSensitivePort);
    const pass = openRules.length === 0;
    results.push({
      resourceId: group.GroupId,
      status: pass ? "pass" : "fail",
      message: pass
        ? `${group.GroupId} does not expose SSH/RDP to 0.0.0.0/0`
        : `${group.GroupId} allows inbound SSH or RDP from 0.0.0.0/0`,
      evidencePayload: { groupId: group.GroupId, groupName: group.GroupName, openRuleCount: openRules.length },
    });
  }
  if (results.length === 0) {
    results.push({ resourceId: "account", status: "not_applicable", message: "No security groups found", evidencePayload: {} });
  }
  return results;
}

export async function checkEbsEncryptionByDefault(ec2) {
  const { EbsEncryptionByDefault } = await ec2.send(new GetEbsEncryptionByDefaultCommand({}));
  const pass = Boolean(EbsEncryptionByDefault);
  return [{
    resourceId: "account",
    status: pass ? "pass" : "fail",
    message: pass
      ? "EBS encryption by default is enabled for this region"
      : "EBS encryption by default is not enabled for this region",
    evidencePayload: { ebsEncryptionByDefault: pass },
  }];
}

export async function checkVpcFlowLogsEnabled(ec2) {
  const { Vpcs } = await ec2.send(new DescribeVpcsCommand({}));
  const vpcs = Vpcs || [];
  if (vpcs.length === 0) {
    return [{ resourceId: "account", status: "not_applicable", message: "No VPCs found", evidencePayload: {} }];
  }
  const { FlowLogs } = await ec2.send(new DescribeFlowLogsCommand({
    Filter: [{ Name: "resource-type", Values: ["VPC"] }],
  }));
  const vpcIdsWithLogs = new Set((FlowLogs || []).map(fl => fl.ResourceId));
  return vpcs.map(vpc => {
    const pass = vpcIdsWithLogs.has(vpc.VpcId);
    const name = (vpc.Tags || []).find(t => t.Key === "Name")?.Value || vpc.VpcId;
    return {
      resourceId: vpc.VpcId,
      status: pass ? "pass" : "fail",
      message: pass
        ? `VPC ${name} has flow logs enabled`
        : `VPC ${name} does not have flow logs enabled`,
      evidencePayload: { vpcId: vpc.VpcId, name, flowLogsEnabled: pass },
    };
  });
}

export async function checkS3BucketEncryption(s3) {
  const { Buckets } = await s3.send(new ListBucketsCommand({}));
  const buckets = Buckets || [];
  if (buckets.length === 0) {
    return [{ resourceId: "account", status: "not_applicable", message: "No S3 buckets found", evidencePayload: {} }];
  }
  const results = [];
  for (const bucket of buckets) {
    try {
      const { ServerSideEncryptionConfiguration: config } = await s3.send(new GetBucketEncryptionCommand({ Bucket: bucket.Name }));
      const rule = config?.Rules?.[0]?.ApplyServerSideEncryptionByDefault;
      const pass = Boolean(rule?.SSEAlgorithm);
      results.push({
        resourceId: bucket.Name,
        status: pass ? "pass" : "fail",
        message: pass
          ? `${bucket.Name} has server-side encryption enabled (${rule.SSEAlgorithm})`
          : `${bucket.Name} does not have server-side encryption configured`,
        evidencePayload: { bucket: bucket.Name, sseAlgorithm: rule?.SSEAlgorithm ?? null },
      });
    } catch (err) {
      if (err.name === "ServerSideEncryptionConfigurationNotFoundError") {
        results.push({ resourceId: bucket.Name, status: "fail", message: `${bucket.Name} has no server-side encryption configured`, evidencePayload: { bucket: bucket.Name } });
      } else {
        throw err;
      }
    }
  }
  return results;
}

export async function checkS3BucketAccessLogging(s3) {
  const { Buckets } = await s3.send(new ListBucketsCommand({}));
  const buckets = Buckets || [];
  if (buckets.length === 0) {
    return [{ resourceId: "account", status: "not_applicable", message: "No S3 buckets found", evidencePayload: {} }];
  }
  const results = [];
  for (const bucket of buckets) {
    const { LoggingEnabled } = await s3.send(new GetBucketLoggingCommand({ Bucket: bucket.Name }));
    const pass = Boolean(LoggingEnabled?.TargetBucket);
    results.push({
      resourceId: bucket.Name,
      status: pass ? "pass" : "fail",
      message: pass
        ? `${bucket.Name} has access logging enabled (target: ${LoggingEnabled.TargetBucket})`
        : `${bucket.Name} does not have access logging enabled`,
      evidencePayload: { bucket: bucket.Name, loggingEnabled: pass, targetBucket: LoggingEnabled?.TargetBucket ?? null },
    });
  }
  return results;
}

export const networkTests = [
  { key: "aws.network.s3_public_access_blocked", title: "S3 buckets block public access", failTitle: "S3 bucket does not block public access", severityDefault: "critical", isoReferences: ["A.8.2.3"], dpdpaControlAreas: ["Access Control & Least Privilege"], run: (clients) => checkS3PublicAccessBlocked(clients.s3) },
  { key: "aws.network.security_groups_no_open_ingress", title: "Security groups do not expose management ports publicly", failTitle: "Security group exposes management ports (SSH/RDP) publicly", severityDefault: "critical", isoReferences: ["A.13.1.1"], dpdpaControlAreas: ["Access Control & Least Privilege"], run: (clients) => checkSecurityGroupsNoOpenIngress(clients.ec2) },
  { key: "aws.ec2.ebs_encryption_by_default", title: "EBS encryption by default is enabled", failTitle: "EBS encryption by default is not enabled", severityDefault: "high", isoReferences: ["A.8.2.3"], dpdpaControlAreas: ["Encryption"], run: (clients) => checkEbsEncryptionByDefault(clients.ec2) },
  { key: "aws.vpc.flow_logs_enabled", title: "VPC flow logs are enabled for all VPCs", failTitle: "VPC does not have flow logs enabled", severityDefault: "medium", isoReferences: ["A.12.4.1"], dpdpaControlAreas: ["Logging & Monitoring"], run: (clients) => checkVpcFlowLogsEnabled(clients.ec2) },
  { key: "aws.s3.bucket_encryption_enabled", title: "S3 buckets have server-side encryption enabled", failTitle: "S3 bucket does not have server-side encryption enabled", severityDefault: "high", isoReferences: ["A.8.2.3"], dpdpaControlAreas: ["Encryption"], run: (clients) => checkS3BucketEncryption(clients.s3) },
  { key: "aws.s3.bucket_access_logging_enabled", title: "S3 buckets have access logging enabled", failTitle: "S3 bucket does not have access logging enabled", severityDefault: "medium", isoReferences: ["A.12.4.1"], run: (clients) => checkS3BucketAccessLogging(clients.s3) },
];
