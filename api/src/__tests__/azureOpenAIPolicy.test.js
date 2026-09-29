import { describe, test, expect, vi, beforeEach } from "vitest";

// Simulate the Azure AI Agent threads/messages/runs REST sequence.
const fetchMock = vi.fn();
vi.mock("node-fetch", () => ({ default: (...args) => fetchMock(...args) }));

function jsonResponse(body) {
  return { ok: true, status: 200, json: async () => body, text: async () => JSON.stringify(body) };
}

// Wire a happy-path agent run whose final assistant message is `assistantText`.
function mockAgentRun(assistantText) {
  fetchMock.mockImplementation(async (url, opts = {}) => {
    const method = opts.method || "GET";
    if (url.includes("/threads") && method === "POST" && !url.includes("/messages") && !url.includes("/runs")) {
      return jsonResponse({ id: "thread_1" });
    }
    if (url.includes("/messages") && method === "POST") return jsonResponse({});
    if (url.includes("/runs") && method === "POST") return jsonResponse({ id: "run_1", status: "queued" });
    if (url.includes("/runs/run_1")) return jsonResponse({ status: "completed" });
    if (url.includes("/messages") && method === "GET") {
      return jsonResponse({ data: [{ role: "assistant", content: [{ type: "text", text: { value: assistantText } }] }] });
    }
    if (method === "DELETE") return jsonResponse({});
    return jsonResponse({});
  });
}

beforeEach(() => {
  fetchMock.mockReset();
  process.env.AZURE_OPENAI_ENDPOINT = "https://example.services.ai.azure.com/api/projects/p";
  process.env.AZURE_AGENT_ID = "asst_123";
  process.env.AZURE_TENANT_ID = "t";
  process.env.AZURE_CLIENT_ID = "c";
  process.env.AZURE_CLIENT_SECRET = "s";
});

async function loadAzure() {
  vi.resetModules();
  return import("../utils/azureOpenAI.js");
}

describe("azureOpenAI.analyzePolicy", () => {
  test("returns the normalized policy-analysis shape from the agent's JSON reply", async () => {
    mockAgentRun(JSON.stringify({
      readiness: "adequate",
      summary: "Covers the basics but misses retention detail.",
      gaps: ["No review date"],
      dpdpGaps: ["DPDPA s.8(7): retention period not stated"],
      suggestions: ["Add a retention schedule", "Name a policy owner"],
    }));

    const azure = await loadAzure();
    const result = await azure.analyzePolicy({ policyName: "Data Retention Policy", filePath: null, fileExt: "txt" });

    expect(result).toMatchObject({
      readiness: "adequate",
      summary: expect.stringContaining("retention"),
      gaps: ["No review date"],
      dpdpGaps: ["DPDPA s.8(7): retention period not stated"],
      suggestions: ["Add a retention schedule", "Name a policy owner"],
    });
  });

  test("falls back to a safe shape when the agent reply is not JSON", async () => {
    mockAgentRun("Sorry, I could not analyze that document.");

    const azure = await loadAzure();
    const result = await azure.analyzePolicy({ policyName: "X", filePath: null, fileExt: "txt" });

    expect(result.readiness).toBe("incomplete");
    expect(Array.isArray(result.gaps)).toBe(true);
    expect(Array.isArray(result.dpdpGaps)).toBe(true);
    expect(Array.isArray(result.suggestions)).toBe(true);
  });
});
