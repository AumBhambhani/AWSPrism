import { describe, test, expect, vi } from "vitest";

const authorize = vi.fn(async () => {});
const getIamPolicy = vi.fn(async () => ({ data: { bindings: [], auditConfigs: [] } }));
let serviceAccountsListImpl = async () => ({ data: { accounts: [] } });
const bucketsList = vi.fn(async () => ({ data: { items: [] } }));
const instancesAggregatedList = vi.fn(async () => ({ data: { items: {} } }));
const sqlInstancesList = vi.fn(async () => ({ data: { items: [] } }));
const locationsList = vi.fn(async () => ({ data: { locations: [] } }));
const firewallsList = vi.fn(async () => ({ data: { items: [] } }));

vi.mock("googleapis", () => ({
  google: {
    auth: { JWT: vi.fn(function () { this.authorize = authorize; }) },
    compute: vi.fn(() => ({
      instances: { aggregatedList: instancesAggregatedList },
      firewalls: { list: firewallsList },
    })),
    sqladmin: vi.fn(() => ({ instances: { list: sqlInstancesList } })),
    storage: vi.fn(() => ({ buckets: { list: bucketsList } })),
    cloudkms: vi.fn(() => ({ projects: { locations: { list: locationsList, keyRings: { list: vi.fn(), cryptoKeys: { list: vi.fn() } } } } })),
    iam: vi.fn(() => ({
      projects: {
        serviceAccounts: {
          list: (...args) => serviceAccountsListImpl(...args),
          keys: { list: vi.fn(async () => ({ data: { keys: [] } })) },
        },
      },
    })),
    cloudresourcemanager: vi.fn(() => ({ projects: { getIamPolicy } })),
  },
}));

const { runTests, testConnection, tests } = await import("../connectors/gcp/index.js");

const CREDS = { authType: "oauth2", config: { projectId: "my-project" }, secret: { clientEmail: "svc@my-project.iam.gserviceaccount.com", privateKey: "key" } };

describe("runTests", () => {
  test("propagates each test's human-readable title alongside its key across an empty project", async () => {
    const results = await runTests(CREDS);

    expect(results.length).toBe(10);
    for (const result of results) {
      const definition = tests.find((t) => t.key === result.testKey);
      expect(result.title).toBe(definition.title);
      expect(result.failTitle).toBe(definition.failTitle);
      expect(result.title).not.toBe(result.testKey);
    }

    const bucketResult = results.find((r) => r.testKey === "gcp.storage.buckets_not_publicly_accessible");
    expect(bucketResult.status).toBe("not_applicable");
  });

  test("records a per-test error result without aborting the run when one check throws", async () => {
    serviceAccountsListImpl = async () => { throw new Error("permission denied"); };
    const results = await runTests(CREDS);
    const keyResult = results.find((r) => r.testKey === "gcp.iam.service_account_keys_rotated");
    expect(keyResult.status).toBe("error");
    expect(keyResult.message).toBe("permission denied");
    expect(results.find((r) => r.testKey === "gcp.storage.buckets_not_publicly_accessible").status).toBe("not_applicable");
    serviceAccountsListImpl = async () => ({ data: { accounts: [] } });
  });
});

describe("testConnection", () => {
  test("resolves the project id as externalAccountId", async () => {
    const result = await testConnection(CREDS);
    expect(result).toEqual({ ok: true, externalAccountId: "my-project" });
    expect(getIamPolicy).toHaveBeenCalledWith({ resource: "projects/my-project", requestBody: {} });
  });

  test("surfaces a structured Google API error message", async () => {
    getIamPolicy.mockRejectedValueOnce(Object.assign(new Error("generic"), { response: { data: { error: { message: "Permission 'resourcemanager.projects.getIamPolicy' denied" } } } }));
    await expect(testConnection(CREDS)).rejects.toThrow("Permission 'resourcemanager.projects.getIamPolicy' denied");
  });

  test("falls back to the raw error message for anything else", async () => {
    getIamPolicy.mockRejectedValueOnce(new Error("connect ETIMEDOUT"));
    await expect(testConnection(CREDS)).rejects.toThrow("connect ETIMEDOUT");
  });
});
