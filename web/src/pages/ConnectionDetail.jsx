import { useCallback, useEffect, useState } from "react";
import { useNavigate, useParams, useSearchParams } from "react-router-dom";
import { apiFetch } from "../api/client.js";
import CredentialFields from "../components/CredentialFields.jsx";
import GithubAppWalkthrough from "../components/GithubAppWalkthrough.jsx";
import SeverityPill from "../components/SeverityPill.jsx";

const RUN_STATUS_COLOR = {
  success: "var(--green)",
  partial_failure: "var(--amber)",
  failed: "var(--red)",
  running: "var(--text3)",
};

function RotateCredentialModal({ connectionId, token, connectionAuthType, providerKey, providerAuthType, onClose, onRotated }) {
  const [authType, setAuthType] = useState(connectionAuthType || providerAuthType || "iam_role");
  const [roleArn, setRoleArn] = useState("");
  const [externalId, setExternalId] = useState("");
  const [accessKeyId, setAccessKeyId] = useState("");
  const [secretAccessKey, setSecretAccessKey] = useState("");
  const [sessionToken, setSessionToken] = useState("");
  const [clientId, setClientId] = useState("");
  const [clientSecret, setClientSecret] = useState("");
  const [error, setError] = useState("");
  const [submitting, setSubmitting] = useState(false);

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError("");
    setSubmitting(true);
    try {
      const secret = authType === "oauth2"
        ? { clientId, clientSecret }
        : authType === "iam_role" ? { externalId } : { accessKeyId, secretAccessKey, sessionToken: sessionToken || undefined };
      const updated = await apiFetch(`/api/integrations/${connectionId}/credentials`, {
        token, method: "POST",
        body: JSON.stringify({ authType, secret })
      });
      onRotated(updated);
    } catch (err) {
      setError(err.message);
    } finally {
      setSubmitting(false);
    }
  };

  // For GitHub, this modal opens straight into GithubAppWalkthrough — there's
  // no "not started yet" state the way the Add Integration wizard has — so
  // providerKey === "github" is true for the entire lifetime of this modal.
  // GithubAppWalkthrough renders its own <form> that posts to github.com;
  // nesting that inside a literal outer <form> here would always produce
  // invalid (and Playwright-ambiguous) nested <form> elements. So the outer
  // wrapper degrades to a plain <div> for github, matching the fix applied
  // to the wizard's WizardFormTag in IntegrationsSettings.jsx.
  const RotateFormTag = providerKey === "github" ? "div" : "form";

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal-box" onClick={e => e.stopPropagation()}>
        <div className="modal-title">Rotate credentials</div>
        <RotateFormTag onSubmit={RotateFormTag === "form" ? handleSubmit : undefined}>
          {error && <p className="error-text">{error}</p>}
          {providerKey === "github" ? (
            <GithubAppWalkthrough connectionId={connectionId} token={token} />
          ) : providerKey === "aws" ? (
            <div style={{ display: "flex", gap: 4, marginBottom: 12 }}>
              {["iam_role", "access_key"].map(t => (
                <button type="button" key={t}
                  className="btn btn-ghost"
                  style={{ fontWeight: authType === t ? 700 : 400, borderBottom: authType === t ? "2px solid var(--accent)" : "none" }}
                  onClick={() => setAuthType(t)}
                >
                  {t === "iam_role" ? "IAM Role" : "Access Keys"}
                </button>
              ))}
            </div>
          ) : null}
          {providerKey === "github" ? null : authType === "iam_role" ? (
            <div className="form-group">
              <label htmlFor="rotate-external-id">External ID</label>
              <input id="rotate-external-id" required value={externalId} onChange={e => setExternalId(e.target.value)} />
            </div>
          ) : authType === "oauth2" ? (
            <CredentialFields
              authType="oauth2"
              clientId={clientId} setClientId={setClientId}
              clientSecret={clientSecret} setClientSecret={setClientSecret}
            />
          ) : (
            <CredentialFields
              authType={authType}
              accessKeyId={accessKeyId} setAccessKeyId={setAccessKeyId}
              secretAccessKey={secretAccessKey} setSecretAccessKey={setSecretAccessKey}
              sessionToken={sessionToken} setSessionToken={setSessionToken}
            />
          )}
          <div style={{ display: "flex", gap: 8, marginTop: 20 }}>
            {providerKey !== "github" && (
              <button type="submit" className="btn btn-primary" disabled={submitting}>
                {submitting ? "Rotating…" : "Rotate"}
              </button>
            )}
            <button type="button" className="btn btn-ghost" onClick={onClose}>
              {providerKey === "github" ? "Close" : "Cancel"}
            </button>
          </div>
        </RotateFormTag>
      </div>
    </div>
  );
}

