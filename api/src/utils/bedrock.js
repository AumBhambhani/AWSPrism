import {
  BedrockRuntimeClient,
  ConverseCommand
} from "@aws-sdk/client-bedrock-runtime";
import fs from "fs";
import path from "path";
import { extractFileContent } from "./fileExtract.js";
import { extractFirstJson } from "./jsonExtract.js";
import { buildExposurePrompt, normaliseMappings } from "./regulatoryExposurePrompt.js";
import { buildNarrativePrompt, normaliseNarrative } from "./readinessNarrativePrompt.js";
import { buildGapContextPrompt, normaliseGapContext } from "./readinessGapContextPrompt.js";

const client = new BedrockRuntimeClient({
  region: process.env.AWS_REGION || "eu-north-1",
  credentials: process.env.AWS_ACCESS_KEY_ID ? {
    accessKeyId: process.env.AWS_ACCESS_KEY_ID,
    secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY,
    ...(process.env.AWS_SESSION_TOKEN ? { sessionToken: process.env.AWS_SESSION_TOKEN } : {})
  } : undefined
});

const MODEL_ID = process.env.BEDROCK_CHAT_MODEL || process.env.BEDROCK_MODEL_ID || "eu.amazon.nova-pro-v1:0";

function buildText(metaBlock, taskBlock, middle = "") {
  return [metaBlock, middle, taskBlock].filter(Boolean).join("\n\n");
}

export async function analyzeEvidence({ evidenceName, evidenceType, questId, moduleId, requiredEvidence, filePath, recurrenceInterval, today }) {
  console.log(`[AI] Analyzing evidence: ${evidenceName}`);
  console.log(`[AI] File path: ${filePath}`);
  console.log(`[AI] Evidence type: ${evidenceType}`);
  console.log(`[AI] Using Bedrock model: ${MODEL_ID}`);

  const intervalLabel = recurrenceInterval ? recurrenceInterval.toLowerCase() : null;
  const dateContext = intervalLabel && intervalLabel !== "none"
    ? `- Today's Date: ${today}\n- Control Recurrence: ${intervalLabel} (evidence must be refreshed at this cadence)`
    : `- Today's Date: ${today}`;

  const metaBlock = `**Evidence Details:**
- Evidence Name: ${evidenceName || "N/A"}
- Type: ${evidenceType}
- Question ID: ${questId || "N/A"}
- Module ID: ${moduleId || "N/A"}
- Required Evidence: ${requiredEvidence || "Not specified"}
${dateContext}`;

  const dateInstruction = intervalLabel && intervalLabel !== "none"
    ? `4. DATE VALIDATION: Scan the document for any dates (creation date, review date, approval date, policy date, report date, etc.). Compare the most recent date found against today (${today}). Given the control recurrence is "${intervalLabel}", flag if the evidence appears expired or stale. If no dates are found in the document, note that dates could not be verified. Set "dateWarning" to null if evidence appears current, or to a concise warning string (e.g. "Policy last reviewed Jan 2023 — may be overdue for ${intervalLabel} refresh") if stale.`
    : `4. DATE VALIDATION: Scan the document for any dates. Set "dateWarning" to null if evidence appears current, or to a concise warning if you find dates suggesting the document is significantly out of date.`;

  const taskBlock = `**Task:**
Evaluate whether this evidence adequately addresses the stated compliance requirement. Judge it against whichever control framework(s) are actually relevant to this control — e.g. ISO 27001, SOC 2, GDPR, India's DPDPA, HIPAA, PCI DSS, NIST CSF — rather than assuming a single standard. If the required-evidence text names or implies a specific framework, prioritise that one.
${dateInstruction}
Respond with ONLY a JSON object (no markdown fences) with these exact keys:
{
  "contributorComments": "feedback for the person who uploaded the evidence",
  "reviewerComments": "recommendation for the reviewer/approver",
  "gaps": ["array of identified gaps"],
  "suggestions": ["array of improvement suggestions"],
  "dateWarning": null
}`;

  let messageContent;

  if (evidenceType === "FILE" && filePath) {
    try {
      if (!fs.existsSync(filePath)) throw new Error(`File not found: ${filePath}`);
      const fileExt = path.extname(filePath).replace(".", "").toLowerCase();
      const extracted = await extractFileContent(filePath, fileExt);

      if (extracted.type === "image") {
        // Converse API image block uses format + bytes (not base64 string)
        const fmt = extracted.mediaType.split("/")[1]; // e.g. "jpeg", "png"
        messageContent = [
          { text: buildText(metaBlock, taskBlock, "Analyze the compliance document shown in this image.") },
          { image: { format: fmt, source: { bytes: Buffer.from(extracted.base64, "base64") } } }
        ];
      } else {
        messageContent = [{ text: buildText(metaBlock, taskBlock, `**File Content:**\n${extracted.content}`) }];
      }
    } catch (err) {
      console.error(`[AI] Error extracting file content:`, err.message);
      messageContent = [{ text: buildText(metaBlock, taskBlock, `Note: Could not extract file content — ${err.message}`) }];
    }
  } else if (evidenceType === "LINK") {
    messageContent = [{ text: buildText(metaBlock, taskBlock, "Evidence provided as external link.") }];
  } else {
    messageContent = [{ text: buildText(metaBlock, taskBlock) }];
  }

  console.log(`[AI] Sending request to Amazon Bedrock...`);

  try {
    const command = new ConverseCommand({
      modelId: MODEL_ID,
      messages: [{ role: "user", content: messageContent }],
      inferenceConfig: { maxTokens: 4096, temperature: 0.2 }
    });

    const response = await client.send(command);
    const rawContent = response.output?.message?.content?.[0]?.text || "";
    console.log(`[AI] Response preview: ${rawContent.substring(0, 200)}...`);

    try {
      const jsonMatch = rawContent.match(/```json\s*([\s\S]*?)\s*```/) || rawContent.match(/\{[\s\S]*\}/);
      const jsonStr = jsonMatch ? (jsonMatch[1] || jsonMatch[0]) : rawContent;
      const parsed = JSON.parse(jsonStr);
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
        contributorComments: rawContent,
        reviewerComments: "AI provided unstructured feedback. See contributor comments.",
        gaps: [],
        suggestions: [],
        dateWarning: null
      };
    }
  } catch (error) {
    console.error(`[AI] Bedrock Error:`, error.message);
    throw new Error(`AI analysis failed: ${error.message}`);
  }
}

