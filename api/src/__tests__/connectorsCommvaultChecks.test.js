import { describe, test, expect, vi } from "vitest";

import { backupTests } from "../connectors/commvault/tests/backup.js";
import { storageTests } from "../connectors/commvault/tests/storage.js";
import { monitoringTests } from "../connectors/commvault/tests/monitoring.js";

const runCheck = (defs, key, commvault) => defs.find((t) => t.key === key).run({ commvault });

function fakeClient(handler) {
  return { request: vi.fn(handler) };
}

describe("commvault.backup.sla_compliance", () => {
  const KEY = "commvault.backup.sla_compliance";

  test("passes when no entities are missing or never backed up", async () => {
    const commvault = fakeClient(async () => ({
      solutionSummary: { slaSummary: { totalEntities: 42, slaNotMetEntities: 0, neverBackedupEntities: 0 } },
    }));
    const rows = await runCheck(backupTests, KEY, commvault);
    expect(rows).toHaveLength(1);
    expect(rows[0].status).toBe("pass");
    expect(rows[0].message).toMatch(/All 42 monitored entities/);
    expect(commvault.request).toHaveBeenCalledWith("/dashboard?slaNumberOfDays=1");
  });

  test("fails and sums slaNotMet + neverBackedUp in the message", async () => {
    const commvault = fakeClient(async () => ({
      solutionSummary: { slaSummary: { totalEntities: 42, slaNotMetEntities: 3, neverBackedupEntities: 1 } },
    }));
    const rows = await runCheck(backupTests, KEY, commvault);
    expect(rows[0].status).toBe("fail");
    expect(rows[0].message).toBe("4 of 42 monitored entities are missing their backup SLA");
  });

  test("returns an 'error' row — not a guessed pass/fail — on an unexpected shape", async () => {
    const commvault = fakeClient(async () => ({ someUnexpectedShape: true }));
    const rows = await runCheck(backupTests, KEY, commvault);
    expect(rows[0].status).toBe("error");
    expect(rows[0].message).toMatch(/reconfirmed/);
    expect(rows[0].evidencePayload.details.rawResponseKeys).toEqual(["someUnexpectedShape"]);
  });
});

describe("commvault.storage.worm_lock_enabled", () => {
  const KEY = "commvault.storage.worm_lock_enabled";

  function storageClient({ policies, detailById }) {
    return fakeClient(async (path) => {
      if (path === "/StoragePolicy") return { policies };
      const m = path.match(/^\/v2\/StoragePolicy\/(\d+)\?propertyLevel=10$/);
      if (m) return detailById[m[1]];
      throw new Error(`unexpected path ${path}`);
    });
  }

  test("passes a copy with WORM/compliance lock enabled", async () => {
    const commvault = storageClient({
      policies: [{ storagePolicyName: "Primary", storagePolicyId: 1 }],
      detailById: { 1: { storagePolicyCopy: [{ copyName: "Primary Copy", copyFlags: { wormCopy: 1 } }] } },
    });
    const rows = await runCheck(storageTests, KEY, commvault);
    expect(rows).toHaveLength(1);
    expect(rows[0].status).toBe("pass");
    expect(rows[0].resourceId).toBe("Primary/Primary Copy");
  });

  test("fails a copy with WORM/compliance lock disabled, evaluating every copy independently", async () => {
    const commvault = storageClient({
      policies: [{ storagePolicyName: "Primary", storagePolicyId: 1 }],
      detailById: {
        1: {
          storagePolicyCopy: [
            { copyName: "Primary Copy", copyFlags: { wormCopy: 1 } },
            { copyName: "Secondary Copy", copyFlags: { wormCopy: 0 } },
          ],
        },
      },
    });
    const rows = await runCheck(storageTests, KEY, commvault);
    expect(rows).toHaveLength(2);
    expect(rows.find((r) => r.resourceId === "Primary/Primary Copy").status).toBe("pass");
    expect(rows.find((r) => r.resourceId === "Primary/Secondary Copy").status).toBe("fail");
  });

  test("returns not_applicable when there are no storage policies", async () => {
    const commvault = storageClient({ policies: [], detailById: {} });
    const rows = await runCheck(storageTests, KEY, commvault);
    expect(rows[0].status).toBe("not_applicable");
  });
});

describe("commvault.storage.encryption_enabled", () => {
  const KEY = "commvault.storage.encryption_enabled";

  function storageClient(copies) {
    return fakeClient(async (path) => {
      if (path === "/StoragePolicy") return { policies: [{ storagePolicyName: "Primary", storagePolicyId: 1 }] };
      if (path.startsWith("/v2/StoragePolicy/1")) return { storagePolicyCopy: copies };
      throw new Error(`unexpected path ${path}`);
    });
  }

  test("passes a copy with encryption enabled via copyFlags.encryptData", async () => {
    const rows = await runCheck(storageTests, KEY, storageClient([{ copyName: "Primary Copy", copyFlags: { encryptData: 1 } }]));
    expect(rows[0].status).toBe("pass");
  });

  test("fails a copy with encryption explicitly disabled", async () => {
    const rows = await runCheck(storageTests, KEY, storageClient([{ copyName: "Primary Copy", copyFlags: { encryptData: 0 } }]));
    expect(rows[0].status).toBe("fail");
  });

  test("returns 'error' (not a guessed pass) when no known encryption field is present", async () => {
    const rows = await runCheck(storageTests, KEY, storageClient([{ copyName: "Primary Copy", copyFlags: {} }]));
    expect(rows[0].status).toBe("error");
    expect(rows[0].message).toMatch(/live confirmation/);
  });
});

describe("commvault.monitoring.alerts_configured", () => {
  const KEY = "commvault.monitoring.alerts_configured";

  test("passes when an alert's category matches the job-failure heuristic", async () => {
    const commvault = fakeClient(async () => ({
      alertList: [{ alert: { name: "Backup Job Failed" }, alertCategory: { name: "Job Management" }, description: "Notifies on job failure" }],
    }));
    const rows = await runCheck(monitoringTests, KEY, commvault);
    expect(rows[0].status).toBe("pass");
    expect(rows[0].evidencePayload.details.matchingAlertNames).toEqual(["Backup Job Failed"]);
    expect(commvault.request).toHaveBeenCalledWith("/Alerts");
  });

  test("passes when the description mentions a failing backup job even if the category doesn't match", async () => {
    const commvault = fakeClient(async () => ({
      alertList: [{ alert: { name: "Custom Alert" }, alertCategory: { name: "Custom" }, description: "Triggers when a backup job fails unexpectedly" }],
    }));
    const rows = await runCheck(monitoringTests, KEY, commvault);
    expect(rows[0].status).toBe("pass");
  });

  test("fails when no configured alert looks like job-failure monitoring", async () => {
    const commvault = fakeClient(async () => ({
      alertList: [{ alert: { name: "Disk Space Low" }, alertCategory: { name: "Media Management" }, description: "Notifies when disk space is low" }],
    }));
    const rows = await runCheck(monitoringTests, KEY, commvault);
    expect(rows[0].status).toBe("fail");
    expect(rows[0].evidencePayload.details.matchingAlertNames).toEqual([]);
  });

  test("fails with zero total alerts when the alert list is empty", async () => {
    const commvault = fakeClient(async () => ({ alertList: [] }));
    const rows = await runCheck(monitoringTests, KEY, commvault);
    expect(rows[0].status).toBe("fail");
    expect(rows[0].evidencePayload.details.totalAlerts).toBe(0);
  });
});
