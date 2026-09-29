import { describe, test, expect, vi, beforeEach, afterEach } from "vitest";

const { resolvePurviewCredentials } = await import("../connectors/purview/credentials.js");

describe("resolvePurviewCredentials", () => {
  beforeEach(() => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({
        ok: true,
        json: async () => ({ token_type: "Bearer", expires_in: 3600, access_token: "fake-token" }),
      }))
    );
  });

  test("throws for an unsupported auth type", async () => {
    await expect(
      resolvePurviewCredentials({ authType: "access_key", config: {}, secret: {} })
    ).rejects.toThrow("Unsupported Purview auth type: access_key");
  });

  test("throws a clear error when config.tenantId is missing", async () => {
    await expect(
      resolvePurviewCredentials({
        authType: "oauth2",
        config: { purviewAccountName: "acct-1" },
        secret: { clientId: "client-1", clientSecret: "shh" },
      })
    ).rejects.toThrow("Purview connection is missing config.tenantId");
  });

  test("throws a clear error when config.purviewAccountName is missing", async () => {
    await expect(
      resolvePurviewCredentials({
        authType: "oauth2",
        config: { tenantId: "tenant-1" },
        secret: { clientId: "client-1", clientSecret: "shh" },
      })
    ).rejects.toThrow("Purview connection is missing config.purviewAccountName");
  });

  test("throws a clear error when secret.clientId is missing", async () => {
    await expect(
      resolvePurviewCredentials({
        authType: "oauth2",
        config: { tenantId: "tenant-1", purviewAccountName: "acct-1" },
        secret: { clientSecret: "shh" },
      })
    ).rejects.toThrow("Purview connection is missing secret.clientId");
  });

  test("throws a clear error when secret.clientSecret is missing", async () => {
    await expect(
      resolvePurviewCredentials({
        authType: "oauth2",
        config: { tenantId: "tenant-1", purviewAccountName: "acct-1" },
        secret: { clientId: "client-1" },
      })
    ).rejects.toThrow("Purview connection is missing secret.clientSecret");
  });

  test("derives dataMapBaseUrl and auditBaseUrl from config", async () => {
    const credentials = await resolvePurviewCredentials({
      authType: "oauth2",
      config: { tenantId: "tenant-1", purviewAccountName: "acct-1" },
      secret: { clientId: "client-1", clientSecret: "shh" },
    });

    expect(credentials.dataMapBaseUrl).toBe("https://acct-1.purview.azure.com");
    expect(credentials.auditBaseUrl).toBe(
      "https://manage.office.com/api/v1.0/tenant-1/activity/feed"
    );
  });

  test("does not fetch a token until a getter is invoked", async () => {
    await resolvePurviewCredentials({
      authType: "oauth2",
      config: { tenantId: "tenant-1", purviewAccountName: "acct-1" },
      secret: { clientId: "client-1", clientSecret: "shh" },
    });

    expect(fetch).not.toHaveBeenCalled();
  });

  test("getDataMapToken() requests the purview.azure.net resource and returns the access token", async () => {
    const credentials = await resolvePurviewCredentials({
      authType: "oauth2",
      config: { tenantId: "tenant-1", purviewAccountName: "acct-1" },
      secret: { clientId: "client-1", clientSecret: "shh" },
    });

    const token = await credentials.getDataMapToken();

    expect(token).toBe("fake-token");
    expect(fetch).toHaveBeenCalledTimes(1);
    const [url, options] = fetch.mock.calls[0];
    expect(url).toBe("https://login.microsoftonline.com/tenant-1/oauth2/token");
    expect(options.method).toBe("POST");
    expect(options.headers["Content-Type"]).toBe("application/x-www-form-urlencoded");
    const body = new URLSearchParams(options.body);
    expect(body.get("grant_type")).toBe("client_credentials");
    expect(body.get("client_id")).toBe("client-1");
    expect(body.get("client_secret")).toBe("shh");
    expect(body.get("resource")).toBe("https://purview.azure.net");
  });

  test("getAuditToken() requests the manage.office.com resource and returns the access token", async () => {
    const credentials = await resolvePurviewCredentials({
      authType: "oauth2",
      config: { tenantId: "tenant-1", purviewAccountName: "acct-1" },
      secret: { clientId: "client-1", clientSecret: "shh" },
    });

    const token = await credentials.getAuditToken();

    expect(token).toBe("fake-token");
    expect(fetch).toHaveBeenCalledTimes(1);
    const [url, options] = fetch.mock.calls[0];
    expect(url).toBe("https://login.microsoftonline.com/tenant-1/oauth2/token");
    const body = new URLSearchParams(options.body);
    expect(body.get("resource")).toBe("https://manage.office.com");
  });

  test("throws a descriptive error when the token request fails", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({
        ok: false,
        status: 401,
        text: async () => "AADSTS7000215: Invalid client secret provided.",
      }))
    );

    const credentials = await resolvePurviewCredentials({
      authType: "oauth2",
      config: { tenantId: "tenant-1", purviewAccountName: "acct-1" },
      secret: { clientId: "client-1", clientSecret: "shh" },
    });

    await expect(credentials.getDataMapToken()).rejects.toThrow(
      "Failed to acquire Purview token: 401 AADSTS7000215: Invalid client secret provided."
    );
  });

  test("throws a descriptive error when the token response is missing access_token", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({
        ok: true,
        json: async () => ({ token_type: "Bearer", expires_in: 3600 }),
      }))
    );

    const credentials = await resolvePurviewCredentials({
      authType: "oauth2",
      config: { tenantId: "tenant-1", purviewAccountName: "acct-1" },
      secret: { clientId: "client-1", clientSecret: "shh" },
    });

    await expect(credentials.getDataMapToken()).rejects.toThrow(
      "Purview token response is missing access_token"
    );
  });

  describe("config validation (SSRF hardening)", () => {
    test.each([
      ["internal-host.corp/", "contains a slash"],
      ["acct.internal-host.corp", "contains a dot"],
      ["acct name", "contains a space"],
      ["acct@host", "contains an at-sign"],
      ["-leadinghyphen", "leading hyphen"],
      ["trailinghyphen-", "trailing hyphen"],
      ["ab", "too short"],
    ])("rejects a purviewAccountName that %s (%s)", async (purviewAccountName) => {
      await expect(
        resolvePurviewCredentials({
          authType: "oauth2",
          config: { tenantId: "tenant-1", purviewAccountName },
          secret: { clientId: "client-1", clientSecret: "shh" },
        })
      ).rejects.toThrow("Purview connection has an invalid config.purviewAccountName");
    });

    test.each([
      ["acct-1", "alphanumeric plus hyphen"],
      ["my-purview-account", "multi-hyphen"],
      ["a1b2c3", "alphanumeric only"],
    ])("accepts a valid purviewAccountName: %s (%s)", async (purviewAccountName) => {
      const credentials = await resolvePurviewCredentials({
        authType: "oauth2",
        config: { tenantId: "tenant-1", purviewAccountName },
        secret: { clientId: "client-1", clientSecret: "shh" },
      });
      expect(credentials.dataMapBaseUrl).toBe(`https://${purviewAccountName}.purview.azure.com`);
    });

    test.each([
      ["tenant/../evil", "contains a slash"],
      ["tenant id", "contains a space"],
      ["tenant#fragment", "contains a hash"],
    ])("rejects a tenantId that %s (%s)", async (tenantId) => {
      await expect(
        resolvePurviewCredentials({
          authType: "oauth2",
          config: { tenantId, purviewAccountName: "acct-1" },
          secret: { clientId: "client-1", clientSecret: "shh" },
        })
      ).rejects.toThrow("Purview connection has an invalid config.tenantId");
    });

    test("accepts a GUID-shaped tenantId", async () => {
      const tenantId = "72f988bf-86f1-41af-91ab-2d7cd011db47";
      const credentials = await resolvePurviewCredentials({
        authType: "oauth2",
        config: { tenantId, purviewAccountName: "acct-1" },
        secret: { clientId: "client-1", clientSecret: "shh" },
      });
      expect(credentials.auditBaseUrl).toBe(`https://manage.office.com/api/v1.0/${tenantId}/activity/feed`);
    });

    test("accepts a verified-domain-shaped tenantId (e.g. contoso.onmicrosoft.com)", async () => {
      const tenantId = "contoso.onmicrosoft.com";
      const credentials = await resolvePurviewCredentials({
        authType: "oauth2",
        config: { tenantId, purviewAccountName: "acct-1" },
        secret: { clientId: "client-1", clientSecret: "shh" },
      });
      expect(credentials.auditBaseUrl).toBe(`https://manage.office.com/api/v1.0/${tenantId}/activity/feed`);
    });
  });

  describe("token caching", () => {
    afterEach(() => {
      vi.useRealTimers();
    });

    test("getDataMapToken() called twice in a row only calls fetch once", async () => {
      const credentials = await resolvePurviewCredentials({
        authType: "oauth2",
        config: { tenantId: "tenant-1", purviewAccountName: "acct-1" },
        secret: { clientId: "client-1", clientSecret: "shh" },
      });

      const first = await credentials.getDataMapToken();
      const second = await credentials.getDataMapToken();

      expect(first).toBe("fake-token");
      expect(second).toBe("fake-token");
      expect(fetch).toHaveBeenCalledTimes(1);
    });

    test("getDataMapToken() and getAuditToken() are cached independently (two resources -> two fetches)", async () => {
      const credentials = await resolvePurviewCredentials({
        authType: "oauth2",
        config: { tenantId: "tenant-1", purviewAccountName: "acct-1" },
        secret: { clientId: "client-1", clientSecret: "shh" },
      });

      await credentials.getDataMapToken();
      await credentials.getDataMapToken();
      await credentials.getAuditToken();
      await credentials.getAuditToken();

      expect(fetch).toHaveBeenCalledTimes(2);
    });

    test("refetches once the cached token has expired", async () => {
      vi.useFakeTimers();
      const credentials = await resolvePurviewCredentials({
        authType: "oauth2",
        config: { tenantId: "tenant-1", purviewAccountName: "acct-1" },
        secret: { clientId: "client-1", clientSecret: "shh" },
      });

      await credentials.getDataMapToken();
      expect(fetch).toHaveBeenCalledTimes(1);

      // expires_in is 3600s; advance well past that (plus the 60s skew).
      vi.advanceTimersByTime(3601 * 1000);

      await credentials.getDataMapToken();
      expect(fetch).toHaveBeenCalledTimes(2);
    });
  });
});
