import { describe, test, expect } from "vitest";
import { checkDefenderForCloudEnabled, checkActivityLogDiagnosticsEnabled } from "../connectors/azure/tests/logging.js";

describe("checkDefenderForCloudEnabled", () => {
  test("fails a resource type on the Free tier", async () => {
    const security = { pricings: { list: async () => ({ value: [{ id: "/subscriptions/s/pricings/VirtualMachines", name: "VirtualMachines", pricingTier: "Free" }] }) } };
    const results = await checkDefenderForCloudEnabled(security);
    expect(results).toEqual([{ resourceId: "/subscriptions/s/pricings/VirtualMachines", status: "fail", message: "Defender for Cloud is not enabled for VirtualMachines (tier: Free)", evidencePayload: { resourceType: "VirtualMachines", pricingTier: "Free" } }]);
  });

  test("passes a resource type on the Standard tier", async () => {
    const security = { pricings: { list: async () => ({ value: [{ id: "/subscriptions/s/pricings/StorageAccounts", name: "StorageAccounts", pricingTier: "Standard" }] }) } };
    const results = await checkDefenderForCloudEnabled(security);
    expect(results[0].status).toBe("pass");
  });

  test("evaluates every returned resource type independently", async () => {
    const security = {
      pricings: {
        list: async () => ({
          value: [
            { id: "/subscriptions/s/pricings/VirtualMachines", name: "VirtualMachines", pricingTier: "Standard" },
            { id: "/subscriptions/s/pricings/SqlServers", name: "SqlServers", pricingTier: "Free" },
          ],
        }),
      },
    };
    const results = await checkDefenderForCloudEnabled(security);
    expect(results.length).toBe(2);
    expect(results.find((r) => r.evidencePayload.resourceType === "VirtualMachines").status).toBe("pass");
    expect(results.find((r) => r.evidencePayload.resourceType === "SqlServers").status).toBe("fail");
  });

  test("returns not_applicable when no pricing configurations are returned", async () => {
    const security = { pricings: { list: async () => ({ value: [] }) } };
    const results = await checkDefenderForCloudEnabled(security);
    expect(results).toEqual([{ resourceId: "subscription", status: "not_applicable", message: "No Defender for Cloud pricing configurations found", evidencePayload: {} }]);
  });
});

describe("checkActivityLogDiagnosticsEnabled", () => {
  test("fails when no diagnostic settings exist for the subscription", async () => {
    const monitor = { diagnosticSettings: { list: async () => ({ value: [] }) } };
    const results = await checkActivityLogDiagnosticsEnabled(monitor, "sub-1");
    expect(results).toEqual([{ resourceId: "subscription", status: "fail", message: "No diagnostic settings are configured for the subscription Activity Log", evidencePayload: {} }]);
  });

  test("passes and requests the subscription-scoped resource URI when at least one diagnostic setting exists", async () => {
    let requestedUri = null;
    const monitor = {
      diagnosticSettings: {
        list: async (resourceUri) => {
          requestedUri = resourceUri;
          return { value: [{ id: "/subscriptions/sub-1/providers/microsoft.insights/diagnosticSettings/to-log-analytics", name: "to-log-analytics" }] };
        },
      },
    };
    const results = await checkActivityLogDiagnosticsEnabled(monitor, "sub-1");
    expect(requestedUri).toBe("/subscriptions/sub-1");
    expect(results[0].status).toBe("pass");
  });
});
