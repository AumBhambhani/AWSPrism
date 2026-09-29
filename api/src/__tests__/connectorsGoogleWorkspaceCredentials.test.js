import { describe, test, expect, vi } from "vitest";

const authorize = vi.fn(async () => {});
const customersGet = vi.fn(async () => ({ data: { id: "C0resolved" } }));

vi.mock("googleapis", () => ({
  google: {
    auth: {
      JWT: vi.fn(function (options) {
        this.options = options;
        this.authorize = authorize;
      }),
    },
    admin: vi.fn((opts) => (opts.version === "directory_v1" ? { customers: { get: customersGet } } : { version: opts.version })),
    chromepolicy: vi.fn((opts) => ({ version: opts.version })),
    cloudidentity: vi.fn((opts) => ({ version: opts.version })),
  },
}));

const { resolveGoogleWorkspaceCredentials } = await import("../connectors/google_workspace/credentials.js");
const { google } = await import("googleapis");

describe("resolveGoogleWorkspaceCredentials", () => {
  test("constructs a domain-wide-delegation JWT and resolves clients for oauth2 auth", async () => {
    const clients = await resolveGoogleWorkspaceCredentials({
      authType: "oauth2",
      config: { adminEmail: "admin@acme.com" },
      secret: { clientEmail: "svc@acme-project.iam.gserviceaccount.com", privateKey: "-----BEGIN PRIVATE KEY-----\nabc\n-----END PRIVATE KEY-----\n" },
    });

    expect(google.auth.JWT).toHaveBeenCalledWith(expect.objectContaining({
      email: "svc@acme-project.iam.gserviceaccount.com",
      key: "-----BEGIN PRIVATE KEY-----\nabc\n-----END PRIVATE KEY-----\n",
      subject: "admin@acme.com",
    }));
    expect(authorize).toHaveBeenCalled();
    expect(clients.directory).toBeDefined();
    expect(clients.reports).toBeDefined();
    expect(clients.chromepolicy).toBeDefined();
    expect(clients.cloudidentity).toBeDefined();
    expect(clients.customerId).toBe("C0resolved");
    expect(clients.adminEmail).toBe("admin@acme.com");
  });

  test("resolves customerId via customers.get using the 'my_customer' alias when config.customerId is absent", async () => {
    await resolveGoogleWorkspaceCredentials({
      authType: "oauth2",
      config: { adminEmail: "admin@acme.com" },
      secret: { clientEmail: "svc@acme-project.iam.gserviceaccount.com", privateKey: "key" },
    });
    expect(customersGet).toHaveBeenCalledWith({ customerKey: "my_customer" });
  });

  test("resolves customerId via customers.get using an explicit config.customerId", async () => {
    await resolveGoogleWorkspaceCredentials({
      authType: "oauth2",
      config: { adminEmail: "admin@acme.com", customerId: "C0explicit" },
      secret: { clientEmail: "svc@acme-project.iam.gserviceaccount.com", privateKey: "key" },
    });
    expect(customersGet).toHaveBeenCalledWith({ customerKey: "C0explicit" });
  });

  test("throws for an unsupported auth type", async () => {
    await expect(
      resolveGoogleWorkspaceCredentials({ authType: "access_key", config: {}, secret: {} })
    ).rejects.toThrow("Unsupported Google Workspace auth type: access_key");
  });

  test("throws a clear error when config.adminEmail is missing", async () => {
    await expect(
      resolveGoogleWorkspaceCredentials({ authType: "oauth2", config: {}, secret: { clientEmail: "a", privateKey: "b" } })
    ).rejects.toThrow("Google Workspace connection is missing config.adminEmail");
  });

  test("throws a clear error when secret.clientEmail is missing", async () => {
    await expect(
      resolveGoogleWorkspaceCredentials({ authType: "oauth2", config: { adminEmail: "admin@acme.com" }, secret: { privateKey: "b" } })
    ).rejects.toThrow("Google Workspace connection is missing secret.clientEmail");
  });

  test("throws a clear error when secret.privateKey is missing", async () => {
    await expect(
      resolveGoogleWorkspaceCredentials({ authType: "oauth2", config: { adminEmail: "admin@acme.com" }, secret: { clientEmail: "a" } })
    ).rejects.toThrow("Google Workspace connection is missing secret.privateKey");
  });
});
