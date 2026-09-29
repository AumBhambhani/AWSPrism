import { buildEvidencePayload } from "../../shared/evidencePayload.js";

export function ageInHours(value) {
  const time = Date.parse(value);
  return Number.isNaN(time) ? null : (Date.now() - time) / 3_600_000;
}

export function idOf(item, fallback = "tenant") {
  return String(item?.id ?? item?.hostname ?? item?.name ?? item?.serialNumber ?? fallback);
}

export function payload(area, item, details = {}) {
  const id = idOf(item, area);
  return buildEvidencePayload({
    resourceType: `sophos_${area}`,
    resourceId: id,
    resourceName: String(item?.hostname ?? item?.name ?? item?.serialNumber ?? id),
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

export function malformed(area, message, item, details = {}) {
  return [row(area, item, "error", `${message}; the response shape cannot be evaluated safely`, details)];
}

export function aggregate(area, status, message, details = {}) {
  return [row(area, null, status, message, details)];
}

export function descriptor({ key, title, severityDefault, isoReferences, dpdpaControlAreas, run }) {
  return {
    key,
    title,
    failTitle: title
      .replace(/^All /, "Some ")
      .replace(/^No /, "One or more ")
      .replace(/ is /, " is not ")
      .replace(/ are /, " are not ") + " (finding)",
    severityDefault,
    isoReferences,
    dpdpaControlAreas,
    run,
  };
}
