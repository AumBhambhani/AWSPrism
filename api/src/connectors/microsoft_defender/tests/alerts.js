import { buildEvidencePayload } from "../../shared/evidencePayload.js";
import { oDataPaginate } from "../oDataPaginate.js";

// ──────────────────────────────────────────────────────────────────────────────
// microsoft_defender.alerts.high_severity_triaged_promptly
// Checks High/Critical alerts are not in "New" status for more than 24h.
// ──────────────────────────────────────────────────────────────────────────────
async function checkHighSeverityTriagedPromptly(getToken, baseUrl) {
  const alerts = await oDataPaginate(
    getToken,
    baseUrl,
    "/api/alerts?$filter=(severity eq 'High' or severity eq 'Critical') and status eq 'New'"
  );
  const twentyFourHoursAgo = Date.now() - 24 * 60 * 60 * 1000;
  const stale = alerts.filter((a) => {
    const created = a.alertCreationTime ? new Date(a.alertCreationTime).getTime() : null;
    return created !== null && created < twentyFourHoursAgo;
  });

  if (stale.length === 0) {
    return [{
      resourceId: "alerts",
      status: "pass",
      message: `No High/Critical alerts remaining in 'New' status beyond the 24-hour triage SLA`,
      evidencePayload: buildEvidencePayload({ resourceType: "defender_alerts", resourceId: "alerts", region: null, details: { newHighCriticalAlerts: alerts.length, staleBeyondSLA: 0 } }),
    }];
  }
  return stale.map((a) => ({
    resourceId: a.id,
    status: "fail",
    message: `${a.severity} alert "${a.title || a.id}" has been in 'New' status for more than 24 hours`,
    evidencePayload: buildEvidencePayload({
      resourceType: "defender_alert",
      resourceId: a.id,
      resourceName: a.title || a.id,
      region: null,
      details: { severity: a.severity, status: a.status, alertCreationTime: a.alertCreationTime, category: a.category },
    }),
  }));
}

// ──────────────────────────────────────────────────────────────────────────────
// microsoft_defender.alerts.no_unassigned_critical_alerts
// ──────────────────────────────────────────────────────────────────────────────
async function checkNoUnassignedCriticalAlerts(getToken, baseUrl) {
  const alerts = await oDataPaginate(
    getToken,
    baseUrl,
    "/api/alerts?$filter=severity eq 'Critical'"
  );
  const unassigned = alerts.filter((a) => !a.assignedTo);
  if (unassigned.length === 0) {
    return [{
      resourceId: "alerts",
      status: "pass",
      message: `All ${alerts.length} Critical alert(s) have an assigned owner`,
      evidencePayload: buildEvidencePayload({ resourceType: "defender_alerts", resourceId: "alerts", region: null, details: { criticalAlerts: alerts.length, unassigned: 0 } }),
    }];
  }
  return unassigned.map((a) => ({
    resourceId: a.id,
    status: "fail",
    message: `Critical alert "${a.title || a.id}" has no assigned owner`,
    evidencePayload: buildEvidencePayload({
      resourceType: "defender_alert",
      resourceId: a.id,
      resourceName: a.title || a.id,
      region: null,
      details: { severity: a.severity, status: a.status, assignedTo: a.assignedTo ?? null },
    }),
  }));
}

export const alertsTests = [
  {
    key: "microsoft_defender.alerts.high_severity_triaged_promptly",
    title: "High and critical severity alerts are triaged within SLA",
    failTitle: "High or critical severity alert has been in 'New' status for more than 24 hours",
    severityDefault: "critical",
    isoReferences: ["A.16.1.5"],
    dpdpaControlAreas: ["Breach Identification & Classification"],
    run: (clients) => checkHighSeverityTriagedPromptly(clients.getToken, clients.baseUrl),
  },
  {
    key: "microsoft_defender.alerts.no_unassigned_critical_alerts",
    title: "Critical alerts are assigned to an owner",
    failTitle: "Critical alert has no assigned owner",
    severityDefault: "medium",
    isoReferences: ["A.16.1.2"],
    dpdpaControlAreas: ["Breach Identification & Classification"],
    run: (clients) => checkNoUnassignedCriticalAlerts(clients.getToken, clients.baseUrl),
  },
];
