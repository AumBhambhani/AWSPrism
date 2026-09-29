import { useState, useEffect, useCallback, useRef } from "react";
import { useSearchParams, useNavigate, useLocation } from "react-router-dom";
import Logo from "../components/Logo";
import { apiFetch } from "../api/client.js";
import { DEPT_META, DEPT_QUESTIONS, ANSWER_OPTIONS, DEFAULT_DEPTS, REQUIRED_DEPTS, expandQuestions } from "../utils/deptSelfAssessQuestions.js";
import { ITEnvironmentAndCapabilities, ITCapabilityReview } from "../components/CapabilitySteps.jsx";

// IT and HR are always assessed, and IT always comes first (its section holds the environment
// questions and capability cards), then HR, then the other departments in the order chosen.
const orderDepts = (depts) => {
  const all = [...REQUIRED_DEPTS.filter(d => !depts.includes(d)), ...depts];
  return [...REQUIRED_DEPTS, ...all.filter(d => !REQUIRED_DEPTS.includes(d))];
};

// Phone layout. The page is styled inline for desktop; these rules (scoped to .sa-root and only
// under 640px) reflow the shell and enlarge touch targets. Inputs are 16px so iOS Safari does
// not zoom the page on focus.
const SA_CSS = `
@media (max-width: 640px) {
  .sa-root .sa-banner { position: static !important; padding: 8px 14px !important; font-size: 12px !important; gap: 8px !important; text-align: left; justify-content: flex-start !important; line-height: 1.4; }
  .sa-root .sa-header { margin-top: 0 !important; padding: 10px 14px !important; flex-wrap: wrap; gap: 8px; }
  .sa-root .sa-brand { gap: 10px !important; min-width: 0; }
  .sa-root .sa-brand-sub { display: none !important; }
  .sa-root .sa-email { display: none !important; }
  .sa-root .sa-actions { margin-left: auto; gap: 8px !important; }
  .sa-root .sa-actions .btn { min-height: 36px; padding: 6px 12px !important; }
  .sa-root .sa-progress { padding: 0 16px !important; }
  .sa-root .sa-wrap { padding: 20px 16px !important; }
  .sa-root .sa-wrap-x { padding-left: 16px !important; padding-right: 16px !important; }
  .sa-root h1 { font-size: 22px !important; }
  .sa-root .btn { min-height: 44px; }
  .sa-root .sa-pill { min-height: 40px; padding: 8px 16px !important; font-size: 13px !important; }
  .sa-root input, .sa-root textarea { font-size: 16px !important; }
  .sa-root .sa-btnrow { flex-wrap: wrap; }
  .sa-root .sa-btnrow > .btn { flex: 1 1 140px; }
  .sa-root .sa-stack { flex-direction: column !important; align-items: stretch !important; }
}
`;

const STORAGE_KEY = (userId) => `prism_selfassess_${userId || "guest"}`;

function loadSaved(userId) {
  try {
    const raw = localStorage.getItem(STORAGE_KEY(userId));
    return raw ? JSON.parse(raw) : null;
  } catch { return null; }
}

function saveToDisk(userId, data) {
  try { localStorage.setItem(STORAGE_KEY(userId), JSON.stringify(data)); } catch {}
}

// Custom (non-default) departments have no entry in DEPT_QUESTIONS, so both
// the question screen and answer-scoping below fall back to this same
// generic 6-question set — kept in one place so their ids never drift apart.
function fallbackDeptQuestions(dept) {
  return [
    { id: `${dept}-1`, text: `Do you share data / tasks with other departments??` },
    { id: `${dept}-2`, text: `Does your department directly contact clients / vendors?` },
    { id: `${dept}-3`, text: `Does ${dept} department enforce Role Based Access Control?` },
    { id: `${dept}-4`, text: `Does ${dept} process personal data (name, phone number, card details)?` },
    { id: `${dept}-5`, text: `Does ${dept} use third party software (ERP, SaaS, CRM) ?` },
    { id: `${dept}-6`, text: `Does ${dept} handle employee / client / vendor data?` },
  ];
}

function deptQuestionBase(dept) {
  return DEPT_QUESTIONS[dept] || fallbackDeptQuestions(dept);
}

// The session keeps one flat `answers` map across every department the user
// has touched. Before submitting one department's answers to the backend,
// scope it down to just that department's own question ids (base + any
// triggered follow-ups) — otherwise every department's stored submission
// ends up containing every other department's answers too, which corrupts
// per-department gap/score counts.
function getDeptAnswers(dept, answers) {
  const ids = new Set(expandQuestions(deptQuestionBase(dept), answers).map(q => q.id));
  const scoped = {};
  for (const id of ids) {
    if (answers[id] !== undefined) scoped[id] = answers[id];
  }
  return scoped;
}

// ── Step components ────────────────────────────────────────────────────────────

