import { useState } from "react";
import NotificationBell from "./NotificationBell.jsx";
import UserMenu from "./UserMenu.jsx";
import { apiFetch } from "../api/client.js";

export default function TopBar({
  currentIndex,
  total,
  onNavigate,
  onBack,
  onSaveDraft,
  onSubmitReview,
  onSaveAndContinue,
  onLogout,
  user,
  company,
  branding,
  theme,
  onThemeToggle,
  onMenuToggle,
  token,
  isVerified,
  currentAnswer,
  onProfileUpdate,
}) {
  const [actionsOpen, setActionsOpen] = useState(false);
  const [profileOpen, setProfileOpen] = useState(false);
  const [reviewLockedOpen, setReviewLockedOpen] = useState(false);
  const [profileName, setProfileName] = useState(user?.fullName || "");
  const [profileDept, setProfileDept] = useState(user?.department || "");
  const [profileTitle, setProfileTitle] = useState(user?.jobTitle || "");
  const [profileSaving, setProfileSaving] = useState(false);
  const [profileMsg, setProfileMsg] = useState("");
  const progress = total > 0 ? ((currentIndex + 1) / total) * 100 : 0;
  const showAdmin = user?.role === "ADMIN";
  const showReview = user?.role === "ADMIN" || user?.role === "LEAD";
  const isReviewer = user?.role === "REVIEWER";

  return (
    <div className="topbar">
      <div className="progress-area">
        {onMenuToggle && (
          <button
            className="nav-btn mobile-menu-btn"
            onClick={onMenuToggle}
            aria-label="Toggle navigation menu"
          >
            ☰
          </button>
        )}
        {branding?.logoUrl && (
          <img src={branding.logoUrl} alt={company?.name || "Company"} className="topbar-logo" />
        )}
        {onBack && !onNavigate ? (
          <button className="nav-btn nav-btn-progress" onClick={onBack} style={{ fontSize: 14, padding: "4px 10px" }}>
            ← Back
          </button>
        ) : onNavigate ? (
          <>
            <button
              className="nav-btn nav-btn-progress"
              onClick={() => onNavigate(-1)}
              disabled={currentIndex === 0}
            >
              &#x2039;
            </button>
            <div className="progress-track">
              <div className="progress-fill" style={{ width: `${progress}%` }}></div>
            </div>
            <button
              className="nav-btn nav-btn-progress"
              onClick={() => onNavigate(1)}
              disabled={currentIndex === total - 1}
            >
              &#x203A;
            </button>
            <span className="quest-counter">
              {currentIndex + 1} of {total}
            </span>
          </>
        ) : null}
      </div>

      <div className={`topbar-actions ${actionsOpen ? "actions-open" : ""}`}>
        {/* User identity */}
        <div
          className="user-chip"
          style={{ cursor: "pointer" }}
          onClick={() => { setProfileName(user?.fullName || ""); setProfileDept(user?.department || ""); setProfileTitle(user?.jobTitle || ""); setProfileMsg(""); setProfileOpen(true); }}
          title="Edit profile"
        >
          <span className="user-email">{user?.fullName || user?.email || "Unknown user"}</span>
          {company?.domain && <span className="user-company">{company.domain}</span>}
          {user?.role && <span className="user-role">{user.role}</span>}
        </div>

        {token && <NotificationBell token={token} />}

        {/* Primary actions */}
        {!isReviewer && (
          <>
            <button className="btn btn-ghost" onClick={onSaveDraft}>
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                <path d="M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v11a2 2 0 0 1-2 2z"></path>
                <polyline points="17 21 17 13 7 13 7 21"></polyline>
                <polyline points="7 3 7 8 15 8"></polyline>
              </svg>
              <span>Save draft</span>
            </button>
            {isVerified === false ? (
              <button className="btn btn-primary" onClick={onSaveAndContinue}>
                <span>Save &amp; Continue</span>
              </button>
            ) : (
              <button className="btn btn-primary" onClick={onSubmitReview}>
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                  <polyline points="20 6 9 17 4 12"></polyline>
                </svg>
                <span>{currentAnswer && currentAnswer !== "IMPLEMENTED" ? "Save Changes" : "Submit for review"}</span>
              </button>
            )}
          </>
        )}

        {/* Themed Navigation & Account Menu */}
        <UserMenu
          user={user}
          company={company}
          theme={theme}
          onThemeToggle={onThemeToggle}
          onLogout={onLogout}
          isVerified={isVerified}
          onReviewLocked={() => setReviewLockedOpen(true)}
        />
      </div>

      {/* Mobile actions toggle */}
      <button
        className="mobile-actions-toggle"
        onClick={() => setActionsOpen((v) => !v)}
        aria-label="Toggle actions menu"
      >
        ⋮
      </button>

      {/* Review locked modal */}
      {reviewLockedOpen && (
        <div className="modal-overlay" onClick={() => setReviewLockedOpen(false)}>
          <div className="module-modal" style={{ maxWidth: 420, textAlign: "center" }} onClick={e => e.stopPropagation()}>
            <div style={{ fontSize: 48, marginBottom: 16, marginTop: 8 }}>🔒</div>
            <h2 style={{ fontSize: 18, fontWeight: 700, marginBottom: 10, color: "var(--text)" }}>Review Workflow Locked</h2>
            <p style={{ fontSize: 14, color: "var(--text2)", lineHeight: 1.6, marginBottom: 20 }}>
              The review workflow is available after your account is verified by a platform administrator.
            </p>
            <button className="btn btn-ghost" style={{ width: "100%" }} onClick={() => setReviewLockedOpen(false)}>Close</button>
          </div>
        </div>
      )}

      {/* Profile modal */}
      {profileOpen && (
        <div className="modal-overlay" onClick={() => setProfileOpen(false)}>
          <div className="module-modal" style={{ maxWidth: 440 }} onClick={e => e.stopPropagation()}>
            <div className="module-modal-header">
              <div className="module-modal-title">My Profile</div>
              <button className="modal-close" onClick={() => setProfileOpen(false)}>×</button>
            </div>
            <div className="module-modal-content" style={{ padding: 20, display: "flex", flexDirection: "column", gap: 16 }}>

              {/* Avatar + identity */}
              <div style={{ display: "flex", alignItems: "center", gap: 14, padding: "12px 14px", background: "var(--bg3)", borderRadius: 10, border: "1px solid var(--border2)" }}>
                <div style={{
                  width: 48, height: 48, borderRadius: "50%", flexShrink: 0,
                  background: "var(--accent)", display: "flex", alignItems: "center", justifyContent: "center",
                  fontSize: 20, fontWeight: 700, color: "#fff",
                }}>
                  {(profileName || user?.email || "?")[0].toUpperCase()}
                </div>
                <div style={{ minWidth: 0 }}>
                  <div style={{ fontWeight: 600, fontSize: 14, color: "var(--text)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                    {profileName || user?.email}
                  </div>
                  <div style={{ fontSize: 12, color: "var(--text3)", marginTop: 2 }}>{user?.email}</div>
                  <div style={{ display: "flex", gap: 6, marginTop: 4 }}>
                    {user?.role && (
                      <span style={{ fontSize: 11, fontWeight: 600, padding: "2px 8px", borderRadius: 12, background: "rgba(99,102,241,0.12)", color: "var(--accent)", border: "1px solid rgba(99,102,241,0.2)" }}>
                        {user.role}
                      </span>
                    )}
                    {company?.name && (
                      <span style={{ fontSize: 11, color: "var(--text3)", padding: "2px 8px", borderRadius: 12, background: "var(--bg4)", border: "1px solid var(--border2)" }}>
                        {company.name}
                      </span>
                    )}
                  </div>
                </div>
              </div>

              {/* Editable fields */}
              <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
                <div>
                  <label style={{ fontSize: 12, color: "var(--text3)", display: "block", marginBottom: 4 }}>Full Name</label>
                  <input type="text" value={profileName} onChange={e => setProfileName(e.target.value)} placeholder="Your name" style={{ width: "100%", padding: "8px 12px", borderRadius: 6, border: "1px solid var(--border2)", background: "var(--bg3)", color: "var(--text)", fontSize: 13, boxSizing: "border-box" }} />
                </div>
                <div>
                  <label style={{ fontSize: 12, color: "var(--text3)", display: "block", marginBottom: 4 }}>Department</label>
                  <input type="text" value={profileDept} onChange={e => setProfileDept(e.target.value)} placeholder="e.g. Engineering" style={{ width: "100%", padding: "8px 12px", borderRadius: 6, border: "1px solid var(--border2)", background: "var(--bg3)", color: "var(--text)", fontSize: 13, boxSizing: "border-box" }} />
                </div>
                <div>
                  <label style={{ fontSize: 12, color: "var(--text3)", display: "block", marginBottom: 4 }}>Job Title</label>
                  <input type="text" value={profileTitle} onChange={e => setProfileTitle(e.target.value)} placeholder="e.g. Security Lead" style={{ width: "100%", padding: "8px 12px", borderRadius: 6, border: "1px solid var(--border2)", background: "var(--bg3)", color: "var(--text)", fontSize: 13, boxSizing: "border-box" }} />
                </div>
              </div>

              {profileMsg && (
                <p style={{ fontSize: 13, color: profileMsg.startsWith("✗") ? "var(--red)" : "var(--green)", margin: 0 }}>
                  {profileMsg}
                </p>
              )}

              <div style={{ display: "flex", gap: 8 }}>
                <button className="btn btn-primary" style={{ flex: 1 }} disabled={profileSaving} onClick={async () => {
                  setProfileSaving(true); setProfileMsg("");
                  try {
                    await apiFetch("/api/users/me", { token, method: "PUT", body: JSON.stringify({ fullName: profileName, department: profileDept, jobTitle: profileTitle }) });
                    setProfileMsg("✓ Saved");
                    onProfileUpdate?.({ fullName: profileName, department: profileDept, jobTitle: profileTitle });
                  } catch (e) { setProfileMsg("✗ " + e.message); }
                  finally { setProfileSaving(false); }
                }}>
                  {profileSaving ? "Saving…" : "Save changes"}
                </button>
                <button className="btn btn-ghost" onClick={() => setProfileOpen(false)}>Cancel</button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
