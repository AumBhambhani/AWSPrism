import { buildEvidencePayload } from "../../shared/evidencePayload.js";

// Shared result/shape helpers for the Check Point Management connector checks.
// Mirrors api/src/connectors/sophos/tests/helpers.js: `empty` -> not_applicable,
// `malformed` -> error (never a guessed pass/fail), `aggregate`/`row` -> the
// pass/fail rows. Every payload goes through buildEvidencePayload so the finding
// PDF renderer can read resourceType/resourceName.

export function ageInDays(value) {
  const time = typeof value === "number" ? value : Date.parse(value);
  return Number.isNaN(time) ? null : (Date.now() - time) / 86_400_000;
}

export function idOf(item, fallback = "management") {
  return String(item?.uid ?? item?.name ?? item?.["rule-number"] ?? item?.id ?? fallback);
}

export function payload(area, item, details = {}) {
  const id = idOf(item, area);
  return buildEvidencePayload({
    resourceType: `check_point_${area}`,
    resourceId: id,
    resourceName: String(item?.name ?? item?.["rule-number"] ?? id),
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
  return [row(area, item, "error", `${message}; the Check Point Management response shape cannot be evaluated safely`, details)];
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

// Flattens a show-*-rulebase response (which nests section headers that each
// carry their own `rulebase` array) into a flat list of access/threat rules.
export function flattenRulebase(entries) {
  const out = [];
  for (const entry of Array.isArray(entries) ? entries : []) {
    if (!entry || typeof entry !== "object") continue;
    if (Array.isArray(entry.rulebase)) {
      out.push(...flattenRulebase(entry.rulebase));
    } else if (entry.type === "access-rule" || entry.type === "threat-rule" || entry.type === "threat-exception" || entry["rule-number"] != null) {
      out.push(entry);
    }
  }
  return out;
}

// A show-*-rulebase call also returns an `objects-dictionary`; this resolves a
// rule field (which is an array of uids) to the referenced object names.
export function resolveNames(uids, dictionary) {
  const byUid = new Map((Array.isArray(dictionary) ? dictionary : []).map((o) => [o.uid, o]));
  return (Array.isArray(uids) ? uids : []).map((uid) => byUid.get(uid)?.name ?? String(uid));
}

// Resolves a single rule field that may be a uid string, an inline object
// ({ name }), or already a plain name, to its display name (lower-cased).
export function refName(value, dictionary) {
  if (value == null) return "";
  if (typeof value === "object" && !Array.isArray(value)) return String(value.name ?? "").toLowerCase();
  const byUid = new Map((Array.isArray(dictionary) ? dictionary : []).map((o) => [o.uid, o]));
  const raw = Array.isArray(value) ? value[0] : value;
  return String(byUid.get(raw)?.name ?? raw ?? "").toLowerCase();
}

export function isAnyRef(uids, dictionary) {
  const names = resolveNames(uids, dictionary).map((n) => n.toLowerCase());
  return names.length === 1 && (names[0] === "any" || names[0] === "all");
}
