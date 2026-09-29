import { buildEvidencePayload } from "../../shared/evidencePayload.js";

const OPEN_STATUSES = new Set(["NOT_STARTED", "IN_PROGRESS", "UNDER_REVIEW"]);
const STALE_DAYS = 90;

function daysSince(value) {
  const t = Date.parse(value);
  return Number.isNaN(t) ? null : (Date.now() - t) / 86400000;
}

function payload(resourceId, resourceName, details) {
  return buildEvidencePayload({
    resourceType: "onetrust_assessment",
    resourceId: String(resourceId),
    resourceName: resourceName ? String(resourceName) : String(resourceId),
    region: null,
    details,
  });
}

function isPiaTemplate(a) {
  const t = `${a.templateType || ""} ${a.templateName || ""} ${a.name || ""}`.toUpperCase();
  return t.includes("PIA") || t.includes("DPIA") || t.includes("PRIVACY IMPACT") || t.includes("DATA PROTECTION IMPACT");
}

// Assessments left NOT_STARTED / IN_PROGRESS / UNDER_REVIEW with no edit in 90+
// days — stalled PIA/DPIA work is a review-cadence gap.
async function checkNoStaleInProgress(clients) {
  const assessments = await clients.listAssessments();
  if (assessments.length === 0) {
    return [
      { resourceId: "no-assessments", status: "not_applicable", message: "No assessments exist in OneTrust to evaluate", evidencePayload: payload("no-assessments", "No assessments", {}) },
    ];
  }

  const open = assessments.filter((a) => OPEN_STATUSES.has(a.assessmentStatus));
  const rows = [];
  for (const a of open) {
    const id = a.assessmentId ?? a.assessmentNumber;
    const age = daysSince(a.lastModifiedDate || a.creationDate);
    if (age == null) {
      rows.push({
        resourceId: String(id),
        status: "not_applicable",
        message: `Assessment ${a.assessmentNumber ?? id} has no usable last-modified date`,
        evidencePayload: payload(id, a.assessmentNumber, { assessmentStatus: a.assessmentStatus }),
      });
      continue;
    }
    if (age > STALE_DAYS) {
      rows.push({
        resourceId: String(id),
        status: "fail",
        message: `Assessment ${a.assessmentNumber ?? id} is ${a.assessmentStatus} and has not been updated in ${Math.round(age)} days`,
        evidencePayload: payload(id, a.assessmentNumber, {
          assessmentStatus: a.assessmentStatus,
          assessmentStage: a.assessmentStage,
          lastModifiedDate: a.lastModifiedDate,
          daysSinceUpdate: Math.round(age),
        }),
      });
    }
  }

  if (rows.length === 0) {
    return [
      {
        resourceId: "assessments",
        status: "pass",
        message: `All ${open.length} in-progress assessment(s) were updated within ${STALE_DAYS} days`,
        evidencePayload: payload("assessments", "In-progress assessments", { openAssessments: open.length }),
      },
    ];
  }
  return rows;
}

