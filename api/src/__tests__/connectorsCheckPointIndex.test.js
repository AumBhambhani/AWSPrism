import { afterEach, describe, expect, test, vi } from "vitest";
import { runTests, testConnection } from "../connectors/check_point/index.js";

afterEach(() => vi.restoreAllMocks());

// A permissive fetch stub: token exchange + any list call returns empty
// collections, so the events checks run to completion without a network call.
function stubFetch() {
  return vi.spyOn(globalThis, "fetch").mockResolvedValue({
    ok: true,
    status: 200,
    headers: { get: () => null },
    text: async () => JSON.stringify({ data: { token: "jwt" }, records: [], objects: [], incidents: [] }),
  });
}

describe("Check Point Infinity index", () => {
  test("testConnection succeeds once a token can be minted", async () => {
    stubFetch();
    await expect(
      testConnection({ authType: "api_key", config: { region: "eu" }, secret: { clientId: "c", accessKey: "k" } })
    ).resolves.toMatchObject({ ok: true });
  });

  test("runTests marks every check in a service with no API key as not_applicable", async () => {
    stubFetch();
    const rows = await runTests({
      authType: "api_key",
      config: { region: "eu" },
      secret: { events: { clientId: "c", accessKey: "k" } },
    });
    const xdr = rows.filter((r) => r.testKey.startsWith("check_point.xdr."));
    const endpoint = rows.filter((r) => r.testKey.startsWith("check_point.endpoint."));
    expect(xdr.length).toBe(3);
    expect(endpoint.length).toBe(4);
    expect([...xdr, ...endpoint].every((r) => r.status === "not_applicable")).toBe(true);
    // The events area (which does have a key) still produced rows.
    expect(rows.some((r) => r.testKey.startsWith("check_point.events.") && r.status !== "not_applicable")).toBe(true);
  });
});
