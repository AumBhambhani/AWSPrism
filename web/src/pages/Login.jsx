import { useState, lazy, Suspense } from "react";
import { Link, useNavigate } from "react-router-dom";
import { apiFetch } from "../api/client.js";
import Logo from "../components/Logo";

const LoginHero = lazy(() => import("../components/LoginHero"));

function getDefaultRoute(user, company) {
  const role = user?.role;
  const isVerified = company?.isVerified !== false;
  if (role === "SUPERADMIN") return "/superadmin";
  if (!isVerified && role !== "SUPERADMIN" && role !== "AUDITOR") return "/self-assess";
  if (role === "AUDITOR") return "/dashboard";
  if (role === "REVIEWER") return "/review";
  return "/tracker";
}

export default function Login({ onLogin }) {
  const navigate = useNavigate();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [rememberMe, setRememberMe] = useState(false);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError("");
    setLoading(true);

    try {
      const data = await apiFetch("/api/auth/login", {
        method: "POST",
        body: JSON.stringify({ email, password })
      });
      onLogin(data);
      navigate(getDefaultRoute(data.user, data.company));
    } catch (err) {
      console.error("Login error:", err);
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="login-split">
      {/* Left Panel - Form (UNCHANGED) */}
      <div className="login-split-left">
        <div className="login-form-inner">
          <div className="login-logo-wrap">
            <Logo className="login-logo" />
          </div>
          <h1 className="login-heading">Welcome Back!</h1>
          <p className="login-subtitle">Please enter your details</p>

          <form onSubmit={handleSubmit}>
            <div className="form-group">
              <label htmlFor="email">Email Address</label>
              <input
                id="email"
                type="email"
                placeholder="you@company.com"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                required
                autoFocus
              />
            </div>
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

            <div className="login-options">
              <label className="remember-me">
                <input
                  type="checkbox"
                  checked={rememberMe}
                  onChange={(e) => setRememberMe(e.target.checked)}
                />
                <span>Remember me</span>
              </label>
              <Link to="/forgot-password" className="forgot-pw-link">Forgot Password?</Link>
            </div>

            {error && <p className="error-text">{error}</p>}

            <button type="submit" disabled={loading} className="login-btn">
              {loading ? "Signing in..." : "Login"} <span className="btn-arrow">→</span>
            </button>
          </form>

          <p className="login-terms">
            By signing in, you agree to our <Link to="/terms-of-service">Terms of Service</Link> and <Link to="/privacy-policy">Privacy Policy</Link>
          </p>

          <div className="auth-footer">
            <span>Don't have an account?</span>
            <Link to="/register">Sign Up</Link>
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
