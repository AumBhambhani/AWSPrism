import fs from "node:fs";
import path from "node:path";
import { describe, test, expect, beforeAll } from "vitest";
import { query } from "../../db/index.js";
import { createCompany } from "../setup/helpers.js";
import { syncTestDefinitions } from "../../utils/testDefinitionSync.js";
import { tests as awsTests } from "../../connectors/aws/index.js";
import { tests as azureTests } from "../../connectors/azure/index.js";
import { tests as githubTests } from "../../connectors/github/index.js";
import { tests as purviewTests } from "../../connectors/purview/index.js";
import { expandControlRefs } from "../../utils/controlCrosswalk.js";

// Each connector owns its own test catalogue (title, severityDefault,
// isoReferences, dpdpaControlAreas). At runtime syncTestDefinitions() — run on
// every startup — is the source of truth that reconciles `automated_tests` and
// `test_control_mappings` against those in-code definitions; init.sql's
// hand-written seed INSERTs are just a starting point. These guardrails run the
// same sync and then assert the two tables match the connector definitions
// exactly, so a connector test added or changed without the DB following (or
// vice versa) fails here rather than drifting silently.
const SEEDED_CONNECTORS = [
  { key: "aws", authType: "iam_role", definitions: awsTests },
  { key: "azure", authType: "oauth2", definitions: azureTests },
  { key: "github", authType: "oauth2", definitions: githubTests },
  { key: "purview", authType: "oauth2", definitions: purviewTests },
];

