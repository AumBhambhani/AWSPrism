import { useState, useEffect, lazy, Suspense } from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import { apiFetch } from "../api/client.js";
import Logo from "../components/Logo";

const LoginHero = lazy(() => import("../components/LoginHero"));

const INDUSTRIES = [
  "Technology",
  "Finance",
  "Healthcare",
  "Education",
  "Retail",
  "Manufacturing",
  "Other"
];

const COMPANY_SIZES = [
  "1–10 employees",
  "11–50 employees",
  "51–200 employees",
  "201–1000 employees",
  "1000+ employees"
];

const BLOCKED_DOMAINS = [
  "gmail.com", "googlemail.com", "yahoo.com", "yahoo.co.uk", "yahoo.co.in",
  "hotmail.com", "outlook.com", "live.com", "msn.com",
  "icloud.com", "me.com", "mac.com",
  "aol.com", "protonmail.com", "proton.me",
  "mail.com", "zoho.com", "yandex.com",
  "gmx.com", "gmx.net", "tutanota.com",
  "fastmail.com", "hushmail.com"
];

const validateEmailDomain = (email) => {
  const domain = email.split("@")[1]?.toLowerCase();
  if (domain && BLOCKED_DOMAINS.includes(domain)) {
    return "Please use a corporate email address";
  }
  return null;
};

const validatePassword = (pwd) => {
  const issues = [];
  if (pwd.length < 8) issues.push("at least 8 characters");
  if (!/[A-Z]/.test(pwd)) issues.push("one uppercase letter");
  if (!/[a-z]/.test(pwd)) issues.push("one lowercase letter");
  if (!/[0-9]/.test(pwd)) issues.push("one number");
  if (!/[^A-Za-z0-9]/.test(pwd)) issues.push("one special character");
  return issues;
};

const EyeIcon = () => (
  <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/>
    <circle cx="12" cy="12" r="3"/>
  </svg>
);

const EyeOffIcon = () => (
  <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94"/>
    <path d="M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19"/>
    <line x1="1" y1="1" x2="23" y2="23"/>
    <path d="M14.12 14.12a3 3 0 1 1-4.24-4.24"/>
  </svg>
);

function Shell({ children }) {
  return (
    <div className="login-split">
      <div className="login-split-left" style={{ overflowY: "auto" }}>
        <div className="login-form-inner">
          <div className="login-logo-wrap">
            <Logo className="login-logo" />
          </div>
          {children}
        </div>
      </div>
      <div className="login-split-right">
        <Suspense fallback={<div className="lh-root"><div className="lh-bg" /></div>}>
          <LoginHero />
        </Suspense>
      </div>
    </div>
  );
}

function AssessmentInfo() {
  return (
    <div className="register-info">
      <h2 className="register-info-title">About your DPDPA self-assessment</h2>
      <p className="register-info-lead">
        Once your workspace is ready, you'll complete a guided self-assessment of how your
        organisation handles personal data under India's DPDP Act, 2023.
      </p>
      <ul className="register-info-list">
        <li><strong>Pick your departments</strong> — IT, HR, Legal, Finance, Marketing or your own. Each gets a short question set.</li>
        <li><strong>Delegate or invite</strong> — send a department its questions so the people closest to the data answer them.</li>
        <li><strong>Takes about 10–15 minutes</strong> per department. Progress is saved as you go.</li>
        <li><strong>Get a gap-analysis report</strong> — per-department scores, prioritised gaps, and the DPDPA provisions and penalty exposure each one maps to.</li>
      </ul>
    </div>
  );
}

// ── Step 1: capture name + email, send the verification link ──────────────────
function CaptureStep({ onSent }) {
  const [fullName, setFullName] = useState("");
  const [email, setEmail] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  const emailError = email ? validateEmailDomain(email) : null;

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError("");
    if (emailError) { setError(emailError); return; }
    setLoading(true);
    try {
      await apiFetch("/api/auth/signup/start", {
        method: "POST",
        body: JSON.stringify({ fullName, email }),
      });
      onSent(email, fullName);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <>
      <h1 className="login-heading">Create Your Workspace</h1>
      <p className="login-subtitle">Start with your name and work email — we'll send you a link to continue.</p>

      <AssessmentInfo />

      <form onSubmit={handleSubmit}>
        <div className="form-group">
          <label htmlFor="fullName">Full Name <span className="required">*</span></label>
          <input
            id="fullName"
            type="text"
            value={fullName}
            onChange={(e) => setFullName(e.target.value)}
            required
            placeholder="John Smith"
          />
        </div>

        <div className="form-group">
          <label htmlFor="email">Work Email <span className="required">*</span></label>
          <input
            id="email"
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            required
            placeholder="john@acme.com"
            className={emailError ? "input-error" : ""}
          />
          {emailError && <span className="field-error">{emailError}</span>}
          <span className="field-hint">Must be a corporate email (no Gmail, Yahoo, iCloud, etc.)</span>
        </div>

        {error && <p className="error-text">{error}</p>}

        <button type="submit" disabled={loading} className="login-btn">
          {loading ? "Sending..." : "Send verification link"} <span className="btn-arrow">→</span>
        </button>
      </form>

      <div className="auth-footer">
        <span>Already have an account?</span>
        <Link to="/login">Sign in</Link>
      </div>
    </>
  );
}