// For COMPLETED assessments, pull the detail export and flag any High / Very High
// risk that isn't in a mitigated / closed / accepted state.
async function checkHighRisksMitigated(clients) {
  const assessments = await clients.listAssessments();
  const completed = assessments.filter((a) => a.assessmentStatus === "COMPLETED");
  if (completed.length === 0) {
    return [
      { resourceId: "no-completed-assessments", status: "not_applicable", message: "No COMPLETED assessments to inspect for unmitigated risks", evidencePayload: payload("no-completed-assessments", "No completed assessments", {}) },
    ];
  }

  const HIGH = new Set(["HIGH", "VERY_HIGH", "VERY HIGH", "CRITICAL"]);
  const RESOLVED = new Set(["MITIGATED", "CLOSED", "ACCEPTED", "RESOLVED", "TRANSFERRED", "AVOIDED", "REDUCED"]);
  const rows = [];
  let risksSeen = 0;

  for (const a of completed) {
    const id = a.assessmentId ?? a.assessmentNumber;
    let detail;
    try {
      detail = await clients.exportAssessment(id);
    } catch {
      rows.push({
        resourceId: String(id),
        status: "not_applicable",
        message: `Could not export assessment ${a.assessmentNumber ?? id} to read its risks`,
        evidencePayload: payload(id, a.assessmentNumber, {}),
      });
      continue;
    }
    const risks = detail?.risks || detail?.assessment?.risks || [];
    for (const r of risks) {
      risksSeen += 1;
      const level = String(r.level ?? r.riskLevel ?? r.rating ?? "").toUpperCase();
      const state = String(r.state ?? r.status ?? r.riskState ?? "").toUpperCase();
      if (!HIGH.has(level)) continue;
      if (RESOLVED.has(state)) continue;
      rows.push({
        resourceId: `${id}:${r.id ?? r.riskId ?? r.name ?? risksSeen}`,
        status: "fail",
        message: `Assessment ${a.assessmentNumber ?? id} has a ${level} risk in state "${state || "unknown"}" that is not mitigated`,
        evidencePayload: payload(`${id}:${r.id ?? r.riskId ?? risksSeen}`, a.assessmentNumber, {
          riskLevel: level,
          riskState: state,
          riskName: r.name ?? r.description ?? null,
        }),
      });
    }
  }

  if (risksSeen === 0) {
    return [
      { resourceId: "completed-assessments", status: "not_applicable", message: `No risks recorded on ${completed.length} COMPLETED assessment(s)`, evidencePayload: payload("completed-assessments", "Completed assessments", { completed: completed.length }) },
    ];
  }
  if (rows.length === 0) {
    return [
      { resourceId: "completed-assessments", status: "pass", message: `All High / Very High risks across ${completed.length} COMPLETED assessment(s) are in a mitigated state`, evidencePayload: payload("completed-assessments", "Completed assessments", { completed: completed.length, risksReviewed: risksSeen }) },
    ];
  }
  return rows;
}

// A DPIA/PIA process is "operating" if at least one PIA/DPIA-template assessment
// was completed in the trailing 12 months.
async function checkDpiaProcessOperating(clients) {
  const assessments = await clients.listAssessments();
  const piaAssessments = assessments.filter(isPiaTemplate);
  if (piaAssessments.length === 0) {
    return [
      {
        resourceId: "dpia-process",
        status: "fail",
        message: "No PIA/DPIA-template assessments found in OneTrust — no evidence a privacy impact assessment process is operating",
        evidencePayload: payload("dpia-process", "DPIA process", { piaAssessments: 0 }),
      },
    ];
  }

  const completedRecently = piaAssessments.filter((a) => {
    if (a.assessmentStatus !== "COMPLETED") return false;
    const age = daysSince(a.completionDate || a.lastModifiedDate || a.creationDate);
    return age != null && age <= 365;
  });

  return [
    {
      resourceId: "dpia-process",
      status: completedRecently.length > 0 ? "pass" : "fail",
      message:
        completedRecently.length > 0
          ? `${completedRecently.length} PIA/DPIA assessment(s) completed in the last 12 months`
          : `${piaAssessments.length} PIA/DPIA-template assessment(s) exist but none were completed in the last 12 months`,
      evidencePayload: payload("dpia-process", "DPIA process", {
        piaAssessments: piaAssessments.length,
        completedInLast12Months: completedRecently.length,
      }),
    },
  ];
}

export const assessmentsTests = [
  {
    key: "onetrust.assessments.no_stale_in_progress",
    title: "In-progress assessments are progressing, not stalled",
    failTitle: "Assessment has been left in progress without updates for 90+ days",
    severityDefault: "medium",
    isoReferences: ["A.18.2.2"],
    dpdpaControlAreas: ["Security Safeguards Program"],
    run: (clients) => checkNoStaleInProgress(clients),
  },
  {
    key: "onetrust.assessments.high_risks_mitigated",
    title: "High risks on completed assessments are mitigated",
    failTitle: "Completed assessment has an unmitigated High / Very High risk",
    severityDefault: "high",
    isoReferences: ["A.18.1.4"],
    dpdpaControlAreas: ["Security Safeguards Program"],
    run: (clients) => checkHighRisksMitigated(clients),
  },
  {
    key: "onetrust.assessments.dpia_process_operating",
    title: "A PIA/DPIA process is operating",
    failTitle: "No PIA/DPIA assessment has been completed in the last 12 months",
    severityDefault: "medium",
    isoReferences: ["A.18.1.4"],
    dpdpaControlAreas: ["Security Safeguards Program"],
    run: (clients) => checkDpiaProcessOperating(clients),
  },
];
