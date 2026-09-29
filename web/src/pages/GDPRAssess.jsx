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
    id: "lawful-basis", title: "Lawful Basis & Transparency", ref: "GDPR Art. 5–6, 13–14",
    questions: [
      { id: "lawful-basis",    text: "Every processing activity has a documented lawful basis (consent, contract, legal obligation, legitimate interest, etc.)." },
      { id: "privacy-notice",  text: "A clear, plain-language privacy notice is published and accessible from every page where personal data is collected." },
      { id: "ropa",            text: "A Record of Processing Activities (RoPA) is maintained and kept up-to-date." },
    ],
  },
  {
    id: "consent", title: "Consent Management", ref: "GDPR Art. 7, ePrivacy",
    questions: [
      { id: "cookie-banner",    text: "A cookie consent banner allows users to accept, reject, or granularly manage non-essential cookies before they fire." },
      { id: "consent-records",  text: "Consent records (what was consented to, when, and via which mechanism) are stored and retrievable." },
      { id: "withdraw",         text: "Withdrawing consent is as easy as giving it, and withdrawal is acted upon without delay." },
    ],
  },
  {
    id: "dsr", title: "Data Subject Rights", ref: "GDPR Art. 15–22",
    questions: [
      { id: "dsar-process",  text: "A documented process exists to handle Data Subject Access Requests (DSARs) within the 30-day deadline." },
      { id: "right-erasure", text: "Requests for erasure ('right to be forgotten') can be fulfilled within the organisation's systems and third-party processors." },
      { id: "portability",   text: "Personal data can be exported in a machine-readable format upon request (data portability)." },
    ],
  },
  {
    id: "minimisation", title: "Data Minimisation & Retention", ref: "GDPR Art. 5(1)(c)(e)",
    questions: [
      { id: "minimisation",       text: "Only personal data that is necessary for the stated purpose is collected — no excessive or unnecessary fields." },
      { id: "retention-policy",   text: "A retention schedule defines how long each category of personal data is kept, with automated or manual deletion processes." },
      { id: "purpose-limitation", text: "Personal data is not used for purposes beyond those stated at collection without a new lawful basis." },
    ],
  },
  {
    id: "security", title: "Data Security", ref: "GDPR Art. 25, 32",
    questions: [
      { id: "encryption",    text: "Personal data is encrypted at rest and in transit using appropriate standards (TLS 1.2+, AES-256 or equivalent)." },
      { id: "access-control",text: "Access to personal data is restricted to authorised personnel on a need-to-know basis, with access logs maintained." },
      { id: "dpia",          text: "Data Protection Impact Assessments (DPIAs) are conducted for high-risk processing activities." },
    ],
  },
  {
    id: "breach", title: "Breach Response", ref: "GDPR Art. 33–34",
    questions: [
      { id: "breach-procedure",    text: "A documented breach response procedure defines detection, assessment, containment, notification, and reporting steps." },
      { id: "72-hour",             text: "The organisation can detect and assess a personal data breach quickly enough to notify supervisory authorities within 72 hours." },
      { id: "affected-notification",text: "Affected individuals are notified when a breach is likely to result in a high risk to their rights and freedoms." },
    ],
  },
  {
    id: "transfers", title: "International Data Transfers", ref: "GDPR Art. 44–49",
    questions: [
      { id: "transfer-mapping",    text: "All transfers of personal data outside the EEA (including to cloud providers and third-party tools) are documented." },
      { id: "transfer-safeguards", text: "Appropriate safeguards (SCCs, adequacy decision, BCRs) are in place for every international transfer." },
    ],
  },
  {
    id: "accountability", title: "Accountability & Governance", ref: "GDPR Art. 5(2), 24, 37–39",
    questions: [
      { id: "dpo",              text: "A Data Protection Officer (DPO) or equivalent privacy lead is designated, accessible, and involved in privacy decisions." },
      { id: "training",         text: "Staff who handle personal data receive regular privacy and data protection training." },
      { id: "vendor-contracts", text: "Data Processing Agreements (DPAs) are in place with all processors handling personal data on your behalf." },
    ],
  },
];

function scoreColor(pct) {
  if (pct >= 75) return "var(--green)";
  if (pct >= 50) return "var(--amber)";
  if (pct >= 25) return "#ea580c";
  return "var(--red)";
}

export default function GDPRAssess() {
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
          <Link to="/assess/dpdp"     className="assess-header-link">DPDP Scanner</Link>
          <Link to="/assess/iso27001" className="assess-header-link">ISO 27001</Link>
          <Link to="/login" className="hp-btn hp-btn-primary" style={{ padding: "8px 18px", fontSize: 13 }}>Sign In</Link>
        </div>
      </header>

      <div className="assess-body">
        {!submitted ? (<>
          <div className="assess-hero">
            <div className="assess-badge">GDPR · Self-Assessment</div>
            <h1>How ready are you for GDPR?</h1>
            <p>Rate your compliance across {total} GDPR obligations in ~5 minutes. Get an instant gap analysis.</p>
          </div>

          <div className="assess-card" style={{ padding: "18px 28px" }}>
            <div style={{ display: "flex", justifyContent: "space-between", fontSize: 13, color: "var(--text2)", marginBottom: 8 }}>
              <span>Progress</span>
              <span style={{ fontWeight: 600, color: "var(--accent)" }}>{answered}/{total} answered</span>
            </div>
            <div className="assess-progress-bar-wrap">
              <div className="assess-progress-bar" style={{ width: `${progress}%` }} />
            </div>
          </div>

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
            <div className="assess-badge">Your GDPR Readiness Report</div>
            <h1>Overall Readiness: <span style={{ color: scoreColor(overallPct) }}>{overallPct}%</span></h1>
            <p>
              {overallPct >= 75 ? "Strong posture — fine-tune your programme for full compliance." :
               overallPct >= 50 ? "Moderate readiness — targeted improvements needed." :
               overallPct >= 25 ? "Significant gaps — enforcement risk if left unaddressed." :
               "Early stage — foundational GDPR obligations need to be established urgently."}
            </p>
          </div>

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

          <div className="assess-card">
            <h2>Article-by-Article Scores</h2>
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

          {gaps.length > 0 && (
            <div className="assess-card">
              <h2>Priority Gaps</h2>
              <p className="assess-card-sub">{gaps.length} obligations not yet implemented — highest regulatory risk.</p>
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
            <h2>Build a continuous GDPR programme</h2>
            <p>PRISM maps every gap to an owner, tracks remediation progress, and keeps your evidence organised for DPA audits.</p>
            <Link to="/register" className="hp-btn" style={{ background: "#fff", color: "var(--text)", fontWeight: 700 }}>
              Start Your GDPR Programme →
            </Link>
          </div>
        </>)}
      </div>
    </div>
  );
}
