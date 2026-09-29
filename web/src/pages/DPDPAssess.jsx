import { useState } from "react";
import { Link } from "react-router-dom";
import Logo from "../components/Logo";

const API_URL = import.meta.env.VITE_API_URL || "";

const STATUS_META = {
  pass:    { icon: "✓", color: "var(--green)",  label: "Pass" },
  partial: { icon: "~", color: "var(--amber)",  label: "Partial" },
  fail:    { icon: "✗", color: "var(--red)",    label: "Fail" },
  na:      { icon: "–", color: "var(--text3)",  label: "N/A" },
};

function scoreColor(s) {
  if (s >= 75) return "var(--green)";
  if (s >= 60) return "var(--amber)";
  if (s >= 40) return "#ea580c";
  return "var(--red)";
}

function ScoreGauge({ score, label }) {
  const c = scoreColor(score);
  const circ = 2 * Math.PI * 48;
  const off = circ * (1 - score / 100);
  return (
    <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 8 }}>
      <svg viewBox="0 0 110 110" width="110" height="110">
        <circle cx="55" cy="55" r="48" fill="none" stroke="var(--bg3)" strokeWidth="10" />
        <circle cx="55" cy="55" r="48" fill="none" stroke={c} strokeWidth="10"
          strokeDasharray={circ} strokeDashoffset={off} strokeLinecap="round"
          transform="rotate(-90 55 55)" />
        <text x="55" y="52" textAnchor="middle" fontSize="22" fontWeight="700" fill={c}>{score}</text>
        <text x="55" y="68" textAnchor="middle" fontSize="10" fill="var(--text3)">/100</text>
      </svg>
      <div style={{ fontSize: 12, fontWeight: 600, color: "var(--text2)", textAlign: "center", maxWidth: 120 }}>{label}</div>
    </div>
  );
}

function ScoreBar({ name, score }) {
  const c = scoreColor(score);
  return (
    <div className="assess-bar-row">
      <div className="assess-bar-row-label">
        <span>{name}</span>
        <span style={{ color: c }}>{score}%</span>
      </div>
      <div className="assess-bar-track">
        <div className="assess-bar-fill" style={{ width: `${score}%`, background: c }} />
      </div>
    </div>
  );
}

