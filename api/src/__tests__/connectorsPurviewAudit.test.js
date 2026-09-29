import { describe, test, expect } from "vitest";
import {
  checkUnifiedLoggingEnabled,
  checkSubscriptionsActive,
  checkDlpAlertsAvailable,
  checkContentRecentlyAvailable,
} from "../connectors/purview/tests/audit.js";

describe("checkUnifiedLoggingEnabled", () => {
  test("passes when /subscriptions/list succeeds (even with an empty array)", async () => {
    const audit = { get: async () => [] };
    const results = await checkUnifiedLoggingEnabled(audit);
    expect(results).toEqual([{ resourceId: "tenant", status: "pass", message: "Unified audit logging is enabled for this tenant", evidencePayload: {} }]);
  });

  test("fails when the thrown error message contains the audit-disabled Microsoft exception signature", async () => {
    const audit = {
      get: async () => {
        throw new Error(
          "{\"error\":{\"code\":\"AF20024\",\"message\":\"Tenant does not have a valid subscription... Microsoft.Office.Compliance.Audit.DataServiceException\"}}",
        );
      },
    };
    const results = await checkUnifiedLoggingEnabled(audit);
    expect(results).toEqual([{ resourceId: "tenant", status: "fail", message: "Unified audit logging is disabled for this tenant.", evidencePayload: {} }]);
  });

  test("returns error (not fail) for an unrelated failure, e.g. an auth error", async () => {
    const audit = {
      get: async () => {
        throw new Error("401 Unauthorized: invalid access token");
      },
    };
    const results = await checkUnifiedLoggingEnabled(audit);
    expect(results[0].status).toBe("error");
    expect(results[0].message).toContain("401 Unauthorized");
  });
});

describe("checkSubscriptionsActive", () => {
  test("passes all four required content types when each is present and enabled", async () => {
    const audit = {
      get: async () => [
        { contentType: "Audit.AzureActiveDirectory", status: "enabled" },
        { contentType: "Audit.Exchange", status: "enabled" },
        { contentType: "Audit.SharePoint", status: "enabled" },
        { contentType: "Audit.General", status: "enabled" },
      ],
    };
    const results = await checkSubscriptionsActive(audit);
    expect(results).toHaveLength(4);
    expect(results.every((r) => r.status === "pass")).toBe(true);
  });

  test("matches status case-insensitively", async () => {
    const audit = {
      get: async () => [{ contentType: "Audit.General", status: "Enabled" }],
    };
    const results = await checkSubscriptionsActive(audit);
    expect(results.find((r) => r.resourceId === "Audit.General").status).toBe("pass");
  });

  test("fails a content type present but not enabled (e.g. paused)", async () => {
    const audit = {
      get: async () => [{ contentType: "Audit.Exchange", status: "paused" }],
    };
    const results = await checkSubscriptionsActive(audit);
    const exchange = results.find((r) => r.resourceId === "Audit.Exchange");
    expect(exchange.status).toBe("fail");
    expect(exchange.message).toContain("paused");
  });

  test("fails a content type absent from the subscriptions list entirely", async () => {
    const audit = { get: async () => [] };
    const results = await checkSubscriptionsActive(audit);
    expect(results).toHaveLength(4);
    expect(results.every((r) => r.status === "fail")).toBe(true);
    expect(results.find((r) => r.resourceId === "Audit.General").message).toContain("has not been started");
  });

  test("returns error (not fail) for all four required content types when the list call itself throws", async () => {
    const audit = {
      get: async () => {
        throw new Error("503 Service Unavailable");
      },
    };
    const results = await checkSubscriptionsActive(audit);
    expect(results).toHaveLength(4);
    expect(results.every((r) => r.status === "error")).toBe(true);
    expect(results.map((r) => r.resourceId).sort()).toEqual(
      ["Audit.AzureActiveDirectory", "Audit.Exchange", "Audit.General", "Audit.SharePoint"].sort(),
    );
  });
});

