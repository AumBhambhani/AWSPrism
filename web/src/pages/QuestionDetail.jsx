import { useCallback, useEffect, useRef, useState } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { apiFetch, apiUpload, apiDownload } from "../api/client.js";
import VaultPinPrompt from "../components/VaultPinPrompt.jsx";
import { isVaultPinError, vaultHeaders } from "../utils/vaultSession.js";
import { isPendingScan, pendingScanMessage } from "../utils/uploadScan.js";
import UserMenu from "../components/UserMenu.jsx";
import EvidenceAiPanel from "../components/EvidenceAiPanel.jsx";
import ControlDepartmentsEditor from "../components/ControlDepartmentsEditor.jsx";
import { isApprovedStatus } from "../utils/reviewStatus.js";

function formatDueDate(dateStr) {
  if (!dateStr) return null;
  const s = dateStr.slice(0, 10);
  const [y, m, d] = s.split("-").map(Number);
  const months = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];
  return `${d} ${months[m - 1]} ${y}`;
}

function localToday() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,"0")}-${String(d.getDate()).padStart(2,"0")}`;
}

function formatVaultBytes(n) {
  if (!n) return "";
  if (n < 1024) return `${n} B`;
  if (n < 1048576) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / 1048576).toFixed(1)} MB`;
}

function vaultFileIcon(type) {
  if (!type) return "📄";
  if (type.startsWith("image/")) return "🖼";
  if (type.includes("pdf")) return "📋";
  if (type.includes("sheet") || type.includes("excel") || type.includes("csv")) return "📊";
  if (type.includes("word") || type.includes("document")) return "📝";
  return "📄";
}

function addInterval(date, interval) {
  const d = new Date(date);
  const s = (interval || "monthly").toLowerCase();
  if (s === "none") return null;
  if (s === "weekly") d.setDate(d.getDate() + 7);
  else if (s === "fortnightly") d.setDate(d.getDate() + 14);
  else if (s.includes("annual") || s.includes("year")) d.setFullYear(d.getFullYear() + 1);
  else if (s.includes("quarter")) d.setMonth(d.getMonth() + 3);
  else if (s.includes("semi") || s.includes("bi")) d.setMonth(d.getMonth() + 6);
  else d.setMonth(d.getMonth() + 1);
  return d;
}

