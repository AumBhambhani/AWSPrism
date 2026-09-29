import { describe, it, expect } from "vitest";
import { buildSelfAssessmentReport } from "../utils/selfAssessmentReport.js";
import { buildReadinessAssessment } from "../utils/readinessAssessment.js";

function sub(department, userEmail, answers) {
  return { department, userEmail, userName: userEmail, answers, submittedAt: new Date().toISOString() };
}

const submissions = [
  sub("IT", "it@co.com", { "it-1": "NO", "it-8": "PARTIAL", "it-15": "YES", "it-28": "NO" }),
  sub("Legal", "legal@co.com", { "lg-6": "NO", "lg-5": "PARTIAL" }),
];

const capabilityInput = {
  environment: { platforms: ["m365", "azure"], endpoints: "YES", publicWeb: "YES", unstructured: "YES", legacyApps: "YES", privileged: "NO" },
  statuses: {
    "cap-mfa": { available: "YES", tool: "Microsoft Entra ID" },
    "cap-dlp": { available: "PARTIAL", tool: "Microsoft Purview" },
    "cap-waf": { available: "NO" },
    "cap-edr": { available: "UNKNOWN" },
  },
};

describe("readiness assessment with capability input", () => {
  it("is unchanged when no capability input is given", () => {
    const a = buildReadinessAssessment(submissions);
    expect(a.capability).toBeNull();
    expect(a.gaps.every(g => !g.capability)).toBe(true);
    expect(a.limitationNotes.join(" ")).not.toMatch(/environment profile/i);
    // identical to passing an empty environment (treated as "not answered")
    const b = buildReadinessAssessment(submissions, { environment: {}, statuses: {} });
    expect(b.capability).toBeNull();
    expect(b.gaps.map(g => g.gapId)).toEqual(a.gaps.map(g => g.gapId));
    expect(b.findings.map(f => f.key)).toEqual(a.findings.map(f => f.key));
  });

  it("merges capability gaps into the same worst-first gaps list and findings register", () => {
    const base = buildReadinessAssessment(submissions);
    const a = buildReadinessAssessment(submissions, capabilityInput);
    expect(a.capability.gaps.map(g => g.gapId).sort()).toEqual(["cap-dlp", "cap-edr", "cap-waf"]);
    // +3 capability gaps, −1: raw it-8 (PARTIAL) is overridden to NA, because the environment says no consent is collected
    expect(a.gaps.length).toBe(base.gaps.length + 3 - 1);
    // worst-first ordering is preserved across the merged list
    for (let i = 1; i < a.gaps.length; i++) expect(a.gaps[i - 1].score).toBeGreaterThanOrEqual(a.gaps[i].score);
    const keys = a.findings.map(f => f.key);
    expect(keys).toContain("cap-appsec");        // WAF
    expect(keys).toContain("cap-data-protection"); // DLP
    expect(keys).toContain("cap-endpoint");      // EDR unknown
    expect(a.findings.find(f => f.key === "cap-appsec").memberGapIds).toContain("cap-waf");
    expect(a.gaps.some(g => g.gapId === "it-8")).toBe(false);
  });

  it("capability answers move the security-domain maturity and add a limitation + key finding", () => {
    const base = buildReadinessAssessment(submissions);
    const a = buildReadinessAssessment(submissions, capabilityInput);
    const sec = (x) => x.maturity.domains.find(d => d.id === "security");
    expect(sec(base).assessed).toBe(true);
    expect(sec(a).basis).toMatch(/capabilit/);
    expect(a.limitationNotes.join(" ")).toMatch(/environment profile/i);
    expect(a.keyFindings.join(" ")).toMatch(/Microsoft-led, legacy-heavy/);
  });
});

