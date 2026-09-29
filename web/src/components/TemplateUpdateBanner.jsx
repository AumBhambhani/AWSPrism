import { useCallback, useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { apiFetch } from "../api/client.js";

// Tells the company admin a new version of one of their framework question
// sheets is available. Purely informational — dismissing just hides it for
// this session; the notice stays pending server-side until they actually
// review and apply or dismiss it on the review screen.
export default function TemplateUpdateBanner({ token }) {
  const [notices, setNotices] = useState([]);
  const [hidden, setHidden] = useState(false);
  const navigate = useNavigate();

  const load = useCallback(async () => {
    if (!token) return;
    try {
      const data = await apiFetch("/api/frameworks/template-updates", { token });
      setNotices(Array.isArray(data) ? data : []);
    } catch {
      /* silent — this is a passive notice, not a page the user is waiting on */
    }
  }, [token]);

  useEffect(() => {
    load();
    const interval = setInterval(load, 60000);
    return () => clearInterval(interval);
  }, [load]);

  if (hidden || notices.length === 0) return null;

  const first = notices[0];
  const target = notices.length === 1 ? `/template-updates/${first.id}` : "/template-updates";

  return (
    <div
      style={{
        position: "fixed", top: 0, left: 0, right: 0, zIndex: 9400,
        background: "#4F46E5", color: "#fff", fontSize: 12.5, fontWeight: 600,
        textAlign: "center", padding: "6px 40px", display: "flex",
        alignItems: "center", justifyContent: "center", gap: 10, flexWrap: "wrap",
      }}
    >
      <span>
        {notices.length === 1
          ? `A new version of "${first.templateName}" is available (v${first.toVersion}).`
          : `${notices.length} template updates are available for review.`}
      </span>
      <button
        onClick={() => navigate(target)}
        style={{
          background: "rgba(255,255,255,0.18)", border: "1px solid rgba(255,255,255,0.35)",
          color: "#fff", borderRadius: 5, padding: "2px 10px", fontSize: 11.5, fontWeight: 600, cursor: "pointer",
        }}
      >
        Review changes
      </button>
      <button
        onClick={() => setHidden(true)}
        aria-label="Dismiss"
        title="Hide for now — you can still review it later"
        style={{
          position: "absolute", right: 10, top: "50%", transform: "translateY(-50%)",
          background: "none", border: "none", color: "#fff", cursor: "pointer", fontSize: 15, lineHeight: 1, opacity: 0.85,
        }}
      >
        ×
      </button>
    </div>
  );
}