// syncTestDefinitions inserts, per connector check: an ISO27001 row per
// isoReferences entry, a DPDPA row per dpdpaControlAreas entry (keyed by
// control_area, not clause), one row per other framework the crosswalk
// (data/crosswalk/iso27001-annexa-crosswalk.json) derives from those ISO
// references, and any explicit frameworkRefs override. Deduped on
// (framework, iso_reference).
function expectedMappings(definition) {
  const rows = [
    ...(definition.isoReferences || []).map((iso) => ({ framework: "ISO27001", iso_reference: iso })),
    ...(definition.dpdpaControlAreas || []).map((area) => ({ framework: "DPDPA", iso_reference: area })),
    ...expandControlRefs(definition.isoReferences).map((r) => ({ framework: r.framework, iso_reference: r.controlReference })),
  ];
  for (const [framework, refs] of Object.entries(definition.frameworkRefs || {})) {
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
    .sort((a, b) => a.framework.localeCompare(b.framework) || a.iso_reference.localeCompare(b.iso_reference));
}

describe("automated evidence collection schema", () => {
  beforeAll(async () => {
    // test_control_mappings / automated_tests are seed tables that truncateAll()
    // deliberately leaves alone, so their contents depend on whatever ran before.
    // Re-run the real sync to pin them to the connector definitions.
    await syncTestDefinitions();
  });

  test.each(SEEDED_CONNECTORS)(
    "seeds the $key integration with $authType auth and its full test catalogue (drift guardrail)",
    async ({ key, authType, definitions }) => {
      const integrationResult = await query(`SELECT * FROM integrations WHERE key = $1`, [key]);
      expect(integrationResult.rows.length).toBe(1);
      expect(integrationResult.rows[0].auth_type).toBe(authType);
      expect(integrationResult.rows[0].status).toBe("active");

      const testsResult = await query(
        `SELECT test_key, title, severity_default FROM automated_tests WHERE integration_key = $1 ORDER BY test_key`,
        [key]
      );
      expect(testsResult.rows).toEqual(
        [...definitions]
          .map((d) => ({ test_key: d.key, title: d.title, severity_default: d.severityDefault }))
          .sort((a, b) => a.test_key.localeCompare(b.test_key))
      );

      for (const definition of definitions) {
        const dbMappingsResult = await query(
          `SELECT framework, iso_reference FROM test_control_mappings WHERE test_key = $1 ORDER BY framework, iso_reference`,
          [definition.key]
        );
        expect(dbMappingsResult.rows).toEqual(expectedMappings(definition));
      }
    }
  );

  test("integration_connections defaults to pending status", async () => {
    const company = await createCompany();
    const result = await query(
      `INSERT INTO integration_connections (company_id, integration_key, name) VALUES ($1, 'aws', 'Prod AWS') RETURNING *`,
      [company.id]
    );
    expect(result.rows[0].status).toBe("pending");
  });

  test("findings enforces unique (company_id, connection_id, test_key, resource_id)", async () => {
    const company = await createCompany();
    const conn = await query(
      `INSERT INTO integration_connections (company_id, integration_key, name) VALUES ($1, 'aws', 'Prod AWS') RETURNING *`,
      [company.id]
    );
    const connectionId = conn.rows[0].id;
    await query(
      `INSERT INTO findings (company_id, connection_id, test_key, resource_id, severity, title)
       VALUES ($1, $2, 'aws.iam.mfa_enforced', 'user-1', 'critical', 'MFA not enabled')`,
      [company.id, connectionId]
    );
    await expect(
      query(
        `INSERT INTO findings (company_id, connection_id, test_key, resource_id, severity, title)
         VALUES ($1, $2, 'aws.iam.mfa_enforced', 'user-1', 'critical', 'MFA not enabled')`,
        [company.id, connectionId]
      )
    ).rejects.toThrow();
  });

  test("actions has a finding_id column", async () => {
    const result = await query(`
      SELECT column_name FROM information_schema.columns
      WHERE table_name = 'actions' AND column_name = 'finding_id'
    `);
    expect(result.rows.length).toBe(1);
  });

  test("integration_connections defaults collection_frequency_hours to 24 and auto_collect_enabled to true", async () => {
    const company = await createCompany();
    const result = await query(
      `INSERT INTO integration_connections (company_id, integration_key, name) VALUES ($1, 'aws', 'Prod AWS') RETURNING *`,
      [company.id]
    );
    expect(result.rows[0].collection_frequency_hours).toBe(24);
    expect(result.rows[0].auto_collect_enabled).toBe(true);
  });

  test("seeds the akamai integration (api_key, beta) with its 18 automated tests and ISO mappings", async () => {
    const integration = await query(`SELECT auth_type, status, category FROM integrations WHERE key = 'akamai'`);
    expect(integration.rows.length).toBe(1);
    expect(integration.rows[0].auth_type).toBe("api_key");
    expect(integration.rows[0].status).toBe("beta");
    expect(integration.rows[0].category).toBe("network_security");

    const tests = await query(`SELECT test_key, severity_default FROM automated_tests WHERE integration_key = 'akamai' ORDER BY test_key`);
    expect(tests.rows.map((r) => r.test_key)).toEqual([
      "akamai.api.discovery_enabled",
      "akamai.api.endpoint_constraints_enforced",
      "akamai.api.no_unregistered_endpoints",
      "akamai.appsec.attack_groups_enabled",
      "akamai.appsec.config_activated_on_production",
      "akamai.appsec.rate_limiting_configured",
      "akamai.appsec.waf_policies_in_block_mode",
      "akamai.cps.auto_renewal_enabled",
      "akamai.cps.no_certs_near_expiry",
      "akamai.cps.no_stuck_changes",
      "akamai.cps.strong_key_algorithm",
      "akamai.property.force_https",
      "akamai.property.hsts_enabled",
      "akamai.property.latest_version_active",
      "akamai.property.min_tls_1_2",
      "akamai.property.origin_protected",
      "akamai.siem.all_policies_covered",
      "akamai.siem.integration_enabled",
    ]);

    const bySeverity = Object.fromEntries(tests.rows.map((r) => [r.test_key, r.severity_default]));
    expect(bySeverity["akamai.cps.no_certs_near_expiry"]).toBe("critical");
    expect(bySeverity["akamai.property.latest_version_active"]).toBe("low");

    // ISO rows only — the crosswalk also fans each check out to DPDPA / GDPR / SOC 2 / … rows.
    const mappings = await query(
      `SELECT DISTINCT iso_reference FROM test_control_mappings
       WHERE test_key LIKE 'akamai.%' AND framework = 'ISO27001' ORDER BY iso_reference`
    );
    expect(mappings.rows.map((r) => r.iso_reference)).toEqual([
      "A.10.1.1", "A.10.1.2", "A.12.1.2", "A.12.4.1", "A.13.1.1", "A.13.1.3", "A.14.1.2", "A.14.1.3", "A.14.2.5",
    ]);
  });

  test("the crosswalk covers every ISO clause the akamai connector references", () => {
    const crosswalk = JSON.parse(
      fs.readFileSync(path.resolve(__dirname, "../../data/crosswalk/iso27001-annexa-crosswalk.json"), "utf8")
    );
    for (const clause of ["A.14.1.2", "A.14.1.3", "A.10.1.1", "A.13.1.3"]) {
      expect(Object.keys(crosswalk.clauses)).toContain(clause);
      expect(Object.keys(crosswalk.clauses[clause].mappings).length).toBeGreaterThan(0);
    }
  });

  test.each([
    { key: "check_point_mgmt", category: "network_security", count: 11 },
    { key: "check_point", category: "endpoint_security", count: 10 },
    { key: "check_point_cloudguard", category: "cloud", count: 6 },
  ])("seeds the $key connector (api_key, beta) with its $count checks and ISO mappings", async ({ key, category, count }) => {
    const integration = await query(`SELECT auth_type, status, category FROM integrations WHERE key = $1`, [key]);
    expect(integration.rows.length).toBe(1);
    expect(integration.rows[0].auth_type).toBe("api_key");
    expect(integration.rows[0].status).toBe("beta");
    expect(integration.rows[0].category).toBe(category);

    const tests = await query(`SELECT test_key FROM automated_tests WHERE integration_key = $1`, [key]);
    expect(tests.rows).toHaveLength(count);

    // syncTestDefinitions fanned every check out to at least one non-ISO
    // framework via the crosswalk, so the mapping set is strictly larger than
    // just ISO27001.
    const frameworks = await query(
      `SELECT DISTINCT framework FROM test_control_mappings WHERE test_key LIKE $1 ORDER BY framework`,
      [`${key}.%`]
    );
    expect(frameworks.rows.map((r) => r.framework)).toEqual(
      expect.arrayContaining(["ISO27001", "GDPR", "SOC2"])
    );
  });

  test("the crosswalk covers every ISO clause the Check Point connectors reference", () => {
    const crosswalk = JSON.parse(
      fs.readFileSync(path.resolve(__dirname, "../../data/crosswalk/iso27001-annexa-crosswalk.json"), "utf8")
    );
    for (const clause of ["A.13.1.1", "A.9.4.1", "A.12.4.1", "A.12.1.2", "A.12.6.1", "A.12.2.1", "A.16.1.5", "A.16.1.4", "A.8.1.1", "A.12.1.1", "A.18.2.2"]) {
      expect(Object.keys(crosswalk.clauses)).toContain(clause);
    }
  });

  test("evidence_collection_runs allows only one running run per connection at a time", async () => {
    const company = await createCompany();
    const conn = await query(
      `INSERT INTO integration_connections (company_id, integration_key, name) VALUES ($1, 'aws', 'Prod AWS') RETURNING *`,
      [company.id]
    );
    const connectionId = conn.rows[0].id;

    await query(
      `INSERT INTO evidence_collection_runs (company_id, connection_id, status) VALUES ($1, $2, 'running')`,
      [company.id, connectionId]
    );

    await expect(
      query(
        `INSERT INTO evidence_collection_runs (company_id, connection_id, status) VALUES ($1, $2, 'running')`,
        [company.id, connectionId]
      )
    ).rejects.toThrow();
  });
});
