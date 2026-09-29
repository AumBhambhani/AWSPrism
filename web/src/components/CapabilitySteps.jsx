import { useState, useEffect, useMemo, useRef } from "react";
import { apiFetch } from "../api/client.js";

// The environment-first parts of the self-assessment. They are PART OF THE IT ASSESSMENT and
// always appear together at the top of the IT section, in this order:
//   1. EnvironmentQuestions — simple Yes/No (+ one multi-select) questions about the estate.
//   2. CapabilityCards      — appear once the environment is fully answered. PRISM has decided which
//                      capabilities are Mandatory / Recommended / Not applicable; the
//                      user only says whether they have each one and which tool they use.
//                      Every answer auto-saves, and the matching IT questions are
//                      DERIVED from these cards — nothing is ever asked twice.
// Both persist to /api/self-assessment/{environment,capabilities} and re-hydrate from
// the server. Everything is self-reported — see api/src/utils/capabilityAssessment.js.

const wrap = { maxWidth: 680, margin: "0 auto", padding: "32px 24px" };
const card = { background: "var(--bg2)", borderRadius: 10, padding: "14px 16px", border: "1px solid var(--border2)" };
const groupLabel = {
  fontSize: 11, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.08em",
  color: "var(--accent)", padding: "16px 0 6px", borderBottom: "1px solid var(--border2)", marginBottom: 8,
};

function Pill({ selected, color, bg, onClick, children, disabled }) {
  return (
    <button
      type="button"
      className="sa-pill"
      disabled={disabled}
      onClick={onClick}
      style={{
        padding: "5px 14px", borderRadius: 20, fontSize: 12, fontWeight: 600, cursor: disabled ? "default" : "pointer",
        border: `1px solid ${selected ? color : "var(--border2)"}`,
        background: selected ? bg : "var(--bg3)",
        color: selected ? color : "var(--text2)",
        transition: "all 0.15s",
      }}
    >
      {children}
    </button>
  );
}

const YESNO = [
  { value: "YES", label: "Yes", color: "#22c55e", bg: "rgba(34,197,94,0.12)" },
  { value: "NO", label: "No", color: "#ef4444", bg: "rgba(239,68,68,0.12)" },
];
const AVAILABILITY = [
  { value: "YES", label: "Yes", color: "#22c55e", bg: "rgba(34,197,94,0.12)" },
  { value: "PARTIAL", label: "Partially", color: "#f59e0b", bg: "rgba(245,158,11,0.12)" },
  { value: "NO", label: "No", color: "#ef4444", bg: "rgba(239,68,68,0.12)" },
  { value: "UNKNOWN", label: "Not sure", color: "#94a3b8", bg: "rgba(148,163,184,0.12)" },
];
const LEVEL = {
  mandatory: { label: "Mandatory", color: "#ef4444", bg: "rgba(239,68,68,0.12)" },
  recommended: { label: "Recommended", color: "#f59e0b", bg: "rgba(245,158,11,0.12)" },
  na: { label: "Not applicable", color: "#94a3b8", bg: "rgba(148,163,184,0.12)" },
};

function useServerError() {
  const [error, setError] = useState("");
  return [error, setError];
}