describe("checkDlpAlertsAvailable", () => {
  test("not_applicable when DLP.All is absent from the subscriptions list", async () => {
    const audit = { get: async () => [{ contentType: "Audit.General", status: "enabled" }] };
    const results = await checkDlpAlertsAvailable(audit);
    expect(results).toEqual([
      {
        resourceId: "DLP.All",
        status: "not_applicable",
        message: "No evidence of DLP policy configuration; cannot distinguish 'no DLP policies configured' from 'DLP.All subscription never started' via this API alone",
        evidencePayload: {},
      },
    ]);
  });

  test("fails when DLP.All is present but not enabled", async () => {
    const audit = { get: async () => [{ contentType: "DLP.All", status: "disabled" }] };
    const results = await checkDlpAlertsAvailable(audit);
    expect(results).toEqual([
      { resourceId: "DLP.All", status: "fail", message: "DLP.All subscription exists but is not actively logging", evidencePayload: { status: "disabled" } },
    ]);
  });

  test("passes when DLP.All is present and enabled", async () => {
    const audit = { get: async () => [{ contentType: "DLP.All", status: "enabled" }] };
    const results = await checkDlpAlertsAvailable(audit);
    expect(results).toEqual([
      { resourceId: "DLP.All", status: "pass", message: "DLP.All subscription is active and logging", evidencePayload: { status: "enabled" } },
    ]);
  });

  test("returns error when the underlying call throws", async () => {
    const audit = {
      get: async () => {
        throw new Error("network timeout");
      },
    };
    const results = await checkDlpAlertsAvailable(audit);
    expect(results[0].status).toBe("error");
    expect(results[0].resourceId).toBe("DLP.All");
  });
});

describe("checkContentRecentlyAvailable", () => {
  test("not_applicable when there are zero active subscriptions among the required content types", async () => {
    const audit = {
      get: async (path) => {
        if (path === "/subscriptions/list") return [{ contentType: "Audit.General", status: "disabled" }];
        throw new Error("should not be called");
      },
    };
    const results = await checkContentRecentlyAvailable(audit);
    expect(results).toEqual([{ resourceId: "tenant", status: "not_applicable", message: "No active subscriptions to check content for", evidencePayload: {} }]);
  });

  test("passes an active content type with at least one content blob in the last 24h", async () => {
    const audit = {
      get: async (path) => {
        if (path === "/subscriptions/list") return [{ contentType: "Audit.General", status: "enabled" }];
        if (path === "/subscriptions/content?contentType=Audit.General") return [{ contentUri: "https://blob/1" }];
        throw new Error("unexpected path: " + path);
      },
    };
    const results = await checkContentRecentlyAvailable(audit);
    expect(results).toEqual([
      {
        resourceId: "Audit.General",
        status: "pass",
        message: "Audit.General has audit content available from the last 24 hours",
        evidencePayload: { blobCount: 1 },
      },
    ]);
  });

  test("fails an active content type with zero content blobs, mentioning the 12-hour delay", async () => {
    const audit = {
      get: async (path) => {
        if (path === "/subscriptions/list") return [{ contentType: "Audit.Exchange", status: "enabled" }];
        if (path === "/subscriptions/content?contentType=Audit.Exchange") return [];
        throw new Error("unexpected path: " + path);
      },
    };
    const results = await checkContentRecentlyAvailable(audit);
    expect(results[0].status).toBe("fail");
    expect(results[0].message).toContain("12 hours");
  });

  test("returns error (not fail) when the content-fetch call itself throws", async () => {
    const audit = {
      get: async (path) => {
        if (path === "/subscriptions/list") return [{ contentType: "Audit.SharePoint", status: "enabled" }];
        throw new Error("500 Internal Server Error");
      },
    };
    const results = await checkContentRecentlyAvailable(audit);
    expect(results).toEqual([
      {
        resourceId: "Audit.SharePoint",
        status: "error",
        message: "Could not check content availability for Audit.SharePoint: 500 Internal Server Error",
        evidencePayload: {},
      },
    ]);
  });

  test("evaluates each active content type independently", async () => {
    const audit = {
      get: async (path) => {
        if (path === "/subscriptions/list")
          return [
            { contentType: "Audit.General", status: "enabled" },
            { contentType: "Audit.Exchange", status: "enabled" },
          ];
        if (path === "/subscriptions/content?contentType=Audit.General") return [{ contentUri: "x" }];
        if (path === "/subscriptions/content?contentType=Audit.Exchange") return [];
        throw new Error("unexpected path: " + path);
      },
    };
    const results = await checkContentRecentlyAvailable(audit);
    expect(results).toHaveLength(2);
    expect(results.find((r) => r.resourceId === "Audit.General").status).toBe("pass");
    expect(results.find((r) => r.resourceId === "Audit.Exchange").status).toBe("fail");
  });

  test("returns error for all four required content types when the subscriptions list call itself throws", async () => {
    const audit = {
      get: async () => {
        throw new Error("503 Service Unavailable");
      },
    };
    const results = await checkContentRecentlyAvailable(audit);
    expect(results).toHaveLength(4);
    expect(results.every((r) => r.status === "error")).toBe(true);
  });
});
