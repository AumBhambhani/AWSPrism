import { describe, test, expect, vi } from "vitest";

import { backupTests, STALE_SAFESET_HOURS } from "../connectors/carbonite-server/tests/backup.js";
import { monitoringTests, AGENT_OFFLINE_HOURS } from "../connectors/carbonite-server/tests/monitoring.js";

// Deviation from the connector plan's File Structure (which named separate
// connectorsCarboniteServerBackup / ...Monitoring files): merged into one Checks
// file to match the current commvault precedent (connectorsCommvaultChecks.test.js).

const runCheck = (defs, key, carboniteServer) => defs.find((t) => t.key === key).run({ carboniteServer });

function fakeClient(handler) {
  return { request: vi.fn(handler) };
}

const hoursAgo = (h) => new Date(Date.now() - h * 3_600_000).toISOString();

describe("carbonite-server.backup.recent_successful_safeset", () => {
  const KEY = "carbonite-server.backup.recent_successful_safeset";

  test("passes a safeset whose last run succeeded within the window", async () => {
    const client = fakeClient(async () => ({
      value: [{ Name: "SQL nightly", LastRunStatus: "Completed", LastRunTime: hoursAgo(3) }],
    }));
    const rows = await runCheck(backupTests, KEY, client);
    expect(rows).toHaveLength(1);
    expect(rows[0].status).toBe("pass");
    expect(rows[0].resourceId).toBe("SQL nightly");
    expect(client.request).toHaveBeenCalledWith("/odata/Safesets");
  });

  test("fails a safeset whose last run did not succeed", async () => {
    const rows = await runCheck(
      backupTests,
      KEY,
      fakeClient(async () => ({ value: [{ Name: "SQL nightly", LastRunStatus: "Failed", LastRunTime: hoursAgo(2) }] }))
    );
    expect(rows[0].status).toBe("fail");
    expect(rows[0].message).toMatch(/did not succeed \(status: Failed\)/);
  });

  test("fails a safeset that succeeded but has gone stale", async () => {
    const rows = await runCheck(
      backupTests,
      KEY,
      fakeClient(async () => ({
        value: [{ Name: "Archive", LastRunStatus: "Success", LastRunTime: hoursAgo(STALE_SAFESET_HOURS + 10) }],
      }))
    );
    expect(rows[0].status).toBe("fail");
    expect(rows[0].message).toMatch(/stopped running/);
  });

  test("evaluates every safeset independently", async () => {
    const rows = await runCheck(
      backupTests,
      KEY,
      fakeClient(async () => ({
        value: [
          { Name: "good", LastRunStatus: "Success", LastRunTime: hoursAgo(1) },
          { Name: "bad", LastRunStatus: "Error", LastRunTime: hoursAgo(1) },
        ],
      }))
    );
    expect(rows).toHaveLength(2);
    expect(rows.find((r) => r.resourceId === "good").status).toBe("pass");
    expect(rows.find((r) => r.resourceId === "bad").status).toBe("fail");
  });

  test("returns not_applicable when no safesets are monitored", async () => {
    const rows = await runCheck(backupTests, KEY, fakeClient(async () => ({ value: [] })));
    expect(rows[0].status).toBe("not_applicable");
  });

  test("returns 'error' — not a guessed pass/fail — when the OData shape is unrecognised", async () => {
    const rows = await runCheck(backupTests, KEY, fakeClient(async () => ({ Safesets: [] })));
    expect(rows[0].status).toBe("error");
    expect(rows[0].message).toMatch(/reconfirmed against/);
    expect(rows[0].evidencePayload.details.rawResponseKeys).toEqual(["Safesets"]);
  });

  test("returns 'error' for a row with no recognisable status field", async () => {
    const rows = await runCheck(
      backupTests,
      KEY,
      fakeClient(async () => ({ value: [{ Name: "mystery", Foo: 1 }] }))
    );
    expect(rows[0].status).toBe("error");
    expect(rows[0].message).toMatch(/no known status field/);
  });
});

describe("carbonite-server.monitoring.agent_online", () => {
  const KEY = "carbonite-server.monitoring.agent_online";

  test("passes an agent with IsOnline true", async () => {
    const client = fakeClient(async () => ({ value: [{ Name: "web-01", IsOnline: true }] }));
    const rows = await runCheck(monitoringTests, KEY, client);
    expect(rows[0].status).toBe("pass");
    expect(client.request).toHaveBeenCalledWith("/odata/Agents");
  });

  test("fails an agent with IsOnline false", async () => {
    const rows = await runCheck(monitoringTests, KEY, fakeClient(async () => ({ value: [{ Name: "web-01", IsOnline: false }] })));
    expect(rows[0].status).toBe("fail");
    expect(rows[0].message).toMatch(/offline/);
  });

  test("falls back to check-in recency when no online flag is present", async () => {
    const rows = await runCheck(
      monitoringTests,
      KEY,
      fakeClient(async () => ({
        value: [
          { Name: "fresh", LastCheckIn: hoursAgo(1) },
          { Name: "stale", LastCheckIn: hoursAgo(AGENT_OFFLINE_HOURS + 5) },
        ],
      }))
    );
    expect(rows.find((r) => r.resourceId === "fresh").status).toBe("pass");
    expect(rows.find((r) => r.resourceId === "stale").status).toBe("fail");
  });

  test("maps a textual Status token to online/offline", async () => {
    const rows = await runCheck(
      monitoringTests,
      KEY,
      fakeClient(async () => ({
        value: [
          { Name: "a", Status: "Connected" },
          { Name: "b", Status: "Disconnected" },
        ],
      }))
    );
    expect(rows.find((r) => r.resourceId === "a").status).toBe("pass");
    expect(rows.find((r) => r.resourceId === "b").status).toBe("fail");
  });

  test("returns 'error' when an agent has no usable connectivity field", async () => {
    const rows = await runCheck(monitoringTests, KEY, fakeClient(async () => ({ value: [{ Name: "mystery", Foo: 1 }] })));
    expect(rows[0].status).toBe("error");
    expect(rows[0].message).toMatch(/no known online flag/);
  });

  test("returns not_applicable when no agents are registered", async () => {
    const rows = await runCheck(monitoringTests, KEY, fakeClient(async () => ({ value: [] })));
    expect(rows[0].status).toBe("not_applicable");
  });

  test("returns 'error' when the OData shape is unrecognised", async () => {
    const rows = await runCheck(monitoringTests, KEY, fakeClient(async () => ({ Agents: [] })));
    expect(rows[0].status).toBe("error");
    expect(rows[0].evidencePayload.details.rawResponseKeys).toEqual(["Agents"]);
  });
});
