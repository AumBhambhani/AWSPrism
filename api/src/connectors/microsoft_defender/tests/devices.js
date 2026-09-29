import { buildEvidencePayload } from "../../shared/evidencePayload.js";
import { oDataPaginate } from "../oDataPaginate.js";

// ──────────────────────────────────────────────────────────────────────────────
// microsoft_defender.devices.onboarding_coverage_complete
// ──────────────────────────────────────────────────────────────────────────────
async function checkOnboardingCoverageComplete(getToken, baseUrl) {
  const machines = await oDataPaginate(getToken, baseUrl, "/api/machines");
  const unresolved = machines.filter(
    (m) => m.onboardingStatus === "CanBeOnboarded" || m.onboardingStatus === "InsufficientInfo"
  );
  if (unresolved.length === 0) {
    return [{
      resourceId: "devices",
      status: "pass",
      message: `All ${machines.length} device(s) are onboarded or explicitly unsupported`,
      evidencePayload: buildEvidencePayload({ resourceType: "defender_devices", resourceId: "devices", region: null, details: { totalDevices: machines.length, unresolvedDevices: 0 } }),
    }];
  }
  return unresolved.map((m) => ({
    resourceId: m.id,
    status: "fail",
    message: `Device "${m.computerDnsName || m.id}" is not onboarded (status: ${m.onboardingStatus})`,
    evidencePayload: buildEvidencePayload({
      resourceType: "defender_device",
      resourceId: m.id,
      resourceName: m.computerDnsName || m.id,
      region: null,
      details: { onboardingStatus: m.onboardingStatus, osPlatform: m.osPlatform },
    }),
  }));
}

// ──────────────────────────────────────────────────────────────────────────────
// microsoft_defender.devices.sensor_health_active
// ──────────────────────────────────────────────────────────────────────────────
async function checkSensorHealthActive(getToken, baseUrl) {
  const machines = await oDataPaginate(getToken, baseUrl, "/api/machines?$filter=onboardingStatus eq 'Onboarded'");
  const unhealthy = machines.filter(
    (m) => m.healthStatus === "Inactive" || m.healthStatus === "ImpairedCommunication" || m.healthStatus === "NoSensorData"
  );
  if (unhealthy.length === 0) {
    return [{
      resourceId: "devices",
      status: "pass",
      message: `All ${machines.length} onboarded device(s) report active sensor health`,
      evidencePayload: buildEvidencePayload({ resourceType: "defender_devices", resourceId: "devices", region: null, details: { onboardedDevices: machines.length, unhealthyDevices: 0 } }),
    }];
  }
  return unhealthy.map((m) => ({
    resourceId: m.id,
    status: "fail",
    message: `Device "${m.computerDnsName || m.id}" reports unhealthy sensor status: ${m.healthStatus}`,
    evidencePayload: buildEvidencePayload({
      resourceType: "defender_device",
      resourceId: m.id,
      resourceName: m.computerDnsName || m.id,
      region: null,
      details: { healthStatus: m.healthStatus, osPlatform: m.osPlatform, lastSeen: m.lastSeen },
    }),
  }));
}

// ──────────────────────────────────────────────────────────────────────────────
// microsoft_defender.devices.high_exposure_devices_remediated
// ──────────────────────────────────────────────────────────────────────────────
async function checkHighExposureDevicesRemediated(getToken, baseUrl) {
  const machines = await oDataPaginate(getToken, baseUrl, "/api/machines?$filter=exposureLevel eq 'High'");
  if (machines.length === 0) {
    return [{
      resourceId: "devices",
      status: "pass",
      message: "No devices with High exposure level found",
      evidencePayload: buildEvidencePayload({ resourceType: "defender_devices", resourceId: "devices", region: null, details: { highExposureDevices: 0 } }),
    }];
  }
  return machines.map((m) => ({
    resourceId: m.id,
    status: "fail",
    message: `Device "${m.computerDnsName || m.id}" has High exposure level — requires active remediation`,
    evidencePayload: buildEvidencePayload({
      resourceType: "defender_device",
      resourceId: m.id,
      resourceName: m.computerDnsName || m.id,
      region: null,
      details: { exposureLevel: m.exposureLevel, exposureScore: m.exposureScore ?? null, osPlatform: m.osPlatform },
    }),
  }));
}

export const devicesTests = [
  {
    key: "microsoft_defender.devices.onboarding_coverage_complete",
    title: "Managed devices are onboarded to Defender for Endpoint",
    failTitle: "Device is not onboarded to Defender for Endpoint",
    severityDefault: "high",
    isoReferences: ["A.8.1.1"],
    dpdpaControlAreas: ["Security Safeguards Program"],
    run: (clients) => checkOnboardingCoverageComplete(clients.getToken, clients.baseUrl),
  },
  {
    key: "microsoft_defender.devices.sensor_health_active",
    title: "Onboarded devices report active sensor health",
    failTitle: "Onboarded device reports unhealthy sensor status",
    severityDefault: "medium",
    isoReferences: ["A.12.2.1"],
    dpdpaControlAreas: ["Security Safeguards Program"],
    run: (clients) => checkSensorHealthActive(clients.getToken, clients.baseUrl),
  },
  {
    key: "microsoft_defender.devices.high_exposure_devices_remediated",
    title: "High-exposure devices have an active remediation plan",
    failTitle: "Device has High exposure level and requires active remediation",
    severityDefault: "high",
    isoReferences: ["A.12.6.1"],
    dpdpaControlAreas: ["Vulnerability & Patch Management"],
    run: (clients) => checkHighExposureDevicesRemediated(clients.getToken, clients.baseUrl),
  },
];
