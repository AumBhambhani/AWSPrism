import { describe, test, expect, vi, beforeEach, afterEach } from "vitest";

const { resolveAcronisCredentials, resolveDatacenterUrl } = await import(
  "../connectors/acronis/credentials.js"
);

const VALID_SECRET = { clientId: "client-1", clientSecret: "shh" };
const DC = { datacenterUrl: "https://us5-cloud.acronis.com" };

describe("resolveDatacenterUrl", () => {
  test.each([
    [{ datacenterUrl: "https://us5-cloud.acronis.com" }, "https://us5-cloud.acronis.com"],
    [{ datacenterUrl: "https://eu2-cloud.acronis.com/" }, "https://eu2-cloud.acronis.com"],
    [{ datacenterUrl: "us5-cloud.acronis.com" }, "https://us5-cloud.acronis.com"],
    [{ datacenterUrl: "  https://US5-Cloud.Acronis.com/bc/page  " }, "https://us5-cloud.acronis.com"],
    [{ datacenterUrl: "https://us5-cloud.acronis.com:443" }, "https://us5-cloud.acronis.com"],
  ])("resolves %o → %s", (config, expected) => {
    expect(resolveDatacenterUrl(config)).toBe(expected);
  });

  test("throws when datacenterUrl is missing", () => {
    expect(() => resolveDatacenterUrl({})).toThrow(/missing config\.datacenterUrl/);
  });

  test.each([
    ["https://evil.example.com"],
    ["https://acronis.com.evil.net"],
    ["https://console.acronis.io"],
    ["not a url"],
  ])("rejects a non-acronis.com host: %s", (datacenterUrl) => {
    expect(() => resolveDatacenterUrl({ datacenterUrl })).toThrow(/unrecognised config\.datacenterUrl/);
  });
});

describe("resolveAcronisCredentials — validation", () => {
  test("throws for an unsupported auth type", async () => {
    await expect(
      resolveAcronisCredentials({ authType: "api_key", config: DC, secret: VALID_SECRET })
    ).rejects.toThrow("Unsupported Acronis auth type: api_key");
  });

  test("throws when secret.clientId is missing", async () => {
    await expect(
      resolveAcronisCredentials({ authType: "oauth2", config: DC, secret: { clientSecret: "shh" } })
    ).rejects.toThrow("missing secret.clientId");
  });

  test("throws when secret.clientSecret is missing", async () => {
    await expect(
      resolveAcronisCredentials({ authType: "oauth2", config: DC, secret: { clientId: "c" } })
    ).rejects.toThrow("missing secret.clientSecret");
  });
});

describe("resolveAcronisCredentials — token exchange", () => {
  beforeEach(() => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({
        ok: true,
        json: async () => ({ access_token: "tok", token_type: "bearer", expires_on: Date.now() / 1000 + 7200 }),
      }))
    );
  });
  afterEach(() => vi.unstubAllGlobals());

  test("does not call fetch until getToken() is invoked", async () => {
    await resolveAcronisCredentials({ authType: "oauth2", config: DC, secret: VALID_SECRET });
    expect(fetch).not.toHaveBeenCalled();
  });

  test("getToken() POSTs Basic-auth client credentials to {datacenterUrl}/api/2/idp/token", async () => {
    const creds = await resolveAcronisCredentials({ authType: "oauth2", config: DC, secret: VALID_SECRET });
    expect(creds.datacenterUrl).toBe("https://us5-cloud.acronis.com");
    expect(creds.tenantHost).toBe("us5-cloud.acronis.com");
    const token = await creds.getToken();
    expect(token).toBe("tok");
    const [url, opts] = fetch.mock.calls[0];
    expect(url).toBe("https://us5-cloud.acronis.com/api/2/idp/token");
    expect(opts.method).toBe("POST");
    expect(opts.headers.Authorization).toBe(`Basic ${Buffer.from("client-1:shh").toString("base64")}`);
    expect(new URLSearchParams(opts.body).get("grant_type")).toBe("client_credentials");
  });

  test("getToken() caches — two calls, one fetch", async () => {
    const creds = await resolveAcronisCredentials({ authType: "oauth2", config: DC, secret: VALID_SECRET });
    await creds.getToken();
    await creds.getToken();
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  test("accepts a relative expires_in when expires_on is absent", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => ({ ok: true, json: async () => ({ access_token: "t2", expires_in: 3600 }) })));
    const creds = await resolveAcronisCredentials({ authType: "oauth2", config: DC, secret: VALID_SECRET });
    expect(await creds.getToken()).toBe("t2");
  });

  test("throws a descriptive error when the token request fails", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => ({ ok: false, status: 401, text: async () => "invalid_client" })));
    const creds = await resolveAcronisCredentials({ authType: "oauth2", config: DC, secret: VALID_SECRET });
    await expect(creds.getToken()).rejects.toThrow("Failed to acquire Acronis access token: 401 invalid_client");
  });

  test("throws when the token response has no access_token", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => ({ ok: true, json: async () => ({ expires_on: 123 }) })));
    const creds = await resolveAcronisCredentials({ authType: "oauth2", config: DC, secret: VALID_SECRET });
    await expect(creds.getToken()).rejects.toThrow("missing access_token");
  });
});
