import { useCallback, useEffect, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { apiFetch } from "../api/client.js";
import SeverityPill from "../components/SeverityPill.jsx";
import GlassSelect from "../components/GlassSelect.jsx";
import UserMenu from "../components/UserMenu.jsx";
import DepartmentScopeToggle from "../components/DepartmentScopeToggle.jsx";
import { useDepartmentScope } from "../hooks/useDepartmentScope.js";

const STATUS_OPTIONS = ["OPEN", "IN_PROGRESS", "OVERDUE", "COMPLETED", "CLOSED"];

function toDateInputValue(value) {
  if (!value) return "";
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return "";
  return d.toISOString().slice(0, 10);
}

function EditableField({ label, value, onChange, type = "text" }) {
  return (
    <label className="remediation-field">
      <span className="remediation-field-label">{label}</span>
      {type === "textarea" ? (
        <textarea value={value || ""} onChange={(e) => onChange(e.target.value)} rows={2} />
      ) : (
        <input type={type} value={value || ""} onChange={(e) => onChange(e.target.value)} />
      )}
    </label>
  );
}

export default function Remediation({ token, user, company, onLogout, theme, onThemeToggle }) {
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const canEdit = ["ADMIN", "LEAD", "CONTRIBUTOR"].includes(user?.role);
  const canDelete = ["ADMIN", "LEAD"].includes(user?.role);

  const findingIdFilter = searchParams.get("findingId") || "";
  const [statusFilter, setStatusFilter] = useState("");
  const [actions, setActions] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [successMessage, setSuccessMessage] = useState("");
  const [busyId, setBusyId] = useState(null);
  const [editingId, setEditingId] = useState(null);
  const [draft, setDraft] = useState({});
  const deptScope = useDepartmentScope(token, "remediation");
  const [questDepartments, setQuestDepartments] = useState(new Map());

  // Owning departments per control — only needed once the user is scoped.
  useEffect(() => {
    if (!deptScope.scoped) return;
    apiFetch("/api/questions", { token })
      .then((qs) => setQuestDepartments(new Map((qs || []).map((q) => [q.questId, q.departments || []]))))
      .catch(() => {});
  }, [token, deptScope.scoped]);

  const visibleActions = actions.filter((a) => deptScope.matches(questDepartments.get(a.questId)));

  const load = useCallback(async () => {
    const params = new URLSearchParams();
    if (statusFilter) params.set("status", statusFilter);
    if (findingIdFilter) params.set("findingId", findingIdFilter);
    const qs = params.toString();
    const data = await apiFetch(`/api/actions${qs ? `?${qs}` : ""}`, { token });
    setActions(data || []);
  }, [token, statusFilter, findingIdFilter]);

  useEffect(() => {
    setLoading(true);
    load().catch((e) => setError(e.message)).finally(() => setLoading(false));
  }, [load]);

  const startEdit = (action) => {
    setEditingId(action.id);
    setDraft({
      owner: action.owner || "",
      status: action.status || "OPEN",
      dueDate: toDateInputValue(action.dueDate),
      closureEvidenceLink: action.closureEvidenceLink || "",
      reviewer: action.reviewer || "",
      closureDate: toDateInputValue(action.closureDate),
      notes: action.notes || "",
    });
  };

  const cancelEdit = () => {
    setEditingId(null);
    setDraft({});
  };

  const saveEdit = async (actionId) => {
    setBusyId(actionId);
    setError("");
    setSuccessMessage("");
    try {
      await apiFetch(`/api/actions/${actionId}`, { token, method: "PUT", body: JSON.stringify(draft) });
      setSuccessMessage("Remediation plan updated.");
      setTimeout(() => setSuccessMessage(""), 4000);
      setEditingId(null);
      await load();
    } catch (err) {
      setError(err.message);
    } finally {
      setBusyId(null);
    }
  };

  const handleComplete = async (action) => {
    setBusyId(action.id);
    setError("");
    setSuccessMessage("");
    try {
      await apiFetch(`/api/actions/${action.id}`, {
        token,
        method: "PUT",
        body: JSON.stringify({ status: "COMPLETED", closureDate: toDateInputValue(new Date()) }),
      });
      if (action.questId) {
        navigate(`/tracker?quest=${encodeURIComponent(action.questId)}`);
      } else {
        setSuccessMessage("Remediation plan marked complete.");
        setTimeout(() => setSuccessMessage(""), 4000);
        await load();
      }
    } catch (err) {
      setError(err.message);
      setBusyId(null);
    }
  };

  const handleDelete = async (actionId) => {
    if (!window.confirm("Delete this remediation plan? This cannot be undone.")) return;
    setBusyId(actionId);
    setError("");
    try {
      await apiFetch(`/api/actions/${actionId}`, { token, method: "DELETE" });
      await load();
    } catch (err) {
      setError(err.message);
    } finally {
      setBusyId(null);
    }
  };

  const clearFindingFilter = () => {
    const next = new URLSearchParams(searchParams);
    next.delete("findingId");
    setSearchParams(next);
  };

  if (loading) {
    return <div className="admin-container"><div className="admin-card"><p>Loading…</p></div></div>;
  }

  return (
    <div className="admin-container">
      <div className="admin-card">
        <div className="admin-header">
          <div>
            <p className="admin-kicker">Remediation</p>
            <h1>{company?.name || "Company"}</h1>
            {company?.domain && <p className="admin-domain">{company.domain}</p>}
          </div>
          <div className="admin-actions">
            <button className="btn btn-ghost" onClick={() => navigate("/findings")}>Findings</button>
            <button className="btn btn-ghost" onClick={() => navigate("/dashboard")}>Dashboard</button>
            <UserMenu user={user} company={company} theme={theme} onThemeToggle={onThemeToggle} onLogout={onLogout} />
          </div>
        </div>

        {error && <p className="error-text">{error}</p>}
        {successMessage && <p style={{ color: "var(--green)" }}>{successMessage}</p>}

        <div style={{ display: "flex", gap: 12, marginTop: 16, marginBottom: 14, flexWrap: "wrap", alignItems: "center" }}>
          <GlassSelect
            value={statusFilter}
            onChange={(val) => setStatusFilter(val)}
            options={[
              { value: "", label: "All statuses" },
              ...STATUS_OPTIONS.map((s) => ({ value: s, label: s.replace(/_/g, " ") })),
            ]}
          />
          <DepartmentScopeToggle scope={deptScope} />
          {findingIdFilter && (
            <span className="remediation-filter-pill">
              Filtered to finding #{findingIdFilter}
              <button className="btn btn-ghost" onClick={clearFindingFilter}>Clear</button>
            </span>
          )}
        </div>

        <div className="remediation-list">
          {visibleActions.length === 0 && (
            <div className="admin-row admin-row-empty"><span>No remediation plans match these filters.</span></div>
          )}
          {visibleActions.map((a) => {
            const isEditing = editingId === a.id;
            const isBusy = busyId === a.id;
            return (
              <div key={a.id} className={`remediation-card${a.isOverdue ? " remediation-card-overdue" : ""}`}>
                <div className="remediation-card-header">
                  <div>
                    <div className="remediation-card-title">{a.defeatedQuest || a.notes || `Remediation #${a.id}`}</div>
                    {a.findingId ? (
                      <div className="remediation-source">
                        <SeverityPill severity={a.findingSeverity} />
                        <span>{a.findingTitle}</span>
                        <span className="remediation-source-status">({String(a.findingStatus || "").replace(/_/g, " ")})</span>
                      </div>
                    ) : (
                      <div className="remediation-source remediation-source-manual">Manually created — not linked to a finding</div>
                    )}
                    {a.questId && <div className="remediation-quest">Linked question: {a.questId}</div>}
                  </div>
                  <div className="remediation-card-badges">
                    {a.isOverdue && <span className="remediation-overdue-pill">Overdue</span>}
                    <span className="remediation-status-pill">{String(a.status || "OPEN").replace(/_/g, " ")}</span>
                  </div>
                </div>

                {a.remediationTip && (
                  <div className="remediation-tip">
                    <div className="remediation-tip-label">How to fix this</div>
                    {a.remediationTip.immediateAction && (
                      <p className="remediation-tip-immediate"><strong>Do now:</strong> {a.remediationTip.immediateAction}</p>
                    )}
                    {a.remediationTip.steps?.length > 0 && (
                      <ol className="remediation-tip-steps">
                        {a.remediationTip.steps.map((step, i) => <li key={i}>{step}</li>)}
                      </ol>
                    )}
                    {a.remediationTip.targetArchitecture && (
                      <p className="remediation-tip-target"><strong>Target state:</strong> {a.remediationTip.targetArchitecture}</p>
                    )}
                  </div>
                )}

                {isEditing ? (
                  <>
                    <div className="remediation-fields">
                      <EditableField label="Owner" value={draft.owner} onChange={(v) => setDraft({ ...draft, owner: v })} />
                      <label className="remediation-field">
                        <span className="remediation-field-label">Status</span>
                        <GlassSelect
                          value={draft.status}
                          onChange={(v) => setDraft({ ...draft, status: v })}
                          options={STATUS_OPTIONS.map((s) => ({ value: s, label: s.replace(/_/g, " ") }))}
                        />
                      </label>
                      <EditableField label="Due date" type="date" value={draft.dueDate} onChange={(v) => setDraft({ ...draft, dueDate: v })} />
                      <EditableField label="Reviewer" value={draft.reviewer} onChange={(v) => setDraft({ ...draft, reviewer: v })} />
                      <EditableField label="Closure date" type="date" value={draft.closureDate} onChange={(v) => setDraft({ ...draft, closureDate: v })} />
                      <EditableField label="Closure evidence link" value={draft.closureEvidenceLink} onChange={(v) => setDraft({ ...draft, closureEvidenceLink: v })} />
                    </div>
                    <EditableField label="Notes" type="textarea" value={draft.notes} onChange={(v) => setDraft({ ...draft, notes: v })} />
                    <div className="remediation-card-actions">
                      <button className="btn btn-ghost" disabled={isBusy} onClick={cancelEdit}>Cancel</button>
                      <button className="btn btn-primary" disabled={isBusy} onClick={() => saveEdit(a.id)}>Save</button>
                    </div>
                  </>
                ) : (
                  <>
                    <div className="remediation-summary">
                      <span><strong>Owner:</strong> {a.owner || "Unassigned"}</span>
                      <span><strong>Due:</strong> {a.dueDate ? new Date(a.dueDate).toLocaleDateString() : "No due date"}</span>
                      {a.reviewer && <span><strong>Reviewer:</strong> {a.reviewer}</span>}
                      {a.closureDate && <span><strong>Closed:</strong> {new Date(a.closureDate).toLocaleDateString()}</span>}
                      {a.closureEvidenceLink && (
                        <a href={a.closureEvidenceLink} target="_blank" rel="noreferrer noopener">Closure evidence ↗</a>
                      )}
                    </div>
                    {a.notes && <p className="remediation-notes">{a.notes}</p>}
                    <div className="remediation-card-actions">
                      {canEdit && !["COMPLETED", "CLOSED"].includes(String(a.status).toUpperCase()) && (
                        <button className="btn btn-primary" disabled={isBusy} onClick={() => handleComplete(a)}>
                          {a.questId ? "Mark Complete & Answer Question" : "Mark as Complete"}
                        </button>
                      )}
                      {canEdit && <button className="btn btn-ghost" disabled={isBusy} onClick={() => startEdit(a)}>Edit</button>}
                      {canDelete && <button className="btn btn-ghost" disabled={isBusy} onClick={() => handleDelete(a.id)}>Delete</button>}
                    </div>
                  </>
                )}
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