export default function QuestionDetail({ token, user, company, theme, onThemeToggle, onLogout, isVerified }) {
  const { questId } = useParams();
  const navigate = useNavigate();
  const [question, setQuestion] = useState(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const [analyzingId, setAnalyzingId] = useState(null);

  // Vault state
  const [vaultItems, setVaultItems] = useState([]);
  const [vaultLoading, setVaultLoading] = useState(false);
  const [vaultLocked, setVaultLocked] = useState(false);
  const [scanNotice, setScanNotice] = useState("");
  const [vaultUnlocks, setVaultUnlocks] = useState(0); // bumps after a PIN unlock to refetch
  const [showPicker, setShowPicker] = useState(false);
  const [pickerItems, setPickerItems] = useState([]);
  const [pickerSearch, setPickerSearch] = useState("");
  const [pickerLoading, setPickerLoading] = useState(false);
  const [linking, setLinking] = useState(null); // vaultId being linked
  const [showVaultUpload, setShowVaultUpload] = useState(false);
  const [vUploadTitle, setVUploadTitle] = useState("");
  const [vUploadDesc, setVUploadDesc] = useState("");
  const [vUploadFile, setVUploadFile] = useState(null);
  const [vUploading, setVUploading] = useState(false);
  const [vUploadError, setVUploadError] = useState("");
  const vFileRef = useRef(null);

  const canWriteVault = ["ADMIN", "LEAD", "CONTRIBUTOR"].includes(user?.role);
  // Auditors can view evidence inline but not download it.
  const isAuditor = user?.role === "AUDITOR";

  // Suggested evidence state
  const [suggestions, setSuggestions] = useState(null); // null = not yet loaded
  const [suggestionsLoading, setSuggestionsLoading] = useState(false);
  const [ignoredSuggestions, setIgnoredSuggestions] = useState(new Set());
  const [attachingSuggestion, setAttachingSuggestion] = useState(null);

  useEffect(() => {
    let active = true;
    apiFetch(`/api/questions/${questId}`, { token })
      .then((data) => {
        if (active) {
          setQuestion(data);
          setLoading(false);
        }
      })
      .catch((err) => {
        if (active) {
          setError(err.message);
          setLoading(false);
        }
      });

    return () => { active = false; };
  }, [questId, token]);

  useEffect(() => {
    setVaultLoading(true);
    apiFetch(`/api/vault?questId=${encodeURIComponent(questId)}`, { token })
      .then(data => { setVaultItems(data || []); setVaultLocked(false); })
      .catch(e => setVaultLocked(isVaultPinError(e)))
      .finally(() => setVaultLoading(false));
  }, [questId, token, vaultUnlocks]);

  // Load AI suggestions once per question (lazy, after question data arrives)
  useEffect(() => {
    if (!question) return;
    setSuggestionsLoading(true);
    setSuggestions(null);
    setIgnoredSuggestions(new Set());
    apiFetch(`/api/vault/suggestions?questId=${encodeURIComponent(questId)}`, { token })
      .then(data => setSuggestions(data || []))
      .catch(() => setSuggestions([]))
      .finally(() => setSuggestionsLoading(false));
  }, [question?.questId, token, vaultUnlocks]); // eslint-disable-line react-hooks/exhaustive-deps

  const loadPicker = useCallback(async (search = "") => {
    setPickerLoading(true);
    try {
      const url = search.trim() ? `/api/vault?search=${encodeURIComponent(search.trim())}` : "/api/vault";
      const data = await apiFetch(url, { token });
      setPickerItems(data || []);
    } catch { }
    setPickerLoading(false);
  }, [token]);

  useEffect(() => {
    if (!showPicker) return;
    const t = setTimeout(() => loadPicker(pickerSearch), 300);
    return () => clearTimeout(t);
  }, [showPicker, pickerSearch, loadPicker]);

  const handleLink = async (vaultId) => {
    setLinking(vaultId);
    try {
      await apiFetch(`/api/vault/${vaultId}/link`, {
        token, method: "POST",
        body: JSON.stringify({ questId })
      });
      const data = await apiFetch(`/api/vault?questId=${encodeURIComponent(questId)}`, { token });
      setVaultItems(data || []);
    } catch (e) {
      setError(e.message);
    } finally {
      setLinking(null);
    }
  };

  const handleUnlinkVault = async (vaultId) => {
    try {
      await apiFetch(`/api/vault/${vaultId}/link/${encodeURIComponent(questId)}`, {
        token, method: "DELETE"
      });
      setVaultItems(prev => prev.filter(i => i.id !== vaultId));
    } catch (e) {
      setError(e.message);
    }
  };

  const handleVaultUpload = async () => {
    if (!vUploadTitle.trim()) { setVUploadError("Title is required"); return; }
    if (!vUploadFile) { setVUploadError("Please select a file"); return; }
    setVUploading(true);
    setVUploadError("");
    try {
      const item = await apiUpload("/api/vault", vUploadFile, {
        title: vUploadTitle.trim(),
        description: vUploadDesc.trim() || "",
        questId
      }, token);
      if (isPendingScan(item)) setScanNotice(pendingScanMessage(item));
      else setVaultItems(prev => [item, ...prev]);
      setShowVaultUpload(false);
      setVUploadTitle("");
      setVUploadDesc("");
      setVUploadFile(null);
    } catch (e) {
      setVUploadError(e.message || "Upload failed");
    } finally {
      setVUploading(false);
    }
  };

  const handleSuggestionAttach = async (vaultId) => {
    setAttachingSuggestion(vaultId);
    try {
      await apiFetch(`/api/vault/${vaultId}/link`, {
        token, method: "POST",
        body: JSON.stringify({ questId })
      });
      const data = await apiFetch(`/api/vault?questId=${encodeURIComponent(questId)}`, { token });
      setVaultItems(data || []);
      setIgnoredSuggestions(prev => new Set([...prev, vaultId]));
    } catch (e) {
      setError(e.message);
    } finally {
      setAttachingSuggestion(null);
    }
  };

  const openInline = async (path, headers = {}) => {
    const res = await fetch(apiDownload(path), { headers: { Authorization: `Bearer ${token}`, ...headers } });
    if (!res.ok) { setError("View failed"); return; }
    window.open(URL.createObjectURL(await res.blob()), "_blank", "noopener");
  };

  const handleVaultDownload = async (item) => {
    const API_URL = import.meta.env.VITE_API_URL || "";
    const res = await fetch(`${API_URL}/api/vault/${item.id}/download`, {
      headers: { Authorization: `Bearer ${token}`, ...vaultHeaders() }
    });
    if (!res.ok) { setError("Download failed"); return; }
    const blob = await res.blob();
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = item.fileName || item.title;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  };

  const downloadEvidence = async (id, filename) => {
    try {
      const url = apiDownload(`/api/evidence/${id}/download`);
      const res = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
      if (!res.ok) throw new Error(`Download failed (${res.status})`);
      const blob = await res.blob();
      const blobUrl = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = blobUrl;
      a.download = filename || 'evidence';
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(blobUrl);
    } catch (e) {
      setError(e.message || 'Download failed');
    }
  };

  const goBack = () => (window.history.state?.idx ?? 0) > 0 ? navigate(-1) : navigate("/tracker");

  if (loading) {
    return (
      <div className="review-shell fade-in" style={{ display: "flex", alignItems: "center", justifyContent: "center", minHeight: "100vh" }}>
        <div className="loading-spinner" />
      </div>
    );
  }

  if (error || !question) {
    return (
      <div className="review-shell fade-in" style={{ display: "flex", alignItems: "center", justifyContent: "center", minHeight: "100vh" }}>
        <div className="card" style={{ maxWidth: 420, width: "100%", padding: 32, textAlign: "center" }}>
          <div style={{ fontSize: 15, fontWeight: 600, color: "var(--red)", marginBottom: 16 }}>
            {error || "Question not found"}
          </div>
          <button onClick={goBack} className="btn btn-primary">Back to Tracker</button>
        </div>
      </div>
    );
  }

  return (
    <div className="review-shell fade-in">
      <div className="review-header">
        <div>
          <div className="logo" style={{ cursor: "pointer" }} onClick={() => navigate("/tracker")}>PRISM</div>
          <div className="review-title">{question.questId} — {question.moduleName}</div>
          <div style={{ display: "flex", gap: 6, marginTop: 8, flexWrap: "wrap" }}>
            {question.controlArea && <span className="tag-badge">{question.controlArea}</span>}
            {question.isoReference && <span className="tag-badge">{question.isoReference}</span>}
            {question.frequency && <span className="tag-badge">{question.frequency}</span>}
          </div>
        </div>
        <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
          <button className="btn btn-ghost" onClick={goBack}>← Back</button>
          <button className="btn btn-ghost" onClick={async () => {
            try {
              const q = await apiFetch(`/api/questions/${questId}`, { token });
              setQuestion(q);
            } catch (e) { setError(e.message); }
          }}>Refresh</button>
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

      <div className="review-content" style={{ display: "flex", flexDirection: "column", gap: 20 }}>
        <section className="card">
          <div className="section-title">Question Details</div>
          <div className="detail-row">
            <span className="detail-label">Baseline Question:</span>
            <span>{question.baselineQuestion}</span>
          </div>
          <div className="detail-row">
            <span className="detail-label">Level 3 Criteria:</span>
            <span>{question.level3YesCriteria}</span>
          </div>
          <div className="detail-row">
            <span className="detail-label">Required Evidence:</span>
            <span>{question.requiredEvidence}</span>
          </div>
          <div className="detail-row">
            <span className="detail-label">{question.departments?.length ? "Departments:" : "Default Owner:"}</span>
            <ControlDepartmentsEditor
              token={token}
              user={user}
              questId={question.questId}
              departments={question.departments}
              fallback={question.defaultOwner}
              onSaved={(departments) => setQuestion((q) => ({ ...q, departments }))}
            />
          </div>
          {question.priority && (
            <div className="detail-row">
              <span className="detail-label">Priority:</span>
              <span className={`priority-badge priority-${question.priority.toLowerCase()}`}>{question.priority}</span>
            </div>
          )}
          <div className="detail-row">
            <span className="detail-label">Due Date:</span>
            {question.dueDate ? (() => {
              const dateOnly = question.dueDate.slice(0, 10);
              const today = localToday();
              const overdue = dateOnly < today && !["IMPLEMENTED", "NOT_APPLICABLE"].includes(question.latestAnswer);
              const warning = !overdue && dateOnly >= today && dateOnly <= new Date(Date.now() + 7*24*60*60*1000).toISOString().slice(0,10);
              return (
                <span style={{ display: "flex", alignItems: "center", gap: 8 }}>
                  <span style={{ color: overdue ? "var(--red)" : warning ? "var(--amber)" : "var(--text)", fontWeight: overdue || warning ? 600 : 400 }}>
                    {formatDueDate(dateOnly)}
                  </span>
                  {overdue && <span className="badge-overdue">Overdue</span>}
                  {warning && <span className="badge-due-warning">Due soon</span>}
                </span>
              );
            })() : (
              <span className="muted">No due date assigned</span>
            )}
          </div>
        </section>

        {(() => {
          const latestA = question.assessments?.[0];
          const internalNotes = latestA?.comments;
          const reviewerNotes = latestA?.reviewerNotes || latestA?.reviewer_notes;
          return (
            <section className="card">
              <div className="section-title">Notes</div>
              <div>
                <div style={{ fontWeight: 600, fontSize: 13, color: "var(--text2)", marginBottom: 6 }}>Internal Notes</div>
                <hr style={{ border: "none", borderTop: "1px solid var(--border2)", margin: "0 0 10px" }} />
                {internalNotes
                  ? <p style={{ margin: 0, fontSize: 14, whiteSpace: "pre-wrap", color: "var(--text)" }}>{internalNotes}</p>
                  : <span className="muted">No notes available.</span>}
              </div>
              <div style={{ marginTop: 20 }}>
                <div style={{ fontWeight: 600, fontSize: 13, color: "var(--text2)", marginBottom: 6 }}>Reviewer Notes</div>
                <hr style={{ border: "none", borderTop: "1px solid var(--border2)", margin: "0 0 10px" }} />
                {reviewerNotes
                  ? <p style={{ margin: 0, fontSize: 14, whiteSpace: "pre-wrap", color: "var(--amber)" }}>{reviewerNotes}</p>
                  : <span className="muted">No notes available.</span>}
              </div>
            </section>
          );
        })()}

        <section className="card">
          <div className="section-title">Dependencies ({question.dependencies?.length || 0})</div>
          {question.dependencies && question.dependencies.length > 0 ? (
            <div className="list">
              {question.dependencies.map(dep => {
                const implemented = isApprovedStatus(dep.latestReviewStatus) && dep.latestAnswer === "IMPLEMENTED";
                const assessed = isApprovedStatus(dep.latestReviewStatus);
                return (
                  <div key={dep.questId} className="list-item" style={{ display: "flex", alignItems: "center", gap: 10 }}>
                    <span style={{ fontSize: 16, flexShrink: 0 }}>{assessed ? (implemented ? "✅" : "❌") : "⬜"}</span>
                    <div>
                      <button
                        onClick={() => navigate(`/questions/${dep.questId}`)}
                        style={{ background: "none", border: "none", cursor: "pointer", color: "var(--accent)", fontFamily: "var(--mono)", fontWeight: 600, fontSize: 13, padding: 0, textDecoration: "underline" }}
                      >
                        {dep.questId}
                      </button>
                      {dep.controlArea && (
                        <div style={{ fontSize: 12, color: "var(--text3)", marginTop: 2 }}>{dep.controlArea}</div>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          ) : (
            <p className="muted">No dependencies set for this question.</p>
          )}
        </section>

        <section className="card">
          <div className="section-title">Assessments ({question.assessments?.length || 0})</div>
          {question.assessments && question.assessments.length > 0 ? (
            <div className="list">
              {question.assessments.map((assessment) => (
                <div key={assessment.id} className="list-item">
                  <div>
                    <div className="list-item-title">
                      {assessment.month} — {assessment.answer}
                    </div>
                    <div className="list-item-meta">
                      Level {assessment.currentLevel} | {assessment.reviewStatus}
                    </div>
                    {(assessment.reviewedBy || assessment.auditedBy) && (
                      <div className="list-item-meta" style={{ marginTop: 4 }}>
                        {assessment.reviewedBy && `Reviewed by: ${assessment.reviewedBy}`}
                        {assessment.reviewedBy && assessment.auditedBy && " | "}
                        {assessment.auditedBy && `Audited by: ${assessment.auditedBy}`}
                      </div>
                    )}
                  </div>
                  {assessment.comments && (
                    <div className="list-item-comment">{assessment.comments}</div>
                  )}
                </div>
              ))}
            </div>
          ) : (
            <p className="muted">No assessments recorded yet.</p>
          )}
        </section>

        <section className="card">
          <div className="section-title">Actions ({question.actions?.length || 0})</div>
          {question.actions && question.actions.length > 0 ? (
            <div className="list">
              {question.actions.map((action) => (
                <div key={action.id} className="list-item">
                  <div>
                    <div className="list-item-title">
                      {action.defeatedQuest || action.questId || "Action"} — {action.status || "OPEN"}
                    </div>
                    <div className="list-item-meta">
                      Owner: {action.owner} | Due: {action.dueDate ? new Date(action.dueDate).toLocaleDateString() : "N/A"}
                    </div>
                  </div>
                  {action.notes && (
                    <div className="list-item-comment">{action.notes}</div>
                  )}
                </div>
              ))}
            </div>
          ) : (
            <p className="muted">No actions required.</p>
          )}
        </section>

        {/* Vault Evidence */}
        <section className="card">
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 14 }}>
            <div className="section-title" style={{ marginBottom: 0 }}>Vault Evidence ({vaultItems.length})</div>
            {canWriteVault && !vaultLocked && (
              isVerified === false ? (
                <div style={{
                  fontSize: 12, color: "var(--text2)", padding: "6px 10px",
                  background: "var(--bg2)", borderRadius: 6, border: "1px solid var(--border)",
                }}>
                  🔒 Evidence upload available after account verification
                </div>
              ) : (
                <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                  <button className="btn btn-ghost" style={{ fontSize: 12, padding: "5px 12px" }} onClick={() => { setPickerSearch(""); setShowPicker(true); }}>
                    Attach Existing
                  </button>
                  <button className="btn btn-primary" style={{ fontSize: 12, padding: "5px 12px" }} onClick={() => { setShowVaultUpload(true); setVUploadError(""); }}>
                    + Upload New
                  </button>
                </div>
              )
            )}
          </div>
          {vaultLoading ? (
            <p className="muted">Loading…</p>
          ) : null}
          {!vaultLoading && scanNotice && (
            <div className="muted" style={{ fontSize: 12, marginBottom: 10, padding: "8px 12px", borderLeft: "3px solid var(--amber)", background: "var(--bg2)", borderRadius: 6 }}>🛡 {scanNotice}</div>
          )}
          {vaultLoading ? null : vaultLocked ? (
            <VaultPinPrompt token={token} onUnlocked={() => setVaultUnlocks(n => n + 1)} message="Vault evidence for this question is protected by the vault PIN." />
          ) : vaultItems.length === 0 ? (
            <p className="muted">No vault evidence linked to this question.</p>
          ) : (
            <div className="list">
              {vaultItems.map(item => (
                <div key={item.id} className="list-item" style={{ display: "flex", alignItems: "center", gap: 12 }}>
                  <span style={{ fontSize: 22, flexShrink: 0 }}>{vaultFileIcon(item.fileType)}</span>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div className="list-item-title" style={{ wordBreak: "break-word" }}>{item.title}</div>
                    {item.description && <div className="list-item-meta" style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{item.description}</div>}
                    <div className="list-item-meta">
                      {item.fileType && <span>{item.fileType.split("/")[1]?.toUpperCase() || item.fileType} · </span>}
                      {item.fileSize && <span>{formatVaultBytes(item.fileSize)} · </span>}
                      <span>{item.uploadedBy}</span>
                    </div>
                    {item.uploadedAt && question.recurrenceInterval && (() => {
                      const recurrenceDue = addInterval(item.uploadedAt, question.recurrenceInterval);
                      if (!recurrenceDue) return null;
                      // Evidence behind an audited assessment stays valid to the end of the
                      // audited period, even if its own review date falls inside it.
                      const auditEnd = item.auditedThrough ? new Date(`${String(item.auditedThrough).slice(0, 10)}T23:59:59`) : null;
                      const heldByAudit = auditEnd && auditEnd > recurrenceDue;
                      const due = heldByAudit ? auditEnd : recurrenceDue;
                      const daysLeft = Math.round((due - new Date()) / 86400000);
                      const overdue = daysLeft < 0;
                      const soon = !overdue && daysLeft <= 14;
                      const color = overdue ? "var(--red)" : soon ? "var(--amber)" : "var(--green)";
                      return (
                        <div style={{ fontSize: 10, color, marginTop: 3, fontWeight: 500 }}>
                          {overdue
                            ? `⚠ Review overdue — due ${due.toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" })}`
                            : soon
                              ? `⏳ Review due in ${daysLeft}d — ${due.toLocaleDateString("en-GB", { day: "numeric", month: "short" })}`
                              : `✓ Valid until ${due.toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" })}${heldByAudit ? " · audited period" : ""}`}
                        </div>
                      );
                    })()}
                  </div>
                  <div style={{ display: "flex", gap: 6, flexShrink: 0 }}>
                    {item.storagePath && (
                      isAuditor
                        ? <button className="btn btn-compact" onClick={() => openInline(`/api/vault/${item.id}/view`, vaultHeaders())}>View</button>
                        : <button className="btn btn-compact" onClick={() => handleVaultDownload(item)}>Download</button>
                    )}
                    <button
                      className="btn btn-ghost"
                      style={{ fontSize: 12, padding: "4px 10px" }}
                      onClick={() => navigate("/vault")}
                    >View in Vault</button>
                    {canWriteVault && isVerified !== false && !question.assessments?.some(a => isApprovedStatus(a.reviewStatus || a.review_status)) && (
                      <button
                        className="btn btn-ghost"
                        style={{ fontSize: 12, padding: "4px 10px", color: "var(--text3)" }}
                        onClick={() => handleUnlinkVault(item.id)}
                        title="Unlink from this question"
                      >×</button>
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}

          {/* Suggested Evidence — inline below vault items */}
          {isVerified !== false && (suggestionsLoading || (suggestions !== null && suggestions.filter(s => !ignoredSuggestions.has(s.id) && !vaultItems.some(v => v.id === s.id)).length > 0)) && (
            <div style={{ marginTop: 16, borderTop: "1px solid var(--border2)", paddingTop: 14 }}>
              <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 10 }}>
                <div style={{ fontSize: 13, fontWeight: 600, color: "var(--text2)" }}>Suggested Evidence</div>
                <span style={{ fontSize: 10, color: "var(--text3)", background: "var(--bg3)", border: "1px solid var(--border2)", borderRadius: 10, padding: "1px 7px" }}>AI</span>
              </div>
              {suggestionsLoading ? (
                <p className="muted" style={{ fontSize: 13 }}>Scanning vault for relevant evidence…</p>
              ) : (() => {
                const visible = suggestions.filter(
                  s => !ignoredSuggestions.has(s.id) && !vaultItems.some(v => v.id === s.id)
                );
                if (visible.length === 0) return null;
                return (
                  <div className="list">
                    {visible.map(s => {
                      const score = s.relevanceScore;
                      const isKeyword = s.matchType === "keyword";
                      const scoreColor = isKeyword
                        ? "var(--text3)"
                        : (score >= 70 ? "var(--green)" : score >= 50 ? "var(--amber)" : "var(--text3)");
                      const alreadyAttaching = attachingSuggestion === s.id;
                      return (
                        <div key={s.id} className="list-item" style={{ display: "flex", alignItems: "center", gap: 12 }}>
                          <div
                            title={isKeyword
                              ? "Keyword overlap, not an AI score — enable an AI provider for semantic matching"
                              : "AI relevance score"}
                            style={{
                              flexShrink: 0, width: 40, height: 40, borderRadius: "50%",
                              border: `2px ${isKeyword ? "dashed" : "solid"} ${scoreColor}`, background: "var(--bg3)",
                              display: "flex", alignItems: "center", justifyContent: "center",
                              fontSize: isKeyword ? 9 : 10, fontWeight: 700, color: scoreColor,
                            }}>
                            {isKeyword ? "kw" : `${score}%`}
                          </div>
                          <div style={{ flex: 1, minWidth: 0 }}>
                            <div className="list-item-title" style={{ wordBreak: "break-word" }}>{s.title}</div>
                            {s.reason && <div className="list-item-meta" style={{ fontStyle: "italic", color: "var(--text2)" }}>{s.reason}</div>}
                            <div className="list-item-meta">
                              {s.linkedCount > 0 ? `Linked to ${s.linkedCount} question${s.linkedCount !== 1 ? "s" : ""}` : "Not yet linked"}
                            </div>
                          </div>
                          <div style={{ display: "flex", gap: 6, flexShrink: 0 }}>
                            {canWriteVault && (
                              <button
                                className="btn btn-primary"
                                style={{ fontSize: 11, padding: "4px 12px" }}
                                disabled={alreadyAttaching}
                                onClick={() => handleSuggestionAttach(s.id)}
                              >
                                {alreadyAttaching ? "…" : "Attach"}
                              </button>
                            )}
                            <button
                              className="btn btn-ghost"
                              style={{ fontSize: 11, padding: "4px 10px", color: "var(--text3)" }}
                              onClick={() => setIgnoredSuggestions(prev => new Set([...prev, s.id]))}
                            >
                              Ignore
                            </button>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                );
              })()}
            </div>
          )}
        </section>

        {/* Vault Picker Modal */}
        {showPicker && (
          <div className="modal-overlay" onClick={() => setShowPicker(false)}>
            <div className="module-modal" style={{ maxWidth: 520 }} onClick={e => e.stopPropagation()}>
              <div className="module-modal-header">
                <div className="module-modal-title">Attach Evidence from Vault</div>
                <button className="modal-close" onClick={() => setShowPicker(false)}>×</button>
              </div>
              <div className="module-modal-content" style={{ padding: 16 }}>
                <input
                  type="text"
                  placeholder="Search vault…"
                  value={pickerSearch}
                  onChange={e => setPickerSearch(e.target.value)}
                  style={{ width: "100%", padding: "8px 12px", borderRadius: 6, border: "1px solid var(--border2)", background: "var(--bg3)", color: "var(--text)", fontSize: 13, boxSizing: "border-box", marginBottom: 12 }}
                />
                {pickerLoading ? (
                  <div style={{ textAlign: "center", padding: 20, color: "var(--text3)" }}>Loading…</div>
                ) : pickerItems.length === 0 ? (
                  <div style={{ textAlign: "center", padding: 20, color: "var(--text3)" }}>No vault items found.</div>
                ) : (
                  <div style={{ display: "flex", flexDirection: "column", gap: 8, maxHeight: 360, overflowY: "auto" }}>
                    {pickerItems.map(item => {
                      const alreadyLinked = vaultItems.some(v => v.id === item.id);
                      return (
                        <div key={item.id} style={{ display: "flex", alignItems: "center", gap: 10, padding: "10px 12px", background: "var(--bg3)", borderRadius: 8 }}>
                          <span style={{ fontSize: 20, flexShrink: 0 }}>{vaultFileIcon(item.fileType)}</span>
                          <div style={{ flex: 1, minWidth: 0 }}>
                            <div style={{ fontSize: 13, fontWeight: 600, wordBreak: "break-word" }}>{item.title}</div>
                            {item.description && <div style={{ fontSize: 11, color: "var(--text3)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{item.description}</div>}
                            <div style={{ fontSize: 11, color: "var(--text3)" }}>{formatVaultBytes(item.fileSize)}</div>
                          </div>
                          {alreadyLinked ? (
                            <span style={{ fontSize: 11, color: "var(--text3)", padding: "4px 10px" }}>Linked</span>
                          ) : (
                            <button
                              className="btn btn-primary"
                              style={{ fontSize: 11, padding: "5px 12px", flexShrink: 0 }}
                              disabled={linking === item.id}
                              onClick={async () => { await handleLink(item.id); setShowPicker(false); }}
                            >
                              {linking === item.id ? "…" : "Attach"}
                            </button>
                          )}
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            </div>
          </div>
        )}

        {/* Vault Upload Modal */}
        {showVaultUpload && (
          <div className="modal-overlay" onClick={() => setShowVaultUpload(false)}>
            <div className="module-modal" style={{ maxWidth: 460 }} onClick={e => e.stopPropagation()}>
              <div className="module-modal-header">
                <div className="module-modal-title">Upload to Vault &amp; Link</div>
                <button className="modal-close" onClick={() => setShowVaultUpload(false)}>×</button>
              </div>
              <div className="module-modal-content" style={{ padding: 20, display: "flex", flexDirection: "column", gap: 14 }}>
                <div>
                  <label style={{ fontSize: 12, color: "var(--text3)", display: "block", marginBottom: 4 }}>Title *</label>
                  <input
                    type="text"
                    value={vUploadTitle}
                    onChange={e => setVUploadTitle(e.target.value)}
                    placeholder="e.g. Access Control Policy v2"
                    style={{ width: "100%", padding: "8px 12px", borderRadius: 6, border: "1px solid var(--border2)", background: "var(--bg3)", color: "var(--text)", fontSize: 13, boxSizing: "border-box" }}
                  />
                </div>
                <div>
                  <label style={{ fontSize: 12, color: "var(--text3)", display: "block", marginBottom: 4 }}>Description</label>
                  <textarea
                    value={vUploadDesc}
                    onChange={e => setVUploadDesc(e.target.value)}
                    placeholder="What does this evidence demonstrate?"
                    rows={3}
                    style={{ width: "100%", padding: "8px 12px", borderRadius: 6, border: "1px solid var(--border2)", background: "var(--bg3)", color: "var(--text)", fontSize: 13, resize: "vertical", boxSizing: "border-box" }}
                  />
                </div>
                <div>
                  <label style={{ fontSize: 12, color: "var(--text3)", display: "block", marginBottom: 4 }}>File *</label>
                  <div
                    onClick={() => vFileRef.current?.click()}
                    style={{ border: "2px dashed var(--border2)", borderRadius: 8, padding: "16px", textAlign: "center", cursor: "pointer", background: "var(--bg3)" }}
                  >
                    <input ref={vFileRef} type="file" style={{ display: "none" }} onChange={e => setVUploadFile(e.target.files[0])} />
                    {vUploadFile ? (
                      <div>
                        <div style={{ fontSize: 20 }}>{vaultFileIcon(vUploadFile.type)}</div>
                        <div style={{ fontSize: 13, fontWeight: 600 }}>{vUploadFile.name}</div>
                        <div style={{ fontSize: 11, color: "var(--text3)" }}>{formatVaultBytes(vUploadFile.size)}</div>
                      </div>
                    ) : (
                      <div style={{ color: "var(--text3)", fontSize: 13 }}>Click to select a file (max 10 MB)</div>
                    )}
                  </div>
                </div>
                {vUploadError && <div style={{ fontSize: 12, color: "var(--red)" }}>✗ {vUploadError}</div>}
                <div style={{ display: "flex", gap: 8 }}>
                  <button className="btn btn-primary" style={{ flex: 1 }} onClick={handleVaultUpload} disabled={vUploading}>
                    {vUploading ? "Uploading…" : "Upload & Link"}
                  </button>
                  <button className="btn btn-ghost" onClick={() => setShowVaultUpload(false)}>Cancel</button>
                </div>
              </div>
            </div>
          </div>
        )}

        <section className="card">
          <div className="section-title">Evidence ({question.evidence?.length || 0})</div>
          {question.evidence && question.evidence.length > 0 ? (
            <div className="list">
              {question.evidence.map((evidence) => (
                <div key={evidence.id} className="list-item" style={{ flexDirection: 'column', alignItems: 'stretch' }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                    <div>
                      <div className="list-item-title">
                        {evidence.evidenceName || evidence.evidenceType}
                      </div>
                      <div className="list-item-meta">
                        Uploaded by: {evidence.uploadedBy} | Status: {evidence.approvalStatus}
                      </div>
                    </div>
                    <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                      {evidence.evidenceLink && (
                        <a href={evidence.evidenceLink} target="_blank" rel="noopener noreferrer" className="link">
                          View Evidence
                        </a>
                      )}
                      {evidence.hasFile && (
                        isAuditor
                          ? <button className="btn btn-compact" onClick={() => openInline(`/api/evidence/${evidence.id}/view`)}>View</button>
                          : <button className="btn btn-compact" onClick={() => downloadEvidence(evidence.id, evidence.evidenceName)}>
                              Download
                            </button>
                      )}
                      {isVerified !== false && (
                        <button
                          className="btn btn-secondary"
                          disabled={analyzingId === evidence.id}
                          onClick={async () => {
                            setAnalyzingId(evidence.id);
                            try {
                              await apiFetch(`/api/evidence/${evidence.id}/analyze`, { token, method: 'POST' });
                              const q = await apiFetch(`/api/questions/${questId}`, { token });
                              setQuestion(q);
                            } catch (e) {
                              setError(e.message);
                            } finally {
                              setAnalyzingId(null);
                            }
                          }}
                        >
                          {analyzingId === evidence.id ? "Analyzing…" : "🤖 AI Analyze"}
                        </button>
                      )}
                    </div>
                  </div>
                  <EvidenceAiPanel evidence={evidence} />
                </div>
              ))}
            </div>
          ) : (
            <p className="muted">No evidence uploaded yet.</p>
          )}
        </section>
      </div>
    </div>
  );
}
