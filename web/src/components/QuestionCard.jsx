import { apiUpload, apiFetch } from "../api/client.js";
import { isPendingScan, pendingScanMessage } from "../utils/uploadScan.js";
import { useEffect, useState } from "react";
import { isApprovedStatus } from "../utils/reviewStatus.js";

function localToday() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,"0")}-${String(d.getDate()).padStart(2,"0")}`;
}

function formatDueDate(dateStr) {
  if (!dateStr) return null;
  const s = dateStr.slice(0, 10);
  const [y, m, d] = s.split("-").map(Number);
  const months = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];
  return `${d} ${months[m - 1]} ${y}`;
}

const ANSWER_OPTIONS = [
  { value: "IMPLEMENTED", label: "Implemented", className: "selected-implemented" },
  { value: "PARTIALLY_IMPLEMENTED", label: "Partially Implemented", className: "selected-partial" },
  { value: "PLANNED", label: "Planned", className: "selected-planned" },
  { value: "NOT_IMPLEMENTED", label: "Not Implemented", className: "selected-notimpl" },
  { value: "NOT_APPLICABLE", label: "Not Applicable", className: "selected-na" }
];

const MATURITY = [
  { n: 1, label: "Ad-hoc", desc: "No formal process. Controls are reactive, undocumented, and person-dependent." },
  { n: 2, label: "Repeatable", desc: "Some informal processes exist and are repeated, but not fully documented or standardized." },
  { n: 3, label: "Defined", desc: "Processes are documented, standardized, and communicated. Meets YES / Level 3+ threshold." },
  { n: 4, label: "Managed", desc: "Processes are measured, monitored, and controlled with metrics and regular reviews." },
  { n: 5, label: "Optimised", desc: "Continuous improvement cycle is active. Process is benchmarked and proactively refined." }
];

export default function QuestionCard({ question, assessment, response, onSetResponse, token, month, reminders, onEvidenceChange, onSaveActionDetails, user, isVerified }) {
  const inputId = `fileInput-${question.questId}`;
  const [isEditing, setIsEditing] = useState(false);

  // Request evidence state
  const [showReqEvidence, setShowReqEvidence] = useState(false);
  const [reqEmail, setReqEmail]               = useState("");
  const [reqLoading, setReqLoading]           = useState(false);
  const [reqError, setReqError]               = useState("");
  const [reqSuccess, setReqSuccess]           = useState(false);
  const [orgUsers, setOrgUsers]               = useState(null);

  // Vault-link state
  const [vaultItems, setVaultItems]               = useState([]);
  const [showVaultPicker, setShowVaultPicker]     = useState(false);
  const [pickerItems, setPickerItems]             = useState([]);
  const [pickerSearch, setPickerSearch]           = useState("");
  const [pickerLoading, setPickerLoading]         = useState(false);
  const [linkingVaultId, setLinkingVaultId]       = useState(null);
  const [vaultItemsLoaded, setVaultItemsLoaded]   = useState(false);

  // Suggested evidence state
  const [suggestions, setSuggestions]             = useState(null);
  const [suggestionsLoading, setSuggestionsLoading] = useState(false);
  const [ignoredSuggestions, setIgnoredSuggestions] = useState(new Set());
  const [attachingSuggestion, setAttachingSuggestion] = useState(null);

  const orgDomain = user?.email ? user.email.split("@")[1] : null;
  const isOrgEmail = (email) => orgDomain && email.toLowerCase().endsWith("@" + orgDomain.toLowerCase());

  const handleFileUpload = async (e) => {
    if (e.target.files && e.target.files[0]) {
      const file = e.target.files[0];
      try {
        const created = await apiUpload("/api/evidence", file, { moduleId: question.moduleId, questId: question.questId, month, evidenceName: file.name }, token);
        if (isPendingScan(created)) {
          alert(pendingScanMessage(created));
          return;
        }
        const files = [...(response.files || []), { id: created.id, name: created.evidenceName || created.evidence_name }];
        onSetResponse("files", files);
        if (onEvidenceChange) await onEvidenceChange();
      } catch (err) {
        console.error("Upload failed", err);
        alert(`Evidence upload failed: ${err.message || "Please try again"}`);
      }
    }
  };

  const removeFile = async (index) => {
    const file = (response.files || [])[index];
    if (file && typeof file === "object" && file.id) {
      try {
        await apiFetch(`/api/evidence/${file.id}`, { token, method: "DELETE" });
        if (onEvidenceChange) await onEvidenceChange();
      } catch (err) {
        console.error("Failed to delete evidence", err);
      }
    }
    const files = (response.files || []).filter((_, i) => i !== index);
    onSetResponse("files", files);
  };

  const reviewStatus = assessment?.reviewStatus || assessment?.review_status;
  const reviewerPassed = isApprovedStatus(reviewStatus); // FINISHED or AUDITED
  const auditPassed = reviewStatus === "AUDITED";
  const submittedForReview = reviewStatus === "Submitted";

  const needsActionDetails = ["NOT_IMPLEMENTED", "PARTIALLY_IMPLEMENTED", "PLANNED"].includes(response.answer);
  const needsEvidence = response.answer === "IMPLEMENTED";
  const isNA = response.answer === "NOT_APPLICABLE";
  const isImplementedAnswer = assessment?.answer === "IMPLEMENTED" || assessment?.answer === "YES";

  const gates = needsActionDetails
    ? [
        { label: `Answer = ${ANSWER_OPTIONS.find(a => a.value === response.answer)?.label || response.answer}`, pass: true },
        { label: "Owner set", pass: !!response.actionOwner },
        { label: "Due date set", pass: !!response.actionDueDate },
        { label: "Notes provided", pass: !!response.actionNotes },
        { label: reviewerPassed ? "Quest completed" : "Pending save", pass: reviewerPassed }
      ]
    : isNA
    ? [
        { label: "Answer = Not Applicable", pass: true },
        { label: "Explanation provided", pass: !!response.comment },
        { label: reviewerPassed ? "Quest completed" : "Pending save", pass: reviewerPassed }
      ]
    : [
        { label: "Answer = Implemented", pass: response.answer === "IMPLEMENTED" },
        { label: "Maturity >= level 3", pass: response.maturity >= 3 },
        { label: "Evidence provided", pass: !!response.link || (response.files && response.files.length > 0) || vaultItems.length > 0 },
        { label: reviewerPassed ? "Review completed" : "Reviewer WIP", pass: reviewerPassed }
      ];

  const maturityDesc = response.maturity
    ? MATURITY[response.maturity - 1].desc
    : "Select a maturity level above to see the description.";

  // Load org users when evidence or action details sections are visible
  useEffect(() => {
    if ((needsEvidence || needsActionDetails) && orgUsers === null && token) {
      apiFetch("/api/requests/users", { token })
        .then(data => setOrgUsers(data || []))
        .catch(() => setOrgUsers([]));
    }
  }, [needsEvidence, needsActionDetails, token]);

  // Sync vault attachment state so Tracker's submit check can see it
  useEffect(() => {
    onSetResponse("vaultLinked", vaultItems.length > 0);
  }, [vaultItems]);

  // Load vault items and suggestions when evidence section opens
  useEffect(() => {
    if (!needsEvidence || !token || vaultItemsLoaded) return;
    setVaultItemsLoaded(true);
    apiFetch(`/api/vault?questId=${encodeURIComponent(question.questId)}`, { token })
      .then(data => setVaultItems(data || []))
      .catch(() => {});
    setSuggestionsLoading(true);
    apiFetch(`/api/vault/suggestions?questId=${encodeURIComponent(question.questId)}`, { token })
      .then(data => setSuggestions(data || []))
      .catch(() => setSuggestions([]))
      .finally(() => setSuggestionsLoading(false));
  }, [needsEvidence, token, question.questId, vaultItemsLoaded]);

  const loadPicker = async (search = "") => {
    setPickerLoading(true);
    try {
      const url = search.trim() ? `/api/vault?search=${encodeURIComponent(search.trim())}` : "/api/vault";
      const data = await apiFetch(url, { token });
      setPickerItems(data || []);
    } catch { /* silent */ }
    setPickerLoading(false);
  };

  const handleVaultLink = async (vaultId) => {
    setLinkingVaultId(vaultId);
    try {
      await apiFetch(`/api/vault/${vaultId}/link`, {
        token, method: "POST",
        body: JSON.stringify({ questId: question.questId })
      });
      const data = await apiFetch(`/api/vault?questId=${encodeURIComponent(question.questId)}`, { token });
      setVaultItems(data || []);
      setShowVaultPicker(false);
    } catch { /* silent */ }
    setLinkingVaultId(null);
  };

  const handleVaultDetach = async (vaultId) => {
    try {
      await apiFetch(`/api/vault/${vaultId}/link/${encodeURIComponent(question.questId)}`, { token, method: "DELETE" });
      setVaultItems(prev => prev.filter(v => v.id !== vaultId));
    } catch (err) {
      alert(err.message || "Could not detach evidence.");
    }
  };

  const handleSuggestionAttach = async (vaultId) => {
    setAttachingSuggestion(vaultId);
    try {
      await apiFetch(`/api/vault/${vaultId}/link`, {
        token, method: "POST",
        body: JSON.stringify({ questId: question.questId })
      });
      const data = await apiFetch(`/api/vault?questId=${encodeURIComponent(question.questId)}`, { token });
      setVaultItems(data || []);
      setIgnoredSuggestions(prev => new Set([...prev, vaultId]));
    } catch { /* silent */ }
    setAttachingSuggestion(null);
  };

  function addIntervalQC(date, interval) {
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

  const handleAnswer = (answer) => {
    onSetResponse("answer", answer);
  };

  const handleRequestEvidence = async () => {
    const email = reqEmail.trim();
    if (!email) { setReqError("Email is required"); return; }
    if (orgDomain && !isOrgEmail(email)) { setReqError(`Must be a @${orgDomain} address`); return; }
    const assignee = orgUsers?.find(u => u.email.toLowerCase() === email.toLowerCase());
    if (!assignee) { setReqError("User not found in your organisation. They may need to sign up first."); return; }
    setReqLoading(true);
    setReqError("");
    try {
      await apiFetch("/api/requests", {
        token, method: "POST",
        body: JSON.stringify({
          title: `Evidence needed for ${question.questId}`,
          description: question.requiredEvidence || `Please provide evidence for: ${question.controlArea}`,
          priority: "Medium",
          questionId: question.questId,
          assigneeId: assignee.id,
        })
      });
      setReqSuccess(true);
      setReqEmail("");
      setShowReqEvidence(false);
    } catch (e) {
      setReqError(e.message);
    } finally {
      setReqLoading(false);
    }
  };

  const handleEditClick = async () => {
    if (window.confirm("Editing will reset the review status to WIP. The reviewer will need to re-approve. Continue?")) {
      try {
        // Set review status back to WIP and allow editing
        await apiFetch(`/api/assessments/${assessment.id}`, {
          token,
          method: "PUT",
          body: JSON.stringify({ reviewStatus: "WIP" })
        });
        setIsEditing(true);
      } catch (err) {
        console.error("Failed to update assessment:", err);
        alert("Failed to enable editing. Please try again.");
      }
    }
  };

  // Show read-only when submitted-for-review (pending) or fully approved
  const showReadOnly = (reviewerPassed || submittedForReview) && !isEditing;

  const rejectedByReviewer = reviewStatus === "WIP" && !!(assessment?.reviewerNotes || assessment?.reviewer_notes);
  // Only a rejection (status sent back to WIP) — an auditor may also leave notes
  // on an approval, which must not render as a rejection.
  const rejectedByAuditor = reviewStatus === "WIP" && !!(assessment?.auditorNotes || assessment?.auditor_notes);

  return (
    <div className="quest-card">
      {(rejectedByReviewer || rejectedByAuditor) && (
        <div style={{
          margin: "0 0 16px",
          padding: "12px 16px",
          background: "rgba(239,68,68,0.08)",
          border: "1px solid rgba(239,68,68,0.35)",
          borderRadius: 8,
          display: "flex",
          gap: 10,
          alignItems: "flex-start",
        }}>
          <span style={{ fontSize: 16, flexShrink: 0, color: "var(--red, #ef4444)", fontWeight: 700 }}>✗</span>
          <div>
            <div style={{ fontWeight: 700, fontSize: 13, color: "var(--red, #ef4444)", marginBottom: 3 }}>
              {rejectedByAuditor
                ? `Rejected by ${assessment.auditedBy || assessment.audited_by || "auditor"}`
                : `Rejected by ${assessment.reviewedBy || assessment.reviewed_by || "reviewer"}`}
            </div>
            <div style={{ fontSize: 13, color: "var(--text2)", lineHeight: 1.5 }}>
              {rejectedByAuditor
                ? (assessment.auditorNotes || assessment.auditor_notes)
                : (assessment.reviewerNotes || assessment.reviewer_notes)}
            </div>
            <div style={{ fontSize: 12, color: "var(--text3)", marginTop: 4 }}>
              Review the feedback above and resubmit.
            </div>
          </div>
        </div>
      )}
      <div className="card-meta">
        <span className="pill pill-module">
          {question.moduleId && question.moduleName
            ? (question.moduleName.toLowerCase().startsWith(question.moduleId.toLowerCase())
                ? question.moduleName
                : `${question.moduleId} — ${question.moduleName}`)
            : (question.moduleName || question.moduleId)}
        </span>
        {question.isoReference && (
          <span className="pill pill-iso">{question.isoReference}</span>
        )}
        {(question.departments?.length > 0 || question.defaultOwner) && (
          <span className="pill pill-owner" title={question.departments?.length ? `Owner: ${question.defaultOwner || "—"}` : undefined}>
            {question.departments?.length ? question.departments.map((d) => d.name).join(", ") : question.defaultOwner}
          </span>
        )}
        {question.priority && (
          <span className={`pill pill-priority pill-priority-${(question.priority || '').toLowerCase()}`}>
            {question.priority}
          </span>
        )}
        {question.recurrenceInterval && question.recurrenceInterval !== "none" && (
          <span className="pill pill-recurrence">⟳ {question.recurrenceInterval}</span>
        )}
        {question.nextDueDate && (
          <span className="pill pill-due">Due: {question.nextDueDate.slice(0, 10)}</span>
        )}
        {(question.isOverdue || question.status === 'OVERDUE' || (question.nextDueDate && new Date(question.nextDueDate) < new Date())) && (
          <span className="badge-overdue">OVERDUE</span>
        )}
        {question.tags && (
          <div style={{ display: "flex", gap: 4, flexWrap: "wrap" }}>
            {question.tags.split(',').filter(t => t.trim()).map(tag => (
              <span key={tag.trim()} className="tag-badge">{tag.trim()}</span>
            ))}
          </div>
        )}
        {question.dueDate && (() => {
          const dateOnly = question.dueDate.slice(0, 10);
          const today = localToday();
          const sevenDays = new Date(Date.now() + 7*24*60*60*1000).toISOString().slice(0,10);
          const overdue = dateOnly < today && !["IMPLEMENTED","NOT_APPLICABLE"].includes(question.latestAnswer);
          const warning = !overdue && dateOnly >= today && dateOnly <= sevenDays;
          return (
            <div style={{ display: "flex", gap: 6, alignItems: "center", flexWrap: "wrap" }}>
              <span className={`pill ${overdue ? "pill-due-overdue" : warning ? "pill-due-warning" : "pill-due"}`}>
                Due: {formatDueDate(dateOnly)}
              </span>
              {overdue && <span className="badge-overdue">OVERDUE</span>}
              {warning && <span className="badge-due-warning">Due soon</span>}
            </div>
          );
        })()}
      </div>

      <h1 className="quest-title">{question.controlArea}</h1>

      <div className="question-block">
        <div className="q-label">Baseline question</div>
        <p className="q-text">{question.baselineQuestion}</p>
        <div className="level3-label">Level 3+ criteria</div>
        <p className="level3-text">{question.level3YesCriteria}</p>
        <p className="evidence-req">Required evidence: {question.requiredEvidence}</p>
      </div>


      {showReadOnly ? (
        <div className="assessment-info-card">
          <div className="assessment-info-title">
            {auditPassed
              ? "✓ Audited — auditor sign-off complete"
              : reviewerPassed && isImplementedAnswer ? "✓ Review completed"
              : reviewerPassed ? "✓ Quest completed"
              : "⏳ Submitted — awaiting review"}
          </div>
          <div className="assessment-info-row">
            <div className="assessment-info-label">Answer:</div>
            <div className="assessment-info-value"><strong>{assessment.answer}</strong></div>
          </div>
          {isImplementedAnswer && (
            <div className="assessment-info-row">
              <div className="assessment-info-label">Maturity Level:</div>
              <div className="assessment-info-value"><strong>{assessment.currentLevel}</strong></div>
            </div>
          )}
          {!isImplementedAnswer && assessment.answer !== "NOT_APPLICABLE" && (assessment.actionOwner || assessment.actionDueDate) && (
            <>
              {assessment.actionOwner && (
                <div className="assessment-info-row">
                  <div className="assessment-info-label">Responsible person:</div>
                  <div className="assessment-info-value">{assessment.actionOwner}</div>
                </div>
              )}
              {assessment.actionDueDate && (
                <div className="assessment-info-row">
                  <div className="assessment-info-label">Due date:</div>
                  <div className="assessment-info-value">{String(assessment.actionDueDate).slice(0, 10)}</div>
                </div>
              )}
              {assessment.actionNotes && (
                <div className="assessment-info-row">
                  <div className="assessment-info-label">Action notes:</div>
                  <div className="assessment-info-value" style={{ whiteSpace: "pre-wrap" }}>{assessment.actionNotes}</div>
                </div>
              )}
            </>
          )}
          {assessment.evidenceLink && (
            <div className="assessment-info-row">
              <div className="assessment-info-label">Evidence Link:</div>
              <div className="assessment-info-value">
                <a href={assessment.evidenceLink} target="_blank" rel="noopener noreferrer" style={{ color: "var(--teal)", textDecoration: "underline" }}>
                  {assessment.evidenceLink}
                </a>
              </div>
            </div>
          )}
          {assessment.comments && (
            <div className="assessment-info-row">
              <div className="assessment-info-label">Internal Notes:</div>
              <div className="assessment-info-value">{assessment.comments}</div>
            </div>
          )}
          {assessment.submittedBy && (
            <div className="assessment-info-row">
              <div className="assessment-info-label">Submitted by:</div>
              <div className="assessment-info-value" style={{ color: "var(--text3)" }}>{assessment.submittedBy}</div>
            </div>
          )}
          {(assessment.reviewedBy || assessment.reviewed_by) && (
            <div className="assessment-info-row">
              <div className="assessment-info-label">Reviewed by:</div>
              <div className="assessment-info-value" style={{ color: "var(--text3)" }}>
                {assessment.reviewedBy || assessment.reviewed_by}
                {(assessment.reviewedAt || assessment.reviewed_at) && (
                  <span style={{ marginLeft: 8, fontSize: 11 }}>
                    on {new Date(assessment.reviewedAt || assessment.reviewed_at).toLocaleString()}
                  </span>
                )}
              </div>
            </div>
          )}
          {(assessment.reviewerNotes || assessment.reviewer_notes) && (
            <div className="assessment-info-row">
              <div className="assessment-info-label">Reviewer Notes:</div>
              <div className="assessment-info-value" style={{ color: "var(--amber)", fontStyle: "italic" }}>
                {assessment.reviewerNotes || assessment.reviewer_notes}
              </div>
            </div>
          )}
          {(assessment.auditedBy || assessment.audited_by) && (
            <div className="assessment-info-row">
              <div className="assessment-info-label">Audited by:</div>
              <div className="assessment-info-value" style={{ color: "var(--text3)" }}>
                {assessment.auditedBy || assessment.audited_by}
                {(assessment.auditedAt || assessment.audited_at) && (
                  <span style={{ marginLeft: 8, fontSize: 11 }}>
                    on {new Date(assessment.auditedAt || assessment.audited_at).toLocaleString()}
                  </span>
                )}
              </div>
            </div>
          )}
          {(assessment.auditorNotes || assessment.auditor_notes) && (
            <div className="assessment-info-row">
              <div className="assessment-info-label">Auditor notes:</div>
              <div className="assessment-info-value" style={{ color: "var(--amber)", fontStyle: "italic" }}>
                {assessment.auditorNotes || assessment.auditor_notes}
              </div>
            </div>
          )}
          {reviewerPassed && (
            // An audited assessment can only be reopened by an auditor or an admin.
            (assessment.reviewStatus || assessment.review_status) === "AUDITED" && !["ADMIN", "AUDITOR"].includes(user?.role) ? (
              <div className="muted" style={{ marginTop: 16, fontSize: 12 }}>
                🔒 Audited — only an auditor or an admin can reopen this assessment.
              </div>
            ) : user?.role === "CONTRIBUTOR"
                && String(assessment.submittedBy || assessment.submitted_by || "").toLowerCase() !== String(user?.email || "").toLowerCase() ? (
              // Contributors can only reopen their own submissions.
              <div className="muted" style={{ marginTop: 16, fontSize: 12 }}>
                🔒 Submitted by someone else — ask them, a lead or an admin to reopen it.
              </div>
            ) : (
              <div style={{ marginTop: 16 }}>
                <button className="btn-edit" onClick={handleEditClick}>
                  ✎ Edit Assessment
                </button>
              </div>
            )
          )}
        </div>
      ) : (
        <>
          <div className="section-label">Answer</div>
          <div className="answer-group">
            {ANSWER_OPTIONS.map((opt) => (
              <button
                key={opt.value}
                className={`answer-btn ${response.answer === opt.value ? opt.className : ""}`}
                onClick={() => handleAnswer(opt.value)}
              >
                {opt.label}
              </button>
            ))}
          </div>

          {needsActionDetails && (
            <div className="action-requirements">
              <div className="section-label">Action details</div>
              <div className="action-fields">
                <label>
                  Responsible person
                  {orgUsers && orgUsers.length > 0 ? (
                    <select
                      value={response.actionOwner || ""}
                      onChange={(e) => onSetResponse("actionOwner", e.target.value)}
                    >
                      <option value="">Select a person…</option>
                      {orgUsers.map(u => (
                        <option key={u.id} value={u.email}>
                          {u.fullName || u.full_name ? `${u.fullName || u.full_name} (${u.email})` : u.email}
                        </option>
                      ))}
                    </select>
                  ) : (
                    <input
                      type="email"
                      value={response.actionOwner || ""}
                      onChange={(e) => onSetResponse("actionOwner", e.target.value)}
                      placeholder={orgDomain ? `name@${orgDomain}` : "email@company.com"}
                    />
                  )}
                </label>
                <label>
                  Due date
                  <input
                    type="date"
                    value={response.actionDueDate || ""}
                    onChange={(e) => onSetResponse("actionDueDate", e.target.value)}
                  />
                </label>
              </div>
              <textarea
                className="comments-textarea"
                placeholder="Action notes, corrective steps, dependencies, or exceptions..."
                value={response.actionNotes || ""}
                onChange={(e) => onSetResponse("actionNotes", e.target.value)}
              ></textarea>
            </div>
          )}

          {isNA && (
            <div className="action-requirements">
              <div className="section-label">Explanation</div>
              <textarea
                className="comments-textarea"
                placeholder="Why does this control not apply? Provide a brief justification..."
                value={response.comment || ""}
                onChange={(e) => onSetResponse("comment", e.target.value)}
              ></textarea>
            </div>
          )}

          {needsActionDetails && reminders && reminders.length > 0 && (
            <div className="reminders-section">
              <div className="section-label">Upcoming reminders</div>
              <div className="reminders-list">
                {reminders.map((r) => {
                  const remindDateStr = (r.remindAt || r.remind_at || "").slice(0, 10);
                  const remindDate = new Date(r.remindAt || r.remind_at);
                  const daysUntil = Math.ceil((remindDate - new Date()) / (1000 * 60 * 60 * 24));
                  return (
                    <div key={r.id} className="reminder-item">
                      <span className="reminder-icon">⏰</span>
                      <span className="reminder-date">{remindDateStr}</span>
                      <span className="reminder-timing">
                        {daysUntil > 0 ? `in ${daysUntil} day${daysUntil !== 1 ? "s" : ""}` : daysUntil === 0 ? "today" : "overdue"}
                      </span>
                      {r.message && <span className="reminder-msg" title={r.message}>{r.message.substring(0, 40)}</span>}
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          {needsEvidence && (
            <>
              <div className="section-label">Maturity level</div>
              <div className="maturity-group">
                {MATURITY.map((m) => (
                  <button
                    key={m.n}
                    className={`maturity-btn ${response.maturity === m.n ? "selected" : ""}`}
                    onClick={() => onSetResponse("maturity", m.n)}
                  >
                    <span className="m-num">{m.n}</span>
                    <span className="m-label">{m.label}</span>
                  </button>
                ))}
              </div>
              <div className="maturity-desc">{maturityDesc}</div>

              <div className="section-label">Evidence &amp; Attachments</div>
              {isVerified === false ? (
                <div style={{ padding: "16px 20px", borderRadius: 12, border: "1px dashed var(--dp-line)", background: "var(--dp-surface-2)", textAlign: "center", fontSize: 13.5, color: "var(--dp-quiet)", marginBottom: 16 }}>
                  🔒 Evidence upload available after account verification
                </div>
              ) : (
                <>
                  <div className="evidence-drop" onClick={() => document.getElementById(inputId).click()}>
                    <div className="evidence-drop-icon">
                      <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                        <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"></path>
                        <polyline points="17 8 12 3 7 8"></polyline>
                        <line x1="12" y1="3" x2="12" y2="15"></line>
                      </svg>
                    </div>
                    <div className="evidence-drop-title">Click to upload or drag &amp; drop evidence files</div>
                    <div className="evidence-drop-sub">PDF, DOCX, XLSX, PNG, ZIP, CSV, PPTX — max 10 MB</div>
                  </div>
                  <input
                    type="file"
                    id={inputId}
                    style={{ display: "none" }}
                    accept=".pdf,.docx,.png,.xlsx,.zip,.csv,.pptx,.txt,.jpg,.jpeg"
                    onChange={handleFileUpload}
                  />
                </>
              )}
              {response.files && response.files.length > 0 && (
                <div className="file-list">
                  {response.files.map((file, i) => {
                    const isLink = file && typeof file === "object" && file.link;
                    const displayName = typeof file === "string" ? file : file.name;
                    const evidenceId = file && typeof file === "object" ? file.id : null;
                    return (
                      <div key={i} className="file-item" style={{ flexDirection: 'column', alignItems: 'stretch', gap: 8 }}>
                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                          {isLink ? (
                            <a 
                              href={file.link} 
                              target="_blank" 
                              rel="noopener noreferrer" 
                              className="file-name"
                              style={{ color: "var(--dp-accent, #4F46E5)", textDecoration: "underline", display: "inline-flex", alignItems: "center", gap: 6 }}
                            >
                              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                                <path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"></path>
                                <path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"></path>
                              </svg>
                              {displayName}
                            </a>
                          ) : (
                            <span className="file-name" style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
                              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ color: "var(--dp-accent)" }}>
                                <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"></path>
                                <polyline points="14 2 14 8 20 8"></polyline>
                              </svg>
                              {displayName}
                            </span>
                          )}
                          <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                            {evidenceId && isVerified !== false && (
                              <button
                                className="btn-compact"
                                style={{ fontSize: 12, padding: '4px 10px', borderRadius: 8, background: 'rgba(99,102,241,0.12)', border: '1px solid rgba(99,102,241,0.3)', color: 'var(--dp-accent)' }}
                                onClick={async () => {
                                  try {
                                    const analyzed = await apiFetch(`/api/evidence/${evidenceId}/analyze`, { token, method: 'POST' });
                                    const updatedFiles = [...(response.files || [])];
                                    updatedFiles[i] = { ...file, ...analyzed };
                                    onSetResponse('files', updatedFiles);
                                    if (onEvidenceChange) await onEvidenceChange();
                                  } catch (err) {
                                    console.error('AI analysis failed', err);
                                    alert(`AI analysis failed: ${err.message}`);
                                  }
                                }}
                              >
                                ✨ AI Analyze
                              </button>
                            )}
                            <button className="file-remove" onClick={() => removeFile(i)}>
                              Remove
                            </button>
                          </div>
                        </div>
                        {(file.aiContributorComments || file.aiDateWarning) && (
                          <div className="ai-feedback-card">
                            <div className="ai-feedback-header">
                              <span className="ai-feedback-icon">✨</span>
                              <span className="ai-feedback-title">AI Analysis</span>
                            </div>
                            {file.aiDateWarning && (
                              <div style={{ display: "flex", alignItems: "flex-start", gap: 8, margin: "6px 0 8px", padding: "8px 10px", background: "rgba(var(--amber-rgb,220,150,40),0.12)", border: "1px solid var(--amber,#dc9628)", borderRadius: 6 }}>
                                <span style={{ fontSize: 14, flexShrink: 0 }}>📅</span>
                                <span style={{ fontSize: 12, color: "var(--amber,#dc9628)", fontWeight: 500, lineHeight: 1.4 }}>{file.aiDateWarning}</span>
                              </div>
                            )}
                            {file.aiContributorComments && (
                              <div className="ai-feedback-body">{file.aiContributorComments}</div>
                            )}
                            {file.aiGaps && (() => {
                              try {
                                const gaps = Array.isArray(file.aiGaps) ? file.aiGaps : JSON.parse(file.aiGaps);
                                return gaps.length > 0 ? (
                                  <div className="ai-feedback-gaps">
                                    <div className="ai-feedback-gaps-header">
                                      <span className="ai-feedback-gaps-icon">⚠️</span>
                                      <span>Gaps Identified</span>
                                    </div>
                                    <ul className="ai-feedback-gaps-list">
                                      {gaps.map((gap, gi) => (
                                        <li key={gi}>{gap}</li>
                                      ))}
                                    </ul>
                                  </div>
                                ) : null;
                              } catch { return null; }
                            })()}
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              )}

              {isVerified !== false && (
                <>
                  <div className="link-row">
                    <div className="link-input-wrap">
                      <span className="link-input-icon">
                        <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                          <path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"></path>
                          <path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"></path>
                        </svg>
                      </span>
                      <input
                        className="link-input"
                        type="text"
                        placeholder="Paste link (SharePoint, Google Drive, Confluence, Jira...)"
                        value={response.link || ""}
                        onChange={(e) => onSetResponse("link", e.target.value)}
                      />
                    </div>
                    <button className="btn btn-ghost" style={{ height: 38 }} onClick={async () => {
                      const link = response.link?.trim();
                      if (!link) return;
                      if (!/^https?:\/\/.+\..+/.test(link)) {
                        alert("Please enter a valid URL starting with http:// or https://");
                        return;
                      }
                      try {
                        const created = await apiFetch("/api/evidence", { token, method: "POST", body: JSON.stringify({ month, moduleId: question.moduleId, questId: question.questId, evidenceLink: link, evidenceName: `Link: ${link.substring(0, 50)}` }) });
                        const files = [...(response.files || []), { id: created.id, name: created.evidenceName || created.evidence_name, link: created.evidenceLink || created.evidence_link }];
                        onSetResponse("files", files);
                        onSetResponse("link", "");
                        if (onEvidenceChange) await onEvidenceChange();
                      } catch (err) {
                        console.error("Add link failed", err);
                        alert(`Failed to add link: ${err.message || "Please try again"}`);
                      }
                    }}>
                      <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                        <line x1="12" y1="5" x2="12" y2="19"></line>
                        <line x1="5" y1="12" x2="19" y2="12"></line>
                      </svg>
                      <span>Add link</span>
                    </button>
                  </div>

                  {/* ── Link from Vault & Request Evidence actions ── */}
                  <div style={{ marginBottom: 18, display: "flex", gap: 10, flexWrap: "wrap", alignItems: "center" }}>
                    <button
                      className="btn btn-ghost"
                      onClick={() => { setShowVaultPicker(true); loadPicker(pickerSearch); }}
                    >
                      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                        <path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"></path>
                      </svg>
                      <span>Link from Vault</span>
                    </button>
                    {!showReqEvidence && (
                      <button
                        className="btn btn-ghost"
                        onClick={() => { setShowReqEvidence(true); setReqError(""); }}
                      >
                        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                          <path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"></path>
                          <circle cx="9" cy="7" r="4"></circle>
                          <line x1="19" y1="8" x2="19" y2="14"></line>
                          <line x1="22" y1="11" x2="16" y2="11"></line>
                        </svg>
                        <span>Request Evidence from Someone</span>
                      </button>
                    )}
                  </div>
                </>
              )}

              {/* Linked vault items */}
              {vaultItems.length > 0 && (
                <div style={{ marginBottom: 16, display: "flex", flexDirection: "column", gap: 6 }}>
                  {vaultItems.map(item => {
                    const due = item.uploadedAt ? addIntervalQC(item.uploadedAt, question.recurrenceInterval) : null;
                    const daysLeft = due ? Math.round((due - new Date()) / 86400000) : null;
                    const overdue = daysLeft !== null && daysLeft < 0;
                    const soon = daysLeft !== null && !overdue && daysLeft <= 14;
                    const validColor = overdue ? "var(--red)" : soon ? "var(--amber)" : "var(--green)";
                    return (
                      <div key={item.id} className="file-item" style={{ display: "flex", alignItems: "center", gap: 10, padding: "10px 14px" }}>
                        <span style={{ fontSize: 16, flexShrink: 0 }}>
                          {item.fileType?.includes("pdf") ? "📋" : item.fileType?.startsWith("image/") ? "🖼" : "📄"}
                        </span>
                        <div style={{ flex: 1, minWidth: 0 }}>
                          <div style={{ fontWeight: 600, fontSize: 13.5, color: "var(--dp-ink)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{item.title}</div>
                          {due && (
                            <div style={{ fontSize: 11, color: validColor, marginTop: 2, fontFamily: "var(--dp-font-mono)" }}>
                              {overdue
                                ? `⚠ Review overdue — ${due.toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" })}`
                                : soon
                                  ? `⏳ Due in ${daysLeft}d — ${due.toLocaleDateString("en-GB", { day: "numeric", month: "short" })}`
                                  : `✓ Valid until ${due.toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" })}`}
                            </div>
                          )}
                        </div>
                        <span style={{ fontSize: 11, fontFamily: "var(--dp-font-mono)", fontWeight: 700, color: "var(--dp-accent)", background: "var(--dp-accent-light)", padding: "3px 8px", borderRadius: 6, flexShrink: 0 }}>Vault</span>
                        {isVerified !== false && !reviewerPassed && (
                          <button
                            title="Detach from this question"
                            onClick={() => handleVaultDetach(item.id)}
                            style={{ background: "none", border: "none", color: "var(--dp-quiet)", cursor: "pointer", fontSize: 16, lineHeight: 1, padding: "0 4px", flexShrink: 0 }}
                          >×</button>
                        )}
                      </div>
                    );
                  })}
                </div>
              )}

              {/* Suggested Evidence */}
              {isVerified !== false && (suggestionsLoading || (suggestions !== null && suggestions.filter(s => !ignoredSuggestions.has(s.id) && !vaultItems.some(v => v.id === s.id)).length > 0)) && (
                <div style={{ marginBottom: 16, padding: "12px 16px", background: "var(--dp-surface-2)", borderRadius: 12, border: "1px solid var(--dp-line)" }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 10 }}>
                    <span style={{ fontSize: 13, fontWeight: 700, color: "var(--dp-ink)" }}>Suggested Evidence</span>
                    <span style={{ fontSize: 10, fontWeight: 700, color: "var(--dp-accent)", background: "var(--dp-accent-light)", border: "1px solid rgba(99,102,241,0.3)", borderRadius: 6, padding: "1px 6px", fontFamily: "var(--dp-font-mono)" }}>AI</span>
                  </div>
                  {suggestionsLoading ? (
                    <div style={{ fontSize: 12, color: "var(--dp-quiet)" }}>Scanning vault…</div>
                  ) : (
                    suggestions
                      .filter(s => !ignoredSuggestions.has(s.id) && !vaultItems.some(v => v.id === s.id))
                      .map(s => {
                        const scoreColor = s.relevanceScore >= 70 ? "var(--green)" : s.relevanceScore >= 50 ? "var(--amber)" : "var(--dp-quiet)";
                        return (
                          <div key={s.id} style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 8, fontSize: 12.5 }}>
                            <div style={{ flexShrink: 0, width: 32, height: 32, borderRadius: "50%", border: `2px solid ${scoreColor}`, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 10, fontWeight: 700, color: scoreColor, fontFamily: "var(--dp-font-mono)" }}>
                              {s.relevanceScore}%
                            </div>
                            <div style={{ flex: 1, minWidth: 0 }}>
                              <div style={{ fontWeight: 600, color: "var(--dp-ink)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{s.title}</div>
                              {s.reason && <div style={{ fontSize: 11, color: "var(--dp-quiet)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", fontStyle: "italic" }}>{s.reason}</div>}
                            </div>
                            <button className="btn btn-primary" style={{ fontSize: 11, padding: "4px 12px", height: 28, flexShrink: 0 }} disabled={attachingSuggestion === s.id} onClick={() => handleSuggestionAttach(s.id)}>
                              {attachingSuggestion === s.id ? "…" : "Attach"}
                            </button>
                            <button style={{ background: "none", border: "none", color: "var(--dp-quiet)", cursor: "pointer", fontSize: 16, flexShrink: 0 }} onClick={() => setIgnoredSuggestions(prev => new Set([...prev, s.id]))}>×</button>
                          </div>
                        );
                      })
                  )}
                </div>
              )}

              {/* ── Request Evidence form panel ── */}
              {showReqEvidence && (
                <div style={{ marginBottom: 18, padding: 18, background: "var(--dp-surface-2)", borderRadius: 14, border: "1px solid var(--dp-line)", boxShadow: "var(--neu-raised-sm)" }}>
                  <div style={{ fontSize: 14, fontWeight: 700, color: "var(--dp-ink)", marginBottom: 4 }}>Request Evidence from Someone</div>
                  <div style={{ fontSize: 12.5, color: "var(--dp-quiet)", marginBottom: 12 }}>
                    Enter the email of a person in your organisation who can provide this evidence.
                  </div>
                  <input
                    type="email"
                    value={reqEmail}
                    onChange={e => { setReqEmail(e.target.value); setReqError(""); }}
                    placeholder={orgDomain ? `name@${orgDomain}` : "email@company.com"}
                    style={{ width: "100%", padding: "10px 14px", borderRadius: 10, border: `1px solid ${reqError ? "var(--red)" : "var(--dp-line)"}`, background: "var(--dp-bg)", color: "var(--dp-ink)", fontSize: 13.5, boxSizing: "border-box", marginBottom: 8, outline: "none" }}
                  />
                  {reqError && <div style={{ fontSize: 12, color: "var(--red)", marginBottom: 8, fontWeight: 600 }}>✗ {reqError}</div>}
                  <div style={{ display: "flex", gap: 10 }}>
                    <button
                      className="btn btn-primary"
                      onClick={handleRequestEvidence}
                      disabled={reqLoading || !reqEmail.trim()}
                    >
                      {reqLoading ? "Sending…" : "Send Request"}
                    </button>
                    <button
                      className="btn btn-ghost"
                      onClick={() => { setShowReqEvidence(false); setReqEmail(""); setReqError(""); }}
                    >
                      Cancel
                    </button>
                  </div>
                </div>
              )}
              {reqSuccess && (
                <div style={{ fontSize: 13.5, color: "var(--green)", padding: "10px 16px", background: "rgba(16,185,129,0.1)", border: "1px solid rgba(16,185,129,0.3)", borderRadius: 10, display: "flex", alignItems: "center", gap: 10, marginBottom: 16 }}>
                  ✓ Evidence request sent successfully.
                  <button onClick={() => setReqSuccess(false)} style={{ background: "none", border: "none", color: "var(--green)", cursor: "pointer", fontSize: 13, marginLeft: "auto", fontWeight: 700 }}>Dismiss</button>
                </div>
              )}
            </>
          )}

          <div className="section-label">Internal Notes</div>
          <textarea
            className="comments-textarea"
            placeholder="Optional notes for the reviewer - context, exceptions, or remediation plan..."
            value={response.comment || ""}
            onChange={(e) => onSetResponse("comment", e.target.value)}
          ></textarea>

          {(assessment?.reviewerNotes || assessment?.reviewer_notes) && (
            <>
              <div className="section-label" style={{ marginTop: 12 }}>Reviewer Notes</div>
              <div style={{ padding: "10px 14px", background: "var(--bg3)", border: "1px solid var(--border2)", borderRadius: 8, fontSize: 13, color: "var(--amber)", fontStyle: "italic", whiteSpace: "pre-wrap" }}>
                {assessment.reviewerNotes || assessment.reviewer_notes}
              </div>
            </>
          )}

          <div className="scoring-gates">
            <div className="section-label">Scoring gates</div>
            <div className="gates-row">
              {gates.map((gate, i) => (
                <span key={i} className={`gate-pill ${gate.pass ? "gate-pass" : "gate-fail"}`}>
                  <span className="gate-x">{gate.pass ? "OK" : "Missing"}</span> {gate.label}
                </span>
              ))}
            </div>
          </div>
        </>
      )}

      {/* Vault picker modal */}
      {showVaultPicker && (
        <div
          style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.4)", zIndex: 9000, display: "flex", alignItems: "center", justifyContent: "center" }}
          onClick={() => setShowVaultPicker(false)}
        >
          <div
            style={{ background: "var(--bg2)", borderRadius: 12, padding: 20, width: 480, maxWidth: "90vw", maxHeight: "70vh", display: "flex", flexDirection: "column", boxShadow: "0 20px 60px rgba(0,0,0,0.3)" }}
            onClick={e => e.stopPropagation()}
          >
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 14 }}>
              <div style={{ fontWeight: 700, fontSize: 15 }}>Link Evidence from Vault</div>
              <button onClick={() => setShowVaultPicker(false)} style={{ background: "none", border: "none", color: "var(--text3)", cursor: "pointer", fontSize: 20 }}>×</button>
            </div>
            <input
              type="text"
              placeholder="Search vault…"
              value={pickerSearch}
              onChange={e => { setPickerSearch(e.target.value); loadPicker(e.target.value); }}
              style={{ padding: "8px 12px", borderRadius: 6, border: "1px solid var(--border2)", background: "var(--bg3)", color: "var(--text)", fontSize: 13, marginBottom: 12, boxSizing: "border-box", width: "100%" }}
            />
            <div style={{ overflowY: "auto", flex: 1 }}>
              {pickerLoading ? (
                <div style={{ textAlign: "center", padding: 20, color: "var(--text3)", fontSize: 13 }}>Loading…</div>
              ) : pickerItems.length === 0 ? (
                <div style={{ textAlign: "center", padding: 20, color: "var(--text3)", fontSize: 13 }}>No vault items found.</div>
              ) : pickerItems.map(item => {
                const alreadyLinked = vaultItems.some(v => v.id === item.id);
                return (
                  <div key={item.id} style={{ display: "flex", alignItems: "center", gap: 10, padding: "10px 12px", background: "var(--bg3)", borderRadius: 8, marginBottom: 6 }}>
                    <span style={{ fontSize: 18, flexShrink: 0 }}>
                      {item.fileType?.includes("pdf") ? "📋" : item.fileType?.startsWith("image/") ? "🖼" : "📄"}
                    </span>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ fontSize: 13, fontWeight: 600, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{item.title}</div>
                      {item.description && <div style={{ fontSize: 11, color: "var(--text3)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{item.description}</div>}
                    </div>
                    {alreadyLinked ? (
                      <span style={{ fontSize: 11, color: "var(--text3)", flexShrink: 0 }}>Linked</span>
                    ) : (
                      <button
                        className="btn btn-primary"
                        style={{ fontSize: 11, padding: "5px 14px", flexShrink: 0 }}
                        disabled={linkingVaultId === item.id}
                        onClick={() => handleVaultLink(item.id)}
                      >
                        {linkingVaultId === item.id ? "…" : "Attach"}
                      </button>
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
