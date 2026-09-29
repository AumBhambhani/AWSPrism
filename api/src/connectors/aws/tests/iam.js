import {
  GetAccountPasswordPolicyCommand,
  ListUsersCommand,
  ListMFADevicesCommand,
  ListAccessKeysCommand,
  GenerateCredentialReportCommand,
  GetCredentialReportCommand,
  ListGroupsCommand,
  ListGroupPoliciesCommand,
  ListUserPoliciesCommand,
  ListAttachedUserPoliciesCommand,
  ListAttachedGroupPoliciesCommand,
} from "@aws-sdk/client-iam";

const MAX_ACCESS_KEY_AGE_DAYS = 90;

export async function checkMfaEnforced(iam) {
  const { Users } = await iam.send(new ListUsersCommand({}));
  const users = Users || [];
  const results = [];
  for (const user of users) {
    const { MFADevices } = await iam.send(new ListMFADevicesCommand({ UserName: user.UserName }));
    const hasMfa = (MFADevices || []).length > 0;
    results.push({
      resourceId: user.Arn,
      status: hasMfa ? "pass" : "fail",
      message: hasMfa
        ? `${user.UserName} has at least one MFA device registered`
        : `${user.UserName} has no MFA device registered`,
      evidencePayload: { userName: user.UserName, mfaDeviceCount: (MFADevices || []).length },
    });
  }
  if (results.length === 0) {
    results.push({ resourceId: "account", status: "not_applicable", message: "No IAM users found", evidencePayload: {} });
  }
  return results;
}

export async function checkPasswordPolicy(iam) {
  try {
    const { PasswordPolicy: policy } = await iam.send(new GetAccountPasswordPolicyCommand({}));
    const meetsBar =
      (policy.MinimumPasswordLength || 0) >= 14 &&
      policy.RequireSymbols &&
      policy.RequireNumbers &&
      policy.RequireUppercaseCharacters &&
      policy.RequireLowercaseCharacters;
    return [{
      resourceId: "account-password-policy",
      status: meetsBar ? "pass" : "fail",
      message: meetsBar
        ? "Account password policy meets minimum bar (14+ chars, mixed case, numbers, symbols)"
        : "Account password policy does not meet minimum bar",
      evidencePayload: policy,
    }];
  } catch (err) {
    if (err.name === "NoSuchEntityException") {
      return [{ resourceId: "account-password-policy", status: "fail", message: "No account password policy is configured", evidencePayload: {} }];
    }
    throw err;
  }
}

export async function checkAccessKeyAge(iam) {
  const { Users } = await iam.send(new ListUsersCommand({}));
  const users = Users || [];
  const results = [];
  for (const user of users) {
    const { AccessKeyMetadata } = await iam.send(new ListAccessKeysCommand({ UserName: user.UserName }));
    for (const key of AccessKeyMetadata || []) {
      if (key.Status !== "Active") continue;
      const ageDays = Math.floor((Date.now() - new Date(key.CreateDate).getTime()) / (1000 * 60 * 60 * 24));
      const pass = ageDays <= MAX_ACCESS_KEY_AGE_DAYS;
      results.push({
        resourceId: key.AccessKeyId,
        status: pass ? "pass" : "fail",
        message: pass
          ? `Access key ${key.AccessKeyId} is ${ageDays} days old (within ${MAX_ACCESS_KEY_AGE_DAYS}-day limit)`
          : `Access key ${key.AccessKeyId} is ${ageDays} days old, exceeding the ${MAX_ACCESS_KEY_AGE_DAYS}-day rotation limit`,
        evidencePayload: { userName: user.UserName, accessKeyId: key.AccessKeyId, ageDays },
      });
    }
  }
  if (results.length === 0) {
    results.push({ resourceId: "account", status: "not_applicable", message: "No active IAM access keys found", evidencePayload: {} });
  }
  return results;
}

export async function checkNoRootAccessKeys(iam) {
  // The credential report is the only reliable source for root account key status
  try {
    await iam.send(new GenerateCredentialReportCommand({}));
  } catch (_) { /* already generating — proceed */ }

  let report;
  for (let attempts = 0; attempts < 5; attempts++) {
    try {
      const { Content, State } = await iam.send(new GetCredentialReportCommand({}));
      if (State === "COMPLETE") { report = Buffer.from(Content).toString("utf8"); break; }
    } catch (err) {
      if (err.name !== "ReportNotPresent" && err.name !== "ReportInProgress") throw err;
    }
    await new Promise(r => setTimeout(r, 2000));
  }
  if (!report) {
    return [{ resourceId: "account", status: "error", message: "Credential report not ready after retries", evidencePayload: {} }];
  }

  const lines = report.split("\n");
  const headers = lines[0].split(",");
  const col = (row, name) => row[headers.indexOf(name)];

  for (const line of lines.slice(1)) {
    const row = line.split(",");
    if (col(row, "user") !== "<root_account>") continue;
    const hasKey1 = col(row, "access_key_1_active") === "true";
    const hasKey2 = col(row, "access_key_2_active") === "true";
    const pass = !hasKey1 && !hasKey2;
    return [{
      resourceId: "root",
      status: pass ? "pass" : "fail",
      message: pass
        ? "Root account has no active access keys"
        : "Root account has active access keys — this is a critical security risk",
      evidencePayload: { accessKey1Active: hasKey1, accessKey2Active: hasKey2 },
    }];
  }
  return [{ resourceId: "root", status: "pass", message: "Root account has no active access keys", evidencePayload: {} }];
}

