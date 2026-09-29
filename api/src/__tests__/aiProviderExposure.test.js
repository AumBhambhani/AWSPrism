import { describe, test, expect } from "vitest";
import { validExposureMapping, mapRegulatoryExposure } from "../utils/aiProvider.js";

const deptIds = (map) => new Map(Object.entries(map).map(([dept, ids]) => [dept, new Set(ids)]));

describe("validExposureMapping — grounds every mapping against the checked-in provision index", () => {
  test("keeps a mapping whose provisionId is a real entry in the index, and attaches title/url/penalty from the index (not the model)", () => {
    const deptQuestionIds = deptIds({ IT: ["it-15", "it-16"] });
    const out = {
      mappings: [{
        dept: "IT",
        framework: "DPDPA",
        provisionId: "8(5)",
        rationale: "MFA is not enabled, which weakens reasonable security safeguards.",
        relatedQuestionIds: ["it-15"],
        // A hostile/hallucinating model might also try to smuggle its own
        // title/url/penalty through — these must never survive validation.
        title: "made up title",
        url: "https://evil.example.com/not-the-real-act",
        penalty: "Up to ₹999 crore (invented)",
      }],
    };
    const result = validExposureMapping(out, deptQuestionIds);
    expect(result).toHaveLength(1);
    expect(result[0]).toMatchObject({
      dept: "IT",
      framework: "DPDPA",
      provisionId: "8(5)",
      relatedQuestionIds: ["it-15"],
    });
    // title/url/penalty came from the checked-in index, never the model's own text.
    expect(result[0].title).not.toBe("made up title");
    expect(result[0].url).not.toBe("https://evil.example.com/not-the-real-act");
    expect(result[0].penalty).not.toBe("Up to ₹999 crore (invented)");
    expect(result[0].penalty).toBe("Up to ₹250 crore");
  });

  test("drops a mapping whose provisionId doesn't exist in the index (a hallucinated section number)", () => {
    const deptQuestionIds = deptIds({ IT: ["it-15"] });
    const out = {
      mappings: [{ dept: "IT", framework: "DPDPA", provisionId: "999(z)", rationale: "invented", relatedQuestionIds: ["it-15"] }],
    };
    expect(validExposureMapping(out, deptQuestionIds)).toEqual([]);
  });

  test("drops a mapping for an unknown framework", () => {
    const deptQuestionIds = deptIds({ IT: ["it-15"] });
    const out = {
      mappings: [{ dept: "IT", framework: "MADE_UP_LAW", provisionId: "8(5)", relatedQuestionIds: ["it-15"] }],
    };
    expect(validExposureMapping(out, deptQuestionIds)).toEqual([]);
  });

  test("drops a mapping for a department that wasn't in the request", () => {
    const deptQuestionIds = deptIds({ IT: ["it-15"] });
    const out = {
      mappings: [{ dept: "Marketing", framework: "DPDPA", provisionId: "6", relatedQuestionIds: ["it-15"] }],
    };
    expect(validExposureMapping(out, deptQuestionIds)).toEqual([]);
  });

  test("drops relatedQuestionIds that aren't real open items for that department, and drops the mapping entirely if none survive", () => {
    const deptQuestionIds = deptIds({ IT: ["it-15", "it-16"] });
    const out = {
      mappings: [
        { dept: "IT", framework: "DPDPA", provisionId: "8(5)", relatedQuestionIds: ["it-15", "not-a-real-id"] },
        { dept: "IT", framework: "DPDPA", provisionId: "6", relatedQuestionIds: ["nonexistent"] },
      ],
    };
    const result = validExposureMapping(out, deptQuestionIds);
    expect(result).toHaveLength(1);
    expect(result[0].provisionId).toBe("8(5)");
    expect(result[0].relatedQuestionIds).toEqual(["it-15"]);
  });

  test("returns [] for malformed input", () => {
    const deptQuestionIds = deptIds({ IT: ["it-15"] });
    expect(validExposureMapping(null, deptQuestionIds)).toEqual([]);
    expect(validExposureMapping({}, deptQuestionIds)).toEqual([]);
    expect(validExposureMapping({ mappings: "not an array" }, deptQuestionIds)).toEqual([]);
  });
});

describe("mapRegulatoryExposure via the 'none' provider", () => {
  test("returns an empty mapping (callers should fall back to the static reference)", async () => {
    const out = await mapRegulatoryExposure({
      provider: "none",
      departments: [{ dept: "IT", gapQuestions: [{ id: "it-15", text: "Is MFA enabled?" }], partialQuestions: [] }],
    });
    expect(out).toEqual({ mappings: [] });
  });

  test("returns an empty mapping when there are no departments", async () => {
    const out = await mapRegulatoryExposure({ provider: "none", departments: [] });
    expect(out).toEqual({ mappings: [] });
  });
});
