import { useCallback, useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { apiFetch, apiDownload } from "../api/client.js";
import RetryBanner from "../components/RetryBanner.jsx";
import EvidenceAiPanel from "../components/EvidenceAiPanel.jsx";
import UserMenu from "../components/UserMenu.jsx";
import VaultPinPrompt from "../components/VaultPinPrompt.jsx";
import { isVaultPinError } from "../utils/vaultSession.js";
import DepartmentScopeToggle from "../components/DepartmentScopeToggle.jsx";
import { useDepartmentScope } from "../hooks/useDepartmentScope.js";
import { departmentLabel } from "../utils/departmentScope.js";

export default function Review({ token, user, company, onLogout, theme, onThemeToggle, isVerified }) {
  const isAuditor = user?.role === "AUDITOR";
  // The auditor stage runs on controls a reviewer has already approved (FINISHED);
  // the reviewer stage runs on freshly Submitted controls.
  const queueStatus = isAuditor ? "FINISHED" : "Submitted";

  const [assessments, setAssessments] = useState([]);
  const [questions, setQuestions] = useState([]);
  const [evidence, setEvidence] = useState([]);
  const [error, setError] = useState("");
  const [notesModal, setNotesModal] = useState(null); // { id, status, notes }
  const [retryError, setRetryError] = useState(null);
  const [lastFailedAction, setLastFailedAction] = useState(null);
  const [vaultLocked, setVaultLocked] = useState(false);
  const notesRef = useRef("");
  const deptScope = useDepartmentScope(token, "review");
  const navigate = useNavigate();

  const load = useCallback(async () => {
    try {
      const [qs, as, ev] = await Promise.all([
        apiFetch("/api/questions", { token }),
        apiFetch(`/api/assessments?reviewStatus=${encodeURIComponent(queueStatus)}`, { token }),
        apiFetch("/api/evidence", { token })
      ]);
      setQuestions(qs || []);
      // Deduplicate: keep only the latest submission per (questId, month) pair
      const submitted = (as || []).filter(a => (a.reviewStatus || a.review_status) === queueStatus);
      const seen = new Map();
      for (const a of submitted) {
        const key = `${a.questId || a.quest_id}__${a.month || ""}`;
        if (!seen.has(key) || a.id > seen.get(key).id) seen.set(key, a);
      }
      const deduped = [...seen.values()];
      setAssessments(deduped);

      // Load vault evidence linked to the submitted quests
      const questIds = [...new Set(deduped.map(a => a.questId || a.quest_id).filter(Boolean))];
      let vaultLinks = [];
      let locked = false;
      if (questIds.length > 0) {
        try {
          vaultLinks = await apiFetch(`/api/vault/quest-links?questIds=${questIds.join(",")}`, { token });
        } catch (e) {
          // A PIN is set and this session hasn't unlocked the vault — ask for it.
          locked = isVaultPinError(e);
        }
      }
      setVaultLocked(locked);
      setEvidence([...(ev || []), ...(vaultLinks || []).map(v => ({ ...v, _fromVault: true }))]);
      setError("");
      setRetryError(null);
    } catch (e) {
      if (e.code === "TIMEOUT" || e.code === "COOLDOWN" || e.code === "QUEUE_FULL") {
        setRetryError(e);
        setLastFailedAction(() => load);
      } else {
        setError(e.message);
      }
    }
  }, [token, queueStatus]);

  useEffect(() => { load(); }, [load]);

  const downloadEvidence = async (id, filename) => {
    try {
      const res = await fetch(apiDownload(`/api/evidence/${id}/download`), {
        headers: { Authorization: `Bearer ${token}` }
      });
      if (!res.ok) throw new Error(`Download failed (${res.status})`);
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = filename || "evidence";
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
    } catch (e) {
      setError(e.message || "Download failed");
    }
  };

  // Auditors can view evidence inline but not download it.
  const viewEvidence = async (id) => {
    try {
      const res = await fetch(apiDownload(`/api/evidence/${id}/view`), {
        headers: { Authorization: `Bearer ${token}` }
      });
      if (!res.ok) throw new Error(`View failed (${res.status})`);
      window.open(URL.createObjectURL(await res.blob()), "_blank", "noopener");
    } catch (e) {
      setError(e.message || "View failed");
    }
  };

  const isReviewer = user?.role === "ADMIN" || user?.role === "LEAD";
  // The status an "approve" click moves a row to: auditor signs off (AUDITED),
  // reviewer approves (FINISHED).
  const approveStatus = isAuditor ? "AUDITED" : "FINISHED";

  const promptUpdateAssessment = (id, status) => {
    notesRef.current = "";
    setNotesModal({ id, status, notes: "" });
  };

  const confirmUpdateAssessment = async () => {
    const { id, status } = notesModal;
    const notes = notesRef.current;
    setNotesModal(null);
    try {
      const body = isAuditor
        ? { reviewStatus: status, auditedBy: user?.email, auditorNotes: notes || undefined }
        : { reviewStatus: status, reviewedBy: user?.email, reviewerNotes: notes || undefined };
      await apiFetch(`/api/assessments/${id}`, {
        token,
        method: "PUT",
        body: JSON.stringify(body)
      });
      await load();
    } catch (e) {
      setError(e.message || "Update failed");
    }
  };

  const isApproveStatus = (s) => s === "FINISHED" || s === "AUDITED";

  const qid = a => a.questId || a.quest_id;

  // Soft scope for the list; approve/reject is enforced server-side for scoped LEADs,
  // so out-of-scope rows (visible under "All") get disabled buttons.
  const visible = assessments.filter(a => deptScope.matches(a.departments));
  const canActOn = (a) => user?.role !== "LEAD" || deptScope.isInScope(a.departments);
  const outOfScopeTitle = (a) =>
    `Owned by ${departmentLabel(a.departments, "no department")} — outside your departments`;

  return (
    <div className="review-shell fade-in">
      <div className="review-header">
        <div>
          <div className="logo">PRISM</div>
          <div className="review-title">Review workspace</div>
        </div>
        <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
          <button className="btn btn-ghost" onClick={() => (window.history.state?.idx ?? 0) > 0 ? navigate(-1) : navigate("/dashboard")}>← Back</button>
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
        {retryError && (
          <RetryBanner
            error={retryError}
            onRetry={() => {
              setRetryError(null);
              if (lastFailedAction) lastFailedAction();
            }}
            onDismiss={() => setRetryError(null)}
          />
        )}
        {error && <div className="error-text" style={{ marginBottom: 16 }}>{error}</div>}
        {vaultLocked && (
          <div style={{ marginBottom: 16 }}>
            <VaultPinPrompt token={token} onUnlocked={load} message="Vault evidence linked to these assessments is protected by the vault PIN." />
          </div>
        )}

        <section className="card" style={{ marginTop: 0 }}>
          <div className="section-title">
            <span>{isAuditor ? "Awaiting audit sign-off" : "Submitted assessments"} ({visible.length})</span>
            <DepartmentScopeToggle scope={deptScope} style={{ marginLeft: 12, verticalAlign: "middle" }} />
          </div>

          {visible.length === 0 ? (
            <p className="muted">
              {isAuditor ? "No assessments awaiting audit." : "No assessments awaiting review."}
            </p>
          ) : (
            <div className="list">
              {visible.map(a => {
                const questId = qid(a);
                const q = questions.find(q => q.questId === questId || q.quest_id === questId) || {};
                const evItems = evidence.filter(e => (e.questId || e.quest_id) === questId && (!a.month || e.month === a.month || e.month == null));

                return (
                  <div key={a.id} className="list-item">
                    <div style={{ display: "flex", justifyContent: "space-between", gap: 16, flexWrap: "wrap" }}>
                      <div style={{ flex: 1, minWidth: 300 }}>
                        <div className="list-item-title">
                          {a.month} — {a.answer}
                        </div>
                        <div className="list-item-meta">
                          Level {a.currentLevel} | {a.reviewStatus || a.review_status} | Submitted by: {a.submittedBy || a.submitted_by}
                        </div>
                        <div style={{ display: "flex", gap: 6, marginTop: 6, flexWrap: "wrap" }}>
                          {a.comments && (
                            <span
                              title={a.comments.slice(0, 100)}
                              style={{ fontSize: 11, fontWeight: 600, padding: "2px 8px", borderRadius: 4, background: "var(--bg4)", color: "var(--text2)", border: "1px solid var(--border2)", cursor: "default" }}
                            >
                              📝 Notes
                            </span>
                          )}
                          {(a.reviewerNotes || a.reviewer_notes) && (
                            <span
                              title={(a.reviewerNotes || a.reviewer_notes).slice(0, 100)}
                              style={{ fontSize: 11, fontWeight: 600, padding: "2px 8px", borderRadius: 4, background: "var(--bg4)", color: "var(--amber)", border: "1px solid var(--border2)", cursor: "default" }}
                            >
                              👁 Review
                            </span>
                          )}
                          {(a.autoRevertedAt || a.auto_reverted_at) && (
                            <span
                              title={a.autoRevertedReason || a.auto_reverted_reason || "Previously approved evidence failed re-verification."}
                              style={{ fontSize: 11, fontWeight: 600, padding: "2px 8px", borderRadius: 4, background: "rgba(239,68,68,0.12)", color: "#ef4444", border: "1px solid rgba(239,68,68,0.3)", cursor: "default" }}
                            >
                              ⚠ Auto-reverted
                            </span>
                          )}
                        </div>

                        <div style={{ marginTop: 16 }}>
                          <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 4 }}>
                            <div className="section-label" style={{ margin: 0 }}>Question ID: {questId}</div>
                            {q.priority && (
                              <span className={`priority-badge priority-${q.priority.toLowerCase()}`}>{q.priority}</span>
                            )}
                          </div>
                          <div className="list-item-title" style={{ fontSize: 14, marginTop: 4, marginBottom: 8 }}>
                            {q.controlArea || q.control_area}
                          </div>
                          <div className="q-text" style={{ fontSize: 13 }}>
                            {q.baselineQuestion || q.baseline_question || "—"}
                          </div>
                          <div className="section-label" style={{ marginTop: 12 }}>Level 3+ criteria</div>
                          <div className="level3-text">{q.level3YesCriteria || q.level3_yes_criteria || "—"}</div>
                          <div className="section-label" style={{ marginTop: 12 }}>Required evidence</div>
                          <div className="muted">{q.requiredEvidence || q.required_evidence || "—"}</div>
                        </div>

                        {a.comments && (
                          <div style={{ marginTop: 16 }} className="list-item-comment">
                            {a.comments}
                          </div>
                        )}

                        <div style={{ marginTop: 16 }}>
                          <div className="section-label">Evidence ({evItems.length})</div>
                          {evItems.length === 0 ? (
                            <p className="muted">No evidence uploaded.</p>
                          ) : (
                            <div style={{ display: "flex", flexDirection: "column", gap: 8, marginTop: 8 }}>
                              {evItems.map(e => {
                                const name = e.title || e.evidenceName || e.evidence_name;
                                const link = e.evidenceLink || e.evidence_link;
                                const hasFile = !e._fromVault && e.hasFile;
                                return (
                                  <div key={`${e._fromVault ? "v" : "e"}-${e.id}`}>
                                    <div style={{ display: "flex", gap: 10, alignItems: "center", padding: "8px 12px", background: "var(--bg4)", borderRadius: 6 }}>
                                      <div style={{ flex: 1 }}>
                                        <div style={{ fontSize: 12, color: "var(--text)", fontWeight: 500, display: "flex", alignItems: "center", gap: 6 }}>
                                          {name}
                                          {e._fromVault && <span style={{ fontSize: 10, padding: "1px 5px", borderRadius: 4, background: "rgba(99,102,241,0.12)", color: "var(--accent)", border: "1px solid rgba(99,102,241,0.2)", fontWeight: 600 }}>Vault</span>}
                                        </div>
                                        <div className="muted" style={{ marginTop: 2 }}>
                                          {e.uploadedBy || e.uploaded_by}
                                        </div>
                                      </div>
                                      {hasFile ? (
                                        <button
                                          className="btn-compact"
                                          onClick={() => (isAuditor ? viewEvidence(e.id) : downloadEvidence(e.id, name))}
                                        >
                                          {isAuditor ? "View" : "Download"}
                                        </button>
                                      ) : link ? (
                                        <a href={link} target="_blank" rel="noopener noreferrer" className="link">View</a>
                                      ) : null}
                                    </div>
                                    <EvidenceAiPanel evidence={e} compact />
                                  </div>
                                );
                              })}
                            </div>
                          )}
                        </div>
                      </div>

                      <div style={{ minWidth: 220, display: "flex", flexDirection: "column", gap: 10 }}>
                        <div className="card" style={{ padding: 14 }}>
                          <div className="muted" style={{ marginBottom: 8 }}>Module</div>
                          <div style={{ fontWeight: 600, fontSize: 14 }}>{q.moduleName || q.module_name}</div>
                        </div>
                        {(a.departments?.length > 0 || deptScope.me?.enabled) && (
                          <div className="card" style={{ padding: 14 }}>
                            <div className="muted" style={{ marginBottom: 8 }}>Department</div>
                            <div style={{ fontWeight: 600, fontSize: 14 }}>{departmentLabel(a.departments, "Unassigned")}</div>
                          </div>
                        )}
                        <div className="card" style={{ padding: 14 }}>
                          <div className="muted" style={{ marginBottom: 8 }}>Maturity</div>
                          <div style={{ fontSize: 24, fontWeight: 600, color: "var(--accent2)" }}>
                            {a.currentLevel || "—"}
                          </div>
                        </div>
                        {(isReviewer || isAuditor) && (
                          <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                            <button
                              className="btn btn-primary"
                              style={{ width: "100%" }}
                              onClick={() => promptUpdateAssessment(a.id, approveStatus)}
                              disabled={!canActOn(a)}
                              title={canActOn(a) ? undefined : outOfScopeTitle(a)}
                              aria-disabled={!canActOn(a)}
                            >
                              {isAuditor ? "✓ Sign off (audit)" : "✓ Approve"}
                            </button>
                            <button
                              className="btn btn-ghost"
                              style={{ width: "100%" }}
                              onClick={() => promptUpdateAssessment(a.id, "WIP")}
                              disabled={!canActOn(a)}
                              title={canActOn(a) ? undefined : outOfScopeTitle(a)}
                              aria-disabled={!canActOn(a)}
                            >
                              ✗ Reject
                            </button>
                          </div>
                        )}
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </section>
      </div>

      {notesModal && (
        <div className="modal-overlay" onClick={() => setNotesModal(null)}>
          <div className="module-modal" style={{ maxWidth: 460 }} onClick={e => e.stopPropagation()}>
            <div className="module-modal-header">
              <div className="module-modal-title">
                {!isApproveStatus(notesModal.status)
                  ? "Reject assessment"
                  : isAuditor ? "Confirm audit sign-off" : "Approve assessment"}
              </div>
              <button className="modal-close" onClick={() => setNotesModal(null)}>×</button>
            </div>
            <div className="module-modal-content" style={{ padding: 20 }}>
              <label style={{ display: "block", marginBottom: 8, fontSize: 13, color: "var(--text2)" }}>
                {isAuditor ? "Auditor notes (optional)" : "Reviewer Notes (optional)"}
              </label>
              <textarea
                className="comments-textarea"
                rows={4}
                placeholder="Add feedback, comments, or instructions for the contributor..."
                onChange={e => { notesRef.current = e.target.value; }}
                style={{ width: "100%", marginBottom: 16 }}
              />
              <div style={{ display: "flex", gap: 8 }}>
                <button
                  className={`btn ${isApproveStatus(notesModal.status) ? "btn-primary" : "btn-ghost"}`}
                  style={{ flex: 1 }}
                  onClick={confirmUpdateAssessment}
                >
                  {!isApproveStatus(notesModal.status)
                    ? "✗ Confirm Rejection"
                    : isAuditor ? "✓ Confirm Audit" : "✓ Confirm Approval"}
                </button>
                <button className="btn btn-ghost" onClick={() => setNotesModal(null)}>Cancel</button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
