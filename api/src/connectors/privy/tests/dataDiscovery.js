import { buildEvidencePayload } from "../../shared/evidencePayload.js";

function payload(type, record, details) {
  return buildEvidencePayload({
    resourceType: `privy_${type}`,
    resourceId: String(record?.id ?? record?.reference ?? "unknown"),
    resourceName: record?.name ? String(record.name) : String(record?.reference ?? record?.id ?? "unknown"),
    region: null,
    details,
  });
}

function ownerOf(record) {
  const o = record?.owner ?? record?.dataOwner ?? record?.businessOwner ?? record?.organization ?? record?.steward;
  if (!o) return null;
  if (typeof o === "string") return o.trim() || null;
  return o.name ?? o.email ?? o.value ?? o.id ?? null;
}

// The RoPA (processing-activities inventory from Data Compass) must not be empty.
async function checkRopaPopulated(clients) {
  const activities = await clients.listInventory("processing-activities");
  return [
    {
      resourceId: "ropa",
      status: activities.length > 0 ? "pass" : "fail",
      message:
        activities.length > 0
          ? `RoPA is populated with ${activities.length} processing activit(y/ies)`
          : "The processing-activities inventory (RoPA) is empty in Privy Data Compass",
      evidencePayload: buildEvidencePayload({
        resourceType: "privy_ropa",
        resourceId: "ropa",
        resourceName: "Records of Processing Activities",
        region: null,
        details: { processingActivities: activities.length },
      }),
    },
  ];
}

// Processing-activity and asset records must have an assigned data owner.
async function checkRecordsHaveOwners(clients) {
  const [activities, assets] = await Promise.all([
    clients.listInventory("processing-activities"),
    clients.listInventory("assets"),
  ]);
  const records = [
    ...activities.map((r) => ["processing_activity", r]),
    ...assets.map((r) => ["asset", r]),
  ];
  if (records.length === 0) {
    return [{ resourceId: "inventory", status: "not_applicable", message: "No processing-activity or asset records to evaluate for ownership", evidencePayload: payload("inventory", null, {}) }];
  }
  const rows = [];
  for (const [type, r] of records) {
    if (!ownerOf(r)) {
      rows.push({
        resourceId: String(r.id ?? r.reference),
        status: "fail",
        message: `${type === "asset" ? "Asset" : "Processing activity"} ${r.name ?? r.reference ?? r.id} has no assigned data owner`,
        evidencePayload: payload(type, r, { status: r.status ?? null }),
      });
    }
  }
  if (rows.length === 0) {
    return [{ resourceId: "inventory", status: "pass", message: `All ${records.length} processing-activity / asset record(s) have an assigned data owner`, evidencePayload: payload("inventory", null, { recordsChecked: records.length }) }];
  }
  return rows;
}

export const dataDiscoveryTests = [
  {
    key: "privy.inventory.ropa_populated",
    title: "Records of Processing Activities (RoPA) is populated",
    failTitle: "The processing-activities inventory (RoPA) is empty",
    severityDefault: "high",
    isoReferences: ["A.18.1.1"],
    dpdpaControlAreas: ["Data Inventory / RoPA"],
    run: (clients) => checkRopaPopulated(clients),
  },
  {
    key: "privy.inventory.records_have_owners",
    title: "Data-inventory records have an assigned owner",
    failTitle: "Inventory record has no assigned data owner",
    severityDefault: "medium",
    isoReferences: ["A.8.1.2"],
    dpdpaControlAreas: ["Data Inventory / RoPA"],
    run: (clients) => checkRecordsHaveOwners(clients),
  },
];
