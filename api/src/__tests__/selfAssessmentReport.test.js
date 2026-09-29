import { describe, test, expect } from "vitest";
import { buildSelfAssessmentReport, buildDeptOpenItems, scoreSubmission, FALLBACK_REFERENCE } from "../utils/selfAssessmentReport.js";

function sub(department, userEmail, answers) {
  return { department, userEmail, userName: userEmail, answers, submittedAt: new Date().toISOString() };
}

describe("scoreSubmission — unchanged YES=1/PARTIAL=0.5/NO=0, NA excluded", () => {
  test("computes a percentage, excluding NA", () => {
    expect(scoreSubmission({ a: "YES", b: "NO", c: "NA" })).toBe(50);
    expect(scoreSubmission({ a: "YES", b: "PARTIAL" })).toBe(75);
    expect(scoreSubmission({})).toBeNull();
  });
});

describe("buildSelfAssessmentReport — deptRows / priorityFocus / quickWins", () => {
  const submissions = [
    sub("IT", "it@co.com", { "it-15": "NO", "it-16": "NO", "it-17": "PARTIAL", "it-18": "YES" }),
    sub("HR", "hr@co.com", { "hr-2": "NO", "hr-3": "YES" }),
    sub("Legal", "legal@co.com", { "lg-1": "PARTIAL", "lg-2": "YES" }),
  ];

  test("deptRows carries real gap/partial question text, not just counts", () => {
    const { deptRows } = buildSelfAssessmentReport({ companyName: "Acme", submissions });
    const it = deptRows.find(d => d.dept === "IT");
    expect(it.gapCount).toBe(2);
    expect(it.partialCount).toBe(1);
    expect(it.gapQuestions.map(q => q.id).sort()).toEqual(["it-15", "it-16"]);
    expect(it.gapQuestions.find(q => q.id === "it-15").text).toMatch(/MFA/i);
  });

  test("priorityFocus ranks by raw open-item volume (not score) and computes share of org-wide total", () => {
    const { priorityFocus } = buildSelfAssessmentReport({ companyName: "Acme", submissions });
    // IT has 3 open items, HR 1, Legal 1 — total 5.
    expect(priorityFocus[0].dept).toBe("IT");
    expect(priorityFocus[0].openItems).toBe(3);
    expect(priorityFocus[0].shareOfOrgWideTotal).toBe(60); // 3/5
    const hr = priorityFocus.find(d => d.dept === "HR");
    expect(hr.shareOfOrgWideTotal).toBe(20); // 1/5
  });

  test("quickWins only includes departments within 1-2 open items of 100%, excluding those already at 100%", () => {
    const { quickWins } = buildSelfAssessmentReport({ companyName: "Acme", submissions });
    const depts = quickWins.map(d => d.dept).sort();
    expect(depts).toEqual(["HR", "Legal"]);
    expect(quickWins.every(d => d.openItems <= 2)).toBe(true);
  });

  test("a department with zero open items is not a quick win", () => {
    const clean = [sub("Finance", "fi@co.com", { "fi-1": "YES", "fi-2": "YES" })];
    const { quickWins, deptRows } = buildSelfAssessmentReport({ companyName: "Acme", submissions: clean });
    expect(deptRows[0].avgScore).toBe(100);
    expect(quickWins).toEqual([]);
  });
});

