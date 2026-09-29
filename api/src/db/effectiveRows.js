// F-14 — the catalog rows a company sees: its own copy of each id when it has one,
// otherwise the global (company_id IS NULL) row. Exactly one row per id; `id` breaks
// ties between duplicate global rows so the choice is deterministic. Filter on
// archived_at *after* this, so archiving a tenant override hides the item instead of
// resurfacing the global row. `companyParam` is a placeholder such as "$1".

export const effectiveQuestions = (companyParam) =>
  `(SELECT DISTINCT ON (quest_id) * FROM questions
     WHERE company_id = ${companyParam} OR company_id IS NULL
     ORDER BY quest_id, company_id ASC NULLS LAST, id ASC)`;

export const effectiveModules = (companyParam) =>
  `(SELECT DISTINCT ON (module_id) * FROM modules
     WHERE company_id = ${companyParam} OR company_id IS NULL
     ORDER BY module_id, company_id ASC NULLS LAST, id ASC)`;

// F-22 — a client-supplied quest_id must be one this company can see (its own copy or
// a global template). Returns true when questId is empty (the field is optional).
export async function isQuestionVisible(query, companyId, questId) {
  if (questId === undefined || questId === null || questId === "") return true;
  if (typeof questId !== "string") return false;
  const r = await query(
    "SELECT 1 FROM questions WHERE quest_id = $1 AND (company_id = $2 OR company_id IS NULL) LIMIT 1",
    [questId, companyId]
  );
  return r.rows.length > 0;
}