function WelcomeStep({ onStart }) {
  return (
    <div className="sa-wrap" style={{ textAlign: "center", maxWidth: 560, margin: "0 auto", padding: "48px 24px" }}>
      <div style={{ fontSize: 56, marginBottom: 20 }}>🛡️</div>
      <h1 style={{ fontSize: 26, fontWeight: 700, marginBottom: 12, color: "var(--text)" }}>Compliance Self-Assessment</h1>
      <p style={{ fontSize: 15, color: "var(--text2)", lineHeight: 1.7, marginBottom: 12 }}>
        This tool helps you understand your organisation's current data protection posture across key departments.
      </p>
      <p style={{ fontSize: 14, color: "var(--text2)", lineHeight: 1.7, marginBottom: 32 }}>
        Select the departments you want to assess and answer a short set of questions. Once you're done, our team reviews your responses and prepares your gap-analysis report.
      </p>
      <div style={{ background: "rgba(245,158,11,0.1)", border: "1px solid rgba(245,158,11,0.3)", borderRadius: 10, padding: "14px 20px", marginBottom: 32, textAlign: "left" }}>
        <div style={{ fontSize: 13, fontWeight: 600, color: "#f59e0b", marginBottom: 4 }}>⏳ Pending Verification</div>
        <div style={{ fontSize: 13, color: "var(--text2)", lineHeight: 1.5 }}>
          Your account is awaiting approval. This self-assessment gives you a head start on understanding your compliance posture. Once verified, you'll get access to the full PRISM platform with detailed assessments and remediation workflows.
        </div>
      </div>
      <button
        className="btn btn-primary"
        style={{ padding: "12px 36px", fontSize: 15, borderRadius: 10 }}
        onClick={onStart}
      >
        Start Assessment →
      </button>
    </div>
  );
}

function DeptSelectStep({ selected, onToggle, onCustomAdd, customDept, setCustomDept, onNext, onBack }) {
  return (
    <div className="sa-wrap" style={{ maxWidth: 680, margin: "0 auto", padding: "32px 24px" }}>
      <div style={{ marginBottom: 24 }}>
        <h2 style={{ fontSize: 20, fontWeight: 700, color: "var(--text)", marginBottom: 6 }}>Select Departments</h2>
        <p style={{ fontSize: 14, color: "var(--text2)" }}>IT and HR are required for every assessment. Choose any other departments you want to include.</p>
      </div>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(200px, 1fr))", gap: 12, marginBottom: 24 }}>
        {DEFAULT_DEPTS.map(dept => {
          const meta = DEPT_META[dept];
          const active = selected.includes(dept);
          const required = REQUIRED_DEPTS.includes(dept);
          return (
            <button
              key={dept}
              onClick={() => { if (!required) onToggle(dept); }}
              aria-disabled={required}
              title={required ? "Required — every assessment covers this department" : undefined}
              style={{
                padding: "16px 14px", borderRadius: 10, border: `2px solid ${active ? "var(--accent)" : "var(--border2)"}`,
                background: active ? "rgba(99,102,241,0.08)" : "var(--bg2)",
                textAlign: "left", cursor: required ? "default" : "pointer", transition: "all 0.15s", position: "relative",
              }}
            >
              {required && (
                <span style={{ position: "absolute", top: 8, right: 10, fontSize: 10, fontWeight: 700, letterSpacing: "0.05em", textTransform: "uppercase", color: "var(--accent)" }}>
                  Required
                </span>
              )}
              <div style={{ fontSize: 24, marginBottom: 6 }}>{meta.icon}</div>
              <div style={{ fontSize: 13, fontWeight: 600, color: active ? "var(--accent)" : "var(--text)", marginBottom: 4 }}>{meta.label}</div>
              <div style={{ fontSize: 11, color: "var(--text3)", lineHeight: 1.4 }}>{meta.description}</div>
            </button>
          );
        })}
      </div>
      <div style={{ display: "flex", gap: 8, marginBottom: 28 }}>
        <input
          type="text"
          value={customDept}
          onChange={e => setCustomDept(e.target.value)}
          onKeyDown={e => { if (e.key === "Enter" && customDept.trim()) { onCustomAdd(); } }}
          placeholder="Add custom department…"
          style={{ flex: 1, padding: "9px 12px", borderRadius: 8, border: "1px solid var(--border2)", background: "var(--bg3)", color: "var(--text)", fontSize: 13 }}
        />
        <button
          className="btn btn-ghost"
          disabled={!customDept.trim()}
          onClick={onCustomAdd}
        >
          Add
        </button>
      </div>
      {selected.length > 0 && (
        <div style={{ display: "flex", flexWrap: "wrap", gap: 8, marginBottom: 20 }}>
          {selected.map(dept => {
            const isCustom = !DEFAULT_DEPTS.includes(dept);
            const meta = DEPT_META[dept];
            return (
              <div
                key={dept}
                style={{
                  display: "flex", alignItems: "center", gap: 6,
                  background: "var(--bg3)", border: "1px solid var(--border2)",
                  borderRadius: 20, padding: "5px 10px 5px 12px", fontSize: 12, color: "var(--text)",
                }}
              >
                <span>{meta ? `${meta.icon} ${meta.label}` : dept}</span>
                {isCustom && (
                  <button
                    onClick={() => onToggle(dept)}
                    aria-label={`Remove ${dept}`}
                    style={{ background: "none", border: "none", color: "var(--text3)", cursor: "pointer", fontSize: 15, lineHeight: 1, padding: 0 }}
                  >×</button>
                )}
              </div>
            );
          })}
        </div>
      )}
      <div style={{ display: "flex", gap: 12 }}>
        <button className="btn btn-ghost" onClick={onBack}>← Back</button>
        <button className="btn btn-primary" disabled={selected.length === 0} onClick={onNext}>
          Continue →
        </button>
      </div>
    </div>
  );
}

