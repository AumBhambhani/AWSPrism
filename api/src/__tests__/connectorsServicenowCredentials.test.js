import { describe, test, expect, vi, beforeEach, afterEach } from "vitest";

const { resolveServiceNowCredentials, normaliseInstanceUrl } = await import(
  "../connectors/servicenow/credentials.js"
);

const VALID_CONFIG = { instanceUrl: "acme.service-now.com" };
const VALID_SECRET = { clientId: "client-1", clientSecret: "shh" };

describe("normaliseInstanceUrl", () => {
  test.each([
    ["acme.service-now.com", "https://acme.service-now.com"],
    ["https://acme.service-now.com", "https://acme.service-now.com"],
    ["https://acme.service-now.com/", "https://acme.service-now.com"],
    ["https://acme.service-now.com/now/nav/ui?x=1", "https://acme.service-now.com"],
    ["  ACME.service-now.com  ", "https://acme.service-now.com"],
    ["acme.service-now.com:443", "https://acme.service-now.com"],
  ])("normalises %s → %s", (input, expected) => {
    expect(normaliseInstanceUrl(input)).toBe(expected);
  });

  test("throws for an empty instance URL", () => {
    expect(() => normaliseInstanceUrl("")).toThrow(/missing config\.instanceUrl/);
  });

  test("throws for a non-hostname string", () => {
    expect(() => normaliseInstanceUrl("not a host")).toThrow(/invalid config\.instanceUrl/);
  });
});

describe("resolveServiceNowCredentials — validation", () => {
  test("throws for an unsupported auth type", async () => {
    await expect(
      resolveServiceNowCredentials({ authType: "api_key", config: VALID_CONFIG, secret: VALID_SECRET })
    ).rejects.toThrow("Unsupported ServiceNow auth type: api_key");
  });

  test("throws when config.instanceUrl is missing", async () => {
    await expect(
      resolveServiceNowCredentials({ authType: "oauth2", config: {}, secret: VALID_SECRET })
    ).rejects.toThrow(/config\.instanceUrl/);
  });

  test("throws when secret.clientId is missing", async () => {
    await expect(
      resolveServiceNowCredentials({ authType: "oauth2", config: VALID_CONFIG, secret: { clientSecret: "shh" } })
    ).rejects.toThrow("ServiceNow connection is missing secret.clientId");
  });

  test("throws when secret.clientSecret is missing", async () => {
    await expect(
      resolveServiceNowCredentials({ authType: "oauth2", config: VALID_CONFIG, secret: { clientId: "client-1" } })
    ).rejects.toThrow("ServiceNow connection is missing secret.clientSecret");
  });
});

describe("resolveServiceNowCredentials — token exchange", () => {
  beforeEach(() => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({ ok: true, json: async () => ({ access_token: "tok", expires_in: 1800 }) }))
    );
  });
  afterEach(() => vi.unstubAllGlobals());

  test("does not call fetch until getToken() is invoked", async () => {
    await resolveServiceNowCredentials({ authType: "oauth2", config: VALID_CONFIG, secret: VALID_SECRET });
    expect(fetch).not.toHaveBeenCalled();
  });

  test("getToken() POSTs client_credentials to the instance oauth_token.do endpoint", async () => {
    const creds = await resolveServiceNowCredentials({ authType: "oauth2", config: VALID_CONFIG, secret: VALID_SECRET });
    const token = await creds.getToken();
    expect(token).toBe("tok");
    const [url, opts] = fetch.mock.calls[0];
    expect(url).toBe("https://acme.service-now.com/oauth_token.do");
    expect(opts.method).toBe("POST");
    const body = new URLSearchParams(opts.body);
    expect(body.get("grant_type")).toBe("client_credentials");
    expect(body.get("client_id")).toBe("client-1");
    expect(body.get("client_secret")).toBe("shh");
  });

  test("getToken() caches — two calls, one fetch", async () => {
    const creds = await resolveServiceNowCredentials({ authType: "oauth2", config: VALID_CONFIG, secret: VALID_SECRET });
    await creds.getToken();
    await creds.getToken();
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  test("normalises the instance URL before building the base URL", async () => {
    const creds = await resolveServiceNowCredentials({
      authType: "oauth2",
      config: { instanceUrl: "https://acme.service-now.com/login.do" },
      secret: VALID_SECRET,
    });
    expect(creds.baseUrl).toBe("https://acme.service-now.com");
    expect(creds.host).toBe("acme.service-now.com");
  });

  test("throws a descriptive error when the token request fails", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => ({ ok: false, status: 401, text: async () => "access_denied" })));
    const creds = await resolveServiceNowCredentials({ authType: "oauth2", config: VALID_CONFIG, secret: VALID_SECRET });
    await expect(creds.getToken()).rejects.toThrow("Failed to acquire ServiceNow access token: 401 access_denied");
  });

  test("throws when the token response has no access_token", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => ({ ok: true, json: async () => ({ expires_in: 1800 }) })));
    const creds = await resolveServiceNowCredentials({ authType: "oauth2", config: VALID_CONFIG, secret: VALID_SECRET });
    await expect(creds.getToken()).rejects.toThrow("ServiceNow token response is missing access_token");
  });
});
