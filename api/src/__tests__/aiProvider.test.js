import { describe, test, expect, vi, beforeEach, afterEach } from "vitest";

// Fake provider modules. Each records the args it was called with so the test
// can assert which backend a request was routed to.
function makeFakeProvider(tag) {
  return {
    analyzeEvidence: vi.fn(async (args) => ({ tag, kind: "analyzeEvidence", args })),
    suggestEvidence: vi.fn(async (args) => ({ tag, kind: "suggestEvidence", args })),
    chatWithDocuments: vi.fn(async (args) => ({ tag, kind: "chatWithDocuments", args })),
    analyzePolicy: vi.fn(async (args) => ({ tag, kind: "analyzePolicy", args })),
  };
}

let bedrockFake, azureFake;

async function loadAiProvider(envProvider) {
  vi.resetModules();
  bedrockFake = makeFakeProvider("bedrock");
  azureFake = makeFakeProvider("azure");
  vi.doMock("../utils/bedrock.js", () => bedrockFake);
  vi.doMock("../utils/azureOpenAI.js", () => azureFake);
  process.env.PRISM_AI_PROVIDER = envProvider;
  return import("../utils/aiProvider.js");
}

afterEach(() => {
  vi.doUnmock("../utils/bedrock.js");
  vi.doUnmock("../utils/azureOpenAI.js");
  delete process.env.PRISM_AI_PROVIDER;
});

describe("aiProvider per-company provider override", () => {
  test("routes to azure when args.provider is 'azure'", async () => {
    const ai = await loadAiProvider("bedrock");
    await ai.analyzeEvidence({ provider: "azure", evidenceName: "x" });

    expect(azureFake.analyzeEvidence).toHaveBeenCalledTimes(1);
    expect(bedrockFake.analyzeEvidence).not.toHaveBeenCalled();
  });

  test("routes to bedrock when args.provider is 'bedrock' even if env says azure", async () => {
    const ai = await loadAiProvider("azure");
    await ai.analyzeEvidence({ provider: "bedrock", evidenceName: "x" });

    expect(bedrockFake.analyzeEvidence).toHaveBeenCalledTimes(1);
    expect(azureFake.analyzeEvidence).not.toHaveBeenCalled();
  });

  test("falls back to the env default provider when args.provider is absent", async () => {
    const ai = await loadAiProvider("azure");
    await ai.analyzeEvidence({ evidenceName: "x" });

    expect(azureFake.analyzeEvidence).toHaveBeenCalledTimes(1);
    expect(bedrockFake.analyzeEvidence).not.toHaveBeenCalled();
  });

  test("does not leak the 'provider' key into the concrete provider call", async () => {
    const ai = await loadAiProvider("bedrock");
    await ai.analyzeEvidence({ provider: "bedrock", evidenceName: "x" });

    const passedArgs = bedrockFake.analyzeEvidence.mock.calls[0][0];
    expect(passedArgs).not.toHaveProperty("provider");
    expect(passedArgs).toMatchObject({ evidenceName: "x" });
  });

  test("routes analyzePolicy to the requested provider", async () => {
    const ai = await loadAiProvider("bedrock");
    await ai.analyzePolicy({ provider: "azure", policyName: "p" });

    expect(azureFake.analyzePolicy).toHaveBeenCalledTimes(1);
  });

  test("an unknown provider value falls back to bedrock", async () => {
    const ai = await loadAiProvider("bedrock");
    await ai.analyzeEvidence({ provider: "made-up", evidenceName: "x" });

    expect(bedrockFake.analyzeEvidence).toHaveBeenCalledTimes(1);
  });
});

describe("aiProvider 'none' — graceful, not-configured responses", () => {
  test("analyzeEvidence resolves with an empty, not-configured result instead of throwing", async () => {
    const ai = await loadAiProvider("none");
    const result = await ai.analyzeEvidence({ evidenceName: "x", evidenceType: "FILE" });

    expect(result.gaps).toEqual([]);
    expect(result.suggestions).toEqual([]);
    expect(result.contributorComments.toLowerCase()).toContain("not configured");
    expect(result.dateWarning).toBeNull();
  });

  test("analyzePolicy resolves with an empty, not-configured result instead of throwing", async () => {
    const ai = await loadAiProvider("none");
    const result = await ai.analyzePolicy({ policyName: "p" });

    expect(result.readiness).toBe("incomplete");
    expect(result.gaps).toEqual([]);
    expect(result.dpdpGaps).toEqual([]);
    expect(result.suggestions).toEqual([]);
    expect(result.summary.toLowerCase()).toContain("not configured");
  });

  test("chatWithDocuments resolves with a not-configured message instead of throwing", async () => {
    const ai = await loadAiProvider("none");
    const reply = await ai.chatWithDocuments({ systemPrompt: "s", history: [], message: "hi" });

    expect(typeof reply).toBe("string");
    expect(reply.toLowerCase()).toContain("not configured");
  });

  test("suggestEvidence keyword results are tagged matchType 'keyword'", async () => {
    const ai = await loadAiProvider("none");
    const scores = await ai.suggestEvidence({
      questionContext: { baselineQuestion: "information security policy approved governance", tags: "ISO27001" },
      vaultItems: [{ id: 7, title: "Information Security Policy", description: "" }],
    });

    expect(scores.length).toBeGreaterThan(0);
    expect(scores[0].matchType).toBe("keyword");
  });
});
