import { buildEvidencePayload } from "../../shared/evidencePayload.js";

const CLOSED_STATUSES = new Set(["complete", "completed", "rejected", "closed"]);
const EARLY_STATUSES = new Set(["new", "verifying identity", "identity verification", "pending verification"]);
const PROGRESS_DAYS = 7;
const MAX_PAUSE_DAYS = 30;

function daysSince(value) {
  const t = Date.parse(value);
  return Number.isNaN(t) ? null : (Date.now() - t) / 86400000;
}

function isOpen(r) {
  return !CLOSED_STATUSES.has(String(r.status || "").toLowerCase()) && !r.closureDate;
}

function payload(r, details) {
  return buildEvidencePayload({
    resourceType: "onetrust_dsar_request",
    resourceId: String(r.requestQueueId ?? r.id ?? "unknown"),
    resourceName: r.requestQueueRefId ? String(r.requestQueueRefId) : String(r.requestQueueId ?? r.id ?? "unknown"),
    region: null,
    details,
  });
}

function emptyOrPass(queues, passMessage, resourceLabel) {
  if (queues.length === 0) {
    return [{ resourceId: "dsar", status: "not_applicable", message: "No data-subject requests exist in OneTrust to evaluate", evidencePayload: buildEvidencePayload({ resourceType: "onetrust_dsar_request", resourceId: "dsar", resourceName: resourceLabel, region: null, details: {} }) }];
  }
  return [{ resourceId: "dsar", status: "pass", message: passMessage, evidencePayload: buildEvidencePayload({ resourceType: "onetrust_dsar_request", resourceId: "dsar", resourceName: resourceLabel, region: null, details: { requestsChecked: queues.length } }) }];
}

// Open DSARs must be inside their statutory deadline.
async function checkWithinStatutoryDeadline(clients) {
  const queues = await clients.listDsarQueues();
  const open = queues.filter(isOpen);
  const rows = [];
  for (const r of open) {
    const slaExceeded = String(r.slaExceeded || "").toLowerCase() === "yes";
    const remaining = r.remainingDaysForMaxDeadline;
    const overdue = slaExceeded || (typeof remaining === "number" && remaining < 0);
    if (overdue) {
      rows.push({
        resourceId: String(r.requestQueueId ?? r.id),
        status: "fail",
        message: `DSAR ${r.requestQueueRefId ?? r.requestQueueId ?? r.id} has breached its statutory deadline (slaExceeded=${r.slaExceeded ?? "?"}, remainingDays=${remaining ?? "?"})`,
        evidencePayload: payload(r, { status: r.status, slaExceeded: r.slaExceeded, remainingDaysForMaxDeadline: remaining }),
      });
    }
  }
  if (rows.length === 0) return emptyOrPass(open, `All ${open.length} open DSAR(s) are within their statutory deadline`, "Data-subject requests");
  return rows;
}

// Early-stage DSARs (New / Verifying identity) shouldn't sit untouched for more
// than 7 working days, net of any paused time.
async function checkProgressing(clients) {
  const queues = await clients.listDsarQueues();
  const open = queues.filter(isOpen);
  const rows = [];
  for (const r of open) {
    if (!EARLY_STATUSES.has(String(r.status || "").toLowerCase())) continue;
    const age = daysSince(r.creationDate);
    if (age == null) continue;
    const paused = Number(r.daysPaused) || 0;
    const activeDays = age - paused;
    if (activeDays > PROGRESS_DAYS) {
      rows.push({
        resourceId: String(r.requestQueueId ?? r.id),
        status: "fail",
        message: `DSAR ${r.requestQueueRefId ?? r.requestQueueId ?? r.id} has been in "${r.status}" for ${Math.round(activeDays)} active days`,
        evidencePayload: payload(r, { status: r.status, creationDate: r.creationDate, daysPaused: paused, activeDays: Math.round(activeDays) }),
      });
    }
  }
  if (rows.length === 0) return emptyOrPass(open, `All open early-stage DSAR(s) have progressed within ${PROGRESS_DAYS} active days`, "Data-subject requests");
  return rows;
}

// A DSAR paused for more than 30 days needs review — an indefinite pause is a
// way to silently miss the deadline.
async function checkNoExcessivePause(clients) {
  const queues = await clients.listDsarQueues();
  const open = queues.filter(isOpen);
  const rows = [];
  for (const r of open) {
    const paused = Number(r.daysPaused);
    if (!Number.isFinite(paused)) continue;
    if (paused > MAX_PAUSE_DAYS) {
      rows.push({
        resourceId: String(r.requestQueueId ?? r.id),
        status: "fail",
        message: `DSAR ${r.requestQueueRefId ?? r.requestQueueId ?? r.id} has been paused for ${paused} days`,
        evidencePayload: payload(r, { status: r.status, daysPaused: paused }),
      });
    }
  }
  if (rows.length === 0) return emptyOrPass(open, `No open DSAR is paused longer than ${MAX_PAUSE_DAYS} days`, "Data-subject requests");
  return rows;
}

export const privacyRightsTests = [
  {
    key: "onetrust.dsar.within_statutory_deadline",
    title: "Data-subject requests are handled within the statutory deadline",
    failTitle: "Data-subject request has breached its statutory deadline",
    severityDefault: "high",
    isoReferences: ["A.18.1.4"],
    dpdpaControlAreas: ["Data Principal Rights"],
    run: (clients) => checkWithinStatutoryDeadline(clients),
  },
  {
    key: "onetrust.dsar.progressing",
    title: "New data-subject requests are progressing, not sitting untouched",
    failTitle: "Data-subject request has sat in an early stage for over 7 active days",
    severityDefault: "medium",
    isoReferences: ["A.18.1.4"],
    dpdpaControlAreas: ["Data Principal Rights"],
    run: (clients) => checkProgressing(clients),
  },
  {
    key: "onetrust.dsar.no_excessive_pause",
    title: "Data-subject requests are not paused indefinitely",
    failTitle: "Data-subject request has been paused for more than 30 days",
    severityDefault: "low",
    isoReferences: ["A.18.1.4"],
    dpdpaControlAreas: ["Data Principal Rights"],
    run: (clients) => checkNoExcessivePause(clients),
  },
];
