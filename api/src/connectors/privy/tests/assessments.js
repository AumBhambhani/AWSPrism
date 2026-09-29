import { buildEvidencePayload } from "../../shared/evidencePayload.js";

const OPEN_STATUSES = new Set(["draft", "not_started", "not started", "in_progress", "in progress", "in_review", "in review", "under_review"]);
const DONE_STATUSES = new Set(["completed", "complete", "approved", "closed", "published"]);
const STALE_DAYS = 90;
const HIGH = new Set(["HIGH", "VERY_HIGH", "VERY HIGH", "CRITICAL", "SEVERE"]);
const RESOLVED = new Set(["MITIGATED", "CLOSED", "ACCEPTED", "RESOLVED", "TRANSFERRED", "AVOIDED", "REDUCED", "TREATED"]);

function daysSince(value) {
  const t = Date.parse(value);
  return Number.isNaN(t) ? null : (Date.now() - t) / 86400000;
}
function statusOf(a) {
  return String(a.status ?? a.state ?? a.stage ?? "").toLowerCase();
}
function isPia(a) {
  const t = `${a.type || ""} ${a.templateType || ""} ${a.templateName || ""} ${a.name || ""}`.toUpperCase();
  return t.includes("PIA") || t.includes("DPIA") || t.includes("PRIVACY IMPACT") || t.includes("DATA PROTECTION IMPACT") || t.includes("DPA");
}
function payload(a, details) {
  return buildEvidencePayload({
    resourceType: "privy_assessment",
    resourceId: String(a.id ?? a.assessmentId ?? a.reference ?? "unknown"),
    resourceName: a.name ? String(a.name) : String(a.reference ?? a.id ?? "unknown"),
    region: null,
    details,
  });
}

async function checkNoStaleInProgress(clients) {
  const assessments = await clients.listAssessments();
  if (assessments.length === 0) {
    return [{ resourceId: "no-assessments", status: "not_applicable", message: "No assessments exist in Privy to evaluate", evidencePayload: payload({ id: "no-assessments", name: "No assessments" }, {}) }];
  }
  const open = assessments.filter((a) => OPEN_STATUSES.has(statusOf(a)));
  const rows = [];
  for (const a of open) {
    const id = a.id ?? a.assessmentId ?? a.reference;
    const age = daysSince(a.updatedAt || a.lastModified || a.createdAt);
    if (age == null) continue;
    if (age > STALE_DAYS) {
      rows.push({
        resourceId: String(id),
        status: "fail",
        message: `Assessment ${a.name ?? id} is "${statusOf(a)}" and has not been updated in ${Math.round(age)} days`,
        evidencePayload: payload(a, { status: statusOf(a), daysSinceUpdate: Math.round(age) }),
      });
    }
  }
  if (rows.length === 0) {
    return [{ resourceId: "assessments", status: "pass", message: `All ${open.length} in-progress assessment(s) were updated within ${STALE_DAYS} days`, evidencePayload: payload({ id: "assessments", name: "In-progress assessments" }, { openAssessments: open.length }) }];
  }
  return rows;
}

