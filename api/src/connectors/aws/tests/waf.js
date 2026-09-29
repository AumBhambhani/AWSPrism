import { ListWebACLsCommand, GetWebACLCommand, ListResourcesForWebACLCommand, GetLoggingConfigurationCommand } from "@aws-sdk/client-wafv2";

async function listAllWebACLs(wafRegional, wafCloudfront) {
  const acls = [];
  for (const { client, scope } of [{ client: wafRegional, scope: "REGIONAL" }, { client: wafCloudfront, scope: "CLOUDFRONT" }]) {
    let nextMarker;
    do {
      const resp = await client.send(new ListWebACLsCommand({ Scope: scope, ...(nextMarker ? { NextMarker: nextMarker } : {}) }));
      for (const acl of resp.WebACLs || []) {
        acls.push({ ...acl, scope, client });
      }
      nextMarker = resp.NextMarker;
    } while (nextMarker);
  }
  return acls;
}

export async function checkWafWebAclAssociated(wafRegional, wafCloudfront) {
  const acls = await listAllWebACLs(wafRegional, wafCloudfront);
  if (acls.length === 0) {
    return [{ resourceId: "account", status: "fail", message: "No WAFv2 Web ACLs exist in this account/region", evidencePayload: {} }];
  }
  const results = [];
  for (const acl of acls) {
    const resources = await acl.client.send(new ListResourcesForWebACLCommand({ WebACLArn: acl.ARN }));
    const associatedResources = resources.ResourceArns || [];
    const pass = associatedResources.length > 0;
    results.push({
      resourceId: acl.ARN,
      status: pass ? "pass" : "fail",
      message: pass
        ? `Web ACL ${acl.Name} (${acl.scope}) is associated with ${associatedResources.length} resource(s)`
        : `Web ACL ${acl.Name} (${acl.scope}) is not associated with any resources`,
      evidencePayload: { name: acl.Name, scope: acl.scope, associatedResourceCount: associatedResources.length },
    });
  }
  return results;
}

export async function checkWafLoggingEnabled(wafRegional, wafCloudfront) {
  const acls = await listAllWebACLs(wafRegional, wafCloudfront);
  if (acls.length === 0) {
    return [{ resourceId: "account", status: "not_applicable", message: "No WAFv2 Web ACLs exist in this account/region", evidencePayload: {} }];
  }
  const results = [];
  for (const acl of acls) {
    let loggingEnabled = false;
    try {
      await acl.client.send(new GetLoggingConfigurationCommand({ ResourceArn: acl.ARN }));
      loggingEnabled = true;
    } catch (err) {
      // WAFNonexistentItemException means logging is not configured — treat as fail
      if (err.name !== "WAFNonexistentItemException") throw err;
    }
    results.push({
      resourceId: acl.ARN,
      status: loggingEnabled ? "pass" : "fail",
      message: loggingEnabled
        ? `Web ACL ${acl.Name} (${acl.scope}) has logging enabled`
        : `Web ACL ${acl.Name} (${acl.scope}) does not have logging enabled`,
      evidencePayload: { name: acl.Name, scope: acl.scope, loggingEnabled },
    });
  }
  return results;
}

export const wafTests = [
  { key: "aws.waf.web_acl_associated", title: "Internet-facing resources are protected by a WAF Web ACL", failTitle: "WAF Web ACL is not associated with any resources", severityDefault: "high", isoReferences: ["A.13.1.1"], run: (clients) => checkWafWebAclAssociated(clients.wafRegional, clients.wafCloudfront) },
  { key: "aws.waf.logging_enabled", title: "WAF Web ACLs have logging enabled", failTitle: "WAF Web ACL does not have logging enabled", severityDefault: "medium", isoReferences: ["A.12.4.1"], run: (clients) => checkWafLoggingEnabled(clients.wafRegional, clients.wafCloudfront) },
];
