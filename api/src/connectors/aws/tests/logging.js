import { DescribeTrailsCommand, GetTrailStatusCommand, GetEventSelectorsCommand } from "@aws-sdk/client-cloudtrail";
import { DescribeConfigurationRecordersCommand, DescribeConfigurationRecorderStatusCommand } from "@aws-sdk/client-config-service";

export async function checkCloudTrailEnabled(cloudtrail) {
  const { trailList } = await cloudtrail.send(new DescribeTrailsCommand({}));
  const trails = trailList || [];
  if (trails.length === 0) {
    return [{ resourceId: "account", status: "fail", message: "No CloudTrail trails are configured", evidencePayload: {} }];
  }
  const results = [];
  for (const trail of trails) {
    const status = await cloudtrail.send(new GetTrailStatusCommand({ Name: trail.TrailARN }));
    const pass = Boolean(status.IsLogging) && Boolean(trail.IsMultiRegionTrail);
    results.push({
      resourceId: trail.TrailARN,
      status: pass ? "pass" : "fail",
      message: pass
        ? `${trail.Name} is logging and multi-region`
        : `${trail.Name} is ${status.IsLogging ? "logging" : "not logging"} and ${trail.IsMultiRegionTrail ? "multi-region" : "single-region"}`,
      evidencePayload: { name: trail.Name, isLogging: status.IsLogging, isMultiRegionTrail: trail.IsMultiRegionTrail },
    });
  }
  return results;
}

export async function checkConfigEnabled(configService) {
  const { ConfigurationRecorders } = await configService.send(new DescribeConfigurationRecordersCommand({}));
  const recorders = ConfigurationRecorders || [];
  if (recorders.length === 0) {
    return [{ resourceId: "account", status: "fail", message: "No AWS Config recorder is configured", evidencePayload: {} }];
  }
  const { ConfigurationRecordersStatus } = await configService.send(new DescribeConfigurationRecorderStatusCommand({}));
  const results = [];
  for (const recorder of recorders) {
    const recorderStatus = (ConfigurationRecordersStatus || []).find((s) => s.name === recorder.name);
    const pass = Boolean(recorderStatus?.recording);
    results.push({
      resourceId: recorder.name,
      status: pass ? "pass" : "fail",
      message: pass ? `${recorder.name} is actively recording` : `${recorder.name} is not recording`,
      evidencePayload: { name: recorder.name, recording: Boolean(recorderStatus?.recording) },
    });
  }
  return results;
}

export async function checkCloudTrailLogFileValidation(cloudtrail) {
  const { trailList } = await cloudtrail.send(new DescribeTrailsCommand({}));
  const trails = trailList || [];
  if (trails.length === 0) {
    return [{ resourceId: "account", status: "fail", message: "No CloudTrail trails are configured", evidencePayload: {} }];
  }
  return trails.map((trail) => {
    const pass = Boolean(trail.LogFileValidationEnabled);
    return {
      resourceId: trail.TrailARN,
      status: pass ? "pass" : "fail",
      message: pass
        ? `${trail.Name} has log file validation enabled`
        : `${trail.Name} does not have log file validation enabled`,
      evidencePayload: { name: trail.Name, logFileValidationEnabled: Boolean(trail.LogFileValidationEnabled) },
    };
  });
}

export async function checkCloudTrailDataEventsLogged(cloudtrail) {
  const { trailList } = await cloudtrail.send(new DescribeTrailsCommand({}));
  const trails = trailList || [];
  if (trails.length === 0) {
    return [{ resourceId: "account", status: "fail", message: "No CloudTrail trails are configured", evidencePayload: {} }];
  }
  for (const trail of trails) {
    const resp = await cloudtrail.send(new GetEventSelectorsCommand({ TrailName: trail.TrailARN }));
    // Support both legacy EventSelectors and newer AdvancedEventSelectors
    const advanced = resp.AdvancedEventSelectors || [];
    const legacy = resp.EventSelectors || [];
    const hasAdvancedS3 = advanced.some((sel) =>
      (sel.FieldSelectors || []).some((f) => f.Field === "resources.type" && (f.Equals || []).includes("AWS::S3::Object"))
    );
    const hasAdvancedLambda = advanced.some((sel) =>
      (sel.FieldSelectors || []).some((f) => f.Field === "resources.type" && (f.Equals || []).includes("AWS::Lambda::Function"))
    );
    const hasLegacyS3 = legacy.some((sel) => sel.ReadWriteType && sel.DataResources && sel.DataResources.some((d) => d.Type === "AWS::S3::Object"));
    const hasLegacyLambda = legacy.some((sel) => sel.DataResources && sel.DataResources.some((d) => d.Type === "AWS::Lambda::Function"));
    if ((hasAdvancedS3 && hasAdvancedLambda) || (hasLegacyS3 && hasLegacyLambda)) {
      return [{ resourceId: trail.TrailARN, status: "pass", message: `${trail.Name} logs S3 and Lambda data events`, evidencePayload: { trailName: trail.Name, s3DataEvents: true, lambdaDataEvents: true } }];
    }
  }
  return [{ resourceId: "account", status: "fail", message: "No trail is configured to log S3 and Lambda data events", evidencePayload: { s3DataEvents: false, lambdaDataEvents: false } }];
}

export const loggingTests = [
  { key: "aws.logging.cloudtrail_enabled", title: "CloudTrail is enabled and multi-region", failTitle: "CloudTrail is not enabled and multi-region", severityDefault: "critical", isoReferences: ["A.12.4.1"], dpdpaControlAreas: ["Logging & Monitoring"], run: (clients) => checkCloudTrailEnabled(clients.cloudtrail) },
  { key: "aws.logging.config_enabled", title: "AWS Config is recording", failTitle: "AWS Config is not recording", severityDefault: "medium", isoReferences: ["A.12.1.1"], run: (clients) => checkConfigEnabled(clients.configService) },
  { key: "aws.cloudtrail.log_file_validation_enabled", title: "CloudTrail trails have log file validation enabled", failTitle: "CloudTrail trail does not have log file validation enabled", severityDefault: "high", isoReferences: ["A.12.4.2"], dpdpaControlAreas: ["Logging & Monitoring"], run: (clients) => checkCloudTrailLogFileValidation(clients.cloudtrail) },
  { key: "aws.cloudtrail.data_events_logged", title: "CloudTrail records data-plane events for S3 and Lambda", failTitle: "CloudTrail does not record data-plane events for S3 and Lambda", severityDefault: "medium", isoReferences: ["A.12.4.1"], dpdpaControlAreas: ["Logging & Monitoring"], run: (clients) => checkCloudTrailDataEventsLogged(clients.cloudtrail) },
];