async function checkHighRisksMitigated(clients) {
  const assessments = await clients.listAssessments();
  const done = assessments.filter((a) => DONE_STATUSES.has(statusOf(a)));
  if (done.length === 0) {
    return [{ resourceId: "no-completed-assessments", status: "not_applicable", message: "No completed assessments to inspect for unmitigated risks", evidencePayload: payload({ id: "no-completed-assessments", name: "No completed assessments" }, {}) }];
  }
  const rows = [];
  let risksSeen = 0;
  for (const a of done) {
    const id = a.id ?? a.assessmentId ?? a.reference;
    let detail;
    try {
      detail = await clients.exportAssessment(id);
    } catch {
      rows.push({ resourceId: String(id), status: "not_applicable", message: `Could not load assessment ${a.name ?? id} to read its risks`, evidencePayload: payload(a, {}) });
      continue;
    }
    const risks = detail?.risks || detail?.assessment?.risks || detail?.findings || [];
    for (const r of risks) {
      risksSeen += 1;
      const level = String(r.level ?? r.riskLevel ?? r.rating ?? r.severity ?? "").toUpperCase();
      const state = String(r.state ?? r.status ?? r.riskState ?? "").toUpperCase();
      if (!HIGH.has(level)) continue;
      if (RESOLVED.has(state)) continue;
      rows.push({
        resourceId: `${id}:${r.id ?? r.riskId ?? r.name ?? risksSeen}`,
        status: "fail",
        message: `Assessment ${a.name ?? id} has a ${level} risk in state "${state || "unknown"}" that is not mitigated`,
        evidencePayload: payload(a, { riskLevel: level, riskState: state, riskName: r.name ?? r.description ?? null }),
      });
    }
  }
  if (risksSeen === 0) {
    return [{ resourceId: "completed-assessments", status: "not_applicable", message: `No risks recorded on ${done.length} completed assessment(s)`, evidencePayload: payload({ id: "completed-assessments", name: "Completed assessments" }, { completed: done.length }) }];
  }
  if (rows.length === 0) {
    return [{ resourceId: "completed-assessments", status: "pass", message: `All High / Very High risks across ${done.length} completed assessment(s) are in a mitigated state`, evidencePayload: payload({ id: "completed-assessments", name: "Completed assessments" }, { completed: done.length, risksReviewed: risksSeen }) }];
  }
  return rows;
}

async function checkDpiaProcessOperating(clients) {
  const assessments = await clients.listAssessments();
  const pia = assessments.filter(isPia);
  if (pia.length === 0) {
    return [{ resourceId: "dpia-process", status: "fail", message: "No PIA/DPIA-type assessments found in Privy — no evidence a privacy impact assessment process is operating", evidencePayload: payload({ id: "dpia-process", name: "DPIA process" }, { piaAssessments: 0 }) }];
  }
  const recent = pia.filter((a) => {
    if (!DONE_STATUSES.has(statusOf(a))) return false;
    const age = daysSince(a.completedAt || a.approvedAt || a.updatedAt || a.createdAt);
    return age != null && age <= 365;
  });
  return [
    {
      resourceId: "dpia-process",
      status: recent.length > 0 ? "pass" : "fail",
      message:
        recent.length > 0
          ? `${recent.length} PIA/DPIA assessment(s) completed in the last 12 months`
          : `${pia.length} PIA/DPIA assessment(s) exist but none were completed in the last 12 months`,
      evidencePayload: payload({ id: "dpia-process", name: "DPIA process" }, { piaAssessments: pia.length, completedInLast12Months: recent.length }),
    },
  ];
}

export const assessmentsTests = [
  {
    key: "privy.assessments.no_stale_in_progress",
    title: "In-progress assessments are progressing, not stalled",
    failTitle: "Assessment has been left in progress without updates for 90+ days",
    severityDefault: "medium",
    isoReferences: ["A.18.2.2"],
    dpdpaControlAreas: ["Security Safeguards Program"],
    run: (clients) => checkNoStaleInProgress(clients),
  },
  {
    key: "privy.assessments.high_risks_mitigated",
    title: "High risks on completed assessments are mitigated",
    failTitle: "Completed assessment has an unmitigated High / Very High risk",
    severityDefault: "high",
    isoReferences: ["A.18.1.4"],
    dpdpaControlAreas: ["Security Safeguards Program"],
    run: (clients) => checkHighRisksMitigated(clients),
  },
  {
    key: "privy.assessments.dpia_process_operating",
    title: "A PIA/DPIA process is operating",
    failTitle: "No PIA/DPIA assessment has been completed in the last 12 months",
    severityDefault: "medium",
    isoReferences: ["A.18.1.4"],
    dpdpaControlAreas: ["Security Safeguards Program"],
    run: (clients) => checkDpiaProcessOperating(clients),
  },
];
