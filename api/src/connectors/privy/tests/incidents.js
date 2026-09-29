import { buildEvidencePayload } from "../../shared/evidencePayload.js";

const STALE_DAYS = 30;
const DECISION_GRACE_HOURS = 72;
const OPEN_STATUSES = new Set(["open", "new", "investigating", "in_progress", "in progress", "triage", "assessing"]);

function hoursSince(value) {
  const t = Date.parse(value);
  return Number.isNaN(t) ? null : (Date.now() - t) / 3600000;
}
function daysSince(value) {
  const h = hoursSince(value);
  return h == null ? null : h / 24;
}
function isOpen(i) {
  const s = String(i.status || i.state || "").toLowerCase();
  if (s) return OPEN_STATUSES.has(s) || (!s.includes("closed") && !s.includes("resolved"));
  return !i.closedAt && !i.resolvedAt;
}
function payload(i, details) {
  return buildEvidencePayload({
    resourceType: "privy_incident",
    resourceId: String(i.id ?? i.incidentId ?? i.reference ?? "unknown"),
    resourceName: i.reference ? String(i.reference) : String(i.id ?? i.incidentId ?? "unknown"),
    region: null,
    details,
  });
}

// A breach-notification decision is "recorded" if any of the known decision
// fields on the incident detail carries a real value.
function decisionState(detail) {
  if (!detail || typeof detail !== "object") return { available: false, recorded: false };
  const candidates = [
    detail.breachNotificationDecision,
    detail.notificationDecision,
    detail.breachDecision,
    detail.regulatorNotificationRequired,
    detail.dataPrincipalNotificationRequired,
    detail.boardNotificationRequired,
    detail.isNotifiable,
    detail.notifiable,
    detail?.breachAssessment?.decision,
    detail?.assessment?.notificationDecision,
  ];
  const present = candidates.filter((v) => v !== undefined);
  if (present.length === 0) return { available: false, recorded: false };
  const recorded = present.some((v) => v !== null && v !== "" && v !== "NOT_ASSESSED" && v !== "PENDING" && v !== "UNKNOWN");
  return { available: true, recorded };
}

async function checkNoStaleOpen(clients) {
  const incidents = await clients.listIncidents();
  const open = incidents.filter(isOpen);
  if (open.length === 0) {
    return [{ resourceId: "incidents", status: "not_applicable", message: incidents.length === 0 ? "No incidents exist in Privy to evaluate" : "No open incidents to evaluate for staleness", evidencePayload: payload({}, { openIncidents: 0 }) }];
  }
  const rows = [];
  for (const i of open) {
    const age = daysSince(i.updatedAt || i.lastUpdated || i.createdAt);
    if (age == null) continue;
    if (age > STALE_DAYS) {
      rows.push({
        resourceId: String(i.id ?? i.incidentId),
        status: "fail",
        message: `Incident ${i.reference ?? i.id ?? i.incidentId} is open and has had no update in ${Math.round(age)} days`,
        evidencePayload: payload(i, { type: i.type ?? i.category ?? null, daysSinceUpdate: Math.round(age) }),
      });
    }
  }
  if (rows.length === 0) {
    return [{ resourceId: "incidents", status: "pass", message: `All ${open.length} open incident(s) were updated within ${STALE_DAYS} days`, evidencePayload: payload({}, { openIncidents: open.length }) }];
  }
  return rows;
}

async function checkBreachDecisionRecorded(clients) {
  const incidents = await clients.listIncidents();
  const candidates = incidents.filter((i) => {
    if (!isOpen(i)) return false;
    const age = hoursSince(i.createdAt || i.reportedAt);
    return age != null && age > DECISION_GRACE_HOURS;
  });
  if (candidates.length === 0) {
    return [{ resourceId: "incidents", status: "not_applicable", message: "No open incident is older than 72h and awaiting a breach-notification decision", evidencePayload: payload({}, {}) }];
  }
  const rows = [];
  let anyDecisionFieldSeen = false;
  for (const i of candidates) {
    let detail;
    try {
      detail = await clients.getIncident(i.id ?? i.incidentId);
    } catch {
      rows.push({ resourceId: String(i.id ?? i.incidentId), status: "not_applicable", message: `Could not load incident ${i.reference ?? i.id} detail to check its breach-notification decision`, evidencePayload: payload(i, {}) });
      continue;
    }
    const { available, recorded } = decisionState(detail);
    if (available) anyDecisionFieldSeen = true;
    if (!available) {
      rows.push({ resourceId: String(i.id ?? i.incidentId), status: "not_applicable", message: `Incident ${i.reference ?? i.id} detail exposes no breach-notification decision field`, evidencePayload: payload(i, {}) });
      continue;
    }
    if (!recorded) {
      rows.push({
        resourceId: String(i.id ?? i.incidentId),
        status: "fail",
        message: `Incident ${i.reference ?? i.id} is >72h old with no breach-notification decision recorded`,
        evidencePayload: payload(i, { type: i.type ?? i.category ?? null, createdAt: i.createdAt ?? null }),
      });
    }
  }
  if (rows.length && rows.every((r) => r.status === "not_applicable") && !anyDecisionFieldSeen) {
    return rows;
  }
  if (rows.length === 0) {
    return [{ resourceId: "incidents", status: "pass", message: `All ${candidates.length} open incident(s) older than 72h have a breach-notification decision recorded`, evidencePayload: payload({}, { incidentsChecked: candidates.length }) }];
  }
  return rows;
}

async function checkRegisterOperating(clients) {
  const incidents = await clients.listIncidents();
  const recent = incidents.filter((i) => {
    const age = daysSince(i.createdAt || i.reportedAt);
    return age != null && age <= 365;
  });
  return [
    {
      resourceId: "incident-register",
      status: recent.length > 0 ? "pass" : "fail",
      message:
        recent.length > 0
          ? `Incident register is operating — ${recent.length} incident(s) logged in the last 12 months`
          : "No incidents have been logged in Privy in the last 12 months — the incident register may not be in active use",
      evidencePayload: buildEvidencePayload({
        resourceType: "privy_incident_register",
        resourceId: "incident-register",
        resourceName: "Incident register",
        region: null,
        details: { totalIncidents: incidents.length, incidentsLast12Months: recent.length },
      }),
    },
  ];
}

export const incidentsTests = [
  {
    key: "privy.incidents.no_stale_open",
    title: "Open incidents are being worked, not left stale",
    failTitle: "Open incident has had no update in over 30 days",
    severityDefault: "medium",
    isoReferences: ["A.16.1.5"],
    dpdpaControlAreas: ["Breach Identification & Classification"],
    run: (clients) => checkNoStaleOpen(clients),
  },
  {
    key: "privy.incidents.breach_decision_recorded",
    title: "Breach-notification decisions are recorded promptly",
    failTitle: "Open incident older than 72h has no breach-notification decision recorded",
    severityDefault: "high",
    isoReferences: ["A.16.1.4"],
    dpdpaControlAreas: ["Breach Identification & Classification"],
    run: (clients) => checkBreachDecisionRecorded(clients),
  },
  {
    key: "privy.incidents.register_operating",
    title: "The incident register is in active use",
    failTitle: "No incident has been logged in the last 12 months",
    severityDefault: "low",
    isoReferences: ["A.16.1.2"],
    dpdpaControlAreas: ["Breach Identification & Classification"],
    run: (clients) => checkRegisterOperating(clients),
  },
];
