import { describe, test, expect, vi, beforeEach, afterEach } from "vitest";

const { resolveOneTrustCredentials, normaliseHostname } = await import("../connectors/onetrust/credentials.js");

const VALID_CONFIG = { hostname: "acme.my.onetrust.com" };
const VALID_SECRET = { clientId: "client-1", clientSecret: "shh" };

describe("normaliseHostname", () => {
  test.each([
    ["acme.my.onetrust.com", "acme.my.onetrust.com"],
    ["https://acme.my.onetrust.com", "acme.my.onetrust.com"],
    ["https://acme.my.onetrust.com/", "acme.my.onetrust.com"],
    ["https://acme.my.onetrust.com/auth/login?x=1", "acme.my.onetrust.com"],
    ["  APP-EU.onetrust.com  ", "app-eu.onetrust.com"],
    ["trial.onetrust.com:443", "trial.onetrust.com"],
  ])("normalises %s → %s", (input, expected) => {
    expect(normaliseHostname(input)).toBe(expected);
  });

  test("throws for an empty hostname", () => {
    expect(() => normaliseHostname("")).toThrow(/missing config\.hostname/);
  });

  test("throws for a non-hostname string", () => {
    expect(() => normaliseHostname("not a host")).toThrow(/invalid config\.hostname/);
  });
});

describe("resolveOneTrustCredentials — validation", () => {
  test("throws for an unsupported auth type", async () => {
    await expect(
      resolveOneTrustCredentials({ authType: "api_key", config: VALID_CONFIG, secret: VALID_SECRET })
    ).rejects.toThrow("Unsupported OneTrust auth type: api_key");
  });

  test("throws when config.hostname is missing", async () => {
    await expect(
      resolveOneTrustCredentials({ authType: "oauth2", config: {}, secret: VALID_SECRET })
    ).rejects.toThrow(/config\.hostname/);
  });

  test("throws when secret.clientId is missing", async () => {
    await expect(
      resolveOneTrustCredentials({ authType: "oauth2", config: VALID_CONFIG, secret: { clientSecret: "shh" } })
    ).rejects.toThrow("OneTrust connection is missing secret.clientId");
  });

  test("throws when secret.clientSecret is missing", async () => {
    await expect(
      resolveOneTrustCredentials({ authType: "oauth2", config: VALID_CONFIG, secret: { clientId: "client-1" } })
    ).rejects.toThrow("OneTrust connection is missing secret.clientSecret");
  });
});

describe("resolveOneTrustCredentials — token exchange", () => {
  beforeEach(() => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({ ok: true, json: async () => ({ access_token: "tok", expires_in: 3600 }) }))
    );
  });
  afterEach(() => vi.unstubAllGlobals());

  test("does not call fetch until getToken() is invoked", async () => {
    await resolveOneTrustCredentials({ authType: "oauth2", config: VALID_CONFIG, secret: VALID_SECRET });
    expect(fetch).not.toHaveBeenCalled();
  });

  test("getToken() POSTs client_credentials to the tenant token endpoint", async () => {
    const creds = await resolveOneTrustCredentials({ authType: "oauth2", config: VALID_CONFIG, secret: VALID_SECRET });
    const token = await creds.getToken();
    expect(token).toBe("tok");
    const [url, opts] = fetch.mock.calls[0];
    expect(url).toBe("https://acme.my.onetrust.com/api/access/v1/oauth/token");
    expect(opts.method).toBe("POST");
    const body = new URLSearchParams(opts.body);
    expect(body.get("grant_type")).toBe("client_credentials");
    expect(body.get("client_id")).toBe("client-1");
    expect(body.get("client_secret")).toBe("shh");
  });

  test("getToken() caches — two calls, one fetch", async () => {
    const creds = await resolveOneTrustCredentials({ authType: "oauth2", config: VALID_CONFIG, secret: VALID_SECRET });
    await creds.getToken();
    await creds.getToken();
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  test("normalises the hostname before building the base URL", async () => {
    const creds = await resolveOneTrustCredentials({
      authType: "oauth2",
      config: { hostname: "https://acme.my.onetrust.com/login" },
      secret: VALID_SECRET,
    });
    expect(creds.hostname).toBe("acme.my.onetrust.com");
    expect(creds.baseUrl).toBe("https://acme.my.onetrust.com");
  });

  test("throws a descriptive error when the token request fails", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => ({ ok: false, status: 401, text: async () => "invalid_client" })));
    const creds = await resolveOneTrustCredentials({ authType: "oauth2", config: VALID_CONFIG, secret: VALID_SECRET });
    await expect(creds.getToken()).rejects.toThrow("Failed to acquire OneTrust access token: 401 invalid_client");
  });

  test("throws when the token response has no access_token", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => ({ ok: true, json: async () => ({ expires_in: 3600 }) })));
    const creds = await resolveOneTrustCredentials({ authType: "oauth2", config: VALID_CONFIG, secret: VALID_SECRET });
    await expect(creds.getToken()).rejects.toThrow("OneTrust token response is missing access_token");
  });
});