// ── Step 2: "check your inbox" ───────────────────────────────────────────────
function SentStep({ email, onResend }) {
  const [resent, setResent] = useState(false);
  const [busy, setBusy] = useState(false);

  const resend = async () => {
    setBusy(true);
    try {
      await onResend();
      setResent(true);
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <h1 className="login-heading">Check your inbox</h1>
      <p className="login-subtitle">
        We've sent a link to <strong>{email}</strong>. Click it to confirm your email and
        finish setting up your workspace. The link expires in 1 hour.
      </p>
      <p className="login-terms" style={{ marginTop: 24 }}>
        Didn't get it? Check your spam folder, or{" "}
        <button
          type="button"
          onClick={resend}
          disabled={busy || resent}
          style={{ background: "none", border: "none", padding: 0, color: "var(--accent)", cursor: "pointer", font: "inherit", textDecoration: "underline" }}
        >
          {resent ? "link resent" : busy ? "resending…" : "resend the link"}
        </button>.
      </p>
      <div className="auth-footer">
        <span>Already have an account?</span>
        <Link to="/login">Sign in</Link>
      </div>
    </>
  );
}

// ── Step 3: workspace form (name + email verified and locked) ─────────────────
function WorkspaceStep({ signupToken, verified, onLogin }) {
  const navigate = useNavigate();
  const [form, setForm] = useState({
    companyName: "",
    industry: "",
    companySize: "",
    department: "",
    jobTitle: "",
    password: "",
    confirmPassword: "",
  });
  const [showPassword, setShowPassword] = useState(false);
  const [showConfirmPassword, setShowConfirmPassword] = useState(false);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  const update = (field) => (e) => setForm((prev) => ({ ...prev, [field]: e.target.value }));
  const passwordIssues = form.password ? validatePassword(form.password) : [];

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError("");
    if (passwordIssues.length > 0) {
      setError("Password must contain: " + passwordIssues.join(", "));
      return;
    }
    if (form.password !== form.confirmPassword) {
      setError("Passwords do not match");
      return;
    }
    setLoading(true);
    try {
      const domain = form.companyName.trim().toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
      const data = await apiFetch("/api/auth/register", {
        method: "POST",
        body: JSON.stringify({
          signupToken,
          companyName: form.companyName,
          domain,
          industry: form.industry,
          companySize: form.companySize,
          department: form.department,
          jobTitle: form.jobTitle,
          password: form.password,
        }),
      });
      if (onLogin) onLogin(data);
      navigate("/tracker");
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <>
      <h1 className="login-heading">Create Your Workspace</h1>
      <p className="login-subtitle">Email confirmed — just your company details and a password to go.</p>

      <AssessmentInfo />

      <form onSubmit={handleSubmit}>
        <div className="register-section">
          <h2 className="register-section-title">Administrator Account</h2>
          <div className="form-row">
            <div className="form-group">
              <label>Full Name</label>
              <input type="text" value={verified.fullName} readOnly disabled />
            </div>
            <div className="form-group">
              <label>Email Address</label>
              <input type="email" value={verified.email} readOnly disabled />
            </div>
          </div>
          <div className="form-row">
            <div className="form-group">
              <label htmlFor="department">Department <span className="required">*</span></label>
              <input id="department" type="text" value={form.department} onChange={update("department")} required placeholder="IT / Security" />
            </div>
            <div className="form-group">
              <label htmlFor="jobTitle">Job Title <span className="required">*</span></label>
              <input id="jobTitle" type="text" value={form.jobTitle} onChange={update("jobTitle")} required placeholder="CISO" />
            </div>
          </div>
        </div>

        <div className="register-section">
          <h2 className="register-section-title">Company Information</h2>
          <div className="form-group">
            <label htmlFor="companyName">Company Name <span className="required">*</span></label>
            <input id="companyName" type="text" value={form.companyName} onChange={update("companyName")} required placeholder="Acme Corporation" />
          </div>
          <div className="form-row">
            <div className="form-group">
              <label htmlFor="industry">Industry <span className="required">*</span></label>
              <select id="industry" value={form.industry} onChange={update("industry")} required>
                <option value="">Select industry...</option>
                {INDUSTRIES.map((i) => <option key={i} value={i}>{i}</option>)}
              </select>
            </div>
            <div className="form-group">
              <label htmlFor="companySize">Company Size <span className="required">*</span></label>
              <select id="companySize" value={form.companySize} onChange={update("companySize")} required>
                <option value="">Select size...</option>
                {COMPANY_SIZES.map((s) => <option key={s} value={s}>{s}</option>)}
              </select>
            </div>
          </div>
        </div>

        <div className="register-section">
          <h2 className="register-section-title">Password</h2>
          <div className="form-row">
            <div className="form-group">
              <label htmlFor="password">Password <span className="required">*</span></label>
              <div className="password-input-wrap">
                <input
                  id="password"
                  type={showPassword ? "text" : "password"}
                  value={form.password}
                  onChange={update("password")}
                  required
                  minLength={8}
                  placeholder="Min 8 characters"
                  className={form.password && passwordIssues.length > 0 ? "input-error" : ""}
                />
                <button type="button" className="password-toggle" onClick={() => setShowPassword(!showPassword)} aria-label={showPassword ? "Hide password" : "Show password"}>
                  {showPassword ? <EyeOffIcon /> : <EyeIcon />}
                </button>
              </div>
              {form.password && passwordIssues.length > 0 && (
                <span className="field-error">Needs: {passwordIssues.join(", ")}</span>
              )}
              {form.password && passwordIssues.length === 0 && (
                <span className="field-success">Strong password</span>
              )}
            </div>
            <div className="form-group">
              <label htmlFor="confirmPassword">Confirm Password <span className="required">*</span></label>
              <div className="password-input-wrap">
                <input
                  id="confirmPassword"
                  type={showConfirmPassword ? "text" : "password"}
                  value={form.confirmPassword}
                  onChange={update("confirmPassword")}
                  required
                  minLength={8}
                  placeholder="Repeat password"
                  className={form.confirmPassword && form.confirmPassword !== form.password ? "input-error" : ""}
                />
                <button type="button" className="password-toggle" onClick={() => setShowConfirmPassword(!showConfirmPassword)} aria-label={showConfirmPassword ? "Hide password" : "Show password"}>
                  {showConfirmPassword ? <EyeOffIcon /> : <EyeIcon />}
                </button>
              </div>
              {form.confirmPassword && form.confirmPassword !== form.password && (
                <span className="field-error">Passwords do not match</span>
              )}
            </div>
          </div>
        </div>

        <label className="login-terms" style={{ display: "flex", gap: "8px", alignItems: "flex-start" }}>
          <input type="checkbox" required />
          <span>I agree to providing all the asked details for gap assessment of DPDPA for my organisation.</span>
        </label>
        {error && <p className="error-text">{error}</p>}

        <button type="submit" disabled={loading} className="login-btn">
          {loading ? "Submitting..." : "Create workspace"} <span className="btn-arrow">→</span>
        </button>
      </form>

      <p className="login-terms">
        By registering, you agree to our <Link to="/terms-of-service">Terms of Service</Link> and <Link to="/privacy-policy">Privacy Policy</Link>
      </p>
    </>
  );
}

export default function Register({ onLogin }) {
  const [searchParams] = useSearchParams();
  const token = searchParams.get("token");

  // No token → capture name/email, then show "check your inbox".
  const [phase, setPhase] = useState("capture"); // capture | sent
  const [sentEmail, setSentEmail] = useState("");
  const [sentName, setSentName] = useState("");

  // Token present → verify it and pre-fill the workspace form.
  const [verifyState, setVerifyState] = useState(token ? { status: "loading" } : null);

  useEffect(() => {
    if (!token) return;
    let cancelled = false;
    setVerifyState({ status: "loading" });
    apiFetch(`/api/auth/signup/verify?token=${encodeURIComponent(token)}`)
      .then((data) => {
        if (!cancelled) setVerifyState({ status: "ok", email: data.email, fullName: data.fullName });
      })
      .catch((err) => {
        if (!cancelled) setVerifyState({ status: "error", message: err.message || "This link is invalid or has expired." });
      });
    return () => { cancelled = true; };
  }, [token]);

  const resend = () =>
    apiFetch("/api/auth/signup/start", {
      method: "POST",
      body: JSON.stringify({ fullName: sentName || sentEmail.split("@")[0], email: sentEmail }),
    }).catch(() => {});

  if (token) {
    if (verifyState?.status === "loading") {
      return <Shell><p className="login-subtitle">Verifying your link…</p></Shell>;
    }
    if (verifyState?.status === "error") {
      return (
        <Shell>
          <h1 className="login-heading">Link expired</h1>
          <p className="login-subtitle">{verifyState.message}</p>
          <Link to="/register" className="login-btn" style={{ display: "inline-block", textAlign: "center", textDecoration: "none" }}>
            Start over
          </Link>
        </Shell>
      );
    }
    return (
      <Shell>
        <WorkspaceStep
          signupToken={token}
          verified={{ email: verifyState.email, fullName: verifyState.fullName }}
          onLogin={onLogin}
        />
      </Shell>
    );
  }

  return (
    <Shell>
      {phase === "capture" ? (
        <CaptureStep onSent={(email, name) => { setSentEmail(email); setSentName(name); setPhase("sent"); }} />
      ) : (
        <SentStep email={sentEmail} onResend={resend} />
      )}
    </Shell>
  );
}
