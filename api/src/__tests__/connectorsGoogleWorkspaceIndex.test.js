import { describe, test, expect, vi } from "vitest";

const authorize = vi.fn(async () => {});
const customersGet = vi.fn(async () => ({ data: { id: "C0test" } }));
let usersListImpl = async () => ({ data: { users: [] } });
const chromeosdevicesList = vi.fn(async () => ({ data: { chromeosdevices: [] } }));
const orgunitsGet = vi.fn(async () => ({ data: { orgUnitId: "id:root" } }));
const activitiesList = vi.fn(async () => ({ data: { items: [] } }));
const policiesList = vi.fn(async () => ({ data: { policies: [] } }));
const policiesResolve = vi.fn(async () => ({ data: { resolvedPolicies: [] } }));
const groupsList = vi.fn(async () => ({ data: { groups: [] } }));
const membersList = vi.fn(async () => ({ data: { members: [] } }));

vi.mock("googleapis", () => ({
  google: {
    auth: { JWT: vi.fn(function () { this.authorize = authorize; }) },
    admin: vi.fn((opts) =>
      opts.version === "directory_v1"
        ? {
            customers: { get: customersGet },
            users: { list: (...args) => usersListImpl(...args) },
            tokens: { list: vi.fn(async () => ({ data: { items: [] } })) },
            chromeosdevices: { list: chromeosdevicesList },
            orgunits: { get: orgunitsGet },
            groups: { list: groupsList },
            members: { list: membersList },
          }
        : { activities: { list: activitiesList } }
    ),
    chromepolicy: vi.fn(() => ({ customers: { policies: { resolve: policiesResolve } } })),
    cloudidentity: vi.fn(() => ({ policies: { list: policiesList } })),
  },
}));

const { runTests, testConnection, tests } = await import("../connectors/google_workspace/index.js");

const CREDS = { authType: "oauth2", config: { adminEmail: "admin@acme.com" }, secret: { clientEmail: "svc@acme.iam.gserviceaccount.com", privateKey: "key" } };

describe("runTests", () => {
  test("propagates each test's human-readable title alongside its key across an empty domain", async () => {
    const results = await runTests(CREDS);

    expect(results.length).toBe(12); // 10 checks; drive + audit each emit 2 result rows
    for (const result of results) {
      const definition = tests.find((t) => t.key === result.testKey);
      expect(result.title).toBe(definition.title);
      expect(result.failTitle).toBe(definition.failTitle);
      expect(result.title).not.toBe(result.testKey);
    }

    const twoSvResult = results.find((r) => r.testKey === "google_workspace.security.two_step_verification_enforced");
    expect(twoSvResult.status).toBe("not_applicable");
  });

  test("records a per-test error result without aborting the run when one check throws", async () => {
    usersListImpl = async () => { throw new Error("quota exceeded"); };
    const results = await runTests(CREDS);
    const twoSvResult = results.find((r) => r.testKey === "google_workspace.security.two_step_verification_enforced");
    expect(twoSvResult.status).toBe("error");
    expect(twoSvResult.message).toBe("quota exceeded");
    // Other checks (that don't depend on users.list) still ran.
    expect(results.find((r) => r.testKey === "google_workspace.devices.chrome_policy_compliant").status).toBe("not_applicable");
    usersListImpl = async () => ({ data: { users: [] } });
  });
});

describe("testConnection", () => {
  test("resolves the customer id as externalAccountId", async () => {
    const result = await testConnection(CREDS);
    expect(result).toEqual({ ok: true, externalAccountId: "C0test" });
  });

  test("surfaces a structured Google API error message", async () => {
    authorize.mockRejectedValueOnce(Object.assign(new Error("generic"), { response: { data: { error: { message: "Client is unauthorized to retrieve access tokens" } } } }));
    await expect(testConnection(CREDS)).rejects.toThrow("Client is unauthorized to retrieve access tokens");
  });

  test("falls back to the raw error message for anything else", async () => {
    authorize.mockRejectedValueOnce(new Error("connect ETIMEDOUT"));
    await expect(testConnection(CREDS)).rejects.toThrow("connect ETIMEDOUT");
  });
});
