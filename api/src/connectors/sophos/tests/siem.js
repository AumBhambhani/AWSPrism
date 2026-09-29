import { ageInHours, aggregate, descriptor, empty, malformed, row } from "./helpers.js";

async function checkFeed(clients, loader, areaLabel) {
  const items = await loader();
  if (!Array.isArray(items)) return malformed(`siem_${areaLabel}`, `SIEM ${areaLabel} response is malformed`);
  if (!items.length) return empty(`siem_${areaLabel}`, `No SIEM ${areaLabel} were returned in the last 24 hours`);
  const invalid = items.find((item) => ageInHours(item.when ?? item.created_at ?? item.createdAt) == null);
  if (invalid) return malformed(`siem_${areaLabel}`, `SIEM ${areaLabel} timestamp is missing or invalid`, invalid);
  const threshold = clients.THRESHOLDS.SIEM_FRESHNESS_HOURS;
  const newest = Math.min(...items.map((item) => ageInHours(item.when ?? item.created_at ?? item.createdAt)));
  return aggregate(`siem_${areaLabel}`, newest <= threshold ? "pass" : "fail", newest <= threshold ? `SIEM ${areaLabel} include data from the last ${threshold} hours` : `Newest SIEM ${areaLabel} data is ${Math.round(newest)} hours old`, { itemCount: items.length, newestAgeHours: Math.round(newest), thresholdHours: threshold });
}

async function checkCredential(clients) {
  const info = await clients.getCredentialInfo();
  return aggregate("siem_credential", info.active ? "pass" : "fail", info.active ? "The OAuth2 API credential authenticated successfully for SIEM export" : "The SIEM API credential is not active", { active: Boolean(info.active), tenantId: info.tenantId });
}

export const siemTests = [
  descriptor({ key: "sophos.siem.events_flowing", title: "The SIEM events endpoint is returning recent events", severityDefault: "medium", isoReferences: ["A.12.4.1"], dpdpaControlAreas: ["Logging & Monitoring"], run: (c) => checkFeed(c, c.listSiemEvents, "events") }),
  descriptor({ key: "sophos.siem.alerts_current", title: "The SIEM alerts endpoint is reachable and current", severityDefault: "medium", isoReferences: ["A.16.1.2"], dpdpaControlAreas: ["Incident Management"], run: (c) => checkFeed(c, c.listSiemAlerts, "alerts") }),
  descriptor({ key: "sophos.siem.integration_credential_active", title: "An active API credential exists for SIEM/log export", severityDefault: "low", isoReferences: ["A.12.4.1"], dpdpaControlAreas: ["Logging & Monitoring"], run: checkCredential }),
];
