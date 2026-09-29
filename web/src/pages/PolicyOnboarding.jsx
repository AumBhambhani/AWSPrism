import { useEffect, useRef, useState } from "react";
import { isPendingScan, pendingScanMessage } from "../utils/uploadScan.js";
import { apiFetch } from "../api/client.js";
import EvidenceStorageForm from "../components/EvidenceStorageForm.jsx";

const API_URL = import.meta.env.VITE_API_URL || "";

// ── Data ──────────────────────────────────────────────────────────────────────

const POLICY_DOCS = [
  { id: "isp",  title: "Information Security Policy",    desc: "Overall security governance framework and principles" },
  { id: "acp",  title: "Access Control Policy",          desc: "Rules for granting, reviewing, and revoking system access" },
  { id: "pp",   title: "Password Policy",                desc: "Password complexity, rotation, and management requirements" },
  { id: "igp",  title: "Identity Governance Policy",     desc: "Identity lifecycle, role management, and privilege controls" },
  { id: "hrp",  title: "HR Policies",                    desc: "Employee data handling, contracts, and HR compliance obligations" },
  { id: "vmp",  title: "Vendor Management Policy",       desc: "Third-party risk assessment and procurement controls" },
  { id: "irp",  title: "Incident Response Plan",         desc: "Procedures for detecting, containing, and responding to incidents" },
  { id: "bcp",  title: "Business Continuity Plan",       desc: "Plans to maintain critical operations during disruptions" },
  { id: "drp",  title: "Disaster Recovery Plan",         desc: "IT recovery procedures and RTO/RPO targets after a disaster" },
  { id: "dpp",  title: "Data Protection Policy",         desc: "Personal data handling obligations under DPDPA and applicable law" },
  { id: "aup",  title: "Acceptable Use Policy",          desc: "Permitted and prohibited use of IT resources and data" },
  { id: "bkp",  title: "Backup Policy",                  desc: "Backup schedules, retention periods, and recovery procedures" },
  { id: "csp",  title: "Cloud Security Policy",          desc: "Security controls, configuration standards for cloud environments" },
  { id: "aig",  title: "AI Governance Policy",           desc: "Responsible AI use, oversight, and risk management framework" },
  { id: "trp",  title: "Third-Party Risk Policy",        desc: "Risk assessment criteria and controls for vendors and partners" },
  { id: "pn",   title: "Privacy Notice",                 desc: "External disclosure of personal data practices to data principals" },
  { id: "cmp",  title: "Consent Management Policy",      desc: "Consent collection, recording, withdrawal, and audit procedures" },
  { id: "sop",  title: "Standard Operating Procedures",  desc: "Documented step-by-step processes for key operational activities" },
];

