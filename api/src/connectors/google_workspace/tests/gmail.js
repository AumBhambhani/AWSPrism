import { listPoliciesForSetting } from "./cloudIdentityPolicy.js";

export async function checkGmailAutoForwardingRestricted(cloudidentity, customerId) {
  const policies = await listPoliciesForSetting(cloudidentity, customerId, "gmail.auto_forwarding");
  if (policies.length === 0) {
    return [{ resourceId: "gmail.auto_forwarding", status: "not_applicable", message: "No Gmail auto-forwarding policy is resolvable for this domain", evidencePayload: {} }];
  }
  const enabled = policies.find((p) => p.setting?.value?.enableAutoForwarding === true);
  return [{
    resourceId: "gmail.auto_forwarding",
    status: enabled ? "fail" : "pass",
    message: enabled
      ? "Automatic email forwarding to external addresses is allowed"
      : "Automatic email forwarding to external addresses is disabled",
    evidencePayload: { policies: policies.map((p) => ({ orgUnit: p.policyQuery?.orgUnit, group: p.policyQuery?.group, value: p.setting?.value })) },
  }];
}

export const gmailTests = [
  {
    key: "google_workspace.gmail.auto_forwarding_restricted",
    title: "Automatic email forwarding to external addresses is restricted",
    failTitle: "Automatic email forwarding to external addresses is allowed",
    severityDefault: "high",
    isoReferences: ["A.13.2.1"],
    dpdpaControlAreas: ["DLP / Data Leakage Prevention"],
    run: (clients) => checkGmailAutoForwardingRestricted(clients.cloudidentity, clients.customerId),
  },
];
