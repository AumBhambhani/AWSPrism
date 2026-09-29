import { describe, test, expect, beforeEach, vi } from "vitest";

const queryMock = vi.fn();
const analyzeEvidenceMock = vi.fn();

vi.mock("../db/index.js", () => ({
  query: (...args) => queryMock(...args),
  mapRow: (r) => (r && r.rows && r.rows[0]) || null,
  mapRows: (r) => (r && r.rows) || [],
}));

vi.mock("../utils/aiProvider.js", () => ({
  analyzeEvidence: (...a) => analyzeEvidenceMock(...a),
}));

vi.mock("../utils/evidenceStorage.js", () => ({
  withLocalCopy: (_cid, _ref, fn) => fn("/tmp/local-copy"),
}));

const { queueEvidenceAnalysis, _isAnalysisRunning } = await import("../utils/evidenceAnalysis.js");

const EMPTY_ANALYSIS = {
  contributorComments: "looks good",
  reviewerComments: "approve",
  gaps: [],
  suggestions: [],
  dateWarning: null,
};

// Wires the query() calls queueEvidenceAnalysis + runEvidenceAnalysis make, in order:
//   1. SELECT ai_enabled, ai_provider FROM company_settings
//   2. UPDATE evidence_vault SET ai_analysis_status = 'running'
//   3. SELECT ev.* ... FROM evidence_vault  (runEvidenceAnalysis loads the item)
//   4. UPDATE evidence_vault SET ai_* ...   (runEvidenceAnalysis persists)
function wireHappyPath({ aiEnabled = true, aiProvider = "bedrock", vaultItem = {} } = {}) {
  queryMock.mockReset();
  queryMock
    .mockResolvedValueOnce({ rows: [{ aiEnabled, aiProvider }] })
    .mockResolvedValueOnce({ rows: [] })
    .mockResolvedValueOnce({ rows: [{ id: 1, company_id: 9, title: "Policy", storage_path: null, ...vaultItem }] })
    .mockResolvedValueOnce({ rows: [{ id: 1, ai_analysis_status: null }] })
    .mockResolvedValue({ rows: [] });
}

beforeEach(() => {
  queryMock.mockReset().mockResolvedValue({ rows: [] });
  analyzeEvidenceMock.mockReset().mockResolvedValue({ ...EMPTY_ANALYSIS });
});

describe("queueEvidenceAnalysis", () => {
  test("no-ops when AI is disabled for the company — no status write, no analysis", async () => {
    queryMock.mockReset();
    queryMock.mockResolvedValueOnce({ rows: [{ aiEnabled: false, aiProvider: null }] });

    await queueEvidenceAnalysis({ vaultId: 1, companyId: 9 });

    expect(analyzeEvidenceMock).not.toHaveBeenCalled();
    // only the settings SELECT ran
    expect(queryMock).toHaveBeenCalledTimes(1);
  });

  test("marks the row 'running', analyses, and clears status on success", async () => {
    wireHappyPath();

    await queueEvidenceAnalysis({ vaultId: 1, companyId: 9 });

    const sql = queryMock.mock.calls.map((c) => c[0]);
    expect(sql[1]).toMatch(/ai_analysis_status = 'running'/);
    expect(analyzeEvidenceMock).toHaveBeenCalledOnce();
    // the persist UPDATE clears the status
    expect(sql.some((s) => /ai_analysis_status = NULL/.test(s))).toBe(true);
    // no 'failed' write
    expect(sql.some((s) => /ai_analysis_status = 'failed'/.test(s))).toBe(false);
  });

  test("sets status 'failed' when analysis throws", async () => {
    queryMock.mockReset();
    queryMock
      .mockResolvedValueOnce({ rows: [{ aiEnabled: true, aiProvider: "bedrock" }] })
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [{ id: 1, company_id: 9, storage_path: null }] })
      .mockResolvedValue({ rows: [] });
    analyzeEvidenceMock.mockRejectedValueOnce(new Error("bedrock down"));

    await queueEvidenceAnalysis({ vaultId: 1, companyId: 9 });

    const sql = queryMock.mock.calls.map((c) => c[0]);
    expect(sql.some((s) => /ai_analysis_status = 'failed'/.test(s))).toBe(true);
  });

  test("the in-process guard blocks a concurrent second run for the same vault id", async () => {
    wireHappyPath();
    let release;
    const gate = new Promise((r) => { release = () => r({ ...EMPTY_ANALYSIS }); });
    analyzeEvidenceMock.mockImplementationOnce(() => gate);

    const first = queueEvidenceAnalysis({ vaultId: 1, companyId: 9 });
    expect(_isAnalysisRunning(1)).toBe(true);

    // let the async chain advance to the (gated) analyzeEvidence call
    for (let i = 0; i < 10; i++) await Promise.resolve();
    expect(analyzeEvidenceMock).toHaveBeenCalledOnce();

    const second = queueEvidenceAnalysis({ vaultId: 1, companyId: 9 });
    expect(second).toBeUndefined();

    release();
    await first;
    expect(_isAnalysisRunning(1)).toBe(false);
    expect(analyzeEvidenceMock).toHaveBeenCalledOnce();
  });

  test("ignores calls with a missing id", async () => {
    expect(queueEvidenceAnalysis({ vaultId: null, companyId: 9 })).toBeUndefined();
    expect(queryMock).not.toHaveBeenCalled();
  });
});