const TECH_STACK = [
  {
    group: "Identity & Access",
    items: [
      { key: "iam", label: "Identity and Access Management (IAM)", placeholder: "e.g. Microsoft Entra ID, Okta, JumpCloud" },
      { key: "pam", label: "Privileged Access Management (PAM)",   placeholder: "e.g. CyberArk, Delinea, BeyondTrust" },
    ],
  },
  {
    group: "Endpoint & Security Operations",
    items: [
      { key: "endpoint_protection",      label: "Endpoint Protection / Antivirus",  placeholder: "e.g. Microsoft Defender, CrowdStrike, SentinelOne" },
      { key: "xdr_edr",                  label: "XDR / EDR",                         placeholder: "e.g. CrowdStrike Falcon, Palo Alto Cortex XDR" },
      { key: "siem",                     label: "SIEM",                              placeholder: "e.g. Microsoft Sentinel, Splunk, IBM QRadar" },
    ],
  },
  {
    group: "Network & Perimeter",
    items: [
      { key: "firewalls",     label: "Firewalls",    placeholder: "e.g. Palo Alto, Fortinet, Cisco ASA" },
      { key: "email_security", label: "Email Security", placeholder: "e.g. Microsoft Defender for O365, Proofpoint, Mimecast" },
      { key: "waf",           label: "WAF",          placeholder: "e.g. Cloudflare WAF, AWS WAF, Azure Application Gateway" },
      { key: "api_security",  label: "API Security", placeholder: "e.g. Apigee, AWS API Gateway, Kong, Noname" },
    ],
  },
  {
    group: "Data & Cloud",
    items: [
      { key: "dlp",         label: "Data Loss Prevention (DLP)", placeholder: "e.g. Microsoft Purview, Forcepoint, Proofpoint" },
      { key: "cloud_security", label: "Cloud Security",          placeholder: "e.g. AWS Security Hub, Azure Defender" },
      { key: "cspm_cnapp",  label: "CSPM / CNAPP",              placeholder: "e.g. Wiz, Orca, Prisma Cloud, Lacework" },
      { key: "casb",        label: "CASB",                       placeholder: "e.g. Microsoft Defender for Cloud Apps, Netskope" },
    ],
  },
  {
    group: "Infrastructure & Operations",
    items: [
      { key: "backup_dr",              label: "Backup & Disaster Recovery", placeholder: "e.g. Veeam, Commvault, Rubrik, Acronis" },
      { key: "mdm",                    label: "Mobile Device Management (MDM)", placeholder: "e.g. Microsoft Intune, Jamf, VMware Workspace ONE" },
      { key: "vulnerability_management", label: "Vulnerability Management",    placeholder: "e.g. Qualys, Tenable, Rapid7" },
      { key: "asset_management",       label: "Asset Management",             placeholder: "e.g. ServiceNow CMDB, Lansweeper, Snipe-IT" },
    ],
  },
  {
    group: "Business Systems",
    items: [
      { key: "itsm", label: "ITSM",  placeholder: "e.g. ServiceNow, Jira Service Management, Freshservice" },
      { key: "hrms", label: "HRMS",  placeholder: "e.g. Workday, BambooHR, SAP SuccessFactors, Darwinbox" },
      { key: "erp",  label: "ERP",   placeholder: "e.g. SAP, Oracle ERP, Microsoft Dynamics" },
      { key: "crm",  label: "CRM",   placeholder: "e.g. Salesforce, HubSpot, Zoho CRM" },
    ],
  },
];

// ── Helpers ───────────────────────────────────────────────────────────────────

