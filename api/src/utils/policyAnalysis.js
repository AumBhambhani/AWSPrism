import { createHash } from "crypto";
import path from "path";
import { query, mapRow } from "../db/index.js";
import { analyzePolicy } from "./aiProvider.js";
import { withLocalCopy } from "./evidenceStorage.js";
import { providerModelId } from "./aiSettings.js";

const sha = (v) =>
  createHash("sha256").update(typeof v === "string" ? v : JSON.stringify(v)).digest("hex");

/**
 * Cache key for a vault document's policy gap-analysis. The analysis is
 * deterministic in three things:
 *   - the file bytes         → keyed via storage_path, which the vault row swaps
 *                              to a fresh object ref on every new/restored version
 *   - the policy label        → sent verbatim in the prompt
 *   - the resolved model      → so a BEDROCK_CHAT_MODEL / Azure deployment swap
 *                              invalidates every cached analysis
 */
export function policyAnalysisFingerprint({ storagePath, policyName, provider }) {
  return sha([storagePath || "", policyName || "", providerModelId(provider)]).slice(0, 32);
}

/**
 * Run — or return the cached — AI policy gap-analysis for a vault item, persisting
 * the result on the vault row (ai_policy_analysis / ai_policy_analyzed_at /
 * ai_policy_provider / ai_policy_fingerprint).
 *
 * The AI layer costs a ~90s Bedrock round-trip per call and is fully deterministic
 * in the fingerprint inputs, so a matching fingerprint short-circuits to the
 * stored blob. Pass `force` to bypass the cache (e.g. an explicit "re-analyse").
 *
 * @param {{ vaultId:number, companyId:number, provider?:string|null,
 *           policyName?:string|null, force?:boolean }} args
 * @returns {Promise<{ analysis:object, cached:boolean }>}
 */
export async function runPolicyAnalysis({ vaultId, companyId, provider = null, policyName = null, force = false }) {
  const item = mapRow(await query(
    `SELECT id, title, file_name, storage_path, ai_policy_analysis, ai_policy_fingerprint
       FROM evidence_vault
      WHERE id = $1 AND company_id = $2`,
    [vaultId, companyId]
  ));
  if (!item) {
    const err = new Error("Vault item not found");
    err.status = 404;
    throw err;
  }
  if (!item.storagePath) {
    const err = new Error("No file available to analyse");
    err.status = 400;
    throw err;
  }

  const label = policyName || item.title;
  const fingerprint = policyAnalysisFingerprint({ storagePath: item.storagePath, policyName: label, provider });

  if (!force && item.aiPolicyFingerprint === fingerprint && item.aiPolicyAnalysis) {
    return { analysis: item.aiPolicyAnalysis, cached: true };
  }

  const fileExt = path.extname(item.fileName || item.storagePath).replace(".", "").toLowerCase();
  const analysis = await withLocalCopy(companyId, item.storagePath, (filePath) => analyzePolicy({
    provider: provider || null,
    policyName: label,
    filePath,
    fileExt,
  }));

  await query(
    `UPDATE evidence_vault
        SET ai_policy_analysis     = $1,
            ai_policy_analyzed_at  = NOW(),
            ai_policy_provider     = $2,
            ai_policy_fingerprint  = $3,
            updated_at             = NOW()
      WHERE id = $4 AND company_id = $5`,
    [JSON.stringify(analysis), provider || null, fingerprint, vaultId, companyId]
  );

  return { analysis, cached: false };
}