function CollaboratorInput({ dept, collaborators, onChange, orgDomain, token, userRole }) {
  const current = collaborators[dept] || [];
  const [input, setInput] = useState("");
  const [error, setError] = useState("");
  const [sending, setSending] = useState(false);
  const [copied, setCopied] = useState(null);
  const canInvite = userRole === "ADMIN" || userRole === "LEAD";

  const sendInvite = async () => {
    const email = input.trim().toLowerCase();
    if (!email) return;
    if (orgDomain && !email.endsWith("@" + orgDomain)) {
      setError(`Must be a @${orgDomain} address`);
      return;
    }
    if (current.some(c => c.email === email)) { setError("Already invited"); return; }
    setSending(true);
    setError("");
    try {
      const data = await apiFetch("/api/users/invite", { token, method: "POST", body: JSON.stringify({ email, role: "CONTRIBUTOR", department: dept }) });
      onChange(dept, [...current, { email, inviteLink: data.inviteLink || null }]);
      setInput("");
    } catch (e) {
      setError(e.message || "Failed to send invite");
    } finally {
      setSending(false);
    }
  };

  const copyLink = (email, link) => {
    navigator.clipboard.writeText(link).then(() => {
      setCopied(email);
      setTimeout(() => setCopied(null), 2000);
    });
  };

  const remove = (email) => onChange(dept, current.filter(c => c.email !== email));

  return (
    <div style={{ marginTop: 20, padding: "14px 16px", background: "var(--bg2)", borderRadius: 10, border: "1px solid var(--border2)" }}>
      <div style={{ fontSize: 12, fontWeight: 700, color: "var(--text2)", marginBottom: 10, textTransform: "uppercase", letterSpacing: "0.06em" }}>
        Collaborators
      </div>
      {current.map(c => (
        <div key={c.email} style={{ marginBottom: 8 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 8, background: "var(--bg3)", borderRadius: 6, padding: "6px 10px" }}>
            <span style={{ fontSize: 13, flex: 1, color: "var(--text)" }}>{c.email}</span>
            <span style={{ fontSize: 11, color: "var(--green, #22c55e)" }}>✓ Invite sent</span>
            <button
              onClick={() => remove(c.email)}
              style={{ background: "none", border: "none", color: "var(--text3)", cursor: "pointer", fontSize: 16, lineHeight: 1 }}
            >×</button>
          </div>
          {c.inviteLink && (
            <div style={{ marginTop: 4, display: "flex", gap: 6, alignItems: "center" }}>
              <input
                readOnly
                value={c.inviteLink}
                style={{
                  flex: 1, padding: "5px 8px", borderRadius: 5, fontSize: 11,
                  border: "1px solid var(--border2)", background: "var(--bg)", color: "var(--text3)",
                  fontFamily: "monospace",
                }}
                onFocus={e => e.target.select()}
              />
              <button
                className="btn btn-ghost"
                style={{ fontSize: 11, padding: "4px 10px", whiteSpace: "nowrap" }}
                onClick={() => copyLink(c.email, c.inviteLink)}
              >
                {copied === c.email ? "Copied!" : "Copy link"}
              </button>
            </div>
          )}
        </div>
      ))}
      {canInvite && (
        <div style={{ display: "flex", gap: 8, marginTop: 6 }}>
          <input
            type="email"
            value={input}
            onChange={e => { setInput(e.target.value); setError(""); }}
            onKeyDown={e => e.key === "Enter" && sendInvite()}
            placeholder={orgDomain ? `name@${orgDomain}` : "colleague@company.com"}
            style={{
              flex: 1, padding: "7px 10px", borderRadius: 6,
              border: `1px solid ${error ? "var(--red, #ef4444)" : "var(--border2)"}`,
              background: "var(--bg)", color: "var(--text)", fontSize: 12,
            }}
          />
          <button className="btn btn-ghost" style={{ fontSize: 12, padding: "6px 12px" }} onClick={sendInvite} disabled={!input.trim() || sending}>
            {sending ? "Sending…" : "Invite"}
          </button>
        </div>
      )}
      {error && <div style={{ fontSize: 11, color: "var(--red, #ef4444)", marginTop: 4 }}>✗ {error}</div>}
      {current.length > 0 && (
        <div style={{ fontSize: 11, color: "var(--text3)", marginTop: 8, fontStyle: "italic" }}>
          Invited colleagues will receive a link to join the workspace and access this self-assessment.
        </div>
      )}
    </div>
  );
}

function CollabsStep({ depts, collaborators, onChange, orgDomain, token, userRole, onNext, onBack }) {
  return (
    <div className="sa-wrap" style={{ maxWidth: 680, margin: "0 auto", padding: "32px 24px" }}>
      <div style={{ marginBottom: 24 }}>
        <h2 style={{ fontSize: 20, fontWeight: 700, color: "var(--text)", marginBottom: 6 }}>Add Collaborators</h2>
        <p style={{ fontSize: 14, color: "var(--text2)" }}>
          Optionally invite colleagues to help answer questions for each department before you begin. You can skip this and continue on your own.
        </p>
      </div>
      <div style={{ display: "flex", flexDirection: "column", gap: 16, marginBottom: 28 }}>
        {depts.map(dept => {
          const meta = DEPT_META[dept] || { label: dept, icon: "🏢" };
          return (
            <div key={dept}>
              <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 4 }}>
                <span style={{ fontSize: 18 }}>{meta.icon}</span>
                <span style={{ fontSize: 14, fontWeight: 600, color: "var(--text)" }}>{meta.label}</span>
              </div>
              <CollaboratorInput
                dept={dept}
                collaborators={collaborators}
                onChange={onChange}
                orgDomain={orgDomain}
                token={token}
                userRole={userRole}
              />
            </div>
          );
        })}
      </div>
      <div style={{ display: "flex", gap: 12 }}>
        <button className="btn btn-ghost" onClick={onBack}>← Back</button>
        <button className="btn btn-primary" onClick={onNext}>
          Continue →
        </button>
      </div>
    </div>
  );
}

