import { describe, test, expect } from "vitest";
import { tprmTests } from "../connectors/privy/tests/tprm.js";

const byKey = Object.fromEntries(tprmTests.map((t) => [t.key, t]));
const run = (key, clients) => byKey[key].run(clients);
const daysAgo = (n) => new Date(Date.now() - n * 86400000).toISOString();

function clients({ vendors = [] } = {}) {
  return { listVendors: async () => vendors };
}

describe("privy.tprm.processors_risk_assessed", () => {
  test("empty inventory → not_applicable", async () => {
    const r = await run("privy.tprm.processors_risk_assessed", clients());
    expect(r[0].status).toBe("not_applicable");
  });
  test("unassessed processor → fail", async () => {
    const r = await run("privy.tprm.processors_risk_assessed", clients({ vendors: [{ id: "v1", name: "Acme Corp" }] }));
    expect(r[0]).toMatchObject({ resourceId: "v1", status: "fail" });
  });
  test("processor with a completed assessment → pass", async () => {
    const r = await run("privy.tprm.processors_risk_assessed", clients({ vendors: [{ id: "v1", name: "Acme", assessmentStatus: "completed" }] }));
    expect(r[0].status).toBe("pass");
  });
});

describe("privy.tprm.high_risk_reviewed", () => {
  test("no high-risk processors → not_applicable", async () => {
    const r = await run("privy.tprm.high_risk_reviewed", clients({ vendors: [{ id: "v1", riskLevel: "LOW" }] }));
    expect(r[0].status).toBe("not_applicable");
  });
  test("stale high-risk processor → fail", async () => {
    const r = await run("privy.tprm.high_risk_reviewed", clients({ vendors: [{ id: "v1", name: "Acme", riskLevel: "HIGH", lastAssessedAt: daysAgo(400) }] }));
    expect(r[0].status).toBe("fail");
  });
  test("recently reviewed high-risk processor → pass", async () => {
    const r = await run("privy.tprm.high_risk_reviewed", clients({ vendors: [{ id: "v1", riskLevel: "HIGH", lastAssessedAt: daysAgo(30) }] }));
    expect(r[0].status).toBe("pass");
  });
});
