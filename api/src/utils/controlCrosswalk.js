import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

// Loads api/src/data/crosswalk/iso27001-annexa-crosswalk.json — the curated map from
// every ISO 27001:2013 Annex A clause a connector check references to the equivalent
// control in each other framework Prism supports (GDPR, SOC2, HIPAA, CIS, PCIDSS,
// CERTIN). testDefinitionSync.js calls expandControlRefs() at startup to fan each
// connector check's isoReferences out into test_control_mappings rows for every
// framework, so connector-collected evidence lands on the matching questions in every
// framework, not just ISO 27001.
//
// Fails fast (throws synchronously at import, like connectors/registry.js) if the
// JSON is malformed — a bad mapping here silently marks controls as "covered" that
// are not, so it must never load in a broken state.

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const CROSSWALK_PATH = path.join(__dirname, "..", "data", "crosswalk", "iso27001-annexa-crosswalk.json");

const raw = JSON.parse(fs.readFileSync(CROSSWALK_PATH, "utf8"));

export const CROSSWALK_TARGET_FRAMEWORKS = Object.freeze([...(raw.targetFrameworks || [])]);

function validateCrosswalk(doc) {
  const targets = new Set(doc.targetFrameworks || []);
  if (targets.size === 0) throw new Error("controlCrosswalk: targetFrameworks is empty");
  if (targets.has("ISO27001") || targets.has("DPDPA")) {
    throw new Error("controlCrosswalk: ISO27001/DPDPA must not be crosswalk targets (they map directly / via control_area)");
  }
  const clauses = doc.clauses || {};
  if (Object.keys(clauses).length === 0) throw new Error("controlCrosswalk: no clauses defined");

  for (const [clause, entry] of Object.entries(clauses)) {
    if (!entry || typeof entry.title !== "string" || entry.title.trim() === "") {
      throw new Error(`controlCrosswalk: clause "${clause}" has no title`);
    }
    const mappings = entry.mappings || {};
    if (Object.keys(mappings).length === 0) {
      throw new Error(`controlCrosswalk: clause "${clause}" has no framework mappings`);
    }
    for (const [framework, list] of Object.entries(mappings)) {
      if (!targets.has(framework)) {
        throw new Error(`controlCrosswalk: clause "${clause}" maps to non-target framework "${framework}"`);
      }
      if (!Array.isArray(list) || list.length === 0) {
        throw new Error(`controlCrosswalk: clause "${clause}" framework "${framework}" has an empty mapping (omit the key instead)`);
      }
      for (const item of list) {
        for (const field of ["ref", "rationale", "source"]) {
          if (typeof item?.[field] !== "string" || item[field].trim() === "") {
            throw new Error(`controlCrosswalk: clause "${clause}" -> "${framework}" has a blank "${field}"`);
          }
        }
      }
    }
  }
}

validateCrosswalk(raw);

const CLAUSES = raw.clauses;

// The ISO Annex A clauses covered by the crosswalk (exactly the ones connectors cite).
export function listCrosswalkClauses() {
  return Object.keys(CLAUSES);
}

// { title, mappings: { GDPR: [{ ref, rationale, source }], ... } } for a clause, or null.
export function getClauseCrosswalk(clause) {
  const entry = CLAUSES[clause];
  if (!entry) return null;
  return { title: entry.title, mappings: entry.mappings };
}

// Flattens the given ISO clauses into deduped per-framework control rows:
//   [{ framework, controlReference, rationale, source }]
// Unknown clauses are ignored (a connector check citing a clause with no crosswalk
// entry is caught by controlCrosswalk.test.js's drift guard, not here).
export function expandControlRefs(isoRefs) {
  const out = [];
  const seen = new Set();
  for (const clause of isoRefs || []) {
    const entry = CLAUSES[clause];
    if (!entry) continue;
    for (const [framework, list] of Object.entries(entry.mappings)) {
      for (const item of list) {
        const dedupeKey = `${framework}::${item.ref}`;
        if (seen.has(dedupeKey)) continue;
        seen.add(dedupeKey);
        out.push({
          framework,
          controlReference: item.ref,
          rationale: item.rationale,
          source: item.source,
        });
      }
    }
  }
  return out;
}
