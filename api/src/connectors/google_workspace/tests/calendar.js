import { listPoliciesForSetting } from "./cloudIdentityPolicy.js";

// Only "free/busy only" keeps event titles/descriptions/attendees private
// from external viewers by default; every other tier exposes event details
// (and the two _MANAGE/_WRITE tiers also allow external edits).
const ACCEPTABLE_EXTERNAL_SHARING = "EXTERNAL_FREE_BUSY_ONLY";

export async function checkCalendarExternalSharingRestricted(cloudidentity, customerId) {
  const policies = await listPoliciesForSetting(cloudidentity, customerId, "calendar.primary_calendar_max_allowed_external_sharing");
  if (policies.length === 0) {
    return [{ resourceId: "calendar.primary_calendar_max_allowed_external_sharing", status: "not_applicable", message: "No Calendar external sharing policy is resolvable for this domain", evidencePayload: {} }];
  }
  const overExposed = policies.find((p) => p.setting?.value?.maxAllowedExternalSharing !== ACCEPTABLE_EXTERNAL_SHARING);
  return [{
    resourceId: "calendar.primary_calendar_max_allowed_external_sharing",
    status: overExposed ? "fail" : "pass",
    message: overExposed
      ? `Calendar external sharing default exposes more than free/busy information (${overExposed.setting.value.maxAllowedExternalSharing})`
      : "Calendar external sharing default is limited to free/busy information",
    evidencePayload: { policies: policies.map((p) => ({ orgUnit: p.policyQuery?.orgUnit, group: p.policyQuery?.group, value: p.setting?.value })) },
  }];
}

export const calendarTests = [
  {
    key: "google_workspace.calendar.external_sharing_restricted",
    title: "Calendar external sharing default is restricted",
    failTitle: "Calendar external sharing default exposes more than free/busy information",
    severityDefault: "medium",
    isoReferences: ["A.13.2.1"],
    dpdpaControlAreas: ["DLP / Data Leakage Prevention"],
    run: (clients) => checkCalendarExternalSharingRestricted(clients.cloudidentity, clients.customerId),
  },
];
