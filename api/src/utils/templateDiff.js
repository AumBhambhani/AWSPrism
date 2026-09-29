// Classifies the change between two versions of a framework's question set so a
// superadmin publish (or a company admin's update review) can show exactly what
// changed, without ever silently losing an answer tied to a question whose id,
// wording, or clause/control mapping moved.
//
// A question is described as { quest_id, baseline_question, iso_reference?, module_id }.
// iso_reference is the clause/control-reference cell (e.g. "CC2.1, CC2.2") — a sheet
// re-export can remap which clause a question satisfies without touching its wording
// at all, so that has to count as a real change too, not just text edits.

const RENAME_SIMILARITY_THRESHOLD = 0.85;

export function normalizeQuestionText(text) {
  return (text || "").trim().toLowerCase().replace(/\s+/g, " ");
}

export function normalizeClauseRef(ref) {
  return (ref || "").trim().toLowerCase().replace(/\s*,\s*/g, ",").replace(/\s+/g, " ");
}

function bigrams(text) {
  const padded = ` ${text} `;
  const grams = new Set();
  for (let i = 0; i < padded.length - 1; i++) grams.add(padded.slice(i, i + 2));
  return grams;
}

// Dice coefficient over character bigrams — cheap, deterministic, and forgiving of
// small wording edits (typo fixes, punctuation) without needing an LLM call per diff.
export function textSimilarity(a, b) {
  const na = normalizeQuestionText(a);
  const nb = normalizeQuestionText(b);
  if (!na && !nb) return 1;
  if (!na || !nb) return 0;
  if (na === nb) return 1;
  const ga = bigrams(na);
  const gb = bigrams(nb);
  let overlap = 0;
  for (const g of ga) if (gb.has(g)) overlap++;
  return (2 * overlap) / (ga.size + gb.size);
}

/**
 * @param {Array<{quest_id: string, baseline_question: string, iso_reference?: string, module_id?: string}>} oldQuestions
 * @param {Array<{quest_id: string, baseline_question: string, iso_reference?: string, module_id?: string}>} newQuestions
 * @returns {{
 *   unchanged: Array<{questId: string}>,
 *   reworded: Array<{questId: string, oldText: string, newText: string, oldIso: string, newIso: string, textChanged: boolean, isoChanged: boolean}>,
 *   renamed: Array<{oldQuestId: string, newQuestId: string, text: string, oldIso: string, newIso: string, similarity: number}>,
 *   added: Array<{questId: string, text: string}>,
 *   removed: Array<{questId: string, text: string}>
 * }}
 */
export function classifyTemplateDiff(oldQuestions, newQuestions) {
  const oldById = new Map(oldQuestions.map((q) => [q.quest_id, q]));
  const newById = new Map(newQuestions.map((q) => [q.quest_id, q]));

  const unchanged = [];
  const reworded = [];
  const unmatchedOld = [];
  const unmatchedNew = [];

  for (const [questId, oldQ] of oldById) {
    const newQ = newById.get(questId);
    if (!newQ) {
      unmatchedOld.push(oldQ);
      continue;
    }
    const textChanged = normalizeQuestionText(oldQ.baseline_question) !== normalizeQuestionText(newQ.baseline_question);
    const isoChanged = normalizeClauseRef(oldQ.iso_reference) !== normalizeClauseRef(newQ.iso_reference);
    if (!textChanged && !isoChanged) {
      unchanged.push({ questId });
    } else {
      reworded.push({
        questId, oldText: oldQ.baseline_question, newText: newQ.baseline_question,
        oldIso: oldQ.iso_reference || "", newIso: newQ.iso_reference || "",
        textChanged, isoChanged,
      });
    }
  }
  for (const [questId, newQ] of newById) {
    if (!oldById.has(questId)) unmatchedNew.push(newQ);
  }

  // Greedy best-match pairing among the leftovers: a quest_id that vanished and one
  // that appeared, with near-identical text, is almost certainly the same question
  // re-keyed by a re-exported sheet — not a real removal + a real addition.
  const candidates = [];
  for (const o of unmatchedOld) {
    for (const n of unmatchedNew) {
      const similarity = textSimilarity(o.baseline_question, n.baseline_question);
      if (similarity >= RENAME_SIMILARITY_THRESHOLD) {
        candidates.push({ o, n, similarity });
      }
    }
  }
  candidates.sort((a, b) => b.similarity - a.similarity);

  const renamed = [];
  const claimedOld = new Set();
  const claimedNew = new Set();
  for (const { o, n, similarity } of candidates) {
    if (claimedOld.has(o.quest_id) || claimedNew.has(n.quest_id)) continue;
    claimedOld.add(o.quest_id);
    claimedNew.add(n.quest_id);
    renamed.push({
      oldQuestId: o.quest_id, newQuestId: n.quest_id, text: n.baseline_question,
      oldIso: o.iso_reference || "", newIso: n.iso_reference || "", similarity,
    });
  }

  const removed = unmatchedOld
    .filter((o) => !claimedOld.has(o.quest_id))
    .map((o) => ({ questId: o.quest_id, text: o.baseline_question }));
  const added = unmatchedNew
    .filter((n) => !claimedNew.has(n.quest_id))
    .map((n) => ({ questId: n.quest_id, text: n.baseline_question }));

  return { unchanged, reworded, renamed, added, removed };
}

export function summarizeTemplateDiff(diff) {
  return {
    unchanged: diff.unchanged.length,
    reworded: diff.reworded.length,
    renamed: diff.renamed.length,
    added: diff.added.length,
    removed: diff.removed.length,
  };
}
