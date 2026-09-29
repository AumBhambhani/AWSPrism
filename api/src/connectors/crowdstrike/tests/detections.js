import { buildEvidencePayload } from "../../shared/evidencePayload.js";

function hoursSince(value) {
  const t = Date.parse(value);
  return Number.isNaN(t) ? null : (Date.now() - t) / 3600000;
}

// Normalises an Alerts-v2 record or a legacy Detects summary into a common shape.
// Alerts carry a numeric `severity` (1-100) and/or a `severity_name`; legacy
// detects carry `max_severity_displayname`.
function normalise(record, source) {
  const id = record.composite_id ?? record.id ?? record.detection_id ?? record.alert_id ?? "unknown";
  const created = record.created_timestamp ?? record.created_time ?? record.timestamp ?? null;
  const status = String(record.status ?? "").toLowerCase();

  let severityName = String(record.severity_name ?? record.max_severity_displayname ?? "").toLowerCase();
  if (!severityName && typeof record.severity === "number") {
    const s = record.severity;
    severityName = s >= 80 ? "critical" : s >= 60 ? "high" : s >= 40 ? "medium" : s >= 20 ? "low" : "informational";
  }

  const hostname =
    record.device?.hostname ??
    record.hostname ??
    (Array.isArray(record.devices) ? record.devices[0]?.hostname : null) ??
    null;

  return { id: String(id), created, status, severityName, hostname, source };
}

const OPEN_STATUSES = new Set(["new", "in_progress", "reopened", "reopen"]);

function isHighOrCritical(sev) {
  return sev === "high" || sev === "critical";
}

// Critical/high severity alerts and detections must not sit in an open status
// beyond the triage SLA (default 48 hours).
async function checkHighSeverityBacklog(clients) {
  const { records, source } = await clients.getDetectionData();
  const slaHours = clients.THRESHOLDS.HIGH_SEV_TRIAGE_HOURS;

  const normalised = records.map((r) => normalise(r, source));
  const relevant = normalised.filter((r) => isHighOrCritical(r.severityName) && OPEN_STATUSES.has(r.status));
  const breached = relevant.filter((r) => {
    const age = hoursSince(r.created);
    return age != null && age > slaHours;
  });

  const baseDetails = { source, totalRecords: records.length, openHighSeverity: relevant.length, slaHours };

  if (relevant.length === 0) {
    return [
      {
        resourceId: "detections",
        status: "pass",
        message: `No open critical/high severity ${source} are awaiting triage`,
        evidencePayload: buildEvidencePayload({ resourceType: "crowdstrike_detection", resourceId: "detections", resourceName: "High-severity detection backlog", region: null, details: baseDetails }),
      },
    ];
  }

  if (breached.length === 0) {
    return [
      {
        resourceId: "detections",
        status: "pass",
        message: `${relevant.length} open critical/high severity ${source}, all within the ${slaHours}h triage SLA`,
        evidencePayload: buildEvidencePayload({ resourceType: "crowdstrike_detection", resourceId: "detections", resourceName: "High-severity detection backlog", region: null, details: { ...baseDetails, breachingSla: 0 } }),
      },
    ];
  }

  return breached.map((r) => ({
    resourceId: r.id,
    status: "fail",
    message: `${r.severityName} severity ${source.replace(/s$/, "")} on "${r.hostname ?? "unknown host"}" has been in "${r.status}" for ${Math.round(hoursSince(r.created))}h (> ${slaHours}h triage SLA)`,
    evidencePayload: buildEvidencePayload({
      resourceType: "crowdstrike_detection",
      resourceId: r.id,
      resourceName: r.hostname ? `${r.severityName} — ${r.hostname}` : `${r.severityName} detection`,
      region: null,
      details: { source, severity: r.severityName, status: r.status, createdTimestamp: r.created, ageHours: Math.round(hoursSince(r.created)), slaHours },
    }),
  }));
}

// No detection/alert — regardless of severity — should sit in new / in_progress
// past the review window (default 7 days).
async function checkNoUnresolvedIncidents(clients) {
  const { records, source } = await clients.getDetectionData();
  const maxDays = clients.THRESHOLDS.UNRESOLVED_DETECTION_DAYS;
  const maxHours = maxDays * 24;

  const normalised = records.map((r) => normalise(r, source));
  const open = normalised.filter((r) => OPEN_STATUSES.has(r.status));
  const aged = open.filter((r) => {
    const age = hoursSince(r.created);
    return age != null && age > maxHours;
  });

  const baseDetails = { source, totalRecords: records.length, openRecords: open.length, maxAgeDays: maxDays };

  if (open.length === 0) {
    return [
      {
        resourceId: "detections",
        status: "pass",
        message: `No ${source} are in an unresolved (new / in-progress) state`,
        evidencePayload: buildEvidencePayload({ resourceType: "crowdstrike_detection", resourceId: "detections", resourceName: "Unresolved detections", region: null, details: baseDetails }),
      },
    ];
  }

  if (aged.length === 0) {
    return [
      {
        resourceId: "detections",
        status: "pass",
        message: `${open.length} unresolved ${source}, none older than ${maxDays} days`,
        evidencePayload: buildEvidencePayload({ resourceType: "crowdstrike_detection", resourceId: "detections", resourceName: "Unresolved detections", region: null, details: { ...baseDetails, agedBeyondWindow: 0 } }),
      },
    ];
  }

  return aged.map((r) => ({
    resourceId: r.id,
    status: "fail",
    message: `${source.replace(/s$/, "")} on "${r.hostname ?? "unknown host"}" has been "${r.status}" for ${Math.round(hoursSince(r.created) / 24)} days (> ${maxDays}) — close it out or explicitly defer it with documented justification`,
    evidencePayload: buildEvidencePayload({
      resourceType: "crowdstrike_detection",
      resourceId: r.id,
      resourceName: r.hostname ? `${r.severityName} — ${r.hostname}` : `${r.severityName} detection`,
      region: null,
      details: { source, severity: r.severityName, status: r.status, createdTimestamp: r.created, ageDays: Math.round(hoursSince(r.created) / 24), maxAgeDays: maxDays },
    }),
  }));
}

export const detectionTests = [
  {
    key: "crowdstrike.detection.high_severity_backlog",
    title: "High/critical severity detections are triaged within SLA",
    failTitle: "A high/critical severity detection is past its triage SLA",
    severityDefault: "critical",
    isoReferences: ["A.16.1.5"],
    dpdpaControlAreas: ["Incident Management"],
    run: (clients) => checkHighSeverityBacklog(clients),
  },
  {
    key: "crowdstrike.detection.no_unresolved_incidents",
    title: "No detections remain in an unresolved state past the review window",
    failTitle: "A detection has been left unresolved past the review window",
    severityDefault: "high",
    isoReferences: ["A.16.1.5"],
    dpdpaControlAreas: ["Incident Management"],
    run: (clients) => checkNoUnresolvedIncidents(clients),
  },
];
