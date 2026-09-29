import { aggregate, ageInHours, descriptor, empty, isHighSeverity, isOpenStatus, malformed, row } from "./helpers.js";

async function incidents(clients) {
  const list = await clients.listXdrIncidents();
  return Array.isArray(list) ? list : null;
}

function updatedAt(incident) {
  return incident.lastUpdateTime ?? incident.updateTime ?? incident.updated ?? incident.modified ?? incident.lastUpdated;
}
function createdAt(incident) {
  return incident.creationTime ?? incident.createTime ?? incident.created ?? incident.firstSeen ?? incident.timestamp;
}
function statusOf(incident) {
  return incident.status ?? incident.state ?? incident.handlingStatus;
}

async function checkFeedActive(clients) {
  const list = await incidents(clients);
  if (!list) return malformed("xdr", "The Infinity XDR/XPR incidents endpoint did not return an array");
  return list.length
    ? aggregate("xdr", "pass", `Infinity XDR/XPR has ${list.length} incident(s) in the lookback window`, { incidentCount: list.length })
    : empty("xdr", "Infinity XDR/XPR reported no incidents in the lookback window");
}

async function checkHighIncidentsTriaged(clients) {
  const list = await incidents(clients);
  if (!list) return malformed("xdr", "The Infinity XDR/XPR incidents endpoint did not return an array");
  if (!list.length) return empty("xdr", "Infinity XDR/XPR reported no incidents in the lookback window");
  const withSeverity = list.filter((i) => i.severity != null || i.priority != null);
  if (!withSeverity.length) return malformed("xdr", "Infinity XDR/XPR incidents carry no severity field");
  const slaHours = clients.THRESHOLDS.XDR_TRIAGE_SLA_HOURS;
  const findings = list.filter((i) => {
    if (!isHighSeverity(i.severity ?? i.priority)) return false;
    if (!isOpenStatus(statusOf(i))) return false;
    const age = ageInHours(createdAt(i));
    return age == null || age > slaHours;
  });
  return findings.length
    ? findings.map((i) => row("xdr", i, "fail", `High/critical XDR incident "${i.name ?? i.id}" has been open longer than the ${slaHours}h triage SLA`, { severity: i.severity ?? i.priority, status: statusOf(i) }))
    : aggregate("xdr", "pass", `All high/critical XDR incidents were triaged within the ${slaHours}h SLA`, { incidentCount: list.length });
}

async function checkNoStaleInvestigations(clients) {
  const list = await incidents(clients);
  if (!list) return malformed("xdr", "The Infinity XDR/XPR incidents endpoint did not return an array");
  if (!list.length) return empty("xdr", "Infinity XDR/XPR reported no incidents in the lookback window");
  const staleDays = clients.THRESHOLDS.XDR_STALE_INVESTIGATION_DAYS;
  const open = list.filter((i) => isOpenStatus(statusOf(i)));
  const unknownUpdate = open.find((i) => ageInHours(updatedAt(i)) == null && ageInHours(createdAt(i)) == null);
  if (unknownUpdate) return malformed("xdr", "Infinity XDR/XPR incidents carry no usable update/creation timestamp", unknownUpdate);
  const findings = open.filter((i) => {
    const age = ageInHours(updatedAt(i) ?? createdAt(i));
    return age != null && age > staleDays * 24;
  });
  return findings.length
    ? findings.map((i) => row("xdr", i, "fail", `Open XDR incident "${i.name ?? i.id}" has not been updated in over ${staleDays} days`, { status: statusOf(i), lastUpdate: updatedAt(i) ?? null }))
    : aggregate("xdr", "pass", `No open XDR incident has stalled past ${staleDays} days without an update`, { openCount: open.length });
}

export const xdrTests = [
  descriptor({ key: "check_point.xdr.feed_active", title: "Infinity XDR/XPR has produced detections or incidents within the lookback window", failTitle: "Infinity XDR/XPR produced no detections or incidents in the lookback window", severityDefault: "low", isoReferences: ["A.12.4.1"], dpdpaControlAreas: ["Logging & Monitoring"], run: checkFeedActive }),
  descriptor({ key: "check_point.xdr.high_incidents_triaged", title: "High and critical XDR/XPR incidents are not open past the triage SLA", failTitle: "A high or critical XDR/XPR incident is open past the triage SLA", severityDefault: "critical", isoReferences: ["A.16.1.5"], dpdpaControlAreas: ["Incident Management"], run: checkHighIncidentsTriaged }),
  descriptor({ key: "check_point.xdr.no_stale_investigations", title: "XDR/XPR incidents are not left un-progressed past the review window", failTitle: "An open XDR/XPR incident has stalled without an update", severityDefault: "medium", isoReferences: ["A.16.1.4"], dpdpaControlAreas: ["Incident Management"], run: checkNoStaleInvestigations }),
];
