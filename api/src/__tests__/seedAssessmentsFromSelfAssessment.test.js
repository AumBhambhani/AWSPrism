import { describe, test, expect, vi, beforeEach } from "vitest";

// The AI fallback is mocked per-test; default = "none" provider behaviour.
const aiMock = vi.fn(async () => ({ map: {} }));
vi.mock("../utils/aiProvider.js", () => ({
  mapSelfAssessmentToQuestions: (...args) => aiMock(...args),
}));

// AI provider resolution — default: enabled (null → env default), so the
// fallback path is exercised. Overridden to "none" in the opt-in test.
const providerMock = vi.fn(async () => null);
vi.mock("../utils/aiSettings.js", () => ({
  getCompanyAiProvider: (...args) => providerMock(...args),
}));

const { seedAssessmentsFromSelfAssessment } = await import("../utils/seedAssessmentsFromSelfAssessment.js");

/**
 * Minimal fake pg client. `question_framework_controls` and `questions` rows are
 * supplied per test; INSERTs are captured and honour the WHERE NOT EXISTS guard
 * against `existing` (a Set of `${questId}|${month}`).
 */
function makeClient({ submissions = [], qfc = [], questions = [], existing = new Set(), environment = null, capabilityStatuses = [] } = {}) {
  const inserted = [];
  const companyUpdates = [];
  const client = {
    inserted,
    companyUpdates,
    async query(sql, params = []) {
      if (/FROM self_assessment_submissions/.test(sql)) {
        return { rows: submissions.map(s => ({ department: s.department, answers: s.answers })) };
      }
      if (/FROM company_environment/.test(sql)) {
        return { rows: environment ? [{ answers: environment }] : [] };
      }
      if (/FROM company_capability_status/.test(sql)) {
        return { rows: capabilityStatuses.map(c => ({ capability_id: c.id, available: c.available, tool: c.tool || null })) };
      }
      if (/FROM question_framework_controls/.test(sql)) {
        return { rows: qfc.map(r => ({ quest_id: r.questId, framework_key: r.frameworkKey, control_reference: r.ref })) };
      }
      if (/FROM questions WHERE company_id/.test(sql)) {
        return {
          rows: questions.map(q => ({
            quest_id: q.questId, module_id: q.moduleId || "m", control_area: q.controlArea || null,
            iso_reference: q.isoReference || null, baseline_question: q.baselineQuestion || "",
          })),
        };
      }
      if (/INSERT INTO assessments/.test(sql)) {
        const [assessmentId, month, moduleId, questId, companyId, controlArea, answer, comment] = params;
        const key = `${questId}|${month}`;
        if (existing.has(key)) return { rowCount: 0 };
        existing.add(key);
        inserted.push({ assessmentId, month, moduleId, questId, companyId, controlArea, answer, comment });
        return { rowCount: 1 };
      }
      if (/UPDATE companies SET self_assessment_seeded_at/.test(sql)) {
        companyUpdates.push(params[0]);
        return { rowCount: 1 };
      }
      throw new Error(`unexpected query: ${sql.slice(0, 80)}`);
    },
  };
  return client;
}

beforeEach(() => {
  aiMock.mockReset();
  aiMock.mockResolvedValue({ map: {} });
  providerMock.mockReset();
  providerMock.mockResolvedValue(null);
});

