import { useState } from "react";
import { Link } from "react-router-dom";
import Logo from "../components/Logo";const MATURITY = [
  { value: 0, label: "Not started", color: "var(--red)" },
  { value: 1, label: "Planned",     color: "#ea580c" },
  { value: 2, label: "Partial",     color: "var(--amber)" },
  { value: 3, label: "Implemented", color: "var(--teal)" },
  { value: 4, label: "Optimised",   color: "var(--green)" },
];

const SECTIONS = [
  {
    id: "governance", title: "Governance & Policy", ref: "Clauses 5, 6",
    questions: [
      { id: "isms-scope",   text: "An ISMS scope and policy is formally defined and approved by leadership." },
      { id: "risk-process", text: "A documented risk assessment and risk treatment process exists and is followed at least annually." },
      { id: "objectives",   text: "Information security objectives are set, tracked, and reported to management." },
    ],
  },
  {
    id: "access", title: "Access Control", ref: "Annex A 5.15–5.18",
    questions: [
      { id: "user-access",  text: "User access rights are granted based on least privilege and reviewed periodically (at least annually)." },
      { id: "privileged",   text: "Privileged accounts are restricted, logged, and subject to stronger authentication (e.g. MFA)." },
      { id: "offboarding",  text: "Access is revoked promptly (within 24 hours) when employees leave or change roles." },
    ],
  },
  {
    id: "asset", title: "Asset & Data Management", ref: "Annex A 5.9–5.12",
    questions: [
      { id: "inventory",       text: "A current inventory of information assets exists and has an assigned owner." },
      { id: "classification",  text: "Information is classified (Public / Internal / Confidential / Restricted) and handled accordingly." },
      { id: "media",           text: "Removable media and physical storage are controlled; sensitive data is encrypted at rest." },
    ],
  },
  {
    id: "operations", title: "Operations Security", ref: "Annex A 8.8–8.19",
    questions: [
      { id: "patching",  text: "A vulnerability and patch management process ensures systems are updated within defined SLAs." },
      { id: "malware",   text: "Anti-malware / EDR controls are deployed and kept up-to-date on all endpoints and servers." },
      { id: "logging",   text: "Security-relevant events are logged, retained for at least 90 days, and reviewed regularly." },
    ],
  },
  {
    id: "network", title: "Network & Communications", ref: "Annex A 8.20–8.23",
    questions: [
      { id: "segmentation", text: "Networks are segmented so production, development, and corporate environments are separated." },
      { id: "encryption",   text: "All sensitive data in transit uses TLS 1.2+ or equivalent encryption." },
      { id: "remote",       text: "Remote access (VPN, RDP, SSH) is secured with MFA and restricted to authorised users." },
    ],
  },
  {
    id: "incident", title: "Incident Management", ref: "Annex A 5.24–5.28",
    questions: [
      { id: "ir-plan",   text: "A documented incident response plan exists, is tested at least annually, and roles are assigned." },
      { id: "reporting", text: "Staff know how and where to report suspected security incidents." },
      { id: "lessons",   text: "Post-incident reviews are conducted and lessons learned are fed back into controls." },
    ],
  },
  {
    id: "supplier", title: "Supplier & Third-Party Risk", ref: "Annex A 5.19–5.22",
    questions: [
      { id: "due-diligence", text: "Third-party vendors handling company data undergo security due diligence before onboarding." },
      { id: "contracts",     text: "Security requirements are contractually agreed with suppliers." },
      { id: "review",        text: "Supplier security performance is reviewed at least annually." },
    ],
  },
  {
    id: "continuity", title: "Business Continuity", ref: "Annex A 5.29–5.30",
    questions: [
      { id: "bcp",     text: "A business continuity / disaster recovery plan exists for critical systems and is tested." },
      { id: "backups", text: "Backups are taken regularly, stored securely (offsite or cloud), and restoration is tested." },
    ],
  },
];

function scoreColor(pct) {
  if (pct >= 75) return "var(--green)";
  if (pct >= 50) return "var(--amber)";
  if (pct >= 25) return "#ea580c";
  return "var(--red)";
}

