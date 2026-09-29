import { useCallback, useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { apiFetch } from "../api/client.js";
import UserMenu from "../components/UserMenu.jsx";

function timeAgo(dateStr) {
  const diff = Date.now() - new Date(dateStr).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  return `${Math.floor(hrs / 24)}d ago`;
}

const ICONS = { vault_version: "📎", rejection: "⚠️", approval: "✓", audit: "🔍", assessment: "📋" };

const PAGE_SIZE = 50;

export default function NotificationsHistory({ token, user, company, onLogout, theme, onThemeToggle, isVerified }) {
  const navigate = useNavigate();
  const [notifications, setNotifications] = useState([]);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [hasMore, setHasMore] = useState(true);
  const [error, setError] = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const data = await apiFetch(`/api/notifications?limit=${PAGE_SIZE}`, { token });
      setNotifications(data || []);
      setHasMore((data || []).length === PAGE_SIZE);
      setError("");
    } catch (e) {
      setError(e.message || "Failed to load notifications");
    } finally {
      setLoading(false);
    }
  }, [token]);

  useEffect(() => { load(); }, [load]);

  const loadMore = async () => {
    const last = notifications[notifications.length - 1];
    if (!last) return;
    setLoadingMore(true);
    try {
      const data = await apiFetch(`/api/notifications?limit=${PAGE_SIZE}&before=${last.id}`, { token });
      setNotifications(prev => [...prev, ...(data || [])]);
      setHasMore((data || []).length === PAGE_SIZE);
    } catch (e) {
      setError(e.message || "Failed to load more notifications");
    } finally {
      setLoadingMore(false);
    }
  };

  const markRead = async (id) => {
    setNotifications(prev => prev.map(n => n.id === id ? { ...n, isRead: true } : n));
    try {
      await apiFetch(`/api/notifications/${id}/read`, { token, method: "POST" });
    } catch { /* silent */ }
  };

  const markAllRead = async () => {
    setNotifications(prev => prev.map(n => ({ ...n, isRead: true })));
    try {
      await apiFetch("/api/notifications/read-all", { token, method: "POST" });
    } catch { /* silent */ }
  };

  const unreadCount = notifications.filter(n => !n.isRead).length;

  return (
    <div className="review-shell fade-in">
      <div className="review-header">
        <div>
          <div className="logo">PRISM</div>
          <div className="review-title">Notifications</div>
        </div>
        <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
          {unreadCount > 0 && (
            <button className="btn btn-ghost" onClick={markAllRead}>Mark all read</button>
          )}
          <button className="btn btn-ghost" onClick={() => ((window.history.state?.idx ?? 0) > 0 ? navigate(-1) : navigate("/dashboard"))}>← Back</button>
          <button className="btn btn-ghost" onClick={load}>Refresh</button>
          <UserMenu
            user={user}
            company={company}
            theme={theme}
            onThemeToggle={onThemeToggle}
            onLogout={onLogout}
            isVerified={isVerified}
          />
        </div>
      </div>

      <div className="review-content">
        {error && <div className="error-text" style={{ marginBottom: 16 }}>{error}</div>}

        <section className="card" style={{ marginTop: 0 }}>
          <div className="section-title">
            All notifications {unreadCount > 0 && <span style={{ color: "var(--accent)" }}>({unreadCount} unread)</span>}
          </div>

          {loading ? (
            <p className="muted">Loading…</p>
          ) : notifications.length === 0 ? (
            <p className="muted">No notifications yet.</p>
          ) : (
            <>
              <div className="list">
                {notifications.map(n => (
                  <div
                    key={n.id}
                    className="list-item"
                    onClick={() => !n.isRead && markRead(n.id)}
                    style={{
                      cursor: n.isRead ? "default" : "pointer",
                      background: n.isRead ? "transparent" : "rgba(99,102,241,0.06)",
                      display: "flex", gap: 12, alignItems: "flex-start",
                    }}
                  >
                    <span style={{ fontSize: 18, flexShrink: 0, marginTop: 1 }}>
                      {ICONS[n.entityType || n.entity_type] || "📋"}
                    </span>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ fontWeight: n.isRead ? 400 : 600, fontSize: 13.5, color: "var(--text)" }}>
                        {n.title}
                      </div>
                      {n.body && (
                        <div style={{ fontSize: 12.5, color: "var(--text3)", marginTop: 3 }}>
                          {n.body}
                        </div>
                      )}
                      <div style={{ fontSize: 11, color: "var(--text3)", marginTop: 5 }}>
                        {timeAgo(n.createdAt || n.created_at)} · {new Date(n.createdAt || n.created_at).toLocaleString()}
                      </div>
                    </div>
                    {!n.isRead && (
                      <span style={{ width: 8, height: 8, borderRadius: "50%", background: "var(--accent)", flexShrink: 0, marginTop: 5 }} />
                    )}
                  </div>
                ))}
              </div>

              {hasMore && (
                <div style={{ textAlign: "center", marginTop: 16 }}>
                  <button className="btn btn-ghost" onClick={loadMore} disabled={loadingMore}>
                    {loadingMore ? "Loading…" : "Load more"}
                  </button>
                </div>
              )}
            </>
          )}
        </section>
      </div>
    </div>
  );
}
