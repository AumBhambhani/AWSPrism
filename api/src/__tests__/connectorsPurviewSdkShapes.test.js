import { describe, test, expect } from "vitest";
import { checkSourcesScanned, checkScanScheduleConfigured, checkClassificationApplied, checkSensitivityLabelsApplied } from "../connectors/purview/tests/datamap.js";
import { checkUnifiedLoggingEnabled, checkSubscriptionsActive, checkDlpAlertsAvailable, checkContentRecentlyAvailable } from "../connectors/purview/tests/audit.js";

// Azure's analog (connectorsAzureSdkShapes.test.js) exists because Azure uses
// real npm SDK packages whose runtime return-shape (paged iterator vs. plain
// Promise) can silently drift across SDK version bumps. Purview's connector
// uses zero SDK packages — plain `fetch` only (confirmed during Task 0
// research) — so there's no SDK object to instantiate and inspect here.
//
// The equivalent risk for Purview is different: the REST response *shapes*
// this connector's check functions parse are themselves documented as
// research findings (.superpowers/sdd/2026-08-20-purview-evidence-collection-v1/
// task-0-research.md and task-3a-research-supplement.md), several explicitly
// flagged there as unconfirmed against a live tenant. This file builds
// canonical fixture objects matching those documented shapes EXACTLY, then
// runs the real check functions from datamap.js/audit.js against them via a
// fake dataMap/audit client, asserting the check functions produce sensible
// results without throwing or silently misreading a field.
//
// This is NOT a re-test of per-branch logic (pass/fail/not_applicable
// decisions for every input variation are already covered exhaustively by
// connectorsPurviewDatamap.test.js and connectorsPurviewAudit.test.js) — this
// file's job is narrower: prove the *shape itself* round-trips through real
// parsing code. If a future maintainer captures a real API response and a
// fixture here doesn't match, the fixtures flagged "UNCONFIRMED" below are
// the first place to check.
//
// Keep this file read-only/pure — no network, no DB.

// Pinned to task-0-research.md finding #3 ("List data sources + scans + scan
// run history" — GET {base}/datasources). Field names, nesting, and the
// `nextLink`/`count` envelope match that finding's fixture verbatim.
const DATASOURCES_RESPONSE_FIXTURE = {
  value: [
    {
      id: "datasource-1",
      name: "my-azure-storage",
      kind: "AzureStorage",
      scans: [
        {
          id: "scan-1",
          name: "daily-scan",
          kind: "Custom",
          scanResults: [
            {
              parentId: "scan-1",
              id: "scanresult-1",
              resourceId: "datasource-1",
              status: "Completed",
              assetsDiscovered: 42,
              assetsClassified: 40,
              diagnostics: { notifications: [{ message: "ok", code: "0" }], exceptionCountMap: {} },
              startTime: new Date(Date.now() - 6 * 24 * 60 * 60 * 1000).toISOString(),
              queuedTime: new Date(Date.now() - 6 * 24 * 60 * 60 * 1000).toISOString(),
              pipelineStartTime: new Date(Date.now() - 6 * 24 * 60 * 60 * 1000).toISOString(),
              endTime: new Date(Date.now() - 5 * 24 * 60 * 60 * 1000).toISOString(),
              scanRulesetVersion: 1,
              scanRulesetType: "System",
              scanLevelType: "Full",
              errorMessage: null,
              error: null,
              // UNCONFIRMED — task-3a-research-supplement.md's "Scan schedule
              // (checkScanScheduleConfigured)" section: no trigger-endpoint
              // response shape was ever found via docs search. `runType:
              // "Scheduled"` is the connector's inferred recurrence signal
              // (vs. a one-off manual run), not a value confirmed against a
              // live API response — flag this fixture first if a real
              // /datasources response uses a different runType string.
              runType: "Scheduled",
              dataSourceType: "AzureStorage",
            },
          ],
        },
      ],
    },
  ],
  nextLink: null,
  count: 1,
};

// Pinned to task-0-research.md finding #3 ("Classification / sensitivity
// label fields on entities" — POST {base}/datamap/api/search/query). The
// `classifications` field name is confirmed by that finding, though the
// finding itself notes the field's behavior is "inconsistent between
// standard and custom entity types."
const SEARCH_QUERY_RESPONSE_FIXTURE = {
  value: [
    {
      guid: "entity-guid-1",
      typeName: "azure_storage_account",
      classifications: [{ typeName: "MICROSOFT.PERSONAL.NAME", entityGuid: "entity-guid-1" }],
      attributes: {
        qualifiedName: "https://mystorageacct.blob.core.windows.net/",
        // UNCONFIRMED — task-3a-research-supplement.md's "Entity
        // classification/sensitivity-label field shapes" section: no REST
        // field name for sensitivity labels on a Data Map entity was ever
        // found in Microsoft's docs. `sensitivityLabel` here is this
        // connector's defensive best guess at a plausible field name (the
        // real check function scans `attributes` for ANY key whose name
        // contains "label", so it doesn't strictly require this exact key)
        // — flag this fixture first if a real entity response uses a
        // different field, or none at all.
        sensitivityLabel: "Confidential",
      },
    },
  ],
};

