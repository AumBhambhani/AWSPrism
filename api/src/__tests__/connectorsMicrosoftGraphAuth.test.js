import { describe, test, expect, vi, beforeEach, afterEach } from "vitest";
import { resolveMicrosoftGraphCredentials } from "../connectors/shared/microsoftGraphAuth.js";

const VALID_CONFIG = { tenantId: "11111111-2222-3333-4444-555555555555" };
const VALID_SECRET = { clientId: "client-id-1", clientSecret: "client-secret-1" };

describe("resolveMicrosoftGraphCredentials — validation", () => {
  test("throws when config.tenantId is missing", () => {
    expect(() => resolveMicrosoftGraphCredentials({ config: {}, secret: VALID_SECRET }))
      .toThrow("Microsoft connector is missing config.tenantId");
  });

  test("throws when config.tenantId is invalid (contains slash)", () => {
    expect(() =>
      resolveMicrosoftGraphCredentials({ config: { tenantId: "foo/bar" }, secret: VALID_SECRET })
    ).toThrow("Microsoft connector has an invalid config.tenantId");
  });

  test("accepts a GUID tenantId", () => {
    expect(() =>
      resolveMicrosoftGraphCredentials({ config: VALID_CONFIG, secret: VALID_SECRET })
    ).not.toThrow();
  });

  test("accepts a domain-form tenantId", () => {
    expect(() =>
      resolveMicrosoftGraphCredentials({ config: { tenantId: "contoso.onmicrosoft.com" }, secret: VALID_SECRET })
    ).not.toThrow();
  });

  test("throws when secret.clientId is missing", () => {
    expect(() =>
      resolveMicrosoftGraphCredentials({ config: VALID_CONFIG, secret: { clientSecret: "s" } })
    ).toThrow("Microsoft connector is missing secret.clientId");
  });

  test("throws when secret.clientSecret is missing", () => {
    expect(() =>
      resolveMicrosoftGraphCredentials({ config: VALID_CONFIG, secret: { clientId: "c" } })
    ).toThrow("Microsoft connector is missing secret.clientSecret");
  });
});

describe("resolveMicrosoftGraphCredentials — return shape", () => {
  test("returns getToken function and tenantId", () => {
    const result = resolveMicrosoftGraphCredentials({ config: VALID_CONFIG, secret: VALID_SECRET });
    expect(typeof result.getToken).toBe("function");
    expect(result.tenantId).toBe(VALID_CONFIG.tenantId);
  });

  test("uses default resource https://graph.microsoft.com when not specified", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => ({
      ok: true,
      json: async () => ({ access_token: "tok", expires_in: 3600 }),
    })));

    const { getToken } = resolveMicrosoftGraphCredentials({ config: VALID_CONFIG, secret: VALID_SECRET });
    await getToken();
    const [url, opts] = fetch.mock.calls[0];
    expect(url).toContain("login.microsoftonline.com");
    expect(url).toContain(VALID_CONFIG.tenantId);
    const body = new URLSearchParams(opts.body);
    expect(body.get("resource")).toBe("https://graph.microsoft.com");
    vi.unstubAllGlobals();
  });

  test("uses the supplied resource audience, not the default", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => ({
      ok: true,
      json: async () => ({ access_token: "tok2", expires_in: 3600 }),
    })));

    const { getToken } = resolveMicrosoftGraphCredentials({
      config: VALID_CONFIG,
      secret: VALID_SECRET,
      resource: "https://api.securitycenter.microsoft.com",
    });
    await getToken();
    const [, opts] = fetch.mock.calls[0];
    const body = new URLSearchParams(opts.body);
    expect(body.get("resource")).toBe("https://api.securitycenter.microsoft.com");
    vi.unstubAllGlobals();
  });

  test("getToken() is cached — two calls produce only one fetch", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => ({
      ok: true,
      json: async () => ({ access_token: "cached-tok", expires_in: 3600 }),
    })));

    const { getToken } = resolveMicrosoftGraphCredentials({ config: VALID_CONFIG, secret: VALID_SECRET });
    const t1 = await getToken();
    const t2 = await getToken();
    expect(t1).toBe("cached-tok");
    expect(t2).toBe("cached-tok");
    expect(fetch).toHaveBeenCalledTimes(1);
    vi.unstubAllGlobals();
  });

  test("throws when the token request fails", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => ({ ok: false, status: 401, text: async () => "AADSTS7000215" })));
    const { getToken } = resolveMicrosoftGraphCredentials({ config: VALID_CONFIG, secret: VALID_SECRET });
    await expect(getToken()).rejects.toThrow(/Failed to acquire Microsoft token/);
    await expect(getToken()).rejects.toThrow(/401/);
    vi.unstubAllGlobals();
  });

  test("throws when the token response is missing access_token", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => ({ ok: true, json: async () => ({ expires_in: 3600 }) })));
    const { getToken } = resolveMicrosoftGraphCredentials({ config: VALID_CONFIG, secret: VALID_SECRET });
    await expect(getToken()).rejects.toThrow("Microsoft token response is missing access_token");
    vi.unstubAllGlobals();
  });
});
