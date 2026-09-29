import { describe, test, expect, beforeEach, afterEach, vi } from "vitest";
import {
  checkSourcesScanned,
  checkScanScheduleConfigured,
  checkClassificationApplied,
  checkSensitivityLabelsApplied,
} from "../connectors/purview/tests/datamap.js";

// Freeze the clock: fixtures and assertions both call isoDaysAgo(), and a
// millisecond tick between those calls made exact timestamp comparisons flaky.
beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date("2026-06-15T12:00:00.000Z"));
});

afterEach(() => {
  vi.useRealTimers();
});

function isoDaysAgo(days) {
  return new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString();
}

describe("checkSourcesScanned", () => {
  test("returns not_applicable when there are zero sources", async () => {
    const dataMap = { get: async () => ({ value: [] }) };
    const results = await checkSourcesScanned(dataMap);
    expect(results).toEqual([{ resourceId: "account", status: "not_applicable", message: "No registered data sources found", evidencePayload: {} }]);
  });

  test("returns not_applicable when only container/grouping kinds are registered", async () => {
    const dataMap = {
      get: async () => ({
        value: [
          { id: "s1", name: "sub", kind: "AzureSubscription", scans: [] },
          { id: "s2", name: "rg", kind: "AzureResourceGroup", scans: [] },
          { id: "s3", name: "aws", kind: "AmazonAccount", scans: [] },
          { id: "s4", name: "none-kind", kind: "None", scans: [] },
        ],
      }),
    };
    const results = await checkSourcesScanned(dataMap);
    expect(results).toEqual([{ resourceId: "account", status: "not_applicable", message: "No registered data sources found", evidencePayload: {} }]);
  });

  test("fails a source with no successful scan results at all", async () => {
    const dataMap = {
      get: async () => ({
        value: [
          {
            id: "src1",
            name: "storage-1",
            kind: "AzureStorage",
            scans: [{ id: "scan1", scanResults: [{ status: "Failed", endTime: isoDaysAgo(1) }] }],
          },
        ],
      }),
    };
    const results = await checkSourcesScanned(dataMap);
    expect(results).toEqual([{ resourceId: "src1", status: "fail", message: "storage-1 has no successful scan runs", evidencePayload: {} }]);
  });

  test("passes a source whose most recent successful scan is well within 30 days", async () => {
    const dataMap = {
      get: async () => ({
        value: [
          {
            id: "src1",
            name: "storage-1",
            kind: "AzureStorage",
            scans: [{ id: "scan1", scanResults: [{ status: "Completed", endTime: isoDaysAgo(5) }] }],
          },
        ],
      }),
    };
    const results = await checkSourcesScanned(dataMap);
    expect(results[0].status).toBe("pass");
  });

  test("fails a source whose most recent successful scan is well older than 30 days", async () => {
    const dataMap = {
      get: async () => ({
        value: [
          {
            id: "src1",
            name: "storage-1",
            kind: "AzureStorage",
            scans: [{ id: "scan1", scanResults: [{ status: "Completed", endTime: isoDaysAgo(45) }] }],
          },
        ],
      }),
    };
    const results = await checkSourcesScanned(dataMap);
    expect(results[0].status).toBe("fail");
  });

  test("30-day boundary: passes at 29 days, fails at 31 days", async () => {
    const dataMapJustWithin = {
      get: async () => ({
        value: [{ id: "src1", name: "storage-1", kind: "AzureStorage", scans: [{ scanResults: [{ status: "Completed", endTime: isoDaysAgo(29) }] }] }],
      }),
    };
    const dataMapJustOutside = {
      get: async () => ({
        value: [{ id: "src1", name: "storage-1", kind: "AzureStorage", scans: [{ scanResults: [{ status: "Completed", endTime: isoDaysAgo(31) }] }] }],
      }),
    };
    const within = await checkSourcesScanned(dataMapJustWithin);
    const outside = await checkSourcesScanned(dataMapJustOutside);
    expect(within[0].status).toBe("pass");
    expect(outside[0].status).toBe("fail");
  });

  test("picks the most recent successful scan result across multiple scans/results, case-insensitive status, falling back to startTime", async () => {
    const dataMap = {
      get: async () => ({
        value: [
          {
            id: "src1",
            name: "storage-1",
            kind: "AzureStorage",
            scans: [
              { id: "scan1", scanResults: [{ status: "completed", startTime: isoDaysAgo(60) }] },
              {
                id: "scan2",
                scanResults: [
                  { status: "Failed", endTime: isoDaysAgo(1) },
                  { status: "Completed", endTime: isoDaysAgo(10) },
                ],
              },
            ],
          },
        ],
      }),
    };
    const results = await checkSourcesScanned(dataMap);
    expect(results[0].status).toBe("pass");
    expect(results[0].evidencePayload.mostRecentScanTime).toBe(isoDaysAgo(10));
  });

  // 6c: resourceId must never resolve to undefined/empty (evidence_test_results.resource_id is NOT NULL).
  test("falls back to 'unknown' resourceId when a source has neither id nor name", async () => {
    const dataMap = {
      get: async () => ({
        value: [{ kind: "AzureStorage", scans: [{ scanResults: [{ status: "Completed", endTime: isoDaysAgo(1) }] }] }],
      }),
    };
    const results = await checkSourcesScanned(dataMap);
    expect(results[0].resourceId).toBe("unknown");
  });

  test("evaluates each remaining source independently", async () => {
    const dataMap = {
      get: async () => ({
        value: [
          { id: "src1", name: "good", kind: "AzureStorage", scans: [{ scanResults: [{ status: "Completed", endTime: isoDaysAgo(1) }] }] },
          { id: "src2", name: "stale", kind: "AzureSqlDatabase", scans: [{ scanResults: [{ status: "Completed", endTime: isoDaysAgo(90) }] }] },
        ],
      }),
    };
    const results = await checkSourcesScanned(dataMap);
    expect(results).toHaveLength(2);
    expect(results.find((r) => r.resourceId === "src1").status).toBe("pass");
    expect(results.find((r) => r.resourceId === "src2").status).toBe("fail");
  });
});

