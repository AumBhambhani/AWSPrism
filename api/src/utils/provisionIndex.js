// Loads the checked-in regulatory provision index (api/src/data/legal/*.json —
// see the README there for provenance). This is the ONLY source of citation
// `title`/`url`/`penalty` text that self-assessment regulatory-exposure mapping
// is allowed to show: mapRegulatoryExposure() (aiProvider.js) sends the model
// the compact {id, title} list via provisionIndexForPrompt(), the model
// returns which provision ids apply to which department, and every returned
// id is re-looked-up here with lookupProvision() before it reaches storage or
// the UI — the model's own text for title/url/penalty is never trusted, even
// if it echoes one back verbatim.
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DATA_DIR = path.join(__dirname, "..", "data", "legal");

const FILES = {
  DPDPA: "dpdpa-2023.json",
  GDPR: "gdpr.json",
  ISO27001: "iso-27001-2022-annex-a.json",
};

let _cache = null;

function load() {
  if (_cache) return _cache;
  const byFramework = {};
  for (const [key, file] of Object.entries(FILES)) {
    const parsed = JSON.parse(fs.readFileSync(path.join(DATA_DIR, file), "utf8"));
    const byId = new Map();
    for (const p of parsed.provisions || []) {
      byId.set(p.id, {
        id: p.id,
        title: p.title,
        penalty: p.penalty ?? parsed.defaultPenalty ?? null,
        url: p.url ?? parsed.url ?? null,
      });
    }
    byFramework[key] = {
      frameworkName: parsed.frameworkName || key,
      url: parsed.url || null,
      byId,
      provisions: [...byId.values()],
    };
  }
  _cache = byFramework;
  return _cache;
}

/** All in-scope frameworks' provisions, compact (id + title only — no url/penalty), for the AI prompt. */
export function provisionIndexForPrompt() {
  const idx = load();
  const out = {};
  for (const [key, fw] of Object.entries(idx)) {
    out[key] = fw.provisions.map(p => ({ id: p.id, title: p.title }));
  }
  return out;
}

/** Look up one provision. Returns null if the framework or id isn't in the checked-in index. */
export function lookupProvision(framework, provisionId) {
  const idx = load();
  const fw = idx[framework];
  if (!fw) return null;
  const p = fw.byId.get(provisionId);
  if (!p) return null;
  return {
    framework,
    frameworkName: fw.frameworkName,
    url: p.url ?? fw.url,
    id: p.id,
    title: p.title,
    penalty: p.penalty,
  };
}

/** Test/dev hook — clears the module cache so a test can point DATA_DIR-equivalent fixtures at fresh content. Not used in production code paths. */
export function _resetProvisionIndexCache() {
  _cache = null;
}
