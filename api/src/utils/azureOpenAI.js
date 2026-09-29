import fetch from "node-fetch";
import fs from "fs";
import path from "path";
import { extractFileContent } from "./fileExtract.js";
import { extractFirstJson } from "./jsonExtract.js";
import { buildExposurePrompt, normaliseMappings } from "./regulatoryExposurePrompt.js";
import { buildNarrativePrompt, normaliseNarrative } from "./readinessNarrativePrompt.js";
import { buildGapContextPrompt, normaliseGapContext } from "./readinessGapContextPrompt.js";

// ─── OAuth2 Token Cache ───────────────────────────────────────────────────────

let cachedToken = null;
let tokenExpiry = 0;

async function getAccessToken() {
  if (cachedToken && Date.now() < tokenExpiry - 300000) {
    return cachedToken;
  }

  const tenantId = process.env.AZURE_TENANT_ID;
  const clientId = process.env.AZURE_CLIENT_ID;
  const clientSecret = process.env.AZURE_CLIENT_SECRET;

  if (!tenantId || !clientId || !clientSecret) {
    throw new Error("Azure OAuth2 credentials not configured. Set AZURE_TENANT_ID, AZURE_CLIENT_ID, and AZURE_CLIENT_SECRET in .env");
  }

  const tokenUrl = `https://login.microsoftonline.com/${tenantId}/oauth2/v2.0/token`;

  const body = new URLSearchParams({
    grant_type: "client_credentials",
    client_id: clientId,
    client_secret: clientSecret,
    scope: "https://ai.azure.com/.default"
  });

  const response = await fetch(tokenUrl, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: body.toString()
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`Failed to acquire Azure token: ${response.status} ${errorText}`);
  }

  const data = await response.json();
  cachedToken = data.access_token;
  tokenExpiry = Date.now() + (data.expires_in * 1000);

  console.log("[AI] Acquired new Azure access token");
  return cachedToken;
}

// ─── Azure AI Agent helper (threads/messages/runs pattern) ────────────────────

async function agentRequest(path, method = "GET", body = null) {
  const endpoint = process.env.AZURE_OPENAI_ENDPOINT;
  const token = await getAccessToken();
  const url = `${endpoint}${path}?api-version=v1`;

  const options = {
    method,
    headers: {
      "Content-Type": "application/json",
      "Authorization": `Bearer ${token}`
    }
  };

  if (body) {
    options.body = JSON.stringify(body);
  }

  const response = await fetch(url, options);

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`Azure Agent API ${method} ${path} returned ${response.status}: ${errorText}`);
  }

  return response.json();
}

async function pollRunUntilComplete(threadId, runId, maxWaitMs = 60000) {
  const start = Date.now();
  while (Date.now() - start < maxWaitMs) {
    const run = await agentRequest(`/threads/${threadId}/runs/${runId}`);
    const status = run.status;

    if (status === "completed") return run;
    if (["failed", "cancelled", "expired"].includes(status)) {
      throw new Error(`Run ended with status: ${status}. ${run.last_error?.message || ""}`);
    }

    // Wait before polling again
    await new Promise(resolve => setTimeout(resolve, 1500));
  }
  throw new Error("Agent run timed out after 60 seconds");
}

// ─── Evidence Analysis ────────────────────────────────────────────────────────

