import { describe, test, expect } from "vitest";
import { dataDiscoveryTests } from "../connectors/privy/tests/dataDiscovery.js";

const byKey = Object.fromEntries(dataDiscoveryTests.map((t) => [t.key, t]));
const run = (key, clients) => byKey[key].run(clients);

function clients({ inventory = {} } = {}) {
  return { listInventory: async (type) => inventory[type] || [] };
}

describe("privy.inventory.ropa_populated", () => {
  test("empty processing-activities inventory → fail", async () => {
    const r = await run("privy.inventory.ropa_populated", clients());
    expect(r[0].status).toBe("fail");
  });
  test("populated RoPA → pass", async () => {
    const r = await run("privy.inventory.ropa_populated", clients({ inventory: { "processing-activities": [{ id: "pa1" }] } }));
    expect(r[0].status).toBe("pass");
  });
});

describe("privy.inventory.records_have_owners", () => {
  test("no records → not_applicable", async () => {
    const r = await run("privy.inventory.records_have_owners", clients());
    expect(r[0].status).toBe("not_applicable");
  });
  test("record without an owner → fail", async () => {
    const r = await run("privy.inventory.records_have_owners", clients({ inventory: { "processing-activities": [{ id: "pa1", name: "Payroll" }] } }));
    expect(r[0]).toMatchObject({ resourceId: "pa1", status: "fail" });
  });
  test("all records owned → pass", async () => {
    const r = await run("privy.inventory.records_have_owners", clients({
      inventory: {
        "processing-activities": [{ id: "pa1", owner: { name: "HR" } }],
        assets: [{ id: "as1", dataOwner: "it@acme.com" }],
      },
    }));
    expect(r[0].status).toBe("pass");
  });
});
