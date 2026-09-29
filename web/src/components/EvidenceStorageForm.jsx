import { useEffect, useState } from "react";
import { apiFetch } from "../api/client.js";

// Shared UI for choosing where a company's evidence files are stored. Used both
// in onboarding (embedded, inside the dark setup modal) and in Admin → Evidence
// Storage. All styling uses the app's CSS custom properties so it adapts to the
// active theme.

const OPTIONS = [
  {
    key: "local",
    title: "PRISM-managed storage",
    desc: "Files are stored securely on PRISM infrastructure. Nothing to configure — this is the default.",
  },
  {
    key: "s3",
    title: "Amazon S3",
    desc: "Keep every evidence file in your own S3 bucket. PRISM streams files in and out; you keep custody.",
  },
  {
    key: "azure_blob",
    title: "Azure Blob Storage",
    desc: "Keep every evidence file in your own Azure Blob container using a storage connection string.",
  },
];

const field = {
  width: "100%", padding: "8px 10px", borderRadius: 6, fontSize: 13,
  border: "1px solid var(--border2)", background: "var(--bg3)", color: "var(--text)", outline: "none",
};
const label = { fontSize: 11, fontWeight: 600, color: "var(--text2)", marginBottom: 4, display: "block" };

export default function EvidenceStorageForm({ token, onSaved, embedded = false }) {
  const [loading, setLoading] = useState(true);
  const [current, setCurrent] = useState(null);
  const [backend, setBackend] = useState("local");
  const [authType, setAuthType] = useState("access_key");
  const [cfg, setCfg] = useState({ bucket: "", region: "", prefix: "", roleArn: "", container: "" });
  const [secret, setSecret] = useState({ accessKeyId: "", secretAccessKey: "", externalId: "", connectionString: "" });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [okMsg, setOkMsg] = useState("");

  const refresh = () => {
    setLoading(true);
    apiFetch("/api/settings/evidence-storage", { token })
      .then((d) => {
        setCurrent(d);
        setBackend(d.backend || "local");
        if (d.authType) setAuthType(d.authType === "connection_string" ? "access_key" : d.authType);
        setCfg((c) => ({ ...c, ...(d.config || {}) }));
      })
      .catch((e) => setError(e.message || "Failed to load storage settings"))
      .finally(() => setLoading(false));
  };
  useEffect(refresh, [token]);

  const save = async () => {
    setSaving(true); setError(""); setOkMsg("");
    try {
      const body = { backend };
      if (backend === "s3") {
        body.authType = authType;
        body.config = { bucket: cfg.bucket.trim(), region: cfg.region.trim() };
        if (cfg.prefix.trim()) body.config.prefix = cfg.prefix.trim();
        if (authType === "iam_role") {
          body.config.roleArn = cfg.roleArn.trim();
          body.secret = { externalId: secret.externalId.trim() };
        } else {
          body.secret = { accessKeyId: secret.accessKeyId.trim(), secretAccessKey: secret.secretAccessKey.trim() };
        }
      } else if (backend === "azure_blob") {
        body.config = { container: cfg.container.trim() };
        body.secret = { connectionString: secret.connectionString.trim() };
      }
      const res = await apiFetch("/api/settings/evidence-storage", { token, method: "PUT", body: JSON.stringify(body) });
      setOkMsg(res.migrating
        ? "Saved. Existing evidence files are now migrating in the background."
        : "Evidence storage updated.");
      setSecret({ accessKeyId: "", secretAccessKey: "", externalId: "", connectionString: "" });
      refresh();
      onSaved?.(res);
    } catch (e) {
      setError(e.message || "Could not save storage settings");
    } finally {
      setSaving(false);
    }
  };

  const retry = async () => {
    setSaving(true); setError(""); setOkMsg("");
    try {
      await apiFetch("/api/settings/evidence-storage/retry-migration", { token, method: "POST", body: "{}" });
      setOkMsg("Migration restarted.");
      refresh();
    } catch (e) {
      setError(e.message || "Could not retry migration");
    } finally {
      setSaving(false);
    }
  };

  if (loading) return <p style={{ fontSize: 13, color: "var(--text3)" }}>Loading…</p>;

  const migrationStatus = current?.migrationStatus;
  const dirty = backend !== current?.backend || backend !== "local";

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
      {migrationStatus === "in_progress" && (
        <div style={{ fontSize: 12, padding: "10px 12px", borderRadius: 8, background: "rgba(245,158,11,0.1)", color: "#f59e0b" }}>
          Migrating evidence files to <strong>{current.backend}</strong>… you can keep working; this can take a while for large vaults.
          <button onClick={retry} disabled={saving} style={{ marginLeft: 6, background: "none", border: "none", color: "var(--accent)", cursor: "pointer", fontWeight: 600 }}>
            Resume migration
          </button>
        </div>
      )}
      {migrationStatus === "failed" && (
        <div style={{ fontSize: 12, padding: "10px 12px", borderRadius: 8, background: "rgba(239,68,68,0.1)", color: "#ef4444" }}>
          The last storage migration did not finish{current.migrationError ? `: ${current.migrationError}` : "."}{" "}
          <button onClick={retry} disabled={saving} style={{ marginLeft: 6, background: "none", border: "none", color: "var(--accent)", cursor: "pointer", fontWeight: 600 }}>
            Retry migration
          </button>
        </div>
      )}

      <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
        {OPTIONS.map((o) => {
          const selected = backend === o.key;
          return (
            <button
              key={o.key}
              type="button"
              onClick={() => setBackend(o.key)}
              disabled={migrationStatus === "in_progress"}
              style={{
                textAlign: "left", padding: "12px 14px", borderRadius: 10, cursor: "pointer",
                border: `1px solid ${selected ? "var(--accent)" : "var(--border2)"}`,
                background: selected ? "rgba(99,102,241,0.08)" : "var(--bg2)",
              }}
            >
              <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                <span style={{
                  width: 14, height: 14, borderRadius: "50%", flexShrink: 0,
                  border: `4px solid ${selected ? "var(--accent)" : "var(--border2)"}`,
                  background: "var(--bg)",
                }} />
                <span style={{ fontSize: 13, fontWeight: 700, color: "var(--text)" }}>{o.title}</span>
                {current?.backend === o.key && (
                  <span style={{ fontSize: 10, color: "var(--text3)", border: "1px solid var(--border2)", borderRadius: 10, padding: "1px 6px" }}>current</span>
                )}
              </div>
              <div style={{ fontSize: 11, color: "var(--text3)", marginTop: 4, marginLeft: 22, lineHeight: 1.5 }}>{o.desc}</div>
            </button>
          );
        })}
      </div>

      {backend === "s3" && (
        <div style={{ display: "flex", flexDirection: "column", gap: 10, padding: "12px 14px", borderRadius: 10, background: "var(--bg3)", border: "1px solid var(--border2)" }}>
          <div style={{ display: "flex", gap: 8 }}>
            {["access_key", "iam_role"].map((t) => (
              <button key={t} type="button" onClick={() => setAuthType(t)} style={{
                flex: 1, padding: "7px 0", fontSize: 12, fontWeight: 600, borderRadius: 6, cursor: "pointer",
                border: `1px solid ${authType === t ? "var(--accent)" : "var(--border2)"}`,
                background: authType === t ? "rgba(99,102,241,0.08)" : "var(--bg2)", color: "var(--text)",
              }}>
                {t === "access_key" ? "Access keys" : "IAM role"}
              </button>
            ))}
          </div>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
            <div><label style={label}>Bucket</label><input style={field} value={cfg.bucket} onChange={(e) => setCfg({ ...cfg, bucket: e.target.value })} placeholder="my-evidence-bucket" /></div>
            <div><label style={label}>Region</label><input style={field} value={cfg.region} onChange={(e) => setCfg({ ...cfg, region: e.target.value })} placeholder="eu-north-1" /></div>
          </div>
          <div><label style={label}>Key prefix (optional)</label><input style={field} value={cfg.prefix} onChange={(e) => setCfg({ ...cfg, prefix: e.target.value })} placeholder="prism/" /></div>
          {authType === "access_key" ? (
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
              <div><label style={label}>Access key ID</label><input style={field} value={secret.accessKeyId} onChange={(e) => setSecret({ ...secret, accessKeyId: e.target.value })} autoComplete="off" /></div>
              <div><label style={label}>Secret access key</label><input style={field} type="password" value={secret.secretAccessKey} onChange={(e) => setSecret({ ...secret, secretAccessKey: e.target.value })} autoComplete="off" /></div>
            </div>
          ) : (
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
              <div><label style={label}>Role ARN</label><input style={field} value={cfg.roleArn} onChange={(e) => setCfg({ ...cfg, roleArn: e.target.value })} placeholder="arn:aws:iam::123456789012:role/prism" /></div>
              <div><label style={label}>External ID</label><input style={field} value={secret.externalId} onChange={(e) => setSecret({ ...secret, externalId: e.target.value })} autoComplete="off" /></div>
            </div>
          )}
        </div>
      )}

      {backend === "azure_blob" && (
        <div style={{ display: "flex", flexDirection: "column", gap: 10, padding: "12px 14px", borderRadius: 10, background: "var(--bg3)", border: "1px solid var(--border2)" }}>
          <div><label style={label}>Container name</label><input style={field} value={cfg.container} onChange={(e) => setCfg({ ...cfg, container: e.target.value })} placeholder="evidence" /></div>
          <div>
            <label style={label}>Connection string</label>
            <input style={field} type="password" value={secret.connectionString} onChange={(e) => setSecret({ ...secret, connectionString: e.target.value })}
              placeholder="DefaultEndpointsProtocol=https;AccountName=…;AccountKey=…" autoComplete="off" />
          </div>
        </div>
      )}

      {error && <p style={{ fontSize: 12, color: "#ef4444", margin: 0 }}>{error}</p>}
      {okMsg && <p style={{ fontSize: 12, color: "#22c55e", margin: 0 }}>{okMsg}</p>}

      <div>
        <button
          className={embedded ? undefined : "btn btn-primary"}
          onClick={save}
          disabled={saving || migrationStatus === "in_progress" || (!dirty && backend === current?.backend)}
          style={embedded ? {
            padding: "10px 18px", fontSize: 13, fontWeight: 600, borderRadius: 8, cursor: "pointer",
            border: "none", background: "var(--accent)", color: "#fff",
          } : { padding: "8px 16px" }}
        >
          {saving ? "Checking connection…" : backend === "local" ? "Use PRISM-managed storage" : "Test & save"}
        </button>
      </div>
    </div>
  );
}
