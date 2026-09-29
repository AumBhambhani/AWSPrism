import { describe, test, expect } from "vitest";
import { query } from "../../db/index.js";
import { tests as githubTests } from "../../connectors/github/index.js";
import { syncTestDefinitions } from "../../utils/testDefinitionSync.js";
import { expandControlRefs } from "../../utils/controlCrosswalk.js";

// The full set of test_control_mappings rows syncTestDefinitions writes for a
// connector check: a direct ISO27001 row per isoReferences entry, a DPDPA row
// per dpdpaControlAreas entry (control_area-keyed), plus one row per other
// framework the crosswalk derives from the ISO references, plus any explicit
// frameworkRefs override. Deduped on (framework, iso_reference).
function expectedMappingRows(t) {
  const rows = [
    ...(t.isoReferences || []).map((iso) => ({ framework: "ISO27001", iso_reference: iso })),
    ...(t.dpdpaControlAreas || []).map((area) => ({ framework: "DPDPA", iso_reference: area })),
    ...expandControlRefs(t.isoReferences).map((r) => ({ framework: r.framework, iso_reference: r.controlReference })),
  ];
  for (const [framework, refs] of Object.entries(t.frameworkRefs || {})) {
    for (const iso_reference of refs || []) rows.push({ framework, iso_reference });
  }
  const seen = new Set();
  return rows
    .filter((r) => {
      const k = `${r.framework}::${r.iso_reference}`;
      if (seen.has(k)) return false;
      seen.add(k);
      return true;
    })
    .map((r) => ({ test_key: t.key, framework: r.framework, iso_reference: r.iso_reference }));
}

describe("syncTestDefinitions (real DB)", () => {
  test("populates automated_tests and test_control_mappings for a real connector's checks without relying on init.sql's seed INSERTs", async () => {
    // Wipe out whatever init.sql seeded for these two tables so this test
    // proves the sync job itself (not the hand-written seed data) is what
    // populates them.
    await query(`TRUNCATE automated_tests, test_control_mappings RESTART IDENTITY CASCADE`);

    const beforeTests = await query(`SELECT * FROM automated_tests WHERE integration_key = 'github'`);
    expect(beforeTests.rows.length).toBe(0);

    await syncTestDefinitions();

    const testsResult = await query(
      `SELECT test_key, title, severity_default FROM automated_tests WHERE integration_key = 'github' ORDER BY test_key`
    );
    const expectedTests = [...githubTests]
      .map((t) => ({ test_key: t.key, title: t.title, severity_default: t.severityDefault }))
      .sort((a, b) => a.test_key.localeCompare(b.test_key));
    expect(testsResult.rows).toEqual(expectedTests);

    const mappingsResult = await query(
      `SELECT test_key, framework, iso_reference FROM test_control_mappings WHERE test_key LIKE 'github.%' ORDER BY test_key, framework, iso_reference`
    );
    const expectedMappings = githubTests
      .flatMap(expectedMappingRows)
      .sort(
        (a, b) =>
          a.test_key.localeCompare(b.test_key) ||
          a.framework.localeCompare(b.framework) ||
          a.iso_reference.localeCompare(b.iso_reference)
      );
    expect(mappingsResult.rows).toEqual(expectedMappings);
  });

  test("is idempotent: re-running sync does not duplicate rows or throw on the unique constraints", async () => {
    await syncTestDefinitions();
    await syncTestDefinitions();

    const testsResult = await query(`SELECT COUNT(*) FROM automated_tests WHERE integration_key = 'github'`);
    expect(Number(testsResult.rows[0].count)).toBe(githubTests.length);

    const mappingsResult = await query(`SELECT COUNT(*) FROM test_control_mappings WHERE test_key LIKE 'github.%'`);
    const expectedMappingCount = githubTests.reduce((sum, t) => sum + expectedMappingRows(t).length, 0);
    expect(Number(mappingsResult.rows[0].count)).toBe(expectedMappingCount);
  });
});
