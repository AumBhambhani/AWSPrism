import { buildEvidencePayload } from "../../shared/evidencePayload.js";

const HIGH_LEVELS = new Set(["HIGH", "VERY_HIGH", "VERY HIGH", "CRITICAL"]);
const CLOSED_STATES = new Set(["CLOSED", "MITIGATED", "ACCEPTED", "RESOLVED", "ARCHIVED", "RETIRED"]);

function isOpen(r) {
  if (r.dateClosed) return false;
  const state = String(r.state ?? r.status ?? r.riskState ?? "").toUpperCase();
  return !CLOSED_STATES.has(state);
}
function levelOf(r) {
  return String(r.level ?? r.riskLevel ?? r.rating ?? r.inherentRiskLevel ?? "").toUpperCase();
}
function hasControls(r) {
  const c = r.controlsIdentifier ?? r.controls ?? [];
  return Array.isArray(c) ? c.length > 0 : Boolean(c);
}
function payload(r, details) {
  return buildEvidencePayload({
    resourceType: "onetrust_risk",
    resourceId: String(r.id ?? r.riskId ?? "unknown"),
    resourceName: r.name ? String(r.name) : String(r.description ?? r.id ?? "unknown").slice(0, 120),
    region: null,
    details,
  });
}

async function checkHighRisksHaveTreatment(clients) {
  const risks = await clients.listRisks();
  const openHigh = risks.filter((r) => isOpen(r) && HIGH_LEVELS.has(levelOf(r)));
  if (openHigh.length === 0) {
    return [{ resourceId: "risks", status: "not_applicable", message: risks.length === 0 ? "The risk register is empty" : "No open High / Very High risks to evaluate for treatment", evidencePayload: payload({}, { openHighRisks: 0 }) }];
  }
  const rows = [];
  for (const r of openHigh) {
    if (!hasControls(r) && !r.deadline) {
      rows.push({
        resourceId: String(r.id ?? r.riskId),
        status: "fail",
        message: `Open ${levelOf(r)} risk "${(r.name ?? r.description ?? r.id ?? "").toString().slice(0, 80)}" has neither a mitigating control nor a treatment deadline`,
        evidencePayload: payload(r, { level: levelOf(r), state: r.state ?? r.status ?? null, controls: r.controlsIdentifier ?? [], deadline: r.deadline ?? null }),
      });
    }
  }
  if (rows.length === 0) {
    return [{ resourceId: "risks", status: "pass", message: `All ${openHigh.length} open High / Very High risk(s) have a control or a treatment deadline`, evidencePayload: payload({}, { openHighRisks: openHigh.length }) }];
  }
  return rows;
}

async function checkTreatmentNotOverdue(clients) {
  const risks = await clients.listRisks();
  const open = risks.filter(isOpen);
  if (open.length === 0) {
    return [{ resourceId: "risks", status: "not_applicable", message: risks.length === 0 ? "The risk register is empty" : "No open risks to evaluate for overdue treatment", evidencePayload: payload({}, {}) }];
  }
  const rows = [];
  for (const r of open) {
    if (!r.deadline) continue;
    const due = Date.parse(r.deadline);
    if (Number.isNaN(due)) continue;
    if (due < Date.now()) {
      const overdueDays = Math.round((Date.now() - due) / 86400000);
      rows.push({
        resourceId: String(r.id ?? r.riskId),
        status: "fail",
        message: `Open risk "${(r.name ?? r.description ?? r.id ?? "").toString().slice(0, 80)}" has a treatment deadline ${overdueDays} days in the past`,
        evidencePayload: payload(r, { level: levelOf(r), deadline: r.deadline, overdueDays }),
      });
    }
  }
  if (rows.length === 0) {
    return [{ resourceId: "risks", status: "pass", message: "No open risk has an overdue treatment deadline", evidencePayload: payload({}, { openRisks: open.length }) }];
  }
  return rows;
}

async function checkRegisterMaintained(clients) {
  const risks = await clients.listRisks();
  return [
    {
      resourceId: "risk-register",
      status: risks.length > 0 ? "pass" : "fail",
      message: risks.length > 0 ? `The risk register holds ${risks.length} risk(s)` : "The OneTrust risk register is empty",
      evidencePayload: buildEvidencePayload({
        resourceType: "onetrust_risk_register",
        resourceId: "risk-register",
        resourceName: "Risk register",
        region: null,
        details: { totalRisks: risks.length },
      }),
    },
  ];
}

export const riskTests = [
  {
    key: "onetrust.risk.high_risks_have_treatment",
    title: "Open high risks have a treatment plan",
    failTitle: "Open high risk has no mitigating control and no treatment deadline",
    severityDefault: "high",
    isoReferences: ["A.18.1.4"],
    dpdpaControlAreas: ["Security Safeguards Program"],
    run: (clients) => checkHighRisksHaveTreatment(clients),
  },
  {
    key: "onetrust.risk.treatment_not_overdue",
    title: "Risk treatment deadlines are met",
    failTitle: "Open risk has a treatment deadline in the past",
    severityDefault: "medium",
    isoReferences: ["A.18.1.4"],
    dpdpaControlAreas: ["Security Safeguards Program"],
    run: (clients) => checkTreatmentNotOverdue(clients),
  },
  {
    key: "onetrust.risk.register_maintained",
    title: "A risk register is maintained",
    failTitle: "The OneTrust risk register is empty",
    severityDefault: "low",
    isoReferences: ["A.18.1.4"],
    dpdpaControlAreas: ["Security Safeguards Program"],
    run: (clients) => checkRegisterMaintained(clients),
  },
];
