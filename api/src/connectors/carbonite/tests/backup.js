import { buildEvidencePayload } from "../../shared/evidencePayload.js";
import { deviceRows } from "../shape.js";

// UNCONFIRMED (connector plan Task 0): SOAP operation names are confirmed from
// the vendor's API-calls index, but every field name and the envelope shape are
// documentation guesses. `LastCompleteBackupUtc` is the one field the vendor
// docs explicitly name as "last successful complete backup", so it is the basis
// for this check. Any shape the check doesn't recognise degrades to
// `status: "error"` rather than a guessed pass/fail.

// A device whose last *complete* backup is older than this is stale even though
// it once succeeded. Echoed into every evidence payload (there is no per-
// connection threshold store yet — see crowdstrike/index.js THRESHOLDS).
export const STALE_BACKUP_HOURS = 48;

function hoursSince(value) {
  const t = Date.parse(value);
  return Number.isNaN(t) ? null : (Date.now() - t) / 3_600_000;
}

function deviceId(row) {
  return String(row?.DeviceId ?? row?.EntityId ?? row?.DeviceName ?? "unknown");
}
function deviceName(row) {
  return String(row?.DeviceName ?? row?.UserEmail ?? deviceId(row));
}

function errorRow(message, details) {
  return {
    resourceId: "tenant",
    status: "error",
    message,
    evidencePayload: buildEvidencePayload({
      resourceType: "carbonite_device",
      resourceId: "tenant",
      resourceName: "Carbonite Core Endpoint Backup tenant",
      region: null,
      details: details || {},
    }),
  };
}

export async function checkRecentSuccessfulBackup(carbonite) {
  const listResult = await carbonite.call("GetDeviceList", {});
  const { rows: devices, recognised } = deviceRows(listResult);

  if (!recognised) {
    return [errorRow(
      "Carbonite GetDeviceList response did not match the expected shape — reconfirm the SOAP " +
        "envelope / field mapping against this tenant's live WSDL (see the connector plan Task 0).",
      { rawResultKeys: Object.keys(listResult || {}) }
    )];
  }
  if (devices.length === 0) {
    return [{
      resourceId: "tenant",
      status: "not_applicable",
      message: "No protected devices are present in this Carbonite tenant",
      evidencePayload: buildEvidencePayload({
        resourceType: "carbonite_device", resourceId: "tenant",
        resourceName: "Carbonite Core Endpoint Backup tenant", region: null,
        details: { devices: 0, staleAfterHours: STALE_BACKUP_HOURS },
      }),
    }];
  }

  // Batch-resolve LastCompleteBackupUtc via GetDashboardDeviceInfo
  // (WhichField=EntityIds, FieldData=the device id list).
  const ids = devices.map(deviceId).filter((id) => id !== "unknown");
  const infoResult = await carbonite.call("GetDashboardDeviceInfo", {
    WhichField: "EntityIds",
    FieldData: { string: ids },
  });
  const infoById = new Map(deviceRows(infoResult).rows.map((r) => [deviceId(r), r]));

  return devices.map((device) => {
    const id = deviceId(device);
    const name = deviceName(device);
    const info = infoById.get(id) || {};
    // Prefer the detail call's LastCompleteBackupUtc; fall back to the list's
    // LastBackupUtc only to surface *something* (flagged in the payload).
    const lastComplete = info.LastCompleteBackupUtc ?? null;
    const lastAny = info.LastBackupUtc ?? device.LastBackupUtc ?? null;

    const payload = (details) => buildEvidencePayload({
      resourceType: "carbonite_device",
      resourceId: id,
      resourceName: name,
      region: null,
      details: { lastCompleteBackupUtc: lastComplete, lastBackupUtc: lastAny, staleAfterHours: STALE_BACKUP_HOURS, ...details },
    });

    // The detail lookup returned nothing for this device and the list row has no
    // timestamp either — can't assess. Error, not a guess.
    if (lastComplete == null && !infoById.has(id) && lastAny == null) {
      return {
        resourceId: id,
        status: "error",
        message:
          `Could not determine the last successful backup for device "${name}" — GetDashboardDeviceInfo ` +
          `returned no record for it and no known timestamp field was present. The field mapping needs ` +
          `live confirmation against the WSDL before this check can be trusted.`,
        evidencePayload: payload({ deviceKeys: Object.keys(device || {}), infoResolved: false }),
      };
    }

    if (lastComplete == null) {
      return {
        resourceId: id,
        status: "fail",
        message: `Device "${name}" has never reported a completed backup`,
        evidencePayload: payload({}),
      };
    }

    const ageHours = hoursSince(lastComplete);
    if (ageHours == null) {
      return {
        resourceId: id,
        status: "error",
        message:
          `Device "${name}"'s LastCompleteBackupUtc ("${lastComplete}") is not a parseable timestamp — ` +
          `the field format needs live confirmation.`,
        evidencePayload: payload({}),
      };
    }
    if (ageHours > STALE_BACKUP_HOURS) {
      return {
        resourceId: id,
        status: "fail",
        message: `Device "${name}" — last completed backup was ${Math.round(ageHours)}h ago (> ${STALE_BACKUP_HOURS}h)`,
        evidencePayload: payload({ ageHours: Math.round(ageHours) }),
      };
    }
    return {
      resourceId: id,
      status: "pass",
      message: `Device "${name}" completed a backup ${Math.round(ageHours)}h ago`,
      evidencePayload: payload({ ageHours: Math.round(ageHours) }),
    };
  });
}

export const backupTests = [
  {
    key: "carbonite.backup.recent_successful_backup",
    title: "Devices have a recent successful backup",
    failTitle: "A device has a stale or missing last completed backup",
    severityDefault: "critical",
    isoReferences: ["A.12.3.1"],
    dpdpaControlAreas: ["Backup & Recovery"],
    run: (creds) => checkRecentSuccessfulBackup(creds),
  },
];
