import { query } from "../db/index.js";

// A test_control_mappings row is (test_key, framework, iso_reference) where iso_reference
// holds whatever reference that framework uses — an ISO Annex A clause, a DPDPA
// control_area, a GDPR article, a SOC 2 criterion, etc. A question is matched two ways,
// unioned:
//   1. legacy columns — questions.iso_reference / questions.control_area equal the ref
//      (covers ISO27001 clause rows and DPDPA control_area rows).
//   2. canonical crosswalk — question_framework_controls(framework_key, control_reference)
//      equals the mapping's (framework, iso_reference), so evidence reaches a canonical
//      question that carries a GDPR/SOC 2/… ref from a company's framework import even
//      when its own legacy columns don't match the connector's ISO clause.

// Resolves the quest_ids a single test_key maps to, for one company.
export async function resolveQuestionsForTestKey({ companyId, testKey }) {
  const result = await query(
    `SELECT DISTINCT q.quest_id
       FROM test_control_mappings tcm
       JOIN questions q
         ON q.company_id = $1
        AND (q.iso_reference = tcm.iso_reference OR q.control_area = tcm.iso_reference)
      WHERE tcm.test_key = $2
     UNION
     SELECT DISTINCT qfc.quest_id
       FROM test_control_mappings tcm
       JOIN question_framework_controls qfc
         ON qfc.company_id = $1
        AND qfc.framework_key = tcm.framework
        AND qfc.control_reference = tcm.iso_reference
      WHERE tcm.test_key = $2
     ORDER BY quest_id`,
    [companyId, testKey]
  );
  return result.rows.map((r) => r.quest_id);
}

// Batched version: resolves quest_ids for several test_keys at once (one query), returning
// a Map<testKey, string[]>. Used where per-row resolution would otherwise be N+1.
export async function resolveQuestionsForTestKeys({ companyId, testKeys }) {
  const map = new Map(testKeys.map((k) => [k, []]));
  if (testKeys.length === 0) return map;

  const result = await query(
    `SELECT DISTINCT tcm.test_key, q.quest_id
       FROM test_control_mappings tcm
       JOIN questions q
         ON q.company_id = $1
        AND (q.iso_reference = tcm.iso_reference OR q.control_area = tcm.iso_reference)
      WHERE tcm.test_key = ANY($2::text[])
     UNION
     SELECT DISTINCT tcm.test_key, qfc.quest_id
       FROM test_control_mappings tcm
       JOIN question_framework_controls qfc
         ON qfc.company_id = $1
        AND qfc.framework_key = tcm.framework
        AND qfc.control_reference = tcm.iso_reference
      WHERE tcm.test_key = ANY($2::text[])
     ORDER BY test_key, quest_id`,
    [companyId, testKeys]
  );
  for (const row of result.rows) {
    map.get(row.test_key)?.push(row.quest_id);
  }
  return map;
}