export async function analyzeEvidence({ evidenceName, evidenceType, questId, moduleId, requiredEvidence, filePath, recurrenceInterval, today }) {
  console.log(`[AI] Analyzing evidence: ${evidenceName}`);
  console.log(`[AI] File path: ${filePath}`);
  console.log(`[AI] Evidence type: ${evidenceType}`);

  const endpoint = process.env.AZURE_OPENAI_ENDPOINT;
  const agentId = process.env.AZURE_AGENT_ID;

  if (!endpoint) {
    throw new Error("AZURE_OPENAI_ENDPOINT not configured in .env");
  }
  if (!agentId) {
    throw new Error("AZURE_AGENT_ID not configured in .env");
  }

  // Extract file content (PDF/DOCX/XLSX/text) via the shared extractor. The
  // Azure agent request path is text-only, so an image is described rather than
  // sent as vision input.
  let evidenceContent = "No file content available";

  if (evidenceType === "FILE" && filePath) {
    try {
      console.log(`[AI] Attempting to read file: ${filePath}`);

      if (!fs.existsSync(filePath)) {
        console.error(`[AI] File does not exist: ${filePath}`);
        evidenceContent = `FILE NOT FOUND: ${filePath}`;
      } else {
        const fileExt = path.extname(filePath).replace(".", "").toLowerCase();
        const extracted = await extractFileContent(filePath, fileExt);
        evidenceContent = extracted.type === "image"
          ? `(Image evidence "${evidenceName}" — ${fileExt.toUpperCase()}. The Azure agent cannot view images; analyzing based on filename and metadata only.)`
          : extracted.content;
        console.log(`[AI] Prepared ${evidenceContent.length} characters of evidence content`);
      }
    } catch (err) {
      console.error(`[AI] Error reading file:`, err);
      evidenceContent = `Unable to read file content: ${err.message}`;
    }
  } else if (evidenceType === "LINK") {
    evidenceContent = `Evidence provided as external link: ${evidenceName || evidenceType}`;
  }

  console.log(`[AI] Evidence content preview: ${evidenceContent.substring(0, 200)}...`);

  const intervalLabel = recurrenceInterval ? recurrenceInterval.toLowerCase() : null;
  const dateContext = intervalLabel && intervalLabel !== "none"
    ? `- Today's Date: ${today || new Date().toISOString().slice(0, 10)}\n- Control Recurrence: ${intervalLabel}`
    : `- Today's Date: ${today || new Date().toISOString().slice(0, 10)}`;

  const dateInstruction = intervalLabel && intervalLabel !== "none"
    ? `4. DATE VALIDATION: Scan the document for any dates. Compare the most recent date found against today. Given the control recurrence is "${intervalLabel}", set "dateWarning" to a concise warning string if the evidence appears stale, or null if current.`
    : `4. DATE VALIDATION: Scan the document for any dates. Set "dateWarning" to a warning string if dates suggest the document is significantly out of date, or null if current.`;

  const userPrompt = `Analyze this compliance evidence submission:

**Evidence Details:**
- Evidence Name: ${evidenceName || "N/A"}
- Type: ${evidenceType}
- Question ID: ${questId || "N/A"}
- Module ID: ${moduleId || "N/A"}
- Required Evidence: ${requiredEvidence || "Not specified"}
${dateContext}

**File Content Preview:**
${evidenceContent}

**Task:**
Evaluate whether this evidence adequately addresses the stated compliance requirement. Judge it against whichever control framework(s) are actually relevant to this control — e.g. ISO 27001, SOC 2, GDPR, India's DPDPA, HIPAA, PCI DSS, NIST CSF — rather than assuming a single standard. If the required-evidence text names or implies a specific framework, prioritise that one.
${dateInstruction}
Provide your analysis as JSON with: contributorComments, reviewerComments, gaps array, suggestions array, dateWarning (string or null).`;

  console.log(`[AI] Sending request to Azure AI Agent (threads/runs pattern)...`);
  console.log(`[AI] Using agent: ${agentId}`);
  console.log(`[AI] Endpoint: ${endpoint}`);

  try {
    // Step 1: Create a thread
    const thread = await agentRequest("/threads", "POST", {});
    const threadId = thread.id;
    console.log(`[AI] Created thread: ${threadId}`);

    // Step 2: Add message to thread
    await agentRequest(`/threads/${threadId}/messages`, "POST", {
      role: "user",
      content: userPrompt
    });
    console.log(`[AI] Added message to thread`);

    // Step 3: Create a run with the agent
    const run = await agentRequest(`/threads/${threadId}/runs`, "POST", {
      assistant_id: agentId
    });
    console.log(`[AI] Created run: ${run.id}, status: ${run.status}`);

    // Step 4: Poll until complete
    await pollRunUntilComplete(threadId, run.id);
    console.log(`[AI] Run completed`);

    // Step 5: Get messages from thread
    const messagesResult = await agentRequest(`/threads/${threadId}/messages`);
    const assistantMessages = (messagesResult.data || []).filter(m => m.role === "assistant");
    
    if (assistantMessages.length === 0) {
      throw new Error("No response from agent");
    }

    // Get the latest assistant message content
    const latestMsg = assistantMessages[0];
    let resultText = "";
    if (Array.isArray(latestMsg.content)) {
      const textPart = latestMsg.content.find(c => c.type === "text");
      resultText = textPart?.text?.value || textPart?.text || JSON.stringify(latestMsg.content);
    } else {
      resultText = String(latestMsg.content);
    }

    console.log(`[AI] Response content: ${resultText.substring(0, 200)}...`);

    // Step 6: Clean up thread
    try {
      await agentRequest(`/threads/${threadId}`, "DELETE");
    } catch (e) {
      // Non-critical, just log
      console.warn(`[AI] Failed to delete thread: ${e.message}`);
    }

    // Parse the response
    try {
      const jsonMatch = resultText.match(/```json\s*([\s\S]*?)\s*```/) || resultText.match(/\{[\s\S]*\}/);
      const jsonStr = jsonMatch ? (jsonMatch[1] || jsonMatch[0]) : resultText;
      const parsed = JSON.parse(jsonStr);
      console.log(`[AI] Successfully parsed JSON response`);
      return {
        contributorComments: parsed.contributorComments || "No contributor feedback generated",
        reviewerComments: parsed.reviewerComments || "No reviewer feedback generated",
        gaps: Array.isArray(parsed.gaps) ? parsed.gaps : [],
        suggestions: Array.isArray(parsed.suggestions) ? parsed.suggestions : [],
        dateWarning: parsed.dateWarning || null
      };
    } catch (parseError) {
      console.error(`[AI] JSON parse error:`, parseError.message);
      return {
        contributorComments: resultText,
        reviewerComments: "AI provided unstructured feedback. See contributor comments.",
        gaps: [],
        suggestions: [],
        dateWarning: null
      };
    }
  } catch (error) {
    console.error(`[AI] Azure AI Agent Error:`, error.message);
    throw new Error(`AI analysis failed: ${error.message}`);
  }
}

