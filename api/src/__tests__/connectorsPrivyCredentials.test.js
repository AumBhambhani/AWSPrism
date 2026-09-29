import { describe, test, expect } from "vitest";

const { resolvePrivyCredentials, normalisePrivyHost } = await import("../connectors/privy/credentials.js");

const VALID_CONFIG = { baseUrl: "acme.privybyidfy.com" };
const VALID_SECRET = { apiKey: "pk_live_abc123" };

describe("normalisePrivyHost", () => {
  test.each([
    ["acme.privybyidfy.com", "acme.privybyidfy.com"],
    ["https://acme.privybyidfy.com", "acme.privybyidfy.com"],
    ["https://acme.privybyidfy.com/", "acme.privybyidfy.com"],
    ["https://acme.privybyidfy.com/login?x=1", "acme.privybyidfy.com"],
    ["  APP.privybyidfy.com  ", "app.privybyidfy.com"],
    ["acme.privybyidfy.com:443", "acme.privybyidfy.com"],
  ])("normalises %s → %s", (input, expected) => {
    expect(normalisePrivyHost(input)).toBe(expected);
  });

  test("throws for an empty host", () => {
    expect(() => normalisePrivyHost("")).toThrow(/missing config\.baseUrl/);
  });

  test("throws for a non-hostname string", () => {
    expect(() => normalisePrivyHost("not a host")).toThrow(/invalid config\.baseUrl/);
  });
});

describe("resolvePrivyCredentials", () => {
  test("throws for an unsupported auth type", async () => {
    await expect(
      resolvePrivyCredentials({ authType: "oauth2", config: VALID_CONFIG, secret: VALID_SECRET })
    ).rejects.toThrow("Unsupported Privy auth type: oauth2");
  });

  test("throws when config.baseUrl is missing", async () => {
    await expect(
      resolvePrivyCredentials({ authType: "api_key", config: {}, secret: VALID_SECRET })
    ).rejects.toThrow(/config\.baseUrl/);
  });

  test("throws when secret.apiKey is missing or blank", async () => {
    await expect(
      resolvePrivyCredentials({ authType: "api_key", config: VALID_CONFIG, secret: {} })
    ).rejects.toThrow("Privy connection is missing secret.apiKey");
    await expect(
      resolvePrivyCredentials({ authType: "api_key", config: VALID_CONFIG, secret: { apiKey: "   " } })
    ).rejects.toThrow("Privy connection is missing secret.apiKey");
  });

  test("returns a trimmed apiKey and a normalised base URL", async () => {
    const creds = await resolvePrivyCredentials({
      authType: "api_key",
      config: { baseUrl: "https://acme.privybyidfy.com/app" },
      secret: { apiKey: "  pk_live_abc123  " },
    });
    expect(creds).toEqual({
      apiKey: "pk_live_abc123",
      host: "acme.privybyidfy.com",
      baseUrl: "https://acme.privybyidfy.com",
    });
  });
});
