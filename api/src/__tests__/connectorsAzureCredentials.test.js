import { describe, test, expect, vi } from "vitest";

vi.mock("@azure/identity", () => ({
  ClientSecretCredential: vi.fn(function (tenantId, clientId, clientSecret) {
    this.tenantId = tenantId;
    this.clientId = clientId;
    this.clientSecret = clientSecret;
  }),
}));

const { resolveAzureCredentials } = await import("../connectors/azure/credentials.js");
const { ClientSecretCredential } = await import("@azure/identity");

describe("resolveAzureCredentials", () => {
  test("constructs a ClientSecretCredential from tenantId/clientId/clientSecret for oauth2 auth", async () => {
    const credential = await resolveAzureCredentials({
      authType: "oauth2",
      config: { tenantId: "tenant-1", subscriptionId: "sub-1" },
      secret: { clientId: "client-1", clientSecret: "shh" },
    });

    expect(ClientSecretCredential).toHaveBeenCalledWith("tenant-1", "client-1", "shh");
    expect(credential).toBeInstanceOf(ClientSecretCredential);
  });

  test("throws for an unsupported auth type", async () => {
    await expect(
      resolveAzureCredentials({ authType: "access_key", config: {}, secret: {} })
    ).rejects.toThrow("Unsupported Azure auth type: access_key");
  });

  test("throws a clear error when config.tenantId is missing", async () => {
    await expect(
      resolveAzureCredentials({
        authType: "oauth2",
        config: { subscriptionId: "sub-1" },
        secret: { clientId: "client-1", clientSecret: "shh" },
      })
    ).rejects.toThrow("Azure connection is missing config.tenantId");
  });

  test("throws a clear error when config.subscriptionId is missing", async () => {
    await expect(
      resolveAzureCredentials({
        authType: "oauth2",
        config: { tenantId: "tenant-1" },
        secret: { clientId: "client-1", clientSecret: "shh" },
      })
    ).rejects.toThrow("Azure connection is missing config.subscriptionId");
  });
});
