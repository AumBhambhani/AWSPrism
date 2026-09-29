import { ageInHours, aggregate, descriptor, empty, malformed, row } from "./helpers.js";

const score = (item) => Number(item?.severity);
const unresolved = (item) => !["resolved", "closed", "suppressed"].includes(String(item?.status ?? item?.resolution ?? "open").toLowerCase());

async function get(clients) {
  const items = await clients.listDetections();
  return Array.isArray(items) ? items : null;
}

async function checkCritical(clients) {
  const items = await get(clients);
  if (!items) return malformed("detection", "Detections response is malformed");
  const findings = items.filter((item) => score(item) >= 9 && unresolved(item));
  return findings.length ? findings.map((item) => row("detection", item, "fail", `Critical detection ${item.detectionRule ?? item.id} remains open`, { severity: item.severity, status: item.status ?? item.resolution ?? null, sensorGeneratedAt: item.sensorGeneratedAt ?? item.time ?? null })) : aggregate("detection", "pass", "No open critical XDR detections were returned", { detectionCount: items.length });
}

async function checkHigh(clients) {
  const items = await get(clients);
  if (!items) return malformed("detection", "Detections response is malformed");
  const thresholdDays = clients.THRESHOLDS.UNREVIEWED_DETECTION_DAYS;
  const high = items.filter((item) => score(item) >= 7 && score(item) < 9 && unresolved(item));
  const invalid = high.find((item) => ageInHours(item.sensorGeneratedAt ?? item.time ?? item.createdAt) == null);
  if (invalid) return malformed("detection", "Detection timestamp is missing or invalid", invalid);
  const findings = high.filter((item) => ageInHours(item.sensorGeneratedAt ?? item.time ?? item.createdAt) > thresholdDays * 24);
  return findings.length ? findings.map((item) => row("detection", item, "fail", `High-severity detection ${item.detectionRule ?? item.id} is unreviewed past ${thresholdDays} days`, { severity: item.severity, thresholdDays, timestamp: item.sensorGeneratedAt ?? item.time ?? item.createdAt })) : aggregate("detection", "pass", `No high-severity detection is unreviewed past ${thresholdDays} days`, { detectionCount: items.length, thresholdDays });
}

async function checkFeed(clients) {
  const items = await get(clients);
  if (!items) return malformed("detection", "Detections response is malformed");
  if (!items.length) return empty("detection", "No detections were produced in the configured lookback window", { lookbackDays: clients.THRESHOLDS.AUDIT_LOOKBACK_DAYS });
  return aggregate("detection", "pass", `${items.length} detection record(s) were retrievable in the lookback window`, { detectionCount: items.length, lookbackDays: clients.THRESHOLDS.AUDIT_LOOKBACK_DAYS });
}

export const detectionsTests = [
  descriptor({ key: "sophos.detections.critical_resolved", title: "No open critical XDR detections", severityDefault: "critical", isoReferences: ["A.16.1.5"], dpdpaControlAreas: ["Incident Management"], run: checkCritical }),
  descriptor({ key: "sophos.detections.high_reviewed", title: "No high-severity detections unreviewed past the threshold", severityDefault: "high", isoReferences: ["A.16.1.4"], dpdpaControlAreas: ["Incident Management"], run: checkHigh }),
  descriptor({ key: "sophos.detections.feed_active", title: "Detections feed has produced data within the lookback window", severityDefault: "low", isoReferences: ["A.12.4.1"], dpdpaControlAreas: ["Logging & Monitoring"], run: checkFeed }),
];
