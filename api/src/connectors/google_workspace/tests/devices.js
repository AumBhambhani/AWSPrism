import { paginate } from "./pagination.js";

// chrome.users.SessionLengthV2 is a Google-documented Chrome Policy API
// schema (developers.google.com/chrome/policy/guides/samples) covering
// forced session/idle logout — the closest baseline "device isn't left on
// platform defaults" control this connector can verify against a schema
// name confirmed in Google's own reference material. This check verifies
// the policy has been explicitly configured for the org, not the specific
// timeout value (Google does not publicly document the nested value field
// names for this schema well enough to assert against safely).
const SESSION_LENGTH_SCHEMA = "chrome.users.SessionLengthV2";

async function listChromeOsDevices(directory, customerId) {
  return paginate(
    (params) => directory.chromeosdevices.list(params),
    { customerId, maxResults: 200, projection: "BASIC" },
    "chromeosdevices"
  );
}

export async function checkChromePolicyCompliant(chromepolicy, directory, customerId) {
  const devices = await listChromeOsDevices(directory, customerId);
  if (devices.length === 0) {
    return [{ resourceId: "chromeos", status: "not_applicable", message: "No managed ChromeOS devices found", evidencePayload: {} }];
  }

  const { data: rootOrgUnit } = await directory.orgunits.get({ customerId, orgUnitPath: "/" });
  const { data } = await chromepolicy.customers.policies.resolve({
    customer: `customers/${customerId}`,
    requestBody: {
      policySchemaFilter: SESSION_LENGTH_SCHEMA,
      policyTargetKey: { targetResource: `orgunits/${rootOrgUnit.orgUnitId}` },
    },
  });
  const resolved = data.resolvedPolicies || [];
  const configured = resolved.length > 0;

  return [{
    resourceId: "chromeos",
    status: configured ? "pass" : "fail",
    message: configured
      ? `Session length policy (${SESSION_LENGTH_SCHEMA}) is explicitly configured for the organization's root org unit`
      : `Session length policy (${SESSION_LENGTH_SCHEMA}) is left unconfigured (platform default) for ${devices.length} managed ChromeOS device(s)`,
    evidencePayload: { managedDeviceCount: devices.length, schema: SESSION_LENGTH_SCHEMA, resolvedPolicyCount: resolved.length },
  }];
}

export const devicesTests = [
  {
    key: "google_workspace.devices.chrome_policy_compliant",
    title: "Managed ChromeOS devices enforce baseline security policy",
    failTitle: "Baseline ChromeOS session/idle policy is left unconfigured",
    severityDefault: "medium",
    isoReferences: ["A.6.2.1"],
    dpdpaControlAreas: ["Security Safeguards Program"],
    run: (clients) => checkChromePolicyCompliant(clients.chromepolicy, clients.directory, clients.customerId),
  },
];