export async function checkNoInlinePolicies(iam) {
  const { Users } = await iam.send(new ListUsersCommand({}));
  const results = [];

  for (const user of Users || []) {
    const { PolicyNames } = await iam.send(new ListUserPoliciesCommand({ UserName: user.UserName }));
    if ((PolicyNames || []).length > 0) {
      results.push({
        resourceId: user.Arn,
        status: "fail",
        message: `IAM user ${user.UserName} has ${PolicyNames.length} inline polic(ies): ${PolicyNames.join(", ")}`,
        evidencePayload: { userName: user.UserName, inlinePolicies: PolicyNames },
      });
    }
  }

  const { Groups } = await iam.send(new ListGroupsCommand({}));
  for (const group of Groups || []) {
    const { PolicyNames } = await iam.send(new ListGroupPoliciesCommand({ GroupName: group.GroupName }));
    if ((PolicyNames || []).length > 0) {
      results.push({
        resourceId: group.Arn,
        status: "fail",
        message: `IAM group ${group.GroupName} has ${PolicyNames.length} inline polic(ies): ${PolicyNames.join(", ")}`,
        evidencePayload: { groupName: group.GroupName, inlinePolicies: PolicyNames },
      });
    }
  }

  if (results.length === 0) {
    return [{ resourceId: "account", status: "pass", message: "No IAM users or groups have inline policies", evidencePayload: {} }];
  }
  return results;
}

export async function checkNoOverlyBroadManagedPolicies(iam) {
  const { Users } = await iam.send(new ListUsersCommand({}));
  const { Groups } = await iam.send(new ListGroupsCommand({}));
  const flagged = [];

  // Check well-known AWS-managed admin policies — sufficient for the 95% case
  const ADMIN_POLICY_ARNS = new Set([
    "arn:aws:iam::aws:policy/AdministratorAccess",
    "arn:aws:iam::aws:policy/PowerUserAccess",
  ]);

  for (const user of Users || []) {
    const { AttachedPolicies } = await iam.send(new ListAttachedUserPoliciesCommand({ UserName: user.UserName }));
    const adminPolicies = (AttachedPolicies || []).filter(p => ADMIN_POLICY_ARNS.has(p.PolicyArn));
    if (adminPolicies.length > 0) {
      flagged.push({ resourceArn: user.Arn, resourceName: user.UserName, resourceType: "user", policies: adminPolicies.map(p => p.PolicyName) });
    }
  }
  for (const group of Groups || []) {
    const { AttachedPolicies } = await iam.send(new ListAttachedGroupPoliciesCommand({ GroupName: group.GroupName }));
    const adminPolicies = (AttachedPolicies || []).filter(p => ADMIN_POLICY_ARNS.has(p.PolicyArn));
    if (adminPolicies.length > 0) {
      flagged.push({ resourceArn: group.Arn, resourceName: group.GroupName, resourceType: "group", policies: adminPolicies.map(p => p.PolicyName) });
    }
  }

  if (flagged.length === 0) {
    return [{ resourceId: "account", status: "pass", message: "No IAM users or groups have AdministratorAccess or PowerUserAccess attached", evidencePayload: {} }];
  }
  return flagged.map(f => ({
    resourceId: f.resourceArn,
    status: "fail",
    message: `IAM ${f.resourceType} ${f.resourceName} has overly broad managed polic(ies) attached: ${f.policies.join(", ")}`,
    evidencePayload: { resourceName: f.resourceName, resourceType: f.resourceType, policies: f.policies },
  }));
}

export const iamTests = [
  { key: "aws.iam.mfa_enforced", title: "IAM users have MFA enabled", failTitle: "MFA is not enabled for this IAM user", severityDefault: "critical", isoReferences: ["A.9.4.2"], dpdpaControlAreas: ["MFA for Sensitive Systems"], run: (clients) => checkMfaEnforced(clients.iam) },
  { key: "aws.iam.password_policy", title: "Account password policy meets minimum strength", failTitle: "Account password policy does not meet minimum strength requirements", severityDefault: "high", isoReferences: ["A.9.4.3"], dpdpaControlAreas: ["MFA for Sensitive Systems"], run: (clients) => checkPasswordPolicy(clients.iam) },
  { key: "aws.iam.access_key_age", title: "IAM access keys are rotated within 90 days", failTitle: "IAM access key has not been rotated within 90 days", severityDefault: "high", isoReferences: ["A.9.2.4"], run: (clients) => checkAccessKeyAge(clients.iam) },
  { key: "aws.iam.no_root_access_keys", title: "Root account has no active access keys", failTitle: "Root account has active access keys", severityDefault: "critical", isoReferences: ["A.9.2.3"], dpdpaControlAreas: ["Access Control & Least Privilege"], run: (clients) => checkNoRootAccessKeys(clients.iam) },
  { key: "aws.iam.no_inline_policies", title: "IAM users and groups have no inline policies", failTitle: "IAM user or group has inline policies attached", severityDefault: "medium", isoReferences: ["A.9.1.2"], run: (clients) => checkNoInlinePolicies(clients.iam) },
  { key: "aws.iam.no_overly_broad_managed_policies", title: "No IAM users or groups have admin-level managed policies attached", failTitle: "IAM user or group has an admin-level managed policy attached", severityDefault: "high", isoReferences: ["A.9.1.2"], dpdpaControlAreas: ["Access Control & Least Privilege"], run: (clients) => checkNoOverlyBroadManagedPolicies(clients.iam) },
];