async function uploadVaultFile(token, file, title) {
  const form = new FormData();
  form.append("file", file);
  form.append("title", title);
  form.append("category", "Policy Document");
  const res = await fetch(`${API_URL}/api/vault`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}` },
    body: form,
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.error || "Upload failed");
  }
  return res.json();
}

async function fetchPolicyAnalysis(token, vaultId, policyName) {
  const res = await fetch(`${API_URL}/api/vault/${vaultId}/analyze-policy`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify({ policyName }),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.error || "Analysis failed");
  }
  return res.json();
}

const READINESS_META = {
  strong:      { label: "Strong",     color: "#22c55e", bg: "rgba(34,197,94,0.1)" },
  adequate:    { label: "Adequate",   color: "#f59e0b", bg: "rgba(245,158,11,0.1)" },
  incomplete:  { label: "Needs Work", color: "#ef4444", bg: "rgba(239,68,68,0.1)" },
  placeholder: { label: "Template",   color: "#94a3b8", bg: "rgba(148,163,184,0.1)" },
};

// ── Sub-components ────────────────────────────────────────────────────────────

function StepDots({ total, current }) {
  return (
    <div style={{ display: "flex", gap: 6, justifyContent: "center", marginBottom: 28 }}>
      {Array.from({ length: total }).map((_, i) => (
        <div key={i} style={{
          width: i === current ? 20 : 7, height: 7, borderRadius: 4,
          background: i === current ? "var(--accent)" : i < current ? "var(--accent)" : "var(--border2)",
          opacity: i < current ? 0.4 : 1,
          transition: "all 0.2s",
        }} />
      ))}
    </div>
  );
}

function WelcomeStep({ onNext }) {
  const modules = [
    { icon: "📄", title: "Policy Intelligence", desc: "Ingests all governance documents, detects conflicts, maps clauses to controls, and generates redlined revisions." },
    { icon: "🔍", title: "Compliance Gap Analysis", desc: "Identifies missing controls, weak statements, undefined ownership, and framework-specific gaps automatically." },
    { icon: "🖥️", title: "Technology Intelligence", desc: "Maintains a living inventory of your tech stack — coverage, configuration, licensing, and compliance mapping." },
    { icon: "💡", title: "Tool Recommendations", desc: "Recommends products that close identified capability gaps, with deployment effort and compliance impact ratings." },
  ];
  return (
    <div>
      <div style={{ textAlign: "center", marginBottom: 28 }}>
        <div style={{ fontSize: 40, marginBottom: 12 }}>🛡️</div>
        <h2 style={{ fontSize: 20, fontWeight: 700, color: "var(--text)", margin: "0 0 8px" }}>
          Welcome to PRISM
        </h2>
        <p style={{ fontSize: 13, color: "var(--text2)", lineHeight: 1.6, margin: 0 }}>
          Let's set up your compliance workspace. We'll collect your policy documents and technology stack — PRISM does the rest.
        </p>
      </div>
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10, marginBottom: 28 }}>
        {modules.map(m => (
          <div key={m.title} style={{ background: "var(--bg3)", borderRadius: 10, padding: "14px 14px", border: "1px solid var(--border2)" }}>
            <div style={{ fontSize: 22, marginBottom: 6 }}>{m.icon}</div>
            <div style={{ fontSize: 12, fontWeight: 700, color: "var(--text)", marginBottom: 4 }}>{m.title}</div>
            <div style={{ fontSize: 11, color: "var(--text3)", lineHeight: 1.5 }}>{m.desc}</div>
          </div>
        ))}
      </div>
      <button className="btn btn-primary" style={{ width: "100%", padding: "12px 0", fontSize: 14 }} onClick={onNext}>
        Start Setup →
      </button>
    </div>
  );
}

function AnalysisCard({ analysis, expanded, onToggle }) {
  if (analysis === "loading") {
    return (
      <div style={{ marginTop: 8, padding: "8px 10px", borderRadius: 6, background: "var(--bg3)", border: "1px solid var(--border2)" }}>
        <div style={{ fontSize: 11, color: "var(--text3)", display: "flex", alignItems: "center", gap: 6 }}>
          <span style={{ animation: "spin 1s linear infinite", display: "inline-block" }}>⟳</span>
          PRISM is analysing your document…
        </div>
      </div>
    );
  }
  if (analysis === "error" || !analysis) return null;

  const meta = READINESS_META[analysis.readiness] || READINESS_META.incomplete;
  const hasDetails = analysis.gaps.length > 0 || analysis.dpdpGaps.length > 0 || analysis.suggestions.length > 0;

  return (
    <div style={{ marginTop: 8, borderRadius: 6, border: "1px solid var(--border2)", overflow: "hidden" }}>
      {/* Header row */}
      <div style={{ padding: "8px 10px", background: "var(--bg3)", display: "flex", alignItems: "center", gap: 8 }}>
        <span style={{
          fontSize: 10, fontWeight: 700, padding: "2px 7px", borderRadius: 10,
          background: meta.bg, color: meta.color, letterSpacing: "0.04em",
        }}>{meta.label}</span>
        <span style={{ fontSize: 11, color: "var(--text2)", flex: 1, lineHeight: 1.4 }}>{analysis.summary}</span>
        {hasDetails && (
          <button
            onClick={onToggle}
            style={{ fontSize: 11, color: "var(--accent)", background: "none", border: "none", cursor: "pointer", whiteSpace: "nowrap", flexShrink: 0 }}
          >
            {expanded ? "Hide ▲" : `Details ▼`}
          </button>
        )}
      </div>
      {/* Detail panel */}
      {expanded && hasDetails && (
        <div style={{ padding: "10px 12px", background: "var(--bg2)", display: "flex", flexDirection: "column", gap: 10 }}>
          {analysis.gaps.length > 0 && (
            <div>
              <div style={{ fontSize: 10, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.06em", color: "var(--text3)", marginBottom: 4 }}>Policy Gaps</div>
              <ul style={{ margin: 0, padding: "0 0 0 16px" }}>
                {analysis.gaps.map((g, i) => <li key={i} style={{ fontSize: 11, color: "var(--text2)", lineHeight: 1.5 }}>{g}</li>)}
              </ul>
            </div>
          )}
          {analysis.dpdpGaps.length > 0 && (
            <div>
              <div style={{ fontSize: 10, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.06em", color: "#f59e0b", marginBottom: 4 }}>DPDPA Gaps</div>
              <ul style={{ margin: 0, padding: "0 0 0 16px" }}>
                {analysis.dpdpGaps.map((g, i) => <li key={i} style={{ fontSize: 11, color: "var(--text2)", lineHeight: 1.5 }}>{g}</li>)}
              </ul>
            </div>
          )}
          {analysis.suggestions.length > 0 && (
            <div>
              <div style={{ fontSize: 10, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.06em", color: "var(--accent)", marginBottom: 4 }}>Suggestions</div>
              <ul style={{ margin: 0, padding: "0 0 0 16px" }}>
                {analysis.suggestions.map((s, i) => <li key={i} style={{ fontSize: 11, color: "var(--text2)", lineHeight: 1.5 }}>{s}</li>)}
              </ul>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function PolicyDocsStep({ token, uploads, onUploadsChange, onNext, onBack }) {
  const [uploading, setUploading]   = useState({});
  const [errors, setErrors]         = useState({});
  const [analyses, setAnalyses]     = useState({});
  const [expanded, setExpanded]     = useState({});
  const fileRefs = useRef({});

  const uploadedCount = Object.values(uploads).filter(Boolean).length;

  // Re-hydrate analyses for documents uploaded on an earlier visit (analyses is
  // local state and is lost on unmount). The server caches the result on the
  // vault row, so this is a DB read, not another Bedrock call.
  useEffect(() => {
    for (const doc of POLICY_DOCS) {
      const up = uploads[doc.id];
      if (!up?.vaultId) continue;
      setAnalyses(a => (a[doc.id] !== undefined ? a : { ...a, [doc.id]: "loading" }));
      fetchPolicyAnalysis(token, up.vaultId, doc.title)
        .then(analysis => setAnalyses(a => ({ ...a, [doc.id]: analysis })))
        .catch(() => setAnalyses(a => ({ ...a, [doc.id]: "error" })));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handleFile = async (doc, file) => {
    if (!file) return;
    setUploading(u => ({ ...u, [doc.id]: true }));
    setErrors(e => ({ ...e, [doc.id]: null }));
    try {
      const result = await uploadVaultFile(token, file, doc.title);
      if (isPendingScan(result)) {
        setErrors(e => ({ ...e, [doc.id]: `${pendingScanMessage(result)} Re-open this step to analyse it once it appears in the Evidence Vault.` }));
        return;
      }
      onUploadsChange(prev => ({ ...prev, [doc.id]: { name: file.name, vaultId: result.id } }));
      // Kick off analysis in background — don't await upload first
      setAnalyses(a => ({ ...a, [doc.id]: "loading" }));
      fetchPolicyAnalysis(token, result.id, doc.title)
        .then(analysis => setAnalyses(a => ({ ...a, [doc.id]: analysis })))
        .catch(() => setAnalyses(a => ({ ...a, [doc.id]: "error" })));
    } catch (err) {
      setErrors(e => ({ ...e, [doc.id]: err.message }));
    } finally {
      setUploading(u => ({ ...u, [doc.id]: false }));
    }
  };

  const removeUpload = (docId) => {
    onUploadsChange(prev => { const n = { ...prev }; delete n[docId]; return n; });
    setAnalyses(a => { const n = { ...a }; delete n[docId]; return n; });
    setExpanded(e => { const n = { ...e }; delete n[docId]; return n; });
  };

  return (
    <div>
      <div style={{ marginBottom: 20 }}>
        <h2 style={{ fontSize: 18, fontWeight: 700, color: "var(--text)", margin: "0 0 6px" }}>Policy Documents</h2>
        <p style={{ fontSize: 13, color: "var(--text2)", margin: 0, lineHeight: 1.5 }}>
          Upload your governance documents. PRISM analyses each one instantly for gaps and DPDPA alignment. You can skip any and upload from the vault later.
        </p>
      </div>

      {/* Progress */}
      <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 16 }}>
        <div style={{ flex: 1, height: 5, background: "var(--bg4)", borderRadius: 3, overflow: "hidden" }}>
          <div style={{ height: "100%", width: `${(uploadedCount / POLICY_DOCS.length) * 100}%`, background: "var(--accent)", borderRadius: 3, transition: "width 0.3s" }} />
        </div>
        <span style={{ fontSize: 12, color: "var(--text3)", whiteSpace: "nowrap" }}>{uploadedCount} / {POLICY_DOCS.length}</span>
      </div>

      {/* Document list */}
      <div style={{ display: "flex", flexDirection: "column", gap: 6, marginBottom: 24, maxHeight: 400, overflowY: "auto", paddingRight: 4 }}>
        {POLICY_DOCS.map(doc => {
          const uploaded  = uploads[doc.id];
          const busy      = uploading[doc.id];
          const err       = errors[doc.id];
          const analysis  = analyses[doc.id];
          const isExpanded = expanded[doc.id];
          return (
            <div key={doc.id} style={{
              padding: "10px 12px", borderRadius: 8,
              border: `1px solid ${uploaded ? "rgba(34,197,94,0.3)" : "var(--border2)"}`,
              background: uploaded ? "rgba(34,197,94,0.04)" : "var(--bg2)",
            }}>
              {/* Top row */}
              <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                <div style={{
                  width: 8, height: 8, borderRadius: "50%", flexShrink: 0,
                  background: uploaded ? "#22c55e" : "var(--border2)",
                }} />
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: 12, fontWeight: 600, color: "var(--text)" }}>{doc.title}</div>
                  {uploaded
                    ? <div style={{ fontSize: 11, color: "#22c55e" }}>✓ {uploaded.name}</div>
                    : err
                      ? <div style={{ fontSize: 11, color: "#ef4444" }}>{err}</div>
                      : <div style={{ fontSize: 11, color: "var(--text3)" }}>{doc.desc}</div>
                  }
                </div>
                {uploaded ? (
                  <button onClick={() => removeUpload(doc.id)} style={{ fontSize: 11, color: "var(--text3)", background: "none", border: "none", cursor: "pointer", whiteSpace: "nowrap" }}>Remove</button>
                ) : (
                  <>
                    <input
                      ref={el => { fileRefs.current[doc.id] = el; }}
                      type="file"
                      accept=".pdf,.doc,.docx,.txt,.xlsx,.xls"
                      style={{ display: "none" }}
                      onChange={e => handleFile(doc, e.target.files[0])}
                    />
                    <button
                      onClick={() => fileRefs.current[doc.id]?.click()}
                      disabled={busy}
                      style={{
                        fontSize: 11, fontWeight: 600, whiteSpace: "nowrap",
                        padding: "4px 10px", borderRadius: 6,
                        border: "1px solid var(--border2)", background: "var(--bg3)",
                        color: "var(--text2)", cursor: busy ? "wait" : "pointer",
                      }}
                    >
                      {busy ? "Uploading…" : "Upload"}
                    </button>
                  </>
                )}
              </div>
              {/* Analysis card (shows after upload) */}
              {analysis && (
                <AnalysisCard
                  analysis={analysis}
                  expanded={isExpanded}
                  onToggle={() => setExpanded(e => ({ ...e, [doc.id]: !e[doc.id] }))}
                />
              )}
            </div>
          );
        })}
      </div>

      {uploadedCount === 0 && (
        <p style={{ fontSize: 12, color: "var(--text3)", marginBottom: 16, textAlign: "center" }}>
          No uploads required to continue — you can upload documents from the vault at any time.
        </p>
      )}

      <div style={{ display: "flex", gap: 10 }}>
        <button className="btn btn-ghost" onClick={onBack}>← Back</button>
        <button className="btn btn-primary" style={{ flex: 1, padding: "11px 0" }} onClick={onNext}>
          Continue to Tech Stack →
        </button>
      </div>
    </div>
  );
}

function StorageStep({ token, onNext, onBack }) {
  return (
    <div>
      <div style={{ marginBottom: 20 }}>
        <h2 style={{ fontSize: 18, fontWeight: 700, color: "var(--text)", margin: "0 0 6px" }}>Evidence Storage</h2>
        <p style={{ fontSize: 13, color: "var(--text2)", margin: 0, lineHeight: 1.5 }}>
          Choose where PRISM keeps your evidence files. The default is fully managed for you — pick your own
          Amazon S3 bucket or Azure Blob container if you need the files to live in your own cloud. You can
          change this later in Admin → Evidence Storage.
        </p>
      </div>

      <EvidenceStorageForm token={token} embedded onSaved={onNext} />

      <div style={{ display: "flex", gap: 10, marginTop: 24 }}>
        <button className="btn btn-ghost" onClick={onBack}>← Back</button>
        <button className="btn btn-primary" style={{ flex: 1, padding: "11px 0" }} onClick={onNext}>
          Skip for now →
        </button>
      </div>
    </div>
  );
}

function TechStackStep({ stack, onStackChange, onNext, onBack, saving }) {
  const allKeys = TECH_STACK.flatMap(g => g.items.map(i => i.key));
  const filledCount = allKeys.filter(k => stack[k]?.trim()).length;

  return (
    <div>
      <div style={{ marginBottom: 20 }}>
        <h2 style={{ fontSize: 18, fontWeight: 700, color: "var(--text)", margin: "0 0 6px" }}>Technology Stack</h2>
        <p style={{ fontSize: 13, color: "var(--text2)", margin: 0, lineHeight: 1.5 }}>
          Tell us what tools your organisation uses. PRISM maps these to compliance controls and identifies capability gaps.
        </p>
      </div>

      {/* Progress */}
      <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 16 }}>
        <div style={{ flex: 1, height: 5, background: "var(--bg4)", borderRadius: 3, overflow: "hidden" }}>
          <div style={{ height: "100%", width: `${(filledCount / allKeys.length) * 100}%`, background: "var(--accent)", borderRadius: 3, transition: "width 0.3s" }} />
        </div>
        <span style={{ fontSize: 12, color: "var(--text3)", whiteSpace: "nowrap" }}>{filledCount} / {allKeys.length}</span>
      </div>

      <div style={{ display: "flex", flexDirection: "column", gap: 18, maxHeight: 400, overflowY: "auto", paddingRight: 4, marginBottom: 24 }}>
        {TECH_STACK.map(group => (
          <div key={group.group}>
            <div style={{ fontSize: 10, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.07em", color: "var(--accent)", marginBottom: 8 }}>
              {group.group}
            </div>
            <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
              {group.items.map(item => (
                <div key={item.key} style={{ display: "flex", alignItems: "center", gap: 10 }}>
                  <div style={{
                    width: 7, height: 7, borderRadius: "50%", flexShrink: 0,
                    background: stack[item.key]?.trim() ? "#22c55e" : "var(--border2)",
                  }} />
                  <div style={{ fontSize: 12, fontWeight: 500, color: "var(--text)", width: 200, flexShrink: 0 }}>
                    {item.label}
                  </div>
                  <input
                    type="text"
                    value={stack[item.key] || ""}
                    onChange={e => onStackChange(prev => ({ ...prev, [item.key]: e.target.value }))}
                    placeholder={item.placeholder}
                    style={{
                      flex: 1, padding: "6px 10px", borderRadius: 6, fontSize: 12,
                      border: "1px solid var(--border2)", background: "var(--bg3)",
                      color: "var(--text)", outline: "none",
                    }}
                  />
                </div>
              ))}
            </div>
          </div>
        ))}
      </div>

      {saving && (
        <p style={{ fontSize: 12, color: "var(--text3)", textAlign: "center", marginBottom: 12 }}>Saving your workspace…</p>
      )}

      <div style={{ display: "flex", gap: 10 }}>
        <button className="btn btn-ghost" onClick={onBack} disabled={saving}>← Back</button>
        <button className="btn btn-primary" style={{ flex: 1, padding: "11px 0" }} onClick={onNext} disabled={saving}>
          {saving ? "Finishing setup…" : "Complete Setup →"}
        </button>
      </div>
    </div>
  );
}

function DoneStep({ uploadedCount, filledCount, onEnter }) {
  return (
    <div style={{ textAlign: "center", padding: "12px 0 4px" }}>
      <div style={{ fontSize: 52, marginBottom: 16 }}>✅</div>
      <h2 style={{ fontSize: 20, fontWeight: 700, color: "var(--text)", margin: "0 0 10px" }}>PRISM is ready</h2>
      <p style={{ fontSize: 13, color: "var(--text2)", lineHeight: 1.6, marginBottom: 24 }}>
        Your compliance workspace has been configured. PRISM will now begin analysing your documents and mapping your tech stack to compliance controls.
      </p>
      <div style={{ display: "flex", gap: 12, justifyContent: "center", marginBottom: 28 }}>
        <div style={{ background: "var(--bg3)", borderRadius: 10, padding: "14px 20px", textAlign: "center" }}>
          <div style={{ fontSize: 22, fontWeight: 700, color: "var(--accent)" }}>{uploadedCount}</div>
          <div style={{ fontSize: 11, color: "var(--text3)" }}>Policy docs uploaded</div>
        </div>
        <div style={{ background: "var(--bg3)", borderRadius: 10, padding: "14px 20px", textAlign: "center" }}>
          <div style={{ fontSize: 22, fontWeight: 700, color: "var(--accent)" }}>{filledCount}</div>
          <div style={{ fontSize: 11, color: "var(--text3)" }}>Tech tools catalogued</div>
        </div>
      </div>
      {uploadedCount < 18 && (
        <p style={{ fontSize: 12, color: "var(--text3)", marginBottom: 20 }}>
          You can upload remaining policy documents from the Evidence Vault at any time.
        </p>
      )}
      <button className="btn btn-primary" style={{ padding: "12px 40px", fontSize: 14 }} onClick={onEnter}>
        Enter PRISM →
      </button>
    </div>
  );
}

// ── Main ──────────────────────────────────────────────────────────────────────

export default function PolicyOnboarding({ token, onComplete }) {
  const [step, setStep]       = useState(0); // 0=welcome, 1=docs, 2=storage, 3=tech, 4=done
  const [uploads, setUploads] = useState({});
  const [stack, setStack]     = useState({});
  const [saving, setSaving]   = useState(false);
  const [error, setError]     = useState("");

  const allTechKeys = TECH_STACK.flatMap(g => g.items.map(i => i.key));
  const uploadedCount = Object.values(uploads).filter(Boolean).length;
  const filledCount   = allTechKeys.filter(k => stack[k]?.trim()).length;

  const handleFinish = async () => {
    setSaving(true);
    setError("");
    try {
      // Save tech stack
      if (filledCount > 0) {
        await apiFetch("/api/settings/tech-stack", { token, method: "PUT", body: JSON.stringify(stack) });
      }
      // Mark onboarding complete (no departments in new flow)
      await apiFetch("/api/auth/complete-onboarding", { token, method: "POST", body: JSON.stringify({ departments: [] }) });
      setStep(4);
    } catch (err) {
      setError(err.message || "Something went wrong. Please try again.");
    } finally {
      setSaving(false);
    }
  };

  return (
    <div style={{
      position: "fixed", inset: 0, zIndex: 9000,
      background: "rgba(0,0,0,0.55)", backdropFilter: "blur(6px)",
      display: "flex", alignItems: "center", justifyContent: "center", padding: 20,
    }}>
      <div style={{
        background: "var(--bg)", borderRadius: 16,
        padding: "32px 32px 28px",
        width: "100%", maxWidth: step === 2 || step === 3 ? 660 : 560,
        boxShadow: "0 24px 80px rgba(0,0,0,0.28)",
        maxHeight: "92vh", overflowY: "auto",
        transition: "max-width 0.2s",
      }}>
        {step > 0 && step < 4 && <StepDots total={4} current={step - 1} />}

        {step === 0 && <WelcomeStep onNext={() => setStep(1)} />}

        {step === 1 && (
          <PolicyDocsStep
            token={token}
            uploads={uploads}
            onUploadsChange={setUploads}
            onNext={() => setStep(2)}
            onBack={() => setStep(0)}
          />
        )}

        {step === 2 && (
          <StorageStep
            token={token}
            onNext={() => setStep(3)}
            onBack={() => setStep(1)}
          />
        )}

        {step === 3 && (
          <>
            <TechStackStep
              stack={stack}
              onStackChange={setStack}
              onNext={handleFinish}
              onBack={() => setStep(2)}
              saving={saving}
            />
            {error && (
              <p style={{ fontSize: 12, color: "#ef4444", textAlign: "center", marginTop: 8 }}>{error}</p>
            )}
          </>
        )}

        {step === 4 && (
          <DoneStep
            uploadedCount={uploadedCount}
            filledCount={filledCount}
            onEnter={onComplete}
          />
        )}
      </div>
    </div>
  );
}
