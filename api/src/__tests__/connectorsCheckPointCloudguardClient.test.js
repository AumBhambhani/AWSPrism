import { afterEach, describe, expect, test, vi } from "vitest";
import { checkPointCloudguardClient } from "../connectors/check_point_cloudguard/client.js";

afterEach(() => vi.restoreAllMocks());

describe("Check Point CloudGuard client", () => {
  test("sends HTTP Basic auth and returns the parsed body", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue({
      ok: true,
      status: 200,
      headers: { get: () => null },
      text: async () => JSON.stringify([{ id: "a1" }]),
    });
    const api = checkPointCloudguardClient({ baseUrl: "https://api.dome9.com/v2", authHeader: "Basic xyz" });
    await expect(api.request("GET", "/CloudAccounts")).resolves.toEqual([{ id: "a1" }]);
    expect(fetchMock.mock.calls[0][0]).toBe("https://api.dome9.com/v2/CloudAccounts");
    expect(fetchMock.mock.calls[0][1].headers.Authorization).toBe("Basic xyz");
  });

  test("search pages through findings until totalFindings is reached", async () => {
    vi.spyOn(globalThis, "fetch")
      .mockResolvedValueOnce({ ok: true, status: 200, headers: { get: () => null }, text: async () => JSON.stringify({ findings: [{ id: "f1" }], totalFindings: 2 }) })
      .mockResolvedValueOnce({ ok: true, status: 200, headers: { get: () => null }, text: async () => JSON.stringify({ findings: [{ id: "f2" }], totalFindings: 2 }) });
    const api = checkPointCloudguardClient({ baseUrl: "https://api.dome9.com/v2", authHeader: "Basic xyz" });
    await expect(api.search("/Compliance/Finding/search", {})).resolves.toEqual([{ id: "f1" }, { id: "f2" }]);
  });

  test("a non-2xx response throws with method and path", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue({ ok: false, status: 401, headers: { get: () => null }, text: async () => "bad key" });
    const api = checkPointCloudguardClient({ baseUrl: "https://api.dome9.com/v2", authHeader: "Basic xyz" });
    await expect(api.request("GET", "/CloudAccounts")).rejects.toThrow(/GET \/CloudAccounts failed: HTTP 401/);
  });
});
