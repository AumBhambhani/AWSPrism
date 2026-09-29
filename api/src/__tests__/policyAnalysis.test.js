import { describe, test, expect, beforeEach, vi } from "vitest";

const queryMock = vi.fn();
const analyzePolicyMock = vi.fn();

vi.mock("../db/index.js", () => ({
  query: (...args) => queryMock(...args),
  mapRow: (r) => {
    const row = r && r.rows && r.rows[0];
    if (!row) return null;
    const out = {};
    for (const [k, v] of Object.entries(row)) {
      out[k.replace(/_([a-z])/g, (_, c) => c.toUpperCase())] = v;
    }
    return out;
  },
}));

vi.mock("../utils/aiProvider.js", () => ({
  analyzePolicy: (...a) => analyzePolicyMock(...a),
}));

vi.mock("../utils/evidenceStorage.js", () => ({
  withLocalCopy: (_cid, _ref, fn) => fn("/tmp/local-copy"),
}));

const { runPolicyAnalysis, policyAnalysisFingerprint } = await import("../utils/policyAnalysis.js");

const ANALYSIS = {
  readiness: "adequate",
  summary: "Covers the basics.",
  gaps: ["No review cadence"],
  dpdpGaps: ["DPDPA s.6: consent withdrawal missing"],
  suggestions: ["Add an owner", "Add a review date"],
};

beforeEach(() => {
  queryMock.mockReset().mockResolvedValue({ rows: [] });
  analyzePolicyMock.mockReset().mockResolvedValue({ ...ANALYSIS });
});

function vaultRow(extra = {}) {
  return {
    id: 1,
    title: "Access Control Policy",
    file_name: "acp.pdf",
    storage_path: "vault/9/acp.pdf",
    ai_policy_analysis: null,
    ai_policy_fingerprint: null,
    ...extra,
  };
}

describe("policyAnalysisFingerprint", () => {
  test("is stable for identical inputs and changes with the file ref", () => {
    const a = policyAnalysisFingerprint({ storagePath: "vault/9/acp.pdf", policyName: "ACP", provider: null });
    const b = policyAnalysisFingerprint({ storagePath: "vault/9/acp.pdf", policyName: "ACP", provider: null });
    const c = policyAnalysisFingerprint({ storagePath: "vault/9/acp-v2.pdf", policyName: "ACP", provider: null });
    expect(a).toBe(b);
    expect(a).not.toBe(c);
  });

  test("changes with the policy label", () => {
    const a = policyAnalysisFingerprint({ storagePath: "x", policyName: "ACP", provider: null });
    const d = policyAnalysisFingerprint({ storagePath: "x", policyName: "Different", provider: null });
    expect(a).not.toBe(d);
  });
});

describe("runPolicyAnalysis", () => {
  test("returns the cached blob when the fingerprint matches — no Bedrock call, no write", async () => {
    const fp = policyAnalysisFingerprint({
      storagePath: "vault/9/acp.pdf", policyName: "Access Control Policy", provider: null,
    });
    queryMock.mockResolvedValueOnce({
      rows: [vaultRow({ ai_policy_analysis: ANALYSIS, ai_policy_fingerprint: fp })],
    });

    const out = await runPolicyAnalysis({ vaultId: 1, companyId: 9 });

    expect(out).toEqual({ analysis: ANALYSIS, cached: true });
    expect(analyzePolicyMock).not.toHaveBeenCalled();
    expect(queryMock).toHaveBeenCalledTimes(1); // just the SELECT
  });

  test("runs analysis and persists it when there is no cached result", async () => {
    queryMock
      .mockResolvedValueOnce({ rows: [vaultRow()] })   // SELECT
      .mockResolvedValueOnce({ rows: [] });            // UPDATE

    const out = await runPolicyAnalysis({ vaultId: 1, companyId: 9 });

    expect(out.cached).toBe(false);
    expect(out.analysis).toEqual(ANALYSIS);
    expect(analyzePolicyMock).toHaveBeenCalledWith(expect.objectContaining({
      policyName: "Access Control Policy",
      filePath: "/tmp/local-copy",
      fileExt: "pdf",
    }));

    const updateCall = queryMock.mock.calls[1];
    expect(updateCall[0]).toMatch(/UPDATE evidence_vault/);
    expect(updateCall[0]).toMatch(/ai_policy_fingerprint/);
    expect(JSON.parse(updateCall[1][0])).toEqual(ANALYSIS);
  });

  test("re-runs when force is set even though the fingerprint matches", async () => {
    const fp = policyAnalysisFingerprint({
      storagePath: "vault/9/acp.pdf", policyName: "Access Control Policy", provider: null,
    });
    queryMock
      .mockResolvedValueOnce({ rows: [vaultRow({ ai_policy_analysis: ANALYSIS, ai_policy_fingerprint: fp })] })
      .mockResolvedValueOnce({ rows: [] });

    const out = await runPolicyAnalysis({ vaultId: 1, companyId: 9, force: true });

    expect(out.cached).toBe(false);
    expect(analyzePolicyMock).toHaveBeenCalledTimes(1);
  });

  test("a custom policyName that differs from the stored label misses the cache", async () => {
    const fp = policyAnalysisFingerprint({
      storagePath: "vault/9/acp.pdf", policyName: "Access Control Policy", provider: null,
    });
    queryMock
      .mockResolvedValueOnce({ rows: [vaultRow({ ai_policy_analysis: ANALYSIS, ai_policy_fingerprint: fp })] })
      .mockResolvedValueOnce({ rows: [] });

    const out = await runPolicyAnalysis({ vaultId: 1, companyId: 9, policyName: "Renamed Policy" });

    expect(out.cached).toBe(false);
    expect(analyzePolicyMock).toHaveBeenCalledWith(expect.objectContaining({ policyName: "Renamed Policy" }));
  });

  test("throws 404 when the vault item does not exist", async () => {
    queryMock.mockResolvedValueOnce({ rows: [] });
    await expect(runPolicyAnalysis({ vaultId: 99, companyId: 9 })).rejects.toMatchObject({ status: 404 });
  });

  test("throws 400 when the vault item has no file", async () => {
    queryMock.mockResolvedValueOnce({ rows: [vaultRow({ storage_path: null })] });
    await expect(runPolicyAnalysis({ vaultId: 1, companyId: 9 })).rejects.toMatchObject({ status: 400 });
  });
});
