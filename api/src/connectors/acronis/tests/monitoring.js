import { buildEvidencePayload } from "../../shared/evidencePayload.js";
import {
  isOpenAlert,
  isMalwareAlert,
  isVulnerabilityAlert,
  isPatchAlert,
  alertSeverity,
  alertPayload,
} from "../alerts.js";

const CRITICAL_SEVERITIES = new Set(["critical", "error", "high"]);

// Catch-all monitoring check: any open critical/error alert that is NOT already
// counted by the malware or vulnerability/patch checks must be triaged. Excluding
// those categories avoids double-counting the same alert across findings.
async function checkNoOpenCriticalAlerts(clients) {
  const alerts = (await clients.getAlerts()).filter(
    (a) =>
      isOpenAlert(a) &&
      CRITICAL_SEVERITIES.has(alertSeverity(a)) &&
      !isMalwareAlert(a) &&
      !isVulnerabilityAlert(a) &&
      !isPatchAlert(a)
  );

  if (alerts.length === 0) {
    return [
      {
        resourceId: "alerts",
        status: "pass",
        message: "No unresolved critical or error alerts are open in the Acronis tenant",
        evidencePayload: buildEvidencePayload({
          resourceType: "acronis_alert",
          resourceId: "alerts",
          resourceName: "Alert stream",
          region: null,
          details: { openCriticalAlerts: 0 },
        }),
      },
    ];
  }

  return alerts.map((a) => ({
    resourceId: String(a?.id ?? a?.alertId ?? "unknown"),
    status: "fail",
    message: `Open ${alertSeverity(a)} alert "${a?.type ?? a?.name ?? a?.id}" on "${a?.resourceName ?? a?.details?.resourceName ?? "an unknown workload"}" — triage and resolve`,
    evidencePayload: alertPayload(a),
  }));
}

export const monitoringTests = [
  {
    key: "acronis.monitoring.no_open_critical_alerts",
    title: "No unresolved critical or error alerts",
    failTitle: "An unresolved critical / error alert is open",
    severityDefault: "high",
    isoReferences: ["A.16.1.5"],
    dpdpaControlAreas: ["Security Monitoring"],
    run: (clients) => checkNoOpenCriticalAlerts(clients),
  },
];
