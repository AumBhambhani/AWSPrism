import { useState } from "react";
import { useNavigate } from "react-router-dom";

export default function UserMenu({
  user,
  company,
  theme,
  onThemeToggle,
  onLogout,
  isVerified,
  onResetLayout,
  onReviewLocked,
  align = "right",
}) {
  const [open, setOpen] = useState(false);
  const navigate = useNavigate();

  const isAdmin = user?.role === "ADMIN";
  const isLeadOrAdmin = user?.role === "ADMIN" || user?.role === "LEAD";
  const isAuditor = user?.role === "AUDITOR";
  const isReviewer = user?.role === "REVIEWER";

  return (
    <div style={{ position: "relative", display: "inline-block" }}>
      <button
        className="btn btn-ghost"
        style={{
          width: 38,
          height: 38,
          padding: 0,
          borderRadius: 12,
          display: "inline-flex",
          alignItems: "center",
          justifyContent: "center",
        }}
        onClick={() => setOpen((v) => !v)}
        title="Account & Navigation"
        aria-label="User menu"
      >
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
          <circle cx="12" cy="12" r="1"></circle>
          <circle cx="12" cy="5" r="1"></circle>
          <circle cx="12" cy="19" r="1"></circle>
        </svg>
      </button>

      {open && (
        <>
          <div
            style={{ position: "fixed", inset: 0, zIndex: 1999 }}
            onClick={() => setOpen(false)}
          />
          <div
            className="dash-popover-menu"
            style={{
              position: "absolute",
              top: "calc(100% + 8px)",
              [align === "left" ? "left" : "right"]: 0,
              zIndex: 2000,
            }}
          >
            {/* User Profile / Workspace Header */}
            <div className="dash-menu-header">
              <div className="dash-menu-user-name">
                {user?.name || user?.fullName || user?.email || "Workspace"}
              </div>
              <div className="dash-menu-user-role">
                {company?.name || user?.role || "Compliance"}
              </div>
            </div>

            {/* Management Group */}
            <div className="dash-menu-section-label">Management</div>
            {isAdmin && (
              <button
                className="dash-menu-item"
                onClick={() => {
                  setOpen(false);
                  navigate("/admin");
                }}
              >
                <span className="dash-menu-item-icon">
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <circle cx="12" cy="12" r="3" />
                    <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z" />
                  </svg>
                </span>
                Admin Panel
              </button>
            )}
            {isAdmin && isVerified !== false && (
              <button
                className="dash-menu-item"
                onClick={() => {
                  setOpen(false);
                  navigate("/auditors");
                }}
              >
                <span className="dash-menu-item-icon">
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2" />
                    <circle cx="9" cy="7" r="4" />
                    <path d="M22 21v-2a4 4 0 0 0-3-3.87" />
                    <path d="M16 3.13a4 4 0 0 1 0 7.75" />
                  </svg>
                </span>
                Auditors
              </button>
            )}
            {isLeadOrAdmin && (
              <button
                className="dash-menu-item"
                onClick={() => {
                  setOpen(false);
                  if (isVerified === false && onReviewLocked) onReviewLocked();
                  else navigate("/review");
                }}
              >
                <span className="dash-menu-item-icon">
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M9 11l3 3L22 4" />
                    <path d="M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11" />
                  </svg>
                </span>
                Review Workspace
              </button>
            )}
            {(isLeadOrAdmin || isAuditor) && (
              <button
                className="dash-menu-item"
                onClick={() => {
                  setOpen(false);
                  navigate("/settings/integrations");
                }}
              >
                <span className="dash-menu-item-icon">
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2" />
                  </svg>
                </span>
                Integrations
              </button>
            )}

            <div className="dash-menu-divider" />
            <div className="dash-menu-section-label">Views</div>
            <button
              className="dash-menu-item"
              onClick={() => {
                setOpen(false);
                navigate("/dashboard");
              }}
            >
              <span className="dash-menu-item-icon">
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <rect x="3" y="3" width="7" height="7" />
                  <rect x="14" y="3" width="7" height="7" />
                  <rect x="14" y="14" width="7" height="7" />
                  <rect x="3" y="14" width="7" height="7" />
                </svg>
              </span>
              Dashboard
            </button>
            {!isReviewer && (
              <button
                className="dash-menu-item"
                onClick={() => {
                  setOpen(false);
                  navigate("/audit-history");
                }}
              >
                <span className="dash-menu-item-icon">
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M9 11l3 3L22 4" />
                    <path d="M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11" />
                  </svg>
                </span>
                Audit Tracker
              </button>
            )}
            <button
              className="dash-menu-item"
              onClick={() => {
                setOpen(false);
                navigate("/executive");
              }}
            >
              <span className="dash-menu-item-icon">
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <line x1="18" y1="20" x2="18" y2="10" />
                  <line x1="12" y1="20" x2="12" y2="4" />
                  <line x1="6" y1="20" x2="6" y2="14" />
                </svg>
              </span>
              Executive Overview
            </button>
            <button
              className="dash-menu-item"
              onClick={() => {
                setOpen(false);
                navigate("/findings");
              }}
            >
              <span className="dash-menu-item-icon">
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <circle cx="11" cy="11" r="8" />
                  <line x1="21" y1="21" x2="16.65" y2="16.65" />
                </svg>
              </span>
              Findings & Gaps
            </button>
            <button
              className="dash-menu-item"
              onClick={() => {
                setOpen(false);
                navigate("/remediation");
              }}
            >
              <span className="dash-menu-item-icon">
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <rect x="9" y="2" width="6" height="4" rx="1" />
                  <path d="M9 4H5a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2V6a2 2 0 0 0-2-2h-4" />
                  <path d="M9 14l2 2 4-4" />
                </svg>
              </span>
              Remediation Plans
            </button>
            <button
              className="dash-menu-item"
              onClick={() => {
                setOpen(false);
                navigate("/requests");
              }}
            >
              <span className="dash-menu-item-icon">
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
                  <polyline points="14 2 14 8 20 8" />
                  <line x1="16" y1="13" x2="8" y2="13" />
                  <line x1="16" y1="17" x2="8" y2="17" />
                  <polyline points="10 9 9 9 8 9" />
                </svg>
              </span>
              Evidence Requests
            </button>
            <button
              className="dash-menu-item"
              onClick={() => {
                setOpen(false);
                navigate("/vault");
              }}
            >
              <span className="dash-menu-item-icon">
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z" />
                </svg>
              </span>
              Evidence Vault
            </button>

            <div className="dash-menu-divider" />
            <div className="dash-menu-section-label">Preferences</div>
            {onResetLayout && (
              <button
                className="dash-menu-item"
                onClick={() => {
                  setOpen(false);
                  onResetLayout();
                }}
              >
                <span className="dash-menu-item-icon">
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <rect x="3" y="3" width="18" height="18" rx="2" ry="2" />
                    <line x1="3" y1="9" x2="21" y2="9" />
                    <line x1="9" y1="21" x2="9" y2="9" />
                  </svg>
                </span>
                Reset Layout
              </button>
            )}
            {onThemeToggle && (
              <button
                className="dash-menu-item"
                onClick={() => {
                  setOpen(false);
                  onThemeToggle();
                }}
              >
                <span className="dash-menu-item-icon">
                  {theme === "dark" ? (
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                      <circle cx="12" cy="12" r="5" />
                      <line x1="12" y1="1" x2="12" y2="3"/>
                      <line x1="12" y1="21" x2="12" y2="23"/>
                      <line x1="4.22" y1="4.22" x2="5.64" y2="5.64"/>
                      <line x1="18.36" y1="18.36" x2="19.78" y2="19.78"/>
                      <line x1="1" y1="12" x2="3" y2="12"/>
                      <line x1="21" y1="12" x2="23" y2="12"/>
                      <line x1="4.22" y1="19.78" x2="5.64" y2="18.36"/>
                      <line x1="18.36" y1="5.64" x2="19.78" y2="4.22"/>
                    </svg>
                  ) : (
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                      <path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z" />
                    </svg>
                  )}
                </span>
                {theme === "dark" ? "Light mode" : "Dark mode"}
              </button>
            )}

            <div className="dash-menu-divider" />
            <button
              className="dash-menu-item dash-menu-item-danger"
              onClick={() => {
                setOpen(false);
                onLogout && onLogout();
              }}
            >
              <span className="dash-menu-item-icon">
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" />
                  <polyline points="16 17 21 12 16 7" />
                  <line x1="21" y1="12" x2="9" y2="12" />
                </svg>
              </span>
              Log Out
            </button>
          </div>
        </>
      )}
    </div>
  );
}
