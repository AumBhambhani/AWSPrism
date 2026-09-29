// Suggests which existing template (if any) a freshly-uploaded sheet is probably a
// new version of, so a superadmin doesn't have to remember template names/ids by
// hand. Always a suggestion — the superadmin picks the final target.
import { classifyTemplateDiff, summarizeTemplateDiff } from "./templateDiff.js";

export function scoreTemplateMatch(newQuestions, existingQuestions) {
  if (!existingQuestions?.length || !newQuestions?.length) {
    return { score: 0, summary: null, diff: null };
  }
  const diff = classifyTemplateDiff(existingQuestions, newQuestions);
  const summary = summarizeTemplateDiff(diff);
  const matched = summary.unchanged + summary.reworded + summary.renamed;
  const score = matched / Math.max(existingQuestions.length, newQuestions.length);
  return { score, summary, diff };
}

/**
 * @returns Array<{ templateId, rootTemplateId, name, currentVersion, score, summary }>
 *   sorted by score descending, highest first.
 */
export async function findTemplateMatches(client, { frameworkKey, newQuestions, limit = 5 }) {
  if (!frameworkKey) return [];
  const { rows } = await client.query(
    `SELECT id, root_template_id, name, version, question_data
     FROM module_templates
     WHERE framework_key = $1 AND is_current = true
     ORDER BY updated_at DESC`,
    [frameworkKey]
  );

  const candidates = rows.map((tpl) => {
    const existingQuestions =
      typeof tpl.question_data === "string" ? JSON.parse(tpl.question_data) : tpl.question_data;
    const { score, summary } = scoreTemplateMatch(newQuestions, existingQuestions || []);
    return {
      templateId: tpl.id,
      rootTemplateId: tpl.root_template_id,
      name: tpl.name,
      currentVersion: tpl.version,
      score: Math.round(score * 100) / 100,
      summary,
    };
  });

  candidates.sort((a, b) => b.score - a.score);
  return candidates.slice(0, limit);
}
