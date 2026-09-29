import { buildEvidencePayload } from "../../shared/evidencePayload.js";

const CLOSED_STATUSES = new Set(["complete", "completed", "fulfilled", "rejected", "closed", "cancelled"]);
const EARLY_STATUSES = new Set(["new", "received", "verifying identity", "identity verification", "pending verification", "intake"]);
const PROGRESS_DAYS = 7;

function daysSince(value) {
  const t = Date.parse(value);
  return Number.isNaN(t) ? null : (Date.now() - t) / 86400000;
}

function isOpen(r) {
  return !CLOSED_STATUSES.has(String(r.status || "").toLowerCase()) && !r.closedAt && !r.closureDate;
}

function payload(r, details) {
  return buildEvidencePayload({
    resourceType: "privy_rights_request",
    resourceId: String(r.id ?? r.requestId ?? r.referenceId ?? "unknown"),
    resourceName: r.referenceId ? String(r.referenceId) : String(r.id ?? r.requestId ?? "unknown"),
    region: null,
    details,
  });
}

function emptyOrPass(open, passMessage) {
  if (open.length === 0) {
    return [{ resourceId: "rights", status: "not_applicable", message: "No data-principal rights requests exist in Privy to evaluate", evidencePayload: payload({}, {}) }];
  }
  return [{ resourceId: "rights", status: "pass", message: passMessage, evidencePayload: payload({}, { requestsChecked: open.length }) }];
}

// Open rights requests must be inside their DPDP statutory deadline.
async function checkWithinStatutoryDeadline(clients) {
  const requests = await clients.listRightsRequests();
  const open = requests.filter(isOpen);
  const rows = [];
  for (const r of open) {
    const slaBreached =
      r.slaBreached === true ||
      String(r.slaStatus || "").toLowerCase() === "breached" ||
      String(r.slaExceeded || "").toLowerCase() === "yes";
    const remaining = r.daysToDeadline ?? r.remainingDays ?? r.dueInDays;
    const dueAt = r.dueDate ?? r.deadline;
    const overdue =
      slaBreached ||
      (typeof remaining === "number" && remaining < 0) ||
      (dueAt && Date.parse(dueAt) < Date.now());
    if (overdue) {
      rows.push({
        resourceId: String(r.id ?? r.requestId),
        status: "fail",
        message: `Rights request ${r.referenceId ?? r.id ?? r.requestId} has breached its statutory deadline`,
        evidencePayload: payload(r, { status: r.status, slaBreached, remainingDays: remaining ?? null, dueDate: dueAt ?? null }),
      });
    }
  }
  if (rows.length === 0) return emptyOrPass(open, `All ${open.length} open rights request(s) are within their statutory deadline`);
  return rows;
}

// Early-stage requests (New / Verifying identity) shouldn't sit untouched for
// more than 7 days, net of any paused time.
async function checkProgressing(clients) {
  const requests = await clients.listRightsRequests();
  const open = requests.filter(isOpen);
  const rows = [];
  for (const r of open) {
    if (!EARLY_STATUSES.has(String(r.status || "").toLowerCase())) continue;
    const age = daysSince(r.createdAt ?? r.receivedAt ?? r.submittedAt);
    if (age == null) continue;
    const paused = Number(r.daysPaused ?? r.pausedDays) || 0;
    const activeDays = age - paused;
    if (activeDays > PROGRESS_DAYS) {
      rows.push({
        resourceId: String(r.id ?? r.requestId),
        status: "fail",
        message: `Rights request ${r.referenceId ?? r.id ?? r.requestId} has been in "${r.status}" for ${Math.round(activeDays)} active days`,
        evidencePayload: payload(r, { status: r.status, activeDays: Math.round(activeDays), daysPaused: paused }),
      });
    }
  }
  if (rows.length === 0) return emptyOrPass(open, `All open early-stage rights request(s) have progressed within ${PROGRESS_DAYS} active days`);
  return rows;
}

// The rights register is "operating" if it is reachable and has handled at least
// one request in the trailing 12 months.
async function checkRegisterOperating(clients) {
  const requests = await clients.listRightsRequests();
  const recent = requests.filter((r) => {
    const age = daysSince(r.createdAt ?? r.receivedAt ?? r.submittedAt);
    return age != null && age <= 365;
  });
  return [
    {
      resourceId: "rights-register",
      status: recent.length > 0 ? "pass" : "fail",
      message:
        recent.length > 0
          ? `The DPRM register is operating — ${recent.length} rights request(s) in the last 12 months`
          : "No data-principal rights request has been logged in Privy in the last 12 months",
      evidencePayload: buildEvidencePayload({
        resourceType: "privy_rights_register",
        resourceId: "rights-register",
        resourceName: "Data-principal rights register",
        region: null,
        details: { totalRequests: requests.length, requestsLast12Months: recent.length },
      }),
    },
  ];
}

export const dataRightsTests = [
  {
    key: "privy.rights.within_statutory_deadline",
    title: "Data-principal rights requests are handled within the statutory deadline",
    failTitle: "Data-principal rights request has breached its statutory deadline",
    severityDefault: "high",
    isoReferences: ["A.18.1.4"],
    dpdpaControlAreas: ["Data Principal Rights"],
    run: (clients) => checkWithinStatutoryDeadline(clients),
  },
  {
    key: "privy.rights.progressing",
    title: "New rights requests are progressing, not sitting untouched",
    failTitle: "Rights request has sat in an early stage for over 7 active days",
    severityDefault: "medium",
    isoReferences: ["A.18.1.4"],
    dpdpaControlAreas: ["Data Principal Rights"],
    run: (clients) => checkProgressing(clients),
  },
  {
    key: "privy.rights.register_operating",
    title: "The data-principal rights register is in active use",
    failTitle: "No rights request has been logged in the last 12 months",
    severityDefault: "low",
    isoReferences: ["A.18.1.4"],
    dpdpaControlAreas: ["Data Principal Rights"],
    run: (clients) => checkRegisterOperating(clients),
  },
];
