import { describe, test, expect } from "vitest";
import { inventoryTests } from "../connectors/onetrust/tests/inventory.js";

const byKey = Object.fromEntries(inventoryTests.map((t) => [t.key, t]));
const run = (key, clients) => byKey[key].run(clients);
const daysAgo = (n) => new Date(Date.now() - n * 86400000).toISOString();

function clients(inv = {}) {
  return { listInventory: async (type) => inv[type] || [] };
}

describe("onetrust.inventory.ropa_populated", () => {
  test("empty processing-activities → fail", async () => {
    const r = await run("onetrust.inventory.ropa_populated", clients());
    expect(r[0].status).toBe("fail");
  });
  test("non-empty → pass", async () => {
    const r = await run("onetrust.inventory.ropa_populated", clients({ "processing-activities": [{ id: "p1" }] }));
    expect(r[0].status).toBe("pass");
  });
});

describe("onetrust.inventory.records_have_owners", () => {
  test("no records → not_applicable", async () => {
    const r = await run("onetrust.inventory.records_have_owners", clients());
    expect(r[0].status).toBe("not_applicable");
  });
  test("fails per unowned record", async () => {
    const r = await run(
      "onetrust.inventory.records_have_owners",
      clients({
        assets: [{ id: "as1", name: "DB", organization: { name: "IT" } }, { id: "as2", number: "AS-2" }],
        "processing-activities": [{ id: "p1", organization: "" }],
      })
    );
    expect(r.map((x) => x.resourceId).sort()).toEqual(["as2", "p1"]);
    expect(r.every((x) => x.status === "fail")).toBe(true);
  });
  test("all owned → pass", async () => {
    const r = await run("onetrust.inventory.records_have_owners", clients({ assets: [{ id: "as1", organization: "IT" }] }));
    expect(r[0].status).toBe("pass");
  });
});

describe("onetrust.inventory.records_reviewed_annually", () => {
  test("stale record → fail; missing date is ignored", async () => {
    const r = await run(
      "onetrust.inventory.records_reviewed_annually",
      clients({
        assets: [
          { id: "as1", lastUpdated: daysAgo(500) },
          { id: "as2", lastUpdated: daysAgo(30) },
          { id: "as3" },
        ],
      })
    );
    expect(r).toHaveLength(1);
    expect(r[0]).toMatchObject({ resourceId: "as1", status: "fail" });
  });
  test("all fresh → pass", async () => {
    const r = await run("onetrust.inventory.records_reviewed_annually", clients({ assets: [{ id: "as1", lastUpdated: daysAgo(10) }] }));
    expect(r[0].status).toBe("pass");
  });
});
