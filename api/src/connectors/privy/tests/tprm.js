import { buildEvidencePayload } from "../../shared/evidencePayload.js";

const REVIEW_DAYS = 365;
const HIGH_RISK = new Set(["HIGH", "VERY_HIGH", "VERY HIGH", "CRITICAL", "SEVERE"]);
const DONE = new Set(["completed", "complete", "approved", "closed"]);

function daysSince(value) {
  const t = Date.parse(value);
  return Number.isNaN(t) ? null : (Date.now() - t) / 86400000;
}
function payload(v, details) {
  return buildEvidencePayload({
    resourceType: "privy_vendor",
    resourceId: String(v?.id ?? v?.vendorId ?? v?.name ?? "unknown"),
    resourceName: v?.name ? String(v.name) : String(v?.id ?? v?.vendorId ?? "unknown"),
    region: null,
    details,
  });
}
function riskLevelOf(v) {
  return String(v.riskLevel ?? v.inherentRiskLevel ?? v.residualRiskLevel ?? v.overallRisk ?? v.risk ?? "").toUpperCase();
}
// A vendor has been risk-assessed if it carries a completed assessment reference
// or a recorded risk rating / assessment date.
function isAssessed(v) {
  const assessmentStatus = String(v.assessmentStatus ?? v.riskAssessmentStatus ?? "").toLowerCase();
  if (assessmentStatus && DONE.has(assessmentStatus)) return true;
  if (Array.isArray(v.assessments) && v.assessments.some((a) => DONE.has(String(a.status || "").toLowerCase()))) return true;
  if (v.lastAssessedAt || v.riskAssessedAt || v.assessmentCompletedAt) return true;
  if (riskLevelOf(v)) return true;
  return false;
}

async function checkProcessorsRiskAssessed(clients) {
  const vendors = await clients.listVendors();
  if (vendors.length === 0) {
    return [{ resourceId: "vendors", status: "not_applicable", message: "The Privy third-party / processor inventory is empty", evidencePayload: payload(null, {}) }];
  }
  const rows = [];
  for (const v of vendors) {
    if (!isAssessed(v)) {
      rows.push({
        resourceId: String(v.id ?? v.vendorId ?? v.name),
        status: "fail",
        message: `Processor "${v.name ?? v.id}" has no completed risk assessment`,
        evidencePayload: payload(v, { assessmentStatus: v.assessmentStatus ?? null, riskLevel: riskLevelOf(v) || null }),
      });
    }
  }
  if (rows.length === 0) {
    return [{ resourceId: "vendors", status: "pass", message: `All ${vendors.length} processor(s) have a completed risk assessment`, evidencePayload: payload(null, { vendorsChecked: vendors.length }) }];
  }
  return rows;
}

async function checkHighRiskReviewed(clients) {
  const vendors = await clients.listVendors();
  const highRisk = vendors.filter((v) => HIGH_RISK.has(riskLevelOf(v)));
  if (highRisk.length === 0) {
    return [{ resourceId: "vendors", status: "not_applicable", message: vendors.length === 0 ? "The processor inventory is empty" : "No processor is flagged high-risk", evidencePayload: payload(null, {}) }];
  }
  const rows = [];
  for (const v of highRisk) {
    const age = daysSince(v.lastAssessedAt || v.riskAssessedAt || v.updatedAt || v.lastReviewedAt);
    if (age == null) continue;
    if (age > REVIEW_DAYS) {
      rows.push({
        resourceId: String(v.id ?? v.vendorId ?? v.name),
        status: "fail",
        message: `High-risk processor "${v.name ?? v.id}" has not been reviewed in ${Math.round(age)} days`,
        evidencePayload: payload(v, { riskLevel: riskLevelOf(v), daysSinceReview: Math.round(age) }),
      });
    }
  }
  if (rows.length === 0) {
    return [{ resourceId: "vendors", status: "pass", message: `All ${highRisk.length} high-risk processor(s) were reviewed within ${REVIEW_DAYS} days`, evidencePayload: payload(null, { highRiskVendors: highRisk.length }) }];
  }
  return rows;
}

export const tprmTests = [
  {
    key: "privy.tprm.processors_risk_assessed",
    title: "Processors and third parties have a completed risk assessment",
    failTitle: "Processor has no completed risk assessment",
    severityDefault: "high",
    isoReferences: ["A.15.1.1"],
    dpdpaControlAreas: ["Security Safeguards Program"],
    run: (clients) => checkProcessorsRiskAssessed(clients),
  },
  {
    key: "privy.tprm.high_risk_reviewed",
    title: "High-risk processors are reviewed at least annually",
    failTitle: "High-risk processor has not been reviewed in over 12 months",
    severityDefault: "medium",
    isoReferences: ["A.15.2.1"],
    dpdpaControlAreas: ["Security Safeguards Program"],
    run: (clients) => checkHighRiskReviewed(clients),
  },
];