// ─── 1. Environment questions (embedded in the IT section, auto-saving) ─────
export function EnvironmentQuestions({ token, onSaved }) {
  const [questions, setQuestions] = useState(null);
  const [answers, setAnswers] = useState({});
  const [error, setError] = useState("");
  const loaded = useRef(false);
  const latest = useRef({});
  const timer = useRef(null);
  const onSavedRef = useRef(onSaved);
  onSavedRef.current = onSaved;

  const isAnswered = (q, a) => (q.type === "multi" ? (a[q.key]?.length ?? 0) > 0 : !!a[q.key]);
  const isComplete = (qs, a) => !!qs && qs.length > 0 && qs.every(q => isAnswered(q, a));

  useEffect(() => {
    let live = true;
    apiFetch("/api/self-assessment/environment", { token })
      .then(r => {
        if (!live) return;
        const qs = r?.questions || [];
        const a = r?.answers || {};
        setQuestions(qs);
        setAnswers(a);
        latest.current = a;
        loaded.current = true;
        onSavedRef.current?.(isComplete(qs, a)); // tell the parent whether the cards can show yet
      })
      .catch(() => { if (live) setError("Couldn't load the environment questions. Please refresh and try again."); });
    return () => { live = false; };
  }, [token]);

  // Debounced auto-save; flushed on unmount so the last click is never lost.
  const flush = async (qs) => {
    try {
      await apiFetch("/api/self-assessment/environment", { token, method: "PUT", body: JSON.stringify({ answers: latest.current }) });
      setError("");
      onSavedRef.current?.(isComplete(qs, latest.current));
    } catch (err) {
      setError(err.message || "Couldn't save that answer. Please try again.");
    }
  };
  const change = (updater) => {
    setAnswers(prev => {
      const next = updater(prev);
      latest.current = next;
      return next;
    });
    clearTimeout(timer.current);
    timer.current = setTimeout(() => flush(questions), 400);
  };
  useEffect(() => () => {
    if (timer.current) { clearTimeout(timer.current); apiFetch("/api/self-assessment/environment", { token, method: "PUT", body: JSON.stringify({ answers: latest.current }) }).catch(() => {}); }
  }, [token]);

  const toggleMulti = (key, value) => change(prev => {
    const cur = prev[key] || [];
    return { ...prev, [key]: cur.includes(value) ? cur.filter(v => v !== value) : [...cur, value] };
  });
  const setYesNo = (key, value) => change(prev => ({ ...prev, [key]: value }));

  const answered = questions ? questions.filter(q => isAnswered(q, answers)).length : 0;

  return (
    <div style={{ marginBottom: 24 }}>
      <div style={{ ...groupLabel, paddingTop: 0 }}>Your environment</div>
      <p style={{ fontSize: 13, color: "var(--text2)", lineHeight: 1.6, margin: "0 0 10px" }}>
        These are simple facts about how you work, not whether you have a control. From them we work out which security
        capabilities you need, and then ask only whether you have each one.
      </p>
      {!questions && !error && <div style={{ fontSize: 13, color: "var(--text3)" }}>Loading…</div>}
      {questions && (
        <>
          <div style={{ fontSize: 12, fontWeight: 600, marginBottom: 8, color: answered === questions.length ? "#22c55e" : "var(--text3)" }}>
            {answered} of {questions.length} environment questions answered
          </div>
          <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
            {questions.map((q, i) => (
              <div key={q.id}>
                {(i === 0 || questions[i - 1].group !== q.group) && (
                  <div style={{ fontSize: 12, fontWeight: 700, color: "var(--text2)", padding: "8px 0 6px" }}>{q.group}</div>
                )}
                <div style={card}>
                  <div style={{ fontSize: 13, fontWeight: 500, color: "var(--text)", marginBottom: 10, lineHeight: 1.5 }}>
                    <span style={{ color: "var(--text3)", marginRight: 8, fontWeight: 700 }}>{i + 1}.</span>{q.text}
                  </div>
                  <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                    {q.type === "multi"
                      ? q.options.map(o => (
                          <Pill key={o.value} selected={(answers[q.key] || []).includes(o.value)} color="var(--accent)" bg="rgba(99,102,241,0.12)" onClick={() => toggleMulti(q.key, o.value)}>
                            {o.label}
                          </Pill>
                        ))
                      : YESNO.map(o => (
                          <Pill key={o.value} selected={answers[q.key] === o.value} color={o.color} bg={o.bg} onClick={() => setYesNo(q.key, o.value)}>
                            {o.label}
                          </Pill>
                        ))}
                  </div>
                </div>
              </div>
            ))}
          </div>
        </>
      )}
      {error && <div style={{ fontSize: 13, color: "#ef4444", marginTop: 10 }}>{error}</div>}
    </div>
  );
}

// ─── The IT assessment's first two parts, always together ───────────────────
// Environment questions → (once complete) capability cards. The direct IT questions
// follow in the parent. Cards reload whenever the saved environment changes, since the
// environment decides which cards apply.
export function ITEnvironmentAndCapabilities({ token }) {
  const [envComplete, setEnvComplete] = useState(false);
  const [version, setVersion] = useState(0);
  const lastComplete = useRef(null);
  const onSaved = (complete) => {
    setEnvComplete(complete);
    // every successful save of a complete environment may change which cards apply
    if (complete) setVersion(v => v + 1);
    lastComplete.current = complete;
  };
  return (
    <div>
      <EnvironmentQuestions token={token} onSaved={onSaved} />
      {envComplete ? (
        <CapabilityCards token={token} reloadKey={version} />
      ) : (
        <div style={{ ...card, marginBottom: 24, fontSize: 13, color: "var(--text2)", lineHeight: 1.6 }}>
          Answer all the environment questions above and the security capabilities that apply to you will appear here.
        </div>
      )}
    </div>
  );
}

