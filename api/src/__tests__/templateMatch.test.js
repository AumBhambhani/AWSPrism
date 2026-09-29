import { describe, test, expect } from "vitest";
import { scoreTemplateMatch } from "../utils/templateMatch.js";

const q = (quest_id, baseline_question) => ({ quest_id, baseline_question });

describe("scoreTemplateMatch", () => {
  test("identical question sets score 1", () => {
    const existing = [q("Q1", "Do you encrypt data at rest?"), q("Q2", "Do you run MFA?")];
    const incoming = [q("Q1", "Do you encrypt data at rest?"), q("Q2", "Do you run MFA?")];
    expect(scoreTemplateMatch(incoming, existing).score).toBe(1);
  });

  test("mostly overlapping sets score high but not 1", () => {
    const existing = [q("Q1", "Do you encrypt data at rest?"), q("Q2", "Do you run MFA?"), q("Q3", "Backup frequency?")];
    const incoming = [q("Q1", "Do you encrypt data at rest?"), q("Q2", "Do you run MFA?"), q("Q4", "New unrelated control")];
    const { score } = scoreTemplateMatch(incoming, existing);
    expect(score).toBeGreaterThan(0.5);
    expect(score).toBeLessThan(1);
  });

  test("completely unrelated sets score near 0", () => {
    const existing = [q("Q1", "Do you encrypt data at rest?")];
    const incoming = [q("X1", "Fire drill frequency records")];
    expect(scoreTemplateMatch(incoming, existing).score).toBe(0);
  });

  test("empty existing template scores 0 without throwing", () => {
    expect(scoreTemplateMatch([q("Q1", "text")], []).score).toBe(0);
  });
});
