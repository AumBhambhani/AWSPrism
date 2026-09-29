import { DescribeConfigRulesCommand, DescribeComplianceByConfigRuleCommand, DescribeConfigurationRecordersCommand } from "@aws-sdk/client-config-service";

export async function checkConfigRulesCompliant(configService) {
  let rules = [];
  let nextToken;
  do {
    const resp = await configService.send(new DescribeConfigRulesCommand(nextToken ? { NextToken: nextToken } : {}));
    rules = rules.concat(resp.ConfigRules || []);
    nextToken = resp.NextToken;
  } while (nextToken);

  if (rules.length === 0) {
    return [{ resourceId: "account", status: "not_applicable", message: "No AWS Config rules are configured", evidencePayload: {} }];
  }

  const ruleNames = rules.map((r) => r.ConfigRuleName);
  const { ComplianceByConfigRules } = await configService.send(new DescribeComplianceByConfigRuleCommand({ ConfigRuleNames: ruleNames }));
  return (ComplianceByConfigRules || []).map((entry) => {
    const complianceType = entry.Compliance?.ComplianceType;
    const pass = complianceType === "COMPLIANT" || complianceType === "NOT_APPLICABLE";
    return {
      resourceId: entry.ConfigRuleName,
      status: pass ? "pass" : "fail",
      message: pass
        ? `${entry.ConfigRuleName} is ${complianceType}`
        : `${entry.ConfigRuleName} is ${complianceType}`,
      evidencePayload: { configRuleName: entry.ConfigRuleName, complianceType },
    };
  });
}

export async function checkConfigAllResourceTypesRecorded(configService) {
  const { ConfigurationRecorders } = await configService.send(new DescribeConfigurationRecordersCommand({}));
  const recorders = ConfigurationRecorders || [];
  if (recorders.length === 0) {
    return [{ resourceId: "account", status: "fail", message: "No AWS Config recorder is configured", evidencePayload: {} }];
  }
  return recorders.map((recorder) => {
    const pass = Boolean(recorder.recordingGroup?.allSupported);
    return {
      resourceId: recorder.name,
      status: pass ? "pass" : "fail",
      message: pass
        ? `${recorder.name} records all supported resource types`
        : `${recorder.name} does not record all supported resource types (scoped subset only)`,
      evidencePayload: { name: recorder.name, allSupported: Boolean(recorder.recordingGroup?.allSupported) },
    };
  });
}

export const configTests = [
  { key: "aws.config.rules_compliant", title: "AWS Config rules report compliant resources", failTitle: "AWS Config rule reports non-compliant resources", severityDefault: "medium", isoReferences: ["A.12.1.2"], run: (clients) => checkConfigRulesCompliant(clients.configService) },
  { key: "aws.config.all_resource_types_recorded", title: "AWS Config recorder tracks all supported resource types", failTitle: "AWS Config recorder does not track all supported resource types", severityDefault: "medium", isoReferences: ["A.12.1.1"], run: (clients) => checkConfigAllResourceTypesRecorded(clients.configService) },
];
