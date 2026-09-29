import { describe, it, expect } from "vitest";
import { normaliseGapContext, buildGapContextPrompt, GAP_CONTEXT_SCHEMA_VERSION } from "../utils/readinessGapContextPrompt.js";

const ctx = {
  firedGapIds: new Set(["it-1", "it-12", "lg-6"]),
  remediationLen: (id) => ({ "it-1": 4, "it-12": 3, "lg-6": 3 }[id] ?? 0),
  submissionAnswers: [
    { questionId: "it-14", department: "IT", answer: "YES" },
    { questionId: "it-12", department: "IT", answer: "NO" },
  ],
};

describe("GAP_CONTEXT_SCHEMA_VERSION", () => {
  it("is a non-empty string", () => {
    expect(typeof GAP_CONTEXT_SCHEMA_VERSION).toBe("string");
    expect(GAP_CONTEXT_SCHEMA_VERSION.length).toBeGreaterThan(0);
  });
});

describe("normaliseGapContext — tailoring", () => {
  it("drops unknown gapIds and collapses duplicates to the first valid one", () => {
    const out = normaliseGapContext({
      tailoring: [
        { gapId: "nope", sentence: "x" },
        { gapId: "it-1", sentence: "first" },
        { gapId: "it-1", sentence: "second" },
      ],
    }, ctx);
    expect(out.tailoring).toEqual([{ gapId: "it-1", sentence: "first" }]);
  });

  it("truncates a very long sentence", () => {
    const long = "a".repeat(1000);
    const out = normaliseGapContext({ tailoring: [{ gapId: "it-1", sentence: long }] }, ctx);
    expect(out.tailoring[0].sentence.length).toBeLessThan(400);
  });
});

describe("normaliseGapContext — roadmapPhasing", () => {
  it("rejects negative / float / NaN / out-of-range stepIndex", () => {
    const out = normaliseGapContext({
      roadmapPhasing: [
        { phase: 0, stepRefs: [
          { gapId: "it-1", stepIndex: -1 },
          { gapId: "it-1", stepIndex: 1.5 },
          { gapId: "it-1", stepIndex: NaN },
          { gapId: "it-1", stepIndex: 99 },
          { gapId: "it-1", stepIndex: 0 }, // the only valid one
        ] },
      ],
    }, ctx);
    const p0 = out.roadmapPhasing.find(b => b.phase === 0).stepRefs;
    expect(p0).toContainEqual({ gapId: "it-1", stepIndex: 0 });
    expect(p0.filter(r => r.gapId === "it-1")).toHaveLength(1);
  });

  it("keeps a step placed in multiple phases at the earliest phase", () => {
    const out = normaliseGapContext({
      roadmapPhasing: [
        { phase: 2, stepRefs: [{ gapId: "it-1", stepIndex: 0 }] },
        { phase: 0, stepRefs: [{ gapId: "it-1", stepIndex: 0 }] },
      ],
    }, ctx);
    expect(out.roadmapPhasing.find(b => b.phase === 0).stepRefs).toContainEqual({ gapId: "it-1", stepIndex: 0 });
    expect(out.roadmapPhasing.find(b => b.phase === 2).stepRefs).not.toContainEqual({ gapId: "it-1", stepIndex: 0 });
  });

  it("defaults an unplaced fired-gap step to Phase 2 and always returns 4 buckets", () => {
    const out = normaliseGapContext({ roadmapPhasing: [] }, ctx);
    expect(out.roadmapPhasing.map(b => b.phase)).toEqual([0, 1, 2, 3]);
    // lg-6 step 0 was never placed → Phase 2
    expect(out.roadmapPhasing[2].stepRefs).toContainEqual({ gapId: "lg-6", stepIndex: 0 });
  });
});

describe("normaliseGapContext — contradictions", () => {
  it("drops an entry with a sourceRef that does not match a real submitted answer", () => {
    const out = normaliseGapContext({
      contradictions: [
        { sourceRefs: [{ questionId: "it-14", department: "IT", answer: "YES" }, { questionId: "it-12", department: "IT", answer: "NO" }], tension: "real tension" },
        { sourceRefs: [{ questionId: "made-up", department: "Ghost", answer: "NO" }], tension: "invented" },
      ],
    }, ctx);
    expect(out.contradictions).toHaveLength(1);
    expect(out.contradictions[0].tension).toBe("real tension");
    expect(out.contradictions[0].source).toBe("ai");
    // relatedGapIds recomputed from fired-gap subset of sourceRefs
    expect(out.contradictions[0].relatedGapIds).toEqual(["it-12"]);
  });
});

describe("normaliseGapContext — degenerate input", () => {
  it("returns null on garbage", () => {
    expect(normaliseGapContext("garbage", ctx)).toBeNull();
    expect(normaliseGapContext(null, ctx)).toBeNull();
    expect(normaliseGapContext([1, 2], ctx)).toBeNull();
  });

  it("returns a valid empty structure for {}", () => {
    const out = normaliseGapContext({}, ctx);
    expect(out.tailoring).toEqual([]);
    expect(out.contradictions).toEqual([]);
    expect(out.roadmapPhasing).toHaveLength(4);
  });
});

describe("buildGapContextPrompt", () => {
  it("includes the gap ids and remediation step indexes", () => {
    const p = buildGapContextPrompt({
      companyName: "Acme",
      gaps: [{ gapId: "it-1", worstAnswer: "NO", rating: "Critical", guidance: { whyItMatters: "matters", remediation: [{ step: "do a thing", effort: "M" }] } }],
      workstreams: [{ id: "WS1", name: "Governance" }],
    });
    expect(p).toContain("gapId: it-1");
    expect(p).toContain("[0] (M) do a thing");
    expect(p).toContain("WS1 — Governance");
  });
});
