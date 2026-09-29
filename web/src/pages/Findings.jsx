import { useCallback, useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { apiFetch } from "../api/client.js";
import { vaultHeaders } from "../utils/vaultSession.js";
import SeverityPill from "../components/SeverityPill.jsx";
import GlassSelect from "../components/GlassSelect.jsx";
import UserMenu from "../components/UserMenu.jsx";

const STATUS_OPTIONS = ["open", "acknowledged", "resolved", "suppressed", "false_positive"];

// HTML-escape helper — required for the bulk report which uses document.write(),
// since finding titles/resource IDs can contain cloud-resource-derived text.
function esc(v) {
  return String(v ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function exportFindingsListPDF(findings, company) {
  const date = new Date().toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric" });
  const th = `style="background:#1e293b;color:#fff;padding:8px 10px;text-align:left;font-weight:600"`;
  const td = `style="padding:7px 10px;border-bottom:1px solid #e2e8f0"`;

  const rows = findings.map(f => `<tr>
    <td ${td}>${esc(f.title)}</td>
    <td ${td}>${esc(f.severity)}</td>
    <td ${td}>${esc(f.status)}</td>
    <td ${td}>${esc(f.resourceId)}</td>
    <td ${td}>${f.lastDetectedAt ? new Date(f.lastDetectedAt).toLocaleDateString("en-GB") : "—"}</td>
  </tr>`).join("") || `<tr><td colspan="5" ${td}>No findings match the current filters</td></tr>`;

  const html = `<!DOCTYPE html>
<html lang="en"><head><meta charset="UTF-8">
<title>${esc(company?.name || "Compliance Report")} — Findings</title>
<style>
  *{box-sizing:border-box;margin:0;padding:0}
  body{font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;color:#0f172a;background:#fff;padding:40px;font-size:13px}
  @media print{body{padding:20px}.no-print{display:none}}
  .header{border-bottom:3px solid #1e293b;padding-bottom:18px;margin-bottom:24px;display:flex;justify-content:space-between;align-items:flex-end}
  .title{font-size:20px;font-weight:700;color:#1e293b}
  .subtitle{font-size:12px;color:#64748b;margin-top:3px}
  .date{font-size:11px;color:#94a3b8;white-space:nowrap}
  table{border-collapse:collapse;width:100%}
  tr:nth-child(even) td{background:#f8fafc}
  .print-btn{position:fixed;top:18px;right:18px;padding:9px 18px;background:#1e293b;color:#fff;border:none;border-radius:8px;font-size:13px;font-weight:600;cursor:pointer}
</style>
</head><body>
<button class="print-btn no-print" onclick="window.print()">Print / Save PDF</button>
<div class="header">
  <div><div class="title">${esc(company?.name || "Compliance Report")}</div><div class="subtitle">Findings Report — PRISM</div></div>
  <div class="date">Generated ${date}</div>
</div>
<table><thead><tr>
  <th ${th}>Finding</th><th ${th}>Severity</th><th ${th}>Status</th><th ${th}>Resource</th><th ${th}>Last detected</th>
</tr></thead><tbody>${rows}</tbody></table>
</body></html>`;

  const win = window.open("", "_blank", "width=900,height=700");
  win.document.write(html);
  win.document.close();
}

export default function Findings({ token, user, company, onLogout, theme, onThemeToggle }) {
  const navigate = useNavigate();
  const isLeadOrAdmin = user?.role === "ADMIN" || user?.role === "LEAD";
  // Auditors can view evidence but not download it (matches VAULT_DOWNLOADERS).
  const isAuditor = user?.role === "AUDITOR";

  const viewEvidencePdf = async (vaultId) => {
    try {
      const API_URL = import.meta.env.VITE_API_URL || "";
      const res = await fetch(`${API_URL}/api/vault/${vaultId}/view`, {
        headers: { Authorization: `Bearer ${token}`, ...vaultHeaders() },
      });
      if (!res.ok) throw new Error(`View failed (${res.status})`);
      window.open(URL.createObjectURL(await res.blob()), "_blank", "noopener");
    } catch (e) {
      setError(e.message || "View failed");
    }
  };
  const [findings, setFindings] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [successMessage, setSuccessMessage] = useState("");
  const [severityFilter, setSeverityFilter] = useState("");
  const [statusFilter, setStatusFilter] = useState("");
  const [busyId, setBusyId] = useState(null);

  const load = useCallback(async () => {
    const params = new URLSearchParams();
    if (severityFilter) params.set("severity", severityFilter);
    if (statusFilter) params.set("status", statusFilter);
    const qs = params.toString();
    const data = await apiFetch(`/api/findings${qs ? `?${qs}` : ""}`, { token });
    setFindings(data || []);
  }, [token, severityFilter, statusFilter]);

  useEffect(() => {
    setLoading(true);
    load().catch(e => setError(e.message)).finally(() => setLoading(false));
  }, [load]);

  const handleStatusChange = async (findingId, status) => {
    setBusyId(findingId);
    setError("");
    try {
      await apiFetch(`/api/findings/${findingId}`, { token, method: "PUT", body: JSON.stringify({ status }) });
      await load();
    } catch (err) {
      setError(err.message);
    } finally {
      setBusyId(null);
    }
  };

  const handlePromote = async (findingId) => {
    setBusyId(findingId);
    setError("");
    setSuccessMessage("");
    try {
      const action = await apiFetch(`/api/findings/${findingId}/promote`, { token, method: "POST", body: JSON.stringify({}) });
      const questNote = action?.questIds?.length ? ` (linked to ${action.questIds.join(", ")})` : "";
      setSuccessMessage(`Remediation action created${questNote}.`);
      setTimeout(() => setSuccessMessage(""), 4000);
      await load();
    } catch (err) {
      setError(err.message);
    } finally {
      setBusyId(null);
    }
  };

  // Downloads the vault-backed evidence PDF for a single finding.
  // Uses raw fetch (not apiFetch) so the vault download path returns a blob, not JSON.
  const downloadEvidencePdf = async (vaultId) => {
    try {
      const API_URL = import.meta.env.VITE_API_URL || "";
      const res = await fetch(`${API_URL}/api/vault/${vaultId}/download`, {
        headers: { Authorization: `Bearer ${token}`, ...vaultHeaders() },
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(
          body.error?.includes("VAULT_PIN") || res.status === 403
            ? "Vault is PIN-protected — open Evidence Vault to unlock it, then try again."
            : `Download failed (${res.status})`
        );
      }
      const blob = await res.blob();
      const blobUrl = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = blobUrl;
      a.download = "evidence.pdf";
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(blobUrl);
    } catch (err) {
      setError(err.message);
    }
  };

  if (loading) {
    return <div className="admin-container"><div className="admin-card"><p>Loading…</p></div></div>;
  }

  return (
    <div className="admin-container">
      <div className="admin-card">
        <div className="admin-header">
          <div>
            <p className="admin-kicker">Findings</p>
            <h1>{company?.name || "Company"}</h1>
            {company?.domain && <p className="admin-domain">{company.domain}</p>}
          </div>
          <div className="admin-actions">
            <button className="btn btn-ghost" onClick={() => exportFindingsListPDF(findings, company)}>↓ Export PDF</button>
            <button className="btn btn-ghost" onClick={() => navigate("/dashboard")}>Dashboard</button>
            <UserMenu
              user={user}
              company={company}
              theme={theme}
              onThemeToggle={onThemeToggle}
              onLogout={onLogout}
            />
          </div>
        </div>

        {error && <p className="error-text">{error}</p>}
        {successMessage && <p style={{ color: "var(--green)" }}>{successMessage}</p>}

        <div style={{ display: "flex", gap: 12, marginTop: 16, marginBottom: 14, flexWrap: "wrap", alignItems: "center" }}>
          <GlassSelect
            value={severityFilter}
            onChange={val => setSeverityFilter(val)}
            options={[
              { value: "", label: "All severities" },
              { value: "critical", label: "Critical" },
              { value: "high", label: "High" },
              { value: "medium", label: "Medium" },
              { value: "low", label: "Low" },
            ]}
          />
          <GlassSelect
            value={statusFilter}
            onChange={val => setStatusFilter(val)}
            options={[
              { value: "", label: "All statuses" },
              ...STATUS_OPTIONS.map(s => ({ value: s, label: s.replace(/_/g, " ").replace(/\b\w/g, l => l.toUpperCase()) }))
            ]}
          />
        </div>

        <div className="admin-table finding-table">
          <div className="admin-row admin-row-header finding-row-actions">
            <span>Finding</span>
            <span>Severity</span>
            <span>Status</span>
            <span>Actions</span>
          </div>
          {findings.length === 0 && (
            <div className="admin-row admin-row-empty"><span>No findings match these filters.</span></div>
          )}
          {findings.map(f => (
            <div key={f.id} className="admin-row finding-row finding-row-actions">
              <span>
                <div className="finding-title">{f.title}</div>
                {f.resourceId && <div className="finding-resource">{f.resourceId}</div>}
                <div className="finding-resource">
                  {f.questIds?.length ? `Linked to: ${f.questIds.join(", ")}` : "Not mapped to a question"}
                </div>
              </span>
              <span><SeverityPill severity={f.severity} /></span>
              <span className="finding-status">{String(f.status || "").replace(/_/g, " ")}</span>
              <span className="finding-actions">
                {/* Evidence PDF — auditors view it inline, other roles download (matches VAULT_DOWNLOADERS) */}
                {f.evidenceVaultId && (
                  <button className="btn btn-ghost" disabled={busyId === f.id} onClick={() => (isAuditor ? viewEvidencePdf(f.evidenceVaultId) : downloadEvidencePdf(f.evidenceVaultId))}>
                    {isAuditor ? "View Evidence PDF" : "Download Evidence PDF"}
                  </button>
                )}
                {isLeadOrAdmin && f.status === "open" && (
                  <button className="btn btn-ghost" disabled={busyId === f.id} onClick={() => handleStatusChange(f.id, "acknowledged")}>Acknowledge</button>
                )}
                {isLeadOrAdmin && f.status !== "suppressed" && f.status !== "resolved" && (
                  <button className="btn btn-ghost" disabled={busyId === f.id} onClick={() => handleStatusChange(f.id, "suppressed")}>Suppress</button>
                )}
                {isLeadOrAdmin && !f.linkedActionId && (
                  <button className="btn btn-primary" disabled={busyId === f.id} onClick={() => handlePromote(f.id)}>Create Remediation Action</button>
                )}
                {f.linkedActionId && (
                  <button className="btn btn-ghost" onClick={() => navigate(`/remediation?findingId=${f.id}`)}>View Remediation Plan</button>
                )}
              </span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
