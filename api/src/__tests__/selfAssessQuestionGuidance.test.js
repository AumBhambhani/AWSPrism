import { describe, it, expect } from "vitest";
import { GUIDANCE, GUIDANCE_VERSION, guidanceFor, guidanceReviewCoverage } from "../utils/selfAssessQuestionGuidance.js";
import { DEPT_QUESTIONS, expandQuestions } from "../utils/deptSelfAssessQuestions.js";
import { FINDINGS } from "../data/selfAssessmentCrosswalk.js";
import { PRIVACY_DOMAINS } from "../data/selfAssessmentCrosswalk.js";

// Every question id a submission can actually carry: the base catalogue plus
// every follow-up (surfaced by expanding with all-YES answers).
function allStandardQuestionIds() {
  const ids = new Set();
  for (const base of Object.values(DEPT_QUESTIONS)) {
    const answers = Object.fromEntries(base.map(q => [q.id, "YES"]));
    for (const q of expandQuestions(base, answers)) ids.add(q.id);
  }
  return [...ids];
}

const DOMAIN_IDS = new Set(PRIVACY_DOMAINS.map(d => d.id));
const FINDING_KEYS = new Set(Object.keys(FINDINGS));
const VALID_STATUS = new Set(["ai_draft", "needs_revision", "reviewed", "approved"]);

describe("selfAssessQuestionGuidance", () => {
  it("exports a version string", () => {
    expect(typeof GUIDANCE_VERSION).toBe("string");
    expect(GUIDANCE_VERSION.length).toBeGreaterThan(0);
  });

  it("resolves valid guidance for every standard question and follow-up id", () => {
    const missing = [];
    for (const id of allStandardQuestionIds()) {
      const g = guidanceFor(id);
      if (!g) { missing.push(id); continue; }
      expect(FINDING_KEYS.has(g.findingKey), `${id} findingKey ${g.findingKey}`).toBe(true);
      expect(DOMAIN_IDS.has(g.domain), `${id} domain ${g.domain}`).toBe(true);
      expect(Number.isInteger(g.impact) && g.impact >= 1 && g.impact <= 5, `${id} impact`).toBe(true);
      expect(Number.isInteger(g.likelihood) && g.likelihood >= 1 && g.likelihood <= 5, `${id} likelihood`).toBe(true);
      expect(typeof g.whyItMatters).toBe("string");
      expect(g.whyItMatters.length).toBeGreaterThan(20);
      expect(typeof g.goodLooksLike).toBe("string");
      expect(g.goodLooksLike.length).toBeGreaterThan(20);
      expect(Array.isArray(g.remediation) && g.remediation.length > 0, `${id} remediation`).toBe(true);
      for (const step of g.remediation) {
        expect(typeof step.step).toBe("string");
        expect(["S", "M", "L"]).toContain(step.effort);
      }
      expect(Array.isArray(g.evidenceAsks) && g.evidenceAsks.length > 0, `${id} evidenceAsks`).toBe(true);
    }
    expect(missing, `no guidance for: ${missing.join(", ")}`).toEqual([]);
  });

  it("has valid literal generic-1..generic-6 fallback entries", () => {
    for (let n = 1; n <= 6; n++) {
      const g = GUIDANCE[`generic-${n}`];
      expect(g, `generic-${n} exists`).toBeTruthy();
      expect(FINDING_KEYS.has(g.findingKey)).toBe(true);
      expect(DOMAIN_IDS.has(g.domain)).toBe(true);
      expect(g.remediation.length).toBeGreaterThan(0);
    }
  });

  it("resolves a custom-department question to its generic-N entry without changing identity", () => {
    // guidanceFor maps `sales-3` -> generic-3; the caller keeps `sales-3` as the gapId.
    expect(guidanceFor("sales-3")).toBe(GUIDANCE["generic-3"]);
    expect(guidanceFor("logistics-1")).toBe(GUIDANCE["generic-1"]);
    expect(guidanceFor("nope-9")).toBeNull();
  });

  it("holds the review-metadata invariant for every entry", () => {
    for (const [id, e] of Object.entries(GUIDANCE)) {
      expect(VALID_STATUS.has(e.reviewStatus), `${id} status`).toBe(true);
      if (e.reviewStatus === "ai_draft" || e.reviewStatus === "needs_revision") {
        expect(e.reviewedAt, `${id} reviewedAt`).toBeNull();
        expect(e.reviewedBy, `${id} reviewedBy`).toBeNull();
      } else {
        expect(e.reviewedAt, `${id} reviewedAt present`).toBeTruthy();
        expect(e.reviewedBy, `${id} reviewedBy present`).toBeTruthy();
      }
    }
  });

  it("guidanceReviewCoverage totals match and approved ⊆ reviewed ⊆ total", () => {
    const c = guidanceReviewCoverage();
    expect(c.total).toBe(Object.keys(GUIDANCE).length);
    expect(c.approved).toBeLessThanOrEqual(c.reviewed);
    expect(c.reviewed).toBeLessThanOrEqual(c.total);
  });
});
