import { buildEvidencePayload } from "../../shared/evidencePayload.js";
import { graphGet, graphPaginate } from "../../entra_id/tests/mfaAndAccess.js";

// ──────────────────────────────────────────────────────────────────────────────
// microsoft_365.intune.compliance_policy_assigned_all_platforms
// deviceCompliancePolicy is polymorphic — the base resource has no "platforms"
// field at all (verified against Microsoft Graph docs); the concrete platform
// is only exposed via the @odata.type discriminator (e.g.
// "#microsoft.graph.windows10CompliancePolicy", "#microsoft.graph.iosCompliancePolicy").
// Substring-matching @odata.type is deliberately looser than an exhaustive
// enum of every concrete subtype (windows10MobileCompliancePolicy,
// androidWorkProfileCompliancePolicy, androidDeviceOwnerCompliancePolicy,
// aospDeviceOwnerCompliancePolicy, ...) so a new platform-family subtype
// Microsoft adds later still matches without a code change.
// Also requires the policy actually be assigned (via $expand=assignments,
// not $select — assignments is a navigation property Graph only inlines via
// $expand) — an unassigned policy enforces nothing, so it shouldn't count as
// covering its platform.
// ──────────────────────────────────────────────────────────────────────────────
async function checkCompliancePolicyAssignedAllPlatforms(getToken, tenantId) {
  const [policies, devices] = await Promise.all([
    graphPaginate(getToken, "/deviceManagement/deviceCompliancePolicies?$select=id,displayName&$expand=assignments"),
    graphPaginate(getToken, "/deviceManagement/managedDevices?$select=id,operatingSystem"),
  ]);

  const managedPlatforms = new Set(devices.map((d) => (d.operatingSystem || "").toLowerCase()).filter(Boolean));

  const coveredPlatforms = new Set();
  for (const policy of policies) {
    if (!(policy.assignments || []).length) continue; // unassigned policy — enforces nothing
    const odataType = (policy["@odata.type"] || "").toLowerCase();
    if (odataType.includes("windows")) coveredPlatforms.add("windows");
    else if (odataType.includes("ios")) coveredPlatforms.add("ios");
    else if (odataType.includes("android")) coveredPlatforms.add("android");
    else if (odataType.includes("macos")) coveredPlatforms.add("macos");
  }

  const uncovered = [...managedPlatforms].filter((p) => !coveredPlatforms.has(p));

  if (uncovered.length === 0) {
    return [{
      resourceId: tenantId,
      status: "pass",
      message: `Intune compliance policies cover all ${managedPlatforms.size} managed platform(s)`,
      evidencePayload: buildEvidencePayload({ resourceType: "m365_intune_tenant", resourceId: tenantId, region: null, details: { managedPlatforms: [...managedPlatforms], coveredPlatforms: [...coveredPlatforms] } }),
    }];
  }
  return uncovered.map((p) => ({
    resourceId: `platform_${p}`,
    status: "fail",
    message: `No assigned Intune compliance policy covers platform "${p}"`,
    evidencePayload: buildEvidencePayload({ resourceType: "m365_intune_platform", resourceId: `platform_${p}`, region: null, details: { platform: p } }),
  }));
}

// ──────────────────────────────────────────────────────────────────────────────
// microsoft_365.intune.noncompliant_devices_remediated
// ──────────────────────────────────────────────────────────────────────────────
async function checkNoncompliantDevicesRemediated(getToken, tenantId) {
  const devices = await graphPaginate(getToken, "/deviceManagement/managedDevices?$select=id,deviceName,complianceState,operatingSystem");
  if (devices.length === 0) {
    return [{
      resourceId: tenantId,
      status: "not_applicable",
      message: "No managed devices found in Intune",
      evidencePayload: buildEvidencePayload({ resourceType: "m365_intune_tenant", resourceId: tenantId, region: null, details: { managedDevices: 0 } }),
    }];
  }
  const nonCompliant = devices.filter((d) => d.complianceState === "noncompliant");
  const percentage = (nonCompliant.length / devices.length) * 100;
  const pass = percentage <= 10;
  return [{
    resourceId: tenantId,
    status: pass ? "pass" : "fail",
    message: pass
      ? `${nonCompliant.length}/${devices.length} devices non-compliant (${percentage.toFixed(1)}%) — within threshold`
      : `${nonCompliant.length}/${devices.length} devices non-compliant (${percentage.toFixed(1)}%) — exceeds 10% threshold`,
    evidencePayload: buildEvidencePayload({
      resourceType: "m365_intune_tenant",
      resourceId: tenantId,
      region: null,
      details: { totalDevices: devices.length, noncompliantDevices: nonCompliant.length, noncompliantPercentage: percentage },
    }),
  }];
}

export const intuneTests = [
  {
    key: "microsoft_365.intune.compliance_policy_assigned_all_platforms",
    title: "Device compliance policies are assigned for every managed platform",
    failTitle: "No Intune compliance policy is assigned for a managed platform",
    severityDefault: "high",
    isoReferences: ["A.6.2.1"],
    dpdpaControlAreas: ["Security Safeguards Program"],
    run: (clients) => checkCompliancePolicyAssignedAllPlatforms(clients.getGraphToken, clients.tenantId),
  },
  {
    key: "microsoft_365.intune.noncompliant_devices_remediated",
    title: "Managed devices are compliant or being remediated",
    failTitle: "Non-compliant managed devices exceed the 10% threshold",
    severityDefault: "medium",
    isoReferences: ["A.6.2.1"],
    dpdpaControlAreas: ["Vulnerability & Patch Management"],
    run: (clients) => checkNoncompliantDevicesRemediated(clients.getGraphToken, clients.tenantId),
  },
];
