import { buildEvidencePayload } from "../../shared/evidencePayload.js";

// CONFIRMED shape: GET /Alerts returns
//   { alertList: [{ alert: { name, id }, alertCategory: { name }, description, ... }] }
// per cvpysdk's alert.html (commcell.alerts.all_alerts reads exactly this list).
//
// UNCONFIRMED: the filtering heuristic below — which alerts "count" as
// backup-job-failure monitoring — is a best-effort guess, not a documented,
// stable Commvault taxonomy. Confirm real out-of-the-box alertCategory.name
// values on a live CommCell and tighten this list.
const JOB_FAILURE_CATEGORY_KEYWORDS = ["job management", "data protection"];
const JOB_FAILURE_TEXT_KEYWORDS = ["job fail", "backup fail", "job failed", "backup failed", "job fails", "backup fails"];

function looksLikeJobFailureAlert(alertEntry) {
  const category = (alertEntry?.alertCategory?.name || "").toLowerCase();
  const name = (alertEntry?.alert?.name || alertEntry?.alertName || "").toLowerCase();
  const description = (alertEntry?.description || "").toLowerCase();
  const categoryMatch = JOB_FAILURE_CATEGORY_KEYWORDS.some((kw) => category.includes(kw));
  const textMatch = JOB_FAILURE_TEXT_KEYWORDS.some((kw) => name.includes(kw) || description.includes(kw));
  return categoryMatch || textMatch;
}

async function checkAlertsConfigured(commvault) {
  const response = await commvault.request("/Alerts");
  const alertList = response?.alertList || [];
  const matches = alertList.filter(looksLikeJobFailureAlert);
  const configured = matches.length > 0;

  return [
    {
      resourceId: "commcell",
      status: configured ? "pass" : "fail",
      message: configured
        ? `${matches.length} alert(s) configured for backup job failure monitoring`
        : "No alert is configured for backup job failure monitoring",
      evidencePayload: buildEvidencePayload({
        resourceType: "commvault_alert",
        resourceId: "commcell",
        resourceName: "CommCell alerts",
        region: null,
        details: {
          totalAlerts: alertList.length,
          matchingAlertNames: matches.map((m) => m.alert?.name || m.alertName).filter(Boolean),
        },
      }),
    },
  ];
}

export const monitoringTests = [
  {
    key: "commvault.monitoring.alerts_configured",
    title: "An alert is configured for backup job failures",
    failTitle: "No alert is configured for backup job failures",
    severityDefault: "medium",
    isoReferences: ["A.12.4.1"],
    dpdpaControlAreas: ["Logging & Monitoring"],
    run: (clients) => checkAlertsConfigured(clients.commvault),
  },
];

export { checkAlertsConfigured };