// ─── Shared agent conversation helper ─────────────────────────────────────────
// Runs a single-turn prompt through the threads/messages/runs pattern and
// returns the assistant's text reply. Cleans up the thread afterwards.
async function runAgentPrompt(userPrompt) {
  const endpoint = process.env.AZURE_OPENAI_ENDPOINT;
  const agentId = process.env.AZURE_AGENT_ID;
  if (!endpoint) throw new Error("AZURE_OPENAI_ENDPOINT not configured in .env");
  if (!agentId) throw new Error("AZURE_AGENT_ID not configured in .env");

  const thread = await agentRequest("/threads", "POST", {});
  const threadId = thread.id;
  try {
    await agentRequest(`/threads/${threadId}/messages`, "POST", { role: "user", content: userPrompt });
    const run = await agentRequest(`/threads/${threadId}/runs`, "POST", { assistant_id: agentId });
    await pollRunUntilComplete(threadId, run.id);

    const messagesResult = await agentRequest(`/threads/${threadId}/messages`);
    const latest = (messagesResult.data || []).find(m => m.role === "assistant");
    if (!latest) throw new Error("No response from agent");
    const part = Array.isArray(latest.content) ? latest.content.find(c => c.type === "text") : null;
    return part?.text?.value || part?.text || String(latest.content);
  } finally {
    try { await agentRequest(`/threads/${threadId}`, "DELETE"); }
    catch (e) { console.warn(`[AI] Failed to delete thread: ${e.message}`); }
  }
}

// ─── Policy Analysis ─────────────────────────────────────────────────────────

