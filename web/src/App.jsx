import { BrowserRouter, Navigate, Route, Routes } from "react-router-dom";
import { useEffect, useMemo, useState } from "react";
import { apiFetch } from "./api/client.js";
import { useAnalytics } from "./hooks/useAnalytics";
import CookieConsentBanner from "./components/CookieConsentBanner";
import Login from "./pages/Login.jsx";
import Register from "./pages/Register.jsx";
import ForgotPassword from "./pages/ForgotPassword.jsx";
import AcceptInvite from "./pages/AcceptInvite.jsx";
import AdminPanel from "./pages/AdminPanel.jsx";
import AuditorPanel from "./pages/AuditorPanel.jsx";
import Dashboard from "./pages/Dashboard.jsx";
import Executive from "./pages/Executive.jsx";
import Review from "./pages/Review.jsx";
import AuditHistory from "./pages/AuditHistory.jsx";
import NotificationsHistory from "./pages/NotificationsHistory.jsx";
import Tracker from "./pages/Tracker.jsx";
import SuperAdminDashboard from "./pages/SuperAdminDashboard.jsx";
import FrameworkImportReview from "./pages/FrameworkImportReview.jsx";
import QuestionDetail from "./pages/QuestionDetail.jsx";
import EvidenceVault from "./pages/EvidenceVault.jsx";
import EvidenceRequests from "./pages/EvidenceRequests.jsx";
import IntegrationsSettings from "./pages/IntegrationsSettings.jsx";
import ConnectionDetail from "./pages/ConnectionDetail.jsx";
import Findings from "./pages/Findings.jsx";
import Remediation from "./pages/Remediation.jsx";
import Homepage from "./pages/Homepage.jsx";
import Pricing from "./pages/Pricing.jsx";
import DPDPAssess from "./pages/DPDPAssess.jsx";
import ISO27001Assess from "./pages/ISO27001Assess.jsx";
import GDPRAssess from "./pages/GDPRAssess.jsx";
import PrivacyPolicy from "./pages/Legal.jsx";
import TermsOfService from "./pages/LegalTerms.jsx";
import Support from "./pages/Support.jsx";
import PolicyOnboarding from "./pages/PolicyOnboarding.jsx";
import SelfAssessment from "./pages/SelfAssessment.jsx";
import VaultChat from "./components/VaultChat.jsx";
import TemplateUpdateBanner from "./components/TemplateUpdateBanner.jsx";
import TemplateUpdateReview from "./pages/TemplateUpdateReview.jsx";
import ScrollToTop from "./components/ScrollToTop";

const API_URL = import.meta.env.VITE_API_URL || "";

function AnalyticsAndConsent() {
  useAnalytics();
  return <CookieConsentBanner />;
}

const getStoredAuth = () => {
  const token   = localStorage.getItem("token");
  const user    = localStorage.getItem("user");
  const company = localStorage.getItem("company");
  return {
    token,
    user:    user    ? JSON.parse(user)    : null,
    company: company ? JSON.parse(company) : null
  };
};

const getStoredBranding = () => {
  const branding = localStorage.getItem("branding");
  return branding ? JSON.parse(branding) : null;
};

function BlockedScreen({ message, onDismiss, sessionEnded = false }) {
  return (
    <div style={{
      position: "fixed", inset: 0, zIndex: 9999,
      background: "rgba(0,0,0,0.7)", backdropFilter: "blur(4px)",
      display: "flex", alignItems: "center", justifyContent: "center", padding: 24,
    }}>
      <div style={{
        background: "var(--bg2, #fff)", borderRadius: 12, padding: "40px 36px",
        maxWidth: 440, width: "100%", textAlign: "center", boxShadow: "0 24px 64px rgba(0,0,0,0.3)",
      }}>
        <div style={{ fontSize: 40, marginBottom: 16 }}>🔒</div>
        <h2 style={{ fontSize: 20, fontWeight: 700, marginBottom: 12, color: "var(--text, #111)" }}>
          {sessionEnded ? "Signed out" : "Access Restricted"}
        </h2>
        <p style={{ fontSize: 14, color: "var(--text2, #555)", lineHeight: 1.6, marginBottom: 28 }}>
          {message}
        </p>
        <div style={{ display: "flex", gap: 12, justifyContent: "center", flexWrap: "wrap" }}>
          {sessionEnded ? (
            <button onClick={onDismiss} style={{
              padding: "10px 22px", borderRadius: 8, border: "none",
              background: "var(--accent, #2563eb)", color: "#fff", fontWeight: 600,
              fontSize: 14, cursor: "pointer",
            }}>Log in again</button>
          ) : (<>
          <a href="mailto:ab@neozaar.com" style={{
            display: "inline-block", padding: "10px 22px", borderRadius: 8,
            background: "var(--accent, #2563eb)", color: "#fff", fontWeight: 600,
            fontSize: 14, textDecoration: "none",
          }}>Contact us</a>
          <button onClick={onDismiss} style={{
            padding: "10px 22px", borderRadius: 8, border: "1px solid var(--border, #ddd)",
            background: "transparent", color: "var(--text2, #555)", fontWeight: 600,
            fontSize: 14, cursor: "pointer",
          }}>Sign out</button>
          </>)}
        </div>
      </div>
    </div>
  );
}