export default function ConnectionDetail({ token, user, company, onLogout, theme, onThemeToggle }) {
  const navigate = useNavigate();
  const { id } = useParams();
  const [searchParams] = useSearchParams();
  const isLeadOrAdmin = user?.role === "ADMIN" || user?.role === "LEAD";
  const [connection, setConnection] = useState(null);
  const [runs, setRuns] = useState([]);
  const [catalog, setCatalog] = useState([]);
  const [findings, setFindings] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [running, setRunning] = useState(false);
  const [showRotate, setShowRotate] = useState(false);
  const [githubInstallUrl, setGithubInstallUrl] = useState(null);

  const load = useCallback(async () => {
    const [connData, runsData, catalogData, findingsData] = await Promise.all([
      apiFetch(`/api/integrations/${id}`, { token }),
      apiFetch(`/api/integrations/${id}/runs`, { token }),
      apiFetch(`/api/integrations/catalog`, { token }),
      apiFetch(`/api/findings?connectionId=${id}`, { token }),
    ]);
    setConnection(connData);
    setRuns(runsData || []);
    setCatalog(catalogData || []);
    setFindings(findingsData || []);
  }, [token, id]);

  useEffect(() => {
    setLoading(true);
    load().catch(e => setError(e.message)).finally(() => setLoading(false));
  }, [load]);

  useEffect(() => {
    const installUrl = searchParams.get("githubInstallUrl");
    const githubError = searchParams.get("githubError");
    if (installUrl) {
      // The backend only ever produces install URLs on github.com
      // (https://github.com/apps/<slug>/installations/new?state=... or the
      // app's html_url, always on github.com). This param is otherwise fully
      // attacker-controlled via a crafted redirect link, so reject anything
      // that doesn't parse to exactly that origin rather than rendering it
      // as a raw <a href>.
      try {
        if (new URL(installUrl).origin === "https://github.com") {
          setGithubInstallUrl(installUrl);
        }
      } catch {
        // Malformed URL — ignore, treat as absent.
      }
    }
    if (githubError) setError(githubError);
    if (installUrl || githubError) navigate(`/settings/integrations/${id}`, { replace: true });
    // Only ever meant to run once, reading whatever GitHub's redirect put on
    // the URL at load time — not on every searchParams identity change.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handleRunNow = async () => {
    setError("");
    setRunning(true);
    try {
      await apiFetch(`/api/integrations/${id}/run`, { token, method: "POST" });
      await load();
    } catch (err) {
      setError(err.message);
    } finally {
      setRunning(false);
    }
  };

  const handleRevoke = async () => {
    const isFailed = connection?.status === "error";
    const confirmText = isFailed
      ? "Delete this connection? This failed connection attempt will be permanently removed."
      : "Revoke this connection? Its credentials will be permanently shredded.";
    if (!window.confirm(confirmText)) return;
    try {
      await apiFetch(`/api/integrations/${id}`, { token, method: "DELETE" });
      navigate("/settings/integrations");
    } catch (err) {
      setError(err.message);
    }
  };

  const handleRotated = async () => {
    setShowRotate(false);
    try {
      await load();
    } catch (err) {
      setError(err.message);
    }
  };

  if (loading) {
    return <div className="admin-container"><div className="admin-card"><p>Loading…</p></div></div>;
  }

  if (!connection) {
    return <div className="admin-container"><div className="admin-card"><p className="error-text">{error || "Connection not found"}</p></div></div>;
  }

  const matchingCatalogEntry = catalog.find(c => c.key === connection.integrationKey);

  return (
    <div className="admin-container">
      {showRotate && (
        <RotateCredentialModal
          connectionId={id}
          token={token}
          connectionAuthType={connection.authType}
          providerKey={connection.integrationKey}
          providerAuthType={matchingCatalogEntry?.authType}
          onClose={() => setShowRotate(false)}
          onRotated={handleRotated}
        />
      )}

      <div className="admin-card">
        <div className="admin-header">
          <div>
            <p className="admin-kicker">Connection detail</p>
            <h1>{connection.name}</h1>
            {company?.domain && <p className="admin-domain">{company.domain}</p>}
          </div>
          <div className="admin-actions">
            <button className="btn btn-ghost theme-toggle" onClick={onThemeToggle} title="Toggle theme">
              {theme === "dark" ? "☀" : "☾"}
            </button>
            <button className="btn btn-ghost" onClick={() => navigate("/settings/integrations")}>Back</button>
            <button className="btn btn-ghost" onClick={onLogout}>Logout</button>
          </div>
        </div>

        {error && <p className="error-text">{error}</p>}

        <section className="admin-section">
          {githubInstallUrl && (
            <div style={{ marginBottom: 16, padding: 12, background: "var(--bg2)", borderRadius: 8, border: "1px solid var(--border2)" }}>
              <p style={{ fontSize: 13, margin: "0 0 8px" }}>The GitHub App was created. Install it on your organization to finish connecting. Only an organization Owner can complete this step.</p>
              <a href={githubInstallUrl} className="btn btn-primary">Install the App</a>
            </div>
          )}
          <div style={{ display: "flex", gap: 24, flexWrap: "wrap" }}>
            <div>
              <div style={{ fontSize: 11, color: "var(--text3)", textTransform: "uppercase" }}>Status</div>
              <div style={{ fontWeight: 600 }}>{connection.status}</div>
            </div>
            <div>
              <div style={{ fontSize: 11, color: "var(--text3)", textTransform: "uppercase" }}>Last run</div>
              <div style={{ fontWeight: 600 }}>
                {connection.lastRunAt ? new Date(connection.lastRunAt).toLocaleString() : "Never"}
                {connection.lastRunStatus && <span style={{ marginLeft: 6, color: RUN_STATUS_COLOR[connection.lastRunStatus] || "var(--text3)" }}>({connection.lastRunStatus})</span>}
              </div>
            </div>
          </div>
          {isLeadOrAdmin && (
            <div style={{ display: "flex", gap: 8, marginTop: 16 }}>
              <button className="btn btn-primary" disabled={running} onClick={handleRunNow}>
                {running ? "Running…" : "Run Now"}
              </button>
              <button className="btn btn-ghost" onClick={() => setShowRotate(true)}>Rotate credentials</button>
              <button className="btn btn-ghost" style={{ color: "var(--red)" }} onClick={handleRevoke}>
                {connection.status === "error" ? "Delete" : "Revoke"}
              </button>
            </div>
          )}
        </section>

        <section className="admin-section">
          <h2>Collection history</h2>
          <div className="admin-table">
            <div className="admin-row admin-row-header" style={{ gridTemplateColumns: "1fr 1fr 1fr 1fr 1fr" }}>
              <span>Started</span>
              <span>Trigger</span>
              <span>Status</span>
              <span>Passed</span>
              <span>Failed</span>
            </div>
            {runs.length === 0 && (
              <div className="admin-row admin-row-empty"><span>No collection runs yet.</span></div>
            )}
            {runs.map(r => (
              <div key={r.id} className="admin-row" style={{ gridTemplateColumns: "1fr 1fr 1fr 1fr 1fr" }}>
                <span style={{ fontSize: 12 }}>{new Date(r.startedAt).toLocaleString()}</span>
                <span style={{ fontSize: 12, color: "var(--text3)" }}>{r.triggerType}</span>
                <span style={{ fontSize: 12, fontWeight: 600, color: RUN_STATUS_COLOR[r.status] || "var(--text3)" }}>{r.status}</span>
                <span style={{ fontSize: 12, color: "var(--green)" }}>{r.testsPassed}</span>
                <span style={{ fontSize: 12, color: r.testsFailed > 0 ? "var(--red)" : "var(--text3)" }}>{r.testsFailed}</span>
              </div>
            ))}
          </div>
        </section>

        <section className="admin-section">
          <h2>Findings</h2>
          <div className="admin-table finding-table">
            <div className="admin-row admin-row-header">
              <span>Finding</span>
              <span>Severity</span>
              <span>Status</span>
            </div>
            {findings.length === 0 && (
              <div className="admin-row admin-row-empty"><span>No findings for this connection yet.</span></div>
            )}
            {findings.map(f => (
              <div key={f.id} className="admin-row finding-row">
                <span>
                  <div className="finding-title">{f.title}</div>
                  {f.resourceId && <div className="finding-resource">{f.resourceId}</div>}
                </span>
                <span><SeverityPill severity={f.severity} /></span>
                <span className="finding-status">{String(f.status || "").replace(/_/g, " ")}</span>
              </div>
            ))}
          </div>
        </section>
      </div>
    </div>
  );
}