export default function ISO27001Assess() {
  const allQIds = SECTIONS.flatMap(s => s.questions.map(q => q.id));
  const [answers, setAnswers] = useState(() => Object.fromEntries(allQIds.map(id => [id, null])));
  const [submitted, setSubmitted] = useState(false);
  const [currentSection, setCurrentSection] = useState(0);

  const setAnswer = (qId, val) => setAnswers(p => ({ ...p, [qId]: val }));
  const answered = Object.values(answers).filter(v => v !== null).length;
  const total = allQIds.length;
  const progress = Math.round((answered / total) * 100);

  const sectionScores = SECTIONS.map(s => {
    const vals = s.questions.map(q => answers[q.id]).filter(v => v !== null);
    if (!vals.length) return { ...s, pct: 0, answered: 0 };
    return { ...s, pct: Math.round((vals.reduce((a, b) => a + b, 0) / (vals.length * 4)) * 100), answered: vals.length };
  });

  const overallPct = (() => {
    const vals = Object.values(answers).filter(v => v !== null);
    if (!vals.length) return 0;
    return Math.round((vals.reduce((a, b) => a + b, 0) / (vals.length * 4)) * 100);
  })();

  const gaps = SECTIONS.flatMap(s =>
    s.questions.filter(q => (answers[q.id] ?? 4) < 2).map(q => ({ ...q, section: s.title }))
  );

  const section = SECTIONS[currentSection];
  const sc = sectionScores[currentSection];

  return (
    <div className="assess-shell">
      <header className="assess-header">
        <Link to="/" style={{ textDecoration: "none" }}>
          <div className="hp-logo-wrap" style={{ height: 44 }}>
            <Logo className="hp-logo-img" style={{ height: 64 }} />
          </div>
        </Link>
        <div className="assess-header-links">
          <Link to="/assess/dpdp" className="assess-header-link">DPDP Scanner</Link>
          <Link to="/assess/gdpr" className="assess-header-link">GDPR</Link>
          <Link to="/login" className="hp-btn hp-btn-primary" style={{ padding: "8px 18px", fontSize: 13 }}>Sign In</Link>
        </div>
      </header>

      <div className="assess-body">
        {!submitted ? (<>
          <div className="assess-hero">
            <div className="assess-badge">ISO 27001:2022 · Self-Assessment</div>
            <h1>How ready are you for ISO 27001?</h1>
            <p>Rate your controls across {total} checkpoints in ~5 minutes. Get an instant gap report.</p>
          </div>

          {/* Progress */}
          <div className="assess-card" style={{ padding: "18px 28px" }}>
            <div style={{ display: "flex", justifyContent: "space-between", fontSize: 13, color: "var(--text2)", marginBottom: 8 }}>
              <span>Progress</span>
              <span style={{ fontWeight: 600, color: "var(--accent)" }}>{answered}/{total} answered</span>
            </div>
            <div className="assess-progress-bar-wrap">
              <div className="assess-progress-bar" style={{ width: `${progress}%` }} />
            </div>
          </div>

          {/* Section tabs */}
          <div className="assess-section-tabs">
            {SECTIONS.map((s, i) => {
              const done = sectionScores[i].answered === s.questions.length;
              return (
                <button key={s.id} className={`assess-tab ${currentSection === i ? "active" : ""} ${done ? "done" : ""}`}
                  onClick={() => setCurrentSection(i)}>
                  {done ? "✓ " : ""}{s.title}
                </button>
              );
            })}
          </div>

          {/* Questions */}
          <form onSubmit={e => { e.preventDefault(); setSubmitted(true); window.scrollTo({ top: 0, behavior: "smooth" }); }}>
            <div className="assess-card">
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 20 }}>
                <div>
                  <h2 style={{ marginBottom: 4 }}>{section.title}</h2>
                  <span style={{ fontSize: 12, color: "var(--text3)", fontFamily: "var(--mono)" }}>{section.ref}</span>
                </div>
                <span style={{ fontSize: 12, color: "var(--text3)" }}>{sc.answered}/{section.questions.length}</span>
              </div>

              {section.questions.map(q => (
                <div key={q.id} className="assess-question">
                  <p>{q.text}</p>
                  <div className="assess-maturity-options">
                    {MATURITY.map(m => (
                      <button key={m.value} type="button"
                        className="assess-maturity-btn"
                        onClick={() => setAnswer(q.id, m.value)}
                        style={answers[q.id] === m.value ? {
                          borderColor: m.color, color: m.color,
                          background: `color-mix(in srgb, ${m.color} 12%, var(--bg3))`,
                          boxShadow: "var(--neu-inset-sm)",
                        } : {}}>
                        {m.label}
                      </button>
                    ))}
                  </div>
                </div>
              ))}
            </div>

            <div className="assess-nav">
              <button type="button" className="hp-btn hp-btn-secondary"
                disabled={currentSection === 0}
                onClick={() => setCurrentSection(i => Math.max(0, i - 1))}
                style={{ opacity: currentSection === 0 ? 0.4 : 1 }}>
                ← Previous
              </button>
              {currentSection < SECTIONS.length - 1 ? (
                <button type="button" className="hp-btn hp-btn-primary"
                  onClick={() => setCurrentSection(i => i + 1)}>
                  Next →
                </button>
              ) : (
                <button type="submit" className="hp-btn hp-btn-primary">
                  View My Results →
                </button>
              )}
            </div>
          </form>
        </>) : (<>
          <div className="assess-hero">
            <div className="assess-badge">Your ISO 27001 Readiness Report</div>
            <h1>Overall Readiness: <span style={{ color: scoreColor(overallPct) }}>{overallPct}%</span></h1>
            <p>
              {overallPct >= 75 ? "Strong posture — minor gaps to close before certification." :
               overallPct >= 50 ? "Moderate readiness — several controls need attention." :
               overallPct >= 25 ? "Significant gaps — structured remediation programme recommended." :
               "Early stage — foundational controls need to be established."}
            </p>
          </div>

          {/* Gauge */}
          <div className="assess-card" style={{ textAlign: "center" }}>
            <svg viewBox="0 0 160 160" width="160" height="160">
              <circle cx="80" cy="80" r="65" fill="none" stroke="var(--bg3)" strokeWidth="14" />
              <circle cx="80" cy="80" r="65" fill="none" stroke={scoreColor(overallPct)} strokeWidth="14"
                strokeDasharray={2 * Math.PI * 65} strokeDashoffset={2 * Math.PI * 65 * (1 - overallPct / 100)}
                strokeLinecap="round" transform="rotate(-90 80 80)" />
              <text x="80" y="75" textAnchor="middle" fontSize="30" fontWeight="700" fill={scoreColor(overallPct)}>{overallPct}</text>
              <text x="80" y="95" textAnchor="middle" fontSize="12" fill="var(--text3)">/100</text>
            </svg>
            <div className="assess-stat-row" style={{ marginTop: 20 }}>
              {MATURITY.map(m => {
                const count = Object.values(answers).filter(v => v === m.value).length;
                return count > 0 ? (
                  <div key={m.value} className="assess-stat">
                    <div className="assess-stat-num" style={{ color: m.color }}>{count}</div>
                    <div className="assess-stat-label">{m.label}</div>
                  </div>
                ) : null;
              })}
            </div>
          </div>

          {/* Domain scores */}
          <div className="assess-card">
            <h2>Control Domain Scores</h2>
            <div style={{ marginTop: 16 }}>
              {sectionScores.map(s => (
                <div key={s.id} className="assess-bar-row">
                  <div className="assess-bar-row-label">
                    <span>{s.title}</span>
                    <span style={{ color: scoreColor(s.pct) }}>{s.pct}%</span>
                  </div>
                  <div className="assess-bar-track">
                    <div className="assess-bar-fill" style={{ width: `${s.pct}%`, background: scoreColor(s.pct) }} />
                  </div>
                </div>
              ))}
            </div>
          </div>

          {/* Gaps */}
          {gaps.length > 0 && (
            <div className="assess-card">
              <h2>Priority Gaps</h2>
              <p className="assess-card-sub">{gaps.length} controls rated "Not started" or "Planned" — your highest-risk areas.</p>
              {gaps.map((g, i) => (
                <div key={i} className="assess-gap-item">
                  <div className="assess-gap-item-section">{g.section}</div>
                  <p>{g.text}</p>
                </div>
              ))}
            </div>
          )}

          <div style={{ marginBottom: 24 }}>
            <button className="hp-btn hp-btn-secondary"
              onClick={() => { setSubmitted(false); setCurrentSection(0); }}>
              ← Retake Assessment
            </button>
          </div>

          <div className="assess-cta">
            <h2>Turn this report into action</h2>
            <p>PRISM tracks every control, assigns owners, stores evidence, and keeps you audit-ready continuously.</p>
            <Link to="/register" className="hp-btn" style={{ background: "#fff", color: "var(--text)", fontWeight: 700 }}>
              Start Your ISO 27001 Programme →
            </Link>
          </div>
        </>)}
      </div>
    </div>
  );
}
