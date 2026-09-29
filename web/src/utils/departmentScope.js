// Client mirror of api/src/utils/departmentScope.js questInScope.
// `me` is the GET /api/departments/me payload; `departments` is the owning
// departments array the API attaches to questions and assessments.
export function inScope(departments, me) {
  if (!me || !me.enabled || me.all) return true;
  const mine = new Set(me.departmentIds || []);
  return (departments || []).some((d) => mine.has(d.id));
}

export function departmentLabel(departments, fallback = "") {
  return departments && departments.length ? departments.map((d) => d.name).join(", ") : fallback;
}
