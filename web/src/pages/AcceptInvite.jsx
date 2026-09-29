import { useState, lazy, Suspense, useEffect } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { apiFetch } from "../api/client.js";
import Logo from "../components/Logo";

const LoginHero = lazy(() => import("../components/LoginHero"));

const ROLE_LABELS = {
  ADMIN: "Admin",
  LEAD: "Lead",
  CONTRIBUTOR: "Contributor",
  REVIEWER: "Reviewer",
};

export default function AcceptInvite({ onLogin }) {
  const navigate = useNavigate();
  const { token } = useParams();
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [inviteInfo, setInviteInfo] = useState(null);
  const [inviteInfoError, setInviteInfoError] = useState("");

  useEffect(() => {
    if (!token) return;
    apiFetch(`/api/auth/invitation/${token}`)
      .then(data => setInviteInfo(data))
      .catch(err => setInviteInfoError(err.message || "Could not load invitation details"));
  }, [token]);

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError("");

    if (!token) {
      setError("Invitation token missing");
      return;
    }

    if (password !== confirmPassword) {
      setError("Passwords do not match");
      return;
    }

    setLoading(true);

    try {
      const data = await apiFetch("/api/auth/accept-invitation", {
        method: "POST",
        body: JSON.stringify({ token, password })
      });
      onLogin(data);
      if (data.company?.isVerified === false) {
        navigate(data.department ? `/self-assess?dept=${encodeURIComponent(data.department)}` : "/self-assess");
      } else {
        navigate("/tracker");
      }
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="login-split">
      {/* Left Panel - Form */}
      <div className="login-split-left">
        <div className="login-form-inner">
          <div className="login-logo-wrap">
            <Logo className="login-logo" />
          </div>
          <h1 className="login-heading">Accept Invitation</h1>
          <p className="login-subtitle">Set your password to join the workspace</p>

          {inviteInfo && (
            <div style={{
              background: "var(--bg2, #f8f9fa)", border: "1px solid var(--border, #e5e7eb)",
              borderRadius: 10, padding: "14px 16px", marginBottom: 20, fontSize: 13,
            }}>
              <div style={{ marginBottom: 8, fontWeight: 600, color: "var(--text, #111)", fontSize: 14 }}>
                You were invited to join <span style={{ color: "var(--accent, #2563eb)" }}>{inviteInfo.companyName}</span>
              </div>
              <div style={{ display: "flex", flexDirection: "column", gap: 5, color: "var(--text2, #555)" }}>
                <div style={{ display: "flex", gap: 8 }}>
                  <span style={{ fontWeight: 600, minWidth: 90 }}>Your email:</span>
                  <span>{inviteInfo.inviteeEmail}</span>
                </div>
                <div style={{ display: "flex", gap: 8 }}>
                  <span style={{ fontWeight: 600, minWidth: 90 }}>Your role:</span>
                  <span style={{
                    display: "inline-block", padding: "1px 8px", borderRadius: 12,
                    background: "rgba(99,102,241,0.1)", color: "var(--accent, #2563eb)",
                    fontWeight: 600, fontSize: 12,
                  }}>{ROLE_LABELS[inviteInfo.role] || inviteInfo.role}</span>
                </div>
                {inviteInfo.invitorEmail && (
                  <div style={{ display: "flex", gap: 8 }}>
                    <span style={{ fontWeight: 600, minWidth: 90 }}>Invited by:</span>
                    <span>
                      {inviteInfo.invitorName ? `${inviteInfo.invitorName} (${inviteInfo.invitorEmail})` : inviteInfo.invitorEmail}
                    </span>
                  </div>
                )}
              </div>
            </div>
          )}
          {inviteInfoError && (
            <div style={{ fontSize: 13, color: "var(--text2, #555)", marginBottom: 16, fontStyle: "italic" }}>
              {inviteInfoError}
            </div>
          )}

          <form onSubmit={handleSubmit}>
            <div className="form-group">
              <label htmlFor="password">Password</label>
              <div className="password-input-wrap">
                <input
                  id="password"
                  type={showPassword ? "text" : "password"}
                  placeholder="••••••••"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  required
                  autoFocus
                />
                <button
                  type="button"
                  className="password-toggle"
                  onClick={() => setShowPassword(!showPassword)}
                  aria-label={showPassword ? "Hide password" : "Show password"}
                >
                  {showPassword ? (
                    <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                      <path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94"/>
                      <path d="M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19"/>
                      <line x1="1" y1="1" x2="23" y2="23"/>
                      <path d="M14.12 14.12a3 3 0 1 1-4.24-4.24"/>
                    </svg>
                  ) : (
                    <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                      <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/>
                      <circle cx="12" cy="12" r="3"/>
                    </svg>
                  )}
                </button>
              </div>
            </div>
            <div className="form-group">
              <label htmlFor="confirmPassword">Confirm Password</label>
              <div className="password-input-wrap">
                <input
                  id="confirmPassword"
                  type={showPassword ? "text" : "password"}
                  placeholder="••••••••"
                  value={confirmPassword}
                  onChange={(e) => setConfirmPassword(e.target.value)}
                  required
                />
              </div>
            </div>

            {error && <p className="error-text">{error}</p>}

            <button type="submit" disabled={loading} className="login-btn">
              {loading ? "Joining..." : "Join Workspace"} <span className="btn-arrow">→</span>
            </button>
          </form>

          <div className="auth-footer">
            <span>Have access already?</span>
            <Link to="/login">Sign in</Link>
          </div>
        </div>
      </div>

      {/* Right Panel - Animated Hero */}
      <div className="login-split-right">
        <Suspense fallback={<div className="lh-root"><div className="lh-bg" /></div>}>
          <LoginHero />
        </Suspense>
      </div>
    </div>
  );
}
