import { describe, test, expect } from "vitest";
import { checkDiskEncryptionEnabled, checkNoPublicIpAssociation } from "../connectors/azure/tests/compute.js";

function asyncIterable(items) {
  return { [Symbol.asyncIterator]: async function* () { for (const item of items) yield item; } };
}

describe("checkDiskEncryptionEnabled", () => {
  test("passes a VM with encryption at host enabled", async () => {
    const compute = { virtualMachines: { listAll: () => asyncIterable([{ id: "/subscriptions/s/vms/a", name: "a", securityProfile: { encryptionAtHost: true } }]) } };
    const results = await checkDiskEncryptionEnabled(compute);
    expect(results).toEqual([{ resourceId: "/subscriptions/s/vms/a", status: "pass", message: "a has encryption at host enabled", evidencePayload: { vmName: "a", encryptionAtHost: true } }]);
  });

  test("fails a VM without encryption at host", async () => {
    const compute = { virtualMachines: { listAll: () => asyncIterable([{ id: "/subscriptions/s/vms/b", name: "b" }]) } };
    const results = await checkDiskEncryptionEnabled(compute);
    expect(results[0].status).toBe("fail");
  });

  test("returns not_applicable when there are no VMs", async () => {
    const compute = { virtualMachines: { listAll: () => asyncIterable([]) } };
    const results = await checkDiskEncryptionEnabled(compute);
    expect(results).toEqual([{ resourceId: "subscription", status: "not_applicable", message: "No virtual machines found", evidencePayload: {} }]);
  });
});

describe("checkNoPublicIpAssociation", () => {
  test("passes a VM whose NIC has no public IP", async () => {
    const compute = { virtualMachines: { listAll: () => asyncIterable([{ id: "/subscriptions/s/vms/a", name: "a", networkProfile: { networkInterfaces: [{ id: "/subscriptions/s/resourceGroups/rg/nics/nic1" }] } }]) } };
    const network = { networkInterfaces: { get: async () => ({ ipConfigurations: [{}] }) } };
    const results = await checkNoPublicIpAssociation(compute, network);
    expect(results[0].status).toBe("pass");
  });

  test("fails a VM whose NIC has a public IP attached", async () => {
    const compute = { virtualMachines: { listAll: () => asyncIterable([{ id: "/subscriptions/s/vms/a", name: "a", networkProfile: { networkInterfaces: [{ id: "/subscriptions/s/resourceGroups/rg/nics/nic1" }] } }]) } };
    const network = { networkInterfaces: { get: async () => ({ ipConfigurations: [{ publicIPAddress: { id: "/subscriptions/s/publicIPAddresses/pip1" } }] }) } };
    const results = await checkNoPublicIpAssociation(compute, network);
    expect(results[0].status).toBe("fail");
  });

  test("returns not_applicable when there are no VMs", async () => {
    const compute = { virtualMachines: { listAll: () => asyncIterable([]) } };
    const network = { networkInterfaces: { get: async () => ({}) } };
    const results = await checkNoPublicIpAssociation(compute, network);
    expect(results).toEqual([{ resourceId: "subscription", status: "not_applicable", message: "No virtual machines found", evidencePayload: {} }]);
  });
});
