import { paginate } from "./pagination.js";

const MAX_RECOMMENDED_OWNERS = 2;
const KEY_MAX_AGE_DAYS = 90;

function daysSince(isoTimestamp) {
  return (Date.now() - new Date(isoTimestamp).getTime()) / (1000 * 60 * 60 * 24);
}

export async function checkOwnerRoleAssignmentsLimited(cloudresourcemanager, projectId) {
  const { data } = await cloudresourcemanager.projects.getIamPolicy({
    resource: `projects/${projectId}`,
    requestBody: {},
  });
  const ownerBinding = (data.bindings || []).find((b) => b.role === "roles/owner");
  const owners = ownerBinding?.members || [];
  const pass = owners.length <= MAX_RECOMMENDED_OWNERS;
  return [{
    resourceId: projectId,
    status: pass ? "pass" : "fail",
    message: pass
      ? `${owners.length} principal(s) hold the Owner role on project ${projectId}`
      : `${owners.length} principals hold the Owner role on project ${projectId}, exceeding the recommended maximum of ${MAX_RECOMMENDED_OWNERS}`,
    evidencePayload: { ownerCount: owners.length, maxRecommended: MAX_RECOMMENDED_OWNERS, owners },
  }];
}

export async function checkServiceAccountKeysRotated(iam, projectId) {
  const accounts = await paginate(
    (params) => iam.projects.serviceAccounts.list(params),
    { name: `projects/${projectId}` },
    "accounts"
  );
  if (accounts.length === 0) {
    return [{ resourceId: projectId, status: "not_applicable", message: "No service accounts found", evidencePayload: {} }];
  }

  const results = [];
  for (const account of accounts) {
    const { data } = await iam.projects.serviceAccounts.keys.list({ name: account.name, keyTypes: ["USER_MANAGED"] });
    for (const key of data.keys || []) {
      const ageDays = daysSince(key.validAfterTime);
      const stale = ageDays > KEY_MAX_AGE_DAYS;
      results.push({
        resourceId: key.name,
        status: stale ? "fail" : "pass",
        message: stale
          ? `${account.email}'s user-managed key is ${Math.floor(ageDays)} days old, exceeding the ${KEY_MAX_AGE_DAYS}-day rotation threshold`
          : `${account.email}'s user-managed key is ${Math.floor(ageDays)} days old, within the rotation threshold`,
        evidencePayload: { serviceAccount: account.email, keyName: key.name, ageDays: Math.floor(ageDays), maxAgeDays: KEY_MAX_AGE_DAYS },
      });
    }
  }

  if (results.length === 0) {
    return [{ resourceId: projectId, status: "pass", message: `No user-managed service account keys found across ${accounts.length} service account(s)`, evidencePayload: { serviceAccountCount: accounts.length } }];
  }
  return results;
}

export const iamTests = [
  {
    key: "gcp.iam.owner_role_assignments_limited",
    title: "Project-level Owner role assignments are limited",
    failTitle: "Too many principals hold the Owner role at project scope",
    severityDefault: "medium",
    isoReferences: ["A.9.1.2"],
    dpdpaControlAreas: ["Privileged Access Management"],
    run: (clients) => checkOwnerRoleAssignmentsLimited(clients.cloudresourcemanager, clients.projectId),
  },
  {
    key: "gcp.iam.service_account_keys_rotated",
    title: "User-managed service account keys are rotated regularly",
    failTitle: "User-managed service account key exceeds the rotation threshold",
    severityDefault: "high",
    isoReferences: ["A.9.2.4"],
    dpdpaControlAreas: ["Access Control & Least Privilege"],
    run: (clients) => checkServiceAccountKeysRotated(clients.iam, clients.projectId),
  },
];
