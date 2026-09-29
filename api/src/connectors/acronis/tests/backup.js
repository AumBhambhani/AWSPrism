import { buildEvidencePayload } from "../../shared/evidencePayload.js";

function daysSince(value) {
  const t = Date.parse(value);
  return Number.isNaN(t) ? null : (Date.now() - t) / 86400000;
}

function machineId(m) {
  return String(m?.resourceId ?? m?.id ?? m?.resourceName ?? m?.name ?? "unknown");
}
function machineName(m) {
  return String(m?.resourceName ?? m?.name ?? m?.hostname ?? machineId(m));
}
function lastBackupAt(m) {
  return m?.lastSuccessfulBackup?.dateTime ?? m?.lastSuccessfulBackup ?? m?.lastBackup?.dateTime ?? null;
}

function machinePayload(m, details) {
  return buildEvidencePayload({
    resourceType: "acronis_machine",
    resourceId: machineId(m),
    resourceName: machineName(m),
    region: null,
    details,
  });
}

function noMachinesRow(check) {
  return [
    {
      resourceId: "machines",
      status: "not_applicable",
      message: `No protected workloads are present in the Acronis tenant to evaluate for ${check}`,
      evidencePayload: buildEvidencePayload({
        resourceType: "acronis_machine",
        resourceId: "machines",
        resourceName: "Workload inventory",
        region: null,
        details: { machines: 0 },
      }),
    },
  ];
}

// Every managed workload must carry an assigned protection plan — a machine
// reporting anything other than a protected state is either unprotected or in a
// degraded/error state and is a finding. Acronis exposes no "reviewed" flag, so
// an unprotected machine is reported rather than passed.
async function checkProtectionEnabled(clients) {
  const machines = await clients.listResourceStatuses();
  if (machines.length === 0) return noMachinesRow("protection coverage");

  const unprotected = machines.filter(
    (m) => String(m?.protectionStatus ?? "").toLowerCase() !== "protected"
  );

  if (unprotected.length === 0) {
    return [
      {
        resourceId: "machines",
        status: "pass",
        message: `All ${machines.length} workload(s) report a Protected status`,
        evidencePayload: buildEvidencePayload({
          resourceType: "acronis_machine",
          resourceId: "machines",
          resourceName: "Workload inventory",
          region: null,
          details: { machines: machines.length, unprotected: 0 },
        }),
      },
    ];
  }

  return unprotected.map((m) => ({
    resourceId: machineId(m),
    status: "fail",
    message: `Workload "${machineName(m)}" reports protection status "${m?.protectionStatus ?? "unknown"}" — assign an active protection plan`,
    evidencePayload: machinePayload(m, {
      protectionStatus: m?.protectionStatus ?? null,
      protectionPlanName: m?.protectionPlanName ?? null,
    }),
  }));
}

// A workload with a stale (or missing) last successful backup is not meeting its
// recovery-point objective. Default window: 7 days.
async function checkRecentSuccessfulBackup(clients) {
  const machines = await clients.listResourceStatuses();
  if (machines.length === 0) return noMachinesRow("backup recency");

  const thresholdDays = clients.THRESHOLDS.BACKUP_MAX_AGE_DAYS;
  const stale = machines
    .map((m) => ({ m, at: lastBackupAt(m), age: daysSince(lastBackupAt(m)) }))
    .filter(({ at, age }) => at == null || age == null || age > thresholdDays);

  if (stale.length === 0) {
    return [
      {
        resourceId: "machines",
        status: "pass",
        message: `All ${machines.length} workload(s) completed a successful backup within the last ${thresholdDays} days`,
        evidencePayload: buildEvidencePayload({
          resourceType: "acronis_machine",
          resourceId: "machines",
          resourceName: "Workload inventory",
          region: null,
          details: { machines: machines.length, thresholdDays, staleBackups: 0 },
        }),
      },
    ];
  }

  return stale.map(({ m, at, age }) => ({
    resourceId: machineId(m),
    status: "fail",
    message:
      at == null
        ? `Workload "${machineName(m)}" has no recorded successful backup`
        : `Workload "${machineName(m)}" last backed up ${Math.round(age)} days ago (> ${thresholdDays})`,
    evidencePayload: machinePayload(m, {
      lastSuccessfulBackup: at,
      daysSinceLastBackup: age == null ? null : Math.round(age),
      thresholdDays,
      protectionPlanName: m?.protectionPlanName ?? null,
    }),
  }));
}

export const backupTests = [
  {
    key: "acronis.backup.protection_enabled",
    title: "Every workload has an assigned protection plan",
    failTitle: "A workload has no active protection plan",
    severityDefault: "high",
    isoReferences: ["A.12.3.1"],
    dpdpaControlAreas: ["Backup & Recovery"],
    run: (clients) => checkProtectionEnabled(clients),
  },
  {
    key: "acronis.backup.recent_successful_backup",
    title: "Backups have completed within the expected window",
    failTitle: "A workload's last successful backup is stale or missing",
    severityDefault: "high",
    isoReferences: ["A.12.3.1"],
    dpdpaControlAreas: ["Backup & Recovery"],
    run: (clients) => checkRecentSuccessfulBackup(clients),
  },
];
