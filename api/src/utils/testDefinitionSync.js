import { query } from "../db/index.js";
import { listConnectorKeys, listConnectorTests } from "../connectors/registry.js";
import { expandControlRefs } from "./controlCrosswalk.js";

// Upserts `automated_tests` and `test_control_mappings` from the in-code
// connector check definitions (registry.js), so that `init.sql`'s
// hand-written seed INSERTs for these two tables no longer need to be kept
// in sync by hand for new connectors — the JS `tests` arrays (title,
// severityDefault, isoReferences, dpdpaControlAreas) become the single
// source of truth at runtime. Existing init.sql seed rows are left alone (no
// migration needed); this just keeps both tables current on every startup.
//
// isoReferences seed framework='ISO27001' rows keyed by the real Annex A
// clause (e.g. "A.9.4.2") — fine-grained, one clause per control.
// dpdpaControlAreas seed framework='DPDPA' rows keyed by the question's
// `control_area` string (e.g. "MFA for Sensitive Systems") instead: DPDPA's
// own iso_reference field (e.g. "Sec 8(5)") is a whole subsection shared by
// ~9 unrelated control_area clusters, too coarse to join a specific test
// against a specific question, so DPDPA mappings match on control_area
// instead (see the matching OR in dashboard.js / collectionRunner.js).
//
// Every OTHER framework (GDPR, SOC2, HIPAA, CIS, PCIDSS, CERTIN, and anything
// added later) is derived generically: expandControlRefs() looks each ISO
// clause up in data/crosswalk/iso27001-annexa-crosswalk.json and yields
// {framework, controlReference} rows, and a check may also carry an explicit
// `frameworkRefs: { GDPR: ["Art. 30"] }` override that is merged in. There are
// no framework string literals in that path — a connector check never has to
// be edited to gain coverage of a new framework. collectionRunner.js and
// dashboard.js then match those rows against question_framework_controls
// (framework_key, control_reference) as well as the legacy iso_reference /
// control_area columns.
//
// Matches api/src/utils/scheduler.js's error-handling convention (log via
// console.error, never throw — a sync failure shouldn't crash startup), but
// applies it at per-test granularity instead of a single top-level try/catch
// around the whole multi-connector loop: each test definition's writes are
// individually wrapped, so a bad definition anywhere (e.g. a future test
// whose severityDefault falls outside the automated_tests CHECK constraint
// enum, or a malformed isoReferences shape) only skips that one test — every
// other test, in that connector and in every other connector, still gets
// synced in the same run. An outer try/catch is kept around the whole loop
// as a last-resort guard (e.g. if listConnectorKeys/listConnectorTests
// themselves throw), so this function still can never throw.
export async function syncTestDefinitions() {
  try {
    for (const integrationKey of listConnectorKeys()) {
      const tests = listConnectorTests(integrationKey);
      for (const test of tests) {
        try {
          await query(
            `INSERT INTO automated_tests (integration_key, test_key, title, severity_default)
             VALUES ($1, $2, $3, $4)
             ON CONFLICT (test_key) DO UPDATE SET title = EXCLUDED.title, severity_default = EXCLUDED.severity_default`,
            [integrationKey, test.key, test.title, test.severityDefault]
          );

          // 1. Direct ISO 27001 rows — one per Annex A clause the check cites.
          for (const isoReference of test.isoReferences || []) {
            await query(
              `INSERT INTO test_control_mappings (test_key, framework, iso_reference)
               VALUES ($1, 'ISO27001', $2)
               ON CONFLICT (test_key, framework, iso_reference) DO NOTHING`,
              [test.key, isoReference]
            );
          }

          // 2. DPDPA rows keyed by control_area (see the module header for why
          //    DPDPA doesn't use a section ref here).
          for (const controlArea of test.dpdpaControlAreas || []) {
            await query(
              `INSERT INTO test_control_mappings (test_key, framework, iso_reference)
               VALUES ($1, 'DPDPA', $2)
               ON CONFLICT (test_key, framework, iso_reference) DO NOTHING`,
              [test.key, controlArea]
            );
          }

          // 3. Every OTHER framework, derived from the ISO clause(s) via the
          //    curated crosswalk (data/crosswalk/iso27001-annexa-crosswalk.json),
          //    plus any explicit per-check `frameworkRefs` override. Generic loop
          //    — no framework literals — so a framework added to the crosswalk
          //    (or a check's override) is picked up with no code change here.
          const genericRefs = expandControlRefs(test.isoReferences).map((r) => ({
            framework: r.framework,
            controlReference: r.controlReference,
          }));
          for (const [framework, refs] of Object.entries(test.frameworkRefs || {})) {
            for (const controlReference of refs || []) {
              genericRefs.push({ framework, controlReference });
            }
          }
          const seenGeneric = new Set();
          for (const { framework, controlReference } of genericRefs) {
            const dedupeKey = `${framework}::${controlReference}`;
            if (seenGeneric.has(dedupeKey)) continue;
            seenGeneric.add(dedupeKey);
            await query(
              `INSERT INTO test_control_mappings (test_key, framework, iso_reference)
               VALUES ($1, $2, $3)
               ON CONFLICT (test_key, framework, iso_reference) DO NOTHING`,
              [test.key, framework, controlReference]
            );
          }
        } catch (e) {
          console.error(`[testDefinitionSync] failed to sync test "${test.key}" for connector "${integrationKey}":`, e.message);
        }
      }
    }
    console.log("[testDefinitionSync] synced automated_tests/test_control_mappings from connector definitions");
  } catch (e) {
    console.error("[testDefinitionSync] syncTestDefinitions failed:", e.message);
  }
}
