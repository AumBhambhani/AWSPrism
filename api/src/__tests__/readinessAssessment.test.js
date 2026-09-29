import { describe, it, expect } from "vitest";
import {
  computeGaps, computeFindings, computeContradictions, computeMaturity, buildReadinessAssessment,
} from "../utils/readinessAssessment.js";
import { GUIDANCE } from "../utils/selfAssessQuestionGuidance.js";

const sub = (department, answers, userEmail = "one@co.io") => ({ department, userEmail, answers });

describe("computeGaps", () => {
  it("emits one gap per fired NO/PARTIAL question, sorted worst-first", () => {
    const gaps = computeGaps([sub("IT", { "it-1": "NO", "it-15": "PARTIAL", "it-16": "YES" })]);
    const ids = gaps.map(g => g.gapId);
    expect(ids).toContain("it-1");
    expect(ids).toContain("it-15");
    expect(ids).not.toContain("it-16"); // YES is not a gap
    // sorted by score desc
    for (let i = 1; i < gaps.length; i++) expect(gaps[i - 1].score).toBeGreaterThanOrEqual(gaps[i].score);
  });

  it("a NO in one department is not likelihood-reduced by a PARTIAL in another", () => {
    const gaps = computeGaps([
      sub("IT", { "it-12": "NO" }),
      sub("Finance", { "it-12": "PARTIAL" }),
    ]);
    const g = gaps.find(x => x.gapId === "it-12");
    expect(g.worstAnswer).toBe("NO");
    expect(g.likelihood).toBe(GUIDANCE["it-12"].likelihood); // full, not reduced
    expect(g.departments.map(d => d.answer).sort()).toEqual(["NO", "PARTIAL"]);
  });

  it("a PARTIAL-only gap has likelihood reduced by one (min 1)", () => {
    const gaps = computeGaps([sub("IT", { "it-12": "PARTIAL" })]);
    const g = gaps.find(x => x.gapId === "it-12");
    expect(g.worstAnswer).toBe("PARTIAL");
    expect(g.likelihood).toBe(Math.max(1, GUIDANCE["it-12"].likelihood - 1));
  });

  it("keeps custom-department gaps distinct even when they share a generic guidance entry", () => {
    const gaps = computeGaps([
      sub("sales", { "sales-1": "NO" }),
      sub("logistics", { "logistics-1": "NO" }),
    ]);
    const ids = gaps.map(g => g.gapId).sort();
    expect(ids).toEqual(["logistics-1", "sales-1"]);
    const a = gaps.find(g => g.gapId === "sales-1");
    const b = gaps.find(g => g.gapId === "logistics-1");
    expect(a.guidance).toBe(GUIDANCE["generic-1"]);
    expect(b.guidance).toBe(GUIDANCE["generic-1"]);
    expect(a).not.toBe(b);
  });
});

describe("computeFindings", () => {
  it("groups gaps by findingKey and takes the whole tuple from ONE winning member", () => {
    // Two gaps under the same findingKey: one (impact 5, likelihood 2), one (impact 2, likelihood 5).
    // Both score 10 — the winner tie-breaks on impact desc → (5, 2). The finding must be (5, 2), not (5, 5).
    const gaps = [
      { gapId: "q-a", questionId: "q-a", domain: "security", guidance: { findingKey: "security-uneven", domain: "security" }, impact: 5, likelihood: 2, score: 10 },
      { gapId: "q-b", questionId: "q-b", domain: "security", guidance: { findingKey: "security-uneven", domain: "security" }, impact: 2, likelihood: 5, score: 10 },
    ];
    const { findings } = computeFindings(gaps, {});
    const f = findings.find(x => x.key === "security-uneven");
    expect(f.impact).toBe(5);
    expect(f.likelihood).toBe(2);
    expect(f.score).toBe(10);
    expect(f.memberGapIds).toEqual(["q-a", "q-b"]); // gaps-array order preserved
  });

  it("materialises a single-member finding", () => {
    const gaps = computeGaps([sub("HR", { "hr-4": "NO" })]);
    const { findings } = computeFindings(gaps, {});
    const f = findings.find(x => x.key === "no-training");
    expect(f).toBeTruthy();
    expect(f.memberGapIds).toEqual(["hr-4"]);
  });

  it("appends synthetic coverage-gap findings with no member gaps", () => {
    const { findings } = computeFindings([], {});
    const children = findings.find(f => f.key === "children");
    expect(children).toBeTruthy();
    expect(children.synthetic).toBe("not-assessed");
    expect(children.memberGapIds).toEqual([]);
  });

  it("appends the single-contributor synthetic finding only when singleContributor is true", () => {
    expect(computeFindings([], { singleContributor: false }).findings.find(f => f.key === "no-second-reviewer")).toBeUndefined();
    expect(computeFindings([], { singleContributor: true }).findings.find(f => f.key === "no-second-reviewer")).toBeTruthy();
  });
});

describe("computeContradictions", () => {
  it("fires a rule where one side is a YES (not a fired gap) and reports only the NO side as related", () => {
    const subs = [
      sub("IT", { "it-14": "YES", "it-12": "NO" }),
    ];
    const fired = new Set(["it-12"]);
    const out = computeContradictions(subs, fired);
    const c = out.find(x => x.id === "delete-without-retention");
    expect(c).toBeTruthy();
    expect(c.source).toBe("rule");
    expect(c.relatedGapIds).toEqual(["it-12"]);
    expect(c.sourceRefs).toEqual([
      { questionId: "it-14", department: "IT", answer: "YES" },
      { questionId: "it-12", department: "IT", answer: "NO" },
    ]);
    expect(c.departments).toEqual(["IT"]);
  });

  it("does not fire when a when-clause is unsatisfied", () => {
    const subs = [sub("IT", { "it-14": "YES", "it-12": "YES" })];
    const out = computeContradictions(subs, new Set());
    expect(out.find(x => x.id === "delete-without-retention")).toBeUndefined();
  });
});

describe("computeMaturity", () => {
  it("reads the domain off the guidance entry (incl. generic fallback)", () => {
    const m = computeMaturity([sub("IT", { "it-1": "NO", "it-2": "YES" }), sub("sales", { "sales-4": "YES" })]);
    const inventory = m.domains.find(d => d.id === "inventory");
    expect(inventory.assessed).toBe(true);
  });
});

describe("buildReadinessAssessment", () => {
  it("returns the full shape including gaps and contradictions", () => {
    const a = buildReadinessAssessment([
      sub("IT", { "it-1": "NO", "it-14": "YES", "it-12": "NO", "it-11": "NO" }),
    ]);
    expect(Array.isArray(a.gaps)).toBe(true);
    expect(Array.isArray(a.contradictions)).toBe(true);
    expect(a.findingCounts.total).toBeGreaterThan(0);
    expect(a.contradictions.find(c => c.id === "delete-without-retention")).toBeTruthy();
  });
});
