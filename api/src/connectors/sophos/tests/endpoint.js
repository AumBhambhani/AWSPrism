import { ageInHours, aggregate, descriptor, empty, malformed, row } from "./helpers.js";

async function endpoints(clients) {
  const items = await clients.listEndpoints();
  return Array.isArray(items) ? items : null;
}

async function checkHealth(clients) {
  const items = await endpoints(clients);
  if (!items) return malformed("endpoint", "Endpoint inventory is malformed");
  if (!items.length) return empty("endpoint", "No managed endpoints were returned");
  const bad = items.filter((item) => !["good", "bad", "suspicious", "unknown"].includes(item?.health?.overall));
  if (bad.length) return malformed("endpoint", "Endpoint health.overall is missing or unknown", bad[0], { value: bad[0]?.health?.overall ?? null });
  const findings = items.filter((item) => item.health.overall !== "good");
  return findings.length ? findings.map((item) => row("endpoint", item, "fail", `${item.hostname} reports ${item.health.overall} overall health`, { health: item.health })) : aggregate("endpoint", "pass", `All ${items.length} endpoint(s) report good overall health`, { endpointCount: items.length });
}

async function checkBooleanField(clients, field, label) {
  const items = await endpoints(clients);
  if (!items) return malformed("endpoint", "Endpoint inventory is malformed");
  if (!items.length) return empty("endpoint", "No managed endpoints were returned");
  const unknown = items.find((item) => typeof item?.[field] !== "boolean");
  if (unknown) return malformed("endpoint", `Endpoint ${field} is missing`, unknown);
  const findings = items.filter((item) => !item[field]);
  return findings.length ? findings.map((item) => row("endpoint", item, "fail", `${label} is disabled on ${item.hostname}`, { [field]: false })) : aggregate("endpoint", "pass", `${label} is enabled on all ${items.length} endpoint(s)`, { endpointCount: items.length });
}

async function checkServices(clients) {
  const items = await endpoints(clients);
  if (!items?.length) return items ? empty("endpoint", "No managed endpoints were returned") : malformed("endpoint", "Endpoint inventory is malformed");
  const unknown = items.find((item) => !["good", "bad", "suspicious", "unknown"].includes(item?.health?.services?.status));
  if (unknown) return malformed("endpoint", "Endpoint health.services.status is missing or unknown", unknown);
  const findings = items.filter((item) => item.health.services.status !== "good");
  return findings.length ? findings.map((item) => row("endpoint", item, "fail", `${item.hostname} protection services report ${item.health.services.status}`, { services: item.health.services })) : aggregate("endpoint", "pass", `Protection services are healthy on all ${items.length} endpoint(s)`, { endpointCount: items.length });
}

async function checkThreatPolicies(clients) {
  const policies = (await clients.listPolicies()).filter((p) => ["threat-protection", "server-threat-protection"].includes(p.type));
  if (!policies.length) return empty("endpoint", "No Threat Protection policies were returned");
  const fields = ["realTimeScanningEnabled", "liveProtectionEnabled", "deepLearningEnabled"];
  const unknown = policies.find((p) => fields.some((field) => typeof (p.settings?.[field] ?? p[field]) !== "boolean"));
  if (unknown) return malformed("endpoint", "Threat Protection policy baseline fields are not present in the API response", unknown, { requiredFields: fields });
  const findings = policies.filter((p) => fields.some((field) => (p.settings?.[field] ?? p[field]) !== true));
  return findings.length ? findings.map((p) => row("endpoint_policy", p, "fail", `Threat Protection policy "${p.name}" disables a required protection control`, { settings: p.settings ?? p })) : aggregate("endpoint_policy", "pass", `All ${policies.length} Threat Protection policies enable the required baseline`, { policyCount: policies.length });
}

async function checkExploits(clients) {
  const exploits = await clients.listDetectedExploits();
  if (!Array.isArray(exploits)) return malformed("endpoint", "Exploit-mitigation response is malformed");
  if (!exploits.length) return aggregate("endpoint", "pass", "No exploit-mitigation detections were returned", { detectionCount: 0 });
  return exploits.map((item) => row("endpoint", item, "fail", `Exploit-mitigation detection ${item.name ?? item.id} requires review`, { detection: item }));
}

