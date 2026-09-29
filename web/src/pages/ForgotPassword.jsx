import { useState, lazy, Suspense } from "react";
import { Link } from "react-router-dom";
import { apiFetch } from "../api/client.js";
import Logo from "../components/Logo";

const LoginHero = lazy(() => import("../components/LoginHero"));

const STEPS = { EMAIL: 1, OTP: 2, NEW_PASSWORD: 3, SUCCESS: 4 };

export default function ForgotPassword() {
  const [step, setStep] = useState(STEPS.EMAIL);
  const [email, setEmail] = useState("");
  const [otp, setOtp] = useState("");
  const [resetToken, setResetToken] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [resendCooldown, setResendCooldown] = useState(0);

  const handleRequestOTP = async (e) => {
    e.preventDefault();
    setError("");
    setLoading(true);
    try {
      await apiFetch("/api/auth/forgot-password", {
        method: "POST",
        body: JSON.stringify({ email })
      });
      setStep(STEPS.OTP);
      startResendCooldown();
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  const handleVerifyOTP = async (e) => {
    e.preventDefault();
    setError("");
    setLoading(true);
    try {
      const data = await apiFetch("/api/auth/verify-otp", {
        method: "POST",
        body: JSON.stringify({ email, otp })
      });
      setResetToken(data.resetToken);
      setStep(STEPS.NEW_PASSWORD);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  const handleResetPassword = async (e) => {
    e.preventDefault();
    setError("");

    if (newPassword !== confirmPassword) {
      setError("Passwords do not match");
      return;
    }

    setLoading(true);
    try {
      await apiFetch("/api/auth/reset-password", {
        method: "POST",
        body: JSON.stringify({ resetToken, newPassword })
      });
      setStep(STEPS.SUCCESS);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  const handleResend = async () => {
    if (resendCooldown > 0) return;
    setError("");
    setLoading(true);
    try {
      await apiFetch("/api/auth/forgot-password", {
        method: "POST",
        body: JSON.stringify({ email })
      });
      setOtp("");
      startResendCooldown();
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  const startResendCooldown = () => {
    setResendCooldown(60);
    const interval = setInterval(() => {
      setResendCooldown((prev) => {
        if (prev <= 1) { clearInterval(interval); return 0; }
        return prev - 1;
      });
    }, 1000);
  };

  return (
    <div className="login-split">
      {/* Left Panel - Form */}
      <div className="login-split-left">
        <div className="login-form-inner">
          <div className="login-logo-wrap">
            <Logo className="login-logo" />
          </div>

          {/* Step 1: Enter Email */}
          {step === STEPS.EMAIL && (
            <>
              <h1 className="login-heading">Forgot Password?</h1>
              <p className="login-subtitle">Enter your email and we'll send you a verification code</p>
              <form onSubmit={handleRequestOTP}>
                <div className="form-group">
                  <label htmlFor="reset-email">Email Address</label>
                  <input
                    id="reset-email"
                    type="email"
                    placeholder="you@company.com"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    required
                    autoFocus
                  />
                </div>
                {error && <p className="error-text">{error}</p>}
                <button type="submit" disabled={loading} className="login-btn">
                  {loading ? "Sending..." : "Send verification code"} <span className="btn-arrow">→</span>
                </button>
              </form>
            </>
          )}

          {/* Step 2: Enter OTP */}
          {step === STEPS.OTP && (
            <>
              <h1 className="login-heading">Enter Verification Code</h1>
              <p className="login-subtitle">
                We sent a 6-digit code to <strong>{email}</strong>
              </p>
              <form onSubmit={handleVerifyOTP}>
                <div className="form-group">
                  <label htmlFor="otp-input">Verification Code</label>
                  <input
                    id="otp-input"
                    type="text"
                    inputMode="numeric"
                    pattern="[0-9]{6}"
                    maxLength={6}
                    placeholder="000000"
                    value={otp}
                    onChange={(e) => setOtp(e.target.value.replace(/\D/g, "").slice(0, 6))}
                    required
                    autoFocus
                    className="otp-input"
                    autoComplete="one-time-code"
                  />
                </div>
                {error && <p className="error-text">{error}</p>}
                <button type="submit" disabled={loading || otp.length !== 6} className="login-btn">
                  {loading ? "Verifying..." : "Verify code"} <span className="btn-arrow">→</span>
                </button>
              </form>
              <div className="otp-resend">
                {resendCooldown > 0 ? (
                  <span className="resend-timer">Resend available in {resendCooldown}s</span>
                ) : (
                  <button className="resend-btn" onClick={handleResend} disabled={loading}>
                    Didn't receive the code? Resend
                  </button>
                )}
              </div>
            </>
          )}

          {/* Step 3: New Password */}
          {step === STEPS.NEW_PASSWORD && (
            <>
              <h1 className="login-heading">Set New Password</h1>
              <p className="login-subtitle">Choose a strong password for your account</p>
              <form onSubmit={handleResetPassword}>
                <div className="form-group">
                  <label htmlFor="new-pass">New Password</label>
                  <div className="password-input-wrap">
                    <input
                      id="new-pass"
                      type={showPassword ? "text" : "password"}
                      placeholder="••••••••"
                      value={newPassword}
                      onChange={(e) => setNewPassword(e.target.value)}
                      required
                      minLength={8}
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
                  <label htmlFor="confirm-pass">Confirm Password</label>
                  <input
                    id="confirm-pass"
                    type={showPassword ? "text" : "password"}
                    placeholder="••••••••"
                    value={confirmPassword}
                    onChange={(e) => setConfirmPassword(e.target.value)}
                    required
                    minLength={8}
                  />
                </div>
                {error && <p className="error-text">{error}</p>}
                <button type="submit" disabled={loading} className="login-btn">
                  {loading ? "Resetting..." : "Reset password"} <span className="btn-arrow">→</span>
                </button>
              </form>
            </>
          )}

          {/* Step 4: Success */}
          {step === STEPS.SUCCESS && (
            <>
              <div className="forgot-success-icon">✓</div>
              <h1 className="login-heading">Password Reset Complete</h1>
              <p className="login-subtitle">You can now sign in with your new password</p>
              <Link to="/login" className="login-btn" style={{ display: "block", textAlign: "center", textDecoration: "none" }}>
                Back to sign in <span className="btn-arrow">→</span>
              </Link>
            </>
          )}

          {step !== STEPS.SUCCESS && (
            <div className="auth-footer">
              <span>Remember your password?</span>
              <Link to="/login">Sign in</Link>
            </div>
          )}
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
