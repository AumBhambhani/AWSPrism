import { describe, test, expect } from "vitest";
import { riskTests } from "../connectors/onetrust/tests/risk.js";

const byKey = Object.fromEntries(riskTests.map((t) => [t.key, t]));
const run = (key, clients) => byKey[key].run(clients);
const daysAgo = (n) => new Date(Date.now() - n * 86400000).toISOString();
const daysAhead = (n) => new Date(Date.now() + n * 86400000).toISOString();

const clients = (risks = []) => ({ listRisks: async () => risks });

describe("onetrust.risk.high_risks_have_treatment", () => {
  test("no open high risks → not_applicable", async () => {
    expect((await run("onetrust.risk.high_risks_have_treatment", clients()))[0].status).toBe("not_applicable");
  });
  test("open high risk with no control and no deadline → fail", async () => {
    const r = await run(
      "onetrust.risk.high_risks_have_treatment",
      clients([
        { id: "r1", level: "HIGH", state: "OPEN", controlsIdentifier: [] },
        { id: "r2", level: "HIGH", state: "OPEN", controlsIdentifier: ["A.9.4.1"] },
        { id: "r3", level: "LOW", state: "OPEN" },
      ])
    );
    expect(r).toHaveLength(1);
    expect(r[0].resourceId).toBe("r1");
  });
  test("closed risks are ignored", async () => {
    const r = await run("onetrust.risk.high_risks_have_treatment", clients([{ id: "r1", level: "HIGH", state: "CLOSED" }]));
    expect(r[0].status).toBe("not_applicable");
  });
});

describe("onetrust.risk.treatment_not_overdue", () => {
  test("past deadline → fail; future deadline → pass", async () => {
    const r = await run(
      "onetrust.risk.treatment_not_overdue",
      clients([
        { id: "r1", state: "OPEN", deadline: daysAgo(10) },
        { id: "r2", state: "OPEN", deadline: daysAhead(10) },
      ])
    );
    expect(r).toHaveLength(1);
    expect(r[0].resourceId).toBe("r1");
  });
});

describe("onetrust.risk.register_maintained", () => {
  test("empty → fail, non-empty → pass", async () => {
    expect((await run("onetrust.risk.register_maintained", clients()))[0].status).toBe("fail");
    expect((await run("onetrust.risk.register_maintained", clients([{ id: "r1" }])))[0].status).toBe("pass");
  });
});