export async function suggestEvidence({ questionContext, vaultItems }) {
  if (!vaultItems.length) return [];

  const { questId, moduleName, controlArea, baselineQuestion, requiredEvidence, tags } = questionContext;

  const itemsList = vaultItems
    .map(v => `ID:${v.id} | "${v.title}"${v.description ? ` — ${v.description.substring(0, 120)}` : ""}`)
    .join("\n");

  const prompt = `You are a compliance evidence matcher. Given a compliance control question and a list of evidence items from a vault, identify which items are relevant.

**Compliance Control:**
- ID: ${questId}
- Module: ${moduleName || "N/A"}
- Control Area: ${controlArea || "N/A"}
- Question: ${baselineQuestion || "N/A"}
- Required Evidence: ${requiredEvidence || "N/A"}
- Tags: ${tags || "N/A"}

**Evidence Vault Items:**
${itemsList}

**Instructions:**
Score each item's relevance to this control from 0–100.
Return only items scoring 40 or above, up to 5 items.
Respond with ONLY a valid JSON array, no markdown fences, no explanation:
[{"vaultId":<number>,"relevanceScore":<number>,"reason":"<one sentence why relevant>"}]
If nothing scores 40+, return: []`;

  try {
    const command = new ConverseCommand({
      modelId: MODEL_ID,
      messages: [{ role: "user", content: [{ text: prompt }] }],
      inferenceConfig: { maxTokens: 1024, temperature: 0.1 }
    });
    const response = await client.send(command);
    const raw = response.output?.message?.content?.[0]?.text || "[]";
    console.log(`[AI] suggestEvidence response preview: ${raw.substring(0, 200)}`);

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
    console.error(`[AI] Bedrock suggestEvidence error:`, error.message);
    throw new Error(`AI suggestion failed: ${error.message}`);
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

  const prompt = `You group compliance-control questions that represent the SAME underlying requirement, so one canonical question can be answered once and mapped to every framework.

INCOMING rows (one framework's audit sheet; ~3 near-identical rows per control):
${incomingList}

EXISTING canonical questions (already curated, company_id IS NULL):
${existingList}

Rules:
- Put every incoming tempId in exactly one cluster.
- Cluster together rows that describe the same control even if wording differs across frameworks.
- If a cluster matches an EXISTING canonical requirement, set action "MERGE_INTO_EXISTING" and existingQuestId.
- Otherwise action "NEW_CANONICAL".
- Never merge controls that differ in scope or intent.
- canonicalQuestion: one clear question capturing the control (drop "is it implemented / can you provide evidence / is it reviewed" boilerplate — the canonical covers all of it).
- confidence: 0..1.

Respond with ONLY valid JSON, no markdown:
{"clusters":[{"memberTempIds":["..."],"action":"NEW_CANONICAL|MERGE_INTO_EXISTING","existingQuestId":null,"canonicalQuestion":"...","level3":"...","confidence":0.0,"rationale":"..."}]}`;

  const command = new ConverseCommand({
    modelId: MODEL_ID,
    messages: [{ role: "user", content: [{ text: prompt }] }],
    inferenceConfig: { maxTokens: 4096, temperature: 0 }
  });
  const response = await client.send(command);
  const raw = response.output?.message?.content?.[0]?.text || "";
  const jsonMatch = raw.match(/\{[\s\S]*\}/);
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

  const command = new ConverseCommand({
    modelId: MODEL_ID,
    messages: [{ role: "user", content: [{ text: buildExposurePrompt({ departments, provisionIndex }) }] }],
    inferenceConfig: { maxTokens: 8192, temperature: 0 }
  });
  const response = await client.send(command);
  const raw = response.output?.message?.content?.[0]?.text || "";
  const mappings = normaliseMappings(extractFirstJson(raw));
  if (!mappings) {
    console.error(`[AI] mapRegulatoryExposure — unparseable response (stop=${response.stopReason}): ${raw.slice(0, 400)}`);
    throw new Error("mapRegulatoryExposure: no valid JSON object in model response");
  }
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

  const command = new ConverseCommand({
    modelId: MODEL_ID,
    messages: [{ role: "user", content: [{ text: prompt }] }],
    inferenceConfig: { maxTokens: 4096, temperature: 0 }
  });
  const response = await client.send(command);
  const raw = response.output?.message?.content?.[0]?.text || "";
  const jsonMatch = raw.match(/\{[\s\S]*\}/);
  if (!jsonMatch) throw new Error("mapSelfAssessmentToQuestions: no JSON in model response");
  const parsed = JSON.parse(jsonMatch[0]);
  if (!parsed || typeof parsed.map !== "object" || parsed.map === null) {
    throw new Error("mapSelfAssessmentToQuestions: bad shape");
  }
  return { map: parsed.map };
}

export async function generateReadinessNarrative(args) {
  const command = new ConverseCommand({
    modelId: MODEL_ID,
    messages: [{ role: "user", content: [{ text: buildNarrativePrompt(args) }] }],
    inferenceConfig: { maxTokens: 4096, temperature: 0.3 }
  });
  const response = await client.send(command);
  const raw = response.output?.message?.content?.[0]?.text || "";
  const narrative = normaliseNarrative(extractFirstJson(raw));
  if (!narrative) {
    console.error(`[AI] generateReadinessNarrative — unparseable response (stop=${response.stopReason}): ${raw.slice(0, 400)}`);
    throw new Error("generateReadinessNarrative: no valid JSON object in model response");
  }
  return narrative;
}

export async function analyzeGapContext(args) {
  const { ctx, ...promptArgs } = args;
  const command = new ConverseCommand({
    modelId: MODEL_ID,
    messages: [{ role: "user", content: [{ text: buildGapContextPrompt(promptArgs) }] }],
    inferenceConfig: { maxTokens: 8192, temperature: 0 }
  });
  const response = await client.send(command);
  const raw = response.output?.message?.content?.[0]?.text || "";
  const out = normaliseGapContext(extractFirstJson(raw), ctx);
  if (!out) {
    console.error(`[AI] analyzeGapContext — unparseable response (stop=${response.stopReason}): ${raw.slice(0, 400)}`);
    throw new Error("analyzeGapContext: no valid JSON object in model response");
  }
  return out;
}

export async function chatWithDocuments({ systemPrompt, history, message }) {
  console.log(`[AI] Vault chat — ${history.length} prior turns, query: "${message.substring(0, 80)}"`);

  const messages = [
    ...history.map(m => ({ role: m.role, content: [{ text: m.content }] })),
    { role: "user", content: [{ text: message }] }
  ];

  const command = new ConverseCommand({
    modelId: MODEL_ID,
    system: [{ text: systemPrompt }],
    messages,
    inferenceConfig: { maxTokens: 2048, temperature: 0.5 }
  });

  const response = await client.send(command);
  return response.output?.message?.content?.[0]?.text || "I couldn't generate a response. Please try again.";
}

export async function analyzePolicy({ policyName, filePath, fileExt }) {
  console.log(`[AI] analyzePolicy: ${policyName} (${fileExt})`);

  let extracted;
  try {
    if (!fs.existsSync(filePath)) throw new Error("File not found");
    extracted = await extractFileContent(filePath, fileExt);
  } catch (err) {
    extracted = { type: "text", content: `(Could not extract file content: ${err.message})` };
  }

  const contentSection = extracted.type === "image"
    ? "Analyze the policy document shown in this image."
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

  let messageContent;
  if (extracted.type === "image") {
    const fmt = extracted.mediaType.split("/")[1];
    messageContent = [
      { text: prompt },
      { image: { format: fmt, source: { bytes: Buffer.from(extracted.base64, "base64") } } }
    ];
  } else {
    messageContent = [{ text: prompt }];
  }

  const command = new ConverseCommand({
    modelId: MODEL_ID,
    messages: [{ role: "user", content: messageContent }],
    inferenceConfig: { maxTokens: 2048, temperature: 0.2 }
  });

  const response = await client.send(command);
  const raw = response.output?.message?.content?.[0]?.text || "";
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

export { extractFileContent };