describe("buildSelfAssessmentReport with capability input", () => {
  it("renders the environment/capability section and Annexure H only when environment answers exist", () => {
    const without = buildSelfAssessmentReport({ companyName: "Acme", submissions });
    expect(without.capability).toBeNull();
    expect(without.document).not.toMatch(/Environment Profile &amp; Security Capability Assessment/);
    expect(without.document).not.toMatch(/Annexure H/);

    const withCap = buildSelfAssessmentReport({ companyName: "Acme", submissions, capabilityInput });
    expect(withCap.document).toMatch(/Environment Profile &amp; Security Capability Assessment/);
    expect(withCap.document).toMatch(/Annexure H — Environment &amp; Capability Responses/);
    expect(withCap.document).toMatch(/Microsoft-led, legacy-heavy/);
    expect(withCap.text).toMatch(/Security capability coverage/);
  });

  it("leaves every existing section's number unchanged; the capability section slots in before the Conclusion", () => {
    const headings = (doc) => [...doc.matchAll(/<h2>(\d+)&nbsp;&nbsp;([^<]*)<\/h2>/g)].map(m => `${m[1]} ${m[2]}`);
    const before = headings(buildSelfAssessmentReport({ companyName: "Acme", submissions }).document);
    const after = headings(buildSelfAssessmentReport({ companyName: "Acme", submissions, capabilityInput }).document);
    expect(before).toHaveLength(14);
    expect(after).toHaveLength(15);
    // everything before the Conclusion is identical, number for number
    expect(after.slice(0, 13)).toEqual(before.slice(0, 13));
    expect(after[13]).toMatch(/^14 Environment Profile/);
    expect(after[14]).toMatch(/^15 Conclusion/);
    expect(before[13]).toMatch(/^14 Conclusion/);
  });

  it("Annexure G carries a capability block with tools and a no-new-tool note for a native partial", () => {
    const doc = buildSelfAssessmentReport({ companyName: "Acme", submissions, capabilityInput }).document;
    expect(doc).toMatch(/cap-waf — Web application firewall \(WAF\)/);
    expect(doc).toMatch(/Missing capability/);
    expect(doc).toMatch(/Extend Microsoft Purview to the uncovered scope — no new tool is required/);
    expect(doc).toMatch(/Suggested tools\./);
    expect(doc).toMatch(/Azure Front Door WAF \(native to your environment\)/);
  });

  it("escapes user-supplied tool names in the document", () => {
    const doc = buildSelfAssessmentReport({
      companyName: "Acme", submissions,
      capabilityInput: { ...capabilityInput, statuses: { ...capabilityInput.statuses, "cap-dlp": { available: "PARTIAL", tool: "<img src=x onerror=alert(1)>" } } },
    }).document;
    expect(doc).not.toMatch(/<img src=x onerror/);
    expect(doc).toMatch(/&lt;img src=x onerror=alert\(1\)&gt;/);
  });
});

describe("one answer, counted once (capability card ↔ derived IT question)", () => {
  const env = { platforms: ["m365"], endpoints: "YES", multiApps: "YES" };
  // IT is answered ONLY for its own privacy questions; MFA comes from the card.
  const subs = [sub("IT", "it@co.com", { "it-1": "YES", "it-16": "YES" })];
  const input = { environment: env, statuses: { "cap-mfa": { available: "NO", tool: null } } };

  it("a card answered No raises exactly one gap (the card), not also the IT question", () => {
    const a = buildReadinessAssessment(subs, input);
    const mfaGaps = a.gaps.filter(g => g.gapId === "cap-mfa" || g.gapId === "it-15");
    expect(mfaGaps.map(g => g.gapId)).toEqual(["cap-mfa"]);
  });

  it("…but the derived IT answer still feeds the DPDPA traceability matrix, the IT score and the dept counts", () => {
    const a = buildReadinessAssessment(subs, input);
    const s85 = a.traceability.rows.find(r => r.section === "s.8(5)");
    expect(s85.status).toBe("Non-compliant"); // it-15 (derived NO) is a trigger for s.8(5)
    const report = buildSelfAssessmentReport({ companyName: "Acme", submissions: subs, capabilityInput: input });
    const it = report.deptRows.find(d => d.dept === "IT");
    expect(it.gapQuestions.map(q => q.id)).toContain("it-15");
    expect(it.gapQuestions.find(q => q.id === "it-15").text).toMatch(/MFA/i); // original wording preserved
  });

  it("cross-department consistency rules still fire on derived answers", () => {
    // Legal claims all DPAs are in place (lg-5 YES); the vendor-risk card says NO → derived it-26 NO.
    const s = [sub("Legal", "l@co.com", { "lg-5": "YES" }), sub("IT", "it@co.com", { "it-1": "YES" })];
    const a = buildReadinessAssessment(s, { environment: { vendors: "YES" }, statuses: { "cap-tprm": { available: "NO" } } });
    expect(a.contradictions.map(c => c.id)).toContain("dpa-claim-without-register");
  });

  it("the derived answers are listed in Annexure E, flagged as derived from the card", () => {
    const doc = buildSelfAssessmentReport({ companyName: "Acme", submissions: subs, capabilityInput: input }).document;
    expect(doc).toMatch(/Derived from the capability answer “Multi-factor authentication”/);
  });

  it("with no environment answers, nothing is derived and the IT answers are exactly what was submitted", () => {
    const raw = [sub("IT", "it@co.com", { "it-15": "NO" })];
    const a = buildReadinessAssessment(raw, null);
    expect(a.gaps.map(g => g.gapId)).toEqual(["it-15"]);
  });
});

