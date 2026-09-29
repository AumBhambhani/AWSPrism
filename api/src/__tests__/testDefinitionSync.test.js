import { describe, test, expect, vi, beforeEach } from "vitest";

const queryMock = vi.fn(async () => ({ rows: [], rowCount: 0 }));
const listConnectorKeysMock = vi.fn();
const listConnectorTestsMock = vi.fn();

vi.mock("../db/index.js", () => ({
  query: (...args) => queryMock(...args),
}));

vi.mock("../connectors/registry.js", () => ({
  listConnectorKeys: (...args) => listConnectorKeysMock(...args),
  listConnectorTests: (...args) => listConnectorTestsMock(...args),
}));

const { syncTestDefinitions } = await import("../utils/testDefinitionSync.js");

const FAKE_TESTS = [
  {
    key: "fake.check_one",
    title: "Fake check one",
    severityDefault: "high",
    isoReferences: ["A.1.1.1", "A.2.2.2"],
  },
  {
    key: "fake.check_two",
    title: "Fake check two",
    severityDefault: "medium",
    isoReferences: ["A.3.3.3"],
  },
];

beforeEach(() => {
  queryMock.mockClear();
  queryMock.mockImplementation(async () => ({ rows: [], rowCount: 0 }));

  listConnectorKeysMock.mockReset();
  listConnectorTestsMock.mockReset();
  listConnectorKeysMock.mockReturnValue(["fake"]);
  listConnectorTestsMock.mockImplementation((integrationKey) => (integrationKey === "fake" ? FAKE_TESTS : []));
});

