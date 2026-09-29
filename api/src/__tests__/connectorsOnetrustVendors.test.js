import { describe, test, expect } from "vitest";
import { vendorsTests } from "../connectors/onetrust/tests/vendors.js";

const byKey = Object.fromEntries(vendorsTests.map((t) => [t.key, t]));
const run = (key, clients) => byKey[key].run(clients);
const daysAgo = (n) => new Date(Date.now() - n * 86400000).toISOString();

function clients({ vendors = [], assessments = [] } = {}) {
  return {
    listInventory: async (type) => (type === "vendors" ? vendors : []),
    listAssessments: async () => assessments,
  };
}

describe("onetrust.vendors.risk_assessed", () => {
  test("empty vendor inventory → not_applicable", async () => {
    expect((await run("onetrust.vendors.risk_assessed", clients()))[0].status).toBe("not_applicable");
  });

  test("vendor with no completed vendor assessment → fail; linked one → pass", async () => {
    const r = await run(
      "onetrust.vendors.risk_assessed",
      clients({
        vendors: [{ id: "v1", name: "Acme Corp" }, { id: "v2", name: "Globex" }],
        assessments: [
          { assessmentStatus: "COMPLETED", templateType: "VENDOR", primaryRecordName: "Acme Corp" },
          { assessmentStatus: "IN_PROGRESS", templateType: "VENDOR", primaryRecordName: "Globex" },
        ],
      })
    );
    expect(r).toHaveLength(1);
    expect(r[0].resourceId).toBe("v2");
  });

  test("link by inventory id reference", async () => {
    const r = await run(
      "onetrust.vendors.risk_assessed",
      clients({
        vendors: [{ id: "v1", name: "Acme" }],
        assessments: [{ assessmentStatus: "COMPLETED", templateType: "TPDD", inventoryRefIds: ["v1"] }],
      })
    );
    expect(r[0].status).toBe("pass");
  });
});

describe("onetrust.vendors.high_risk_reviewed", () => {
  test("no high-risk vendors → not_applicable", async () => {
    const r = await run("onetrust.vendors.high_risk_reviewed", clients({ vendors: [{ id: "v1", riskLevel: "LOW" }] }));
    expect(r[0].status).toBe("not_applicable");
  });
  test("stale high-risk vendor → fail", async () => {
    const r = await run(
      "onetrust.vendors.high_risk_reviewed",
      clients({
        vendors: [
          { id: "v1", name: "Acme", riskLevel: "HIGH", lastUpdated: daysAgo(400) },
          { id: "v2", name: "Globex", riskLevel: "VERY_HIGH", lastUpdated: daysAgo(30) },
        ],
      })
    );
    expect(r).toHaveLength(1);
    expect(r[0].resourceId).toBe("v1");
  });
});

describe("onetrust.vendors.inventory_populated", () => {
  test("empty → fail, non-empty → pass", async () => {
    expect((await run("onetrust.vendors.inventory_populated", clients()))[0].status).toBe("fail");
    expect((await run("onetrust.vendors.inventory_populated", clients({ vendors: [{ id: "v1" }] })))[0].status).toBe("pass");
  });
});
