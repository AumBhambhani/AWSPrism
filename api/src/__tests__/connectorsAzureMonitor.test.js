import { describe, test, expect } from "vitest";
import { checkDiagnosticSettingsCoverKeyResources } from "../connectors/azure/tests/monitor.js";

function asyncIterable(items) {
  return { [Symbol.asyncIterator]: async function* () { for (const item of items) yield item; } };
}

describe("checkDiagnosticSettingsCoverKeyResources", () => {
  test("evaluates SQL servers, Key Vaults, and NSGs independently", async () => {
    const withSettings = async () => ({ value: [{ id: "diag-1", name: "diag-1" }] });
    const withoutSettings = async () => ({ value: [] });
    const clients = {
      sql: { servers: { list: () => asyncIterable([{ id: "srv-id", name: "srv" }]) } },
      keyVault: { vaults: { list: () => asyncIterable([{ id: "kv-id", name: "kv" }]) } },
      network: { networkSecurityGroups: { listAll: () => asyncIterable([{ id: "nsg-id", name: "nsg" }]) } },
      monitor: {
        diagnosticSettings: {
          list: async (resourceId) => (resourceId === "srv-id" ? withSettings() : withoutSettings()),
        },
      },
    };
    const results = await checkDiagnosticSettingsCoverKeyResources(clients);
    expect(results.length).toBe(3);
    expect(results.find((r) => r.evidencePayload.resourceType === "sqlServer").status).toBe("pass");
    expect(results.find((r) => r.evidencePayload.resourceType === "keyVault").status).toBe("fail");
    expect(results.find((r) => r.evidencePayload.resourceType === "nsg").status).toBe("fail");
  });

  test("returns not_applicable when no key resources exist", async () => {
    const clients = {
      sql: { servers: { list: () => asyncIterable([]) } },
      keyVault: { vaults: { list: () => asyncIterable([]) } },
      network: { networkSecurityGroups: { listAll: () => asyncIterable([]) } },
      monitor: { diagnosticSettings: { list: async () => ({ value: [] }) } },
    };
    const results = await checkDiagnosticSettingsCoverKeyResources(clients);
    expect(results).toEqual([{ resourceId: "subscription", status: "not_applicable", message: "No SQL servers, Key Vaults, or network security groups found", evidencePayload: {} }]);
  });
});
