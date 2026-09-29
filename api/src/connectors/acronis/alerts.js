import { buildEvidencePayload } from "../shared/evidencePayload.js";

// Alert-stream helpers shared by the malware / vulnerability / monitoring checks.
// The Acronis alert taxonomy is broad and the exact `type` strings are not fully
// enumerated in the public docs, so classification is done by substring match on
// `category` + `type` rather than an exact allow-list — confirm the real strings
// against a live tenant before this connector leaves beta.

const RESOLVED_STATES = new Set(["resolved", "dismissed", "closed", "cleared", "acknowledged"]);

// An alert is "open" unless it carries an explicit resolved/dismissed state or a
// resolution timestamp. Acronis usually drops resolved alerts from the default
// feed, so this is a belt-and-braces filter.
export function isOpenAlert(alert) {
  const state = String(alert?.state ?? alert?.status ?? "").toLowerCase();
  if (RESOLVED_STATES.has(state)) return false;
  if (alert?.dismissedAt || alert?.resolvedAt || alert?.clearedAt) return false;
  return true;
}

function haystack(alert) {
  return `${alert?.category ?? ""} ${alert?.type ?? ""} ${alert?.name ?? ""}`.toLowerCase();
}

export function isMalwareAlert(alert) {
  const h = haystack(alert);
  return /malware|ransomware|antivirus|anti-malware|threat|virus|quarantine/.test(h);
}

export function isVulnerabilityAlert(alert) {
  const h = haystack(alert);
  return /vulnerabilit|\bcve\b|security_gap/.test(h);
}

export function isPatchAlert(alert) {
  const h = haystack(alert);
  return /patch|update.*(missing|failed|pending)|missing.*update/.test(h);
}

export function alertSeverity(alert) {
  return String(alert?.severity ?? alert?.level ?? "").toLowerCase();
}

export function alertAgeDays(alert) {
  const t = Date.parse(alert?.createdAt ?? alert?.created_at ?? alert?.occurredAt ?? "");
  return Number.isNaN(t) ? null : (Date.now() - t) / 86400000;
}

export function alertPayload(alert, extraDetails = {}) {
  return buildEvidencePayload({
    resourceType: "acronis_alert",
    resourceId: String(alert?.id ?? alert?.alertId ?? "unknown"),
    resourceName: alert?.resourceName ?? alert?.details?.resourceName ?? alert?.type ?? null,
    region: null,
    details: {
      alertType: alert?.type ?? null,
      category: alert?.category ?? null,
      severity: alertSeverity(alert) || null,
      createdAt: alert?.createdAt ?? alert?.created_at ?? null,
      tenant: alert?.tenant ?? alert?.tenantId ?? null,
      ...extraDetails,
    },
  });
}