function QuestionStep({ dept, questions, answers, onAnswer, onNext, onBack, deptIndex, totalDepts, collaborators, token }) {
  const meta = DEPT_META[dept] || { label: dept, icon: "🏢" };
  const answered = questions.filter(q => answers[q.id]).length;
  const progress = Math.round((answered / questions.length) * 100);
  const delegatedTo = collaborators?.[dept] || [];
  const [answerMyself, setAnswerMyself] = useState(false);
  const isDelegated = delegatedTo.length > 0 && !answerMyself;

  return (
    <div className="sa-wrap" style={{ maxWidth: 680, margin: "0 auto", padding: "32px 24px" }}>
      <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 6 }}>
        <span style={{ fontSize: 28 }}>{meta.icon}</span>
        <div>
          <div style={{ fontSize: 12, color: "var(--text3)", marginBottom: 2 }}>
            Department {deptIndex + 1} of {totalDepts}
          </div>
          <h2 style={{ fontSize: 18, fontWeight: 700, color: "var(--text)" }}>{meta.label}</h2>
        </div>
      </div>

      {isDelegated ? (
        <div style={{ background: "var(--bg2)", border: "1px solid var(--border2)", borderRadius: 12, padding: "20px 24px", marginBottom: 28 }}>
          <div style={{ fontSize: 28, marginBottom: 10 }}>🔗</div>
          <div style={{ fontSize: 15, fontWeight: 700, color: "var(--text)", marginBottom: 6 }}>Delegated to the department head</div>
          <p style={{ fontSize: 13, color: "var(--text2)", lineHeight: 1.6, marginBottom: 16 }}>
            Copy the link below and send it to the department head. Once they fill it in, results will appear here automatically — you don't need to answer these questions yourself.
          </p>
          <div style={{ display: "flex", flexDirection: "column", gap: 8, marginBottom: 16 }}>
            {delegatedTo.map(c => (
              <div key={c.email}>
                <div style={{ fontSize: 12, color: "var(--text3)", marginBottom: 4 }}>{c.email}</div>
                {c.inviteLink && (
                  <div style={{ display: "flex", gap: 6 }}>
                    <input
                      readOnly
                      value={c.inviteLink}
                      style={{ flex: 1, padding: "7px 10px", borderRadius: 6, fontSize: 12, border: "1px solid var(--border2)", background: "var(--bg)", color: "var(--text2)", fontFamily: "monospace" }}
                      onFocus={e => e.target.select()}
                    />
                    <button
                      className="btn btn-ghost"
                      style={{ fontSize: 12, padding: "6px 12px", whiteSpace: "nowrap" }}
                      onClick={() => navigator.clipboard.writeText(c.inviteLink)}
                    >
                      Copy link
                    </button>
                  </div>
                )}
              </div>
            ))}
          </div>
          <button className="btn btn-ghost" style={{ fontSize: 12 }} onClick={() => setAnswerMyself(true)}>
            Answer it myself instead
          </button>
        </div>
      ) : (
        <>
          {delegatedTo.length > 0 && (
            <div style={{ fontSize: 12, color: "var(--text3)", marginBottom: 16, display: "flex", alignItems: "center", gap: 8 }}>
              <span>Answering on behalf of this department (also delegated to {delegatedTo.map(c => c.email).join(", ")})</span>
              <button className="btn btn-ghost" style={{ fontSize: 11, padding: "3px 8px" }} onClick={() => setAnswerMyself(false)}>
                Undo
              </button>
            </div>
          )}
          <div style={{ height: 4, background: "var(--bg4)", borderRadius: 2, marginBottom: 24 }}>
            <div style={{ height: "100%", width: `${progress}%`, background: "var(--accent)", borderRadius: 2, transition: "width 0.3s" }} />
          </div>

          {dept === "IT" && <ITEnvironmentAndCapabilities token={token} />}
          {dept === "IT" && (
            <div style={{ ...{ fontSize: 11, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.08em", color: "var(--accent)", padding: "4px 0 6px", borderBottom: "1px solid var(--border2)", marginBottom: 12 } }}>
              IT questions
            </div>
          )}
          <div style={{ display: "flex", flexDirection: "column", gap: 10, marginBottom: 28 }}>
        {(() => {
          let mainCount = 0;
          return questions.map((q, i) => {
            const selected = answers[q.id];
            const isFollowUp = !!q.parentId;
            if (!isFollowUp) mainCount++;
            const showSection = !isFollowUp && q.section && (i === 0 || questions[i - 1]?.section !== q.section);
            return (
              <div key={q.id} style={isFollowUp ? { marginLeft: 20, borderLeft: "2px solid var(--border2)", paddingLeft: 12 } : undefined}>
                {showSection && (
                  <div style={{
                    fontSize: 11, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.08em",
                    color: "var(--accent)", padding: "16px 0 6px", borderBottom: "1px solid var(--border2)",
                    marginBottom: 8,
                  }}>
                    {q.section}
                  </div>
                )}
                <div style={{ background: "var(--bg2)", borderRadius: 10, padding: "14px 16px", border: "1px solid var(--border2)" }}>
                  <div style={{ fontSize: 13, fontWeight: 500, color: "var(--text)", marginBottom: 10, lineHeight: 1.5 }}>
                    {isFollowUp ? (
                      <span style={{ color: "var(--accent)", marginRight: 8, fontWeight: 700 }}>↳</span>
                    ) : (
                      <span style={{ color: "var(--text3)", marginRight: 8, fontWeight: 700 }}>{mainCount}.</span>
                    )}
                    {q.text}
                  </div>
                  <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                  {ANSWER_OPTIONS.map(opt => (
                    <button
                      key={opt.value}
                      className="sa-pill"
                      onClick={() => onAnswer(q.id, opt.value)}
                      style={{
                        padding: "5px 14px", borderRadius: 20, fontSize: 12, fontWeight: 600, cursor: "pointer",
                        border: `1px solid ${selected === opt.value ? opt.color : "var(--border2)"}`,
                        background: selected === opt.value ? opt.bg : "var(--bg3)",
                        color: selected === opt.value ? opt.color : "var(--text2)",
                        transition: "all 0.15s",
                      }}
                    >
                      {opt.label}
                    </button>
                  ))}
                </div>
              </div>
            </div>
          );
          });
        })()}
          </div>
        </>
      )}

      <div style={{ display: "flex", gap: 12, marginTop: 24 }}>
        {onBack && <button className="btn btn-ghost" onClick={onBack}>← Back</button>}
        <button className="btn btn-primary" onClick={onNext}>
          {deptIndex < totalDepts - 1 ? "Next Department →" : "Review answers →"}
        </button>
      </div>
    </div>
  );
}

const ANSWER_STYLE = (value) => {
  const opt = ANSWER_OPTIONS.find(o => o.value === value);
  if (opt) return { label: opt.label, color: opt.color, bg: opt.bg };
  return { label: "Not answered", color: "var(--text3)", bg: "var(--bg4)" };
};

// Read-only summary of everything the user answered, shown right before the
// assessment is finalised. They get exactly one trip back into the questions
// to change things (the "Edit my answers" button disappears once used).
function ReviewAnswersStep({ selectedDepts, answers, collaborators, editUsed, onEdit, onConfirm, submitting, error, token }) {
  const answeredDepts = selectedDepts.filter(
    d => Object.keys(getDeptAnswers(d, answers)).length > 0
  );
  const pendingDepts = selectedDepts.filter(
    d => Object.keys(getDeptAnswers(d, answers)).length === 0
  );

  return (
    <div className="sa-wrap" style={{ maxWidth: 720, margin: "0 auto", padding: "32px 24px" }}>
      <h2 style={{ fontSize: 22, fontWeight: 700, color: "var(--text)", marginBottom: 6 }}>Review your answers</h2>
      <p style={{ fontSize: 14, color: "var(--text2)", lineHeight: 1.6, marginBottom: 20 }}>
        Check your responses below. You can make changes{" "}
        <strong>once</strong> before submitting — after that, contact our team if anything needs updating.
      </p>

      {editUsed && (
        <div style={{ background: "rgba(245,158,11,0.1)", border: "1px solid rgba(245,158,11,0.3)", borderRadius: 8, padding: "10px 14px", fontSize: 12.5, color: "var(--text2)", marginBottom: 20 }}>
          You've used your one round of edits. Submit when you're ready.
        </div>
      )}

      {pendingDepts.length > 0 && (
        <div style={{ background: "rgba(99,102,241,0.08)", border: "1px solid rgba(99,102,241,0.25)", borderRadius: 8, padding: "12px 16px", marginBottom: 20 }}>
          <div style={{ fontSize: 12.5, fontWeight: 700, color: "var(--accent)", marginBottom: 6 }}>Awaiting other departments</div>
          <div style={{ fontSize: 12.5, color: "var(--text2)", lineHeight: 1.6 }}>
            These departments haven't responded yet. You can still submit your part now — your
            gap-analysis report will be prepared once every department is in.
          </div>
          <ul style={{ margin: "8px 0 0", paddingLeft: 18, fontSize: 12.5, color: "var(--text2)" }}>
            {pendingDepts.map(d => {
              const meta = DEPT_META[d] || { label: d, icon: "🏢" };
              const to = (collaborators?.[d] || []).map(c => c.email).filter(Boolean);
              return (
                <li key={d} style={{ marginBottom: 2 }}>
                  {meta.icon} {meta.label}
                  {to.length > 0 && <span style={{ color: "var(--text3)" }}> — assigned to {to.join(", ")}</span>}
                </li>
              );
            })}
          </ul>
        </div>
      )}

      {answeredDepts.map(dept => {
        const meta = DEPT_META[dept] || { label: dept, icon: "🏢" };
        const qs = expandQuestions(deptQuestionBase(dept), answers);
        return (
          <div key={dept} style={{ marginBottom: 24 }}>
            <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 10 }}>
              <span style={{ fontSize: 18 }}>{meta.icon}</span>
              <h3 style={{ fontSize: 15, fontWeight: 700, color: "var(--text)" }}>{meta.label}</h3>
            </div>
            <div style={{ border: "1px solid var(--border2)", borderRadius: 10, overflow: "hidden" }}>
              {dept === "IT" && <ITCapabilityReview token={token} />}
              {qs.map((q, i) => {
                const a = ANSWER_STYLE(answers[q.id]);
                return (
                  <div key={q.id} style={{
                    display: "flex", gap: 12, alignItems: "flex-start", justifyContent: "space-between",
                    padding: "10px 14px",
                    borderTop: i === 0 ? "none" : "1px solid var(--border2)",
                    background: q.parentId ? "var(--bg2)" : "transparent",
                  }}>
                    <span style={{ fontSize: 13, color: "var(--text2)", lineHeight: 1.5 }}>
                      {q.parentId && <span style={{ color: "var(--accent)", marginRight: 6, fontWeight: 700 }}>↳</span>}
                      {q.text}
                    </span>
                    <span style={{
                      flexShrink: 0, fontSize: 11, fontWeight: 700, padding: "3px 10px", borderRadius: 20,
                      color: a.color, background: a.bg, border: `1px solid ${a.color}`,
                    }}>
                      {a.label}
                    </span>
                  </div>
                );
              })}
            </div>
          </div>
        );
      })}

      {error && <p style={{ fontSize: 12, color: "var(--red, #ef4444)", marginBottom: 12 }}>{error}</p>}

      <div style={{ display: "flex", gap: 12, flexWrap: "wrap", marginTop: 8 }}>
        {!editUsed && (
          <button className="btn btn-ghost" onClick={onEdit} disabled={submitting}>✏️ Edit my answers</button>
        )}
        <button className="btn btn-primary" onClick={onConfirm} disabled={submitting}>
          {submitting ? "Submitting…" : "Confirm & submit →"}
        </button>
      </div>
    </div>
  );
}

