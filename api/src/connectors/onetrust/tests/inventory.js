import { buildEvidencePayload } from "../../shared/evidencePayload.js";

const REVIEW_DAYS = 365;

function daysSince(value) {
  const t = Date.parse(value);
  return Number.isNaN(t) ? null : (Date.now() - t) / 86400000;
}

function payload(type, record, details) {
  return buildEvidencePayload({
    resourceType: `onetrust_${type}`,
    resourceId: String(record?.id ?? record?.number ?? "unknown"),
    resourceName: record?.name ? String(record.name) : String(record?.number ?? record?.id ?? "unknown"),
    region: null,
    details,
  });
}

function ownerOf(record) {
  const o = record?.organization ?? record?.owner ?? record?.primaryEntity;
  if (!o) return null;
  if (typeof o === "string") return o.trim() || null;
  return o.name ?? o.value ?? o.key ?? null;
}

// The RoPA (processing-activities inventory) must not be empty.
async function checkRopaPopulated(clients) {
  const activities = await clients.listInventory("processing-activities");
  return [
    {
      resourceId: "ropa",
      status: activities.length > 0 ? "pass" : "fail",
      message:
        activities.length > 0
          ? `RoPA is populated with ${activities.length} processing activit(y/ies)`
          : "The processing-activities inventory (RoPA) is empty",
      evidencePayload: buildEvidencePayload({
        resourceType: "onetrust_ropa",
        resourceId: "ropa",
        resourceName: "Records of Processing Activities",
        region: null,
        details: { processingActivities: activities.length },
      }),
    },
  ];
}

// Asset and processing-activity records must have an owning organization.
async function checkRecordsHaveOwners(clients) {
  const [assets, activities] = await Promise.all([
    clients.listInventory("assets"),
    clients.listInventory("processing-activities"),
  ]);
  const records = [
    ...assets.map((r) => ["asset", r]),
    ...activities.map((r) => ["processing_activity", r]),
  ];
  if (records.length === 0) {
    return [{ resourceId: "inventory", status: "not_applicable", message: "No asset or processing-activity records to evaluate for ownership", evidencePayload: payload("inventory", null, {}) }];
  }

  const rows = [];
  for (const [type, r] of records) {
    if (!ownerOf(r)) {
      rows.push({
        resourceId: String(r.id ?? r.number),
        status: "fail",
        message: `${type === "asset" ? "Asset" : "Processing activity"} ${r.number ?? r.name ?? r.id} has no owning organization assigned`,
        evidencePayload: payload(type, r, { status: r.status?.key ?? r.status ?? null }),
      });
    }
  }
  if (rows.length === 0) {
    return [{ resourceId: "inventory", status: "pass", message: `All ${records.length} asset / processing-activity record(s) have an owning organization`, evidencePayload: payload("inventory", null, { recordsChecked: records.length }) }];
  }
  return rows;
}

// Records must have been reviewed (lastUpdated) within the last 12 months.
async function checkRecordsReviewedAnnually(clients) {
  const [assets, activities] = await Promise.all([
    clients.listInventory("assets"),
    clients.listInventory("processing-activities"),
  ]);
  const records = [
    ...assets.map((r) => ["asset", r]),
    ...activities.map((r) => ["processing_activity", r]),
  ];
  if (records.length === 0) {
    return [{ resourceId: "inventory", status: "not_applicable", message: "No inventory records to evaluate for review cadence", evidencePayload: payload("inventory", null, {}) }];
  }

  const rows = [];
  for (const [type, r] of records) {
    const age = daysSince(r.lastUpdated || r.lastModifiedDate);
    if (age == null) continue; // absent field → not a false fail
    if (age > REVIEW_DAYS) {
      rows.push({
        resourceId: String(r.id ?? r.number),
        status: "fail",
        message: `${type === "asset" ? "Asset" : "Processing activity"} ${r.number ?? r.name ?? r.id} has not been reviewed in ${Math.round(age)} days`,
        evidencePayload: payload(type, r, { lastUpdated: r.lastUpdated, daysSinceReview: Math.round(age) }),
      });
    }
  }
  if (rows.length === 0) {
    return [{ resourceId: "inventory", status: "pass", message: `All datable inventory records were reviewed within ${REVIEW_DAYS} days`, evidencePayload: payload("inventory", null, { recordsChecked: records.length }) }];
  }
  return rows;
}

export const inventoryTests = [
  {
    key: "onetrust.inventory.ropa_populated",
    title: "Records of Processing Activities (RoPA) is populated",
    failTitle: "The processing-activities inventory (RoPA) is empty",
    severityDefault: "high",
    isoReferences: ["A.18.1.1"],
    dpdpaControlAreas: ["Data Inventory / RoPA"],
    run: (clients) => checkRopaPopulated(clients),
  },
  {
    key: "onetrust.inventory.records_have_owners",
    title: "Data-inventory records have an assigned owner",
    failTitle: "Inventory record has no owning organization assigned",
    severityDefault: "medium",
    isoReferences: ["A.8.1.2"],
    dpdpaControlAreas: ["Data Inventory / RoPA"],
    run: (clients) => checkRecordsHaveOwners(clients),
  },
  {
    key: "onetrust.inventory.records_reviewed_annually",
    title: "Data-inventory records are reviewed at least annually",
    failTitle: "Inventory record has not been reviewed in over 12 months",
    severityDefault: "low",
    isoReferences: ["A.8.1.1"],
    dpdpaControlAreas: ["Data Inventory / RoPA"],
    run: (clients) => checkRecordsReviewedAnnually(clients),
  },
];
