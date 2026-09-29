import { afterEach, describe, expect, test, vi } from "vitest";
import { sophosClient } from "../connectors/sophos/client.js";

afterEach(() => vi.restoreAllMocks());

describe("Sophos API client", () => {
  test("sets tenant headers and follows pageFromKey pagination", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch")
      .mockResolvedValueOnce({ ok: true, status: 200, json: async () => ({ items: [{ id: "a" }], pages: { nextKey: "next" } }) })
      .mockResolvedValueOnce({ ok: true, status: 200, json: async () => ({ items: [{ id: "b" }], pages: {} }) });
    const client = sophosClient({
      getToken: async () => "jwt",
      whoami: { tenantId: "tenant-1", dataRegionHost: "https://api-eu01.central.sophos.com" },
    });
    await expect(client.paginate("/endpoint/v1/endpoints")).resolves.toEqual([{ id: "a" }, { id: "b" }]);
    expect(fetchMock.mock.calls[0][1].headers["X-Tenant-ID"]).toBe("tenant-1");
    expect(fetchMock.mock.calls[1][0]).toContain("pageFromKey=next");
  });

  test("supports page-number pagination used by Firewall and DNS v2", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch")
      .mockResolvedValueOnce({ ok: true, status: 200, json: async () => ({ items: [{ id: "a" }], pages: { current: 1, total: 2 } }) })
      .mockResolvedValueOnce({ ok: true, status: 200, json: async () => ({ items: [{ id: "b" }], pages: { current: 2, total: 2 } }) });
    const client = sophosClient({ getToken: async () => "jwt", whoami: { tenantId: "t", dataRegionHost: "https://api-us01.central.sophos.com" } });
    await expect(client.paginate("/firewall/v1/firewalls")).resolves.toHaveLength(2);
    expect(fetchMock.mock.calls[1][0]).toContain("page=2");
  });

  test("retries a 429 and honours Retry-After", async () => {
    vi.useFakeTimers();
    const fetchMock = vi.spyOn(globalThis, "fetch")
      .mockResolvedValueOnce({ ok: false, status: 429, headers: { get: () => "1" } })
      .mockResolvedValueOnce({ ok: true, status: 200, json: async () => ({ items: [] }) });
    const client = sophosClient({ getToken: async () => "jwt", whoami: { tenantId: "t", dataRegionHost: "https://api-us01.central.sophos.com" } });
    const pending = client.request("GET", "/common/v1/alerts");
    await vi.runAllTimersAsync();
    await expect(pending).resolves.toEqual({ items: [] });
    expect(fetchMock).toHaveBeenCalledTimes(2);
    vi.useRealTimers();
  });
});
