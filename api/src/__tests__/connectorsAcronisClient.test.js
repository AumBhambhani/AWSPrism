import { describe, test, expect, vi, beforeEach, afterEach } from "vitest";

const { acronisClient } = await import("../connectors/acronis/client.js");

const DC = "https://us5-cloud.acronis.com";
const getToken = async () => "tok";

function ok(body, headers = {}) {
  return { ok: true, status: 200, json: async () => body, headers: { get: (k) => headers[k] ?? null } };
}
function fail(status, text, headers = {}) {
  return { ok: false, status, text: async () => text, headers: { get: (k) => headers[k] ?? null } };
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe("request", () => {
  test("injects the bearer token and parses JSON", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => ok({ hello: "world" })));
    const api = acronisClient(DC, getToken);
    expect(await api.request("GET", "/api/2/clients/x")).toEqual({ hello: "world" });
    const [url, opts] = fetch.mock.calls[0];
    expect(url).toBe("https://us5-cloud.acronis.com/api/2/clients/x");
    expect(opts.headers.Authorization).toBe("Bearer tok");
  });

  test("throws with status + body on a non-2xx", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => fail(403, "forbidden")));
    const api = acronisClient(DC, getToken);
    await expect(api.request("GET", "/api/alert_manager/v1/alerts")).rejects.toThrow(
      "Acronis request to GET /api/alert_manager/v1/alerts failed: 403 forbidden"
    );
  });

  test("retries once on 429 honouring Retry-After, then succeeds", async () => {
    vi.useFakeTimers();
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(fail(429, "slow down", { "Retry-After": "1" }))
      .mockResolvedValueOnce(ok({ ok: true }));
    vi.stubGlobal("fetch", fetchMock);

    const api = acronisClient(DC, getToken);
    const p = api.request("GET", "/x");
    await vi.advanceTimersByTimeAsync(1000);
    expect(await p).toEqual({ ok: true });
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  test("gives up after the 429 retry budget and throws", async () => {
    vi.useFakeTimers();
    const fetchMock = vi.fn(async () => fail(429, "slow down"));
    vi.stubGlobal("fetch", fetchMock);
    const api = acronisClient(DC, getToken);
    const p = api.request("GET", "/x").catch((e) => e);
    await vi.advanceTimersByTimeAsync(60000);
    expect((await p).message).toMatch(/failed: 429/);
    expect(fetchMock).toHaveBeenCalledTimes(4);
  });

  test("does not retry a 5xx", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => fail(500, "boom")));
    const api = acronisClient(DC, getToken);
    await expect(api.request("GET", "/x")).rejects.toThrow(/failed: 500 boom/);
  });
});

describe("fetchAll", () => {
  test("follows paging.cursors.next across pages and flattens items", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(ok({ items: [{ id: "a1" }, { id: "a2" }], paging: { cursors: { next: "CUR2" } } }))
      .mockResolvedValueOnce(ok({ items: [{ id: "a3" }], paging: { cursors: {} } }));
    vi.stubGlobal("fetch", fetchMock);

    const api = acronisClient(DC, getToken);
    const items = await api.fetchAll("/api/alert_manager/v1/alerts");
    expect(items.map((i) => i.id)).toEqual(["a1", "a2", "a3"]);
    expect(fetchMock.mock.calls[0][0]).toBe("https://us5-cloud.acronis.com/api/alert_manager/v1/alerts?limit=200");
    expect(fetchMock.mock.calls[1][0]).toContain("cursor=CUR2");
  });

  test("single-shot when there is no cursor", async () => {
    const fetchMock = vi.fn(async () => ok({ items: [{ resourceId: "m1" }] }));
    vi.stubGlobal("fetch", fetchMock);
    const api = acronisClient(DC, getToken);
    const items = await api.fetchAll("/api/resource_management/v4/resource_statuses?type=resource.machine");
    expect(items).toHaveLength(1);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock.mock.calls[0][0]).toContain("&limit=200");
  });

  test("tolerates a bare array response", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => ok([{ id: "x" }])));
    const api = acronisClient(DC, getToken);
    expect(await api.fetchAll("/x")).toEqual([{ id: "x" }]);
  });
});