export default function App() {
  const [auth,  setAuth]  = useState(() => getStoredAuth());
  const [theme, setTheme] = useState(() => localStorage.getItem("theme") || "light");
  const [branding, setBranding] = useState(() => getStoredBranding());
  const [blockedMessage, setBlockedMessage] = useState("");
  const [storageMigrating, setStorageMigrating] = useState(false);

  useEffect(() => {
    document.documentElement.setAttribute("data-theme", theme);
    localStorage.setItem("theme", theme);
  }, [theme]);

  // Apply branding color as CSS custom property
  useEffect(() => {
    if (branding?.primaryColor) {
      document.documentElement.style.setProperty("--brand-color", branding.primaryColor);
      document.documentElement.style.setProperty("--accent", branding.primaryColor);
    } else {
      document.documentElement.style.removeProperty("--brand-color");
      document.documentElement.style.removeProperty("--accent");
    }
  }, [branding]);

  // Sync fresh user+company state from server on startup (picks up server-side changes like onboarding reset)
  useEffect(() => {
    if (!auth.token) return;
    apiFetch("/api/auth/me", { token: auth.token }).then(data => {
      const updatedUser    = { ...auth.user,    ...data.user };
      const updatedCompany = data.company ? { ...auth.company, ...data.company } : auth.company;
      localStorage.setItem("user",    JSON.stringify(updatedUser));
      if (data.company) localStorage.setItem("company", JSON.stringify(updatedCompany));
      setAuth(prev => ({ ...prev, user: updatedUser, company: updatedCompany }));
    }).catch(() => {});
  }, [auth.token]);

  // Fetch company settings when authenticated (non-SUPERADMIN)
  useEffect(() => {
    if (auth.token && auth.user?.role !== "SUPERADMIN") {
      fetchBranding(auth.token);
    } else if (!auth.token) {
      setBranding(null);
      localStorage.removeItem("branding");
    }
  }, [auth.token]);

  const fetchBranding = async (token) => {
    try {
      const settings = await apiFetch("/api/settings", { token });
      const brandingData = {
        logoUrl: settings.logoUrl ? `${API_URL}${settings.logoUrl}` : null,
        primaryColor: settings.primaryColor || null,
        aiEnabled: settings.aiEnabled
      };
      setBranding(brandingData);
      localStorage.setItem("branding", JSON.stringify(brandingData));
      setStorageMigrating(settings.evidenceStorage?.migrationStatus === "in_progress");
    } catch {
      // Non-critical - use defaults
    }
  };

  // While an evidence-storage migration is running, re-poll settings so the
  // banner clears itself when the background job finishes.
  useEffect(() => {
    if (!storageMigrating || !auth.token) return;
    const id = setInterval(() => fetchBranding(auth.token), 30000);
    return () => clearInterval(id);
  }, [storageMigrating, auth.token]);

  const handleLogin = (session) => {
    localStorage.setItem("token",   session.token);
    localStorage.setItem("user",    JSON.stringify(session.user));
    localStorage.setItem("company", JSON.stringify(session.company));
    setAuth({ token: session.token, user: session.user, company: session.company });
  };

  const handleOnboardingComplete = () => {
    const updatedUser = { ...auth.user, onboardingCompleted: true };
    localStorage.setItem("user", JSON.stringify(updatedUser));
    setAuth(prev => ({ ...prev, user: updatedUser }));
  };

  const [showLogoutConfirm, setShowLogoutConfirm] = useState(false);
  const [sessionEnded, setSessionEnded] = useState(false);

  const handleLogout = () => setShowLogoutConfirm(true);

  const confirmLogout = () => {
    setShowLogoutConfirm(false);
    localStorage.removeItem("token");
    localStorage.removeItem("user");
    localStorage.removeItem("company");
    localStorage.removeItem("branding");
    setAuth({ token: null, user: null, company: null });
    setBranding(null);
    setBlockedMessage("");
    setSessionEnded(false);
  };

  useEffect(() => {
    const onBlocked = (e) => {
      const msg = e.detail?.message || "Your account access has been revoked. Please contact the administrator.";
      setBlockedMessage(msg);
    };
    const onBillingBlocked = (e) => {
      const msg = e.detail?.message || "Your subscription has ended. Please contact us to continue.";
      setBlockedMessage(msg);
    };
    const onSessionExpired = (e) => {
      setSessionEnded(true);
      setBlockedMessage(e.detail?.code === "SESSION_REVOKED"
        ? "Your password was changed, so this session has been signed out. Please log in again."
        : "Your session has expired. Please log in again.");
    };
    window.addEventListener("auth:company-blocked", onBlocked);
    window.addEventListener("auth:billing-blocked", onBillingBlocked);
    window.addEventListener("auth:session-expired", onSessionExpired);
    return () => {
      window.removeEventListener("auth:session-expired", onSessionExpired);
      window.removeEventListener("auth:company-blocked", onBlocked);
      window.removeEventListener("auth:billing-blocked", onBillingBlocked);
    };
  }, []);

  const handleThemeToggle = () => setTheme(t => t === "dark" ? "light" : "dark");

  const isAuthenticated  = Boolean(auth.token);
  const role             = auth.user?.role;
  const isSuperAdmin     = role === "SUPERADMIN";
  const isAdmin          = role === "ADMIN";
  const isLeadOrAdmin    = role === "ADMIN" || role === "LEAD";
  const isReviewer       = role === "REVIEWER";
  const isAuditor        = role === "AUDITOR";
  // isVerified: treat undefined/null as true so existing sessions aren't broken; only gate when explicitly false
  const isVerified       = auth.company?.isVerified !== false;
  const showOnboarding   = isAuthenticated && isAdmin && !auth.user?.onboardingCompleted && isVerified;

  const handleProfileUpdate = (patch) => {
    const updated = { ...auth.user, ...patch };
    localStorage.setItem("user", JSON.stringify(updated));
    setAuth(prev => ({ ...prev, user: updated }));
  };

  const authProps = useMemo(() => ({
    token:           auth.token,
    user:            auth.user,
    company:         auth.company,
    isVerified,
    branding,
    onLogout:        handleLogout,
    theme,
    onThemeToggle:   handleThemeToggle,
    onProfileUpdate: handleProfileUpdate,
  }), [auth, theme, branding, isVerified]);

  // Where to send an authenticated user who hits "/"
  const defaultRoute = () => {
    if (isSuperAdmin) return "/superadmin";
    if (!isVerified && !isSuperAdmin && !isAuditor) return "/self-assess";
    if (isAuditor) return "/dashboard";
    if (isReviewer)  return "/review";
    return "/tracker";
  };

  return (
    <BrowserRouter>
      <ScrollToTop />
      <AnalyticsAndConsent />
      {blockedMessage && <BlockedScreen message={blockedMessage} sessionEnded={sessionEnded} onDismiss={confirmLogout} />}
      {showLogoutConfirm && (
        <div style={{
          position: "fixed", inset: 0, zIndex: 9999,
          background: "rgba(0,0,0,0.5)", backdropFilter: "blur(3px)",
          display: "flex", alignItems: "center", justifyContent: "center", padding: 24,
        }}>
          <div style={{
            background: "var(--bg2, #fff)", borderRadius: 12, padding: "32px 28px",
            maxWidth: 380, width: "100%", textAlign: "center",
            boxShadow: "0 20px 60px rgba(0,0,0,0.25)",
          }}>
            <div style={{ fontSize: 36, marginBottom: 12 }}>👋</div>
            <h2 style={{ fontSize: 18, fontWeight: 700, marginBottom: 8, color: "var(--text, #111)" }}>Sign out?</h2>
            <p style={{ fontSize: 14, color: "var(--text2, #555)", marginBottom: 24, lineHeight: 1.5 }}>
              You'll need to sign in again to access your workspace.
            </p>
            <div style={{ display: "flex", gap: 10, justifyContent: "center" }}>
              <button
                onClick={confirmLogout}
                style={{
                  padding: "10px 24px", borderRadius: 8,
                  background: "var(--accent, #2563eb)", color: "#fff",
                  fontWeight: 600, fontSize: 14, border: "none", cursor: "pointer",
                }}
              >
                Sign out
              </button>
              <button
                onClick={() => setShowLogoutConfirm(false)}
                style={{
                  padding: "10px 24px", borderRadius: 8,
                  border: "1px solid var(--border, #ddd)", background: "transparent",
                  color: "var(--text2, #555)", fontWeight: 600, fontSize: 14, cursor: "pointer",
                }}
              >
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}
      {isAuthenticated && storageMigrating && (
        <div style={{
          position: "fixed", top: 0, left: 0, right: 0, zIndex: 9500,
          background: "#f59e0b", color: "#1a1200", fontSize: 12.5, fontWeight: 600,
          textAlign: "center", padding: "6px 12px",
        }}>
          Evidence storage migration in progress — some files may be briefly unavailable to download.
        </div>
      )}
      {showOnboarding && (
        <PolicyOnboarding
          token={auth.token}
          user={auth.user}
          onComplete={handleOnboardingComplete}
        />
      )}
      {isAuthenticated && !isSuperAdmin && !isAuditor && isVerified && (
        <VaultChat token={auth.token} />
      )}
      {isAuthenticated && isLeadOrAdmin && isVerified && (
        <TemplateUpdateBanner token={auth.token} />
      )}
      <Routes>
        {/* Public homepage — redirects authenticated users to their home */}
        <Route
          path="/"
          element={isAuthenticated ? <Navigate to={defaultRoute()} replace /> : <Homepage />}
        />
        <Route
          path="/home"
          element={isAuthenticated ? <Navigate to={defaultRoute()} replace /> : <Homepage />}
        />

        {/* Public legal pages */}
        <Route path="/privacy-policy" element={<PrivacyPolicy />} />
        <Route path="/terms-of-service" element={<TermsOfService />} />
        <Route path="/support" element={<Support />} />
        <Route path="/pricing" element={<Pricing />} />

        {/* PRISM DPDP module — public */}

        {/* Public assessment pages */}
        <Route path="/assess/dpdp" element={<DPDPAssess />} />
        <Route path="/assess/iso27001" element={<ISO27001Assess />} />
        <Route path="/assess/gdpr" element={<GDPRAssess />} />

        <Route path="/login" element={<Login onLogin={handleLogin} />} />
        <Route path="/forgot-password" element={<ForgotPassword />} />
        <Route path="/register" element={<Register onLogin={handleLogin} />} />
        <Route path="/accept-invite/:token" element={<AcceptInvite onLogin={handleLogin} />} />

        {/* Admin-only routes */}
        <Route
          path="/admin"
          element={isAuthenticated && isAdmin && isVerified ? <AdminPanel {...authProps} /> : <Navigate to={isAuthenticated ? defaultRoute() : "/login"} replace />}
        />
        <Route
          path="/auditors"
          element={isAuthenticated && isAdmin && isVerified ? <AuditorPanel {...authProps} /> : <Navigate to={isAuthenticated ? defaultRoute() : "/login"} replace />}
        />

        {/* Super Admin route */}
        <Route
          path="/superadmin"
          element={isAuthenticated && isSuperAdmin ? <SuperAdminDashboard {...authProps} /> : <Navigate to={isAuthenticated ? defaultRoute() : "/login"} replace />}
        />
        <Route
          path="/superadmin/framework-import"
          element={isAuthenticated && isSuperAdmin ? <FrameworkImportReview {...authProps} /> : <Navigate to={isAuthenticated ? defaultRoute() : "/login"} replace />}
        />
        <Route
          path="/superadmin/framework-import/:batchId"
          element={isAuthenticated && isSuperAdmin ? <FrameworkImportReview {...authProps} /> : <Navigate to={isAuthenticated ? defaultRoute() : "/login"} replace />}
        />

        {/* Template update notices — company admin/lead reviews a published version */}
        <Route
          path="/template-updates"
          element={isAuthenticated && isLeadOrAdmin ? <TemplateUpdateReview {...authProps} /> : <Navigate to={isAuthenticated ? defaultRoute() : "/login"} replace />}
        />
        <Route
          path="/template-updates/:noticeId"
          element={isAuthenticated && isLeadOrAdmin ? <TemplateUpdateReview {...authProps} /> : <Navigate to={isAuthenticated ? defaultRoute() : "/login"} replace />}
        />

        {/* Dashboard — all roles (unverified companies stay on self-assess) */}
        <Route
          path="/dashboard"
          element={
            isAuthenticated
              ? (!isVerified && !isSuperAdmin && !isAuditor ? <Navigate to="/self-assess" replace /> : <Dashboard {...authProps} />)
              : <Navigate to="/login" replace />
          }
        />

        {/* Executive overview — all roles (unverified companies stay on self-assess) */}
        <Route
          path="/executive"
          element={
            isAuthenticated
              ? (!isVerified && !isSuperAdmin && !isAuditor ? <Navigate to="/self-assess" replace /> : <Executive {...authProps} />)
              : <Navigate to="/login" replace />
          }
        />

        {/* Review — ADMIN, LEAD, REVIEWER (reviewer queue); AUDITOR (audit queue) */}
        <Route
          path="/review"
          element={
            isAuthenticated && (isLeadOrAdmin || isReviewer || isAuditor) && (isVerified || isAuditor)
              ? <Review {...authProps} />
              : <Navigate to={isAuthenticated ? defaultRoute() : "/login"} replace />
          }
        />

        {/* Notifications — full history page, all authenticated company users */}
        <Route
          path="/notifications"
          element={
            isAuthenticated && !isSuperAdmin && (isVerified || isAuditor)
              ? <NotificationsHistory {...authProps} />
              : <Navigate to={isAuthenticated ? defaultRoute() : "/login"} replace />
          }
        />

        {/* Audit history — all company users except REVIEWER (past auditor sign-offs with timestamps) */}
        <Route
          path="/audit-history"
          element={
            isAuthenticated && !isSuperAdmin && !isReviewer && (isVerified || isAuditor)
              ? <AuditHistory {...authProps} />
              : <Navigate to={isAuthenticated ? defaultRoute() : "/login"} replace />
          }
        />

        {/* Self-assessment — unverified authenticated users only */}
        <Route
          path="/self-assess"
          element={
            isAuthenticated && !isSuperAdmin
              ? (!isVerified
                  ? <SelfAssessment user={auth.user} token={auth.token} onLogout={handleLogout} />
                  : <Navigate to={defaultRoute()} replace />
                )
              : <Navigate to={isAuthenticated ? defaultRoute() : "/login"} replace />
          }
        />

        {/* Tracker — not for REVIEWER, AUDITOR, SUPERADMIN, or unverified users */}
        <Route
          path="/tracker"
          element={
            isAuthenticated
              ? (isReviewer || isAuditor || isSuperAdmin ? <Navigate to={defaultRoute()} replace /> : !isVerified ? <Navigate to="/self-assess" replace /> : <Tracker {...authProps} />)
              : <Navigate to="/" replace />
          }
        />

        {/* Question detail — all authenticated company users */}
        <Route
          path="/questions/:questId"
          element={isAuthenticated && !isSuperAdmin && (isVerified || isAuditor) ? <QuestionDetail {...authProps} /> : <Navigate to={isAuthenticated ? defaultRoute() : "/login"} replace />}
        />

        {/* Evidence Vault — all authenticated company users */}
        <Route
          path="/vault"
          element={isAuthenticated && !isSuperAdmin && (isVerified || isAuditor) ? <EvidenceVault {...authProps} /> : <Navigate to={isAuthenticated ? defaultRoute() : "/login"} replace />}
        />

        {/* Evidence Requests — ADMIN, LEAD, CONTRIBUTOR */}
        <Route
          path="/requests"
          element={
            isAuthenticated && !isSuperAdmin && !isReviewer && !isAuditor && isVerified
              ? <EvidenceRequests {...authProps} />
              : <Navigate to={isAuthenticated ? defaultRoute() : "/login"} replace />
          }
        />

        {/* Integrations Settings — ADMIN, LEAD (write), AUDITOR (read-only) */}
        <Route
          path="/settings/integrations"
          element={
            isAuthenticated && (isLeadOrAdmin || isAuditor) && (isVerified || isAuditor)
              ? <IntegrationsSettings {...authProps} />
              : <Navigate to={isAuthenticated ? defaultRoute() : "/login"} replace />
          }
        />

        {/* Connection Detail — ADMIN, LEAD (write), AUDITOR (read-only) */}
        <Route
          path="/settings/integrations/:id"
          element={
            isAuthenticated && (isLeadOrAdmin || isAuditor) && (isVerified || isAuditor)
              ? <ConnectionDetail {...authProps} />
              : <Navigate to={isAuthenticated ? defaultRoute() : "/login"} replace />
          }
        />

        {/* Findings — all authenticated company users except SUPERADMIN */}
        <Route
          path="/findings"
          element={isAuthenticated && !isSuperAdmin && (isVerified || isAuditor) ? <Findings {...authProps} /> : <Navigate to={isAuthenticated ? defaultRoute() : "/login"} replace />}
        />

        {/* Remediation — all authenticated company users except SUPERADMIN */}
        <Route
          path="/remediation"
          element={isAuthenticated && !isSuperAdmin && (isVerified || isAuditor) ? <Remediation {...authProps} /> : <Navigate to={isAuthenticated ? defaultRoute() : "/login"} replace />}
        />

        <Route path="*" element={<Navigate to={isAuthenticated ? defaultRoute() : "/"} replace />} />
      </Routes>
    </BrowserRouter>
  );
}