export async function analyzePolicy({ policyName, filePath, fileExt }) {
  console.log(`[AI] analyzePolicy (azure): ${policyName} (${fileExt})`);

  let extracted;
  try {
    if (!filePath || !fs.existsSync(filePath)) throw new Error("File not found");
    extracted = await extractFileContent(filePath, fileExt);
  } catch (err) {
    extracted = { type: "text", content: `(Could not extract file content: ${err.message})` };
  }

  const contentSection = extracted.type === "image"
    ? `**Document Content:** (Image document — the Azure agent cannot view images. Analyse based on the policy name only.)`
    : `**Document Content:**\n${(extracted.content || "(No content extracted)").substring(0, 15000)}`;

  const prompt = `You are a compliance analyst. Evaluate this policy document for completeness and alignment with the compliance frameworks and regulations that are relevant to its subject matter. Infer the applicable frameworks from the policy's content and title — this may include ISO 27001, SOC 2, GDPR, India's DPDPA 2023, HIPAA, PCI DSS, NIST CSF, or others. Do not assume a single standard applies.

**Policy Name:** ${policyName}

${contentSection}

**Task:**
1. Assess how complete and production-ready this policy is.
2. Identify general gaps — missing sections, vague ownership, missing review dates, undefined scope, unclear enforcement.
3. Identify framework-specific gaps — obligations or controls required by a specific named framework/regulation that this policy does not adequately address. Attribute each gap to the framework it comes from (e.g. "ISO 27001 A.5.10: acceptable-use rules not defined", "DPDPA s.6: consent-withdrawal mechanism missing", "GDPR Art. 33: 72-hour breach notification timeline absent").
4. Provide a one-sentence summary of the policy's current state.
5. Provide 3–5 concrete improvement suggestions.

Respond with ONLY a valid JSON object, no markdown fences, no explanation:
{
  "readiness": "strong" | "adequate" | "incomplete" | "placeholder",
  "summary": "one sentence summary of the policy's current state",
  "gaps": ["up to 5 key general gaps or missing sections"],
  "dpdpGaps": ["up to 4 framework-specific gaps, each attributed to its framework"],
  "suggestions": ["3 to 5 concrete improvement actions"]
}

Use "placeholder" if the document is a template with unfilled fields. Use "strong" only if the policy is genuinely comprehensive and aligned with its applicable frameworks. Return an empty array for any category with nothing to report.`;

  let raw;
  try {
    raw = await runAgentPrompt(prompt);
  } catch (error) {
    console.error(`[AI] Azure analyzePolicy error:`, error.message);
    throw new Error(`AI analysis failed: ${error.message}`);
  }
  console.log(`[AI] analyzePolicy response preview: ${raw.substring(0, 200)}`);

  try {
    const jsonMatch = raw.match(/```json\s*([\s\S]*?)\s*```/) || raw.match(/\{[\s\S]*\}/);
    const parsed = JSON.parse(jsonMatch ? (jsonMatch[1] || jsonMatch[0]) : raw);
    const VALID_READINESS = ["strong", "adequate", "incomplete", "placeholder"];
    return {
      readiness: VALID_READINESS.includes(parsed.readiness) ? parsed.readiness : "incomplete",
      summary: parsed.summary || "Analysis complete.",
      gaps: Array.isArray(parsed.gaps) ? parsed.gaps.slice(0, 6) : [],
      dpdpGaps: Array.isArray(parsed.dpdpGaps) ? parsed.dpdpGaps.slice(0, 5) : [],
      suggestions: Array.isArray(parsed.suggestions) ? parsed.suggestions.slice(0, 5) : [],
    };
  } catch {
    return { readiness: "incomplete", summary: raw.substring(0, 200), gaps: [], dpdpGaps: [], suggestions: [] };
  }
}

export async function clusterQuestions({ incoming = [], existing = [] }) {
  if (!incoming.length) return { clusters: [] };

  const incomingList = incoming.map(q =>
    `- tempId=${q.tempId} [${q.frameworkKey} ${q.controlReference || ""}] area="${q.controlArea || ""}" facet=${q.facet || "OTHER"} q="${String(q.question || "").slice(0, 200)}"`
  ).join("\n");
  const existingList = existing.length
    ? existing.map(e =>
        `- questId=${e.questId} area="${e.controlArea || ""}" frameworks=${(e.frameworks || []).map(f => f.key).join(",")} q="${String(e.question || "").slice(0, 200)}"`
      ).join("\n")
    : "(none yet)";

  const systemPrompt = `You group compliance-control questions representing the SAME underlying requirement so one canonical question can be answered once and mapped to every framework. Put every incoming tempId in exactly one cluster. Cluster rows describing the same control even if wording differs across frameworks. Use action "MERGE_INTO_EXISTING" (with existingQuestId) when a cluster matches an existing canonical requirement, otherwise "NEW_CANONICAL". Never merge controls that differ in scope. canonicalQuestion should capture the control without the implemented/evidence/reviewed boilerplate. Respond with ONLY valid JSON: {"clusters":[{"memberTempIds":["..."],"action":"...","existingQuestId":null,"canonicalQuestion":"...","level3":"...","confidence":0.0,"rationale":"..."}]}`;
  const message = `INCOMING:\n${incomingList}\n\nEXISTING canonical:\n${existingList}`;

  const raw = await chatWithDocuments({ systemPrompt, history: [], message });
  const jsonMatch = String(raw).match(/\{[\s\S]*\}/);
  if (!jsonMatch) throw new Error("clusterQuestions: no JSON in model response");
  const parsed = JSON.parse(jsonMatch[0]);
  if (!parsed || !Array.isArray(parsed.clusters)) throw new Error("clusterQuestions: bad shape");

  return {
    clusters: parsed.clusters.map(c => ({
      memberTempIds: (c.memberTempIds || []).map(String),
      action: c.action === "MERGE_INTO_EXISTING" ? "MERGE_INTO_EXISTING"
        : c.action === "KEEP_SEPARATE" ? "KEEP_SEPARATE" : "NEW_CANONICAL",
      existingQuestId: c.existingQuestId || null,
      canonicalQuestion: c.canonicalQuestion || "",
      level3: c.level3 || "",
      confidence: Math.max(0, Math.min(1, Number(c.confidence) || 0)),
      rationale: c.rationale || "",
      matchMethod: "llm",
    })),
  };
}

