import { describe, test, expect, vi, beforeEach, afterEach } from "vitest";

const { resolveZohoCredentials } = await import("../connectors/zoho/credentials.js");

const VALID_CONFIG = { dataCenter: "com", orgId: "60012345" };
const VALID_SECRET = { clientId: "client-1", clientSecret: "shh", refreshToken: "rt-1" };

describe("resolveZohoCredentials — validation", () => {
  test("throws for an unsupported auth type", async () => {
    await expect(
      resolveZohoCredentials({ authType: "api_key", config: VALID_CONFIG, secret: VALID_SECRET })
    ).rejects.toThrow("Unsupported Zoho auth type: api_key");
  });

  test("throws when config.dataCenter is missing", async () => {
    await expect(
      resolveZohoCredentials({ authType: "oauth2", config: { orgId: "60012345" }, secret: VALID_SECRET })
    ).rejects.toThrow("Zoho connection is missing config.dataCenter");
  });

  test("throws when config.dataCenter is invalid", async () => {
    await expect(
      resolveZohoCredentials({
        authType: "oauth2",
        config: { dataCenter: "us", orgId: "60012345" },
        secret: VALID_SECRET,
      })
    ).rejects.toThrow('Zoho connection has an invalid config.dataCenter: "us"');
  });

  test("throws when config.orgId is missing", async () => {
    await expect(
      resolveZohoCredentials({ authType: "oauth2", config: { dataCenter: "com" }, secret: VALID_SECRET })
    ).rejects.toThrow("Zoho connection is missing config.orgId");
  });

  test("throws when secret.clientId is missing", async () => {
    await expect(
      resolveZohoCredentials({
        authType: "oauth2",
        config: VALID_CONFIG,
        secret: { clientSecret: "shh", refreshToken: "rt-1" },
      })
    ).rejects.toThrow("Zoho connection is missing secret.clientId");
  });

  test("throws when secret.clientSecret is missing", async () => {
    await expect(
      resolveZohoCredentials({
        authType: "oauth2",
        config: VALID_CONFIG,
        secret: { clientId: "client-1", refreshToken: "rt-1" },
      })
    ).rejects.toThrow("Zoho connection is missing secret.clientSecret");
  });

  test("throws when secret.refreshToken is missing", async () => {
    await expect(
      resolveZohoCredentials({
        authType: "oauth2",
        config: VALID_CONFIG,
        secret: { clientId: "client-1", clientSecret: "shh" },
      })
    ).rejects.toThrow("Zoho connection is missing secret.refreshToken");
  });
});

describe("resolveZohoCredentials — domain resolution", () => {
  beforeEach(() => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({
        ok: true,
        json: async () => ({ access_token: "tok", expires_in: 3600 }),
      }))
    );
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  test.each([
    ["com", "www.zohoapis.com"],
    ["eu", "www.zohoapis.eu"],
    ["in", "www.zohoapis.in"],
    ["com.au", "www.zohoapis.com.au"],
    ["com.cn", "www.zohoapis.com.cn"],
    ["jp", "www.zohoapis.jp"],
    ["cloud.ca", "www.zohoapis.ca"],
  ])("returns correct apiDomain for dataCenter %s", async (dataCenter, expectedApiDomain) => {
    const creds = await resolveZohoCredentials({
      authType: "oauth2",
      config: { dataCenter, orgId: "60012345" },
      secret: VALID_SECRET,
    });
    expect(creds.apiDomain).toBe(expectedApiDomain);
    expect(creds.orgId).toBe("60012345");
  });

  test("does not call fetch until getToken() is invoked", async () => {
    await resolveZohoCredentials({ authType: "oauth2", config: VALID_CONFIG, secret: VALID_SECRET });
    expect(fetch).not.toHaveBeenCalled();
  });

  test("getToken() POSTs to the correct accounts domain for com data center", async () => {
    const creds = await resolveZohoCredentials({ authType: "oauth2", config: VALID_CONFIG, secret: VALID_SECRET });
    const token = await creds.getToken();
    expect(token).toBe("tok");
    expect(fetch).toHaveBeenCalledTimes(1);
    const [url, opts] = fetch.mock.calls[0];
    expect(url).toBe("https://accounts.zoho.com/oauth/v2/token");
    expect(opts.method).toBe("POST");
    const body = new URLSearchParams(opts.body);
    expect(body.get("grant_type")).toBe("refresh_token");
    expect(body.get("client_id")).toBe("client-1");
    expect(body.get("client_secret")).toBe("shh");
    expect(body.get("refresh_token")).toBe("rt-1");
  });

  test("getToken() POSTs to accounts.zohocloud.ca for cloud.ca data center", async () => {
    const creds = await resolveZohoCredentials({
      authType: "oauth2",
      config: { dataCenter: "cloud.ca", orgId: "60012345" },
      secret: VALID_SECRET,
    });
    await creds.getToken();
    const [url] = fetch.mock.calls[0];
    expect(url).toBe("https://accounts.zohocloud.ca/oauth/v2/token");
  });

  test("getToken() is cached — two calls produce only one fetch", async () => {
    const creds = await resolveZohoCredentials({ authType: "oauth2", config: VALID_CONFIG, secret: VALID_SECRET });
    const t1 = await creds.getToken();
    const t2 = await creds.getToken();
    expect(t1).toBe("tok");
    expect(t2).toBe("tok");
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  test("throws a descriptive error when the token request fails", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({ ok: false, status: 401, text: async () => "invalid_client" }))
    );
    const creds = await resolveZohoCredentials({ authType: "oauth2", config: VALID_CONFIG, secret: VALID_SECRET });
    await expect(creds.getToken()).rejects.toThrow("Failed to acquire Zoho access token: 401 invalid_client");
  });

  test("throws when the token response is missing access_token", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({ ok: true, json: async () => ({ expires_in: 3600 }) }))
    );
    const creds = await resolveZohoCredentials({ authType: "oauth2", config: VALID_CONFIG, secret: VALID_SECRET });
    await expect(creds.getToken()).rejects.toThrow("Zoho token response is missing access_token");
  });
});
