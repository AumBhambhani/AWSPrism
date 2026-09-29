import { describe, test, expect } from "vitest";
import {
  buildControlMappings,
  buildFindingNarrative,
  buildFindingRef,
  remediationSla,
  CONTROL_CROSSWALK,
  REMEDIATION_PLAYBOOK,
} from "../data/findingGuidance.js";

describe("buildControlMappings", () => {
  test("expands an ISO 2013 reference into the mapped frameworks, in order", () => {
    const rows = buildControlMappings(["A.13.1.1"]);
    const labels = rows.map((r) => r.framework);
    expect(labels).toEqual([
      "ISO/IEC 27001:2013",
      "ISO/IEC 27001:2022",
      "GDPR",
      "DPDPA 2023",
    ]);
    // ISO 2022 equivalent of A.13.1.1 is A.8.20
    const iso2022 = rows.find((r) => r.framework === "ISO/IEC 27001:2022");
    expect(iso2022.controls).toContain("A.8.20");
    expect(rows.find((r) => r.framework === "GDPR").controls).toEqual(["Art. 32"]);
    expect(rows.find((r) => r.framework === "DPDPA 2023").controls).toEqual(["s. 8(5)"]);
  });

  test("accepts raw test_control_mappings rows and dedupes references", () => {
    const rows = buildControlMappings([
      { framework: "ISO27001", isoReference: "A.8.2.3" },
      { framework: "ISO27001", isoReference: "A.8.2.3" },
      { framework: "ISO27001", isoReference: "A.10.1.2" },
    ]);
    const iso2013 = rows.find((r) => r.framework === "ISO/IEC 27001:2013");
    expect(iso2013.controls).toEqual(["A.8.2.3", "A.10.1.2"]);
  });

  test("returns only the ISO row when the reference is unknown", () => {
    const rows = buildControlMappings(["A.99.9.9"]);
    expect(rows).toEqual([{ framework: "ISO/IEC 27001:2013", controls: ["A.99.9.9"] }]);
  });

  test("surfaces non-ISO framework rows (SOC 2, HIPAA, CIS, PCI DSS, CERT-In) from test_control_mappings", () => {
    const rows = buildControlMappings([
      { framework: "ISO27001", isoReference: "A.9.4.2" },
      { framework: "GDPR", isoReference: "Art. 32(1)(b)" },
      { framework: "SOC2", isoReference: "CC6.1" },
      { framework: "HIPAA", isoReference: "§164.312(d)" },
      { framework: "CIS", isoReference: "6.3" },
      { framework: "PCIDSS", isoReference: "8.4.2" },
      { framework: "CERTIN", isoReference: "Direction 4" },
    ]);
    const byFramework = Object.fromEntries(rows.map((r) => [r.framework, r.controls]));
    expect(byFramework["SOC 2"]).toEqual(["CC6.1"]);
    expect(byFramework["HIPAA"]).toEqual(["§164.312(d)"]);
    expect(byFramework["CIS Controls v8.1"]).toEqual(["6.3"]);
    expect(byFramework["PCI DSS v4.0.1"]).toEqual(["8.4.2"]);
    expect(byFramework["CERT-In Directions 2022"]).toEqual(["Direction 4"]);
    // the curated ISO 2013 row is still first
    expect(rows[0].framework).toBe("ISO/IEC 27001:2013");
  });

  test("every crosswalk entry covers ISO 2022, GDPR and DPDPA", () => {
    for (const [iso, xw] of Object.entries(CONTROL_CROSSWALK)) {
      for (const key of ["ISO2022", "GDPR", "DPDPA"]) {
        expect(Array.isArray(xw[key]), `${iso}.${key}`).toBe(true);
        expect(xw[key].length, `${iso}.${key}`).toBeGreaterThan(0);
      }
    }
  });
});

describe("buildFindingRef", () => {
  test("is stable for the same identity tuple and different for a different one", () => {
    const a = buildFindingRef({ companyId: 20, connectionId: 4, testKey: "azure.network.nsg_no_open_ingress", resourceId: "nsg-1" });
    const b = buildFindingRef({ companyId: 20, connectionId: 4, testKey: "azure.network.nsg_no_open_ingress", resourceId: "nsg-1" });
    const c = buildFindingRef({ companyId: 20, connectionId: 4, testKey: "azure.network.nsg_no_open_ingress", resourceId: "nsg-2" });
    expect(a).toMatch(/^PRISM-F-[0-9A-F]{8}$/);
    expect(a).toBe(b);
    expect(a).not.toBe(c);
  });
});

describe("remediationSla", () => {
  test("maps severity to a day count and a target date from the detection date", () => {
    const detected = new Date("2026-01-01T00:00:00Z");
    expect(remediationSla("critical", detected).days).toBe(7);
    expect(remediationSla("high", detected).days).toBe(30);
    expect(remediationSla("medium", detected).days).toBe(90);
    expect(remediationSla("low", detected).days).toBe(180);
    expect(remediationSla("weird", detected).days).toBe(90);
    expect(remediationSla("critical", detected).dueDate).toBe(new Date("2026-01-08T00:00:00Z").toLocaleDateString("en-GB"));
  });
});

