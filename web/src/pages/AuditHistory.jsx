import { useCallback, useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { apiFetch } from "../api/client.js";
import GlassSelect from "../components/GlassSelect.jsx";
import UserMenu from "../components/UserMenu.jsx";

const qid = (a) => a.questId || a.quest_id;

export default function AuditHistory({ token, user, company, onLogout, theme, onThemeToggle, isVerified }) {
  const navigate = useNavigate();
  const [questions, setQuestions] = useState([]);
  const [audits, setAudits] = useState([]);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const [moduleFilter, setModuleFilter] = useState("");
  const canOpenReview = ["ADMIN", "LEAD", "AUDITOR"].includes(user?.role);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [qs, as] = await Promise.all([
        apiFetch("/api/questions", { token }),
        apiFetch("/api/assessments?reviewStatus=AUDITED", { token }),
      ]);
      setQuestions(qs || []);
      const sorted = (as || []).slice().sort((a, b) =>
        new Date(b.auditedAt || b.audited_at || 0) - new Date(a.auditedAt || a.audited_at || 0)
      );
      setAudits(sorted);
      setError("");
    } catch (e) {
      setError(e.message || "Failed to load audit history");
    } finally {
      setLoading(false);
    }
  }, [token]);

  useEffect(() => { load(); }, [load]);

  const questionFor = (a) => {
    const id = qid(a);
    return questions.find(q => (q.questId || q.quest_id) === id) || {};
  };

  const moduleOptions = [
    { value: "", label: "All modules" },
    ...[...new Map(
      questions.map(q => [q.moduleId || q.module_id, q.moduleName || q.module_name || q.moduleId || q.module_id])
    ).entries()].map(([value, label]) => ({ value, label })),
  ];

  const filtered = moduleFilter
    ? audits.filter(a => (a.moduleId || a.module_id) === moduleFilter)
    : audits;

  return (
    <div className="review-shell fade-in">
      <div className="review-header">
        <div>
          <div className="logo">PRISM</div>
          <div className="review-title">Audit history</div>
        </div>
        <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
          {canOpenReview && (
            <button className="btn btn-ghost" onClick={() => navigate("/review")}>
              {user?.role === "AUDITOR" ? "Audit queue" : "Review workspace"}
            </button>
          )}
          <button className="btn btn-ghost" onClick={() => ((window.history.state?.idx ?? 0) > 0 ? navigate(-1) : navigate("/dashboard"))}>← Back</button>
          <button className="btn btn-ghost" onClick={load}>Refresh</button>
          <UserMenu
            user={user}
            company={company}
            theme={theme}
            onThemeToggle={onThemeToggle}
            onLogout={onLogout}
            isVerified={isVerified}
          />
        </div>
      </div>

      <div className="review-content">
        {error && <div className="error-text" style={{ marginBottom: 16 }}>{error}</div>}

        <section className="card" style={{ marginTop: 0 }}>
          <div className="section-title" style={{ display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: 12 }}>
            <span>Past audits ({filtered.length})</span>
            {moduleOptions.length > 1 && (
              <GlassSelect value={moduleFilter} onChange={setModuleFilter} options={moduleOptions} style={{ minWidth: 200 }} />
            )}
          </div>

          {loading ? (
            <p className="muted">Loading…</p>
          ) : filtered.length === 0 ? (
            <p className="muted">No controls have been audited yet.</p>
          ) : (
            <div className="admin-table">
              <div className="admin-row admin-row-header" style={{ gridTemplateColumns: "2fr 1fr 1fr 1.4fr" }}>
                <span>Control</span>
                <span>Module</span>
                <span>Audited by</span>
                <span>Audited on</span>
              </div>
              {filtered.map(a => {
                const q = questionFor(a);
                return (
                  <div
                    key={a.id}
                    className="admin-row"
                    style={{ gridTemplateColumns: "2fr 1fr 1fr 1.4fr", cursor: "pointer" }}
                    onClick={() => navigate(`/questions/${qid(a)}`)}
                  >
                    <span>
                      <span style={{ fontFamily: "var(--mono)", fontSize: 11, color: "var(--text3)" }}>{qid(a)}</span>
                      <span style={{ display: "block", fontSize: 13 }}>
                        {q.baselineQuestion || q.baseline_question || a.controlArea || a.control_area || "—"}
                      </span>
                    </span>
                    <span style={{ fontSize: 12 }}>{q.moduleName || q.module_name || a.moduleId || a.module_id || "—"}</span>
                    <span style={{ fontFamily: "var(--mono)", fontSize: 12 }}>{a.auditedBy || a.audited_by || "—"}</span>
                    <span style={{ fontSize: 12, color: "var(--text3)" }}>
                      {(a.auditedAt || a.audited_at) ? new Date(a.auditedAt || a.audited_at).toLocaleString() : "—"}
                    </span>
                  </div>
                );
              })}
            </div>
          )}
        </section>
      </div>
    </div>
  );
}
