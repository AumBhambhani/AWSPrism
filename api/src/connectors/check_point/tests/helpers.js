import { buildEvidencePayload } from "../../shared/evidencePayload.js";

// Result/shape helpers shared by the Check Point Infinity connector checks.
// `empty` -> not_applicable, `malformed` -> error (never a guessed pass/fail).

export function ageInHours(value) {
  const time = typeof value === "number" ? (value > 1e12 ? value : value * 1000) : Date.parse(value);
  return Number.isNaN(time) ? null : (Date.now() - time) / 3_600_000;
}

export function idOf(item, fallback = "tenant") {
  return String(item?.id ?? item?.uid ?? item?.deviceId ?? item?.name ?? item?.hostname ?? fallback);
}

export function payload(area, item, details = {}) {
  const id = idOf(item, area);
  return buildEvidencePayload({
    resourceType: `check_point_${area}`,
    resourceId: id,
    resourceName: String(item?.name ?? item?.hostname ?? item?.deviceName ?? id),
    region: null,
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
  return [row(area, item, "error", `${message}; the Check Point Infinity response shape cannot be evaluated safely`, details)];
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

const HIGH_SEVERITIES = new Set(["high", "critical", "very high", "veryhigh", "4", "5"]);

export function isHighSeverity(value) {
  return HIGH_SEVERITIES.has(String(value ?? "").trim().toLowerCase());
}

const OPEN_STATUSES = new Set(["", "new", "open", "in progress", "in_progress", "inprogress", "investigating", "unhandled", "pending"]);

export function isOpenStatus(value) {
  return OPEN_STATUSES.has(String(value ?? "").trim().toLowerCase());
}