describe("buildFindingNarrative", () => {
  test("uses a test-specific playbook when one exists and substitutes placeholders", () => {
    const n = buildFindingNarrative({
      testKey: "azure.network.nsg_no_open_ingress",
      title: "NSG exposes management ports",
      message: "vspaces-machine-nsg allows inbound access to ports 22/3389 from *",
      severity: "critical",
      resourceId: "vspaces-machine-nsg",
      connectionName: "Azure",
      frameworkNames: ["ISO/IEC 27001:2013", "ISO/IEC 27001:2022", "GDPR"],
    });
    expect(n.remediationSteps.length).toBeGreaterThanOrEqual(4);
    const allText = [n.executiveSummary, n.whatDetected, n.whyItMatters, n.immediateAction, n.targetArchitecture, ...n.remediationSteps].join(" ");
    expect(allText).toContain("vspaces-machine-nsg");
    expect(allText).not.toContain("{resource}");
    expect(n.executiveSummary).toContain("critical severity");
    expect(n.whatDetected).toContain("ports 22/3389");
    expect(n.immediateAction).toMatch(/vspaces-machine-nsg/);
    expect(n.targetArchitecture).toMatch(/Bastion|just-in-time/);
    // ISO 2013 + 2022 collapse to one "ISO/IEC 27001" mention in the compliance text
    expect(n.complianceImpact).toContain("ISO/IEC 27001, GDPR");
    expect(n.complianceImpact).toContain("not a certified crosswalk");
  });

  test("falls back to a generic plan for an unlisted test, preferring DB remediation text", () => {
    const n = buildFindingNarrative({
      testKey: "aws.some.brand_new_check",
      message: "resource X failed",
      severity: "medium",
      dbDescription: "Checks a brand new thing.",
      dbRemediation: "Flip the brand new toggle to on.",
      resourceId: "res-x",
      connectionName: "Prod",
      frameworkNames: [],
    });
    expect(n.whatDetected).toContain("Checks a brand new thing");
    expect(n.remediationSteps).toContain("Flip the brand new toggle to on.");
    expect(n.remediationSteps[0]).toContain("res-x");
    expect(n.executiveSummary).toContain("medium severity");
    expect(n.complianceImpact).toContain("No compliance framework mappings");
  });

  test("classifies a KMS wildcard-principal check as a permissions issue, not encryption-at-rest", () => {
    // aws.kms.no_wildcard_key_policy has no curated playbook entry, so it falls through
    // to the generic category matcher. Its test_key contains "kms", which used to match
    // the encryption-at-rest category before the permissions category — producing an
    // "enable encryption" tip for what is actually a key-policy permissions problem.
    const n = buildFindingNarrative({
      testKey: "aws.kms.no_wildcard_key_policy",
      message: "kms-key-xyz's key policy grants access to a wildcard principal (\"*\")",
      severity: "critical",
      dbDescription: "Checks no customer-managed KMS key's policy grants access to Principal \"*\".",
      dbRemediation: "Scope the key policy's Principal to specific accounts, roles, or users instead of \"*\".",
      resourceId: "kms-key-xyz",
      connectionName: "Prod AWS",
      frameworkNames: [],
    });
    expect(n.immediateAction).toMatch(/principal/i);
    expect(n.immediateAction).not.toMatch(/encryption at rest/i);
    expect(n.targetArchitecture).not.toMatch(/encrypted at rest/i);
    expect(n.remediationSteps).toContain("Scope the key policy's Principal to specific accounts, roles, or users instead of \"*\".");
  });

  test("handles a missing message without leaving a dangling sentence", () => {
    const n = buildFindingNarrative({
      testKey: "aws.some.brand_new_check",
      message: null,
      severity: "low",
      resourceId: "res-x",
      connectionName: "Prod",
      frameworkNames: [],
    });
    expect(n.whatDetected).toContain("did not meet the expected configuration");
    expect(n.whatDetected).not.toContain("undefined");
    expect(n.executiveSummary).not.toContain("undefined");
  });
});

describe("REMEDIATION_PLAYBOOK", () => {
  test("every entry has summary / impact / immediate / target strings and at least four steps", () => {
    for (const [key, entry] of Object.entries(REMEDIATION_PLAYBOOK)) {
      for (const field of ["summary", "impact", "immediate", "target"]) {
        expect(typeof entry[field], `${key}.${field}`).toBe("string");
        expect(entry[field].length, `${key}.${field}`).toBeGreaterThan(0);
      }
      expect(entry.steps.length, key).toBeGreaterThanOrEqual(4);
    }
  });
});
