import { describe, test, expect, vi, beforeEach } from "vitest";

const queryMock = vi.fn();
const runCollectionMock = vi.fn();

vi.mock("../db/index.js", () => ({
  query: (...args) => queryMock(...args),
}));

vi.mock("../utils/email.js", () => ({
  sendEmail: vi.fn(),
}));

vi.mock("../utils/emailTemplate.js", () => ({
  buildEmailHtml: vi.fn(),
}));

vi.mock("../utils/auditLog.js", () => ({
  writeAuditLog: vi.fn(),
}));

vi.mock("../utils/collectionRunner.js", () => ({
  runCollection: (...args) => runCollectionMock(...args),
}));

const { runScheduledCollections, markStaleAutomatedEvidence } = await import("../utils/scheduler.js");

beforeEach(() => {
  queryMock.mockReset();
  runCollectionMock.mockReset();
});

describe("runScheduledCollections", () => {
  test("queries due connections with the expected WHERE clause", async () => {
    queryMock.mockResolvedValue({ rows: [], rowCount: 0 });

    await runScheduledCollections();

    expect(queryMock).toHaveBeenCalledTimes(1);
    const sql = queryMock.mock.calls[0][0];
    expect(sql).toContain("auto_collect_enabled = TRUE");
    expect(sql).toContain("status = 'connected'");
    expect(sql).toContain("last_run_at IS NULL OR last_run_at < NOW() - (collection_frequency_hours || ' hours')::INTERVAL");
  });

  test("calls runCollection once per due connection with triggerType scheduled", async () => {
    queryMock.mockResolvedValue({
      rows: [
        { id: "conn-1", company_id: "company-1" },
        { id: "conn-2", company_id: "company-2" },
      ],
      rowCount: 2,
    });
    runCollectionMock.mockResolvedValue({});

    await runScheduledCollections();

    expect(runCollectionMock).toHaveBeenCalledTimes(2);
    expect(runCollectionMock).toHaveBeenNthCalledWith(1, {
      connectionId: "conn-1",
      companyId: "company-1",
      triggeredBy: null,
      triggerType: "scheduled",
    });
    expect(runCollectionMock).toHaveBeenNthCalledWith(2, {
      connectionId: "conn-2",
      companyId: "company-2",
      triggeredBy: null,
      triggerType: "scheduled",
    });
  });

  test("a thrown error (e.g. a 409 concurrency conflict) from one connection does not prevent the next", async () => {
    queryMock.mockResolvedValue({
      rows: [
        { id: "conn-1", company_id: "company-1" },
        { id: "conn-2", company_id: "company-2" },
        { id: "conn-3", company_id: "company-3" },
      ],
      rowCount: 3,
    });

    const conflictErr = Object.assign(
      new Error("A collection run is already in progress for this connection"),
      { status: 409 }
    );

    runCollectionMock.mockImplementation(async ({ connectionId }) => {
      if (connectionId === "conn-1") throw conflictErr;
      if (connectionId === "conn-2") throw new Error("some other unrelated failure");
      return {};
    });

    // Should not throw out of runScheduledCollections despite per-connection failures.
    await expect(runScheduledCollections()).resolves.toBeUndefined();

    expect(runCollectionMock).toHaveBeenCalledTimes(3);
    expect(runCollectionMock).toHaveBeenNthCalledWith(1, expect.objectContaining({ connectionId: "conn-1" }));
    expect(runCollectionMock).toHaveBeenNthCalledWith(2, expect.objectContaining({ connectionId: "conn-2" }));
    expect(runCollectionMock).toHaveBeenNthCalledWith(3, expect.objectContaining({ connectionId: "conn-3" }));
  });

  test("does not throw if the initial query itself fails", async () => {
    queryMock.mockRejectedValue(new Error("db connection lost"));

    await expect(runScheduledCollections()).resolves.toBeUndefined();
    expect(runCollectionMock).not.toHaveBeenCalled();
  });
});

describe("markStaleAutomatedEvidence", () => {
  test("marks overdue fresh items stale and triple-overdue items expired", async () => {
    queryMock.mockResolvedValueOnce({ rowCount: 2 }).mockResolvedValueOnce({ rowCount: 1 });

    await markStaleAutomatedEvidence();

    expect(queryMock).toHaveBeenCalledTimes(2);

    const staleSql = queryMock.mock.calls[0][0];
    expect(staleSql).toContain("status = 'stale'");
    expect(staleSql).toContain("status = 'fresh' AND next_collection_due_at < NOW()");

    const expiredSql = queryMock.mock.calls[1][0];
    expect(expiredSql).toContain("status = 'expired'");
    expect(expiredSql).toContain("status IN ('fresh', 'stale')");
    expect(expiredSql).toContain("3 * ic.collection_frequency_hours");
  });

  test("does not throw if a query fails", async () => {
    queryMock.mockRejectedValue(new Error("db connection lost"));
    await expect(markStaleAutomatedEvidence()).resolves.toBeUndefined();
  });
});