// ─── Capability cards (embedded at the top of the IT section) ───────────────
export function CapabilityCards({ token, reloadKey = 0 }) {
  const [data, setData] = useState(null);
  const [status, setStatus] = useState({}); // { [capId]: { available, tool } }
  const [showNa, setShowNa] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    let live = true;
    apiFetch("/api/self-assessment/capabilities", { token })
      .then(r => {
        if (!live) return;
        setData(r);
        const init = {};
        for (const c of r?.capabilities || []) if (c.level !== "na") init[c.id] = { available: c.available || null, tool: c.tool || "" };
        setStatus(init);
      })
      .catch(() => { if (live) setError("Couldn't load the security capability questions. Please refresh and try again."); });
    return () => { live = false; };
  }, [token, reloadKey]);

  const applicable = useMemo(() => (data?.capabilities || []).filter(c => c.level !== "na"), [data]);
  const notApplicable = useMemo(() => (data?.capabilities || []).filter(c => c.level === "na"), [data]);
  const answered = applicable.filter(c => status[c.id]?.available).length;
  const areas = useMemo(() => [...new Set(applicable.map(c => c.area))], [applicable]);

  // Every change auto-saves (one capability at a time), so nothing is lost on navigation.
  const save = async (id, next) => {
    if (!next?.available) return;
    try {
      await apiFetch("/api/self-assessment/capabilities", {
        token, method: "PUT",
        body: JSON.stringify({ statuses: [{ capabilityId: id, available: next.available, tool: next.tool || "" }] }),
      });
      setError("");
    } catch (err) {
      setError(err.message || "Couldn't save that answer. Please try again.");
    }
  };
  const choose = (id, available) => {
    const next = { ...status[id], available };
    setStatus(s => ({ ...s, [id]: next }));
    save(id, next);
  };

  if (error && !data) return <div style={{ fontSize: 13, color: "#ef4444", marginBottom: 16 }}>{error}</div>;
  if (!data) return <div style={{ fontSize: 13, color: "var(--text3)", marginBottom: 16 }}>Loading…</div>;

  if (!data.hasEnvironment) return null; // the parent only renders the cards once the environment is answered

  return (
    <div style={{ marginBottom: 28 }}>
      <div style={{ marginBottom: 12 }}>
        <div style={{ ...groupLabel, paddingTop: 0 }}>Security capabilities</div>
        <p style={{ fontSize: 13, color: "var(--text2)", lineHeight: 1.6, margin: "0 0 6px" }}>
          Your environment is <strong style={{ color: "var(--text)" }}>{data.classification.label}</strong>. These are the capabilities we think you need.
          Tell us whether you have each one and, if so, which tool. Your answers here also cover the matching IT control questions, so you won't be asked them again.
        </p>
        {data.classification.rationale?.length > 0 && (
          <ul style={{ fontSize: 12, color: "var(--text3)", lineHeight: 1.6, paddingLeft: 18, margin: 0 }}>
            {data.classification.rationale.map((r, i) => <li key={i}>{r}</li>)}
          </ul>
        )}
        <div style={{ fontSize: 12, color: answered === applicable.length ? "#22c55e" : "var(--text3)", marginTop: 8, fontWeight: 600 }}>
          {answered} of {applicable.length} capabilities answered
        </div>
      </div>

      {areas.map(area => (
        <div key={area} style={{ marginBottom: 8 }}>
          <div style={{ fontSize: 12, fontWeight: 700, color: "var(--text2)", padding: "10px 0 6px" }}>{area}</div>
          <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
            {applicable.filter(c => c.area === area).map(c => {
              const st = status[c.id] || {};
              const lvl = LEVEL[c.level];
              const showTool = st.available === "YES" || st.available === "PARTIAL";
              return (
                <div key={c.id} style={card}>
                  <div style={{ display: "flex", justifyContent: "space-between", gap: 12, alignItems: "flex-start", marginBottom: 4 }}>
                    <div style={{ fontSize: 14, fontWeight: 600, color: "var(--text)" }}>{c.name}</div>
                    <span style={{ fontSize: 11, fontWeight: 700, padding: "2px 10px", borderRadius: 20, color: lvl.color, background: lvl.bg, whiteSpace: "nowrap" }}>{lvl.label}</span>
                  </div>
                  <div style={{ fontSize: 12, color: "var(--text2)", lineHeight: 1.5, marginBottom: 4 }}>{c.what}</div>
                  <div style={{ fontSize: 12, color: "var(--text3)", lineHeight: 1.5, marginBottom: 6 }}><strong>Why:</strong> {c.reason}</div>
                  {c.covers?.length > 0 && (
                    <div style={{ fontSize: 11, color: "var(--text3)", lineHeight: 1.5, marginBottom: 6 }}>
                      <strong>Also answers:</strong> {c.covers[0]}{c.covers.length > 1 ? ` (+${c.covers.length - 1} more)` : ""}
                    </div>
                  )}
                  {c.suggestedTools?.length > 0 && (
                    <div style={{ fontSize: 12, color: "var(--text3)", marginBottom: 10 }}>
                      <strong>Suggested tools:</strong> {c.suggestedTools.slice(0, 3).map(t => t.tool + (t.native ? " (yours)" : "")).join(", ")}
                    </div>
                  )}
                  <div style={{ fontSize: 12, fontWeight: 600, color: "var(--text2)", marginBottom: 6 }}>Do you currently have this capability?</div>
                  <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                    {AVAILABILITY.map(o => (
                      <Pill key={o.value} selected={st.available === o.value} color={o.color} bg={o.bg} onClick={() => choose(c.id, o.value)}>{o.label}</Pill>
                    ))}
                  </div>
                  {showTool && (
                    <input
                      value={st.tool || ""}
                      maxLength={200}
                      onChange={e => setStatus(s => ({ ...s, [c.id]: { ...s[c.id], tool: e.target.value } }))}
                      onBlur={() => save(c.id, status[c.id])}
                      placeholder="Which tool do you use?"
                      style={{ marginTop: 10, width: "100%", padding: "7px 10px", borderRadius: 6, fontSize: 13, border: "1px solid var(--border2)", background: "var(--bg)", color: "var(--text)" }}
                    />
                  )}
                </div>
              );
            })}
          </div>
        </div>
      ))}

      {notApplicable.length > 0 && (
        <div style={{ marginTop: 12 }}>
          <button type="button" className="btn btn-ghost" style={{ fontSize: 12 }} onClick={() => setShowNa(v => !v)}>
            {showNa ? "Hide" : "Show"} {notApplicable.length} capabilit{notApplicable.length === 1 ? "y" : "ies"} we ruled out
          </button>
          {showNa && (
            <ul style={{ fontSize: 12, color: "var(--text3)", lineHeight: 1.7, paddingLeft: 18, marginTop: 8 }}>
              {notApplicable.map(c => <li key={c.id}><strong>{c.name}</strong> — {c.reason}</li>)}
            </ul>
          )}
        </div>
      )}
      {error && <div style={{ fontSize: 13, color: "#ef4444", marginTop: 12 }}>{error}</div>}
    </div>
  );
}

