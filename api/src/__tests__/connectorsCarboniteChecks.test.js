import { describe, test, expect, vi } from "vitest";

import { backupTests, STALE_BACKUP_HOURS } from "../connectors/carbonite/tests/backup.js";
import { coverageTests } from "../connectors/carbonite/tests/coverage.js";

// Deviation from the connector plan's File Structure (separate
// connectorsCarboniteBackup / ...Coverage files): merged into one Checks file to
// match the current commvault / carbonite-server precedent.

const hoursAgo = (h) => new Date(Date.now() - h * 3_600_000).toISOString();

// Fake `creds` — a `call(operation, params)` that routes to a canned result.
function fakeCreds(routes) {
  return {
    call: vi.fn(async (operation) => {
      if (!(operation in routes)) throw new Error(`unexpected operation ${operation}`);
      const v = routes[operation];
      return typeof v === "function" ? v() : v;
    }),
  };
}

const runBackup = (creds) => backupTests[0].run(creds);
const runCoverage = (creds) => coverageTests[0].run(creds);

describe("carbonite.backup.recent_successful_backup", () => {
  test("passes a device whose LastCompleteBackupUtc is within the window", async () => {
    const creds = fakeCreds({
      GetDeviceList: { DeviceList: { DeviceInfo: [{ DeviceId: "d1", DeviceName: "laptop-1" }] } },
      GetDashboardDeviceInfo: { DeviceInfo: [{ DeviceId: "d1", LastCompleteBackupUtc: hoursAgo(3) }] },
    });
    const rows = await runBackup(creds);
    expect(rows).toHaveLength(1);
    expect(rows[0].status).toBe("pass");
    expect(rows[0].resourceId).toBe("d1");
    expect(creds.call).toHaveBeenCalledWith("GetDeviceList", {});
  });

  test("fails a device whose last completed backup is stale", async () => {
    const rows = await runBackup(fakeCreds({
      GetDeviceList: { DeviceList: { DeviceInfo: [{ DeviceId: "d1", DeviceName: "laptop-1" }] } },
      GetDashboardDeviceInfo: { DeviceInfo: [{ DeviceId: "d1", LastCompleteBackupUtc: hoursAgo(STALE_BACKUP_HOURS + 10) }] },
    }));
    expect(rows[0].status).toBe("fail");
    expect(rows[0].message).toMatch(/> 48h/);
  });

  test("fails a device that has never completed a backup", async () => {
    const rows = await runBackup(fakeCreds({
      GetDeviceList: { DeviceList: { DeviceInfo: [{ DeviceId: "d1", DeviceName: "laptop-1" }] } },
      GetDashboardDeviceInfo: { DeviceInfo: [{ DeviceId: "d1", LastBackupUtc: hoursAgo(1), LastCompleteBackupUtc: null }] },
    }));
    expect(rows[0].status).toBe("fail");
    expect(rows[0].message).toMatch(/never reported a completed backup/);
  });

  test("returns not_applicable when the tenant has no devices", async () => {
    const rows = await runBackup(fakeCreds({ GetDeviceList: { DeviceList: null } }));
    expect(rows[0].status).toBe("not_applicable");
  });

  test("returns 'error' when GetDeviceList has an unrecognised shape", async () => {
    const rows = await runBackup(fakeCreds({ GetDeviceList: { Status: "Completed", Nonsense: 1 } }));
    expect(rows[0].status).toBe("error");
    expect(rows[0].message).toMatch(/reconfirm the SOAP/);
  });

  test("returns 'error' for a device the detail call didn't resolve and with no timestamp", async () => {
    const rows = await runBackup(fakeCreds({
      GetDeviceList: { DeviceList: { DeviceInfo: [{ DeviceId: "d1", DeviceName: "laptop-1" }] } },
      GetDashboardDeviceInfo: { DeviceInfo: [] },
    }));
    expect(rows[0].status).toBe("error");
    expect(rows[0].message).toMatch(/no known timestamp field/);
  });

  test("evaluates every device independently", async () => {
    const rows = await runBackup(fakeCreds({
      GetDeviceList: { DeviceList: { DeviceInfo: [
        { DeviceId: "ok", DeviceName: "ok" },
        { DeviceId: "stale", DeviceName: "stale" },
      ] } },
      GetDashboardDeviceInfo: { DeviceInfo: [
        { DeviceId: "ok", LastCompleteBackupUtc: hoursAgo(2) },
        { DeviceId: "stale", LastCompleteBackupUtc: hoursAgo(200) },
      ] },
    }));
    expect(rows.find((r) => r.resourceId === "ok").status).toBe("pass");
    expect(rows.find((r) => r.resourceId === "stale").status).toBe("fail");
  });
});

describe("carbonite.backup.device_coverage", () => {
  test("passes a device in a recognised protected state", async () => {
    const rows = await runCoverage(fakeCreds({
      GetDeviceList: { DeviceList: { DeviceInfo: [{ DeviceId: "d1", DeviceName: "laptop-1", State: "Active" }] } },
    }));
    expect(rows[0].status).toBe("pass");
  });

  test("fails a device in a recognised lapsed state", async () => {
    const rows = await runCoverage(fakeCreds({
      GetDeviceList: { DeviceList: { DeviceInfo: [{ DeviceId: "d1", DeviceName: "laptop-1", State: "Suspended" }] } },
    }));
    expect(rows[0].status).toBe("fail");
    expect(rows[0].message).toMatch(/lapsed protection/);
  });

  test("returns 'error' — not a guessed pass/fail — for an unrecognised state value", async () => {
    const rows = await runCoverage(fakeCreds({
      GetDeviceList: { DeviceList: { DeviceInfo: [{ DeviceId: "d1", DeviceName: "laptop-1", State: "Quiesced" }] } },
    }));
    expect(rows[0].status).toBe("error");
    expect(rows[0].message).toMatch(/Unrecognised device state "Quiesced"/);
  });

  test("returns 'error' when no State field is present", async () => {
    const rows = await runCoverage(fakeCreds({
      GetDeviceList: { DeviceList: { DeviceInfo: [{ DeviceId: "d1", DeviceName: "laptop-1" }] } },
    }));
    expect(rows[0].status).toBe("error");
    expect(rows[0].message).toMatch(/no known State field/);
  });

  test("returns not_applicable for an empty tenant", async () => {
    const rows = await runCoverage(fakeCreds({ GetDeviceList: { DeviceList: null } }));
    expect(rows[0].status).toBe("not_applicable");
  });
});
