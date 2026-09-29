import { describe, test, expect, vi } from "vitest";

vi.mock("@azure/identity", () => ({
  ClientSecretCredential: vi.fn(function () {}),
}));
vi.mock("@azure/arm-storage", () => ({
  StorageManagementClient: vi.fn(() => ({
    storageAccounts: { list: () => ({ [Symbol.asyncIterator]: async function* () {} }) },
  })),
}));
vi.mock("@azure/arm-network", () => ({
  NetworkManagementClient: vi.fn(() => ({
    networkSecurityGroups: { listAll: () => ({ [Symbol.asyncIterator]: async function* () {} }) },
  })),
}));
vi.mock("@azure/arm-security", () => ({
  SecurityCenter: vi.fn(() => ({
    pricings: { list: async () => ({ value: [] }) },
  })),
}));
vi.mock("@azure/arm-monitor", () => ({
  MonitorClient: vi.fn(() => ({
    diagnosticSettings: { list: async () => ({ value: [] }) },
  })),
}));
vi.mock("@azure/arm-sql", () => ({
  SqlManagementClient: vi.fn(() => ({
    servers: { list: () => ({ [Symbol.asyncIterator]: async function* () {} }) },
  })),
}));
vi.mock("@azure/arm-keyvault", () => ({
  KeyVaultManagementClient: vi.fn(() => ({
    vaults: { list: () => ({ [Symbol.asyncIterator]: async function* () {} }) },
  })),
}));
vi.mock("@azure/arm-policyinsights", () => ({
  PolicyInsightsClient: vi.fn(() => ({
    policyStates: { summarizeForSubscription: async () => ({ value: [] }) },
  })),
}));
vi.mock("@azure/arm-compute", () => ({
  ComputeManagementClient: vi.fn(() => ({
    virtualMachines: { listAll: () => ({ [Symbol.asyncIterator]: async function* () {} }) },
  })),
}));
vi.mock("@azure/arm-authorization", () => ({
  AuthorizationManagementClient: vi.fn(() => ({
    classicAdministrators: { list: () => ({ [Symbol.asyncIterator]: async function* () {} }) },
    roleAssignments: { listForScope: () => ({ [Symbol.asyncIterator]: async function* () {} }) },
  })),
}));

let resourceGroupsListImpl = () => ({ next: async () => ({ done: true }) });
vi.mock("@azure/arm-resources", () => ({
  ResourceManagementClient: vi.fn(() => ({
    resourceGroups: { list: (...args) => resourceGroupsListImpl(...args) },
  })),
}));

const { runTests, testConnection, tests } = await import("../connectors/azure/index.js");

describe("runTests", () => {
  test("propagates each test's human-readable title alongside its key", async () => {
    const results = await runTests({
      authType: "oauth2",
      config: { tenantId: "tenant-1", subscriptionId: "sub-1" },
      secret: { clientId: "client-1", clientSecret: "shh" },
    });

    expect(results.length).toBe(15);
    for (const result of results) {
      const definition = tests.find((t) => t.key === result.testKey);
      expect(result.title).toBe(definition.title);
      expect(result.title).not.toBe(result.testKey);
    }

    const nsgResult = results.find((r) => r.testKey === "azure.network.nsg_no_open_ingress");
    expect(nsgResult.title).toBe("Network security groups do not expose management ports publicly");
    expect(nsgResult.status).toBe("not_applicable");
  });
});

describe("testConnection", () => {
  // @azure/arm-resources' generated pagingHelpers.js (checkPagingRequest) throws
  // a hardcoded "Pagination failed with unexpected statusCode N" RestError on any
  // unexpected status — ARM's detailed message is discarded for this call path;
  // only the short `error.code` (e.g. "AuthorizationFailed") survives via `.code`.
  // This is the shape testConnection actually receives in production.
  test("surfaces ARM's error code, not just the SDK's generic pagination wrapper message", async () => {
    resourceGroupsListImpl = () => ({
      next: async () => {
        const err = new Error("Pagination failed with unexpected statusCode 403");
        err.statusCode = 403;
        err.code = "AuthorizationFailed";
        throw err;
      },
    });

    await expect(
      testConnection({
        authType: "oauth2",
        config: { tenantId: "tenant-1", subscriptionId: "sub-1" },
        secret: { clientId: "client-1", clientSecret: "shh" },
      })
    ).rejects.toThrow(/AuthorizationFailed/);
  });

  // Forward-compatible fallback in case a future SDK version (or a different
  // call path) does preserve the full ARM error body on `.details`.
  test("prefers a fully detailed ARM error message when the SDK does provide one", async () => {
    resourceGroupsListImpl = () => ({
      next: async () => {
        const err = new Error("Pagination failed with unexpected statusCode 403");
        err.statusCode = 403;
        err.code = "AuthorizationFailed";
        err.details = {
          error: {
            code: "AuthorizationFailed",
            message: "The client 'abc' with object id 'xyz' does not have authorization to perform action 'Microsoft.Resources/subscriptions/resourceGroups/read' over scope '/subscriptions/sub-1' or the scope is invalid.",
          },
        };
        throw err;
      },
    });

    await expect(
      testConnection({
        authType: "oauth2",
        config: { tenantId: "tenant-1", subscriptionId: "sub-1" },
        secret: { clientId: "client-1", clientSecret: "shh" },
      })
    ).rejects.toThrow(/does not have authorization to perform action/);
  });

  test("falls back to the SDK's raw message when no error code or detailed body is present", async () => {
    resourceGroupsListImpl = () => ({
      next: async () => { throw new Error("connect ETIMEDOUT"); },
    });

    await expect(
      testConnection({
        authType: "oauth2",
        config: { tenantId: "tenant-1", subscriptionId: "sub-1" },
        secret: { clientId: "client-1", clientSecret: "shh" },
      })
    ).rejects.toThrow("connect ETIMEDOUT");
  });
});
