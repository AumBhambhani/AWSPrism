import { describe, test, expect } from "vitest";
import { checkStoragePublicAccessBlocked, checkNsgNoOpenIngress } from "../connectors/azure/tests/network.js";

function asyncIterable(items) {
  return { [Symbol.asyncIterator]: async function* () { for (const item of items) yield item; } };
}

describe("checkStoragePublicAccessBlocked", () => {
  test("passes an account with public blob access explicitly disabled", async () => {
    const storage = { storageAccounts: { list: () => asyncIterable([{ id: "/subscriptions/s/storageAccounts/a", name: "a", allowBlobPublicAccess: false }]) } };
    const results = await checkStoragePublicAccessBlocked(storage);
    expect(results).toEqual([{ resourceId: "/subscriptions/s/storageAccounts/a", status: "pass", message: "a blocks public blob access", evidencePayload: { accountName: "a", allowBlobPublicAccess: false } }]);
  });

  test("passes an account where the field is unset (Azure's documented default is false)", async () => {
    const storage = { storageAccounts: { list: () => asyncIterable([{ id: "/subscriptions/s/storageAccounts/b", name: "b" }]) } };
    const results = await checkStoragePublicAccessBlocked(storage);
    expect(results[0].status).toBe("pass");
  });

  test("fails an account with public blob access enabled", async () => {
    const storage = { storageAccounts: { list: () => asyncIterable([{ id: "/subscriptions/s/storageAccounts/c", name: "c", allowBlobPublicAccess: true }]) } };
    const results = await checkStoragePublicAccessBlocked(storage);
    expect(results[0].status).toBe("fail");
  });

  test("returns not_applicable when there are no storage accounts", async () => {
    const storage = { storageAccounts: { list: () => asyncIterable([]) } };
    const results = await checkStoragePublicAccessBlocked(storage);
    expect(results).toEqual([{ resourceId: "subscription", status: "not_applicable", message: "No storage accounts found", evidencePayload: {} }]);
  });
});

describe("checkNsgNoOpenIngress", () => {
  test("passes an NSG with no security rules", async () => {
    const network = { networkSecurityGroups: { listAll: () => asyncIterable([{ id: "/subscriptions/s/nsg/x", name: "x", securityRules: [] }]) } };
    const results = await checkNsgNoOpenIngress(network);
    expect(results[0].status).toBe("pass");
  });

  test("fails an NSG allowing inbound port 22 from *", async () => {
    const network = {
      networkSecurityGroups: {
        listAll: () => asyncIterable([{
          id: "/subscriptions/s/nsg/y", name: "y",
          securityRules: [{ name: "allow-ssh", direction: "Inbound", access: "Allow", sourceAddressPrefix: "*", destinationPortRange: "22" }],
        }]),
      },
    };
    const results = await checkNsgNoOpenIngress(network);
    expect(results[0].status).toBe("fail");
  });

  test("fails an NSG allowing inbound port 3389 from Internet via a port range", async () => {
    const network = {
      networkSecurityGroups: {
        listAll: () => asyncIterable([{
          id: "/subscriptions/s/nsg/rdp", name: "rdp-box",
          securityRules: [{ name: "allow-rdp-range", direction: "Inbound", access: "Allow", sourceAddressPrefix: "Internet", destinationPortRange: "3300-3400" }],
        }]),
      },
    };
    const results = await checkNsgNoOpenIngress(network);
    expect(results[0].status).toBe("fail");
  });

  test("passes an NSG allowing inbound port 22 only from a specific CIDR", async () => {
    const network = {
      networkSecurityGroups: {
        listAll: () => asyncIterable([{
          id: "/subscriptions/s/nsg/z", name: "z",
          securityRules: [{ name: "allow-ssh-office", direction: "Inbound", access: "Allow", sourceAddressPrefix: "203.0.113.0/24", destinationPortRange: "22" }],
        }]),
      },
    };
    const results = await checkNsgNoOpenIngress(network);
    expect(results[0].status).toBe("pass");
  });

  test("passes an NSG allowing 0.0.0.0/0 on an unrelated port (443)", async () => {
    const network = {
      networkSecurityGroups: {
        listAll: () => asyncIterable([{
          id: "/subscriptions/s/nsg/web", name: "web",
          securityRules: [{ name: "allow-https", direction: "Inbound", access: "Allow", sourceAddressPrefix: "0.0.0.0/0", destinationPortRange: "443" }],
        }]),
      },
    };
    const results = await checkNsgNoOpenIngress(network);
    expect(results[0].status).toBe("pass");
  });

  test("fails an NSG allowing inbound port 22 from sourceAddressPrefixes array (plural field)", async () => {
    const network = {
      networkSecurityGroups: {
        listAll: () => asyncIterable([{
          id: "/subscriptions/s/nsg/plural", name: "plural-sources",
          securityRules: [{ name: "allow-ssh-plural", direction: "Inbound", access: "Allow", sourceAddressPrefixes: ["0.0.0.0/0"], destinationPortRange: "22" }],
        }]),
      },
    };
    const results = await checkNsgNoOpenIngress(network);
    expect(results[0].status).toBe("fail");
  });

  test("fails an NSG allowing all ports via wildcard destinationPortRange", async () => {
    const network = {
      networkSecurityGroups: {
        listAll: () => asyncIterable([{
          id: "/subscriptions/s/nsg/wildcard", name: "all-ports",
          securityRules: [{ name: "allow-all", direction: "Inbound", access: "Allow", sourceAddressPrefix: "*", destinationPortRange: "*" }],
        }]),
      },
    };
    const results = await checkNsgNoOpenIngress(network);
    expect(results[0].status).toBe("fail");
  });

  test("returns not_applicable when there are no network security groups", async () => {
    const network = { networkSecurityGroups: { listAll: () => asyncIterable([]) } };
    const results = await checkNsgNoOpenIngress(network);
    expect(results).toEqual([{ resourceId: "subscription", status: "not_applicable", message: "No network security groups found", evidencePayload: {} }]);
  });
});
