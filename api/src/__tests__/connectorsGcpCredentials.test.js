import { describe, test, expect, vi } from "vitest";

const authorize = vi.fn(async () => {});

vi.mock("googleapis", () => ({
  google: {
    auth: { JWT: vi.fn(function (options) { this.options = options; this.authorize = authorize; }) },
    compute: vi.fn((opts) => ({ version: opts.version, api: "compute" })),
    sqladmin: vi.fn((opts) => ({ version: opts.version, api: "sqladmin" })),
    storage: vi.fn((opts) => ({ version: opts.version, api: "storage" })),
    cloudkms: vi.fn((opts) => ({ version: opts.version, api: "cloudkms" })),
    iam: vi.fn((opts) => ({ version: opts.version, api: "iam" })),
    cloudresourcemanager: vi.fn((opts) => ({ version: opts.version, api: "cloudresourcemanager" })),
  },
}));

const { resolveGcpCredentials } = await import("../connectors/gcp/credentials.js");
const { google } = await import("googleapis");

describe("resolveGcpCredentials", () => {
  test("constructs a plain (non-impersonating) service account JWT and resolves all clients", async () => {
    const clients = await resolveGcpCredentials({
      authType: "oauth2",
      config: { projectId: "my-project" },
      secret: { clientEmail: "svc@my-project.iam.gserviceaccount.com", privateKey: "-----BEGIN PRIVATE KEY-----\nabc\n-----END PRIVATE KEY-----\n" },
    });

    expect(google.auth.JWT).toHaveBeenCalledWith(expect.objectContaining({
      email: "svc@my-project.iam.gserviceaccount.com",
      key: "-----BEGIN PRIVATE KEY-----\nabc\n-----END PRIVATE KEY-----\n",
      scopes: ["https://www.googleapis.com/auth/cloud-platform.read-only"],
    }));
    expect(google.auth.JWT).not.toHaveBeenCalledWith(expect.objectContaining({ subject: expect.anything() }));
    expect(authorize).toHaveBeenCalled();
    expect(clients.compute).toBeDefined();
    expect(clients.sqladmin).toBeDefined();
    expect(clients.storage).toBeDefined();
    expect(clients.cloudkms).toBeDefined();
    expect(clients.iam).toBeDefined();
    expect(clients.cloudresourcemanager).toBeDefined();
    expect(clients.projectId).toBe("my-project");
  });

  test("throws for an unsupported auth type", async () => {
    await expect(
      resolveGcpCredentials({ authType: "access_key", config: {}, secret: {} })
    ).rejects.toThrow("Unsupported GCP auth type: access_key");
  });

  test("throws a clear error when config.projectId is missing", async () => {
    await expect(
      resolveGcpCredentials({ authType: "oauth2", config: {}, secret: { clientEmail: "a", privateKey: "b" } })
    ).rejects.toThrow("GCP connection is missing config.projectId");
  });

  test("throws a clear error when secret.clientEmail is missing", async () => {
    await expect(
      resolveGcpCredentials({ authType: "oauth2", config: { projectId: "p" }, secret: { privateKey: "b" } })
    ).rejects.toThrow("GCP connection is missing secret.clientEmail");
  });

  test("throws a clear error when secret.privateKey is missing", async () => {
    await expect(
      resolveGcpCredentials({ authType: "oauth2", config: { projectId: "p" }, secret: { clientEmail: "a" } })
    ).rejects.toThrow("GCP connection is missing secret.privateKey");
  });
});
