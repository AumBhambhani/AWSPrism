import { useCallback, useEffect, useRef, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { apiFetch, apiUpload } from "../api/client.js";
import { isPendingScan, pendingScanMessage } from "../utils/uploadScan.js";
import GlassSelect from "../components/GlassSelect.jsx";
import UserMenu from "../components/UserMenu.jsx";

// ── Constants ─────────────────────────────────────────────────────────
const STATUS_OPTIONS = ["Open", "In Progress", "Submitted", "Completed", "Cancelled"];
const PRIORITY_OPTIONS = ["Critical", "High", "Medium", "Low"];

const STATUS_COLOR = {
  "Open":        "var(--text3)",
  "In Progress": "var(--accent)",
  "Submitted":   "var(--amber)",
  "Completed":   "var(--green)",
  "Cancelled":   "var(--red)",
};
const PRIORITY_COLOR = {
  "Critical": "var(--red)",
  "High":     "var(--amber)",
  "Medium":   "var(--accent)",
  "Low":      "var(--text3)",
};

function StatusBadge({ status }) {
  return (
    <span style={{
      display: "inline-block", padding: "2px 8px", borderRadius: 4,
      fontSize: 11, fontWeight: 700, letterSpacing: "0.03em",
      background: "var(--bg4)", color: STATUS_COLOR[status] || "var(--text3)",
      border: `1px solid ${STATUS_COLOR[status] || "var(--border2)"}40`
    }}>
      {status || "—"}
    </span>
  );
}

function PriorityBadge({ priority }) {
  return (
    <span style={{
      display: "inline-block", padding: "2px 8px", borderRadius: 4,
      fontSize: 11, fontWeight: 700,
      background: "var(--bg4)", color: PRIORITY_COLOR[priority] || "var(--text3)",
      border: `1px solid ${PRIORITY_COLOR[priority] || "var(--border2)"}40`
    }}>
      {priority || "—"}
    </span>
  );
}

function formatDate(s) {
  if (!s) return "—";
  return new Date(s).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" });
}

function isOverdue(dueDate, status) {
  if (!dueDate || ["Completed", "Cancelled"].includes(status)) return false;
  return dueDate.slice(0, 10) < new Date().toISOString().slice(0, 10);
}

function formatBytes(n) {
  if (!n) return "";
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

// ── Main Component ────────────────────────────────────────────────────
export default function EvidenceRequests({ token, user, company, onLogout, theme, onThemeToggle, isVerified }) {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();

  const [items, setItems]         = useState([]);
  const [loading, setLoading]     = useState(true);
  const [error, setError]         = useState("");
  const [mine, setMine]           = useState(true);
  const [statusFilter, setStatusFilter]     = useState("");
  const [priorityFilter, setPriorityFilter] = useState("");
  const [search, setSearch]       = useState("");

  const [selected, setSelected]   = useState(null);
  const [detail, setDetail]       = useState(null);
  const [detailLoading, setDetailLoading] = useState(false);

  // Assignable users (for create / reassign)
  const [assignableUsers, setAssignableUsers] = useState([]);

  // Create modal
  const [showCreate, setShowCreate] = useState(false);
  const [createForm, setCreateForm] = useState({
    title: "", description: "", priority: "Medium",
    dueDate: "", assigneeId: "", questionId: "", assessmentId: ""
  });
  const [creating, setCreating]   = useState(false);
  const [createError, setCreateError] = useState("");

  // Fulfill modal
  const [showFulfill, setShowFulfill]     = useState(false);
  const [fulfillTab, setFulfillTab]       = useState("vault"); // "vault" | "upload"
  const [pickerItems, setPickerItems]     = useState([]);
  const [pickerSearch, setPickerSearch]   = useState("");
  const [pickerLoading, setPickerLoading] = useState(false);
  const [fulfillUploading, setFulfillUploading] = useState(false);
  const [fulfillUpFile, setFulfillUpFile] = useState(null);
  const [fulfillUpTitle, setFulfillUpTitle] = useState("");
  const [fulfillUpDesc, setFulfillUpDesc]   = useState("");
  const [fulfillError, setFulfillError]   = useState("");
  const [fulfilling, setFulfilling]       = useState(false);
  const upFileRef = useRef(null);

  // Comment state
  const [commentBody, setCommentBody]   = useState("");
  const [submittingComment, setSubmittingComment] = useState(false);

  const canManage = ["ADMIN", "LEAD"].includes(user?.role);
  const canWrite  = ["ADMIN", "LEAD", "CONTRIBUTOR"].includes(user?.role);

  // ── Loaders ──────────────────────────────────────────────────────
  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const params = new URLSearchParams();
      if (mine) params.set("mine", "true");
      if (statusFilter) params.set("status", statusFilter);
      if (priorityFilter) params.set("priority", priorityFilter);
      if (search.trim()) params.set("search", search.trim());
      const data = await apiFetch(`/api/requests?${params}`, { token });
      setItems(data || []);
    } catch (e) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  }, [token, mine, statusFilter, priorityFilter, search]);

  useEffect(() => {
    const t = setTimeout(() => load(), search ? 350 : 0);
    return () => clearTimeout(t);
  }, [load, search]);

  // Pre-fill questionId from URL param (when linked from QuestionDetail)
  useEffect(() => {
    const qid = searchParams.get("questionId");
    if (qid) {
      setCreateForm(f => ({ ...f, questionId: qid }));
      setShowCreate(true);
    }
  }, []);

  // Load assignable users once
  useEffect(() => {
    apiFetch("/api/requests/users", { token })
      .then(data => setAssignableUsers(data || []))
      .catch(() => {});
  }, [token]);

  const openDetail = async (item) => {
    setSelected(item);
    setDetail(null);
    setDetailLoading(true);
    setCommentBody("");
    try {
      const data = await apiFetch(`/api/requests/${item.id}`, { token });
      setDetail(data);
    } catch (e) {
      setError(e.message);
    } finally {
      setDetailLoading(false);
    }
  };

  const refreshDetail = async () => {
    if (!selected) return;
    try {
      const data = await apiFetch(`/api/requests/${selected.id}`, { token });
      setDetail(data);
      setItems(prev => prev.map(i => i.id === data.id ? { ...data } : i));
    } catch { }
  };

  // ── Vault picker for fulfill ──────────────────────────────────────
  const loadPicker = useCallback(async (q = "") => {
    setPickerLoading(true);
    try {
      const url = q.trim() ? `/api/vault?search=${encodeURIComponent(q.trim())}` : "/api/vault";
      setPickerItems((await apiFetch(url, { token })) || []);
    } catch { }
    setPickerLoading(false);
  }, [token]);

  useEffect(() => {
    if (!showFulfill || fulfillTab !== "vault") return;
    const t = setTimeout(() => loadPicker(pickerSearch), 300);
    return () => clearTimeout(t);
  }, [showFulfill, fulfillTab, pickerSearch, loadPicker]);

  // ── Actions ──────────────────────────────────────────────────────
  const handleCreate = async () => {
    if (!createForm.title.trim()) { setCreateError("Title is required"); return; }
    setCreating(true);
    setCreateError("");
    try {
      const body = {
        title: createForm.title.trim(),
        description: createForm.description.trim() || undefined,
        priority: createForm.priority,
        dueDate: createForm.dueDate || undefined,
        assigneeId: createForm.assigneeId ? parseInt(createForm.assigneeId) : undefined,
        questionId: createForm.questionId.trim() || undefined,
        assessmentId: createForm.assessmentId ? parseInt(createForm.assessmentId) : undefined,
      };
      const created = await apiFetch("/api/requests", {
        token, method: "POST", body: JSON.stringify(body)
      });
      setItems(prev => [created, ...prev]);
      setShowCreate(false);
      setCreateForm({ title: "", description: "", priority: "Medium", dueDate: "", assigneeId: "", questionId: "", assessmentId: "" });
      openDetail(created);
    } catch (e) {
      setCreateError(e.message);
    } finally {
      setCreating(false);
    }
  };

  const handleStatusChange = async (newStatus) => {
    if (!detail) return;
    try {
      const updated = await apiFetch(`/api/requests/${detail.id}`, {
        token, method: "PUT", body: JSON.stringify({ status: newStatus })
      });
      setDetail(d => ({ ...d, ...updated }));
      setItems(prev => prev.map(i => i.id === updated.id ? { ...i, ...updated } : i));
    } catch (e) {
      setError(e.message);
    }
  };

  const handleFulfillWithVault = async (vaultId) => {
    if (!detail) return;
    setFulfilling(true);
    setFulfillError("");
    try {
      const updated = await apiFetch(`/api/requests/${detail.id}/fulfill`, {
        token, method: "POST", body: JSON.stringify({ vaultId })
      });
      setDetail(updated);
      setItems(prev => prev.map(i => i.id === updated.id ? { ...i, ...updated } : i));
      setShowFulfill(false);
    } catch (e) {
      setFulfillError(e.message);
    } finally {
      setFulfilling(false);
    }
  };

  const handleFulfillWithUpload = async () => {
    if (!fulfillUpTitle.trim()) { setFulfillError("Title is required"); return; }
    if (!fulfillUpFile) { setFulfillError("Please select a file"); return; }
    setFulfillUploading(true);
    setFulfillError("");
    try {
      // 1. Upload to vault (with questId for auto-link if available)
      const vaultItem = await apiUpload("/api/vault", fulfillUpFile, {
        title: fulfillUpTitle.trim(),
        description: fulfillUpDesc.trim() || "",
        ...(detail?.questionId ? { questId: detail.questionId } : {}),
        // If the file is quarantined for a malware rescan, the server attaches it to
        // this request automatically once it clears.
        fulfilRequestId: detail?.id,
      }, token);
      if (isPendingScan(vaultItem)) {
        setFulfillError(`${pendingScanMessage(vaultItem)} It will be attached to this request once it clears.`);
        setFulfillUpFile(null);
        return;
      }
      // 2. Fulfill the request with the new vault item
      await handleFulfillWithVault(vaultItem.id);
      setFulfillUpFile(null);
      setFulfillUpTitle("");
      setFulfillUpDesc("");
    } catch (e) {
      setFulfillError(e.message || "Upload failed");
    } finally {
      setFulfillUploading(false);
    }
  };

  const handleComment = async () => {
    if (!commentBody.trim() || !detail) return;
    setSubmittingComment(true);
    try {
      const comment = await apiFetch(`/api/requests/${detail.id}/comments`, {
        token, method: "POST", body: JSON.stringify({ body: commentBody.trim() })
      });
      setDetail(d => ({ ...d, comments: [...(d.comments || []), comment] }));
      setCommentBody("");
    } catch (e) {
      setError(e.message);
    } finally {
      setSubmittingComment(false);
    }
  };

  const handleCancel = async () => {
    if (!detail) return;
    if (!window.confirm("Cancel this request?")) return;
    try {
      await apiFetch(`/api/requests/${detail.id}`, { token, method: "DELETE" });
      setDetail(d => ({ ...d, status: "Cancelled" }));
      setItems(prev => prev.map(i => i.id === detail.id ? { ...i, status: "Cancelled" } : i));
    } catch (e) {
      setError(e.message);
    }
  };

  // ── Activity timeline (synthetic from request data + comments) ────
  const buildTimeline = (req) => {
    const events = [];
    if (!req) return events;
    events.push({ type: "event", icon: "🆕", label: `Request created by ${req.requesterName || req.requesterEmail || "unknown"}`, time: req.createdAt });
    if (req.assigneeName || req.assigneeEmail) {
      events.push({ type: "event", icon: "👤", label: `Assigned to ${req.assigneeName || req.assigneeEmail}`, time: req.createdAt });
    }
    if (req.fulfilledEvidenceId) {
      events.push({ type: "event", icon: "📎", label: `Evidence attached: ${req.evidenceTitle || "vault item"}`, time: req.updatedAt });
    }
    if (req.status === "Completed" && req.completedAt) {
      events.push({ type: "event", icon: "✅", label: "Request marked completed", time: req.completedAt });
    }
    if (req.status === "Cancelled") {
      events.push({ type: "event", icon: "🚫", label: "Request cancelled", time: req.updatedAt });
    }
    (req.comments || []).forEach(c => {
      events.push({ type: "comment", icon: "💬", label: c.body, author: c.authorName || c.authorEmail, time: c.createdAt, id: c.id });
    });
    return events.sort((a, b) => new Date(a.time) - new Date(b.time));
  };

  // ── Determine what the current user can do on the selected request ─
  const isMyRequest = detail && (detail.requesterId === user?.id || detail.assigneeId === user?.id);
  const isAssignee  = detail && detail.assigneeId === user?.id;
  const canFulfill  = detail && !detail.fulfilledEvidenceId
    && !["Completed", "Cancelled"].includes(detail.status)
    && (canManage || isAssignee);
  const canCancel   = detail && detail.status !== "Completed" && detail.status !== "Cancelled"
    && (canManage || detail.requesterId === user?.id);
  const canMarkComplete = detail && detail.status === "Submitted" && canManage;

  // ── Render ────────────────────────────────────────────────────────
  return (
    <div className="review-shell fade-in">
      {/* ── Header ── */}
      <div className="review-header" style={{ justifyContent: "space-between" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 16 }}>
          <div className="logo" style={{ cursor: "pointer" }} onClick={() => navigate("/tracker")}>PRISM</div>
          <div className="review-title">Evidence Requests</div>
        </div>
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
          {canWrite && (
            <button className="btn btn-primary" onClick={() => { setShowCreate(true); setCreateError(""); }}>
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" style={{ marginRight: 6 }}>
                <line x1="12" y1="5" x2="12" y2="19"></line>
                <line x1="5" y1="12" x2="19" y2="12"></line>
              </svg>
              New Request
            </button>
          )}
          <button className="btn btn-ghost" onClick={() => navigate("/dashboard")}>Dashboard</button>
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
        {error && (
          <div style={{ padding: "12px 18px", background: "rgba(239,68,68,0.1)", border: "1px solid var(--red)", borderRadius: 12, color: "var(--red)", marginBottom: 18, fontSize: 13.5 }}>
            {error}
            <button onClick={() => setError("")} style={{ marginLeft: 12, background: "none", border: "none", color: "var(--red)", cursor: "pointer", fontSize: 16 }}>×</button>
          </div>
        )}

        {/* ── View tabs + filters ── */}
        <div style={{ display: "flex", gap: 14, flexWrap: "wrap", marginBottom: 20, alignItems: "center" }}>
          {canManage && (
            <div className="dash-segment">
              <button
                className={`dash-segment-btn ${mine ? "active" : ""}`}
                onClick={() => setMine(true)}
              >
                My Requests
              </button>
              <button
                className={`dash-segment-btn ${!mine ? "active" : ""}`}
                onClick={() => setMine(false)}
              >
                All Requests
              </button>
            </div>
          )}

          <GlassSelect
            value={statusFilter}
            onChange={val => setStatusFilter(val)}
            options={[
              { value: "", label: "All statuses" },
              ...STATUS_OPTIONS.map(s => ({ value: s, label: s }))
            ]}
          />

          <GlassSelect
            value={priorityFilter}
            onChange={val => setPriorityFilter(val)}
            options={[
              { value: "", label: "All priorities" },
              ...PRIORITY_OPTIONS.map(p => ({ value: p, label: p }))
            ]}
          />

          <div className="vault-search-wrap" style={{ maxWidth: 300, flex: "1 1 200px" }}>
            <input
              type="text"
              className="vault-search-input"
              placeholder="Search requests…"
              value={search}
              onChange={e => setSearch(e.target.value)}
            />
            {search && (
              <button className="vault-search-clear" onClick={() => setSearch("")}>×</button>
            )}
          </div>
        </div>

        {/* ── Two-panel layout ── */}
        <div style={{ display: "flex", gap: 24, alignItems: "flex-start" }}>
          {/* ── Request list ── */}
          <div style={{ flex: 1, minWidth: 0 }}>
            {loading ? (
              <div style={{ textAlign: "center", padding: 48, color: "var(--dp-quiet)" }}>
                <div className="loading-spinner" />
                <p style={{ marginTop: 14, fontSize: 14.5 }}>Loading requests…</p>
              </div>
            ) : items.length === 0 ? (
              <div className="card" style={{ textAlign: "center", padding: 48 }}>
                <div style={{ fontSize: 36, marginBottom: 14 }}>📋</div>
                <p style={{ color: "var(--dp-quiet)", margin: 0, fontSize: 15 }}>No evidence requests found.</p>
                {canWrite && (
                  <button className="btn btn-primary" style={{ marginTop: 18 }} onClick={() => setShowCreate(true)}>
                    Create first request
                  </button>
                )}
              </div>
            ) : (
              <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                {items.map(item => {
                  const overdue = isOverdue(item.dueDate, item.status);
                  const active  = selected?.id === item.id;
                  return (
                    <div
                      key={item.id}
                      className="card"
                      style={{
                        padding: "12px 16px", cursor: "pointer",
                        border: `1px solid ${active ? "var(--accent)" : "var(--border)"}`,
                        transition: "border-color 0.15s"
                      }}
                      onClick={() => active ? (setSelected(null), setDetail(null)) : openDetail(item)}
                    >
                      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 10 }}>
                        <div style={{ flex: 1, minWidth: 0 }}>
                          <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginBottom: 4 }}>
                            <PriorityBadge priority={item.priority} />
                            <StatusBadge status={item.status} />
                          </div>
                          <div style={{ fontWeight: 600, fontSize: 14, color: "var(--text)", marginBottom: 4, wordBreak: "break-word" }}>
                            {item.title}
                          </div>
                          <div style={{ display: "flex", gap: 12, flexWrap: "wrap", fontSize: 12, color: "var(--text3)" }}>
                            {item.questionId && (
                              <span style={{ fontFamily: "var(--mono)", color: "var(--accent)" }}>{item.questionId}</span>
                            )}
                            {item.assigneeName && <span>→ {item.assigneeName}</span>}
                            {item.dueDate && (
                              <span style={{ color: overdue ? "var(--red)" : "var(--text3)", fontWeight: overdue ? 600 : 400 }}>
                                {overdue ? "⚠ Overdue · " : "Due: "}{formatDate(item.dueDate)}
                              </span>
                            )}
                            <span>{formatDate(item.createdAt)}</span>
                          </div>
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>

          {/* ── Detail panel ── */}
          {selected && (
            <div className="card" style={{ width: 380, flexShrink: 0, padding: 0, position: "sticky", top: 20, maxHeight: "calc(100vh - 140px)", overflow: "hidden", display: "flex", flexDirection: "column" }}>
              {/* Panel header */}
              <div style={{ padding: "16px 18px 12px", borderBottom: "1px solid var(--border2)", display: "flex", justifyContent: "space-between", alignItems: "flex-start" }}>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginBottom: 6 }}>
                    <PriorityBadge priority={selected.priority} />
                    <StatusBadge status={detail?.status || selected.status} />
                  </div>
                  <div style={{ fontWeight: 700, fontSize: 15, wordBreak: "break-word" }}>{selected.title}</div>
                </div>
                <button onClick={() => { setSelected(null); setDetail(null); }} style={{ background: "none", border: "none", color: "var(--text3)", cursor: "pointer", fontSize: 20, flexShrink: 0, marginLeft: 8 }}>×</button>
              </div>

              {/* Panel body */}
              <div style={{ overflowY: "auto", flex: 1 }}>
                {detailLoading ? (
                  <div style={{ padding: 30, textAlign: "center", color: "var(--text3)" }}>Loading…</div>
                ) : detail ? (
                  <>
                    {/* ── Request info ── */}
                    <div style={{ padding: "14px 18px", borderBottom: "1px solid var(--border2)" }}>
                      <div style={{ display: "flex", flexDirection: "column", gap: 6, fontSize: 13 }}>
                        <div><span style={{ color: "var(--text3)", display: "inline-block", width: 96 }}>Requester</span>{detail.requesterName || detail.requesterEmail || "—"}</div>
                        <div><span style={{ color: "var(--text3)", display: "inline-block", width: 96 }}>Assignee</span>{detail.assigneeName || detail.assigneeEmail || <em style={{ color: "var(--text3)" }}>Unassigned</em>}</div>
                        <div><span style={{ color: "var(--text3)", display: "inline-block", width: 96 }}>Due Date</span>
                          {detail.dueDate ? (
                            <span style={{ color: isOverdue(detail.dueDate, detail.status) ? "var(--red)" : "var(--text)", fontWeight: isOverdue(detail.dueDate, detail.status) ? 600 : 400 }}>
                              {formatDate(detail.dueDate)}{isOverdue(detail.dueDate, detail.status) && " ⚠ Overdue"}
                            </span>
                          ) : <em style={{ color: "var(--text3)" }}>No due date</em>}
                        </div>
                        <div><span style={{ color: "var(--text3)", display: "inline-block", width: 96 }}>Created</span>{formatDate(detail.createdAt)}</div>
                      </div>
                      {detail.description && (
                        <div style={{ marginTop: 10, padding: "8px 10px", background: "var(--bg3)", borderRadius: 6, fontSize: 13, color: "var(--text2)", lineHeight: 1.5, whiteSpace: "pre-wrap" }}>
                          {detail.description}
                        </div>
                      )}
                    </div>

                    {/* ── Linked question ── */}
                    {detail.questionId && (
                      <div style={{ padding: "12px 18px", borderBottom: "1px solid var(--border2)" }}>
                        <div style={{ fontSize: 11, fontWeight: 600, color: "var(--text3)", textTransform: "uppercase", letterSpacing: "0.05em", marginBottom: 6 }}>Linked Question</div>
                        <div
                          style={{ fontFamily: "var(--mono)", fontSize: 13, fontWeight: 700, color: "var(--accent)", cursor: "pointer", textDecoration: "underline", marginBottom: 2 }}
                          onClick={() => navigate(`/questions/${detail.questionId}`)}
                        >
                          {detail.questionId}
                        </div>
                        {detail.controlArea && <div style={{ fontSize: 12, color: "var(--text3)" }}>{detail.controlArea}</div>}
                        {detail.baselineQuestion && <div style={{ fontSize: 12, color: "var(--text2)", marginTop: 2, lineHeight: 1.4 }}>{detail.baselineQuestion}</div>}
                      </div>
                    )}

                    {/* ── Artifact Group ── */}
                    {detail.artifactGroupId && (
                      <div style={{ padding: "12px 18px", borderBottom: "1px solid var(--border2)" }}>
                        <div style={{ fontSize: 11, fontWeight: 600, color: "var(--text3)", textTransform: "uppercase", letterSpacing: "0.05em", marginBottom: 4 }}>Artifact Group</div>
                        <div style={{ fontSize: 13, color: "var(--text2)" }}>Group #{detail.artifactGroupId}</div>
                      </div>
                    )}

                    {/* ── Fulfilled evidence ── */}
                    {detail.fulfilledEvidenceId && (
                      <div style={{ padding: "12px 18px", borderBottom: "1px solid var(--border2)" }}>
                        <div style={{ fontSize: 11, fontWeight: 600, color: "var(--text3)", textTransform: "uppercase", letterSpacing: "0.05em", marginBottom: 8 }}>Uploaded Evidence</div>
                        <div style={{ display: "flex", alignItems: "center", gap: 10, padding: "8px 10px", background: "var(--bg3)", borderRadius: 8 }}>
                          <span style={{ fontSize: 22 }}>{vaultFileIcon(detail.evidenceFileType)}</span>
                          <div style={{ flex: 1, minWidth: 0 }}>
                            <div style={{ fontSize: 13, fontWeight: 600, wordBreak: "break-word" }}>{detail.evidenceTitle || "Vault item"}</div>
                            {detail.evidenceFileType && <div style={{ fontSize: 11, color: "var(--text3)" }}>{detail.evidenceFileType} {formatBytes(detail.evidenceFileSize)}</div>}
                          </div>
                          <button
                            className="btn btn-ghost"
                            style={{ fontSize: 11, padding: "4px 10px", flexShrink: 0 }}
                            onClick={() => navigate("/vault")}
                          >View in Vault</button>
                        </div>
                      </div>
                    )}

                    {/* ── Action buttons ── */}
                    {(canFulfill || canCancel || canMarkComplete || (canManage && detail.status === "In Progress")) && (
                      <div style={{ padding: "12px 18px", borderBottom: "1px solid var(--border2)", display: "flex", gap: 8, flexWrap: "wrap" }}>
                        {canFulfill && (
                          <button
                            className="btn btn-primary"
                            style={{ fontSize: 12 }}
                            onClick={() => { setShowFulfill(true); setFulfillError(""); setPickerSearch(""); setFulfillTab("vault"); }}
                          >
                            Submit Evidence
                          </button>
                        )}
                        {detail.status === "Open" && (canManage || isAssignee) && (
                          <button className="btn btn-ghost" style={{ fontSize: 12 }} onClick={() => handleStatusChange("In Progress")}>
                            Mark In Progress
                          </button>
                        )}
                        {canMarkComplete && (
                          <button className="btn btn-ghost" style={{ fontSize: 12, color: "var(--green)" }} onClick={() => handleStatusChange("Completed")}>
                            Mark Completed
                          </button>
                        )}
                        {detail.status === "Submitted" && canManage && (
                          <button className="btn btn-ghost" style={{ fontSize: 12, color: "var(--amber)" }} onClick={() => handleStatusChange("In Progress")}>
                            Reopen
                          </button>
                        )}
                        {canCancel && (
                          <button className="btn btn-ghost" style={{ fontSize: 12, color: "var(--red)" }} onClick={handleCancel}>
                            Cancel
                          </button>
                        )}
                      </div>
                    )}

                    {/* ── Activity timeline + Comments ── */}
                    <div style={{ padding: "14px 18px" }}>
                      <div style={{ fontSize: 11, fontWeight: 600, color: "var(--text3)", textTransform: "uppercase", letterSpacing: "0.05em", marginBottom: 10 }}>Activity</div>
                      {buildTimeline(detail).map((ev, i) => (
                        <div key={ev.id || i} style={{ display: "flex", gap: 10, marginBottom: 12 }}>
                          <div style={{ fontSize: 16, flexShrink: 0, lineHeight: "20px" }}>{ev.icon}</div>
                          <div style={{ flex: 1, minWidth: 0 }}>
                            {ev.type === "comment" ? (
                              <>
                                <div style={{ fontSize: 12, fontWeight: 600, color: "var(--text2)", marginBottom: 2 }}>{ev.author}</div>
                                <div style={{ fontSize: 13, color: "var(--text)", lineHeight: 1.5, whiteSpace: "pre-wrap", wordBreak: "break-word", background: "var(--bg3)", padding: "6px 10px", borderRadius: 6 }}>{ev.label}</div>
                              </>
                            ) : (
                              <div style={{ fontSize: 13, color: "var(--text2)", lineHeight: 1.4 }}>{ev.label}</div>
                            )}
                            <div style={{ fontSize: 11, color: "var(--text3)", marginTop: 2 }}>{formatDate(ev.time)}</div>
                          </div>
                        </div>
                      ))}

                      {/* New comment */}
                      {canWrite && !["Cancelled"].includes(detail?.status) && (
                        <div style={{ marginTop: 8 }}>
                          <textarea
                            value={commentBody}
                            onChange={e => setCommentBody(e.target.value)}
                            placeholder="Add a comment…"
                            rows={2}
                            style={{ width: "100%", padding: "8px 10px", borderRadius: 6, border: "1px solid var(--border2)", background: "var(--bg3)", color: "var(--text)", fontSize: 13, resize: "vertical", boxSizing: "border-box" }}
                          />
                          <button
                            className="btn btn-ghost"
                            style={{ marginTop: 6, fontSize: 12 }}
                            disabled={!commentBody.trim() || submittingComment}
                            onClick={handleComment}
                          >
                            {submittingComment ? "Posting…" : "Post comment"}
                          </button>
                        </div>
                      )}
                    </div>
                  </>
                ) : null}
              </div>
            </div>
          )}
        </div>
      </div>

      {/* ── Create Modal ── */}
      {showCreate && (
        <div className="modal-overlay" onClick={() => setShowCreate(false)}>
          <div className="module-modal" style={{ maxWidth: 500 }} onClick={e => e.stopPropagation()}>
            <div className="module-modal-header">
              <div className="module-modal-title">New Evidence Request</div>
              <button className="modal-close" onClick={() => setShowCreate(false)}>×</button>
            </div>
            <div className="module-modal-content" style={{ padding: 20, display: "flex", flexDirection: "column", gap: 14 }}>
              <div>
                <label style={{ fontSize: 12, color: "var(--text3)", display: "block", marginBottom: 4 }}>Title *</label>
                <input
                  type="text"
                  value={createForm.title}
                  onChange={e => setCreateForm(f => ({ ...f, title: e.target.value }))}
                  placeholder="e.g. Upload Q3 penetration test report"
                  style={{ width: "100%", padding: "8px 12px", borderRadius: 6, border: "1px solid var(--border2)", background: "var(--bg3)", color: "var(--text)", fontSize: 13, boxSizing: "border-box" }}
                />
              </div>
              <div>
                <label style={{ fontSize: 12, color: "var(--text3)", display: "block", marginBottom: 4 }}>Description</label>
                <textarea
                  value={createForm.description}
                  onChange={e => setCreateForm(f => ({ ...f, description: e.target.value }))}
                  placeholder="What evidence is needed and why…"
                  rows={3}
                  style={{ width: "100%", padding: "8px 12px", borderRadius: 6, border: "1px solid var(--border2)", background: "var(--bg3)", color: "var(--text)", fontSize: 13, resize: "vertical", boxSizing: "border-box" }}
                />
              </div>
              <div style={{ display: "flex", gap: 12 }}>
                <div style={{ flex: 1 }}>
                  <label style={{ fontSize: 12, color: "var(--text3)", display: "block", marginBottom: 4 }}>Priority</label>
                  <select
                    value={createForm.priority}
                    onChange={e => setCreateForm(f => ({ ...f, priority: e.target.value }))}
                    style={{ width: "100%", padding: "8px 10px", borderRadius: 6, border: "1px solid var(--border2)", background: "var(--bg3)", color: "var(--text)", fontSize: 13 }}
                  >
                    {PRIORITY_OPTIONS.map(p => <option key={p} value={p}>{p}</option>)}
                  </select>
                </div>
                <div style={{ flex: 1 }}>
                  <label style={{ fontSize: 12, color: "var(--text3)", display: "block", marginBottom: 4 }}>Due Date</label>
                  <input
                    type="date"
                    value={createForm.dueDate}
                    onChange={e => setCreateForm(f => ({ ...f, dueDate: e.target.value }))}
                    style={{ width: "100%", padding: "8px 10px", borderRadius: 6, border: "1px solid var(--border2)", background: "var(--bg3)", color: "var(--text)", fontSize: 13, boxSizing: "border-box" }}
                  />
                </div>
              </div>
              <div>
                <label style={{ fontSize: 12, color: "var(--text3)", display: "block", marginBottom: 4 }}>Assign To</label>
                <select
                  value={createForm.assigneeId}
                  onChange={e => setCreateForm(f => ({ ...f, assigneeId: e.target.value }))}
                  style={{ width: "100%", padding: "8px 10px", borderRadius: 6, border: "1px solid var(--border2)", background: "var(--bg3)", color: "var(--text)", fontSize: 13 }}
                >
                  <option value="">— Unassigned —</option>
                  {assignableUsers.map(u => (
                    <option key={u.id} value={u.id}>{u.name} ({u.role})</option>
                  ))}
                </select>
              </div>
              <div>
                <label style={{ fontSize: 12, color: "var(--text3)", display: "block", marginBottom: 4 }}>Link to Question (Question ID)</label>
                <input
                  type="text"
                  value={createForm.questionId}
                  onChange={e => setCreateForm(f => ({ ...f, questionId: e.target.value }))}
                  placeholder="e.g. P1.1.1"
                  style={{ width: "100%", padding: "8px 12px", borderRadius: 6, border: "1px solid var(--border2)", background: "var(--bg3)", color: "var(--text)", fontSize: 13, boxSizing: "border-box" }}
                />
              </div>
              {createError && <div style={{ fontSize: 12, color: "var(--red)" }}>✗ {createError}</div>}
              <div style={{ display: "flex", gap: 8 }}>
                <button className="btn btn-primary" style={{ flex: 1 }} onClick={handleCreate} disabled={creating}>
                  {creating ? "Creating…" : "Create Request"}
                </button>
                <button className="btn btn-ghost" onClick={() => setShowCreate(false)}>Cancel</button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ── Fulfill Modal ── */}
      {showFulfill && (
        <div className="modal-overlay" onClick={() => setShowFulfill(false)}>
          <div className="module-modal" style={{ maxWidth: 520 }} onClick={e => e.stopPropagation()}>
            <div className="module-modal-header">
              <div className="module-modal-title">Submit Evidence</div>
              <button className="modal-close" onClick={() => setShowFulfill(false)}>×</button>
            </div>
            <div className="module-modal-content" style={{ padding: 0 }}>
              {/* Tab bar */}
              <div style={{ display: "flex", borderBottom: "1px solid var(--border2)" }}>
                {[{ key: "vault", label: "Select from Vault" }, ...(isVerified !== false ? [{ key: "upload", label: "Upload New File" }] : [])].map(t => (
                  <button
                    key={t.key}
                    onClick={() => setFulfillTab(t.key)}
                    style={{ flex: 1, padding: "10px 16px", fontSize: 13, fontWeight: fulfillTab === t.key ? 600 : 400, background: "none", border: "none", borderBottom: `2px solid ${fulfillTab === t.key ? "var(--accent)" : "transparent"}`, color: fulfillTab === t.key ? "var(--accent)" : "var(--text2)", cursor: "pointer" }}
                  >
                    {t.label}
                  </button>
                ))}
              </div>

              <div style={{ padding: 16 }}>
                {fulfillTab === "vault" ? (
                  <>
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
                      <div style={{ display: "flex", flexDirection: "column", gap: 8, maxHeight: 320, overflowY: "auto" }}>
                        {pickerItems.map(item => (
                          <div key={item.id} style={{ display: "flex", alignItems: "center", gap: 10, padding: "10px 12px", background: "var(--bg3)", borderRadius: 8 }}>
                            <span style={{ fontSize: 20, flexShrink: 0 }}>{vaultFileIcon(item.fileType)}</span>
                            <div style={{ flex: 1, minWidth: 0 }}>
                              <div style={{ fontSize: 13, fontWeight: 600, wordBreak: "break-word" }}>{item.title}</div>
                              {item.description && <div style={{ fontSize: 11, color: "var(--text3)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{item.description}</div>}
                              <div style={{ fontSize: 11, color: "var(--text3)" }}>{formatBytes(item.fileSize)}</div>
                            </div>
                            <button
                              className="btn btn-primary"
                              style={{ fontSize: 11, padding: "5px 12px", flexShrink: 0 }}
                              disabled={fulfilling}
                              onClick={() => handleFulfillWithVault(item.id)}
                            >
                              {fulfilling ? "…" : "Use this"}
                            </button>
                          </div>
                        ))}
                      </div>
                    )}
                  </>
                ) : (
                  <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
                    <div>
                      <label style={{ fontSize: 12, color: "var(--text3)", display: "block", marginBottom: 4 }}>Title *</label>
                      <input
                        type="text"
                        value={fulfillUpTitle}
                        onChange={e => setFulfillUpTitle(e.target.value)}
                        placeholder="Evidence title"
                        style={{ width: "100%", padding: "8px 12px", borderRadius: 6, border: "1px solid var(--border2)", background: "var(--bg3)", color: "var(--text)", fontSize: 13, boxSizing: "border-box" }}
                      />
                    </div>
                    <div>
                      <label style={{ fontSize: 12, color: "var(--text3)", display: "block", marginBottom: 4 }}>Description</label>
                      <textarea
                        value={fulfillUpDesc}
                        onChange={e => setFulfillUpDesc(e.target.value)}
                        rows={2}
                        style={{ width: "100%", padding: "8px 12px", borderRadius: 6, border: "1px solid var(--border2)", background: "var(--bg3)", color: "var(--text)", fontSize: 13, resize: "vertical", boxSizing: "border-box" }}
                      />
                    </div>
                    <div>
                      <label style={{ fontSize: 12, color: "var(--text3)", display: "block", marginBottom: 4 }}>File *</label>
                      <div
                        onClick={() => upFileRef.current?.click()}
                        style={{ border: "2px dashed var(--border2)", borderRadius: 8, padding: "16px", textAlign: "center", cursor: "pointer", background: "var(--bg3)" }}
                      >
                        <input ref={upFileRef} type="file" style={{ display: "none" }} onChange={e => setFulfillUpFile(e.target.files[0])} />
                        {fulfillUpFile ? (
                          <div>
                            <div style={{ fontSize: 20 }}>{vaultFileIcon(fulfillUpFile.type)}</div>
                            <div style={{ fontSize: 13, fontWeight: 600 }}>{fulfillUpFile.name}</div>
                            <div style={{ fontSize: 11, color: "var(--text3)" }}>{formatBytes(fulfillUpFile.size)}</div>
                          </div>
                        ) : (
                          <div style={{ color: "var(--text3)", fontSize: 13 }}>Click to select a file</div>
                        )}
                      </div>
                    </div>
                    {fulfillError && <div style={{ fontSize: 12, color: "var(--red)" }}>✗ {fulfillError}</div>}
                    <button
                      className="btn btn-primary"
                      onClick={handleFulfillWithUpload}
                      disabled={fulfillUploading}
                    >
                      {fulfillUploading ? "Uploading & Submitting…" : "Upload & Submit Evidence"}
                    </button>
                  </div>
                )}
                {fulfillError && fulfillTab === "vault" && <div style={{ fontSize: 12, color: "var(--red)", marginTop: 8 }}>✗ {fulfillError}</div>}
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
