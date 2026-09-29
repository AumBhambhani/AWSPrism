import { useMemo, useState } from "react";
import { apiFetch } from "../../api/client.js";

const GRID = { gridTemplateColumns: "2fr 90px 90px 1.4fr" };

// Admin → Departments: create/rename/delete departments, seed them from the
// self-assessment, and map controls (questions) onto owning departments.
export default function DepartmentsSection({ token, departments, questions, onChanged }) {
  const [newName, setNewName] = useState("");
  const [editing, setEditing] = useState(null); // { id, name }
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState("");
  const [err, setErr] = useState("");
  const [groupPicks, setGroupPicks] = useState({}); // ownerText -> Set(deptId)
  const [where, setWhere] = useState("top"); // which section shows msg/err
  const [assigningOwner, setAssigningOwner] = useState(null);

  const run = async (fn, okMsg, place = "top") => {
    setBusy(true); setErr(""); setMsg(""); setWhere(place);
    try {
      const result = await fn();
      if (okMsg) setMsg(typeof okMsg === "function" ? okMsg(result) : okMsg);
      await onChanged();
    } catch (e) {
      setErr(e.message);
    } finally {
      setBusy(false);
    }
  };

  const create = (e) => {
    e.preventDefault();
    const name = newName.trim();
    if (!name) return;
    run(async () => {
      await apiFetch("/api/departments", { token, method: "POST", body: JSON.stringify({ name }) });
      setNewName("");
    }, `Created “${name}”`);
  };

  const rename = () => run(async () => {
    await apiFetch(`/api/departments/${editing.id}`, { token, method: "PUT", body: JSON.stringify({ name: editing.name }) });
    setEditing(null);
  }, "Renamed");

  const remove = (d) => {
    if (!window.confirm(`Delete “${d.name}”? Its ${d.memberCount} member link(s) and ${d.controlCount} control link(s) will be removed.`)) return;
    run(() => apiFetch(`/api/departments/${d.id}`, { token, method: "DELETE" }), `Deleted “${d.name}”`);
  };

  const seed = () => run(
    () => apiFetch("/api/departments/seed-from-self-assessment", { token, method: "POST" }),
    (r) => (r.created.length ? `Created ${r.created.join(", ")}` : "Nothing new to create from the self-assessment")
  );

  const mapOwners = () => run(
    () => apiFetch("/api/departments/map-owners", { token, method: "POST" }),
    (r) => `Mapped ${r.mapped} control(s) from their owner text.`,
    "ownership"
  );

  // Controls with no owning department, grouped by their legacy owner text.
  const unassignedGroups = useMemo(() => {
    const groups = new Map();
    for (const q of questions || []) {
      if (q.departments && q.departments.length) continue;
      const key = (q.defaultOwner || "").trim() || "(no owner)";
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key).push(q.questId);
    }
    return [...groups.entries()].sort((a, b) => b[1].length - a[1].length);
  }, [questions]);

  // Until the admin touches a group, pre-select departments its owner text names
  // outright ("IT / Security" → IT and Security, if those departments exist).
  const suggestedPicks = (owner) => {
    const tokens = owner.split(/\s*(?:\/|,|&|\band\b)\s*/i).map((t) => t.trim().toLowerCase()).filter(Boolean);
    return new Set(departments.filter((d) => tokens.includes(d.name.trim().toLowerCase())).map((d) => d.id));
  };
  const picksFor = (owner) => groupPicks[owner] ?? suggestedPicks(owner);

  const togglePick = (owner, deptId) => setGroupPicks((prev) => {
    const next = new Set(prev[owner] ?? suggestedPicks(owner));
    if (next.has(deptId)) next.delete(deptId); else next.add(deptId);
    return { ...prev, [owner]: next };
  });

  const applyGroup = (owner, questIds) => {
    const ids = [...picksFor(owner)];
    if (!ids.length) return;
    const names = departments.filter((d) => ids.includes(d.id)).map((d) => d.name).join(", ");
    setAssigningOwner(owner);
    run(async () => {
      await apiFetch("/api/departments/controls", {
        token, method: "PUT", body: JSON.stringify({ questIds, departmentIds: ids }),
      });
      setGroupPicks((prev) => { const next = { ...prev }; delete next[owner]; return next; });
    }, `Assigned ${questIds.length} “${owner}” control(s) to ${names}.`, "ownership")
      .finally(() => setAssigningOwner(null));
  };

  const chip = (on) => ({
    borderRadius: 999, padding: "4px 12px", fontSize: 12, fontWeight: 600, cursor: "pointer", whiteSpace: "nowrap",
    border: `1.5px solid ${on ? "var(--accent)" : "var(--text3, #94a3b8)"}`,
    background: on ? "var(--accent)" : "transparent",
    color: on ? "#fff" : "var(--text2)",
  });

  return (
    <>
      <section className="admin-section">
        <h2>Departments</h2>
        <p className="muted" style={{ fontSize: 13, marginTop: -4 }}>
          Members of a department see its controls by default, and department leads can only approve their
          departments’ controls. People marked “All departments” — and every admin — keep seeing everything.
          {departments.length === 0 && " Until you create a department, nothing changes for anyone."}
        </p>

        {where === "top" && err && <p className="error-text">{err}</p>}
        {where === "top" && msg && <p style={{ color: "var(--accent2)", fontSize: 13 }}>{msg}</p>}

        <form onSubmit={create} style={{ display: "flex", gap: 8, margin: "12px 0" }}>
          <input
            type="text"
            placeholder="New department name"
            value={newName}
            onChange={(e) => setNewName(e.target.value)}
            maxLength={100}
            style={{ flex: 1 }}
          />
          <button type="submit" className="btn btn-primary" disabled={busy || !newName.trim()}>Add</button>
          <button type="button" className="btn btn-ghost" onClick={seed} disabled={busy}>
            Add from self-assessment
          </button>
        </form>

        <div className="admin-table">
          <div className="admin-row admin-row-header" style={GRID}>
            <span>Department</span>
            <span>Members</span>
            <span>Controls</span>
            <span>Actions</span>
          </div>
          {departments.map((d) => (
            <div key={d.id} className="admin-row" style={GRID}>
              <span>
                {editing?.id === d.id ? (
                  <input
                    type="text"
                    value={editing.name}
                    autoFocus
                    maxLength={100}
                    onChange={(e) => setEditing({ ...editing, name: e.target.value })}
                    onKeyDown={(e) => { if (e.key === "Enter") rename(); if (e.key === "Escape") setEditing(null); }}
                  />
                ) : d.name}
              </span>
              <span>{d.memberCount}</span>
              <span>{d.controlCount}</span>
              <span style={{ display: "flex", gap: 6 }}>
                {editing?.id === d.id ? (
                  <>
                    <button className="btn btn-ghost" onClick={rename} disabled={busy}>Save</button>
                    <button className="btn btn-ghost" onClick={() => setEditing(null)}>Cancel</button>
                  </>
                ) : (
                  <>
                    <button className="btn btn-ghost" onClick={() => setEditing({ id: d.id, name: d.name })}>Rename</button>
                    <button className="btn btn-ghost" onClick={() => remove(d)} disabled={busy}>Delete</button>
                  </>
                )}
              </span>
            </div>
          ))}
          {departments.length === 0 && (
            <div className="admin-row admin-row-empty"><span>No departments yet.</span></div>
          )}
        </div>
      </section>

      {departments.length > 0 && (
        <section className="admin-section">
          <h2>Control ownership</h2>
          <p className="muted" style={{ fontSize: 13, marginTop: -4 }}>
            {unassignedGroups.length === 0
              ? "Every control has an owning department."
              : `${unassignedGroups.reduce((n, [, ids]) => n + ids.length, 0)} control(s) have no department yet. Unassigned controls are visible to everyone but can only be approved by admins and “All departments” leads.`}
          </p>
          <button className="btn btn-primary" onClick={mapOwners} disabled={busy} style={{ margin: "8px 0 14px" }}>
            Auto-map from control owners
          </button>
          {where === "ownership" && err && <p className="error-text" role="alert">{err}</p>}
          {where === "ownership" && msg && (
            <p role="status" style={{ color: "var(--accent2)", fontSize: 13, marginTop: -4 }}>{msg}</p>
          )}
          {unassignedGroups.length > 0 && (
            <p className="muted" style={{ fontSize: 12, margin: "0 0 10px" }}>
              Or assign a group yourself: pick one or more departments under it, then press Assign.
            </p>
          )}

          {unassignedGroups.map(([owner, questIds]) => {
            const picks = picksFor(owner);
            return (
              <div key={owner} className="card" style={{ padding: 12, marginBottom: 8 }}>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 12, flexWrap: "wrap" }}>
                  <div>
                    <strong style={{ fontSize: 13 }}>{owner}</strong>
                    <span className="muted" style={{ fontSize: 12 }}> · {questIds.length} control(s)</span>
                  </div>
                  <button
                    className="btn btn-ghost"
                    disabled={busy || picks.size === 0}
                    title={picks.size === 0 ? "Pick at least one department below first" : undefined}
                    onClick={() => applyGroup(owner, questIds)}
                  >
                    {assigningOwner === owner ? "Assigning…" : picks.size ? `Assign to ${picks.size}` : "Assign"}
                  </button>
                </div>
                <div style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: 6, marginTop: 10 }}>
                  <span className="muted" style={{ fontSize: 12, marginRight: 2 }}>Departments:</span>
                  {departments.map((d) => (
                    <button
                      key={d.id}
                      type="button"
                      aria-pressed={picks.has(d.id)}
                      style={chip(picks.has(d.id))}
                      onClick={() => togglePick(owner, d.id)}
                    >
                      {picks.has(d.id) ? "✓ " : "+ "}{d.name}
                    </button>
                  ))}
                </div>
              </div>
            );
          })}
        </section>
      )}
    </>
  );
}
