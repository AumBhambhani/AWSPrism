import { query } from "../db/index.js";

/**
 * Resolve a company's AI configuration.
 *
 * AI is OPT-IN per company (2026-09-03): a company gets AI features only when it
 * has an explicit `company_settings.ai_enabled = TRUE` row. A missing row, or
 * `ai_enabled = FALSE`, means AI is off — the superadmin enables it per company
 * via PATCH /api/superadmin/companies/:id/ai-toggle.
 *
 * @returns {Promise<{ enabled: boolean, provider: 'bedrock'|'azure'|'none'|null }>}
 *   provider is "none" when AI is disabled (forces aiProvider.js to the no-op
 *   backend), null when enabled with no explicit backend (use the PRISM_AI_PROVIDER
 *   default), or the stored backend name.
 */
export async function getCompanyAiSettings(companyId) {
  const result = await query(
    "SELECT ai_enabled, ai_provider FROM company_settings WHERE company_id = $1",
    [companyId]
  );
  const row = result.rows[0];
  const enabled = row?.ai_enabled === true;
  return { enabled, provider: enabled ? (row.ai_provider || null) : "none" };
}

/**
 * The provider name to thread into aiProvider.js calls for this company.
 * "none" when AI is disabled for the company, null to use the platform default.
 */
export async function getCompanyAiProvider(companyId) {
  const { provider } = await getCompanyAiSettings(companyId);
  return provider;
}

/**
 * A stable identifier for the concrete model a resolved provider name maps to.
 * Folded into AI-result cache fingerprints so a model/deployment swap invalidates
 * every cached analysis. `provider` is the per-company name (bedrock | azure |
 * none | null); null falls back to the platform default.
 */
export function providerModelId(provider) {
  const p = (provider || process.env.PRISM_AI_PROVIDER || "bedrock").toLowerCase();
  if (p === "azure") return `azure:${process.env.AZURE_OPENAI_DEPLOYMENT || process.env.AZURE_AI_AGENT_ID || "default"}`;
  if (p === "none") return "none";
  return `bedrock:${process.env.BEDROCK_CHAT_MODEL || process.env.BEDROCK_MODEL_ID || "eu.amazon.nova-pro-v1:0"}`;
}