describe("buildSelfAssessmentReport — data-quality notes", () => {
  test("flags a department with only NA answers as Not Assessed", () => {
    const submissions = [sub("Legal", "l@co.com", { "lg-1": "NA" })];
    const { dataQualityNotes, deptRows } = buildSelfAssessmentReport({ companyName: "Acme", submissions });
    expect(deptRows[0].avgScore).toBeNull();
    expect(dataQualityNotes.some(n => n.type === "not-assessed" && n.text.includes("Legal"))).toBe(true);
  });

  test("flags every department as single-contributor when each has exactly one submitter", () => {
    const submissions = [sub("IT", "it@co.com", { "it-15": "YES" }), sub("HR", "hr@co.com", { "hr-2": "YES" })];
    const { dataQualityNotes } = buildSelfAssessmentReport({ companyName: "Acme", submissions });
    const note = dataQualityNotes.find(n => n.type === "single-contributor");
    expect(note).toBeTruthy();
    expect(note.text).toMatch(/IT/);
    expect(note.text).toMatch(/HR/);
  });

  test("flags 3+ departments that returned an identical (score, gapCount, partialCount) signature", () => {
    const identical = (dept, email) => sub(dept, email, { "x-1": "YES", "x-2": "NO", "x-3": "YES" }); // 67%, 1 gap, 0 partial
    const submissions = [identical("Film", "a@co.com"), identical("Impact", "b@co.com"), identical("Logistics", "c@co.com")];
    const { dataQualityNotes } = buildSelfAssessmentReport({ companyName: "Acme", submissions });
    const note = dataQualityNotes.find(n => n.type === "identical-scores");
    expect(note).toBeTruthy();
    expect(note.text).toMatch(/Film/);
    expect(note.text).toMatch(/Impact/);
    expect(note.text).toMatch(/Logistics/);
  });

  test("does not flag identical scores when fewer than 3 departments share a signature", () => {
    const identical = (dept, email) => sub(dept, email, { "x-1": "YES", "x-2": "NO" });
    const submissions = [identical("Film", "a@co.com"), identical("Impact", "b@co.com")];
    const { dataQualityNotes } = buildSelfAssessmentReport({ companyName: "Acme", submissions });
    expect(dataQualityNotes.some(n => n.type === "identical-scores")).toBe(false);
  });

  test("always includes the trust-based-self-reporting disclaimer", () => {
    const submissions = [sub("IT", "it@co.com", { "it-15": "YES" })];
    const { dataQualityNotes } = buildSelfAssessmentReport({ companyName: "Acme", submissions });
    expect(dataQualityNotes.some(n => n.type === "trust-based")).toBe(true);
  });
});

describe("buildSelfAssessmentReport — regulatory exposure: AI vs. fallback", () => {
  const submissions = [sub("IT", "it@co.com", { "it-15": "NO" })];

  test("falls back to the static FALLBACK_REFERENCE table when no AI mappings are supplied", () => {
    const { regulatoryExposure, regulatoryExposureSource } = buildSelfAssessmentReport({
      companyName: "Acme", submissions, aiExposureMappings: [],
    });
    expect(regulatoryExposureSource).toBe("fallback");
    expect(regulatoryExposure.length).toBeGreaterThan(0);
    expect(regulatoryExposure.every(r => r.source === "fallback")).toBe(true);
    // Sanity: fallback rows are still built from the checked-in static table.
    expect(FALLBACK_REFERENCE.some(r => r.provision.includes("8(5)"))).toBe(true);
  });

  test("uses the AI-validated mapping when supplied, re-resolving citation text from the checked-in index", () => {
    // The mapping carries stale/wrong title+url+penalty (e.g. cached in
    // self_assessment_reports before the index was last edited). The report
    // must ignore those and re-look-up from api/src/data/legal/dpdpa-2023.json.
    const aiExposureMappings = [
      { dept: "IT", framework: "DPDPA", frameworkName: "DPDPA (stale)", provisionId: "8(5)", title: "stale title", url: "https://example.org/stale", penalty: "Up to ₹1 (stale)", rationale: "MFA is not enabled.", relatedQuestionIds: ["it-15"] },
    ];
    const { regulatoryExposure, regulatoryExposureSource } = buildSelfAssessmentReport({
      companyName: "Acme", submissions, aiExposureMappings,
    });
    expect(regulatoryExposureSource).toBe("ai");
    expect(regulatoryExposure).toHaveLength(1);
    expect(regulatoryExposure[0]).toMatchObject({ source: "ai", framework: "DPDPA 2023 (India)", provisionId: "8(5)", penalty: "Up to ₹250 crore" });
    expect(regulatoryExposure[0].url).not.toBe("https://example.org/stale");
    expect(regulatoryExposure[0].summary).not.toBe("stale title");
    // DPDPA ids get a "Sec." prefix for display; GDPR/ISO keep their own.
    expect(regulatoryExposure[0].provisionLabel).toBe("Sec. 8(5)");
    expect(regulatoryExposure[0].triggeredBy).toEqual([{ dept: "IT", rationale: "MFA is not enabled.", questionCount: 1 }]);
  });

  test("s.6 (no dedicated Schedule entry) resolves to the ₹50 crore residuary penalty via defaultPenalty", () => {
    const aiExposureMappings = [
      { dept: "IT", framework: "DPDPA", frameworkName: "DPDPA 2023 (India)", provisionId: "6", title: "Consent", url: "u", penalty: null, rationale: "no consent record", relatedQuestionIds: ["it-15"] },
    ];
    const { regulatoryExposure } = buildSelfAssessmentReport({ companyName: "Acme", submissions, aiExposureMappings });
    expect(regulatoryExposure[0].penalty).toMatch(/₹50 crore/);
    expect(regulatoryExposure[0].penalty).toMatch(/residuary/i);
  });

  test("merges duplicate (provision, department) mappings from the model into one triggeredBy entry", () => {
    const aiExposureMappings = [
      { dept: "IT", framework: "DPDPA", frameworkName: "DPDPA 2023 (India)", provisionId: "8", title: "General obligations", url: "u", penalty: null, rationale: "r1", relatedQuestionIds: ["it-15"] },
      { dept: "IT", framework: "DPDPA", frameworkName: "DPDPA 2023 (India)", provisionId: "8", title: "General obligations", url: "u", penalty: null, rationale: "r2", relatedQuestionIds: ["it-16"] },
    ];
    const { regulatoryExposure } = buildSelfAssessmentReport({ companyName: "Acme", submissions, aiExposureMappings });
    expect(regulatoryExposure).toHaveLength(1);
    expect(regulatoryExposure[0].triggeredBy).toHaveLength(1);
    expect(regulatoryExposure[0].triggeredBy[0]).toMatchObject({ dept: "IT", questionCount: 2 });
  });
});

