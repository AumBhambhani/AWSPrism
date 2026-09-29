import { describe, test, expect } from "vitest";
import { resolveAkamaiCredentials, normaliseAkamaiHost } from "../connectors/akamai/credentials.js";

const GOOD_SECRET = {
  clientToken: "akab-client-token-xxxxxxxxxxxxxxxx",
  clientSecret: "SOFhBQ7l0m3example0secret0value0here0abcd=",
  accessToken: "akab-access-token-xxxxxxxxxxxxxxxxxxxxxxxx",
};

describe("normaliseAkamaiHost", () => {
  test("strips scheme, trailing slash and stray path", () => {
    expect(normaliseAkamaiHost("https://akab-abc.luna.akamaiapis.net/")).toBe("akab-abc.luna.akamaiapis.net");
    expect(normaliseAkamaiHost("akab-abc.luna.akamaiapis.net")).toBe("akab-abc.luna.akamaiapis.net");
    expect(normaliseAkamaiHost("  https://akab-abc.luna.akamaiapis.net/papi/v1  ")).toBe("akab-abc.luna.akamaiapis.net");
  });

  test("rejects a value that is not an akamaiapis.net host", () => {
    expect(() => normaliseAkamaiHost("example.com")).toThrow(/akamaiapis\.net/);
    expect(() => normaliseAkamaiHost("")).toThrow(/missing/i);
  });
});

describe("resolveAkamaiCredentials", () => {
  test("throws for an unsupported auth type", async () => {
    await expect(
      resolveAkamaiCredentials({ authType: "oauth2", config: {}, secret: {} })
    ).rejects.toThrow("Unsupported Akamai auth type: oauth2");
  });

  test("throws when config.host is missing", async () => {
    await expect(
      resolveAkamaiCredentials({ authType: "api_key", config: {}, secret: GOOD_SECRET })
    ).rejects.toThrow(/config\.host/);
  });

  test("throws when a secret field is missing", async () => {
    await expect(
      resolveAkamaiCredentials({
        authType: "api_key",
        config: { host: "akab-abc.luna.akamaiapis.net" },
        secret: { clientToken: "x", clientSecret: "y" },
      })
    ).rejects.toThrow(/secret\.accessToken/);
  });

  test("resolves a signer that produces an EG1-HMAC-SHA256 Authorization value", async () => {
    const creds = await resolveAkamaiCredentials({
      authType: "api_key",
      config: { host: "https://akab-abc.luna.akamaiapis.net/", accountSwitchKey: "1-ABC:1-DEF" },
      secret: GOOD_SECRET,
    });
    expect(creds.host).toBe("akab-abc.luna.akamaiapis.net");
    expect(creds.accountSwitchKey).toBe("1-ABC:1-DEF");

    const authValue = creds.sign({ method: "GET", path: "/papi/v1/contracts", headers: {}, body: "" });
    expect(authValue).toMatch(/^EG1-HMAC-SHA256 /);
    expect(authValue).toContain("client_token=akab-client-token-xxxxxxxxxxxxxxxx");
    expect(authValue).toContain("access_token=akab-access-token-xxxxxxxxxxxxxxxxxxxxxxxx");
    expect(authValue).toMatch(/signature=[^;]+$/);
  });

  test("two signatures for the same request differ (per-request nonce/timestamp)", async () => {
    const creds = await resolveAkamaiCredentials({
      authType: "api_key",
      config: { host: "akab-abc.luna.akamaiapis.net" },
      secret: GOOD_SECRET,
    });
    const a = creds.sign({ method: "GET", path: "/x", headers: {}, body: "" });
    const b = creds.sign({ method: "GET", path: "/x", headers: {}, body: "" });
    expect(a).not.toBe(b);
  });
});
