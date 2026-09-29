import { describe, test, expect, vi, beforeEach, afterEach } from "vitest";
import { generateKeyPairSync } from "crypto";
import jwt from "jsonwebtoken";

const {
  resolveSalesforceCredentials,
  normaliseLoginUrl,
  normalisePrivateKey,
  normaliseApiVersion,
  DEFAULT_API_VERSION,
} = await import("../connectors/salesforce/credentials.js");

const { privateKey, publicKey } = generateKeyPairSync("rsa", {
  modulusLength: 2048,
  privateKeyEncoding: { type: "pkcs8", format: "pem" },
  publicKeyEncoding: { type: "spki", format: "pem" },
});

const VALID_CONFIG = {
  loginUrl: "https://acme.my.salesforce.com",
  clientId: "3MVG9consumerkey",
  username: "integration@acme.com",
  apiVersion: "v61.0",
};
const VALID_SECRET = { privateKey };

describe("normaliseLoginUrl", () => {
  test.each([
    ["https://acme.my.salesforce.com", "https://acme.my.salesforce.com"],
    ["acme.my.salesforce.com/", "https://acme.my.salesforce.com"],
    ["HTTPS://ACME.MY.SALESFORCE.COM", "https://acme.my.salesforce.com"],
    ["https://login.salesforce.com", "https://login.salesforce.com"],
    ["test.salesforce.com", "https://test.salesforce.com"],
    ["https://acme--sandbox.sandbox.my.salesforce.com:443/foo", "https://acme--sandbox.sandbox.my.salesforce.com"],
  ])("normalises %s → %s", (input, expected) => {
    expect(normaliseLoginUrl(input)).toBe(expected);
  });

  test("rejects a non-Salesforce host", () => {
    expect(() => normaliseLoginUrl("https://evil.example.com")).toThrow(/invalid config\.loginUrl/);
  });

  test("rejects missing input", () => {
    expect(() => normaliseLoginUrl("")).toThrow(/missing config\.loginUrl/);
  });
});

describe("normalisePrivateKey", () => {
  test("passes a real PEM through untouched", () => {
    expect(normalisePrivateKey(privateKey)).toBe(privateKey);
  });

  test("restores escaped newlines", () => {
    const escaped = privateKey.replace(/\n/g, "\\n");
    expect(normalisePrivateKey(escaped)).toBe(privateKey);
  });

  test("rejects a non-PEM value", () => {
    expect(() => normalisePrivateKey("not-a-key")).toThrow(/not a PEM private key/);
  });

  test("rejects missing input", () => {
    expect(() => normalisePrivateKey("")).toThrow(/missing secret\.privateKey/);
  });
});

describe("normaliseApiVersion", () => {
  test.each([
    ["", DEFAULT_API_VERSION],
    [undefined, DEFAULT_API_VERSION],
    ["v61.0", "v61.0"],
    ["61", "v61.0"],
    ["59.0", "v59.0"],
  ])("normalises %s → %s", (input, expected) => {
    expect(normaliseApiVersion(input)).toBe(expected);
  });

  test("rejects garbage", () => {
    expect(() => normaliseApiVersion("latest")).toThrow(/invalid config\.apiVersion/);
  });
});

describe("resolveSalesforceCredentials — validation", () => {
  test("rejects an unsupported auth type", async () => {
    await expect(
      resolveSalesforceCredentials({ authType: "api_key", config: VALID_CONFIG, secret: VALID_SECRET })
    ).rejects.toThrow("Unsupported Salesforce auth type: api_key");
  });

  test("rejects a missing clientId", async () => {
    await expect(
      resolveSalesforceCredentials({ authType: "oauth2", config: { ...VALID_CONFIG, clientId: "" }, secret: VALID_SECRET })
    ).rejects.toThrow(/missing config\.clientId/);
  });

  test("rejects a missing username", async () => {
    await expect(
      resolveSalesforceCredentials({ authType: "oauth2", config: { ...VALID_CONFIG, username: "" }, secret: VALID_SECRET })
    ).rejects.toThrow(/missing config\.username/);
  });
});

describe("resolveSalesforceCredentials — JWT token exchange", () => {
  beforeEach(() => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({
        ok: true,
        status: 200,
        text: async () => JSON.stringify({ access_token: "tok", instance_url: "https://acme.my.salesforce.com/" }),
      }))
    );
  });
  afterEach(() => vi.unstubAllGlobals());

  test("does not call fetch until getAuth() is invoked", async () => {
    await resolveSalesforceCredentials({ authType: "oauth2", config: VALID_CONFIG, secret: VALID_SECRET });
    expect(fetch).not.toHaveBeenCalled();
  });

  test("getAuth() signs an RS256 JWT bearer assertion and returns token + instanceUrl", async () => {
    const creds = await resolveSalesforceCredentials({ authType: "oauth2", config: VALID_CONFIG, secret: VALID_SECRET });
    const auth = await creds.getAuth();
    expect(auth).toEqual({ accessToken: "tok", instanceUrl: "https://acme.my.salesforce.com" });

    const [url, opts] = fetch.mock.calls[0];
    expect(url).toBe("https://acme.my.salesforce.com/services/oauth2/token");
    const body = new URLSearchParams(opts.body);
    expect(body.get("grant_type")).toBe("urn:ietf:params:oauth:grant-type:jwt-bearer");

    const assertion = body.get("assertion");
    const decoded = jwt.verify(assertion, publicKey, { algorithms: ["RS256"] });
    expect(decoded.iss).toBe(VALID_CONFIG.clientId);
    expect(decoded.sub).toBe(VALID_CONFIG.username);
    expect(decoded.aud).toBe("https://acme.my.salesforce.com");
    expect(decoded.exp - Math.floor(Date.now() / 1000)).toBeLessThanOrEqual(300);
  });

  test("getAuth() caches — two calls, one token exchange", async () => {
    const creds = await resolveSalesforceCredentials({ authType: "oauth2", config: VALID_CONFIG, secret: VALID_SECRET });
    await creds.getAuth();
    await creds.getAuth();
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  test("surfaces error + error_description on a failed exchange", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({
        ok: false,
        status: 400,
        text: async () => JSON.stringify({ error: "invalid_grant", error_description: "user hasn't approved this consumer" }),
      }))
    );
    const creds = await resolveSalesforceCredentials({ authType: "oauth2", config: VALID_CONFIG, secret: VALID_SECRET });
    await expect(creds.getAuth()).rejects.toThrow(/invalid_grant.*approved this consumer/s);
  });

  test("throws when the token response has no instance_url", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({ ok: true, status: 200, text: async () => JSON.stringify({ access_token: "tok" }) }))
    );
    const creds = await resolveSalesforceCredentials({ authType: "oauth2", config: VALID_CONFIG, secret: VALID_SECRET });
    await expect(creds.getAuth()).rejects.toThrow(/missing instance_url/);
  });
});
