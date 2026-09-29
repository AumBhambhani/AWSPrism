import { buildEvidencePayload } from "../../shared/evidencePayload.js";
import { deviceRows } from "../shape.js";

// UNCONFIRMED (connector plan Task 0, item 1): the `State` / `EntityState` enum
// values on GetDeviceList rows are not published anywhere. The tokens below are
// best-effort guesses. A device whose State matches neither the "protected" nor
// the "lapsed" set produces a `status: "error"` row naming the unrecognised
// value — never a guessed pass/fail — exactly the discipline the connector plan
// calls for.
const PROTECTED_STATES = new Set(["active", "protected", "enabled", "ok"]);
const LAPSED_STATES = new Set([
  "suspended", "cancelled", "canceled", "disabled", "deactivated", "expired", "deleted",
]);

function deviceId(row) {
  return String(row?.DeviceId ?? row?.EntityId ?? row?.DeviceName ?? "unknown");
}
function deviceName(row) {
  return String(row?.DeviceName ?? row?.UserEmail ?? deviceId(row));
}

export async function checkDeviceCoverage(carbonite) {
  const listResult = await carbonite.call("GetDeviceList", {});
  const { rows: devices, recognised } = deviceRows(listResult);

  if (!recognised) {
    return [{
      resourceId: "tenant",
      status: "error",
      message:
        "Carbonite GetDeviceList response did not match the expected shape — reconfirm the SOAP " +
        "envelope / field mapping against this tenant's live WSDL (see the connector plan Task 0).",
      evidencePayload: buildEvidencePayload({
        resourceType: "carbonite_device", resourceId: "tenant",
        resourceName: "Carbonite Core Endpoint Backup tenant", region: null,
        details: { rawResultKeys: Object.keys(listResult || {}) },
      }),
    }];
  }
  if (devices.length === 0) {
    return [{
      resourceId: "tenant",
      status: "not_applicable",
      message: "No devices are present in this Carbonite tenant to evaluate for protection coverage",
      evidencePayload: buildEvidencePayload({
        resourceType: "carbonite_device", resourceId: "tenant",
        resourceName: "Carbonite Core Endpoint Backup tenant", region: null, details: { devices: 0 },
      }),
    }];
  }

  return devices.map((device) => {
    const id = deviceId(device);
    const name = deviceName(device);
    const rawState = device?.State ?? device?.EntityState ?? device?.DeviceState;
    const payload = (details) => buildEvidencePayload({
      resourceType: "carbonite_device",
      resourceId: id,
      resourceName: name,
      region: null,
      details: { state: rawState ?? null, ...details },
    });

    if (rawState === undefined || rawState === null) {
      return {
        resourceId: id,
        status: "error",
        message:
          `Could not determine the protection state for device "${name}" — no known State field was ` +
          `present on this tenant's GetDeviceList response. The field mapping needs live confirmation.`,
        evidencePayload: payload({ deviceKeys: Object.keys(device || {}) }),
      };
    }

    const token = String(rawState).toLowerCase();
    if (PROTECTED_STATES.has(token)) {
      return { resourceId: id, status: "pass", message: `Device "${name}" is actively protected (state: ${rawState})`, evidencePayload: payload({}) };
    }
    if (LAPSED_STATES.has(token)) {
      return { resourceId: id, status: "fail", message: `Device "${name}" has lapsed protection (state: ${rawState})`, evidencePayload: payload({}) };
    }
    return {
      resourceId: id,
      status: "error",
      message:
        `Unrecognised device state "${rawState}" for device "${name}" — the Carbonite EntityState/DeviceState ` +
        `enum is unpublished and must be confirmed against a live tenant before this state can be scored ` +
        `(see the connector plan Task 0, item 1).`,
      evidencePayload: payload({}),
    };
  });
}

export const coverageTests = [
  {
    key: "carbonite.backup.device_coverage",
    title: "Devices remain actively protected",
    failTitle: "A device has silently lapsed out of protection",
    severityDefault: "high",
    isoReferences: ["A.12.3.1", "A.12.4.1"],
    dpdpaControlAreas: ["Backup & Recovery", "Logging & Monitoring"],
    run: (creds) => checkDeviceCoverage(creds),
  },
];