export async function mapRegulatoryExposure({ departments = [], provisionIndex = {} }) {
  if (!departments.length) return { mappings: [] };

  let raw;
  try {
    raw = await runAgentPrompt(buildExposurePrompt({ departments, provisionIndex }));
  } catch (error) {
    console.error(`[AI] Azure mapRegulatoryExposure error:`, error.message);
    throw new Error(`AI mapping failed: ${error.message}`);
  }

  const mappings = normaliseMappings(extractFirstJson(raw));
  if (!mappings) throw new Error("mapRegulatoryExposure: no valid JSON object in model response");
  return { mappings };
}

export async function mapSelfAssessmentToQuestions({ questions = [], catalog = [] }) {
  if (!questions.length || !catalog.length) return { map: {} };

  const qList = questions.map(q => `- ${q.id}: ${String(q.text || "").slice(0, 200)}`).join("\n");
  const catList = catalog.map(c =>
    `- ${c.questId}: [${c.controlArea || ""}] ${String(c.baselineQuestion || "").slice(0, 160)}`
  ).join("\n");

  const prompt = `You map a company's plain-language self-assessment questions to the formal compliance questions in their audit tracker.

SELF-ASSESSMENT QUESTIONS (plain language, asked of a department):
${qList}

TRACKER QUESTIONS (formal catalog — use the exact questId):
${catList}

For each self-assessment question, list the tracker questId(s) covering the SAME control or obligation.
Rules:
- Only use questId values that appear verbatim in the list above.
- 0 to 3 matches per self-assessment question; omit a question entirely if nothing genuinely matches.
- Match on the underlying requirement, not just shared words.

Respond with ONLY valid JSON, no markdown:
{"map":{"<selfAssessId>":["<questId>", ...]}}`;

  let raw;
  try {
    raw = await runAgentPrompt(prompt);
  } catch (error) {
    console.error(`[AI] Azure mapSelfAssessmentToQuestions error:`, error.message);
    throw new Error(`AI mapping failed: ${error.message}`);
  }
  const parsed = extractFirstJson(raw);
  if (!parsed || typeof parsed.map !== "object" || parsed.map === null) {
    throw new Error("mapSelfAssessmentToQuestions: no valid JSON object in model response");
  }
  return { map: parsed.map };
}

export async function generateReadinessNarrative(args) {
  let raw;
  try {
    raw = await runAgentPrompt(buildNarrativePrompt(args));
  } catch (error) {
    console.error(`[AI] Azure generateReadinessNarrative error:`, error.message);
    throw new Error(`AI narrative failed: ${error.message}`);
  }
  const narrative = normaliseNarrative(extractFirstJson(raw));
  if (!narrative) throw new Error("generateReadinessNarrative: no valid JSON object in model response");
  return narrative;
}

export async function analyzeGapContext(args) {
  const { ctx, ...promptArgs } = args;
  let raw;
  try {
    raw = await runAgentPrompt(buildGapContextPrompt(promptArgs));
  } catch (error) {
    console.error(`[AI] Azure analyzeGapContext error:`, error.message);
    throw new Error(`AI gap-context failed: ${error.message}`);
  }
  const out = normaliseGapContext(extractFirstJson(raw), ctx);
  if (!out) throw new Error("analyzeGapContext: no valid JSON object in model response");
  return out;
}

