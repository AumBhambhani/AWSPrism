import { aggregate, ageInHours, descriptor, empty, isHighSeverity, isOpenStatus, malformed, row } from "./helpers.js";

async function computers(clients) {
  const list = await clients.listEndpointComputers();
  return Array.isArray(list) ? list : null;
}

function lastSeen(device) {
  return device.lastConnection ?? device.lastSeen ?? device.lastLoggedInUser?.time ?? device.lastConnectionTime ?? device.lastContact;
}

async function checkDevicesCheckedIn(clients) {
  const list = await computers(clients);
  if (!list) return malformed("endpoint", "The Harmony Endpoint computers endpoint did not return an array");
  if (!list.length) return empty("endpoint", "No Harmony Endpoint devices are managed by this tenant");
  const unknown = list.find((d) => ageInHours(lastSeen(d)) == null);
  if (unknown) return malformed("endpoint", "Harmony Endpoint device last-connection time is missing or invalid", unknown);
  const staleDays = clients.THRESHOLDS.STALE_DEVICE_DAYS;
  const stale = list.filter((d) => ageInHours(lastSeen(d)) > staleDays * 24);
  return stale.length
    ? stale.map((d) => row("endpoint", d, "fail", `${d.name ?? d.hostname ?? d.id} has not checked in for ${Math.round(ageInHours(lastSeen(d)) / 24)} days`, { lastSeen: lastSeen(d), staleDays }))
    : aggregate("endpoint", "pass", `All ${list.length} Harmony Endpoint device(s) checked in within ${staleDays} days`, { deviceCount: list.length, staleDays });
}

const REQUIRED_BLADES = ["antiMalware", "antiRansomware", "threatEmulation"];

async function checkProtectionBlades(clients) {
  const policies = await clients.listEndpointPolicies();
  if (!Array.isArray(policies)) return malformed("endpoint", "The Harmony Endpoint policies endpoint did not return an array");
  if (!policies.length) return empty("endpoint", "No Harmony Endpoint policies are configured");
  const readBlade = (policy, blade) => {
    const caps = policy.capabilities ?? policy.blades ?? policy.settings ?? policy;
    const value = caps?.[blade] ?? caps?.[blade.toLowerCase()] ?? caps?.[blade.replace(/([A-Z])/g, "_$1").toLowerCase()];
    if (typeof value === "boolean") return value;
    if (value && typeof value === "object") return value.enabled ?? value.state === "on" ?? null;
    return null;
  };
  const unknown = policies.find((p) => REQUIRED_BLADES.some((blade) => readBlade(p, blade) == null));
  if (unknown) return malformed("endpoint", "Harmony Endpoint policy does not expose the Anti-Malware / Anti-Ransomware / Threat Emulation blade state", unknown, { requiredBlades: REQUIRED_BLADES });
  const findings = policies.filter((p) => REQUIRED_BLADES.some((blade) => readBlade(p, blade) !== true));
  return findings.length
    ? findings.map((p) => row("endpoint", p, "fail", `Harmony Endpoint policy "${p.name ?? p.id}" disables a required protection blade`, { blades: Object.fromEntries(REQUIRED_BLADES.map((b) => [b, readBlade(p, b)])) }))
    : aggregate("endpoint", "pass", `All ${policies.length} Harmony Endpoint policies keep Anti-Malware, Anti-Ransomware and Threat Emulation enabled`, { policyCount: policies.length });
}

async function checkSignaturesCurrent(clients) {
  const list = await computers(clients);
  if (!list) return malformed("endpoint", "The Harmony Endpoint computers endpoint did not return an array");
  if (!list.length) return empty("endpoint", "No Harmony Endpoint devices are managed by this tenant");
  const sigTime = (d) => d.antiMalware?.signatureUpdateTime ?? d.antiMalwareSignatureTime ?? d.amSignatureUpdateTime ?? d.signatureVersion?.time;
  const withSig = list.filter((d) => sigTime(d) != null);
  if (!withSig.length) return malformed("endpoint", "Harmony Endpoint devices carry no anti-malware signature timestamp");
  const staleDays = clients.THRESHOLDS.SIGNATURE_MAX_AGE_DAYS;
  const stale = withSig.filter((d) => (ageInHours(sigTime(d)) ?? Infinity) > staleDays * 24);
  return stale.length
    ? stale.map((d) => row("endpoint", d, "fail", `${d.name ?? d.hostname ?? d.id} anti-malware signatures are older than ${staleDays} days`, { signatureTime: sigTime(d), staleDays }))
    : aggregate("endpoint", "pass", `All ${withSig.length} reporting device(s) have anti-malware signatures within ${staleDays} days`, { deviceCount: withSig.length });
}

async function checkHighIncidentsResolved(clients) {
  const list = await clients.listEndpointIncidents();
  if (!Array.isArray(list)) return malformed("endpoint", "The Harmony Endpoint incidents endpoint did not return an array");
  if (!list.length) return aggregate("endpoint", "pass", "No unresolved Harmony Endpoint incidents", { incidentCount: 0 });
  const staleDays = clients.THRESHOLDS.ENDPOINT_INCIDENT_REVIEW_DAYS;
  const findings = list.filter((i) => {
    if (!isHighSeverity(i.severity ?? i.priority)) return false;
    if (!isOpenStatus(i.status ?? i.state)) return false;
    const age = ageInHours(i.creationTime ?? i.created ?? i.timestamp);
    return age == null || age > staleDays * 24;
  });
  return findings.length
    ? findings.map((i) => row("endpoint", i, "fail", `High-severity Harmony Endpoint incident "${i.name ?? i.id}" is unresolved past ${staleDays} days`, { severity: i.severity ?? i.priority, status: i.status ?? i.state }))
    : aggregate("endpoint", "pass", `No high-severity Harmony Endpoint incident is unresolved past ${staleDays} days`, { incidentCount: list.length });
}

const malware = ["Malware Protection"];
export const endpointTests = [
  descriptor({ key: "check_point.endpoint.devices_checked_in", title: "Harmony Endpoint devices have checked in within the staleness threshold", failTitle: "A Harmony Endpoint device has not checked in within the staleness threshold", severityDefault: "high", isoReferences: ["A.8.1.1"], dpdpaControlAreas: ["Asset Management"], run: checkDevicesCheckedIn }),
  descriptor({ key: "check_point.endpoint.protection_blades_active", title: "The assigned Endpoint policy keeps Anti-Malware, Anti-Ransomware and Threat Emulation enabled", failTitle: "A Harmony Endpoint policy disables a required protection blade", severityDefault: "high", isoReferences: ["A.12.2.1"], dpdpaControlAreas: malware, run: checkProtectionBlades }),
  descriptor({ key: "check_point.endpoint.signatures_current", title: "Endpoint anti-malware signature age is within the threshold", failTitle: "A Harmony Endpoint device has outdated anti-malware signatures", severityDefault: "medium", isoReferences: ["A.12.6.1"], dpdpaControlAreas: malware, run: checkSignaturesCurrent }),
  descriptor({ key: "check_point.endpoint.high_incidents_resolved", title: "No unresolved high-severity endpoint incidents past the review window", failTitle: "A high-severity Harmony Endpoint incident is unresolved past the review window", severityDefault: "medium", isoReferences: ["A.16.1.5"], dpdpaControlAreas: ["Incident Management"], run: checkHighIncidentsResolved }),
];