describe("buildDeptOpenItems — feeds the AI mapping call", () => {
  test("returns each department's gap/partial question objects for departments with open items", () => {
    const submissions = [sub("IT", "it@co.com", { "it-15": "NO", "it-16": "YES" })];
    const items = buildDeptOpenItems(submissions);
    const it = items.find(d => d.dept === "IT");
    expect(it.gapQuestions).toEqual([{ id: "it-15", text: expect.stringMatching(/MFA/i) }]);
    expect(it.partialQuestions).toEqual([]);
  });
});

describe("buildSelfAssessmentReport — AI-absent invariance for the Big-4 document", () => {
  const submissions = [
    sub("IT", "it@co.com", { "it-1": "NO", "it-8": "NO", "it-12": "NO", "it-14": "YES", "it-11": "NO", "lg-6": "NO", "hr-4": "NO" }),
    sub("Legal", "lg@co.com", { "lg-2": "PARTIAL", "lg-3": "YES", "lg-5": "YES" }),
  ];
  const structuralNeedles = [
    "Cross-Department Consistency Checks",
    "Annexure G — Gap Remediation Detail",
    "Findings Register",
    "DPDPA Requirements Traceability Matrix",
    "entries reviewed",
  ];

  test("no `html` field; `text` is the concise notification, `document` is the paginated report", () => {
    const r = buildSelfAssessmentReport({ companyName: "Acme Ltd", submissions, aiExposureMappings: [], narrative: null });
    expect(r).not.toHaveProperty("html");
    expect(r.text).toMatch(/Assessment coverage:/);
    expect(r.text).toMatch(/Open it in PRISM/);
    expect(r.document).toContain("Document Control");
  });

  test.each([
    ["narrative: null", null],
    ["readiness only", { readiness: { businessContext: "ctx" }, gapContext: null }],
    ["gapContext only", { readiness: null, gapContext: { tailoring: [], contradictions: [], roadmapPhasing: [{ phase: 0, rationale: "", stepRefs: [] }, { phase: 1, rationale: "", stepRefs: [] }, { phase: 2, rationale: "", stepRefs: [] }, { phase: 3, rationale: "", stepRefs: [] }] } }],
    ["malformed blob", { garbage: true }],
  ])("renders the full document structure with %s", (_label, narrative) => {
    const r = buildSelfAssessmentReport({ companyName: "Acme Ltd", submissions, aiExposureMappings: [], narrative });
    expect(typeof r.document).toBe("string");
    for (const needle of structuralNeedles) expect(r.document).toContain(needle);
    // a fired gap's static guidance text is always present
    expect(r.document).toMatch(/Why it matters/);
  });

  test("falls back to the static PHASING prose (no per-step Phase tags) when gapContext is absent", () => {
    const r = buildSelfAssessmentReport({ companyName: "Acme Ltd", submissions, aiExposureMappings: [], narrative: null });
    expect(r.document).toContain("Phase 0 — Mobilise");
    expect(r.document).not.toContain('class="a-phase"');
  });
});
