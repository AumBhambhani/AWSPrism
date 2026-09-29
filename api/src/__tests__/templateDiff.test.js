import { describe, test, expect } from "vitest";
import { classifyTemplateDiff, textSimilarity, summarizeTemplateDiff } from "../utils/templateDiff.js";

const q = (quest_id, baseline_question, isoReference = "", module_id = "M1") =>
  ({ quest_id, baseline_question, iso_reference: isoReference, module_id });

describe("classifyTemplateDiff", () => {
  test("same id, same text -> unchanged", () => {
    const oldQ = [q("Q1", "Do you encrypt data at rest?")];
    const newQ = [q("Q1", "Do you encrypt data at rest?")];
    const diff = classifyTemplateDiff(oldQ, newQ);
    expect(diff.unchanged).toEqual([{ questId: "Q1" }]);
    expect(diff.reworded).toHaveLength(0);
    expect(diff.renamed).toHaveLength(0);
  });

  test("same id, different text -> reworded", () => {
    const oldQ = [q("Q1", "Do you encrypt data at rest?")];
    const newQ = [q("Q1", "Is data encrypted at rest using AES-256?")];
    const diff = classifyTemplateDiff(oldQ, newQ);
    expect(diff.reworded).toEqual([
      { questId: "Q1", oldText: oldQ[0].baseline_question, newText: newQ[0].baseline_question,
        oldIso: "", newIso: "", textChanged: true, isoChanged: false },
    ]);
    expect(diff.unchanged).toHaveLength(0);
  });

  test("same id, same text, but clause/control reference changed -> reworded", () => {
    const oldQ = [q("Q1", "Do you encrypt data at rest?", "CC6.1")];
    const newQ = [q("Q1", "Do you encrypt data at rest?", "CC6.2")];
    const diff = classifyTemplateDiff(oldQ, newQ);
    expect(diff.unchanged).toHaveLength(0);
    expect(diff.reworded).toEqual([
      { questId: "Q1", oldText: oldQ[0].baseline_question, newText: newQ[0].baseline_question,
        oldIso: "CC6.1", newIso: "CC6.2", textChanged: false, isoChanged: true },
    ]);
  });

  test("clause reference reformatted only (spacing) is not treated as a change", () => {
    const oldQ = [q("Q1", "Do you encrypt data at rest?", "CC2.1, CC2.2")];
    const newQ = [q("Q1", "Do you encrypt data at rest?", "CC2.1,CC2.2")];
    const diff = classifyTemplateDiff(oldQ, newQ);
    expect(diff.unchanged).toEqual([{ questId: "Q1" }]);
    expect(diff.reworded).toHaveLength(0);
  });

  test("id changed but text near-identical -> renamed, not delete+add", () => {
    const oldQ = [q("Q1", "Do you maintain an asset inventory?")];
    const newQ = [q("Q1-NEW", "Do you maintain an asset inventory?")];
    const diff = classifyTemplateDiff(oldQ, newQ);
    expect(diff.renamed).toHaveLength(1);
    expect(diff.renamed[0]).toMatchObject({ oldQuestId: "Q1", newQuestId: "Q1-NEW" });
    expect(diff.added).toHaveLength(0);
    expect(diff.removed).toHaveLength(0);
  });

  test("id changed with only a minor wording tweak -> still renamed (near-identical)", () => {
    const oldQ = [q("Q1", "Do you maintain an asset inventory?")];
    const newQ = [q("Q1-NEW", "Do you maintain an up to date asset inventory?")];
    const diff = classifyTemplateDiff(oldQ, newQ);
    expect(diff.renamed).toHaveLength(1);
    expect(diff.renamed[0].oldQuestId).toBe("Q1");
    expect(diff.renamed[0].newQuestId).toBe("Q1-NEW");
  });

  test("new id, unrelated text -> added; old id with no match -> removed", () => {
    const oldQ = [q("Q1", "Do you encrypt data at rest?")];
    const newQ = [q("Q2", "Do you run quarterly penetration tests?")];
    const diff = classifyTemplateDiff(oldQ, newQ);
    expect(diff.added).toEqual([{ questId: "Q2", text: newQ[0].baseline_question }]);
    expect(diff.removed).toEqual([{ questId: "Q1", text: oldQ[0].baseline_question }]);
    expect(diff.renamed).toHaveLength(0);
  });

  test("multiple ambiguous near-matches resolve to a stable one-to-one pairing", () => {
    // Q1 and Q2 both plausibly could match NEW1; greedy-by-similarity should not
    // double-assign NEW1, and the leftover should fall back to added/removed.
    const oldQ = [
      q("Q1", "Do you review access logs monthly?"),
      q("Q2", "Do you review access logs quarterly?"),
    ];
    const newQ = [q("NEW1", "Do you review access logs monthly?")];
    const diff = classifyTemplateDiff(oldQ, newQ);
    expect(diff.renamed).toHaveLength(1);
    expect(diff.renamed[0]).toMatchObject({ oldQuestId: "Q1", newQuestId: "NEW1" });
    // Q2 has no remaining candidate to pair with -> removed, not silently dropped.
    expect(diff.removed.map((r) => r.questId)).toContain("Q2");
  });

  test("unrelated questions are never matched purely because ids both vanished", () => {
    const oldQ = [q("Q1", "Do you encrypt data at rest?")];
    const newQ = [q("Q2", "Do you conduct annual fire drills?")];
    const diff = classifyTemplateDiff(oldQ, newQ);
    expect(diff.renamed).toHaveLength(0);
    expect(diff.added).toHaveLength(1);
    expect(diff.removed).toHaveLength(1);
  });

  test("summarizeTemplateDiff returns counts per category", () => {
    const oldQ = [q("Q1", "text A"), q("Q2", "text B")];
    const newQ = [q("Q1", "text A"), q("Q3", "text C")];
    const diff = classifyTemplateDiff(oldQ, newQ);
    const summary = summarizeTemplateDiff(diff);
    expect(summary).toEqual({ unchanged: 1, reworded: 0, renamed: 0, added: 1, removed: 1 });
  });
});

describe("textSimilarity", () => {
  test("identical text scores 1", () => {
    expect(textSimilarity("Do you encrypt data?", "Do you encrypt data?")).toBe(1);
  });

  test("case/whitespace differences still score 1", () => {
    expect(textSimilarity("  Do You Encrypt Data? ", "do you encrypt data?")).toBe(1);
  });

  test("completely different text scores near 0", () => {
    expect(textSimilarity("Do you encrypt data at rest?", "Fire drill frequency records")).toBeLessThan(0.3);
  });

  test("empty vs non-empty scores 0", () => {
    expect(textSimilarity("", "Do you encrypt data?")).toBe(0);
  });

  test("both empty scores 1", () => {
    expect(textSimilarity("", "")).toBe(1);
  });
});
