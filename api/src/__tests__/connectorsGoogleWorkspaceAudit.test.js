import { describe, test, expect } from "vitest";
import { checkAuditLogRetentionConfigured } from "../connectors/google_workspace/tests/audit.js";

function reportsWith(byApplication) {
  return {
    activities: {
      list: async ({ applicationName }) => ({ data: { items: byApplication[applicationName] || [] } }),
    },
  };
}

describe("checkAuditLogRetentionConfigured", () => {
  test("passes both admin and login when recent events exist", async () => {
    const recent = new Date(Date.now() - 2 * 24 * 60 * 60 * 1000).toISOString();
    const reports = reportsWith({
      admin: [{ id: { time: recent } }],
      login: [{ id: { time: recent } }],
    });
    const results = await checkAuditLogRetentionConfigured(reports, "C0");
    expect(results.map((r) => r.status)).toEqual(["pass", "pass"]);
  });

  test("fails an application with no events at all", async () => {
    const reports = reportsWith({ admin: [], login: [{ id: { time: new Date().toISOString() } }] });
    const results = await checkAuditLogRetentionConfigured(reports, "C0");
    const adminResult = results.find((r) => r.resourceId === "reports.admin");
    expect(adminResult.status).toBe("fail");
    expect(adminResult.message).toBe("admin activity logs returned no events at all");
  });

  test("fails an application whose most recent event is stale", async () => {
    const stale = new Date(Date.now() - 60 * 24 * 60 * 60 * 1000).toISOString();
    const reports = reportsWith({ admin: [{ id: { time: stale } }], login: [{ id: { time: stale } }] });
    const results = await checkAuditLogRetentionConfigured(reports, "C0");
    expect(results.every((r) => r.status === "fail")).toBe(true);
  });
});
