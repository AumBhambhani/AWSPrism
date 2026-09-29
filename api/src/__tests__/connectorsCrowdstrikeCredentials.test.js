import { describe, test, expect, vi, beforeEach, afterEach } from "vitest";

const { resolveCrowdstrikeCredentials, resolveBaseUrl, REGION_BASE_URLS } = await import(
  "../connectors/crowdstrike/credentials.js"
);

const VALID_SECRET = { clientId: "client-1", clientSecret: "shh" };

describe("resolveBaseUrl", () => {
  test.each([
    [{ cloudRegion: "us-1" }, "https://api.crowdstrike.com"],
    [{ cloudRegion: "us-2" }, "https://api.us-2.crowdstrike.com"],
    [{ cloudRegion: "eu-1" }, "https://api.eu-1.crowdstrike.com"],
    [{ cloudRegion: "US-GOV-1" }, "https://api.laggar.gcw.crowdstrike.com"],
    [{ baseUrl: "https://api.eu-1.crowdstrike.com/" }, "https://api.eu-1.crowdstrike.com"],
    [{ baseUrl: "api.us-2.crowdstrike.com", cloudRegion: "us-1" }, "https://api.us-2.crowdstrike.com"],
  ])("resolves %o → %s", (config, expected) => {
    expect(resolveBaseUrl(config)).toBe(expected);
  });

  test("every declared region has a base URL", () => {
    for (const region of Object.keys(REGION_BASE_URLS)) {
      expect(resolveBaseUrl({ cloudRegion: region })).toMatch(/^https:\/\//);
    }
  });

  test("throws for an unknown region", () => {
    expect(() => resolveBaseUrl({ cloudRegion: "mars-1" })).toThrow(/unknown config\.cloudRegion/);
  });

  test("throws for a base URL that is not a known CrowdStrike regional host", () => {
    expect(() => resolveBaseUrl({ baseUrl: "https://evil.example.com" })).toThrow(/unrecognised config\.baseUrl/);
  });

  test("throws when neither baseUrl nor cloudRegion is present", () => {
    expect(() => resolveBaseUrl({})).toThrow(/missing config\.baseUrl/);
  });
});

describe("resolveCrowdstrikeCredentials — validation", () => {
  test("throws for an unsupported auth type", async () => {
    await expect(
      resolveCrowdstrikeCredentials({ authType: "api_key", config: { cloudRegion: "us-1" }, secret: VALID_SECRET })
    ).rejects.toThrow("Unsupported CrowdStrike auth type: api_key");
  });

  test("throws when secret.clientId is missing", async () => {
    await expect(
      resolveCrowdstrikeCredentials({ authType: "oauth2", config: { cloudRegion: "us-1" }, secret: { clientSecret: "shh" } })
    ).rejects.toThrow("missing secret.clientId");
  });

  test("throws when secret.clientSecret is missing", async () => {
    await expect(
      resolveCrowdstrikeCredentials({ authType: "oauth2", config: { cloudRegion: "us-1" }, secret: { clientId: "c" } })
    ).rejects.toThrow("missing secret.clientSecret");
  });
});

describe("resolveCrowdstrikeCredentials — token exchange", () => {
  beforeEach(() => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({ ok: true, json: async () => ({ access_token: "tok", expires_in: 1800 }) }))
    );
  });
  afterEach(() => vi.unstubAllGlobals());

  test("does not call fetch until getToken() is invoked", async () => {
    await resolveCrowdstrikeCredentials({ authType: "oauth2", config: { cloudRegion: "eu-1" }, secret: VALID_SECRET });
    expect(fetch).not.toHaveBeenCalled();
  });

  test("getToken() POSTs client credentials to {baseUrl}/oauth2/token", async () => {
    const creds = await resolveCrowdstrikeCredentials({ authType: "oauth2", config: { cloudRegion: "eu-1" }, secret: VALID_SECRET });
    expect(creds.baseUrl).toBe("https://api.eu-1.crowdstrike.com");
    expect(creds.cloudRegion).toBe("eu-1");
    const token = await creds.getToken();
    expect(token).toBe("tok");
    const [url, opts] = fetch.mock.calls[0];
    expect(url).toBe("https://api.eu-1.crowdstrike.com/oauth2/token");
    expect(opts.method).toBe("POST");
    const body = new URLSearchParams(opts.body);
    expect(body.get("client_id")).toBe("client-1");
    expect(body.get("client_secret")).toBe("shh");
    expect(body.get("grant_type")).toBeNull();
  });

  test("getToken() caches — two calls, one fetch", async () => {
    const creds = await resolveCrowdstrikeCredentials({ authType: "oauth2", config: { cloudRegion: "us-1" }, secret: VALID_SECRET });
    await creds.getToken();
    await creds.getToken();
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  test("throws a descriptive error when the token request fails", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => ({ ok: false, status: 401, text: async () => "invalid_client" })));
    const creds = await resolveCrowdstrikeCredentials({ authType: "oauth2", config: { cloudRegion: "us-1" }, secret: VALID_SECRET });
    await expect(creds.getToken()).rejects.toThrow("Failed to acquire CrowdStrike access token: 401 invalid_client");
  });

  test("throws when the token response has no access_token", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => ({ ok: true, json: async () => ({ expires_in: 1800 }) })));
    const creds = await resolveCrowdstrikeCredentials({ authType: "oauth2", config: { cloudRegion: "us-1" }, secret: VALID_SECRET });
    await expect(creds.getToken()).rejects.toThrow("missing access_token");
  });
});