describe("checkScanScheduleConfigured", () => {
  test("returns not_applicable when there are zero sources after filtering container kinds", async () => {
    const dataMap = { get: async () => ({ value: [{ id: "s1", name: "sub", kind: "AzureSubscription", scans: [] }] }) };
    const results = await checkScanScheduleConfigured(dataMap);
    expect(results).toEqual([{ resourceId: "account", status: "not_applicable", message: "No registered data sources found", evidencePayload: {} }]);
  });

  // 6c: resourceId must never resolve to undefined/empty (evidence_test_results.resource_id is NOT NULL).
  test("falls back to 'unknown' resourceId when a source has neither id nor name", async () => {
    const dataMap = {
      get: async () => ({ value: [{ kind: "AzureStorage", scans: [{ scanResults: [{ status: "Completed", runType: "Scheduled", endTime: isoDaysAgo(1) }] }] }] }),
    };
    const results = await checkScanScheduleConfigured(dataMap);
    expect(results[0].resourceId).toBe("unknown");
  });

  test("passes a source with a Scheduled scan run", async () => {
    const dataMap = {
      get: async () => ({
        value: [{ id: "src1", name: "storage-1", kind: "AzureStorage", scans: [{ scanResults: [{ status: "Completed", runType: "Scheduled", endTime: isoDaysAgo(1) }] }] }],
      }),
    };
    const results = await checkScanScheduleConfigured(dataMap);
    expect(results).toEqual([
      { resourceId: "src1", status: "pass", message: "storage-1 has a recurring scan schedule configured", evidencePayload: {} },
    ]);
  });

  test("fails a source whose runs are all OnDemand/Manual", async () => {
    const dataMap = {
      get: async () => ({
        value: [{ id: "src1", name: "storage-1", kind: "AzureStorage", scans: [{ scanResults: [{ status: "Completed", runType: "OnDemand", endTime: isoDaysAgo(1) }] }] }],
      }),
    };
    const results = await checkScanScheduleConfigured(dataMap);
    expect(results[0].status).toBe("fail");
  });

  test("fails a source with no runType at all", async () => {
    const dataMap = {
      get: async () => ({ value: [{ id: "src1", name: "storage-1", kind: "AzureStorage", scans: [{ scanResults: [{ status: "Completed", endTime: isoDaysAgo(1) }] }] }] }),
    };
    const results = await checkScanScheduleConfigured(dataMap);
    expect(results[0].status).toBe("fail");
  });

  test("matches runType case-insensitively", async () => {
    const dataMap = {
      get: async () => ({ value: [{ id: "src1", name: "storage-1", kind: "AzureStorage", scans: [{ scanResults: [{ status: "Completed", runType: "scheduled", endTime: isoDaysAgo(1) }] }] }] }),
    };
    const results = await checkScanScheduleConfigured(dataMap);
    expect(results[0].status).toBe("pass");
  });
});

