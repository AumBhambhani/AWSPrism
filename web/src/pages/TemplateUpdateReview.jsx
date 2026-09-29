import { useState, useEffect, useCallback } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { apiFetch } from "../api/client.js";

function LockedBadge({ locked }) {
  if (!locked) return null;
  const isAudited = locked === "AUDITED";
  return (
    <span
      title={isAudited ? "This answer has been audited — the underlying question text will still change if you apply." : "This answer is already reviewed — the underlying question text will still change if you apply."}
      style={{
        marginLeft: 8, fontSize: 10, fontWeight: 700, padding: "2px 6px", borderRadius: 4,
        background: isAudited ? "color-mix(in srgb, var(--green) 18%, transparent)" : "color-mix(in srgb, var(--amber) 18%, transparent)",
        color: isAudited ? "var(--green)" : "var(--amber)",
      }}
    >
      {locked}
    </span>
  );
}

// ─── Pending notices list ──────────────────────────────────────────────────

function NoticeList({ token }) {
  const navigate = useNavigate();
  const [notices, setNotices] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  useEffect(() => {
    (async () => {
      try {
        const data = await apiFetch("/api/frameworks/template-updates?all=true", { token });
        setNotices(data || []);
      } catch (e) {
        setError(e.message || "Failed to load template updates");
      } finally {
        setLoading(false);
      }
    })();
  }, [token]);

  const pending = notices.filter((n) => n.status === "pending");
  const history = notices.filter((n) => n.status !== "pending");

  const table = (rows) => (
    <table className="fir-table">
      <thead>
        <tr><th>Template</th><th>Framework</th><th>Version</th><th>Status</th><th>Created</th></tr>
      </thead>
      <tbody>
        {rows.map((n) => (
          <tr key={n.id} className="fir-row" onClick={() => navigate(`/template-updates/${n.id}`)}>
            <td>{n.templateName}</td>
            <td className="fir-muted">{n.frameworkKey}</td>
            <td>v{n.fromVersion} → v{n.toVersion}</td>
            <td><span className={`fir-chip fir-chip-${n.status === "applied" ? "committed" : n.status === "dismissed" ? "abandoned" : "review"}`}>{n.status}</span></td>
            <td className="fir-muted">{new Date(n.createdAt).toLocaleString()}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );

  return (
    <div className="fir-wrap">
      <div className="fir-head">
        <h2>Template Updates</h2>
        <button className="btn" onClick={() => navigate(-1)}>← Back</button>
      </div>
      {error && <div className="fir-error">{error}</div>}
      {loading ? <p className="fir-muted">Loading…</p> : (
        <>
          <h3 style={{ fontSize: 13, margin: "0 0 10px" }}>Pending</h3>
          {pending.length === 0 ? <p className="fir-muted">Nothing pending.</p> : table(pending)}
          <h3 style={{ fontSize: 13, margin: "20px 0 10px" }}>History</h3>
          {history.length === 0 ? <p className="fir-muted">No past updates yet.</p> : table(history)}
        </>
      )}
    </div>
  );
}

// ─── One notice's diff, with Apply / Dismiss ───────────────────────────────

function NoticeDetail({ token, noticeId }) {
  const navigate = useNavigate();
  const [diff, setDiff] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);
  const [outcome, setOutcome] = useState(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const data = await apiFetch(`/api/frameworks/template-updates/${noticeId}`, { token });
      setDiff(data);
    } catch (e) {
      setError(e.message || "Failed to load this update");
    } finally {
      setLoading(false);
    }
  }, [token, noticeId]);

  useEffect(() => { load(); }, [load]);

  const apply = async () => {
    setBusy(true);
    setError(null);
    try {
      const res = await apiFetch(`/api/frameworks/template-updates/${noticeId}/apply`, { token, method: "POST" });
      setOutcome({ type: "applied", toVersion: res.toVersion });
    } catch (e) {
      setError(e.message || "Failed to apply this update");
    } finally {
      setBusy(false);
    }
  };

  const dismiss = async () => {
    setBusy(true);
    setError(null);
    try {
      await apiFetch(`/api/frameworks/template-updates/${noticeId}/dismiss`, { token, method: "POST" });
      setOutcome({ type: "dismissed" });
    } catch (e) {
      setError(e.message || "Failed to dismiss this update");
    } finally {
      setBusy(false);
    }
  };

  if (loading) return <div className="fir-wrap"><p className="fir-muted">Loading…</p></div>;
  if (error && !diff) return (
    <div className="fir-wrap">
      <div className="fir-error">{error}</div>
      <button className="btn" onClick={() => navigate("/template-updates", { replace: true })}>← Back to updates</button>
    </div>
  );
  if (!diff) return null;

  // Either just resolved in this session, or reopened later (a history link) —
  // same read-only outcome view either way, no re-triggering apply/dismiss.
  const resolved = outcome || (diff.status !== "pending"
    ? { type: diff.status === "applied" ? "applied" : "dismissed", toVersion: diff.toVersion }
    : null);

  if (resolved) {
    return (
      <div className="fir-wrap">
        <div className="fir-head"><h2>{diff.templateName}</h2></div>
        <div className="fir-success">
          {resolved.type === "applied"
            ? `Applied — you're now on v${resolved.toVersion}. Answers you already had carried over onto the updated questions.`
            : "Dismissed. You're staying on your current version — you can act on a future update any time it's published."}
        </div>
        <button className="btn btn-primary" onClick={() => navigate("/template-updates", { replace: true })}>Back to updates</button>
      </div>
    );
  }

  const s = diff.summary || {};
  const anyLocked = [...(diff.reworded || []), ...(diff.renamed || []), ...(diff.removed || [])]
    .some((e) => e.locked);

  return (
    <div className="fir-wrap">
      <div className="fir-head">
        <h2>{diff.templateName} <span className="fir-muted" style={{ fontSize: 14, fontWeight: 400 }}>({diff.frameworkKey})</span></h2>
        <button className="btn" onClick={() => navigate(-1)}>← Back</button>
      </div>

      <div className="fir-card">
        <p style={{ margin: "0 0 10px", fontSize: 14 }}>
          Reviewing the change from <strong>v{diff.fromVersion}</strong> to <strong>v{diff.toVersion}</strong>.
          Nothing is applied until you choose below — you can also dismiss and act on this later.
        </p>
        <div style={{ display: "flex", gap: 16, flexWrap: "wrap", fontSize: 13 }}>
          <span>{s.unchanged ?? 0} unchanged</span>
          <span style={{ color: "var(--amber)" }}>{s.reworded ?? 0} reworded</span>
          <span style={{ color: "var(--accent)" }}>{s.renamed ?? 0} renamed</span>
          <span style={{ color: "var(--green)" }}>{s.added ?? 0} added</span>
          <span style={{ color: "var(--red)" }}>{s.removed ?? 0} removed</span>
        </div>
        {anyLocked && (
          <p style={{ margin: "10px 0 0", fontSize: 12, color: "var(--amber)" }}>
            ⚠ Some affected questions already have a reviewed or audited answer — see the <LockedBadge locked="AUDITED" /> / <LockedBadge locked="FINISHED" /> tags below. Applying still updates the question text under them.
          </p>
        )}
      </div>

      {diff.reworded?.length > 0 && (
        <div className="fir-card">
          <h3 style={{ fontSize: 13, margin: "0 0 10px" }}>Reworded — your answer carries over</h3>
          {diff.reworded.map((r) => (
            <div key={r.questId} className="fir-member">
              <div className="fir-member-head">
                <span className="fir-ref">{r.questId}</span>
                <span>
                  {r.textChanged && <span className="fir-badge fir-badge-new_canonical" style={{ marginRight: 6 }}>text</span>}
                  {r.isoChanged && <span className="fir-badge fir-badge-merge_into_existing">clause</span>}
                  <LockedBadge locked={r.locked} />
                </span>
              </div>
              {r.textChanged && (
                <>
                  <div className="fir-member-q" style={{ textDecoration: "line-through", opacity: 0.6 }}>{r.oldText}</div>
                  <div className="fir-member-q">{r.newText}</div>
                </>
              )}
              {r.isoChanged && (
                <div className="fir-member-q">
                  Clause: <span style={{ textDecoration: "line-through", opacity: 0.6 }}>{r.oldIso || "—"}</span>
                  {" → "}<strong>{r.newIso || "—"}</strong>
                </div>
              )}
            </div>
          ))}
        </div>
      )}

      {diff.renamed?.length > 0 && (
        <div className="fir-card">
          <h3 style={{ fontSize: 13, margin: "0 0 10px" }}>Renamed — same question, new id (your answer carries over)</h3>
          {diff.renamed.map((r) => (
            <div key={r.oldQuestId} className="fir-member">
              <div className="fir-member-head">
                <span className="fir-ref">{r.oldQuestId} → {r.newQuestId}</span>
                <span>
                  <span className="fir-muted" style={{ fontSize: 11 }}>{Math.round(r.similarity * 100)}% match</span>
                  <LockedBadge locked={r.locked} />
                </span>
              </div>
              <div className="fir-member-q">{r.text}</div>
              {r.oldIso !== r.newIso && (
                <div className="fir-member-q fir-muted" style={{ fontSize: 11 }}>
                  Clause: {r.oldIso || "—"} → {r.newIso || "—"}
                </div>
              )}
            </div>
          ))}
        </div>
      )}

      {diff.added?.length > 0 && (
        <div className="fir-card">
          <h3 style={{ fontSize: 13, margin: "0 0 10px" }}>Added — new, unanswered</h3>
          {diff.added.map((a) => (
            <div key={a.questId} className="fir-member">
              <div className="fir-member-head"><span className="fir-ref">{a.questId}</span></div>
              <div className="fir-member-q">{a.text}</div>
            </div>
          ))}
        </div>
      )}

      {diff.removed?.length > 0 && (
        <div className="fir-card">
          <h3 style={{ fontSize: 13, margin: "0 0 10px" }}>Removed — dropped from your tracker (kept in history, not deleted)</h3>
          {diff.removed.map((r) => (
            <div key={r.questId} className="fir-member">
              <div className="fir-member-head"><span className="fir-ref">{r.questId}</span><LockedBadge locked={r.locked} /></div>
              <div className="fir-member-q">{r.text}</div>
            </div>
          ))}
        </div>
      )}

      {error && <div className="fir-error">{error}</div>}

      <div className="fir-decide" style={{ marginTop: 8 }}>
        <button className="btn btn-primary" disabled={busy} onClick={apply}>{busy ? "Applying…" : "Apply update"}</button>
        <button className="btn" disabled={busy} onClick={dismiss}>Dismiss for now</button>
      </div>
    </div>
  );
}

export default function TemplateUpdateReview({ token }) {
  const { noticeId } = useParams();
  return noticeId ? <NoticeDetail token={token} noticeId={noticeId} /> : <NoticeList token={token} />;
}
