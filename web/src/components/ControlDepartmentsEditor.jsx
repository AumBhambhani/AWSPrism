import { useEffect, useState } from "react";
import { apiFetch } from "../api/client.js";

// Shows a control's owning departments; ADMINs can change them inline.
// Falls back to the legacy default_owner text while the company has no departments.
export default function ControlDepartmentsEditor({ token, user, questId, departments, fallback, onSaved }) {
  const [all, setAll] = useState(null); // company departments, loaded lazily for admins
  const [editing, setEditing] = useState(false);
  const [picked, setPicked] = useState(new Set());
  const [err, setErr] = useState("");
  const isAdmin = user?.role === "ADMIN";

  useEffect(() => {
    if (!isAdmin) return;
    apiFetch("/api/departments", { token }).then(setAll).catch(() => setAll([]));
  }, [token, isAdmin]);

  const label = departments?.length ? departments.map((d) => d.name).join(", ") : (fallback || "—");
  const enabled = (all?.length || 0) > 0;

  const start = () => { setPicked(new Set((departments || []).map((d) => d.id))); setErr(""); setEditing(true); };
  const toggle = (id) => setPicked((prev) => {
    const next = new Set(prev);
    if (next.has(id)) next.delete(id); else next.add(id);
    return next;
  });
  const save = async () => {
    try {
      const res = await apiFetch(`/api/departments/controls/${encodeURIComponent(questId)}`, {
        token, method: "PUT", body: JSON.stringify({ departmentIds: [...picked] }),
      });
      setEditing(false);
      onSaved?.(res.departments);
    } catch (e) {
      setErr(e.message);
    }
  };

  if (!editing) {
    return (
      <span style={{ display: "inline-flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
        <span>{label}</span>
        {isAdmin && enabled && (
          <button className="btn btn-ghost" style={{ padding: "2px 8px", fontSize: 12 }} onClick={start}>Edit</button>
        )}
      </span>
    );
  }

  return (
    <span style={{ display: "inline-flex", flexDirection: "column", gap: 6 }}>
      <span style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
        {all.map((d) => {
          const on = picked.has(d.id);
          return (
            <button
              key={d.id}
              type="button"
              onClick={() => toggle(d.id)}
              aria-pressed={on}
              style={{
                borderRadius: 999, padding: "3px 9px", fontSize: 12, cursor: "pointer",
                border: `1px solid ${on ? "var(--accent)" : "var(--border2)"}`,
                background: on ? "rgba(99,102,241,0.12)" : "transparent",
                color: on ? "var(--accent)" : "var(--text2)",
              }}
            >
              {on ? "✓ " : ""}{d.name}
            </button>
          );
        })}
      </span>
      <span style={{ display: "flex", gap: 6 }}>
        <button className="btn btn-primary" style={{ padding: "3px 10px", fontSize: 12 }} onClick={save}>Save</button>
        <button className="btn btn-ghost" style={{ padding: "3px 10px", fontSize: 12 }} onClick={() => setEditing(false)}>Cancel</button>
      </span>
      {err && <span className="error-text" style={{ fontSize: 12 }}>{err}</span>}
    </span>
  );
}