// Terminal screen shown once the assessment has been submitted. The gap-analysis
// report is produced by the PRISM team out-of-band, so the user just gets an
// acknowledgement here — no score, no report.
function PendingReviewStep({ onLogout, error, pendingDepartments = [] }) {
  return (
    <div className="sa-wrap" style={{ maxWidth: 620, margin: "0 auto", padding: "48px 24px", textAlign: "center" }}>
      <div style={{ fontSize: 44, marginBottom: 16 }}>✅</div>
      <h2 style={{ fontSize: 22, fontWeight: 700, color: "var(--text)", marginBottom: 12 }}>
        Thanks — your responses are in
      </h2>
      <p style={{ fontSize: 15, color: "var(--text2)", lineHeight: 1.65, marginBottom: 8 }}>
        Our team is working on your gap-analysis report and will contact you soon with
        the results and next steps.
      </p>
      <p style={{ fontSize: 13, color: "var(--text3)", lineHeight: 1.6, marginBottom: 28 }}>
        We've also sent a confirmation to your email. You don't need to do anything else right now.
      </p>

      {pendingDepartments.length > 0 && (
        <div style={{ background: "rgba(99,102,241,0.08)", border: "1px solid rgba(99,102,241,0.25)", borderRadius: 8, padding: "12px 16px", marginBottom: 24, textAlign: "left" }}>
          <div style={{ fontSize: 12.5, color: "var(--text2)", lineHeight: 1.6 }}>
            We're still waiting on responses from:{" "}
            <strong>{pendingDepartments.map(d => (DEPT_META[d]?.label || d)).join(", ")}</strong>.
            Your report will be prepared once every department has completed the assessment.
          </div>
        </div>
      )}

      {error && (
        <p style={{ fontSize: 12, color: "var(--red, #ef4444)", marginBottom: 16 }}>{error}</p>
      )}

      <div style={{ display: "flex", gap: 10, flexWrap: "wrap", alignItems: "center", justifyContent: "center" }}>
        <button className="btn btn-ghost" onClick={onLogout}>Sign out</button>
      </div>
    </div>
  );
}

