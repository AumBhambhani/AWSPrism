// Shared prompt for the AI-authored narrative layer of the Big-4 DPDPA
// readiness report — used by both the Bedrock and Azure providers (like
// regulatoryExposurePrompt.js) so the wording can't drift.
//
// The AI writes ONLY business-context interpretation: the company's processing
// model, per-flow role-map notes, the six s.10(1) SDF-designation factors,
// sector benchmarking, and the executive "summary of key findings" bullets.
// The deterministic engine (readinessAssessment.js) owns every score, finding,
// rating and status. Everything the model returns is rendered clearly labelled
// as analyst interpretation, and the report degrades to a templated fallback
// when this is unavailable.

export function buildNarrativePrompt({ companyName, companyProfile = {}, deptSummary = "", maturitySummary = "", findingsSummary = "", roleFlows = [] }) {
  const flowList = roleFlows.map((f, i) => `  ${i + 1}. ${f}`).join("\n") || "  (none)";
  return `You are a privacy consultant writing the interpretive sections of a DPDP Act, 2023 (India) readiness assessment for the Board of "${companyName}".

COMPANY CONTEXT (as provided — treat as management representation, not verified):
  Name: ${companyName}
  Industry: ${companyProfile.industry || "not stated"}
  Size: ${companyProfile.companySize || "not stated"}

QUESTIONNAIRE SIGNAL (already computed — do not recompute or contradict):
${deptSummary}

MATURITY (already computed):
${maturitySummary}

FINDINGS (already computed):
${findingsSummary}

DATA FLOWS in the role map (write one note each, in this order):
${flowList}

Write in a measured, partner-review register. British spelling. No hype, no bullet padding, no invented facts about the company beyond what industry/size and a cinema/media/tech business model reasonably imply. Where you infer, say "likely" or "appears".

Respond with ONLY valid JSON, no markdown fences:
{
  "businessContext": "2-4 sentences on what personal data this organisation most likely processes and why, given its industry and size.",
  "roleMapNotes": [ { "flow": "<copy the flow name>", "note": "1-2 sentences on whether the company is likely Data Fiduciary, Data Processor or both for this flow, and the main DPDPA touchpoint." } ],
  "sdfFactors": [
    { "ref": "(a)", "factor": "Volume and sensitivity of personal data processed", "assessment": "1-2 sentences", "effect": "Raises likelihood | Slightly raises likelihood | Neutral | Lowers likelihood" },
    { "ref": "(b)", "factor": "Risk to the rights of Data Principals", "assessment": "...", "effect": "..." },
    { "ref": "(c)", "factor": "Potential impact on the sovereignty and integrity of India", "assessment": "...", "effect": "..." },
    { "ref": "(d)", "factor": "Risk to electoral democracy", "assessment": "...", "effect": "..." },
    { "ref": "(e)", "factor": "Security of the State", "assessment": "...", "effect": "..." },
    { "ref": "(f)", "factor": "Public order", "assessment": "...", "effect": "..." }
  ],
  "sdfOverall": { "band": "Low | Low to Moderate | Moderate | Moderate to High | High", "rationale": "2-3 sentences tying the factors together and noting that standing up the s.10(2) controls now is a no-regrets move." },
  "sectorBenchmark": "3-5 sentences on the DPDPA maturity of this organisation's sector, common first moves, and where this organisation sits relative to the sector norm given its data scale.",
  "execBullets": [ "3 to 5 short sentences for the Board — the single most important actions and the shape of the exposure. Do not repeat the finding list verbatim." ]
}`;
}

export function normaliseNarrative(parsed) {
  if (!parsed || typeof parsed !== "object") return null;
  const arr = (v) => (Array.isArray(v) ? v : []);
  const str = (v) => (typeof v === "string" ? v.trim() : "");

  const roleMapNotes = arr(parsed.roleMapNotes)
    .map(n => ({ flow: str(n?.flow), note: str(n?.note) }))
    .filter(n => n.flow && n.note);
  const sdfFactors = arr(parsed.sdfFactors)
    .map(f => ({ ref: str(f?.ref), factor: str(f?.factor), assessment: str(f?.assessment), effect: str(f?.effect) }))
    .filter(f => f.factor && f.assessment);
  const execBullets = arr(parsed.execBullets).map(str).filter(Boolean);

  const businessContext = str(parsed.businessContext);
  if (!businessContext && !sdfFactors.length && !execBullets.length) return null;

  return {
    businessContext,
    roleMapNotes,
    sdfFactors,
    sdfOverall: {
      band: str(parsed?.sdfOverall?.band) || "Moderate",
      rationale: str(parsed?.sdfOverall?.rationale),
    },
    sectorBenchmark: str(parsed.sectorBenchmark),
    execBullets,
  };
}