// ─── Read-only summary for the review screen ────────────────────────────────
export function ITCapabilityReview({ token }) {
  const [data, setData] = useState(null);
  useEffect(() => {
    let live = true;
    apiFetch("/api/self-assessment/capabilities", { token }).then(r => { if (live) setData(r); }).catch(() => { if (live) setData({ hasEnvironment: false }); });
    return () => { live = false; };
  }, [token]);
  if (!data?.hasEnvironment) return null;
  const rows = (data.capabilities || []).filter(c => c.level !== "na");
  return (
    <div style={{ borderBottom: "1px solid var(--border2)" }}>
      <div style={{ padding: "10px 14px", fontSize: 12, color: "var(--text3)", background: "var(--bg2)" }}>
        Security capabilities · environment: <strong style={{ color: "var(--text2)" }}>{data.classification?.label}</strong>
      </div>
      {rows.map((c, i) => {
        const a = AVAILABILITY.find(o => o.value === c.available);
        return (
          <div key={c.id} style={{ display: "flex", gap: 12, alignItems: "flex-start", justifyContent: "space-between", padding: "10px 14px", borderTop: i === 0 ? "none" : "1px solid var(--border2)" }}>
            <span style={{ fontSize: 13, color: "var(--text2)", lineHeight: 1.5, minWidth: 0 }}>
              {c.name}{c.tool ? <span style={{ color: "var(--text3)" }}> — {c.tool}</span> : null}
            </span>
            <span style={{ flexShrink: 0, fontSize: 11, fontWeight: 700, padding: "3px 10px", borderRadius: 20, color: a?.color || "var(--text3)", background: a?.bg || "var(--bg4)", border: `1px solid ${a?.color || "var(--border2)"}` }}>
              {a?.label || "Not answered"}
            </span>
          </div>
        );
      })}
    </div>
  );
}
