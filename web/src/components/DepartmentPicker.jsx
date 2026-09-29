// "All departments" switch plus a multi-select of the company's departments.
// value: { allDepartments: boolean, departmentIds: number[] }
export default function DepartmentPicker({ departments, value, onChange, compact = false }) {
  const all = value?.allDepartments !== false;
  const selected = new Set(value?.departmentIds || []);

  const toggleDept = (id) => {
    const next = new Set(selected);
    if (next.has(id)) next.delete(id); else next.add(id);
    onChange({ allDepartments: false, departmentIds: [...next] });
  };

  return (
    <div className="dept-picker" style={{ display: "flex", flexDirection: "column", gap: 8 }}>
      <label style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 13, cursor: "pointer" }}>
        <input
          type="checkbox"
          checked={all}
          onChange={(e) => onChange({ allDepartments: e.target.checked, departmentIds: e.target.checked ? [] : [...selected] })}
        />
        All departments
        {!compact && <span className="muted" style={{ fontSize: 12 }}>— sees and reviews everything</span>}
      </label>
      {!all && (
        <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
          {departments.length === 0 && (
            <span className="muted" style={{ fontSize: 12 }}>No departments yet — create them under Departments.</span>
          )}
          {departments.map((d) => {
            const on = selected.has(d.id);
            return (
              <button
                key={d.id}
                type="button"
                onClick={() => toggleDept(d.id)}
                aria-pressed={on}
                style={{
                  borderRadius: 999, padding: "4px 10px", fontSize: 12, cursor: "pointer",
                  border: `1px solid ${on ? "var(--accent)" : "var(--border2)"}`,
                  background: on ? "rgba(99,102,241,0.12)" : "transparent",
                  color: on ? "var(--accent)" : "var(--text2)",
                }}
              >
                {on ? "✓ " : ""}{d.name}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}
