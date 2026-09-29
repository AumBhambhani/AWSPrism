import { describe, test, expect } from "vitest";
import { assessmentsTests } from "../connectors/privy/tests/assessments.js";

const byKey = Object.fromEntries(assessmentsTests.map((t) => [t.key, t]));
const run = (key, clients) => byKey[key].run(clients);
const daysAgo = (n) => new Date(Date.now() - n * 86400000).toISOString();

function clients({ assessments = [], exports = {} } = {}) {
  return {
    listAssessments: async () => assessments,
    exportAssessment: async (id) => {
      if (exports[id] instanceof Error) throw exports[id];
      return exports[id] || {};
    },
  };
}

describe("privy.assessments.no_stale_in_progress", () => {
  test("empty → not_applicable", async () => {
    const r = await run("privy.assessments.no_stale_in_progress", clients());
    expect(r[0].status).toBe("not_applicable");
  });
  test("stale in-progress assessment → fail", async () => {
    const r = await run("privy.assessments.no_stale_in_progress", clients({ assessments: [{ id: "a1", name: "A1", status: "in_progress", updatedAt: daysAgo(120) }] }));
    expect(r[0]).toMatchObject({ resourceId: "a1", status: "fail" });
  });
  test("fresh in-progress → pass", async () => {
    const r = await run("privy.assessments.no_stale_in_progress", clients({ assessments: [{ id: "a1", status: "in_review", updatedAt: daysAgo(5) }] }));
    expect(r[0].status).toBe("pass");
  });
});

describe("privy.assessments.high_risks_mitigated", () => {
  test("unmitigated HIGH risk on a completed assessment → fail", async () => {
    const r = await run("privy.assessments.high_risks_mitigated", clients({
      assessments: [{ id: "a1", status: "completed" }],
      exports: { a1: { risks: [{ id: "r1", level: "HIGH", state: "OPEN" }] } },
    }));
    expect(r[0].status).toBe("fail");
    expect(r[0].resourceId).toBe("a1:r1");
  });
  test("mitigated risk → pass", async () => {
    const r = await run("privy.assessments.high_risks_mitigated", clients({
      assessments: [{ id: "a1", status: "approved" }],
      exports: { a1: { risks: [{ id: "r1", level: "VERY_HIGH", state: "MITIGATED" }] } },
    }));
    expect(r[0].status).toBe("pass");
  });
  test("export failure → not_applicable, no throw", async () => {
    const r = await run("privy.assessments.high_risks_mitigated", clients({
      assessments: [{ id: "a1", status: "completed" }],
      exports: { a1: new Error("500") },
    }));
    expect(r[0].status).toBe("not_applicable");
  });
});

describe("privy.assessments.dpia_process_operating", () => {
  test("no PIA/DPIA assessments → fail", async () => {
    const r = await run("privy.assessments.dpia_process_operating", clients({ assessments: [{ id: "a1", type: "VENDOR", status: "completed" }] }));
    expect(r[0].status).toBe("fail");
  });
  test("a DPIA completed this year → pass", async () => {
    const r = await run("privy.assessments.dpia_process_operating", clients({ assessments: [{ id: "a1", type: "DPIA", status: "completed", completedAt: daysAgo(30) }] }));
    expect(r[0].status).toBe("pass");
  });
});
