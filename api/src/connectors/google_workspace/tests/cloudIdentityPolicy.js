import { paginate } from "./pagination.js";

// Reads a "Additional Google services" setting (Drive/Gmail/Calendar sharing
// defaults, etc.) via the Cloud Identity Policy API — a distinct API/host
// (cloudidentity.googleapis.com) from the Chrome Policy API, even though both
// surface as policy screens under the same Admin Console "Apps" section.
// `settingType` is the bare id (e.g. "gmail.auto_forwarding"); the API's
// filter syntax wants it as `setting.type=='settings/<id>'`.
export async function listPoliciesForSetting(cloudidentity, customerId, settingType) {
  return paginate(
    (params) => cloudidentity.policies.list(params),
    {
      filter: `setting.type=='settings/${settingType}' AND customer=='customers/${customerId}'`,
      pageSize: 100,
    },
    "policies"
  );
}