async function checkStale(clients) {
  const items = await endpoints(clients);
  if (!items?.length) return items ? empty("endpoint", "No managed endpoints were returned") : malformed("endpoint", "Endpoint inventory is malformed");
  const unknown = items.find((item) => ageInHours(item.lastSeenAt) == null);
  if (unknown) return malformed("endpoint", "Endpoint lastSeenAt is missing or invalid", unknown);
  const thresholdDays = clients.THRESHOLDS.STALE_DEVICE_DAYS;
  const stale = items.filter((item) => ageInHours(item.lastSeenAt) > thresholdDays * 24);
  return stale.length ? stale.map((item) => row("endpoint", item, "fail", `${item.hostname} has not checked in for ${Math.round(ageInHours(item.lastSeenAt) / 24)} days`, { lastSeenAt: item.lastSeenAt, thresholdDays })) : aggregate("endpoint", "pass", `All ${items.length} endpoint(s) checked in within ${thresholdDays} days`, { endpointCount: items.length, thresholdDays });
}

async function checkIsolation(clients) {
  const items = await endpoints(clients);
  if (!items?.length) return items ? empty("endpoint", "No managed endpoints were returned") : malformed("endpoint", "Endpoint inventory is malformed");
  const known = ["isolated", "notIsolated", "not-isolated"];
  const unknown = items.find((item) => !known.includes(item.isolation?.status ?? item.isolationStatus));
  if (unknown) return malformed("endpoint", "Endpoint isolation status is missing or unknown", unknown);
  const isolated = items.filter((item) => (item.isolation?.status ?? item.isolationStatus) === "isolated");
  return isolated.length ? isolated.map((item) => row("endpoint", item, "fail", `${item.hostname} remains isolated and requires a documented case review`, { isolationStatus: "isolated" })) : aggregate("endpoint", "pass", `No endpoint is currently isolated`, { endpointCount: items.length });
}

async function checkEncryption(clients) {
  const items = await endpoints(clients);
  if (!items?.length) return items ? empty("endpoint", "No managed endpoints were returned") : malformed("endpoint", "Endpoint inventory is malformed");
  const applicable = items.filter((item) => item.assignedProducts?.some((p) => p.code === "deviceEncryption"));
  if (!applicable.length) return empty("endpoint", "No endpoints have Sophos Device Encryption assigned");
  const unknown = applicable.find((item) => typeof item.overallEncryptionStatus !== "string");
  if (unknown) return malformed("endpoint", "overallEncryptionStatus is missing", unknown);
  const findings = applicable.filter((item) => item.overallEncryptionStatus !== "encrypted");
  return findings.length ? findings.map((item) => row("endpoint", item, "fail", `${item.hostname} encryption state is ${item.overallEncryptionStatus}`, { overallEncryptionStatus: item.overallEncryptionStatus })) : aggregate("endpoint", "pass", `All ${applicable.length} endpoint(s) assigned Device Encryption are encrypted`, { endpointCount: applicable.length });
}

const malware = ["Malware Protection"];
export const endpointTests = [
  descriptor({ key: "sophos.endpoint.protection_health", title: "All managed endpoints report good overall health", severityDefault: "high", isoReferences: ["A.12.2.1"], dpdpaControlAreas: malware, run: checkHealth }),
  descriptor({ key: "sophos.endpoint.tamper_protection_enabled", title: "Tamper Protection is enabled on every device", severityDefault: "high", isoReferences: ["A.12.2.1"], dpdpaControlAreas: malware, run: (c) => checkBooleanField(c, "tamperProtectionEnabled", "Tamper Protection") }),
  descriptor({ key: "sophos.endpoint.services_running", title: "All required Sophos protection services are running", severityDefault: "high", isoReferences: ["A.12.2.1"], dpdpaControlAreas: malware, run: checkServices }),
  descriptor({ key: "sophos.endpoint.threat_policy_baseline", title: "Threat Protection policies keep real-time scanning, live protection and deep learning on", severityDefault: "high", isoReferences: ["A.12.2.1"], dpdpaControlAreas: malware, run: checkThreatPolicies }),
  descriptor({ key: "sophos.endpoint.exploit_mitigation_clear", title: "No unresolved exploit-mitigation detections", severityDefault: "high", isoReferences: ["A.12.6.1"], dpdpaControlAreas: malware, run: checkExploits }),
  descriptor({ key: "sophos.endpoint.no_stale_devices", title: "No devices have gone unseen past the staleness threshold without review", severityDefault: "medium", isoReferences: ["A.8.1.1"], dpdpaControlAreas: ["Asset Management"], run: checkStale }),
  descriptor({ key: "sophos.endpoint.isolation_reviewed", title: "No devices left self-isolated without an open case", severityDefault: "medium", isoReferences: ["A.16.1.5"], dpdpaControlAreas: ["Incident Management"], run: checkIsolation }),
  descriptor({ key: "sophos.endpoint.encryption_enabled", title: "Device Encryption is active where the product is assigned", severityDefault: "medium", isoReferences: ["A.10.1.1"], dpdpaControlAreas: ["Encryption"], run: checkEncryption }),
];
