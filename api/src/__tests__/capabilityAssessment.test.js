import { describe, it, expect } from "vitest";
import { CAPABILITIES, CAPABILITY_AREAS, capabilityGuidanceFor } from "../data/capabilityLibrary.js";
import { ENVIRONMENT_QUESTIONS, ENVIRONMENT_KEYS, normaliseEnvironment } from "../data/environmentQuestions.js";
import { FINDINGS, PRIVACY_DOMAINS, WORKSTREAMS } from "../data/selfAssessmentCrosswalk.js";
import { guidanceFor } from "../utils/selfAssessQuestionGuidance.js";
import {
  classifyEnvironment, deriveApplicability, deriveCapabilityGaps, buildCapabilityAssessment,
  capabilityMaturityContributions, deriveITAnswers, applyCapabilityDerivation,
} from "../utils/capabilityAssessment.js";
import { IT_DERIVED_QUESTIONS } from "../data/itCapabilityMap.js";
import { getCapability } from "../data/capabilityLibrary.js";

const DOMAIN_IDS = new Set(PRIVACY_DOMAINS.map(d => d.id));
const VALID_STATUS = new Set(["ai_draft", "needs_revision", "reviewed", "approved"]);
const level = (env, id) => deriveApplicability(env).find(a => a.id === id).level;

