import { afterEach, describe, expect, test, vi } from "vitest";
import {
  createCachedTokenGetter,
  fetchWhoami,
  normaliseRegion,
  resolveSophosCredentials,
} from "../connectors/sophos/credentials.js";

afterEach(() => vi.restoreAllMocks());

describe("Sophos credentials", () => {
  test("normalises a region hint without trusting it as an API host", () => {
    expect(normaliseRegion(" EU01 ")).toBe("eu01");
    expect(normaliseRegion()).toBeNull();
    expect(() => normaliseRegion("eu01/path")).toThrow(/region/i);
  });

  test("requires OAuth2 client credentials", async () => {
    await expect(resolveSophosCredentials({ authType: "api_key", secret: {} })).rejects.toThrow(/auth type/i);
    await expect(resolveSophosCredentials({ authType: "oauth2", secret: {} })).rejects.toThrow(/clientId/i);
    await expect(resolveSophosCredentials({ authType: "oauth2", secret: { clientId: "id" } })).rejects.toThrow(/clientSecret/i);
  });

  test("mints and caches one client-credentials token", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue({
      ok: true,
      json: async () => ({ access_token: "jwt", expires_in: 3600 }),
    });
    const getToken = createCachedTokenGetter({ clientId: "client", clientSecret: "secret" });
    await expect(getToken()).resolves.toBe("jwt");
    await expect(getToken()).resolves.toBe("jwt");
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [, options] = fetchMock.mock.calls[0];
    expect(String(options.body)).toContain("grant_type=client_credentials");
    expect(String(options.body)).toContain("scope=token");
  });

  test("whoami accepts tenant credentials and rejects partner credentials", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce({
      ok: true,
      json: async () => ({ id: "tenant-1", idType: "tenant", apiHosts: { dataRegion: "https://api-eu01.central.sophos.com/" } }),
    });
    await expect(fetchWhoami(async () => "jwt")).resolves.toEqual({
      tenantId: "tenant-1",
      dataRegionHost: "https://api-eu01.central.sophos.com",
      globalHost: null,
    });

    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce({
      ok: true,
      json: async () => ({ id: "partner-1", idType: "partner", apiHosts: { dataRegion: "https://api-eu01.central.sophos.com" } }),
    });
    await expect(fetchWhoami(async () => "jwt")).rejects.toThrow(/tenant-level API credential/i);
  });
});
