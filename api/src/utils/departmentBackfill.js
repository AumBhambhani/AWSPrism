import { query } from "../db/index.js";

// Maps legacy questions.default_owner free text ("IT / Security", "CISO / HR",
// "Privacy / Legal / Business Owners") onto a company's departments.
//
// Owner text mixes department names with role titles and lists them in arbitrary
// order, so each "/"-separated token is matched first literally against the
// company's department names, then through OWNER_ALIASES onto a canonical
// department name. Departments are never created from owner text — unmatched
// tokens are reported back so an admin can create or map them.

export const CANONICAL_DEPARTMENTS = [
  "IT", "Security", "Privacy", "Legal", "HR", "Engineering", "Product", "Operations",
  "Management", "GRC", "Business", "Procurement", "Marketing", "Support",
  "Internal Audit", "Data Governance", "Finance",
];

// Lower-case token → canonical department. Drafted from every distinct
// default_owner string in use (see __tests__/fixtures/defaultOwnerStrings.json).
export const OWNER_ALIASES = {
  "ciso": "Security",
  "soc": "Security",
  "incident response team": "Security",
  "dpo": "Privacy",
  "data protection officer": "Privacy",
  "business owner": "Business",
  "business owners": "Business",
  "process owners": "Business",
  "data owners": "Business",
  "system owners": "IT",
  "network": "IT",
  "cloud": "IT",
  "cloud operations": "IT",
  "sre": "Engineering",
  "qa": "Engineering",
  "architecture": "Engineering",
  "data": "Data Governance",
  "executive management": "Management",
  "bcm": "Operations",
  "facilities": "Operations",
  "customer support": "Support",
  "customer success": "Support",
  "vendor management": "Procurement",
  "communications": "Marketing",
  "compliance": "GRC",
  "risk": "GRC",
};

const CANONICAL_BY_LOWER = new Map(CANONICAL_DEPARTMENTS.map((n) => [n.toLowerCase(), n]));

export function tokeniseOwner(text) {
  if (typeof text !== "string") return [];
  return text
    .split(/\s*(?:\/|,|&|\band\b)\s*/i)
    .map((t) => t.trim())
    .filter(Boolean);
}

export function canonicalDepartment(token) {
  const key = String(token || "").trim().toLowerCase();
  return CANONICAL_BY_LOWER.get(key) || OWNER_ALIASES[key] || null;
}

// departments: [{ id, name }] for one company.
export function matchOwnerToDepartments(ownerText, departments) {
  const byName = new Map(departments.map((d) => [d.name.trim().toLowerCase(), d.id]));
  const ids = [];
  const unmatched = [];
  for (const token of tokeniseOwner(ownerText)) {
    let id = byName.get(token.toLowerCase());
    if (id === undefined) {
      const canonical = canonicalDepartment(token);
      if (canonical) id = byName.get(canonical.toLowerCase());
    }
    if (id === undefined) unmatched.push(token);
    else if (!ids.includes(id)) ids.push(id);
  }
  return { ids, unmatched };
}

// Maps every not-yet-mapped control of the company. Controls an admin has already
// assigned departments to are left alone. Returns how many controls gained an
// owner and which owner strings still leave controls unassigned.
export async function mapOwnersToDepartments(companyId) {
  const deptResult = await query("SELECT id, name FROM departments WHERE company_id = $1", [companyId]);
  const departments = deptResult.rows;

  const questResult = await query(
    `SELECT q.quest_id, q.default_owner FROM (
       SELECT DISTINCT ON (quest_id) quest_id, default_owner
       FROM questions
       WHERE (company_id = $1 OR company_id IS NULL) AND archived_at IS NULL
       ORDER BY quest_id, company_id NULLS LAST
     ) q
     WHERE NOT EXISTS (
       SELECT 1 FROM question_departments qd WHERE qd.company_id = $1 AND qd.quest_id = q.quest_id
     )`,
    [companyId]
  );

  let mapped = 0;
  const unassigned = new Map();
  for (const row of questResult.rows) {
    const { ids } = departments.length ? matchOwnerToDepartments(row.default_owner, departments) : { ids: [] };
    if (ids.length === 0) {
      const key = (row.default_owner || "").trim() || "(no owner)";
      unassigned.set(key, (unassigned.get(key) || 0) + 1);
      continue;
    }
    await query(
      `INSERT INTO question_departments (company_id, quest_id, department_id)
       SELECT $1, $2, UNNEST($3::int[]) ON CONFLICT DO NOTHING`,
      [companyId, row.quest_id, ids]
    );
    mapped += 1;
  }

  return {
    mapped,
    unassigned: [...unassigned.entries()]
      .map(([ownerText, questCount]) => ({ ownerText, questCount }))
      .sort((a, b) => b.questCount - a.questCount),
  };
}
