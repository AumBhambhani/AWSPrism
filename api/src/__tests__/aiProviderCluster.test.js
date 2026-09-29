import { describe, test, expect } from "vitest";
import { clusterQuestions, deterministicCluster, validClusterResponse } from "../utils/aiProvider.js";

const facetRows = (fw, area, ref, ids = ["a", "b", "c"]) => [
  { tempId: ids[0], frameworkKey: fw, controlArea: area, controlReference: ref, facet: "IMPLEMENTED",
    question: `Is ${area} implemented, documented, and assigned to an accountable owner?`, level3: "short" },
  { tempId: ids[1], frameworkKey: fw, controlArea: area, controlReference: ref, facet: "EVIDENCE",
    question: `Can the organization provide current, dated evidence demonstrating operation of ${area}?`, level3: "a longer level 3 criteria string" },
  { tempId: ids[2], frameworkKey: fw, controlArea: area, controlReference: ref, facet: "REVIEWED",
    question: `Is ${area} periodically reviewed or tested?`, level3: "" },
];

describe("deterministicCluster", () => {
  test("collapses the 3 facet rows of one control into a single NEW_CANONICAL cluster", () => {
    const { clusters } = deterministicCluster({
      incoming: facetRows("GDPR", "Accountability framework", "Art. 5(2)"),
      existing: [],
    });
    expect(clusters).toHaveLength(1);
    expect(clusters[0].action).toBe("NEW_CANONICAL");
    expect(clusters[0].memberTempIds.sort()).toEqual(["a", "b", "c"]);
    expect(clusters[0].canonicalQuestion).toMatch(/Accountability framework/);
    expect(clusters[0].level3).toBe("a longer level 3 criteria string");
    expect(clusters[0].matchMethod).toBe("fingerprint");
  });

  test("merges an identical control from a second framework into the existing canonical", () => {
    const { clusters } = deterministicCluster({
      incoming: facetRows("SOC2", "Accountability framework", "CC1.1", ["x", "y", "z"]),
      existing: [
        { questId: "CANON-1", controlArea: "Accountability framework",
          question: "Is accountability governed?", frameworks: [{ key: "GDPR", ref: "Art. 5(2)" }] },
      ],
    });
    expect(clusters).toHaveLength(1);
    expect(clusters[0].action).toBe("MERGE_INTO_EXISTING");
    expect(clusters[0].existingQuestId).toBe("CANON-1");
    expect(clusters[0].confidence).toBeGreaterThanOrEqual(0.9);
  });

  test("keeps genuinely different controls in separate clusters", () => {
    const { clusters } = deterministicCluster({
      incoming: [
        ...facetRows("GDPR", "Accountability framework", "Art. 5(2)", ["a", "b", "c"]),
        ...facetRows("GDPR", "Data breach notification", "Art. 33", ["d", "e", "f"]),
      ],
      existing: [],
    });
    expect(clusters).toHaveLength(2);
    const areas = clusters.map(c => c.canonicalQuestion);
    expect(areas.some(q => /Accountability framework/.test(q))).toBe(true);
    expect(areas.some(q => /Data breach notification/.test(q))).toBe(true);
  });
});

describe("validClusterResponse guard", () => {
  test("rejects a whole chunk dumped into one bucket", () => {
    const out = { clusters: [{ memberTempIds: ["a", "b", "c", "d", "e"], action: "NEW_CANONICAL" }] };
    expect(validClusterResponse(out, 5)).toBeNull();
  });
  test("rejects an oversized cluster", () => {
    const out = { clusters: [
      { memberTempIds: ["a", "b", "c"] },
      { memberTempIds: ["d", "e", "f", "g", "h", "i", "j"] },
    ] };
    expect(validClusterResponse(out, 10)).toBeNull();
  });
  test("accepts a sane response", () => {
    const out = { clusters: [{ memberTempIds: ["a", "b", "c"] }, { memberTempIds: ["d", "e"] }] };
    expect(validClusterResponse(out, 5)).toBe(out);
  });
  test("rejects empty / malformed", () => {
    expect(validClusterResponse(null, 3)).toBeNull();
    expect(validClusterResponse({ clusters: [] }, 3)).toBeNull();
  });
});

describe("clusterQuestions via the 'none' provider", () => {
  test("falls back to the deterministic clusterer", async () => {
    const out = await clusterQuestions({
      provider: "none",
      incoming: facetRows("HIPAA", "Security Management Process", "164.308(a)(1)"),
      existing: [],
    });
    expect(out.clusters).toHaveLength(1);
    expect(out.clusters[0].action).toBe("NEW_CANONICAL");
    expect(out.clusters[0].matchMethod).toBe("fingerprint");
  });

  test("empty incoming yields no clusters", async () => {
    const out = await clusterQuestions({ provider: "none", incoming: [], existing: [] });
    expect(out.clusters).toEqual([]);
  });
});