export default function DPDPAssess() {
  const [url, setUrl] = useState("");
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState(null);
  const [error, setError] = useState("");
  const [expanded, setExpanded] = useState({});
  const [downloading, setDownloading] = useState(false);

  const handleDownload = async () => {
    if (!url.trim()) return;
    setDownloading(true);
    try {
      const resp = await fetch(`${API_URL}/api/dpdpa/public-report`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ url: url.trim() }),
      });
      if (!resp.ok) { const d = await resp.json().catch(() => ({})); throw new Error(d.error || "Failed"); }
      const html = await resp.text();
      const blob = new Blob([html], { type: "text/html" });
      const blobUrl = URL.createObjectURL(blob);
      const win = window.open(blobUrl, "_blank");
      if (!win) window.location.href = blobUrl;
    } catch (err) {
      alert("Could not generate report: " + err.message);
    } finally {
      setDownloading(false);
    }
  };

  const handleScan = async (e) => {
    e.preventDefault();
    setError(""); setResult(null); setLoading(true);
    try {
      const resp = await fetch(`${API_URL}/api/dpdpa/public-scan`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ url: url.trim() }),
      });
      const data = await resp.json();
      if (!resp.ok) throw new Error(data.error || "Scan failed");
      setResult(data);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  const dpdpa = result?.evaluation?.frameworks?.DPDPA;
  const gdpr  = result?.evaluation?.frameworks?.GDPR;
  const categories   = result?.evaluation?.categoryScores || [];
  const remediation  = result?.evaluation?.remediation    || [];
  const checks       = result?.evaluation?.results        || [];

  return (
    <div className="assess-shell">
      <header className="assess-header">
        <Link to="/" style={{ textDecoration: "none" }}>
          <div className="hp-logo-wrap" style={{ height: 44 }}>
            <Logo className="hp-logo-img" style={{ height: 64 }} />
          </div>
        </Link>
        <div className="assess-header-links">
          <Link to="/assess/iso27001" className="assess-header-link">ISO 27001</Link>
          <Link to="/assess/gdpr"     className="assess-header-link">GDPR</Link>
          <Link to="/login" className="hp-btn hp-btn-primary" style={{ padding: "8px 18px", fontSize: 13 }}>Sign In</Link>
        </div>
      </header>

      <div className="assess-body">
        <div className="assess-hero">
          <div className="assess-badge">DPDPA 2023 · Free Scanner</div>
          <h1>Is your website DPDPA-ready?</h1>
          <p>Enter your website URL for an instant scan against India's Digital Personal Data Protection Act 2023.</p>
        </div>

        <div className="assess-card">
          <h2>Website URL</h2>
          <form onSubmit={handleScan}>
            <div className="assess-url-row">
              <input
                type="url"
                value={url}
                onChange={e => setUrl(e.target.value)}
                placeholder="https://yourcompany.com"
                required
                className="assess-url-input"
              />
              <button
                type="submit"
                disabled={loading}
                className="hp-btn hp-btn-primary"
                style={{ padding: "10px 22px", fontSize: 14, whiteSpace: "nowrap" }}
              >
                {loading ? "Scanning…" : "Run Scan"}
              </button>
            </div>
            {error && <p className="assess-error">{error}</p>}
            <p className="assess-hint">We scan publicly visible signals — cookies, privacy policy, consent banners, and trackers.</p>
          </form>
        </div>

        {loading && (
          <div style={{ textAlign: "center", padding: "48px 0", color: "var(--text2)" }}>
            <div style={{ fontSize: 32, marginBottom: 12, animation: "spin 1s linear infinite", display: "inline-block" }}>◎</div>
            <div style={{ fontSize: 15 }}>Scanning {url}…</div>
            <div style={{ fontSize: 13, marginTop: 6, color: "var(--text3)" }}>Checking cookies, trackers, privacy policy, consent signals…</div>
            <style>{`@keyframes spin { to { transform: rotate(360deg) } }`}</style>
          </div>
        )}

        {result && (<>
          {/* Download button */}
          <div style={{ display: "flex", justifyContent: "flex-end", marginBottom: 8 }}>
            <button
              className="hp-btn hp-btn-primary"
              onClick={handleDownload}
              disabled={downloading}
              style={{ padding: "10px 20px", fontSize: 13, display: "flex", alignItems: "center", gap: 8 }}
            >
              {downloading ? "Generating…" : "⬇ Download PDF Report"}
            </button>
          </div>

          {/* Scores */}
          <div className="assess-card">
            <h2>Compliance Score</h2>
            <p className="assess-card-sub">{result.target}</p>
            <div className="assess-gauge-row">
              {dpdpa && <ScoreGauge score={dpdpa.score} label={`DPDPA 2023 — ${dpdpa.label}`} />}
              {gdpr  && <ScoreGauge score={gdpr.score}  label={`GDPR — ${gdpr.label}`} />}
            </div>
            {dpdpa && (
              <div className="assess-stat-row">
                {[
                  { label: "Passed",   val: dpdpa.passed,        color: "var(--green)" },
                  { label: "Partial",  val: dpdpa.partial,       color: "var(--amber)" },
                  { label: "Failed",   val: dpdpa.failed,        color: "var(--red)" },
                  { label: "N/A",      val: dpdpa.notApplicable, color: "var(--text3)" },
                ].map(({ label, val, color }) => (
                  <div key={label} className="assess-stat">
                    <div className="assess-stat-num" style={{ color }}>{val}</div>
                    <div className="assess-stat-label">{label}</div>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Category breakdown */}
          {categories.length > 0 && (
            <div className="assess-card">
              <h2>Category Breakdown</h2>
              {[...categories].sort((a, b) => a.score - b.score).map(c => (
                <ScoreBar key={c.name} name={c.name} score={c.score} />
              ))}
            </div>
          )}

          {/* Remediation */}
          {remediation.length > 0 && (
            <div className="assess-card">
              <h2>Top Remediation Actions</h2>
              {remediation.slice(0, 8).map((r, i) => {
                const sevColor = { critical: "var(--red)", high: "#ea580c", medium: "var(--amber)", low: "var(--green)" }[r.severity] || "var(--text3)";
                return (
                  <div key={i} className="assess-remediation-item" style={{ borderLeftColor: sevColor }}>
                    <div style={{ display: "flex", gap: 8, alignItems: "center", marginBottom: 4 }}>
                      <span style={{ fontSize: 10, fontWeight: 700, color: sevColor, textTransform: "uppercase", letterSpacing: "0.05em" }}>{r.severity}</span>
                      <span style={{ fontSize: 14, fontWeight: 600, color: "var(--text)" }}>{r.title}</span>
                    </div>
                    {r.recommendation && <p style={{ fontSize: 13, color: "var(--text2)", margin: 0 }}>{r.recommendation}</p>}
                  </div>
                );
              })}
            </div>
          )}

          {/* All checks */}
          <div className="assess-card">
            <h2>All Checks</h2>
            {Array.from(new Set(checks.map(c => c.category))).map(cat => {
              const items = checks.filter(c => c.category === cat);
              const isOpen = expanded[cat];
              return (
                <div key={cat}>
                  <button className="assess-check-toggle" onClick={() => setExpanded(p => ({ ...p, [cat]: !p[cat] }))}>
                    <span>{cat}</span>
                    <span>{isOpen ? "▲" : "▼"} {items.length} checks</span>
                  </button>
                  {isOpen && (
                    <div style={{ paddingBottom: 12 }}>
                      {items.map((r, i) => {
                        const m = STATUS_META[r.status];
                        return (
                          <div key={i} style={{ display: "flex", gap: 10, alignItems: "flex-start", padding: "6px 0" }}>
                            <span style={{ fontSize: 13, fontWeight: 700, color: m.color, minWidth: 16 }}>{m.icon}</span>
                            <div>
                              <div style={{ fontSize: 13, color: "var(--text)" }}>{r.title}</div>
                              {r.detail && <div style={{ fontSize: 12, color: "var(--text2)" }}>{r.detail}</div>}
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  )}
                </div>
              );
            })}
          </div>

          <div className="assess-cta">
            <h2>Fix these gaps with PRISM</h2>
            <p>PRISM tracks your DPDPA compliance posture over time — assign owners, record evidence, and always be audit-ready.</p>
            <Link to="/register" className="hp-btn" style={{ background: "#fff", color: "var(--text)", fontWeight: 700 }}>
              Start Your DPDPA Assessment →
            </Link>
          </div>
        </>)}
      </div>
    </div>
  );
}
