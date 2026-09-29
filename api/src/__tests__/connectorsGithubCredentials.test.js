import { describe, test, expect, vi } from "vitest";

vi.mock("@octokit/rest", () => ({
  Octokit: vi.fn(function (options) {
    this.options = options;
  }),
}));
vi.mock("@octokit/auth-app", () => ({
  createAppAuth: vi.fn((auth) => auth),
}));

const { resolveGithubCredentials } = await import("../connectors/github/credentials.js");
const { Octokit } = await import("@octokit/rest");
const { createAppAuth } = await import("@octokit/auth-app");

describe("resolveGithubCredentials", () => {
  test("constructs an Octokit instance using the App auth strategy for oauth2 auth", async () => {
    const octokit = await resolveGithubCredentials({
      authType: "oauth2",
      config: { installationId: 42, org: "acme" },
      secret: { appId: "123", privateKey: "-----BEGIN RSA PRIVATE KEY-----\nfake\n-----END RSA PRIVATE KEY-----" },
    });

    expect(Octokit).toHaveBeenCalledWith({
      authStrategy: createAppAuth,
      auth: { appId: "123", privateKey: "-----BEGIN RSA PRIVATE KEY-----\nfake\n-----END RSA PRIVATE KEY-----", installationId: 42 },
    });
    expect(octokit).toBeInstanceOf(Octokit);
  });

  test("throws when config.installationId is missing", async () => {
    await expect(
      resolveGithubCredentials({ authType: "oauth2", config: {}, secret: { appId: "123", privateKey: "pem" } })
    ).rejects.toThrow("GitHub connection is missing config.installationId");
  });

  test("throws when secret.appId is missing", async () => {
    await expect(
      resolveGithubCredentials({ authType: "oauth2", config: { installationId: 42 }, secret: { privateKey: "pem" } })
    ).rejects.toThrow("GitHub connection is missing secret.appId");
  });

  test("throws when secret.privateKey is missing", async () => {
    await expect(
      resolveGithubCredentials({ authType: "oauth2", config: { installationId: 42 }, secret: { appId: "123" } })
    ).rejects.toThrow("GitHub connection is missing secret.privateKey");
  });

  test("throws for an unsupported auth type", async () => {
    await expect(
      resolveGithubCredentials({ authType: "api_key", config: {}, secret: {} })
    ).rejects.toThrow("Unsupported GitHub auth type: api_key");
  });
});
