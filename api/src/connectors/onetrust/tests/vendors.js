import { buildEvidencePayload } from "../../shared/evidencePayload.js";

const REVIEW_DAYS = 365;
const HIGH_RISK = new Set(["HIGH", "VERY_HIGH", "VERY HIGH", "CRITICAL"]);

function daysSince(value) {
  const t = Date.parse(value);
  return Number.isNaN(t) ? null : (Date.now() - t) / 86400000;
}

function payload(vendor, details) {
  return buildEvidencePayload({
    resourceType: "onetrust_vendor",
    resourceId: String(vendor?.id ?? vendor?.number ?? "unknown"),
    resourceName: vendor?.name ? String(vendor.name) : String(vendor?.number ?? vendor?.id ?? "unknown"),
    region: null,
    details,
  });
}

function isVendorAssessment(a) {
  const t = `${a.templateType || ""} ${a.templateName || ""} ${a.name || ""}`.toUpperCase();
  return t.includes("VENDOR") || t.includes("TPDD") || t.includes("THIRD PARTY") || t.includes("THIRD-PARTY") || t.includes("SUPPLIER");
}

// Best-effort link between a vendor inventory record and an assessment: OneTrust
// exposes the association differently across API versions, so match on any of
// the common shapes (inventory-id reference, or the assessment's primary-record
// name matching the vendor name).
function assessmentTargetsVendor(a, vendor) {
  const vid = String(vendor.id ?? "");
  const vname = String(vendor.name ?? "").trim().toLowerCase();
  const refIds = []
    .concat(a.inventoryRefIds || [], a.associatedInventoryIds || [], a.primaryRecordId || [], a.inventoryId || [])
    .map(String);
  if (vid && refIds.includes(vid)) return true;
  const targetName = String(a.primaryRecordName || a.targetName || a.name || "").trim().toLowerCase();
  return Boolean(vname) && targetName.includes(vname);
}

function riskLevelOf(vendor) {
  return String(
    vendor.riskLevel ?? vendor.inherentRiskLevel ?? vendor.residualRiskLevel ?? vendor.overallRisk ?? vendor.risk ?? ""
  ).toUpperCase();
}

async function checkRiskAssessed(clients) {
  const [vendors, assessments] = await Promise.all([clients.listInventory("vendors"), clients.listAssessments()]);
  if (vendors.length === 0) {
    return [{ resourceId: "vendors", status: "not_applicable", message: "The vendor inventory is empty", evidencePayload: payload(null, {}) }];
  }
  const completedVendorAssessments = assessments.filter((a) => a.assessmentStatus === "COMPLETED" && isVendorAssessment(a));
  const rows = [];
  for (const v of vendors) {
    const linked = completedVendorAssessments.some((a) => assessmentTargetsVendor(a, v));
    if (!linked) {
      rows.push({
        resourceId: String(v.id ?? v.number),
        status: "fail",
        message: `Vendor "${v.name ?? v.number ?? v.id}" has no completed vendor / third-party risk assessment`,
        evidencePayload: payload(v, { status: v.status?.key ?? v.status ?? null, riskLevel: riskLevelOf(v) || null }),
      });
    }
  }
  if (rows.length === 0) {
    return [{ resourceId: "vendors", status: "pass", message: `All ${vendors.length} vendor(s) have a completed risk assessment`, evidencePayload: payload(null, { vendorsChecked: vendors.length }) }];
  }
  return rows;
}

async function checkHighRiskReviewed(clients) {
  const vendors = await clients.listInventory("vendors");
  const highRisk = vendors.filter((v) => HIGH_RISK.has(riskLevelOf(v)));
  if (highRisk.length === 0) {
    return [{ resourceId: "vendors", status: "not_applicable", message: vendors.length === 0 ? "The vendor inventory is empty" : "No vendor is flagged high-risk", evidencePayload: payload(null, {}) }];
  }
  const rows = [];
  for (const v of highRisk) {
    const age = daysSince(v.lastUpdated || v.lastModifiedDate || v.lastAssessedDate);
    if (age == null) continue;
    if (age > REVIEW_DAYS) {
      rows.push({
        resourceId: String(v.id ?? v.number),
        status: "fail",
        message: `High-risk vendor "${v.name ?? v.number ?? v.id}" has not been reviewed in ${Math.round(age)} days`,
        evidencePayload: payload(v, { riskLevel: riskLevelOf(v), lastUpdated: v.lastUpdated, daysSinceReview: Math.round(age) }),
      });
    }
  }
  if (rows.length === 0) {
    return [{ resourceId: "vendors", status: "pass", message: `All ${highRisk.length} high-risk vendor(s) were reviewed within ${REVIEW_DAYS} days`, evidencePayload: payload(null, { highRiskVendors: highRisk.length }) }];
  }
  return rows;
}

async function checkInventoryPopulated(clients) {
  const vendors = await clients.listInventory("vendors");
  return [
    {
      resourceId: "vendor-inventory",
      status: vendors.length > 0 ? "pass" : "fail",
      message: vendors.length > 0 ? `The vendor inventory holds ${vendors.length} vendor(s)` : "The OneTrust vendor inventory is empty",
      evidencePayload: buildEvidencePayload({
        resourceType: "onetrust_vendor_inventory",
        resourceId: "vendor-inventory",
        resourceName: "Vendor inventory",
        region: null,
        details: { totalVendors: vendors.length },
      }),
    },
  ];
}

export const vendorsTests = [
  {
    key: "onetrust.vendors.risk_assessed",
    title: "Vendors have a completed risk assessment",
    failTitle: "Vendor has no completed vendor / third-party risk assessment",
    severityDefault: "high",
    isoReferences: ["A.15.1.1"],
    dpdpaControlAreas: ["Security Safeguards Program"],
    run: (clients) => checkRiskAssessed(clients),
  },
  {
    key: "onetrust.vendors.high_risk_reviewed",
    title: "High-risk vendors are reviewed at least annually",
    failTitle: "High-risk vendor has not been reviewed in over 12 months",
    severityDefault: "medium",
    isoReferences: ["A.15.2.1"],
    dpdpaControlAreas: ["Security Safeguards Program"],
    run: (clients) => checkHighRiskReviewed(clients),
  },
  {
    key: "onetrust.vendors.inventory_populated",
    title: "A vendor inventory is maintained",
    failTitle: "The OneTrust vendor inventory is empty",
    severityDefault: "low",
    isoReferences: ["A.15.1.1"],
    dpdpaControlAreas: ["Security Safeguards Program"],
    run: (clients) => checkInventoryPopulated(clients),
  },
];