export async function chatWithDocuments({ systemPrompt, history, message }) {
  const endpoint = process.env.AZURE_OPENAI_ENDPOINT;
  const agentId = process.env.AZURE_AGENT_ID;
  if (!endpoint || !agentId) throw new Error("Azure AI provider not configured");

  // Build the full conversation as a single user message since the agent pattern
  // doesn't natively support multi-turn history injection
  const historyText = history.length > 0
    ? history.map(m => `${m.role === "user" ? "User" : "Assistant"}: ${m.content}`).join("\n") + "\n\n"
    : "";

  const fullPrompt = `${systemPrompt}\n\n---\n\n${historyText}User: ${message}`;

  try {
    const thread = await agentRequest("/threads", "POST", {});
    await agentRequest(`/threads/${thread.id}/messages`, "POST", { role: "user", content: fullPrompt });
    const run = await agentRequest(`/threads/${thread.id}/runs`, "POST", { assistant_id: agentId });
    await pollRunUntilComplete(thread.id, run.id);

    const messagesResult = await agentRequest(`/threads/${thread.id}/messages`);
    const latest = (messagesResult.data || []).find(m => m.role === "assistant");
    let responseText = "I couldn't generate a response. Please try again.";
    if (latest) {
      const part = Array.isArray(latest.content) ? latest.content.find(c => c.type === "text") : null;
      responseText = part?.text?.value || part?.text || String(latest.content) || responseText;
    }

    try { await agentRequest(`/threads/${thread.id}`, "DELETE"); } catch { /* non-fatal */ }

    return responseText;
  } catch (error) {
    console.error(`[AI] Azure chatWithDocuments error:`, error.message);
    throw new Error(`Chat failed: ${error.message}`);
  }
}

export async function suggestEvidence({ questionContext, vaultItems }) {
  if (!vaultItems.length) return [];

  const { questId, moduleName, controlArea, baselineQuestion, requiredEvidence, tags } = questionContext;

  const endpoint = process.env.AZURE_OPENAI_ENDPOINT;
  const agentId = process.env.AZURE_AGENT_ID;
  if (!endpoint || !agentId) throw new Error("Azure AI provider not configured");

  const itemsList = vaultItems
    .map(v => `ID:${v.id} | "${v.title}"${v.description ? ` — ${v.description.substring(0, 120)}` : ""}`)
    .join("\n");

  const userPrompt = `You are a compliance evidence matcher. Score each vault item's relevance to this control question.

**Compliance Control:**
- ID: ${questId}
- Module: ${moduleName || "N/A"}
- Control Area: ${controlArea || "N/A"}
- Question: ${baselineQuestion || "N/A"}
- Required Evidence: ${requiredEvidence || "N/A"}
- Tags: ${tags || "N/A"}

**Evidence Vault Items:**
${itemsList}

Score each item 0–100. Return only items scoring 40+, up to 5.
Respond with ONLY a JSON array, no markdown:
[{"vaultId":<number>,"relevanceScore":<number>,"reason":"<one sentence>"}]
If nothing scores 40+, return: []`;

  try {
    const thread = await agentRequest("/threads", "POST", {});
    await agentRequest(`/threads/${thread.id}/messages`, "POST", { role: "user", content: userPrompt });
    const run = await agentRequest(`/threads/${thread.id}/runs`, "POST", { assistant_id: agentId });
    await pollRunUntilComplete(thread.id, run.id);

    const messagesResult = await agentRequest(`/threads/${thread.id}/messages`);
    const latest = (messagesResult.data || []).find(m => m.role === "assistant");
    let raw = "";
    if (latest) {
      const part = Array.isArray(latest.content) ? latest.content.find(c => c.type === "text") : null;
      raw = part?.text?.value || part?.text || String(latest.content);
    }

    try { await agentRequest(`/threads/${thread.id}`, "DELETE"); } catch { /* non-fatal */ }

    const jsonMatch = raw.match(/\[[\s\S]*\]/);
    if (!jsonMatch) return [];

    const parsed = JSON.parse(jsonMatch[0]);
    if (!Array.isArray(parsed)) return [];

    return parsed
      .map(p => ({
        vaultId: parseInt(p.vaultId),
        relevanceScore: Math.min(100, Math.max(0, parseInt(p.relevanceScore) || 0)),
        reason: p.reason || "Relevant to this control",
        matchType: "ai",
      }))
      .filter(p => !isNaN(p.vaultId) && p.relevanceScore >= 40);
  } catch (error) {
    console.error(`[AI] Azure suggestEvidence error:`, error.message);
    throw new Error(`AI suggestion failed: ${error.message}`);
  }
}
