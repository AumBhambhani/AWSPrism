import { describe, test, expect } from "vitest";

const { resolveCommvaultCredentials, resolveWebconsoleUrl } = await import(
  "../connectors/commvault/credentials.js"
);

const VALID_CONFIG = { webconsoleUrl: "https://commvault.example.com" };
const VALID_SECRET = { accessToken: "tok-abc123" };

describe("resolveWebconsoleUrl", () => {
  test.each([
    ["https://commvault.example.com", "https://commvault.example.com"],
    ["commvault.example.com", "https://commvault.example.com"],
    ["https://commvault.example.com/", "https://commvault.example.com"],
    ["https://commvault.example.com/commandcenter/#/login", "https://commvault.example.com"],
    ["  HTTPS://Commvault.Example.COM  ", "https://commvault.example.com"],
    ["commvault.example.com:443", "https://commvault.example.com"],
  ])("normalises %s → %s", (input, expected) => {
    expect(resolveWebconsoleUrl({ webconsoleUrl: input })).toBe(expected);
  });

  test("throws for an empty URL", () => {
    expect(() => resolveWebconsoleUrl({})).toThrow(/missing config\.webconsoleUrl/);
  });

  test("throws for a non-hostname string", () => {
    expect(() => resolveWebconsoleUrl({ webconsoleUrl: "not a host" })).toThrow(/invalid config\.webconsoleUrl/);
  });
});

describe("resolveCommvaultCredentials", () => {
  test("throws for an unsupported auth type", async () => {
    await expect(
      resolveCommvaultCredentials({ authType: "oauth2", config: VALID_CONFIG, secret: VALID_SECRET })
    ).rejects.toThrow("Unsupported Commvault auth type: oauth2");
  });

  test("throws when config.webconsoleUrl is missing", async () => {
    await expect(
      resolveCommvaultCredentials({ authType: "api_key", config: {}, secret: VALID_SECRET })
    ).rejects.toThrow(/config\.webconsoleUrl/);
  });

  test("throws when secret.accessToken is missing or blank", async () => {
    await expect(
      resolveCommvaultCredentials({ authType: "api_key", config: VALID_CONFIG, secret: {} })
    ).rejects.toThrow("Commvault connection is missing secret.accessToken");
    await expect(
      resolveCommvaultCredentials({ authType: "api_key", config: VALID_CONFIG, secret: { accessToken: "  " } })
    ).rejects.toThrow("Commvault connection is missing secret.accessToken");
  });

  test("resolves a trimmed token, the webconsole host, and the /webconsole/api root", async () => {
    const creds = await resolveCommvaultCredentials({
      authType: "api_key",
      config: { webconsoleUrl: "https://commvault.example.com/commandcenter" },
      secret: { accessToken: "  tok-abc123  " },
    });
    expect(creds).toEqual({
      accessToken: "tok-abc123",
      webconsoleUrl: "https://commvault.example.com",
      host: "commvault.example.com",
      apiRoot: "https://commvault.example.com/webconsole/api",
    });
  });
});
