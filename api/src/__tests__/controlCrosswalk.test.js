import { describe, test, expect } from "vitest";
import {
  expandControlRefs,
  getClauseCrosswalk,
  listCrosswalkClauses,
  CROSSWALK_TARGET_FRAMEWORKS,
} from "../utils/controlCrosswalk.js";
import { listConnectorKeys, listConnectorTests } from "../connectors/registry.js";

// Frameworks seeded in init.sql. The crosswalk may only target these.
const SEEDED_FRAMEWORKS = new Set([
  "ISO27001", "DPDPA", "SOC2", "HIPAA", "GDPR",
  "AWSWAF", "AZUREWAF", "CERTIN", "CIS", "PCIDSS",
]);

describe("controlCrosswalk", () => {
  test("expandControlRefs turns an ISO clause into per-framework control rows", () => {
    const rows = expandControlRefs(["A.9.4.2"]);
    // A.9.4.2 (secure log-on) maps to at least GDPR, SOC2, HIPAA, CIS, PCIDSS.
    const frameworks = new Set(rows.map((r) => r.framework));
    expect(frameworks.has("GDPR")).toBe(true);
    expect(frameworks.has("SOC2")).toBe(true);
    for (const row of rows) {
      expect(row.controlReference.length).toBeGreaterThan(0);
      expect(row.rationale.length).toBeGreaterThan(0);
      expect(row.source.length).toBeGreaterThan(0);
      expect(row.framework).not.toBe("ISO27001");
      expect(row.framework).not.toBe("DPDPA");
    }
  });

  test("expandControlRefs dedupes and ignores unknown clauses", () => {
    const rows = expandControlRefs(["A.9.4.2", "A.9.4.2", "A.99.99.99"]);
    const seen = new Set(rows.map((r) => `${r.framework}::${r.controlReference}`));
    expect(seen.size).toBe(rows.length);
  });

  test("getClauseCrosswalk returns title + mappings for a known clause, null otherwise", () => {
    const cw = getClauseCrosswalk("A.12.4.1");
    expect(cw.title).toMatch(/logging/i);
    expect(Object.keys(cw.mappings).length).toBeGreaterThan(0);
    expect(getClauseCrosswalk("A.404.1.1")).toBeNull();
  });

  test("every mapping entry cites a source and targets a seeded framework", () => {
    for (const clause of listCrosswalkClauses()) {
      const { title, mappings } = getClauseCrosswalk(clause);
      expect(title, `${clause} title`).toBeTruthy();
      for (const [framework, entries] of Object.entries(mappings)) {
        expect(SEEDED_FRAMEWORKS.has(framework), `${clause} -> ${framework} is seeded`).toBe(true);
        expect(CROSSWALK_TARGET_FRAMEWORKS.includes(framework), `${clause} -> ${framework} declared as target`).toBe(true);
        expect(entries.length, `${clause} -> ${framework} non-empty`).toBeGreaterThan(0);
        for (const e of entries) {
          expect(e.ref && e.rationale && e.source, `${clause} -> ${framework} entry complete`).toBeTruthy();
        }
      }
    }
  });

  test("drift guard: every ISO reference used by a connector has a crosswalk entry", () => {
    const covered = new Set(listCrosswalkClauses());
    const missing = new Set();
    for (const key of listConnectorKeys()) {
      for (const t of listConnectorTests(key)) {
        for (const ref of t.isoReferences || []) {
          if (!covered.has(ref)) missing.add(`${key}:${t.key} -> ${ref}`);
        }
      }
    }
    expect([...missing]).toEqual([]);
  });
});
