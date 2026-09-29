import { listPoliciesForSetting } from "./cloudIdentityPolicy.js";

// "ALLOWED" is fully open external sharing (any external user, any domain);
// ALLOWLISTED_DOMAINS/DISALLOWED are both acceptable restricted postures.
const UNRESTRICTED_EXTERNAL_SHARING_MODE = "ALLOWED";
// New-file default visibility that's discoverable via search, i.e. the
// Workspace analog of a public bucket/blob — PRIMARY_AUDIENCE_WITH_LINK
// (an unauthenticated link, but not search-discoverable) is treated as an
// acceptable default; only the search-discoverable tier fails.
const PUBLIC_DEFAULT_FILE_ACCESS = "PRIMARY_AUDIENCE_WITH_LINK_OR_SEARCH";

function evaluatePolicyValue(policies, valueField, failValue, resourceId, passMessage, failMessage) {
  if (policies.length === 0) {
    return { resourceId, status: "not_applicable", message: `No ${resourceId} policy is resolvable for this domain`, evidencePayload: {} };
  }
  const offending = policies.find((p) => p.setting?.value?.[valueField] === failValue);
  return {
    resourceId,
    status: offending ? "fail" : "pass",
    message: offending ? failMessage : passMessage,
    evidencePayload: { policies: policies.map((p) => ({ orgUnit: p.policyQuery?.orgUnit, group: p.policyQuery?.group, value: p.setting?.value })) },
  };
}

export async function checkDriveExternalSharingRestricted(cloudidentity, customerId) {
  const [sharingPolicies, accessPolicies] = await Promise.all([
    listPoliciesForSetting(cloudidentity, customerId, "drive_and_docs.external_sharing"),
    listPoliciesForSetting(cloudidentity, customerId, "drive_and_docs.general_access_default"),
  ]);

  return [
    evaluatePolicyValue(
      sharingPolicies, "externalSharingMode", UNRESTRICTED_EXTERNAL_SHARING_MODE,
      "drive_and_docs.external_sharing",
      "Drive external sharing is disallowed or limited to allowlisted domains",
      "Drive external sharing is unrestricted (open to any external user)"
    ),
    evaluatePolicyValue(
      accessPolicies, "defaultFileAccess", PUBLIC_DEFAULT_FILE_ACCESS,
      "drive_and_docs.general_access_default",
      "Drive's default new-file access is not search-discoverable",
      "Drive's default new-file access is search-discoverable (public on the web)"
    ),
  ];
}

export const driveTests = [
  {
    key: "google_workspace.drive.external_sharing_restricted",
    title: "Drive/Docs external sharing defaults are restricted",
    failTitle: "Drive/Docs external sharing default is unrestricted",
    severityDefault: "critical",
    isoReferences: ["A.8.2.3"],
    dpdpaControlAreas: ["DLP / Data Leakage Prevention"],
    run: (clients) => checkDriveExternalSharingRestricted(clients.cloudidentity, clients.customerId),
  },
];
