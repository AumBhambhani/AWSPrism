// The one required-department order, shared by the self-assessment route (which
// department set the completion gate enforces) and the report renderer (which
// order departments are listed in). Keeping this in one file means the report's
// department order can never drift from the flow's — see web/src/pages/
// SelfAssessment.jsx's own `orderDepts`, which mirrors this by hand for the UI
// (it cannot import server code).

export const REQUIRED_DEPARTMENTS = ["IT", "HR"];

/**
 * Reorders an EXISTING list of departments — IT first, then HR, then everyone
 * else in the order given. Never invents a department that isn't present (a
 * company that hasn't submitted IT yet must not get a blank "IT" block in a
 * report) — for that, see routes/selfAssessment.js's withRequiredDepartments,
 * which is the "what must still be submitted" gate, a different question.
 * @param {string[]} departments
 * @returns {string[]}
 */
export function orderDepartments(departments) {
  const seen = new Set();
  const out = [];
  for (const req of REQUIRED_DEPARTMENTS) {
    const match = (departments || []).find(d => String(d).trim().toLowerCase() === req.toLowerCase());
    if (match && !seen.has(match.toLowerCase())) { out.push(match); seen.add(match.toLowerCase()); }
  }
  for (const d of departments || []) {
    const key = String(d).trim().toLowerCase();
    if (!seen.has(key)) { out.push(d); seen.add(key); }
  }
  return out;
}
