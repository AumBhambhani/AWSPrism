import { buildEvidencePayload } from "../../shared/evidencePayload.js";

export function ageInDays(value) {
  const time = typeof value === "number" ? value : Date.parse(value);
  return Number.isNaN(time) ? null : (Date.now() - time) / 86_400_000;
}

export function idOf(item, fallback = "account") {
  return String(item?.id ?? item?.cloudAccountId ?? item?.name ?? fallback);
}

export function payload(area, item, details = {}) {
  const id = idOf(item, area);
  return buildEvidencePayload({
    resourceType: `check_point_cloudguard_${area}`,
    resourceId: id,
    resourceName: String(item?.name ?? item?.cloudAccountName ?? id),
    region: item?.region ?? null,
    details,
  });
}

export function row(area, item, status, message, details = {}) {
  return { resourceId: idOf(item, area), status, message, evidencePayload: payload(area, item, details) };
}

export function empty(area, message, details = {}) {
  return [row(area, null, "not_applicable", message, details)];
}

export function malformed(area, message, item = null, details = {}) {
  return [row(area, item, "error", `${message}; the CloudGuard response shape cannot be evaluated safely`, details)];
}

export function aggregate(area, status, message, details = {}) {
  return [row(area, null, status, message, details)];
}

export function descriptor({ key, title, failTitle, severityDefault, isoReferences, dpdpaControlAreas, run }) {
  return {
    key,
    title,
    failTitle: failTitle || `${title} — finding`,
    severityDefault,
    isoReferences,
    dpdpaControlAreas,
    run,
  };
}

const HIGH = new Set(["high", "critical", "urgent"]);
export function isHighSeverity(value) {
  return HIGH.has(String(value ?? "").trim().toLowerCase());
}
export function isCriticalSeverity(value) {
  return ["critical", "urgent"].includes(String(value ?? "").trim().toLowerCase());
}
