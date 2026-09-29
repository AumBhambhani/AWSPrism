import { describe, test, expect } from "vitest";
import { checkInstancesNoPublicIp, checkShieldedVmEnabled } from "../connectors/gcp/tests/compute.js";

function computeWith(itemsByZone) {
  return { instances: { aggregatedList: async () => ({ data: { items: itemsByZone } }) } };
}

describe("checkInstancesNoPublicIp", () => {
  test("passes an instance with no access configs", async () => {
    const compute = computeWith({ "zones/us-east1-b": { instances: [{ id: "1", name: "vm1", zone: "zones/us-east1-b", networkInterfaces: [{ accessConfigs: [] }] }] } });
    const results = await checkInstancesNoPublicIp(compute, "p");
    expect(results[0].status).toBe("pass");
  });

  test("fails an instance with an external IP access config", async () => {
    const compute = computeWith({ "zones/us-east1-b": { instances: [{ id: "1", name: "vm1", zone: "zones/us-east1-b", networkInterfaces: [{ accessConfigs: [{ natIP: "1.2.3.4" }] }] }] } });
    const results = await checkInstancesNoPublicIp(compute, "p");
    expect(results[0].status).toBe("fail");
  });

  test("returns not_applicable when there are no instances (only zone warnings)", async () => {
    const compute = computeWith({ "zones/us-east1-b": { warning: { code: "NO_RESULTS_ON_PAGE" } } });
    const results = await checkInstancesNoPublicIp(compute, "p");
    expect(results[0].status).toBe("not_applicable");
  });
});

describe("checkShieldedVmEnabled", () => {
  test("passes an instance with vTPM and integrity monitoring enabled", async () => {
    const compute = computeWith({ "zones/us-east1-b": { instances: [{ id: "1", name: "vm1", zone: "zones/us-east1-b", shieldedInstanceConfig: { enableVtpm: true, enableIntegrityMonitoring: true } }] } });
    const results = await checkShieldedVmEnabled(compute, "p");
    expect(results[0].status).toBe("pass");
  });

  test("fails an instance missing integrity monitoring", async () => {
    const compute = computeWith({ "zones/us-east1-b": { instances: [{ id: "1", name: "vm1", zone: "zones/us-east1-b", shieldedInstanceConfig: { enableVtpm: true, enableIntegrityMonitoring: false } }] } });
    const results = await checkShieldedVmEnabled(compute, "p");
    expect(results[0].status).toBe("fail");
  });
});