describe("report display: department ID capitalisation and order", () => {
  const subs = [
    sub("Legal", "l@co.com", { "lg-6": "NO" }),
    sub("Admin", "a@co.com", { "Admin-1": "NO" }),        // custom department — id casing is whatever the collaborator typed
    sub("HR", "hr@co.com", { "hr-1": "YES", "hr-1a": "NO", "hr-2": "PARTIAL" }),
    sub("IT", "it@co.com", { "it-1": "NO", "it-16": "YES" }),
  ];

  it("Annexure E uppercases only the built-in department prefix, digits and follow-up letters untouched", () => {
    const doc = buildSelfAssessmentReport({ companyName: "Acme", submissions: subs }).document;
    expect(doc).toMatch(/<td class="nowrap">IT-1<\/td>/);
    expect(doc).toMatch(/<td class="nowrap">HR-2<\/td>/);
    expect(doc).toMatch(/<td class="nowrap">HR-1a<\/td>/);   // trailing follow-up letter stays lowercase
    expect(doc).toMatch(/<td class="nowrap">LG-6<\/td>/);
    expect(doc).not.toMatch(/>it-1</);
    expect(doc).not.toMatch(/>hr-2</);
  });

  it("a custom department's id is left exactly as the collaborator typed it", () => {
    const doc = buildSelfAssessmentReport({ companyName: "Acme", submissions: subs }).document;
    expect(doc).toMatch(/<td class="nowrap">Admin-1<\/td>/);
  });

  it("Annexure E lists IT first, then HR, then the rest in their submitted order", () => {
    const doc = buildSelfAssessmentReport({ companyName: "Acme", submissions: subs }).document;
    const order = [...doc.matchAll(/<h3>(IT|HR|Legal|Admin)<\/h3>/g)].map(m => m[1]);
    expect(order).toEqual(["IT", "HR", "Legal", "Admin"]);
  });

  it("a company with no IT or HR submission yet still renders (no phantom department)", () => {
    const doc = buildSelfAssessmentReport({ companyName: "Acme", submissions: [sub("Legal", "l@co.com", { "lg-6": "NO" })] }).document;
    const order = [...doc.matchAll(/<h3>([^<]*)<\/h3>/g)].map(m => m[1]).filter(h => h === "Legal" || h === "IT" || h === "HR");
    expect(order).toEqual(["Legal"]);
  });

  it("gap ids in the Findings Register and Annexure G headings are capitalised the same way, capability ids are untouched", () => {
    const doc = buildSelfAssessmentReport({ companyName: "Acme", submissions: subs, capabilityInput }).document;
    expect(doc).toMatch(/Gaps: IT-1 — see Annexure G/);
    expect(doc).toMatch(/<h3>IT-1 —/);
    expect(doc).toMatch(/<h3>cap-waf —/); // capability ids are not department ids — left as-is
  });

  it("cross-department consistency rows show capitalised ids (both the fired-gap link and the plain source ref)", () => {
    const s = [sub("Legal", "l@co.com", { "lg-5": "YES" }), sub("IT", "it@co.com", { "it-26": "NO" })];
    const doc = buildSelfAssessmentReport({ companyName: "Acme", submissions: s }).document;
    expect(doc).toMatch(/IT-26 → Annexure G/);   // it-26 is itself a fired gap — linked, not repeated as "= NO"
    expect(doc).toMatch(/LG-5 = YES \(Legal\)/); // lg-5 is not a gap (YES) — shown as a plain source ref
  });
});

