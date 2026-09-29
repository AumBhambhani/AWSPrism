import { describe, test, expect } from "vitest";
import { assessmentsTests } from "../connectors/onetrust/tests/assessments.js";

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

describe("onetrust.assessments.no_stale_in_progress", () => {
  test("empty inventory → single not_applicable", async () => {
    const r = await run("onetrust.assessments.no_stale_in_progress", clients());
    expect(r).toHaveLength(1);
    expect(r[0].status).toBe("not_applicable");
  });

  test("fails per stale open assessment, ignores completed and fresh ones", async () => {
    const r = await run(
      "onetrust.assessments.no_stale_in_progress",
      clients({
        assessments: [
          { assessmentId: "a1", assessmentNumber: "A-1", assessmentStatus: "IN_PROGRESS", lastModifiedDate: daysAgo(120) },
          { assessmentId: "a2", assessmentNumber: "A-2", assessmentStatus: "IN_PROGRESS", lastModifiedDate: daysAgo(10) },
          { assessmentId: "a3", assessmentNumber: "A-3", assessmentStatus: "COMPLETED", lastModifiedDate: daysAgo(400) },
        ],
      })
    );
    expect(r).toHaveLength(1);
    expect(r[0]).toMatchObject({ resourceId: "a1", status: "fail" });
  });

  test("all open assessments fresh → single pass", async () => {
    const r = await run(
      "onetrust.assessments.no_stale_in_progress",
      clients({ assessments: [{ assessmentId: "a2", assessmentStatus: "UNDER_REVIEW", lastModifiedDate: daysAgo(5) }] })
    );
    expect(r[0].status).toBe("pass");
  });
});

describe("onetrust.assessments.high_risks_mitigated", () => {
  test("no completed assessments → not_applicable", async () => {
    const r = await run("onetrust.assessments.high_risks_mitigated", clients({ assessments: [{ assessmentId: "a1", assessmentStatus: "IN_PROGRESS" }] }));
    expect(r[0].status).toBe("not_applicable");
  });

  test("flags an unmitigated High risk on a completed assessment", async () => {
    const r = await run(
      "onetrust.assessments.high_risks_mitigated",
      clients({
        assessments: [{ assessmentId: "a1", assessmentNumber: "A-1", assessmentStatus: "COMPLETED" }],
        exports: {
          a1: { risks: [{ id: "r1", level: "HIGH", state: "OPEN" }, { id: "r2", level: "LOW", state: "OPEN" }] },
        },
      })
    );
    expect(r).toHaveLength(1);
    expect(r[0].status).toBe("fail");
    expect(r[0].resourceId).toBe("a1:r1");
  });

  test("mitigated High risk → pass", async () => {
    const r = await run(
      "onetrust.assessments.high_risks_mitigated",
      clients({
        assessments: [{ assessmentId: "a1", assessmentStatus: "COMPLETED" }],
        exports: { a1: { risks: [{ id: "r1", level: "VERY_HIGH", state: "MITIGATED" }] } },
      })
    );
    expect(r[0].status).toBe("pass");
  });

  test("export failure for one assessment → not_applicable row, no throw", async () => {
    const r = await run(
      "onetrust.assessments.high_risks_mitigated",
      clients({
        assessments: [{ assessmentId: "a1", assessmentStatus: "COMPLETED" }],
        exports: { a1: new Error("500") },
      })
    );
    expect(r[0].status).toBe("not_applicable");
  });
});

describe("onetrust.assessments.dpia_process_operating", () => {
  test("no PIA/DPIA templates → fail", async () => {
    const r = await run("onetrust.assessments.dpia_process_operating", clients({ assessments: [{ templateType: "VENDOR", assessmentStatus: "COMPLETED" }] }));
    expect(r[0].status).toBe("fail");
  });

  test("a DPIA completed in the last year → pass", async () => {
    const r = await run(
      "onetrust.assessments.dpia_process_operating",
      clients({ assessments: [{ templateType: "DPIA", assessmentStatus: "COMPLETED", lastModifiedDate: daysAgo(30) }] })
    );
    expect(r[0].status).toBe("pass");
  });

  test("PIA templates exist but none completed recently → fail", async () => {
    const r = await run(
      "onetrust.assessments.dpia_process_operating",
      clients({ assessments: [{ templateType: "PIA", assessmentStatus: "COMPLETED", lastModifiedDate: daysAgo(500) }] })
    );
    expect(r[0].status).toBe("fail");
  });
});
