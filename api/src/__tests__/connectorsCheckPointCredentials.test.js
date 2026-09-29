import { afterEach, describe, expect, test, vi } from "vitest";
import {
  createCachedTokenGetter,
  normaliseGatewayUrl,
  resolveCheckPointCredentials,
} from "../connectors/check_point/credentials.js";

afterEach(() => vi.restoreAllMocks());

describe("Check Point Infinity credentials", () => {
  test("resolves the regional gateway from a region or an explicit URL", () => {
    expect(normaliseGatewayUrl("", "us").gatewayUrl).toBe("https://cloudinfra-gw-us.portal.checkpoint.com");
    expect(normaliseGatewayUrl("cloudinfra-gw.portal.checkpoint.com").gatewayUrl).toBe("https://cloudinfra-gw.portal.checkpoint.com");
    expect(normaliseGatewayUrl("cloudinfra-gw.portal.checkpoint.com").region).toBe("eu");
    expect(() => normaliseGatewayUrl("", "")).toThrow(/gatewayUrl/);
    expect(() => normaliseGatewayUrl("http://cloudinfra-gw.portal.checkpoint.com")).toThrow(/https/i);
  });

  test("requires api_key auth and at least one key pair", async () => {
    await expect(resolveCheckPointCredentials({ authType: "oauth2", config: { region: "us" }, secret: {} })).rejects.toThrow(/auth type/i);
    await expect(resolveCheckPointCredentials({ authType: "api_key", config: { region: "us" }, secret: {} })).rejects.toThrow(/no API key/i);
  });

  test("a single key pair covers every service; a per-service block scopes to one", async () => {
    const single = await resolveCheckPointCredentials({ authType: "api_key", config: { region: "eu" }, secret: { clientId: "c", accessKey: "k" } });
    expect(typeof single.services.events).toBe("function");
    expect(typeof single.services.xdr).toBe("function");
    expect(typeof single.services.endpoint).toBe("function");

    const scoped = await resolveCheckPointCredentials({ authType: "api_key", config: { region: "eu" }, secret: { events: { clientId: "c", accessKey: "k" } } });
    expect(typeof scoped.services.events).toBe("function");
    expect(scoped.services.xdr).toBeNull();
    expect(scoped.services.endpoint).toBeNull();
  });

  test("mints and caches an Infinity Portal token", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue({
      ok: true,
      status: 200,
      text: async () => JSON.stringify({ success: true, data: { token: "jwt", expiresIn: 1800 } }),
    });
    const getToken = createCachedTokenGetter("https://cloudinfra-gw.portal.checkpoint.com", { clientId: "c", accessKey: "k" });
    await expect(getToken()).resolves.toBe("jwt");
    await expect(getToken()).resolves.toBe("jwt");
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock.mock.calls[0][0]).toBe("https://cloudinfra-gw.portal.checkpoint.com/auth/external");
    expect(JSON.parse(fetchMock.mock.calls[0][1].body)).toMatchObject({ clientId: "c", accessKey: "k" });
  });
});