describe("seedAssessmentsFromSelfAssessment", () => {
  test("no submissions → nothing seeded", async () => {
    const client = makeClient({ submissions: [] });
    const r = await seedAssessmentsFromSelfAssessment(client, 1, { scope: "framework" });
    expect(r).toEqual({ seeded: 0, resolved: 0, unresolved: [], scope: "framework" });
    expect(client.inserted).toHaveLength(0);
  });

  test("YES and PARTIAL → PARTIALLY_IMPLEMENTED, NO → NOT_IMPLEMENTED, NA skipped", async () => {
    const client = makeClient({
      submissions: [{ department: "IT", answers: { "it-15": "YES", "it-16": "PARTIAL", "it-17": "NO", "it-18": "NA" } }],
      // it-15..it-18 are all `security` domain → ISO A.8.5 etc.
      qfc: [
        { questId: "Q-AUTH", frameworkKey: "ISO27001", ref: "A.8.5" },
      ],
      questions: [
        { questId: "Q-AUTH", controlArea: "Secure authentication", baselineQuestion: "Is MFA enforced?" },
      ],
    });
    const r = await seedAssessmentsFromSelfAssessment(client, 7, { scope: "framework" });
    // it-15/16/17 all resolve to Q-AUTH via A.8.5; weakest wins → NOT_IMPLEMENTED
    expect(client.inserted).toHaveLength(1);
    expect(client.inserted[0].questId).toBe("Q-AUTH");
    expect(client.inserted[0].answer).toBe("NOT_IMPLEMENTED");
    expect(client.inserted[0].comment).toContain("answered NO");
    expect(r.seeded).toBe(1);
  });

  test("IT answers derived from a capability card seed the tracker even though they are not stored on the submission", async () => {
    const client = makeClient({
      // The IT submission carries NO it-15: MFA is answered once, on the capability card.
      submissions: [{ department: "IT", answers: { "it-16": "YES" } }],
      environment: { platforms: ["m365"], endpoints: "YES" },
      capabilityStatuses: [{ id: "cap-mfa", available: "NO" }],
      qfc: [{ questId: "Q-AUTH", frameworkKey: "ISO27001", ref: "A.8.5" }],
      questions: [{ questId: "Q-AUTH", controlArea: "Secure authentication", baselineQuestion: "Is MFA enforced?" }],
    });
    const r = await seedAssessmentsFromSelfAssessment(client, 7, { scope: "framework" });
    expect(client.inserted).toHaveLength(1);
    expect(client.inserted[0].answer).toBe("NOT_IMPLEMENTED"); // it-15 derived NO beats it-16 YES
    expect(client.inserted[0].comment).toMatch(/MFA/i);         // original question wording is kept
    expect(r.seeded).toBe(1);
  });

  test("weakest answer wins across departments", async () => {
    const client = makeClient({
      submissions: [
        { department: "IT", answers: { "it-8": "YES" } },
        { department: "Legal", answers: { "lg-3": "NO" } },
      ],
      // it-8 (consent) and lg-3 (consent) both → A.5.34
      qfc: [{ questId: "Q-PII", frameworkKey: "ISO27001", ref: "A.5.34" }],
      questions: [{ questId: "Q-PII", controlArea: "Privacy and protection of PII", baselineQuestion: "consent" }],
    });
    await seedAssessmentsFromSelfAssessment(client, 3, { scope: "framework" });
    expect(client.inserted).toHaveLength(1);
    expect(client.inserted[0].answer).toBe("NOT_IMPLEMENTED"); // lg-3 = NO beats it-8 = YES
  });

  test("existing assessment for the month is never overwritten", async () => {
    const client = makeClient({
      submissions: [{ department: "IT", answers: { "it-15": "YES" } }],
      qfc: [{ questId: "Q-AUTH", frameworkKey: "ISO27001", ref: "A.8.5" }],
      questions: [{ questId: "Q-AUTH", controlArea: "Secure authentication" }],
      existing: new Set([`Q-AUTH|${new Date().getUTCFullYear()}-${String(new Date().getUTCMonth() + 1).padStart(2, "0")}`]),
    });
    const r = await seedAssessmentsFromSelfAssessment(client, 1, { scope: "framework" });
    expect(client.inserted).toHaveLength(0);
    expect(r.seeded).toBe(0);
    expect(r.resolved).toBe(1); // it resolved, but the guard blocked the insert
  });

  test("skip:true ids (stress-test questions) are never resolved or sent to the AI fallback", async () => {
    const client = makeClient({
      submissions: [{ department: "IT", answers: { "it-32": "NO", "it-33": "NO", "it-34": "NO", "it-35": "NO" } }],
      qfc: [],
      questions: [{ questId: "Q-X", controlArea: "something", baselineQuestion: "x" }],
    });
    const r = await seedAssessmentsFromSelfAssessment(client, 1, { scope: "framework" });
    expect(client.inserted).toHaveLength(0);
    expect(r.unresolved).toEqual([]);
    expect(aiMock).not.toHaveBeenCalled();
  });

  test("static-miss ids go to the AI fallback; only catalog-valid questIds are used", async () => {
    aiMock.mockResolvedValue({ map: { "op-3": ["Q-BCP"], "op-4": ["Q-NOT-REAL"] } });
    const client = makeClient({
      submissions: [{ department: "Operations", answers: { "op-3": "NO", "op-4": "PARTIAL" } }],
      qfc: [], // nothing matches statically
      questions: [
        { questId: "Q-BCP", controlArea: "Business continuity", baselineQuestion: "Is BCP tested?" },
        { questId: "Q-OTHER", controlArea: "Unrelated", baselineQuestion: "zzz" },
      ],
    });
    const r = await seedAssessmentsFromSelfAssessment(client, 5, { scope: "framework" });
    expect(aiMock).toHaveBeenCalledOnce();
    // Q-BCP inserted (op-3=NO), Q-NOT-REAL rejected (not in catalog)
    const ids = client.inserted.map(i => i.questId);
    expect(ids).toContain("Q-BCP");
    expect(ids).not.toContain("Q-NOT-REAL");
  });

  test("AI fallback is skipped entirely when AI is not enabled for the company", async () => {
    providerMock.mockResolvedValue("none");
    const client = makeClient({
      submissions: [{ department: "Legal", answers: { "lg-4": "NO" } }],
      qfc: [],
      questions: [{ questId: "Q-ZZZ", controlArea: "Zzz", baselineQuestion: "totally unrelated wording" }],
    });
    const r = await seedAssessmentsFromSelfAssessment(client, 5, { scope: "framework" });
    expect(aiMock).not.toHaveBeenCalled();
    expect(client.inserted).toHaveLength(0);
    expect(r.unresolved).toContain("lg-4");
  });

  test("AI fallback failure is swallowed — static results still seeded", async () => {
    aiMock.mockRejectedValue(new Error("bedrock down"));
    const client = makeClient({
      submissions: [{ department: "IT", answers: { "it-15": "YES", "op-3": "NO" } }],
      qfc: [{ questId: "Q-AUTH", frameworkKey: "ISO27001", ref: "A.8.5" }],
      questions: [{ questId: "Q-AUTH", controlArea: "Secure authentication" }],
    });
    const r = await seedAssessmentsFromSelfAssessment(client, 1, { scope: "framework" });
    expect(client.inserted.map(i => i.questId)).toEqual(["Q-AUTH"]);
    expect(r.seeded).toBe(1);
  });

  test("dept scope maps answers onto dept-<slug>-qNN questions by control_area", async () => {
    const client = makeClient({
      submissions: [{ department: "HR", answers: { "hr-3": "NO" } }], // hr-3 = retention → "Data Retention"
      qfc: [],
      questions: [
        { questId: "dept-hr-q07", controlArea: "Data Retention", baselineQuestion: "retention schedule?" },
        { questId: "dept-hr-q01", controlArea: "Employee Data & Consent", baselineQuestion: "lawful basis?" },
      ],
    });
    const r = await seedAssessmentsFromSelfAssessment(client, 9, { scope: "dept" });
    expect(client.inserted.map(i => i.questId)).toEqual(["dept-hr-q07"]);
    expect(client.inserted[0].answer).toBe("NOT_IMPLEMENTED");
    expect(aiMock).not.toHaveBeenCalled(); // AI fallback is framework-scope only
  });

  test("stamps companies.self_assessment_seeded_at only when something was seeded", async () => {
    const client = makeClient({
      submissions: [{ department: "IT", answers: { "it-15": "YES" } }],
      qfc: [{ questId: "Q-AUTH", frameworkKey: "ISO27001", ref: "A.8.5" }],
      questions: [{ questId: "Q-AUTH", controlArea: "Secure authentication" }],
    });
    await seedAssessmentsFromSelfAssessment(client, 42, { scope: "framework" });
    expect(client.companyUpdates).toEqual([42]);
  });
});