describe("free-text id mentions in AI-authored prose are capitalised too", () => {
  const subs = [sub("IT", "it@co.com", { "it-1": "NO" })];

  it("a literal id inside a single-gap \"In your context\" sentence is capitalised", () => {
    const narrative = { readiness: null, gapContext: { tailoring: [{ gapId: "it-1", sentence: "This overlaps with hr-2 in practice." }], contradictions: [], roadmapPhasing: [] } };
    const doc = buildSelfAssessmentReport({ companyName: "Acme", submissions: subs, narrative }).document;
    expect(doc).toMatch(/In your context\.<\/strong> <em>This overlaps with HR-2 in practice\.<\/em>/);
  });

  it("a literal id inside roadmap-phasing rationale is capitalised", () => {
    const narrative = { readiness: null, gapContext: { tailoring: [], contradictions: [], roadmapPhasing: [
      { phase: 0, rationale: "Start here because of it-1.", stepRefs: [{ gapId: "it-1", stepIndex: 0 }] },
      { phase: 1, rationale: "", stepRefs: [] }, { phase: 2, rationale: "", stepRefs: [] }, { phase: 3, rationale: "", stepRefs: [] },
    ] } };
    const doc = buildSelfAssessmentReport({ companyName: "Acme", submissions: subs, narrative }).document;
    expect(doc).toMatch(/<em>Start here because of IT-1\.<\/em>/);
  });

  it("multi-member custom-department tailoring renders real <em> markup (not escaped) and capitalises within", () => {
    const custom = [sub("Sales", "s@co.com", { "Sales-4": "NO" }), sub("Ops2", "o@co.com", { "Ops2-4": "NO" })];
    const narrative = { readiness: null, gapContext: {
      tailoring: [{ gapId: "Sales-4", sentence: "See also it-1 here." }, { gapId: "Ops2-4", sentence: "Ties to hr-2 as well." }],
      contradictions: [], roadmapPhasing: [],
    } };
    const doc = buildSelfAssessmentReport({ companyName: "Acme", submissions: custom, narrative }).document;
    expect(doc).toMatch(/<li><em>Sales:<\/em> See also IT-1 here\.<\/li>/);
    expect(doc).toMatch(/<li><em>Ops2:<\/em> Ties to HR-2 as well\.<\/li>/);
    expect(doc).not.toMatch(/&lt;em&gt;/); // the old bug: ul() re-escaping already-built <em> markup
  });
});

describe("Annexure H — environment answer cell does not overlap the next column", () => {
  const multiPlatformInput = { environment: { platforms: ["m365", "azure", "aws", "gcp"], endpoints: "YES" }, statuses: {} };

  it("the multi-select platforms answer is not marked nowrap (which would overflow its fixed-width column)", () => {
    const doc = buildSelfAssessmentReport({ companyName: "Acme", submissions, capabilityInput: multiPlatformInput }).document;
    const row = doc.match(/<tr><td class="nowrap">env-1<\/td>.*?<\/tr>/s)[0];
    // the ID cell is legitimately nowrap; the Answer cell (the long comma list) must not be
    const cells = [...row.matchAll(/<td[^>]*>/g)].map(m => m[0]);
    expect(cells[0]).toContain("nowrap");   // ID
    expect(cells[2]).not.toContain("nowrap"); // Answer
    expect(row).toContain("Microsoft 365, Microsoft Azure, AWS, Google Cloud / Workspace");
  });

  it("a single yes/no environment answer still renders as a coloured badge", () => {
    const doc = buildSelfAssessmentReport({ companyName: "Acme", submissions, capabilityInput: multiPlatformInput }).document;
    expect(doc).toMatch(/<tr><td class="nowrap">env-2<\/td>.*?<span class="a-yes" style="color:#15803D;font-weight:700;">Yes<\/span>/s);
  });
});