describe("checkClassificationApplied", () => {
  test("returns not_applicable when zero entities are returned", async () => {
    const dataMap = { post: async () => ({ value: [] }) };
    const results = await checkClassificationApplied(dataMap);
    expect(results).toEqual([{ resourceId: "account", status: "not_applicable", message: "No scanned assets were found", evidencePayload: {} }]);
  });

  test("falls back to `entities` field when `value` is absent", async () => {
    const dataMap = { post: async () => ({ entities: [{ guid: "e1", typeName: "azure_sql_db", classification: [{ typeName: "PII" }] }] }) };
    const results = await checkClassificationApplied(dataMap);
    expect(results[0].status).toBe("pass");
  });

  test("passes an entity of a classification-supporting type with non-empty classifications", async () => {
    const dataMap = { post: async () => ({ value: [{ guid: "e1", typeName: "azure_storage_account", classification: [{ typeName: "PII" }] }] }) };
    const results = await checkClassificationApplied(dataMap);
    expect(results).toEqual([{ resourceId: "e1", status: "pass", message: "Asset has classifications applied", evidencePayload: { typeName: "azure_storage_account", classificationCount: 1 } }]);
  });

  test("supports the `classifications` (plural) field name too", async () => {
    const dataMap = { post: async () => ({ value: [{ guid: "e1", typeName: "oracle_table", classifications: [{ typeName: "PII" }] }] }) };
    const results = await checkClassificationApplied(dataMap);
    expect(results[0].status).toBe("pass");
  });

  test("fails an entity of a classification-supporting type with no classifications", async () => {
    const dataMap = { post: async () => ({ value: [{ guid: "e1", typeName: "amazon_s3_bucket" }] }) };
    const results = await checkClassificationApplied(dataMap);
    expect(results).toEqual([{ resourceId: "e1", status: "fail", message: "Asset has no classifications applied", evidencePayload: { typeName: "amazon_s3_bucket", classificationCount: 0 } }]);
  });

  test("marks a type that does not support classification (e.g. Power BI) as not_applicable", async () => {
    const dataMap = { post: async () => ({ value: [{ guid: "e1", typeName: "powerbi_dataset" }] }) };
    const results = await checkClassificationApplied(dataMap);
    expect(results[0].status).toBe("not_applicable");
  });

  test("marks an unrecognized type as not_applicable rather than guessing", async () => {
    const dataMap = { post: async () => ({ value: [{ guid: "e1", typeName: "some_unknown_family" }] }) };
    const results = await checkClassificationApplied(dataMap);
    expect(results[0].status).toBe("not_applicable");
  });

  test("evaluates every entity independently and uses entityType when typeName is absent", async () => {
    const dataMap = {
      post: async () => ({
        value: [
          { guid: "e1", typeName: "azure_sql_table", classification: [{ typeName: "PII" }] },
          { guid: "e2", entityType: "teradata_table" },
          { guid: "e3", typeName: "sap_table" },
        ],
      }),
    };
    const results = await checkClassificationApplied(dataMap);
    expect(results.find((r) => r.resourceId === "e1").status).toBe("pass");
    expect(results.find((r) => r.resourceId === "e2").status).toBe("fail");
    expect(results.find((r) => r.resourceId === "e3").status).toBe("not_applicable");
  });

  test("resourceId falls back through guid, id, qualifiedName, name", async () => {
    const dataMap = { post: async () => ({ value: [{ id: "byid", typeName: "azure_sql_table" }] }) };
    const results = await checkClassificationApplied(dataMap);
    expect(results[0].resourceId).toBe("byid");
  });

  // 6c: resourceId must never resolve to undefined/empty (evidence_test_results.resource_id is NOT NULL).
  test("falls back to 'unknown' resourceId when an entity has none of guid/id/qualifiedName/name", async () => {
    const dataMap = { post: async () => ({ value: [{ typeName: "azure_sql_table" }] }) };
    const results = await checkClassificationApplied(dataMap);
    expect(results[0].resourceId).toBe("unknown");
  });

  test.each([
    ["azure_data_explorer_table", "AzureDataExplorer family"],
    ["azure_kusto_table", "AzureDataExplorer family (kusto alt prefix)"],
    ["azure_file_share", "AzureFileService family"],
    ["azure_postgresql_table", "AzurePostgreSql family"],
    ["sqlserver_table", "SqlServerDatabase family"],
    ["azure_sql_mi_table", "AzureSqlDatabaseManagedInstance family (falls under generic azure_sql rule)"],
    ["azure_mysql_table", "AzureMySql family"],
    ["amazon_rds_table", "AmazonSql family"],
  ])("supports classification for the %s prefix (%s)", async (typeName) => {
    const dataMap = { post: async () => ({ value: [{ guid: "e1", typeName, classification: [{ typeName: "PII" }] }] }) };
    const results = await checkClassificationApplied(dataMap);
    expect(results[0].status).toBe("pass");
  });

  test("Amazon RDS (AmazonSql family) supports classification but not sensitivity labeling", async () => {
    const dataMap = { post: async () => ({ value: [{ guid: "e1", typeName: "amazon_rds_instance", classification: [{ typeName: "PII" }] }] }) };
    const classificationResults = await checkClassificationApplied(dataMap);
    const labelResults = await checkSensitivityLabelsApplied(dataMap);
    expect(classificationResults[0].status).toBe("pass");
    expect(labelResults[0].status).toBe("not_applicable");
  });

  test.each([
    ["azure_sql_dw_table", "azure_sql_dw prefix"],
    ["azure_sql_data_warehouse_table", "azure_sql_data_warehouse prefix"],
    ["dedicated_sql_pool_table", "dedicated_sql_pool prefix"],
  ])("Synapse dedicated SQL pool / SQL Data Warehouse family (%s) supports classification", async (typeName) => {
    const dataMap = { post: async () => ({ value: [{ guid: "e1", typeName, classification: [{ typeName: "PII" }] }] }) };
    const results = await checkClassificationApplied(dataMap);
    expect(results[0].status).toBe("pass");
  });

  // 6a: azure_blob_path/azure_blob_account/azure_blob_service are the Atlas
  // typeNames actually observed for blob-storage assets — they should match
  // the Azure Storage rule via the "azure_blob" prefix.
  test.each([
    ["azure_blob_path", "azure_blob_path"],
    ["azure_blob_account", "azure_blob_account"],
    ["azure_blob_service", "azure_blob_service"],
  ])("supports classification for the %s typeName (azure_blob prefix)", async (typeName) => {
    const dataMap = { post: async () => ({ value: [{ guid: "e1", typeName, classification: [{ typeName: "PII" }] }] }) };
    const results = await checkClassificationApplied(dataMap);
    expect(results[0].status).toBe("pass");
  });

  // 6b: bare "mysql"/"rds" prefixes were removed so an unqualified,
  // non-Azure/Amazon source type doesn't wrongly match and produce a false
  // `fail` — it should fall through to not_applicable instead.
  test.each([
    ["mysql_database_table", "bare mysql (not azure_mysql-qualified)"],
    ["rds_instance_table", "bare rds (not amazon_rds-qualified)"],
  ])("does NOT match the %s typeName (%s) — falls through to not_applicable", async (typeName) => {
    const dataMap = { post: async () => ({ value: [{ guid: "e1", typeName, classification: [{ typeName: "PII" }] }] }) };
    const results = await checkClassificationApplied(dataMap);
    expect(results[0].status).toBe("not_applicable");
  });
});

