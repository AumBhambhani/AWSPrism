import { useState } from "react";
import { Link } from "react-router-dom";
import {
  FiMail,
  FiGlobe,
  FiAlertTriangle,
  FiCheckCircle,
  FiArrowRight,
  FiShield,
  FiLock,
  FiFileText,
  FiEye,
  FiActivity,
} from "react-icons/fi";

const API_URL = import.meta.env.VITE_API_URL || "";

const SAMPLE_URLS = [
  "example.com",
  "wikipedia.org",
  "github.com",
];

// neozaar.com (Prism's own team) is exempt from the "email domain must match
// the scanned site" rule below, so they can scan any site for demos/prospecting.
const UNRESTRICTED_EMAIL_DOMAINS = new Set(["neozaar.com"]);

const SCAN_CAPABILITIES = [
  { icon: <FiFileText />, title: "Privacy Notice & Terms", desc: "Checks for clear notice, purpose specification & contact information." },
  { icon: <FiShield />, title: "DPDPA 2023 Grievance Redressal", desc: "Detects Grievance Officer details and redressal mechanisms." },
  { icon: <FiEye />, title: "Cookie & Tracker Consent", desc: "Audits cookies, analytics scripts and consent collection banners." },
  { icon: <FiLock />, title: "Security & HTTPS Headers", desc: "Scans SSL, HSTS, CSP, and secure transmission protocols." },
];

