import { useState, useEffect, useCallback } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { apiFetch, apiUpload } from "../api/client.js";
import GlassSelect from "../components/GlassSelect.jsx";

const FACET_LABEL = {
  IMPLEMENTED: "implemented", EVIDENCE: "evidence", REVIEWED: "reviewed",
  MATURITY: "maturity", OTHER: "other",
};

function StatusChip({ status }) {
  return <span className={`fir-chip fir-chip-${(status || "").toLowerCase()}`}>{status}</span>;
}

// ─── Batch list ──────────────────────────────────────────────────────────────

function BatchList({ token }) {
  const navigate = useNavigate();
  const [batches, setBatches] = useState([]);
  const [frameworks, setFrameworks] = useState([]);
  const [loading, setLoading] = useState(true);
  const [file, setFile] = useState(null);
  const [frameworkKey, setFrameworkKey] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [b, f] = await Promise.all([
        apiFetch("/api/frameworks/import/batches", { token }),
        apiFetch("/api/frameworks", { token }),
      ]);
      setBatches(b || []);
      setFrameworks(f || []);
    } catch (e) {
      setError(e.message || "Failed to load batches");
    } finally {
      setLoading(false);
    }
  }, [token]);

  useEffect(() => { load(); }, [load]);

  const upload = async () => {
    if (!file) return;
    setBusy(true);
    setError(null);
    try {
      const body = frameworkKey ? { frameworkKey } : {};
      const res = await apiUpload("/api/frameworks/import/batches", file, body, token);
      navigate(`/superadmin/framework-import/${res.batchId}`);
    } catch (e) {
      setError(e.message || "Upload failed");
    } finally {
      setBusy(false);
    }
  };

  const reconcile = async () => {
    setBusy(true);
    setError(null);
    try {
      const res = await apiFetch("/api/frameworks/reconcile", { token, method: "POST", body: "{}" });
      navigate(`/superadmin/framework-import/${res.batchId}`);
    } catch (e) {
      setError(e.message || "Reconcile failed");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="fir-wrap">
      <div className="fir-head">
        <h2>Framework Import & Review</h2>
        <button className="btn" onClick={() => navigate("/superadmin")}>← Super Admin</button>
      </div>

      <div className="fir-card fir-upload">
        <h3>New framework sheet</h3>
        <input type="file" accept=".xlsx" onChange={(e) => setFile(e.target.files[0] || null)} />
        <GlassSelect
          value={frameworkKey}
          onChange={val => setFrameworkKey(val)}
          options={[
            { value: "", label: "— Detect framework from filename —" },
            ...frameworks.map(f => ({ value: f.key, label: f.name }))
          ]}
          style={{ minWidth: 260 }}
        />
        <button className="btn btn-primary" disabled={!file || busy} onClick={upload}>
          {busy ? "Uploading…" : "Create review batch"}
        </button>
        <button className="btn" disabled={busy} onClick={reconcile} title="Bulk-merge every existing framework template into one canonical set">
          Reconcile existing templates
        </button>
      </div>

      {error && <div className="fir-error">{error}</div>}

      {loading ? <p>Loading…</p> : (
        <table className="fir-table">
          <thead>
            <tr><th>#</th><th>Framework</th><th>Source</th><th>Status</th><th>Progress</th><th>Created</th></tr>
          </thead>
          <tbody>
            {batches.length === 0 && <tr><td colSpan={6} className="fir-muted">No batches yet.</td></tr>}
            {batches.map((b) => (
              <tr key={b.id} className="fir-row" onClick={() => navigate(`/superadmin/framework-import/${b.id}`)}>
                <td>{b.id}</td>
                <td>{b.primaryFrameworkKey || b.kind}</td>
                <td className="fir-muted">{b.sourceFileName || "—"}</td>
                <td><StatusChip status={b.status} /></td>
                <td>{b.clusterCount ? `${b.decidedCount}/${b.clusterCount} decided` : "—"}</td>
                <td className="fir-muted">{new Date(b.createdAt).toLocaleString()}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}

// ─── Cluster review ──────────────────────────────────────────────────────────

function ClusterCard({ batchId, token, cluster, onDecided }) {
  const [action, setAction] = useState(cluster.decidedAction || cluster.proposedAction);
  const [canonical, setCanonical] = useState(cluster.decidedCanonicalQuestion || cluster.proposedCanonicalQuestion || "");
  const [level3, setLevel3] = useState(cluster.decidedLevel3 || cluster.proposedLevel3 || "");
  const [existingQuestId, setExistingQuestId] = useState(cluster.existingQuestId || "");
  const [saving, setSaving] = useState(false);
  useEffect(() => {
    setAction(cluster.decidedAction || cluster.proposedAction);
    setCanonical(cluster.decidedCanonicalQuestion || cluster.proposedCanonicalQuestion || "");
    setLevel3(cluster.decidedLevel3 || cluster.proposedLevel3 || "");
    setExistingQuestId(cluster.existingQuestId || "");
  }, [cluster]);

  const members = cluster.members || [];
  const decide = async (decision) => {
    setSaving(true);
    try {
      await apiFetch(`/api/frameworks/import/batches/${batchId}/clusters/${cluster.id}`, {
        token, method: "PATCH",
        body: JSON.stringify({
          decision,
          action,
          canonicalQuestion: canonical,
          level3,
          existingQuestId: action === "MERGE_INTO_EXISTING" ? existingQuestId : null,
        }),
      });
      onDecided();
    } finally {
      setSaving(false);
    }
  };

  const conf = cluster.aiConfidence != null ? Math.round(Number(cluster.aiConfidence) * 100) : null;

  return (
    <div className={`fir-cluster ${cluster.decision ? `fir-decided fir-${cluster.decision.toLowerCase()}` : ""}`}>
      <div className="fir-cluster-pane fir-incoming">
        <div className="fir-cluster-meta">
          <span className={`fir-badge fir-badge-${(cluster.proposedAction || "").toLowerCase()}`}>{cluster.proposedAction}</span>
          {conf != null && <span className="fir-conf"><span className="fir-conf-bar" style={{ width: `${conf}%` }} />{conf}%</span>}
          {cluster.decision && <StatusChip status={cluster.decision} />}
        </div>
        {cluster.aiRationale && <p className="fir-rationale">{cluster.aiRationale}</p>}
        {members.map((m) => (
          <div key={m.id} className="fir-member">
            <div className="fir-member-head">
              <span className="fir-facet">{FACET_LABEL[m.facet] || m.facet}</span>
              <span className="fir-ref">{m.frameworkKey} · {m.controlReferenceRaw || m.controlReference || "—"}</span>
            </div>
            <div className="fir-member-area">{m.controlArea}</div>
            <div className="fir-member-q">{m.baselineQuestion}</div>
          </div>
        ))}
      </div>

      <div className="fir-cluster-pane fir-canonical">
        <label>Action
          <GlassSelect
            value={action}
            onChange={val => setAction(val)}
            options={[
              { value: "NEW_CANONICAL", label: "New canonical question" },
              { value: "MERGE_INTO_EXISTING", label: "Merge into existing" },
              { value: "KEEP_SEPARATE", label: "Keep separate" },
            ]}
            style={{ width: "100%", marginTop: 6 }}
          />
        </label>
        {action === "MERGE_INTO_EXISTING" && (
          <label>Existing canonical quest_id
            <input value={existingQuestId} onChange={(e) => setExistingQuestId(e.target.value)}
              placeholder={cluster.existing ? cluster.existing.questId : "e.g. GDPR-Q001"} />
          </label>
        )}
        {cluster.existing && (
          <p className="fir-existing">
            Matches <strong>{cluster.existing.questId}</strong>
            {cluster.existing.frameworks?.length
              ? ` — mapped to ${cluster.existing.frameworks.map((f) => f.key).join(", ")}` : ""}
          </p>
        )}
        <label>Canonical question
          <textarea rows={3} value={canonical} onChange={(e) => setCanonical(e.target.value)} />
        </label>
        <label>Level 3 criteria
          <textarea rows={3} value={level3} onChange={(e) => setLevel3(e.target.value)} />
        </label>
        <div className="fir-decide">
          <button className="btn btn-primary" disabled={saving} onClick={() => decide("ACCEPT")}>Accept</button>
          <button className="btn" disabled={saving} onClick={() => decide("MODIFIED")}>Save changes</button>
          <button className="btn btn-danger" disabled={saving} onClick={() => decide("REJECT")}>Skip</button>
        </div>
      </div>
    </div>
  );
}

function BatchReview({ token, batchId }) {
  const navigate = useNavigate();
  const [data, setData] = useState(null);
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);
  const [summary, setSummary] = useState(null);

  const load = useCallback(async () => {
    try {
      setData(await apiFetch(`/api/frameworks/import/batches/${batchId}`, { token }));
    } catch (e) {
      setError(e.message || "Failed to load batch");
    }
  }, [token, batchId]);

  useEffect(() => { load(); }, [load]);

  const runCluster = async () => {
    setBusy(true);
    setError(null);
    try {
      await apiFetch(`/api/frameworks/import/batches/${batchId}/cluster`, { token, method: "POST", timeout: 120000 });
      await load();
    } catch (e) {
      setError(e.message || "Clustering failed");
    } finally {
      setBusy(false);
    }
  };

  const commit = async () => {
    setBusy(true);
    setError(null);
    try {
      const res = await apiFetch(`/api/frameworks/import/batches/${batchId}/commit`, { token, method: "POST", timeout: 120000 });
      setSummary(res.summary);
      await load();
    } catch (e) {
      setError(e.message || "Commit failed");
    } finally {
      setBusy(false);
    }
  };

  if (error) return <div className="fir-wrap"><div className="fir-error">{error}</div></div>;
  if (!data) return <div className="fir-wrap"><p>Loading…</p></div>;

  const { batch, clusters } = data;
  const decided = clusters.filter((c) => c.decision).length;
  const allDecided = clusters.length > 0 && decided === clusters.length;
  const stats = batch.rawStats || {};

  return (
    <div className="fir-wrap">
      <div className="fir-head">
        <h2>{batch.primaryFrameworkKey || batch.kind} — batch #{batch.id} <StatusChip status={batch.status} /></h2>
        <button className="btn" onClick={() => navigate("/superadmin/framework-import")}>← All batches</button>
      </div>

      {stats.rows != null && (
        <p className="fir-muted">
          {stats.rows} rows → {stats.controls} controls · {stats.modules} modules
          {stats.parseErrors?.length ? ` · ${stats.parseErrors.length} parse errors` : ""}
        </p>
      )}

      {batch.status === "STAGED" && (
        <button className="btn btn-primary" disabled={busy} onClick={runCluster}>
          {busy ? "Clustering…" : "Run AI clustering"}
        </button>
      )}

      {batch.status === "COMMITTED" && (
        <div className="fir-success">
          Committed{summary ? ` — ${summary.canonicalCreated} new canonical, ${summary.merged} merged, ${summary.mappings} mappings, ${summary.skipped} skipped` : ""}.
        </div>
      )}

      {(batch.status === "REVIEW" || batch.status === "COMMITTED") && (
        <>
          <div className="fir-progress">{decided}/{clusters.length} clusters decided</div>
          {clusters.map((c) => (
            <ClusterCard key={c.id} batchId={batchId} token={token} cluster={c} onDecided={load} />
          ))}
          {batch.status === "REVIEW" && (
            <div className="fir-commitbar">
              <button className="btn btn-primary" disabled={!allDecided || busy} onClick={commit}>
                {busy ? "Committing…" : `Commit ${clusters.length} clusters`}
              </button>
              {!allDecided && <span className="fir-muted">Decide every cluster to enable commit.</span>}
            </div>
          )}
        </>
      )}
    </div>
  );
}

export default function FrameworkImportReview({ token }) {
  const { batchId } = useParams();
  return batchId ? <BatchReview token={token} batchId={batchId} /> : <BatchList token={token} />;
}