describe("checkSensitivityLabelsApplied", () => {
  test("returns not_applicable when zero entities are returned", async () => {
    const dataMap = { post: async () => ({ value: [] }) };
    const results = await checkSensitivityLabelsApplied(dataMap);
    expect(results).toEqual([{ resourceId: "account", status: "not_applicable", message: "No scanned assets were found", evidencePayload: {} }]);
  });

  test("marks a labeling-unsupported type (e.g. Oracle) as not_applicable, and doesn't trigger the collapse case", async () => {
    const dataMap = { post: async () => ({ value: [{ guid: "e1", typeName: "oracle_table" }] }) };
    const results = await checkSensitivityLabelsApplied(dataMap);
    expect(results).toEqual([{ resourceId: "e1", status: "not_applicable", message: 'Asset type "oracle_table" does not support sensitivity labeling', evidencePayload: { typeName: "oracle_table" } }]);
  });

  test("passes a labeling-supported entity whose attributes carry a recognizable label field", async () => {
    const dataMap = { post: async () => ({ value: [{ guid: "e1", typeName: "azure_sql_table", attributes: { sensitivityLabel: "Confidential" } }] }) };
    const results = await checkSensitivityLabelsApplied(dataMap);
    expect(results).toEqual([{ resourceId: "e1", status: "pass", message: "Asset has a sensitivity label applied", evidencePayload: { typeName: "azure_sql_table" } }]);
  });

  test.each([
    ["azure_sql_dw_table", "azure_sql_dw prefix"],
    ["azure_sql_data_warehouse_table", "azure_sql_data_warehouse prefix"],
    ["dedicated_sql_pool_table", "dedicated_sql_pool prefix"],
  ])(
    "Synapse dedicated SQL pool / SQL Data Warehouse family (%s) is NOT swallowed by the broader azure_sql rule — supports classification but not sensitivity labeling",
    async (typeName) => {
      const dataMap = { post: async () => ({ value: [{ guid: "e1", typeName, attributes: { sensitivityLabel: "Confidential" } }] }) };
      const results = await checkSensitivityLabelsApplied(dataMap);
      expect(results).toEqual([{ resourceId: "e1", status: "not_applicable", message: `Asset type "${typeName}" does not support sensitivity labeling`, evidencePayload: { typeName } }]);
    },
  );

  test("distinguishes a plain azure_sql database (labeling supported) from an azure_sql_dw warehouse (labeling not supported) in the same result set", async () => {
    const dataMap = {
      post: async () => ({
        value: [
          { guid: "db1", typeName: "azure_sql_database_table", attributes: { sensitivityLabel: "Confidential" } },
          { guid: "dw1", typeName: "azure_sql_dw_table", attributes: { sensitivityLabel: "Confidential" } },
        ],
      }),
    };
    const results = await checkSensitivityLabelsApplied(dataMap);
    expect(results.find((r) => r.resourceId === "db1").status).toBe("pass");
    expect(results.find((r) => r.resourceId === "dw1").status).toBe("not_applicable");
  });

  test("matches the label field case-insensitively and by substring", async () => {
    const dataMap = { post: async () => ({ value: [{ guid: "e1", typeName: "azure_storage_account", attributes: { SENSITIVITY_LABEL_NAME: "Restricted" } }] }) };
    const results = await checkSensitivityLabelsApplied(dataMap);
    expect(results[0].status).toBe("pass");
  });

  test("falls back to checking the entity itself when `attributes` is absent", async () => {
    const dataMap = { post: async () => ({ value: [{ guid: "e1", typeName: "azure_cosmos_db", label: "Confidential" }] }) };
    const results = await checkSensitivityLabelsApplied(dataMap);
    expect(results[0].status).toBe("pass");
  });

  test("fails a labeling-supported entity with an empty label field, when at least one other entity has a populated one", async () => {
    const dataMap = {
      post: async () => ({
        value: [
          { guid: "e1", typeName: "azure_sql_table", attributes: { sensitivityLabel: "Confidential" } },
          { guid: "e2", typeName: "azure_storage_account", attributes: { sensitivityLabel: "" } },
        ],
      }),
    };
    const results = await checkSensitivityLabelsApplied(dataMap);
    expect(results.find((r) => r.resourceId === "e1").status).toBe("pass");
    expect(results.find((r) => r.resourceId === "e2").status).toBe("fail");
  });

  test("collapses to a single not_applicable when a labeling-supported type is present but no entity anywhere has a label field", async () => {
    const dataMap = {
      post: async () => ({
        value: [
          { guid: "e1", typeName: "azure_sql_table", attributes: { owner: "team-a" } },
          { guid: "e2", typeName: "azure_storage_account" },
          { guid: "e3", typeName: "oracle_table" },
        ],
      }),
    };
    const results = await checkSensitivityLabelsApplied(dataMap);
    expect(results).toEqual([
      {
        resourceId: "account",
        status: "not_applicable",
        message:
          "Sensitivity label data was not found in the API response; this may require Microsoft 365 licensing in the tenant, or the field name differs from what this check expects — verify manually in the Purview portal.",
        evidencePayload: {},
      },
    ]);
  });

  test("does not collapse when no entity supports labeling at all — each is not_applicable individually", async () => {
    const dataMap = {
      post: async () => ({
        value: [
          { guid: "e1", typeName: "oracle_table" },
          { guid: "e2", typeName: "teradata_table" },
        ],
      }),
    };
    const results = await checkSensitivityLabelsApplied(dataMap);
    expect(results).toHaveLength(2);
    expect(results.every((r) => r.status === "not_applicable")).toBe(true);
  });
});