export default function SiteScannerSection() {
  const [url, setUrl] = useState("");
  const [email, setEmail] = useState("");
  const [loading, setLoading] = useState(false);
  const [submitted, setSubmitted] = useState(false);
  const [error, setError] = useState("");

  const normalizeUrl = (input) => {
    let trimmed = input.trim();
    if (!trimmed) return "";
    if (!/^https?:\/\//i.test(trimmed)) {
      trimmed = "https://" + trimmed;
    }
    return trimmed;
  };

  const hostOf = (normalizedUrl) => {
    try {
      return new URL(normalizedUrl).hostname.replace(/^www\./i, "").toLowerCase();
    } catch {
      return "";
    }
  };

  const handleScan = async (e, customUrl) => {
    if (e) e.preventDefault();
    const targetUrl = normalizeUrl(customUrl || url);
    if (!targetUrl) return;

    setUrl(targetUrl);
    setError("");
    setSubmitted(false);

    const trimmedEmail = email.trim();
    if (!trimmedEmail) {
      setError("Please enter your email address.");
      return;
    }
    const emailDomain = trimmedEmail.split("@")[1]?.toLowerCase();
    const siteHost = hostOf(targetUrl);
    if (!emailDomain || !siteHost || (emailDomain !== siteHost && !UNRESTRICTED_EMAIL_DOMAINS.has(emailDomain))) {
      setError(`Please use an email address on the ${siteHost || "scanned site's"} domain to request this report.`);
      return;
    }

    setLoading(true);
    try {
      const resp = await fetch(`${API_URL}/api/dpdpa/public-scan-email`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ url: targetUrl, email: trimmedEmail }),
      });
      let data;
      try {
        data = await resp.json();
      } catch {
        throw new Error(
          resp.ok
            ? "The server sent back an unreadable response. Please try again."
            : `Scan failed (HTTP ${resp.status}). Please try again in a moment.`
        );
      }
      if (!resp.ok) throw new Error(data.error || "Scan could not be completed.");
      setSubmitted(true);
    } catch (err) {
      setError(err.message || "Could not complete website scan. Please verify URL.");
    } finally {
      setLoading(false);
    }
  };

  return (
    <section className="hp-section hp-scanner-section" id="site-scanner">
      <div className="hp-container">
        {/* Section Header */}
        <div className="hp-section-header-flex">
          <div>
            <span className="hp-eyebrow-tag">
              <FiActivity /> FREE LIVE SCANNER
            </span>
            <h2 className="hp-section-title hp-align-left">
              Instant Website Compliance Scanner
            </h2>
            <p className="hp-section-sub hp-align-left">
              Audit any website against India's <b>DPDPA 2023</b> and <b>GDPR</b> privacy regulations in seconds.
              Get your real-time compliance score, tracker insights, and step-by-step remediation items.
            </p>
          </div>
          <span className="hp-header-note">100% Free · No Registration Required</span>
        </div>

        {/* Scanner Input Card */}
        <div className="hp-scanner-input-card">
          <form onSubmit={(e) => handleScan(e)} className="hp-scanner-form">
            <div className="hp-scanner-input-wrap">
              <FiGlobe className="hp-scanner-search-icon" />
              <input
                type="text"
                value={url}
                onChange={(e) => setUrl(e.target.value)}
                placeholder="Enter website URL (e.g. https://yourcompany.com)"
                className="hp-scanner-input"
                disabled={loading}
                required
              />
            </div>

            <div className="hp-scanner-input-wrap">
              <FiMail className="hp-scanner-search-icon" />
              <input
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="Your work email (e.g. you@yourcompany.com)"
                className="hp-scanner-input"
                disabled={loading}
                required
              />
              <button
                type="submit"
                disabled={loading}
                className="hp-btn hp-btn-primary hp-scanner-btn"
              >
                {loading ? (
                  <>
                    <span className="hp-scanner-spinner" />
                    <span>Scanning…</span>
                  </>
                ) : (
                  <>
                    <span>Email My Report</span>
                    <FiArrowRight />
                  </>
                )}
              </button>
            </div>
            <p className="hp-scanner-email-hint">
              Your email domain must match the website you're scanning — we'll email the report to you.
            </p>

            {/* Quick Sample Links */}
            <div className="hp-scanner-samples">
              <span className="hp-scanner-samples-label">Try sample:</span>
              <div className="hp-scanner-sample-chips">
                {SAMPLE_URLS.map((sample) => (
                  <button
                    key={sample}
                    type="button"
                    className="hp-scanner-chip"
                    onClick={() => handleScan(null, `https://${sample}`)}
                    disabled={loading}
                  >
                    {sample}
                  </button>
                ))}
              </div>
            </div>

            {error && (
              <div className="hp-scanner-error-box">
                <FiAlertTriangle />
                <span>{error}</span>
              </div>
            )}
          </form>
        </div>

        {/* Loading State Animation */}
        {loading && (
          <div className="hp-scanner-loading-state">
            <div className="hp-scanner-radar-wrap">
              <div className="hp-scanner-radar-circle" />
              <div className="hp-scanner-radar-sweep" />
              <FiActivity className="hp-scanner-radar-icon" />
            </div>
            <h3 className="hp-scanner-loading-title">Analyzing {url}…</h3>
            <p className="hp-scanner-loading-desc">
              Checking cookies, tracking scripts, consent notices, Grievance Officer disclosures, SSL & security headers.
            </p>
          </div>
        )}

        {/* Submission Confirmation */}
        {submitted && !loading && (
          <div className="hp-scanner-confirm-card">
            <FiCheckCircle className="hp-scanner-confirm-icon" />
            <h3 className="hp-scanner-confirm-title">Scan complete</h3>
            <p className="hp-scanner-confirm-desc">
              We're preparing your DPDPA &amp; GDPR compliance report for <b>{url}</b>.
              We will email the report to you shortly.
            </p>
            <Link to="/register" className="hp-btn hp-btn-primary">
              Get Started Free →
            </Link>
          </div>
        )}

        {/* Feature Highlights (when not scanned or as general info) */}
        {!submitted && !loading && (
          <div className="hp-scanner-highlights-grid">
            {SCAN_CAPABILITIES.map((cap) => (
              <div key={cap.title} className="hp-scanner-highlight-card">
                <div className="hp-scanner-highlight-icon">{cap.icon}</div>
                <h4 className="hp-scanner-highlight-title">{cap.title}</h4>
                <p className="hp-scanner-highlight-desc">{cap.desc}</p>
              </div>
            ))}
          </div>
        )}
      </div>
    </section>
  );
}