describe("syncTestDefinitions", () => {
  test("upserts automated_tests and test_control_mappings for every connector test", async () => {
    await syncTestDefinitions();

    const automatedTestsCalls = queryMock.mock.calls.filter(([sql]) => sql.includes("INSERT INTO automated_tests"));
    const mappingCalls = queryMock.mock.calls.filter(([sql]) => sql.includes("INSERT INTO test_control_mappings"));

    expect(automatedTestsCalls).toHaveLength(2);
    expect(automatedTestsCalls[0][0]).toContain("ON CONFLICT (test_key) DO UPDATE SET title = EXCLUDED.title, severity_default = EXCLUDED.severity_default");
    expect(automatedTestsCalls[0][1]).toEqual(["fake", "fake.check_one", "Fake check one", "high"]);
    expect(automatedTestsCalls[1][1]).toEqual(["fake", "fake.check_two", "Fake check two", "medium"]);

    // 2 ISO references for check_one + 1 for check_two = 3 mapping upserts (no dpdpaControlAreas on these fixtures)
    expect(mappingCalls).toHaveLength(3);
    expect(mappingCalls[0][0]).toContain("VALUES ($1, 'ISO27001', $2)");
    expect(mappingCalls[0][0]).toContain("ON CONFLICT (test_key, framework, iso_reference) DO NOTHING");
    expect(mappingCalls[0][1]).toEqual(["fake.check_one", "A.1.1.1"]);
    expect(mappingCalls[1][1]).toEqual(["fake.check_one", "A.2.2.2"]);
    expect(mappingCalls[2][1]).toEqual(["fake.check_two", "A.3.3.3"]);
  });

  test("also upserts DPDPA test_control_mappings from dpdpaControlAreas, keyed by control_area not iso_reference", async () => {
    listConnectorTestsMock.mockImplementation((integrationKey) =>
      integrationKey === "fake"
        ? [
            {
              key: "fake.check_one",
              title: "Fake check one",
              severityDefault: "high",
              isoReferences: ["A.1.1.1"],
              dpdpaControlAreas: ["Access Control & Least Privilege", "Encryption"],
            },
          ]
        : []
    );

    await syncTestDefinitions();

    const mappingCalls = queryMock.mock.calls.filter(([sql]) => sql.includes("INSERT INTO test_control_mappings"));
    const dpdpaCalls = mappingCalls.filter(([sql]) => sql.includes("'DPDPA'"));
    const isoCalls = mappingCalls.filter(([sql]) => sql.includes("'ISO27001'"));

    expect(isoCalls).toHaveLength(1);
    expect(isoCalls[0][1]).toEqual(["fake.check_one", "A.1.1.1"]);

    expect(dpdpaCalls).toHaveLength(2);
    expect(dpdpaCalls[0][0]).toContain("VALUES ($1, 'DPDPA', $2)");
    expect(dpdpaCalls[0][0]).toContain("ON CONFLICT (test_key, framework, iso_reference) DO NOTHING");
    expect(dpdpaCalls[0][1]).toEqual(["fake.check_one", "Access Control & Least Privilege"]);
    expect(dpdpaCalls[1][1]).toEqual(["fake.check_one", "Encryption"]);
  });

  test("fans a real ISO Annex A reference out into per-framework test_control_mappings via the crosswalk", async () => {
    listConnectorTestsMock.mockImplementation((integrationKey) =>
      integrationKey === "fake"
        ? [
            {
              key: "fake.secure_logon",
              title: "Secure log-on",
              severityDefault: "high",
              isoReferences: ["A.9.4.2"], // real clause — present in the crosswalk
            },
          ]
        : []
    );

    await syncTestDefinitions();

    const mappingCalls = queryMock.mock.calls.filter(([sql]) => sql.includes("INSERT INTO test_control_mappings"));

    // one direct ISO27001 row + one row per crosswalk target framework for A.9.4.2
    const isoRow = mappingCalls.find(([sql, p]) => sql.includes("'ISO27001'") && p[0] === "fake.secure_logon");
    expect(isoRow[1]).toEqual(["fake.secure_logon", "A.9.4.2"]);

    const genericRows = mappingCalls.filter(([sql]) => sql.includes("VALUES ($1, $2, $3)"));
    const pairs = genericRows.map(([, p]) => `${p[1]}::${p[2]}`);
    expect(pairs).toContain("GDPR::Art. 32(1)(b)");
    expect(pairs).toContain("SOC2::CC6.1");
    expect(pairs).toContain("HIPAA::§164.312(d)");
    // every generic row is (test_key, framework, controlReference) and deduped
    expect(new Set(pairs).size).toBe(pairs.length);
    for (const [sql, p] of genericRows) {
      expect(sql).toContain("ON CONFLICT (test_key, framework, iso_reference) DO NOTHING");
      expect(p[0]).toBe("fake.secure_logon");
    }
  });

  test("applies an explicit frameworkRefs override on a check, merged with crosswalk output", async () => {
    listConnectorTestsMock.mockImplementation((integrationKey) =>
      integrationKey === "fake"
        ? [
            {
              key: "fake.ropa",
              title: "Records of processing",
              severityDefault: "medium",
              isoReferences: ["A.9.4.2"],
              frameworkRefs: { GDPR: ["Art. 30"], SOC2: ["CC3.2"] },
            },
          ]
        : []
    );

    await syncTestDefinitions();

    const genericRows = queryMock.mock.calls
      .filter(([sql]) => sql.includes("INSERT INTO test_control_mappings") && sql.includes("VALUES ($1, $2, $3)"))
      .map(([, p]) => `${p[1]}::${p[2]}`);

    expect(genericRows).toContain("GDPR::Art. 30"); // from the override
    expect(genericRows).toContain("SOC2::CC3.2"); // from the override
    expect(genericRows).toContain("GDPR::Art. 32(1)(b)"); // still from the crosswalk
  });

  test("does not throw when every query fails, matching scheduler.js's fail-soft convention", async () => {
    queryMock.mockImplementation(async () => {
      throw new Error("connection refused");
    });
    const consoleErrorSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    await expect(syncTestDefinitions()).resolves.toBeUndefined();

    // Per-test isolation means the failure is logged once per test key, not
    // once for the whole sync run.
    expect(consoleErrorSpy).toHaveBeenCalledWith(
      '[testDefinitionSync] failed to sync test "fake.check_one" for connector "fake":',
      "connection refused"
    );
    expect(consoleErrorSpy).toHaveBeenCalledWith(
      '[testDefinitionSync] failed to sync test "fake.check_two" for connector "fake":',
      "connection refused"
    );

    consoleErrorSpy.mockRestore();
  });

  test("one connector's failing test does not block other connectors from syncing (fault isolation)", async () => {
    const goodTest = {
      key: "other.check_one",
      title: "Other connector check",
      severityDefault: "low",
      isoReferences: ["A.9.9.9"],
    };
    const badTest = {
      key: "fake.check_one",
      title: "Fake check one",
      severityDefault: "high",
      isoReferences: ["A.1.1.1"],
    };

    listConnectorKeysMock.mockReturnValue(["fake", "other"]);
    listConnectorTestsMock.mockImplementation((integrationKey) => {
      if (integrationKey === "fake") return [badTest];
      if (integrationKey === "other") return [goodTest];
      return [];
    });

    // "fake"'s automated_tests upsert throws; "other"'s must still succeed.
    queryMock.mockImplementation(async (sql, params) => {
      if (sql.includes("INSERT INTO automated_tests") && params[0] === "fake") {
        throw new Error("severity_default check constraint violated");
      }
      return { rows: [], rowCount: 0 };
    });
    const consoleErrorSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    await expect(syncTestDefinitions()).resolves.toBeUndefined();

    const otherAutomatedTestsCalls = queryMock.mock.calls.filter(
      ([sql, params]) => sql.includes("INSERT INTO automated_tests") && params[0] === "other"
    );
    const otherMappingCalls = queryMock.mock.calls.filter(
      ([sql, params]) => sql.includes("INSERT INTO test_control_mappings") && params[0] === "other.check_one"
    );
    expect(otherAutomatedTestsCalls).toHaveLength(1);
    expect(otherMappingCalls).toHaveLength(1);

    expect(consoleErrorSpy).toHaveBeenCalledWith(
      '[testDefinitionSync] failed to sync test "fake.check_one" for connector "fake":',
      "severity_default check constraint violated"
    );

    consoleErrorSpy.mockRestore();
  });

  test("does not throw when listConnectorKeys itself throws (outer last-resort guard)", async () => {
    listConnectorKeysMock.mockImplementation(() => {
      throw new Error("registry blew up");
    });
    const consoleErrorSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    await expect(syncTestDefinitions()).resolves.toBeUndefined();
    expect(consoleErrorSpy).toHaveBeenCalledWith("[testDefinitionSync] syncTestDefinitions failed:", "registry blew up");

    consoleErrorSpy.mockRestore();
  });
});