// ── Main component ─────────────────────────────────────────────────────────────

export default function SelfAssessment({ user, token, onLogout }) {
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const location = useLocation();
  const lockedDept = searchParams.get("dept") || null;

  const saved = lockedDept ? null : loadSaved(user?.id);

  const [step, setStep] = useState(() => {
    if (lockedDept) return "questions";
    // "results"/"report" are retired steps that may live in an old saved blob.
    if (saved?.step === "results" || saved?.step === "report") return "pending";
    // The environment questions and capability cards are part of the IT section now.
    if (saved?.step === "caps" || saved?.step === "env") return "questions";
    return saved?.step ?? "welcome";
  });
  const [editUsed, setEditUsed] = useState(saved?.editUsed ?? false);
  const [editing, setEditing] = useState(saved?.editing ?? false);
  const [selectedDepts, setSelectedDepts] = useState(() => {
    if (lockedDept) return [lockedDept];
    return orderDepts(saved?.selectedDepts ?? []);
  });
  const [customDept, setCustomDept] = useState("");
  const [deptIndex, setDeptIndex] = useState(saved?.deptIndex ?? 0);
  const [answers, setAnswers] = useState(saved?.answers ?? {});
  const [collaborators, setCollaborators] = useState(saved?.collaborators ?? {});
  const [savedFeedback, setSavedFeedback] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [completeError, setCompleteError] = useState("");

  // Persist every answered department. Delegated departments the user never
  // filled in are skipped so we don't clobber the department head's own row.
  const saveAllAnswers = async (depts, answers) => {
    if (!token) return;
    setSubmitting(true);
    setCompleteError("");
    try {
      await Promise.all(
        depts.map(dept => {
          const scoped = getDeptAnswers(dept, answers);
          if (Object.keys(scoped).length === 0) return Promise.resolve();
          return apiFetch("/api/self-assessment", {
            token,
            method: "POST",
            body: JSON.stringify({ department: dept, answers: scoped }),
          }).catch(() => {});
        })
      );
    } finally {
      setSubmitting(false);
    }
  };

  // Final "Confirm & submit" — records the expected department set and fires the
  // thank-you + internal team notification. Only the main (non-delegated) run
  // does this; a delegated collaborator just saves their one department above.
  const finalizeAssessment = async (depts) => {
    if (lockedDept || !token) return;
    setSubmitting(true);
    setCompleteError("");
    try {
      await apiFetch("/api/self-assessment/complete", {
        token,
        method: "POST",
        body: JSON.stringify({ departments: depts }),
      });
    } catch (err) {
      setCompleteError("Your answers were saved, but we couldn't send the confirmation. Our team will still receive your submission.");
    } finally {
      setSubmitting(false);
    }
  };

  const orgDomain = user?.email ? user.email.split("@")[1] : null;

  const persist = (patch) => {
    const next = { step, selectedDepts, deptIndex, answers, collaborators, editUsed, editing, ...patch };
    saveToDisk(user?.id, next);
    return next;
  };

  const handleSaveProgress = () => {
    persist({});
    setSavedFeedback(true);
    setTimeout(() => setSavedFeedback(false), 2000);
  };

  const goToPreviousStep = useCallback(() => {
    // "review" and "pending" are terminal-ish — browser Back must not smuggle the
    // user back into the questions (that would bypass the one-edit limit).
    if (step === "review" || step === "pending") return;
    if (step === "questions") {
      if (editing) {
        // Mid-edit: Back returns to the review screen, edit already spent.
        setEditing(false);
        setStep("review");
        persist({ step: "review", editing: false });
      } else if (deptIndex === 0) {
        setStep("collabs");
        persist({ step: "collabs" });
      } else {
        const prev = deptIndex - 1;
        setDeptIndex(prev);
        persist({ deptIndex: prev });
      }
    } else if (step === "collabs") {
      setStep("depts");
      persist({ step: "depts" });
    } else if (step === "depts") {
      setStep("welcome");
      persist({ step: "welcome" });
    }
  }, [step, deptIndex, editing]);

  // Keep a ref to the latest goToPreviousStep and step so the popstate handler
  // doesn't go stale when step changes. A single handler registered once on mount
  // means at most ONE extra sentinel entry in history instead of one per step change.
  const goToPreviousStepRef = useRef(goToPreviousStep);
  const stepRef = useRef(step);
  useEffect(() => { goToPreviousStepRef.current = goToPreviousStep; }, [goToPreviousStep]);
  useEffect(() => { stepRef.current = step; }, [step]);

  useEffect(() => {
    // Push ONE sentinel via React Router so its internal history idx stays correct.
    // The handler re-pushes after each back press so there's always a sentinel to catch
    // the next back, but consume-one/push-one means at most two /self-assess entries total.
    navigate(location.pathname + location.search, { replace: false });

    const handler = () => {
      if (stepRef.current === "welcome") return; // let browser back exit normally from welcome
      navigate(location.pathname + location.search, { replace: false });
      goToPreviousStepRef.current();
    };

    window.addEventListener("popstate", handler);
    return () => window.removeEventListener("popstate", handler);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []); // intentionally runs only on mount

  const toggleDept = (dept) => {
    if (REQUIRED_DEPTS.includes(dept)) return; // mandatory — cannot be unselected
    setSelectedDepts(prev =>
      orderDepts(prev.includes(dept) ? prev.filter(d => d !== dept) : [...prev, dept])
    );
  };

  const addCustomDept = () => {
    const d = customDept.trim();
    if (!d || selectedDepts.includes(d)) { setCustomDept(""); return; }
    setSelectedDepts(prev => orderDepts([...prev, d]));
    setCustomDept("");
  };

  const answer = (qId, value) => {
    const next = { ...answers, [qId]: value };
    setAnswers(next);
    persist({ answers: next });
  };

  const handleCollaboratorsChange = (dept, entries) => {
    const next = { ...collaborators, [dept]: entries };
    setCollaborators(next);
    persist({ collaborators: next });
  };

  const currentDept = selectedDepts[deptIndex];
  const currentQuestionsBase = currentDept ? deptQuestionBase(currentDept) : [];
  const currentQuestions = expandQuestions(currentQuestionsBase, answers);

  const goToStep = (s, extra = {}) => {
    setStep(s);
    persist({ step: s, ...extra });
  };

  return (
    <div className="sa-root" style={{ minHeight: "100vh", background: "var(--bg)", color: "var(--text)" }}>
      <style>{SA_CSS}</style>
      {/* Pending banner */}
      <div className="sa-banner" style={{
        position: "fixed", top: 0, left: 0, right: 0, zIndex: 8000,
        background: "#f59e0b", color: "#fff",
        padding: "8px 20px",
        display: "flex", alignItems: "center", justifyContent: "center", gap: 12,
        fontSize: 13, fontWeight: 500,
      }}>
        <span>⏳</span>
        <span>Your account is pending admin verification. Complete this self-assessment while you wait.</span>
      </div>

      {/* Header */}
      <div className="sa-header" style={{
        marginTop: 36, padding: "16px 28px",
        borderBottom: "1px solid var(--border2)",
        display: "flex", alignItems: "center", justifyContent: "space-between",
      }}>
        <div className="sa-brand" style={{ display: "flex", alignItems: "center", gap: 14 }}>
          <Logo style={{ height: 28 }} />
          <span className="sa-brand-sub" style={{ fontSize: 13, color: "var(--text3)", borderLeft: "1px solid var(--border2)", paddingLeft: 14 }}>
            Compliance Self-Assessment
          </span>
        </div>
        <div className="sa-actions" style={{ display: "flex", gap: 10, alignItems: "center" }}>
          <span className="sa-email" style={{ fontSize: 13, color: "var(--text3)" }}>{user?.email}</span>
          {step !== "welcome" && step !== "pending" && (
            <button
              className="btn btn-ghost"
              style={{ fontSize: 12, color: savedFeedback ? "var(--green, #22c55e)" : undefined, borderColor: savedFeedback ? "var(--green, #22c55e)" : undefined }}
              onClick={handleSaveProgress}
            >
              {savedFeedback ? "✓ Saved" : "Save Progress"}
            </button>
          )}
          <button className="btn btn-ghost" style={{ fontSize: 12 }} onClick={onLogout}>Sign out</button>
        </div>
      </div>

      {/* Step progress bar */}
      {step !== "welcome" && (
        <div className="sa-progress" style={{ padding: "0 28px" }}>
          <div style={{ display: "flex", gap: 4, padding: "12px 0", maxWidth: 680, margin: "0 auto" }}>
            {["depts", "collabs", ...selectedDepts, "review", "pending"].map((s, i) => {
              const stepOrder = ["welcome", "depts", "collabs", ...selectedDepts, "review", "pending"];
              const current = stepOrder.indexOf(step);
              const done = i < current - 1;
              const active = s === step || (step === `q-${selectedDepts[deptIndex]}` && s === selectedDepts[deptIndex]);
              return (
                <div key={s} style={{ flex: 1, height: 3, borderRadius: 2, background: done ? "var(--accent)" : active ? "var(--accent)" : "var(--bg4)", opacity: done || active ? 1 : 0.4, transition: "background 0.3s" }} />
              );
            })}
          </div>
        </div>
      )}

      {/* Step content */}
      <div style={{ paddingTop: 12 }}>
        {lockedDept && step === "questions" && (
          <div style={{
            maxWidth: 680, margin: "0 auto 0", padding: "10px 24px 0",
            fontSize: 13, color: "var(--text2)",
            display: "flex", alignItems: "center", gap: 8,
          }}>
            <span style={{ fontWeight: 600, color: "var(--accent)" }}>
              {(DEPT_META[lockedDept] || {}).icon || "🏢"} {(DEPT_META[lockedDept] || {}).label || lockedDept}
            </span>
            <span style={{ color: "var(--text3)" }}>— you've been invited to assess this department</span>
          </div>
        )}

        {!lockedDept && step === "welcome" && (
          <WelcomeStep onStart={() => goToStep("depts")} />
        )}
        {!lockedDept && step === "depts" && (
          <DeptSelectStep
            selected={selectedDepts}
            onToggle={toggleDept}
            customDept={customDept}
            setCustomDept={setCustomDept}
            onCustomAdd={addCustomDept}
            onBack={() => goToStep("welcome")}
            onNext={() => goToStep("collabs")}
          />
        )}
        {!lockedDept && step === "collabs" && (
          <CollabsStep
            depts={selectedDepts}
            collaborators={collaborators}
            onChange={handleCollaboratorsChange}
            orgDomain={orgDomain}
            token={token}
            userRole={user?.role}
            onBack={() => goToStep("depts")}
            onNext={() => { setDeptIndex(0); goToStep("questions", { deptIndex: 0 }); }}
          />
        )}
        {step === "questions" && currentDept && (
          <QuestionStep
            key={currentDept}
            token={token}
            dept={currentDept}
            questions={currentQuestions}
            answers={answers}
            onAnswer={answer}
            deptIndex={deptIndex}
            totalDepts={selectedDepts.length}
            collaborators={collaborators}
            onBack={lockedDept ? null : () => {
              if (editing) { setEditing(false); goToStep("review", { editing: false }); }
              else if (deptIndex === 0) { goToStep("collabs"); }
              else { const prev = deptIndex - 1; setDeptIndex(prev); persist({ deptIndex: prev }); }
            }}
            onNext={async () => {
              if (deptIndex < selectedDepts.length - 1) {
                const next = deptIndex + 1;
                setDeptIndex(next);
                persist({ deptIndex: next });
              } else {
                await saveAllAnswers(selectedDepts, answers);
                setEditing(false);
                goToStep("review", { editing: false });
              }
            }}
          />
        )}
        {step === "review" && (
          <ReviewAnswersStep
            token={token}
            selectedDepts={selectedDepts}
            answers={answers}
            collaborators={collaborators}
            editUsed={editUsed}
            submitting={submitting}
            error={completeError}
            onEdit={() => {
              setEditUsed(true);
              setEditing(true);
              setDeptIndex(0);
              goToStep("questions", { deptIndex: 0, editUsed: true, editing: true });
            }}
            onConfirm={async () => {
              await saveAllAnswers(selectedDepts, answers);
              await finalizeAssessment(selectedDepts);
              goToStep("pending");
            }}
          />
        )}
        {step === "pending" && (
          <PendingReviewStep
            error={completeError}
            pendingDepartments={lockedDept ? [] : selectedDepts.filter(
              d => Object.keys(getDeptAnswers(d, answers)).length === 0
            )}
            onLogout={onLogout}
          />
        )}
      </div>
    </div>
  );
}