// Pinned to task-0-research.md finding #5 ("O365 Management Activity API
// shapes" — GET /subscriptions/list -> [{contentType, status, webhook}]).
const SUBSCRIPTIONS_LIST_RESPONSE_FIXTURE = [
  { contentType: "Audit.AzureActiveDirectory", status: "enabled", webhook: null },
  { contentType: "Audit.Exchange", status: "enabled", webhook: null },
  { contentType: "Audit.SharePoint", status: "enabled", webhook: null },
  { contentType: "Audit.General", status: "enabled", webhook: null },
  { contentType: "DLP.All", status: "enabled", webhook: null },
];

// Pinned to task-0-research.md finding #5 (GET /subscriptions/content ->
// [{contentType, contentId, contentUri, contentCreated, contentExpiration}]).
const SUBSCRIPTIONS_CONTENT_RESPONSE_FIXTURE = [
  {
    contentType: "Audit.General",
    contentId: "content-blob-1",
    contentUri: "https://manage.office.com/api/v1.0/tenant-id/activity/feed/audit/content-blob-1",
    contentCreated: new Date().toISOString(),
    contentExpiration: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString(),
  },
];

function fakeDataMapClient() {
  return {
    get: async (path) => {
      if (path === "/datasources") return DATASOURCES_RESPONSE_FIXTURE;
      throw new Error(`fakeDataMapClient: unexpected GET ${path}`);
    },
    post: async (path) => {
      if (path.startsWith("/datamap/api/search/query")) return SEARCH_QUERY_RESPONSE_FIXTURE;
      throw new Error(`fakeDataMapClient: unexpected POST ${path}`);
    },
  };
}

function fakeAuditClient() {
  return {
    get: async (path) => {
      if (path === "/subscriptions/list") return SUBSCRIPTIONS_LIST_RESPONSE_FIXTURE;
      if (path.startsWith("/subscriptions/content")) return SUBSCRIPTIONS_CONTENT_RESPONSE_FIXTURE;
      throw new Error(`fakeAuditClient: unexpected GET ${path}`);
    },
  };
}

describe("Purview REST response shapes (guards against API contract drift)", () => {
  describe("/datasources shape (task-0-research.md #3)", () => {
    test("checkSourcesScanned parses the fixture without throwing and produces a sensible result", async () => {
      const results = await checkSourcesScanned(fakeDataMapClient());
      expect(results).toHaveLength(1);
      expect(results[0].resourceId).toBe("datasource-1");
      expect(["pass", "fail"]).toContain(results[0].status);
      expect(results[0].evidencePayload.mostRecentScanTime).toBe(DATASOURCES_RESPONSE_FIXTURE.value[0].scans[0].scanResults[0].endTime);
    });

    test("checkScanScheduleConfigured parses the fixture's runType field without throwing (UNCONFIRMED shape)", async () => {
      const results = await checkScanScheduleConfigured(fakeDataMapClient());
      expect(results).toHaveLength(1);
      expect(results[0].resourceId).toBe("datasource-1");
      expect(["pass", "fail"]).toContain(results[0].status);
    });
  });

  describe("/datamap/api/search/query shape (task-0-research.md #3)", () => {
    test("checkClassificationApplied parses the `classifications` field without throwing", async () => {
      const results = await checkClassificationApplied(fakeDataMapClient());
      expect(results).toHaveLength(1);
      expect(results[0].resourceId).toBe("entity-guid-1");
      expect(["pass", "fail", "not_applicable"]).toContain(results[0].status);
      expect(results[0].evidencePayload.typeName).toBe("azure_storage_account");
    });

    test("checkSensitivityLabelsApplied parses the fixture's attributes.sensitivityLabel field without throwing (UNCONFIRMED field name)", async () => {
      const results = await checkSensitivityLabelsApplied(fakeDataMapClient());
      expect(results.length).toBeGreaterThanOrEqual(1);
      expect(["pass", "fail", "not_applicable"]).toContain(results[0].status);
    });
  });

  describe("/subscriptions/list and /subscriptions/content shapes (task-0-research.md #5)", () => {
    test("checkUnifiedLoggingEnabled treats a successful /subscriptions/list call as pass", async () => {
      const results = await checkUnifiedLoggingEnabled(fakeAuditClient());
      expect(results).toEqual([{ resourceId: "tenant", status: "pass", message: "Unified audit logging is enabled for this tenant", evidencePayload: {} }]);
    });

    test("checkSubscriptionsActive parses the subscriptions-list array shape for all four required content types", async () => {
      const results = await checkSubscriptionsActive(fakeAuditClient());
      expect(results).toHaveLength(4);
      expect(results.every((r) => r.status === "pass")).toBe(true);
    });

    test("checkDlpAlertsAvailable parses the DLP.All entry from the subscriptions-list shape", async () => {
      const results = await checkDlpAlertsAvailable(fakeAuditClient());
      expect(results).toHaveLength(1);
      expect(results[0].status).toBe("pass");
    });

    test("checkContentRecentlyAvailable parses the subscriptions/content array shape without throwing", async () => {
      const results = await checkContentRecentlyAvailable(fakeAuditClient());
      expect(results).toHaveLength(4);
      expect(results.every((r) => ["pass", "fail", "error"].includes(r.status))).toBe(true);
    });
  });
});
