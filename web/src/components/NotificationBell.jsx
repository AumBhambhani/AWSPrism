import { useCallback, useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { apiFetch } from "../api/client.js";

export default function NotificationBell({ token }) {
  const [unread, setUnread] = useState(0);
  const navigate = useNavigate();

  const loadCount = useCallback(async () => {
    if (!token) return;
    try {
      const data = await apiFetch("/api/notifications/unread-count", { token });
      setUnread(data?.count || 0);
    } catch { /* silent */ }
  }, [token]);

  useEffect(() => {
    loadCount();
    const interval = setInterval(loadCount, 30000);
    return () => clearInterval(interval);
  }, [loadCount]);

  return (
    <button
      className="btn btn-ghost dash-bell-btn"
      onClick={() => navigate("/notifications")}
      style={{
        width: 40,
        height: 40,
        padding: 0,
        display: "inline-flex",
        alignItems: "center",
        justifyContent: "center",
        borderRadius: 12,
        position: "relative",
        cursor: "pointer",
      }}
      title="Notifications"
      aria-label="Notifications"
    >
      <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" style={{ color: unread > 0 ? "var(--dp-accent, #4F46E5)" : "var(--dp-ink, #1E293B)" }}>
        <path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9" />
        <path d="M13.73 21a2 2 0 0 1-3.46 0" />
      </svg>
      {unread > 0 && (
        <span style={{
          position: "absolute", top: -2, right: -2,
          background: "var(--red, #ef4444)", color: "#fff",
          borderRadius: "50%", fontSize: 10, fontWeight: 700,
          minWidth: 16, height: 16, lineHeight: "16px",
          textAlign: "center", padding: "0 3px",
          boxShadow: "0 0 0 2px var(--bg, #fff)",
        }}>
          {unread > 9 ? "9+" : unread}
        </span>
      )}
    </button>
  );
}