describe("capabilityLibrary", () => {
  it("has a unique id per capability and a known area", () => {
    const ids = CAPABILITIES.map(c => c.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const c of CAPABILITIES) expect(CAPABILITY_AREAS).toContain(c.area);
  });

  it("every capability has valid guidance wired to a real finding and domain", () => {
    for (const c of CAPABILITIES) {
      const g = c.guidance;
      expect(FINDINGS[g.findingKey], `${c.id} findingKey ${g.findingKey}`).toBeTruthy();
      expect(DOMAIN_IDS.has(g.domain), `${c.id} domain ${g.domain}`).toBe(true);
      expect(g.impact >= 1 && g.impact <= 5 && Number.isInteger(g.impact)).toBe(true);
      expect(g.likelihood >= 1 && g.likelihood <= 5 && Number.isInteger(g.likelihood)).toBe(true);
      expect(g.whyItMatters.length).toBeGreaterThan(20);
      expect(g.goodLooksLike.length).toBeGreaterThan(20);
      expect(g.remediation.length).toBeGreaterThan(0);
      for (const r of g.remediation) { expect(r.step.length).toBeGreaterThan(5); expect(["S", "M", "L"]).toContain(r.effort); }
      expect(g.evidenceAsks.length).toBeGreaterThan(0);
    }
  });

  it("every capability lists vendor-neutral tools; a native list may be empty where no native tool genuinely fits", () => {
    for (const c of CAPABILITIES) {
      expect(c.tools.other?.length, `${c.id} tools.other`).toBeGreaterThan(0);
      for (const key of ["microsoft", "aws", "gcp"]) expect(Array.isArray(c.tools[key]), `${c.id} tools.${key}`).toBe(true);
    }
  });

  it("a platform's native list only contains that vendor's own products", () => {
    const foreign = {
      microsoft: /Amazon|AWS|Google|GCP/,
      aws: /Microsoft|Purview|Entra|Intune|Defender|Azure|Google|GCP|CrowdStrike|Jamf|Workspace ONE/,
      gcp: /Microsoft|Purview|Entra|Intune|Defender|Azure|Amazon|AWS|CrowdStrike|Jamf/,
    };
    for (const c of CAPABILITIES) for (const k of Object.keys(foreign)) for (const t of c.tools[k]) {
      expect(foreign[k].test(t), `${c.id} [${k}] "${t}" names another vendor`).toBe(false);
    }
  });

  it("Purview is only suggested where it is a genuine fit (discovery, DLP, retention)", () => {
    const withPurview = CAPABILITIES.filter(c => JSON.stringify(c.tools).includes("Purview")).map(c => c.id).sort();
    expect(withPurview).toEqual(["cap-data-discovery", "cap-dlp", "cap-retention-deletion"]);
  });

  it("every applicability rule refers to a real environment key and level", () => {
    const keys = new Set(ENVIRONMENT_KEYS);
    for (const c of CAPABILITIES) {
      expect(c.rules.length).toBeGreaterThan(0);
      for (const r of c.rules) {
        expect(["mandatory", "recommended"]).toContain(r.level);
        expect(r.reason.length).toBeGreaterThan(10);
        for (const cl of r.when) expect(keys.has(cl.key), `${c.id} clause key ${cl.key}`).toBe(true);
      }
    }
  });

  it("review metadata obeys the ai_draft invariant", () => {
    for (const c of CAPABILITIES) {
      const g = capabilityGuidanceFor(c.id);
      expect(VALID_STATUS.has(g.reviewStatus)).toBe(true);
      if (g.reviewStatus === "ai_draft" || g.reviewStatus === "needs_revision") {
        expect(g.reviewedAt).toBeNull();
        expect(g.reviewedBy).toBeNull();
      }
    }
  });

  it("every capability finding key is placed in a workstream", () => {
    const placed = new Set(WORKSTREAMS.flatMap(w => w.findingKeys));
    for (const key of new Set(CAPABILITIES.map(c => c.guidance.findingKey))) {
      expect(placed.has(key), `${key} not in any workstream`).toBe(true);
    }
  });

  it("guidanceFor resolves cap-* ids through the library, and unknown ids to null", () => {
    expect(guidanceFor("cap-waf").findingKey).toBe("cap-appsec");
    expect(guidanceFor("cap-nope")).toBeNull();
  });

  it("no capability guidance authors a provision id, URL or penalty", () => {
    const text = JSON.stringify(CAPABILITIES.map(c => c.guidance));
    expect(text).not.toMatch(/https?:\/\//);
    expect(text).not.toMatch(/₹\s?\d|crore/i);
  });
});

describe("environment questions", () => {
  it("has 20 fact questions with unique ids and keys, and none that ask whether a control exists", () => {
    expect(ENVIRONMENT_QUESTIONS).toHaveLength(20);
    expect(new Set(ENVIRONMENT_QUESTIONS.map(q => q.id)).size).toBe(20);
    expect(new Set(ENVIRONMENT_KEYS).size).toBe(20);
    // state questions live on the capability cards now — never asked twice
    for (const k of ["centralMonitoring", "irProcess", "retentionDefined", "canDelete", "cmdb"]) expect(ENVIRONMENT_KEYS).not.toContain(k);
  });

  it("normaliseEnvironment keeps valid answers, drops unknown keys and rejects bad values", () => {
    expect(normaliseEnvironment({ platforms: ["m365", "m365"], mobile: "YES", bogus: "YES" }))
      .toEqual({ ok: true, value: { platforms: ["m365"], mobile: "YES" } });
    expect(normaliseEnvironment({ mobile: "MAYBE" }).ok).toBe(false);
    expect(normaliseEnvironment({ platforms: ["mainframe"] }).ok).toBe(false);
    expect(normaliseEnvironment(null).ok).toBe(false);
  });
});

describe("applicability rules", () => {
  it("public portal → WAF, vulnerability management mandatory", () => {
    const env = { platforms: ["aws"], publicWeb: "YES" };
    expect(level(env, "cap-waf")).toBe("mandatory");
    expect(level(env, "cap-patch-vuln")).toBe("mandatory");
  });

  it("no public site → WAF not applicable; no customer login → CIAM not applicable", () => {
    const env = { platforms: ["aws"], publicWeb: "NO", externalLogins: "NO" };
    expect(level(env, "cap-waf")).toBe("na");
    expect(level(env, "cap-ciam")).toBe("na");
  });

  it("APIs → API security; custom apps → AppSec; privileged users → PAM", () => {
    expect(level({ apis: "YES" }, "cap-api-security")).toBe("mandatory");
    expect(level({ customApps: "YES" }, "cap-appsec")).toBe("mandatory");
    expect(level({ privileged: "YES" }, "cap-pam")).toBe("mandatory");
    expect(level({ privileged: "NO" }, "cap-pam")).toBe("na");
  });

  it("endpoints and mobile drive device management / EDR / encryption", () => {
    expect(level({ endpoints: "YES" }, "cap-edr")).toBe("mandatory");
    expect(level({ endpoints: "YES" }, "cap-disk-encryption")).toBe("mandatory");
    expect(level({ mobile: "YES" }, "cap-device-management")).toBe("mandatory");
    expect(level({ mobile: "YES", endpoints: "NO" }, "cap-edr")).toBe("recommended");
    expect(level({ endpoints: "NO", mobile: "NO" }, "cap-device-management")).toBe("na");
  });

  it("the highest matching rule wins (HRMS alone is only recommended; multiple apps makes lifecycle mandatory)", () => {
    expect(level({ hrms: "YES" }, "cap-identity-lifecycle")).toBe("recommended");
    expect(level({ hrms: "YES", multiApps: "YES" }, "cap-identity-lifecycle")).toBe("mandatory");
  });

  it("legacy applications or EOL systems → compensating controls mandatory", () => {
    expect(level({ legacyApps: "YES" }, "cap-legacy-compensating")).toBe("mandatory");
    expect(level({ eolSystems: "YES" }, "cap-legacy-compensating")).toBe("mandatory");
    expect(level({ legacyApps: "NO", eolSystems: "NO" }, "cap-legacy-compensating")).toBe("na");
  });

  it("cloud platforms → posture management; on-prem only → not applicable", () => {
    expect(level({ platforms: ["azure"] }, "cap-cloud-posture")).toBe("mandatory");
    expect(level({ platforms: ["onprem"] }, "cap-cloud-posture")).toBe("na");
  });

  it("baseline capabilities (MFA, SIEM, IR, retention, asset inventory) apply to every environment", () => {
    for (const id of ["cap-mfa", "cap-siem", "cap-incident-response", "cap-retention-deletion", "cap-asset-inventory", "cap-patch-vuln"]) {
      expect(level({}, id), id).toBe("mandatory");
    }
  });
});

describe("environment classification and tool ordering", () => {
  it("Microsoft-led estate lists Microsoft-native tools first", () => {
    const env = { platforms: ["m365", "azure"], unstructured: "YES" };
    expect(classifyEnvironment(env).ecosystem).toBe("microsoft");
    const dlp = deriveApplicability(env).find(a => a.id === "cap-dlp");
    expect(dlp.suggestedTools[0]).toEqual({ tool: "Microsoft Purview DLP + Information Protection", native: true });
    expect(dlp.suggestedTools.some(t => t.tool === "Forcepoint" && !t.native)).toBe(true);
  });

  it("AWS estate lists AWS-native tools first; mixed estate is flagged mixed", () => {
    expect(classifyEnvironment({ platforms: ["aws"] }).ecosystem).toBe("aws");
    const waf = deriveApplicability({ platforms: ["aws"], publicWeb: "YES" }).find(a => a.id === "cap-waf");
    expect(waf.suggestedTools[0].tool).toMatch(/AWS WAF/);
    expect(classifyEnvironment({ platforms: ["aws", "azure"] }).ecosystem).toBe("mixed");
  });

  it("legacy / EOL adds the legacy-heavy tag", () => {
    const c = classifyEnvironment({ platforms: ["m365"], legacyApps: "YES" });
    expect(c.tags).toContain("legacy-heavy");
    expect(c.label).toBe("Microsoft-led, legacy-heavy");
  });
});

describe("capability gaps", () => {
  const env = { platforms: ["m365", "azure"], endpoints: "YES", unstructured: "YES", publicWeb: "YES" };

  it("Purview reported as Partial → extend it, no new tool", () => {
    const [gap] = deriveCapabilityGaps(env, { "cap-dlp": { available: "PARTIAL", tool: "Microsoft Purview" } });
    expect(gap.gapId).toBe("cap-dlp");
    expect(gap.capability.gapType).toBe("Partial coverage");
    expect(gap.capability.newToolRequired).toBe(false);
    expect(gap.capability.note).toMatch(/Extend Microsoft Purview/);
  });

  it("No WAF on an AWS estate with a public portal → missing, new tool required, AWS WAF suggested", () => {
    const [gap] = deriveCapabilityGaps({ platforms: ["aws"], publicWeb: "YES" }, { "cap-waf": { available: "NO" } });
    expect(gap.capability.gapType).toBe("Missing capability");
    expect(gap.capability.newToolRequired).toBe(true);
    expect(gap.capability.suggestedTools[0].tool).toMatch(/AWS WAF/);
    expect(gap.worstAnswer).toBe("NO");
  });

  it("YES, unanswered and not-applicable capabilities raise no gap", () => {
    const gaps = deriveCapabilityGaps({ platforms: ["aws"], publicWeb: "NO" }, {
      "cap-mfa": { available: "YES" },
      "cap-waf": { available: "NO" }, // WAF not applicable when there is no public web app
    });
    expect(gaps).toEqual([]);
  });

  it("UNKNOWN is a gap with reduced likelihood; a PARTIAL/UNKNOWN never outranks a NO", () => {
    const st = (a) => deriveCapabilityGaps({ publicWeb: "YES" }, { "cap-waf": { available: a } })[0];
    expect(st("NO").likelihood).toBe(3);
    expect(st("PARTIAL").likelihood).toBe(2);
    expect(st("UNKNOWN").likelihood).toBe(2);
    expect(st("UNKNOWN").capability.gapType).toMatch(/unknown/i);
    expect(st("NO").score).toBeGreaterThan(st("PARTIAL").score);
  });

  it("a merely-recommended capability rates lower than the same gap when mandatory", () => {
    const rec = deriveCapabilityGaps({ mobile: "YES", endpoints: "NO" }, { "cap-edr": { available: "NO" } })[0];
    const man = deriveCapabilityGaps({ endpoints: "YES" }, { "cap-edr": { available: "NO" } })[0];
    expect(rec.capability.level).toBe("recommended");
    expect(man.capability.level).toBe("mandatory");
    expect(rec.score).toBeLessThan(man.score);
  });

  it("emits the readiness-engine gap shape so findings can group it", () => {
    const [gap] = deriveCapabilityGaps({ publicWeb: "YES" }, { "cap-waf": { available: "NO" } });
    for (const k of ["gapId", "questionId", "worstAnswer", "departments", "guidance", "domain", "impact", "likelihood", "score", "rating", "ratingColor", "priority"]) {
      expect(gap[k], k).toBeDefined();
    }
    expect(gap.guidance.findingKey).toBe("cap-appsec");
    expect(gap.departments).toEqual([{ dept: "Environment", answer: "NO" }]);
  });
});

describe("buildCapabilityAssessment roll-ups", () => {
  it("computes counts, mandatory coverage and tool-vs-extend split", () => {
    const env = { platforms: ["m365"], endpoints: "YES", publicWeb: "YES" };
    const a = buildCapabilityAssessment({
      environment: env,
      statuses: {
        "cap-mfa": { available: "YES" }, "cap-edr": { available: "PARTIAL", tool: "Microsoft Defender for Endpoint" },
        "cap-waf": { available: "NO" }, "cap-siem": { available: "UNKNOWN" },
      },
    });
    expect(a.summary.counts).toMatchObject({ YES: 1, PARTIAL: 1, NO: 1, UNKNOWN: 1 });
    expect(a.summary.newToolGaps).toBe(1);
    expect(a.summary.nativeExtendGaps).toBe(2);
    // (1 + 0.5 + 0 + 0) / 4 answered mandatory = 37.5 → 38
    expect(a.summary.coveragePct).toBe(38);
    expect(a.summary.mandatory + a.summary.recommended + a.summary.notApplicable).toBe(CAPABILITIES.length);
  });

  it("coverage is null until something mandatory is answered", () => {
    expect(buildCapabilityAssessment({ environment: { platforms: ["aws"] }, statuses: {} }).summary.coveragePct).toBeNull();
  });
});

describe("tool suggestions only come from the platforms the user selected", () => {
  const tools = (env, id) => deriveApplicability(env).find(a => a.id === id).suggestedTools;

  it("no platform stated / on-prem → vendor-neutral only (no Microsoft, AWS or Google tools)", () => {
    for (const platforms of [undefined, ["onprem"], ["hybrid"], ["other_cloud"]]) {
      const t = tools({ platforms, unstructured: "YES", vendors: "YES" }, "cap-dlp");
      expect(t.length).toBeGreaterThan(0);
      expect(t.every(x => !x.native), JSON.stringify(platforms)).toBe(true);
      expect(JSON.stringify(t)).not.toMatch(/Purview|Amazon|AWS|Google/);
    }
  });

  it("AWS only never shows Purview or any Microsoft tool, on any capability", () => {
    const all = deriveApplicability({ platforms: ["aws"], endpoints: "YES", unstructured: "YES", vendors: "YES", consent: "YES", databases: "YES", saas: "YES", publicWeb: "YES", apis: "YES", customApps: "YES", privileged: "YES", multiApps: "YES", mobile: "YES" });
    expect(JSON.stringify(all.map(a => a.suggestedTools))).not.toMatch(/Microsoft|Purview|Entra|Intune|Defender|Azure/);
  });

  it("Microsoft selected: Purview appears only on the cards where it fits", () => {
    const env = { platforms: ["m365"], endpoints: "YES", unstructured: "YES", vendors: "YES", consent: "YES", databases: "YES", saas: "YES", publicWeb: "YES" };
    const withPurview = deriveApplicability(env).filter(a => a.suggestedTools.some(t => /Purview/.test(t.tool))).map(a => a.id).sort();
    expect(withPurview).toEqual(["cap-data-discovery", "cap-dlp", "cap-retention-deletion"]);
  });

  it("two selected clouds interleave: each family's native tools, capped at two per family, then neutral", () => {
    const t = tools({ platforms: ["aws", "azure"], publicWeb: "YES" }, "cap-waf");
    expect(t.slice(0, 2).map(x => x.tool)).toEqual(["Azure Front Door WAF", "Azure Application Gateway WAF"]);
    expect(t[2].tool).toMatch(/AWS WAF/);
    expect(t.filter(x => x.native)).toHaveLength(3); // 2 Microsoft + 1 AWS (only one AWS tool exists)
    expect(t.some(x => !x.native)).toBe(true);
  });

  it("the classification rationale no longer hard-codes any product name", () => {
    expect(classifyEnvironment({ platforms: ["m365"] }).rationale.join(" ")).not.toMatch(/Purview/);
  });
});

describe("derived IT answers", () => {
  const env = { platforms: ["m365"], endpoints: "YES", publicWeb: "YES", unstructured: "YES" };

  it("maps a card answer onto every IT question it covers", () => {
    const d = deriveITAnswers(env, { "cap-mfa": { available: "NO" }, "cap-retention-deletion": { available: "PARTIAL" } });
    expect(d["it-15"]).toBe("NO");
    expect(["it-12", "it-13", "it-14"].map(k => d[k])).toEqual(["PARTIAL", "PARTIAL", "PARTIAL"]);
  });

  it("UNKNOWN and unanswered cards derive nothing (not assessed); an N/A card derives NA", () => {
    const d = deriveITAnswers({ platforms: ["onprem"], publicWeb: "NO", endpoints: "YES" }, { "cap-mfa": { available: "UNKNOWN" } });
    expect(d["it-15"]).toBeUndefined();          // MFA card answered UNKNOWN → not assessed
    expect(d["it-19"]).toBeUndefined();          // EDR card applies (endpoints) but is unanswered → not assessed
    expect(d["it-22"]).toBe("NA");               // WAF card not applicable without a public web app
    expect(d["it-23"]).toBe("NA");               // cloud posture not applicable on-prem only
  });

  it("merges into the IT submission, overriding a stale raw answer, and leaves other departments alone", () => {
    const subs = [
      { department: "IT", answers: { "it-15": "YES", "it-16": "NO" } },
      { department: "HR", answers: { "hr-2": "YES" } },
    ];
    const { submissions, derivedIds } = applyCapabilityDerivation(subs, { environment: env, statuses: { "cap-mfa": { available: "NO" } } });
    expect(submissions[0].answers["it-15"]).toBe("NO");   // derived wins
    expect(submissions[0].answers["it-16"]).toBe("NO");   // untouched
    expect(submissions[1]).toBe(subs[1]);
    expect(derivedIds.has("it-15")).toBe(true);
    expect(derivedIds.has("it-16")).toBe(false);
  });

  it("is idempotent, and a no-op without environment answers", () => {
    const subs = [{ department: "IT", answers: { "it-16": "NO" } }];
    const input = { environment: env, statuses: { "cap-mfa": { available: "YES" } } };
    const once = applyCapabilityDerivation(subs, input);
    const twice = applyCapabilityDerivation(once.submissions, input);
    expect(twice.submissions).toEqual(once.submissions);
    expect(applyCapabilityDerivation(subs, null).submissions).toBe(subs);
    expect(applyCapabilityDerivation(subs, { environment: {}, statuses: {} }).derivedIds.size).toBe(0);
  });

  it("every derived IT question id was removed from the directly-asked IT list", async () => {
    const { DEPT_QUESTIONS } = await import("../utils/deptSelfAssessQuestions.js");
    const asked = new Set(DEPT_QUESTIONS.IT.map(q => q.id));
    for (const q of IT_DERIVED_QUESTIONS) {
      expect(asked.has(q.id), `${q.id} is both asked and derived`).toBe(false);
      expect(getCapability(q.capabilityId), q.capabilityId).toBeTruthy();
      expect(guidanceFor(q.id), `${q.id} still needs guidance for traceability`).toBeTruthy();
    }
    expect(DEPT_QUESTIONS.IT).toHaveLength(14);
    expect(IT_DERIVED_QUESTIONS).toHaveLength(22);
  });
});

describe("maturity", () => {
  it("maturity contributions skip UNKNOWN / not-applicable / capabilities that feed a derived IT answer, and score YES=2 / PARTIAL=1 / NO=0", () => {
    const c = capabilityMaturityContributions({ apis: "YES", databases: "YES", publicWeb: "YES" }, {
      "cap-api-security": { available: "PARTIAL" }, "cap-db-security": { available: "NO" },
      "cap-dr-bcp": { available: "UNKNOWN" }, "cap-pam": { available: "YES" },
      "cap-mfa": { available: "NO" }, "cap-waf": { available: "NO" }, // both feed derived IT answers → excluded
    });
    const flat = Object.values(c).flat();
    expect(flat.find(x => x.qid === "cap-api-security").val).toBe(1);
    expect(flat.find(x => x.qid === "cap-db-security").val).toBe(0);
    expect(flat.some(x => x.qid === "cap-dr-bcp")).toBe(false);   // UNKNOWN
    expect(flat.some(x => x.qid === "cap-pam")).toBe(false);      // not applicable (no privileged users)
    expect(flat.some(x => x.qid === "cap-mfa")).toBe(false);      // counted via derived it-15
    expect(flat.some(x => x.qid === "cap-waf")).toBe(false);      // counted via derived it-22
  });
});
