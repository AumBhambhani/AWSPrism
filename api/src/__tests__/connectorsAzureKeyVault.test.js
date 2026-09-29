import { describe, test, expect } from "vitest";
import { checkPurgeProtectionEnabled, checkRbacAuthorizationEnabled } from "../connectors/azure/tests/keyVault.js";

function asyncIterable(items) {
  return { [Symbol.asyncIterator]: async function* () { for (const item of items) yield item; } };
}

describe("checkPurgeProtectionEnabled", () => {
  test("passes a vault with purge protection enabled", async () => {
    const keyVault = {
      vaults: {
        list: () => asyncIterable([{ id: "/subscriptions/s/resourceGroups/rg/providers/Microsoft.KeyVault/vaults/kv1", name: "kv1" }]),
        get: async () => ({ properties: { enablePurgeProtection: true } }),
      },
    };
    const results = await checkPurgeProtectionEnabled(keyVault);
    expect(results).toEqual([{ resourceId: "/subscriptions/s/resourceGroups/rg/providers/Microsoft.KeyVault/vaults/kv1", status: "pass", message: "kv1 has purge protection enabled", evidencePayload: { vaultName: "kv1", enablePurgeProtection: true } }]);
  });

  test("fails a vault without purge protection", async () => {
    const keyVault = {
      vaults: {
        list: () => asyncIterable([{ id: "/subscriptions/s/resourceGroups/rg/vaults/kv1", name: "kv1" }]),
        get: async () => ({ properties: {} }),
      },
    };
    const results = await checkPurgeProtectionEnabled(keyVault);
    expect(results[0].status).toBe("fail");
  });

  test("returns not_applicable when there are no vaults", async () => {
    const keyVault = { vaults: { list: () => asyncIterable([]) } };
    const results = await checkPurgeProtectionEnabled(keyVault);
    expect(results).toEqual([{ resourceId: "subscription", status: "not_applicable", message: "No Key Vaults found", evidencePayload: {} }]);
  });
});

describe("checkRbacAuthorizationEnabled", () => {
  test("passes a vault using RBAC authorization", async () => {
    const keyVault = {
      vaults: {
        list: () => asyncIterable([{ id: "/subscriptions/s/resourceGroups/rg/vaults/kv1", name: "kv1" }]),
        get: async () => ({ properties: { enableRbacAuthorization: true } }),
      },
    };
    const results = await checkRbacAuthorizationEnabled(keyVault);
    expect(results[0].status).toBe("pass");
  });

  test("fails a vault using legacy access policies", async () => {
    const keyVault = {
      vaults: {
        list: () => asyncIterable([{ id: "/subscriptions/s/resourceGroups/rg/vaults/kv1", name: "kv1" }]),
        get: async () => ({ properties: { enableRbacAuthorization: false } }),
      },
    };
    const results = await checkRbacAuthorizationEnabled(keyVault);
    expect(results[0].status).toBe("fail");
  });

  test("returns not_applicable when there are no vaults", async () => {
    const keyVault = { vaults: { list: () => asyncIterable([]) } };
    const results = await checkRbacAuthorizationEnabled(keyVault);
    expect(results).toEqual([{ resourceId: "subscription", status: "not_applicable", message: "No Key Vaults found", evidencePayload: {} }]);
  });
});
