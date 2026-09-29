import { useCallback, useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { apiFetch, apiUpload, clearCooldown, getCooldownInfo } from "../api/client.js";
import { getVaultToken, setVaultToken as storeVaultToken, isVaultPinError } from "../utils/vaultSession.js";
import { isPendingScan, pendingScanMessage } from "../utils/uploadScan.js";
import NotificationBell from "../components/NotificationBell.jsx";
import EvidenceAiPanel from "../components/EvidenceAiPanel.jsx";
import UserMenu from "../components/UserMenu.jsx";

function formatBytes(n) {
  if (!n) return "—";
  if (n < 1024) return `${n} B`;
  if (n < 1048576) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / 1048576).toFixed(1)} MB`;
}

function formatDate(s) {
  if (!s) return "—";
  return new Date(s).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" });
}

function addInterval(date, interval) {
  const d = new Date(date);
  const s = (interval || "monthly").toLowerCase();
  if (s === "none") return null;
  if (s === "weekly") d.setDate(d.getDate() + 7);
  else if (s === "fortnightly") d.setDate(d.getDate() + 14);
  else if (s.includes("annual") || s.includes("year")) d.setFullYear(d.getFullYear() + 1);
  else if (s.includes("quarter")) d.setMonth(d.getMonth() + 3);
  else if (s.includes("semi") || s.includes("bi")) d.setMonth(d.getMonth() + 6);
  else d.setMonth(d.getMonth() + 1);
  return d;
}

function computeDueDate(uploadedAt, recurrenceInterval, nextDueDate) {
  if (!uploadedAt) return null;
  const due = nextDueDate ? new Date(nextDueDate) : addInterval(uploadedAt, recurrenceInterval);
  if (!due) return null;
  const now = new Date();
  const daysLeft = Math.round((due - now) / 86400000);
  return {
    dateStr: due.toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" }),
    daysLeft,
    overdue: daysLeft < 0,
    soon: daysLeft >= 0 && daysLeft <= 14,
  };
}

function fileIcon(type) {
  if (!type) return "📄";
  if (type.startsWith("image/")) return "🖼";
  if (type.includes("pdf")) return "📋";
  if (type.includes("sheet") || type.includes("excel") || type.includes("csv")) return "📊";
  if (type.includes("word") || type.includes("document")) return "📝";
  if (type.includes("zip") || type.includes("compressed")) return "🗜";
  return "📄";
}

export default function EvidenceVault({ token, user, company, onLogout, theme, onThemeToggle, isVerified }) {
  const navigate = useNavigate();
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [search, setSearch] = useState("");
  const [source, setSource] = useState("all"); // "all" | "automated"
  const [selected, setSelected] = useState(null);       // detail panel item
  const [selectedDetail, setSelectedDetail] = useState(null); // full detail with linked questions
  const [detailLoading, setDetailLoading] = useState(false);
  const [previewUrl, setPreviewUrl] = useState(null);
  const [showFileViewer, setShowFileViewer] = useState(false);
  const [viewerUrl, setViewerUrl] = useState(null);
  const [viewerLoading, setViewerLoading] = useState(false);

  // Vault PIN state
  const [pinSet, setPinSet] = useState(false);
  // Uploads held for a malware rescan (F-12)
  const [quarantined, setQuarantined] = useState([]);
  const [scanNotice, setScanNotice] = useState("");
  const [vaultUnlocked, setVaultUnlocked] = useState(false);
  const [pinStatusLoaded, setPinStatusLoaded] = useState(false);
  const [vaultToken, setVaultTokenState] = useState(() => getVaultToken());
  const setVaultToken = (t) => { storeVaultToken(t); setVaultTokenState(t); };
  const [pinInput, setPinInput] = useState("");
  const [pinError, setPinError] = useState("");
  const [pinVerifying, setPinVerifying] = useState(false);
  const [cooldownPinModal, setCooldownPinModal] = useState(false);
  const [cooldownPinInput, setCooldownPinInput] = useState("");
  const [cooldownPinError, setCooldownPinError] = useState("");
  const [cooldownPinVerifying, setCooldownPinVerifying] = useState(false);
  // Admin PIN management
  const [showSetPin, setShowSetPin] = useState(false);
  const [newPin, setNewPin] = useState("");
  const [adminPinError, setAdminPinError] = useState("");
  const [setPinSaving, setSetPinSaving] = useState(false);
  const [removingPin, setRemovingPin] = useState(false);

  const isAdmin = user?.role === "ADMIN";

  // Upload modal
  const [showUpload, setShowUpload] = useState(false);
  const [uploadTitle, setUploadTitle] = useState("");
  const [uploadDesc, setUploadDesc] = useState("");
  const [uploadFile, setUploadFile] = useState(null);
  const [uploadDrag, setUploadDrag] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [uploadError, setUploadError] = useState("");
  const fileInputRef = useRef(null);

  // Edit modal
  const [editing, setEditing] = useState(null);
  const [editTitle, setEditTitle] = useState("");
  const [editDesc, setEditDesc] = useState("");
  const [editSaving, setEditSaving] = useState(false);

  // Delete state
  const [deleteConfirm, setDeleteConfirm] = useState(null); // { item, linkedCount }
  const [deleting, setDeleting] = useState(false);

  // Version history state
  const [versions, setVersions] = useState([]);
  const [versionsLoading, setVersionsLoading] = useState(false);
  const [showVersionHistory, setShowVersionHistory] = useState(false);

  // Upload new version modal
  const [showUploadVersion, setShowUploadVersion] = useState(false);
  const [versionFile, setVersionFile] = useState(null);
  const [versionNotes, setVersionNotes] = useState("");
  const [versionDrag, setVersionDrag] = useState(false);
  const [uploadingVersion, setUploadingVersion] = useState(false);
  const [versionError, setVersionError] = useState("");
  const versionFileInputRef = useRef(null);

  // Restore state
  const [restoringVersionId, setRestoringVersionId] = useState(null);

  const canWrite = ["ADMIN", "LEAD", "CONTRIBUTOR"].includes(user?.role);
  const canDelete = ["ADMIN", "LEAD"].includes(user?.role);
  const canDownload = ["ADMIN", "LEAD", "CONTRIBUTOR", "REVIEWER"].includes(user?.role);

  // Build headers with vault token for all vault API calls
  const vaultHeaders = vaultToken ? { "X-Vault-Token": vaultToken } : {};

  // Check PIN status on mount
  useEffect(() => {
    apiFetch("/api/vault/pin/status", { token })
      .then(d => {
        setPinSet(d.pinSet);
        // A vault session unlocked elsewhere (Review, question page) carries over;
        // if it has expired the first load answers VAULT_PIN_REQUIRED and re-locks.
        if (!d.pinSet || isAdmin || user?.role === "AUDITOR" || getVaultToken()) setVaultUnlocked(true);
      })
      .catch(e => {
        if (e.code === "COOLDOWN") setError(e.message);
        else setVaultUnlocked(true);
      })
      .finally(() => setPinStatusLoaded(true));
  }, []);

  const handleVerifyPin = async () => {
    if (pinInput.length !== 6) { setPinError("Enter a 6-digit PIN"); return; }
    setPinVerifying(true);
    setPinError("");
    try {
      const data = await apiFetch("/api/vault/pin/verify", {
        token, method: "POST",
        body: JSON.stringify({ pin: pinInput })
      });
      setVaultToken(data.token);
      setVaultUnlocked(true);
      setPinInput("");
    } catch (e) {
      setPinError(e.message || "Incorrect PIN");
    } finally {
      setPinVerifying(false);
    }
  };

  const handleCooldownPinVerify = async () => {
    if (cooldownPinInput.length !== 6) { setCooldownPinError("Enter your 6-digit vault PIN"); return; }
    setCooldownPinVerifying(true);
    setCooldownPinError("");
    try {
      // Use raw fetch — apiFetch would block this call while cooldown is active
      const apiBase = import.meta.env.VITE_API_URL || "";
      const res = await fetch(`${apiBase}/api/vault/pin/verify`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify({ pin: cooldownPinInput }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error || "Incorrect PIN");
      }
      const data = await res.json();
      setVaultToken(data.token);
      setVaultUnlocked(true);
      clearCooldown();
      setError("");
      setCooldownPinModal(false);
      setCooldownPinInput("");
      load();
    } catch (e) {
      setCooldownPinError(e.message || "Incorrect PIN");
    } finally {
      setCooldownPinVerifying(false);
    }
  };

  const handleSetPin = async () => {
    if (!/^\d{6}$/.test(newPin)) { setAdminPinError("PIN must be exactly 6 digits"); return; }
    setSetPinSaving(true);
    setAdminPinError("");
    try {
      await apiFetch("/api/vault/pin", { token, method: "PUT", body: JSON.stringify({ pin: newPin }) });
      setPinSet(true);
      setShowSetPin(false);
      setNewPin("");
    } catch (e) {
      setAdminPinError(e.message || "Failed to set PIN");
    } finally {
      setSetPinSaving(false);
    }
  };

  const handleRemovePin = async () => {
    if (!confirm("Remove the vault PIN? Everyone with vault access will be able to enter without a PIN.")) return;
    setRemovingPin(true);
    try {
      await apiFetch("/api/vault/pin", { token, method: "DELETE" });
      setPinSet(false);
    } catch (e) {
      setError(e.message);
    } finally {
      setRemovingPin(false);
    }
  };

  const load = useCallback(async (q = search) => {
    setLoading(true);
    setError("");
    try {
      const params = new URLSearchParams();
      if (q.trim()) params.set("search", q.trim());
      if (source === "automated") params.set("source", "automated");
      const qs = params.toString();
      const url = qs ? `/api/vault?${qs}` : "/api/vault";
      const data = await apiFetch(url, { token, headers: vaultHeaders });
      setItems(data || []);
      if (canWrite) {
        apiFetch("/api/vault/quarantine", { token, headers: vaultHeaders })
          .then(q => setQuarantined(q || []))
          .catch(() => {});
      }
    } catch (e) {
      if (isVaultPinError(e)) {
        setVaultToken(null);
        setVaultUnlocked(false);
      } else {
        setError(e.message || "Failed to load vault");
      }
    } finally {
      setLoading(false);
    }
  }, [token, vaultToken, source]);

  useEffect(() => { if (vaultUnlocked) load(); }, [vaultUnlocked]);

  // Debounced search
  useEffect(() => {
    const t = setTimeout(() => load(search), 350);
    return () => clearTimeout(t);
  }, [search, source]);

  useEffect(() => { if (vaultUnlocked) load(search); }, [source]);

  // Revoke blob URL when it changes or on unmount to prevent memory leaks
  useEffect(() => {
    return () => {
      if (previewUrl) URL.revokeObjectURL(previewUrl);
    };
  }, [previewUrl]);

  const openDetail = async (item) => {
    setSelected(item);
    setSelectedDetail(null);
    setPreviewUrl(null);
    setDetailLoading(true);
    setVersions([]);
    setShowVersionHistory(false);
    try {
      const detail = await apiFetch(`/api/vault/${item.id}`, { token, headers: vaultHeaders });
      setSelectedDetail(detail);
      if (detail.fileType?.startsWith("image/") && detail.storagePath) {
        const API_URL = import.meta.env.VITE_API_URL || "";
        fetch(`${API_URL}/api/vault/${item.id}/view`, {
          headers: { Authorization: `Bearer ${token}`, ...vaultHeaders }
        })
          .then(r => r.blob())
          .then(blob => setPreviewUrl(URL.createObjectURL(blob)))
          .catch(() => {});
      }
    } catch (e) {
      setError(e.message);
    } finally {
      setDetailLoading(false);
    }
  };

  const loadVersions = async (itemId) => {
    setVersionsLoading(true);
    try {
      const data = await apiFetch(`/api/vault/${itemId}/versions`, { token, headers: vaultHeaders });
      setVersions(data || []);
      setShowVersionHistory(true);
    } catch (e) {
      setError(e.message);
    } finally {
      setVersionsLoading(false);
    }
  };

  // F-11: changing evidence behind an approved control sends that control back for review.
  const confirmReopen = (state) =>
    state !== "approved" ||
    confirm("This evidence supports a reviewer-approved control. Changing it will send that control back to the review queue. Continue?");

  const handleUploadVersion = async () => {
    if (!versionFile) { setVersionError("Please select a file"); return; }
    if (!confirmReopen(selectedDetail?.approvalState)) return;
    setUploadingVersion(true);
    setVersionError("");
    try {
      const newVer = await apiUpload(
        `/api/vault/${selectedDetail.id}/versions`,
        versionFile,
        { versionNotes: versionNotes.trim() },
        token,
        vaultHeaders
      );
      if (isPendingScan(newVer)) {
        setScanNotice(pendingScanMessage(newVer));
        setShowUploadVersion(false);
        setVersionFile(null);
        setVersionNotes("");
        load();
        return;
      }
      setVersions(prev => [newVer, ...prev]);
      setSelectedDetail(d => ({
        ...d,
        fileName: newVer.fileName,
        fileType: newVer.fileType,
        fileSize: newVer.fileSize,
        storagePath: newVer.storagePath,
      }));
      setItems(prev => prev.map(i => i.id === selectedDetail.id
        ? { ...i, fileName: newVer.fileName, fileType: newVer.fileType, fileSize: newVer.fileSize }
        : i
      ));
      setShowUploadVersion(false);
      setVersionFile(null);
      setVersionNotes("");
    } catch (e) {
      setVersionError(e.message || "Upload failed");
    } finally {
      setUploadingVersion(false);
    }
  };

  const handleRestoreVersion = async (ver) => {
    if (!selectedDetail) return;
    if (!confirmReopen(selectedDetail.approvalState)) return;
    setRestoringVersionId(ver.id);
    try {
      const newVer = await apiFetch(`/api/vault/${selectedDetail.id}/versions/${ver.id}/restore`, {
        token, method: "POST",
        body: JSON.stringify({}),
        headers: vaultHeaders
      });
      setVersions(prev => [newVer, ...prev]);
      setSelectedDetail(d => ({
        ...d,
        fileName: newVer.fileName,
        fileType: newVer.fileType,
        fileSize: newVer.fileSize,
        storagePath: newVer.storagePath,
      }));
      setItems(prev => prev.map(i =>
        i.id === selectedDetail.id
          ? { ...i, fileName: newVer.fileName, fileType: newVer.fileType, fileSize: newVer.fileSize }
          : i
      ));
    } catch (e) {
      setError(e.message);
    } finally {
      setRestoringVersionId(null);
    }
  };

  const handleDownloadVersion = async (vaultId, ver) => {
    const API_URL = import.meta.env.VITE_API_URL || "";
    const res = await fetch(`${API_URL}/api/vault/${vaultId}/versions/${ver.id}/download`, {
      headers: { Authorization: `Bearer ${token}`, ...vaultHeaders }
    });
    if (!res.ok) { setError("Download failed"); return; }
    const blob = await res.blob();
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = ver.fileName || `version-${ver.versionNumber}`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  };

  const closeDetail = () => {
    if (previewUrl) URL.revokeObjectURL(previewUrl);
    setSelected(null);
    setSelectedDetail(null);
    setPreviewUrl(null);
    setVersions([]);
    setShowVersionHistory(false);
    setShowUploadVersion(false);
  };

  const handleUpload = async () => {
    if (!uploadTitle.trim()) { setUploadError("Title is required"); return; }
    if (!uploadFile) { setUploadError("Please select a file"); return; }
    setUploading(true);
    setUploadError("");
    try {
      const created = await apiUpload("/api/vault", uploadFile, {
        title: uploadTitle.trim(),
        description: uploadDesc.trim() || ""
      }, token, vaultHeaders);
      if (isPendingScan(created)) setScanNotice(pendingScanMessage(created));
      else setItems(prev => [created, ...prev]);
      if (isPendingScan(created)) load();
      setShowUpload(false);
      setUploadTitle("");
      setUploadDesc("");
      setUploadFile(null);
    } catch (e) {
      setUploadError(e.message || "Upload failed");
    } finally {
      setUploading(false);
    }
  };

  const handleEdit = async () => {
    if (!editTitle.trim()) return;
    // The list row has no approval detail; a locked item may reopen review (or be refused if audited).
    const state = selectedDetail?.id === editing.id ? selectedDetail.approvalState : (editing.locked ? "approved" : null);
    if (!confirmReopen(state)) return;
    setEditSaving(true);
    try {
      const updated = await apiFetch(`/api/vault/${editing.id}`, {
        token, method: "PUT",
        body: JSON.stringify({ title: editTitle.trim(), description: editDesc.trim() || null }),
        headers: vaultHeaders
      });
      setItems(prev => prev.map(i => i.id === updated.id ? { ...i, ...updated } : i));
      if (selectedDetail?.id === updated.id) setSelectedDetail(d => ({ ...d, ...updated }));
      setEditing(null);
    } catch (e) {
      setError(e.message);
    } finally {
      setEditSaving(false);
    }
  };

  const handleDeleteClick = async (item) => {
    try {
      await apiFetch(`/api/vault/${item.id}`, { token, method: "DELETE", headers: vaultHeaders });
      setItems(prev => prev.filter(i => i.id !== item.id));
      if (selected?.id === item.id) closeDetail();
    } catch (e) {
      if (e.message?.toLowerCase().includes("locked")) {
        setError("This evidence is locked — it cannot be deleted because a reviewer has approved a linked control.");
      } else if (e.message?.includes("linked to")) {
        const match = e.message.match(/(\d+) question/);
        const n = match ? parseInt(match[1]) : 1;
        setError(`Cannot delete — this evidence is linked to ${n} question${n !== 1 ? "s" : ""}. Unlink it from questions in the Tracker before deleting.`);
      } else {
        setError(e.message);
      }
    }
  };

  const handleForceDelete = async () => {
    if (!deleteConfirm) return;
    setDeleting(true);
    try {
      await apiFetch(`/api/vault/${deleteConfirm.item.id}?force=true`, { token, method: "DELETE", headers: vaultHeaders });
      setItems(prev => prev.filter(i => i.id !== deleteConfirm.item.id));
      if (selected?.id === deleteConfirm.item.id) closeDetail();
      setDeleteConfirm(null);
    } catch (e) {
      setError(e.message);
    } finally {
      setDeleting(false);
    }
  };

  const handleDownload = async (item) => {
    const API_URL = import.meta.env.VITE_API_URL || "";
    const res = await fetch(`${API_URL}/api/vault/${item.id}/download`, {
      headers: { Authorization: `Bearer ${token}`, ...vaultHeaders }
    });
    if (!res.ok) { setError("Download failed"); return; }
    const blob = await res.blob();
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = item.fileName || item.title;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  };

  const handleView = async (item) => {
    const API_URL = import.meta.env.VITE_API_URL || "";
    const res = await fetch(`${API_URL}/api/vault/${item.id}/view`, {
      headers: { Authorization: `Bearer ${token}`, ...vaultHeaders }
    });
    if (!res.ok) { setError("Could not open file"); return; }
    const blob = await res.blob();
    const url = URL.createObjectURL(blob);
    window.open(url, "_blank");
    setTimeout(() => URL.revokeObjectURL(url), 10000);
  };

  // Opens the file in an in-app modal viewer (detail panel only — list-row View keeps new-tab behavior via handleView).
  const handleViewInBrowser = async (item) => {
    setViewerLoading(true);
    setShowFileViewer(true);
    const API_URL = import.meta.env.VITE_API_URL || "";
    try {
      const res = await fetch(`${API_URL}/api/vault/${item.id}/view`, {
        headers: { Authorization: `Bearer ${token}`, ...vaultHeaders }
      });
      if (!res.ok) { setError("Could not open file"); setShowFileViewer(false); return; }
      const blob = await res.blob();
      setViewerUrl(URL.createObjectURL(blob));
    } catch {
      setError("Could not open file");
      setShowFileViewer(false);
    } finally {
      setViewerLoading(false);
    }
  };

  const closeFileViewer = () => {
    if (viewerUrl) URL.revokeObjectURL(viewerUrl);
    setViewerUrl(null);
    setShowFileViewer(false);
  };

  const handleViewVersion = async (vaultId, ver) => {
    const API_URL = import.meta.env.VITE_API_URL || "";
    const res = await fetch(`${API_URL}/api/vault/${vaultId}/versions/${ver.id}/view`, {
      headers: { Authorization: `Bearer ${token}`, ...vaultHeaders }
    });
    if (!res.ok) { setError("Could not open file"); return; }
    const blob = await res.blob();
    const url = URL.createObjectURL(blob);
    window.open(url, "_blank");
    setTimeout(() => URL.revokeObjectURL(url), 10000);
  };

  const handleUnlink = async (questId) => {
    if (!selectedDetail) return;
    try {
      await apiFetch(`/api/vault/${selectedDetail.id}/link/${encodeURIComponent(questId)}`, {
        token, method: "DELETE", headers: vaultHeaders
      });
      setSelectedDetail(d => ({
        ...d,
        linkedQuestions: d.linkedQuestions.filter(q => q.questId !== questId),
        linkedCount: d.linkedCount - 1
      }));
      setItems(prev => prev.map(i => i.id === selectedDetail.id ? { ...i, linkedCount: i.linkedCount - 1 } : i));
    } catch (e) {
      setError(e.message);
    }
  };

  // PIN gate screen
  // PIN gate screen — wait for status to load first
  if (!pinStatusLoaded) {
    return (
      <div className="review-shell fade-in" style={{ display: "flex", alignItems: "center", justifyContent: "center", minHeight: "100vh" }}>
        <div className="loading-spinner" />
      </div>
    );
  }

  if (!vaultUnlocked && pinSet) {
    return (
      <div className="review-shell fade-in" style={{ display: "flex", alignItems: "center", justifyContent: "center", minHeight: "100vh" }}>
        <div className="card" style={{ maxWidth: 360, width: "100%", padding: 32, textAlign: "center" }}>
          <div style={{ fontSize: 40, marginBottom: 12 }}>🔐</div>
          <div style={{ fontWeight: 700, fontSize: 18, marginBottom: 6 }}>Evidence Vault</div>
          <div style={{ fontSize: 13, color: "var(--text3)", marginBottom: 24 }}>Enter the 6-digit vault PIN to continue</div>
          <input
            type="password"
            inputMode="numeric"
            maxLength={6}
            value={pinInput}
            onChange={e => setPinInput(e.target.value.replace(/\D/g, "").slice(0, 6))}
            onKeyDown={e => e.key === "Enter" && handleVerifyPin()}
            placeholder="••••••"
            autoFocus
            style={{ width: "100%", padding: "10px 14px", borderRadius: 8, border: "1px solid var(--border2)", background: "var(--bg3)", color: "var(--text)", fontSize: 22, textAlign: "center", letterSpacing: 8, boxSizing: "border-box", marginBottom: 12 }}
          />
          {pinError && <div style={{ fontSize: 12, color: "var(--red)", marginBottom: 10 }}>✗ {pinError}</div>}
          <button className="btn btn-primary" style={{ width: "100%" }} onClick={handleVerifyPin} disabled={pinVerifying}>
            {pinVerifying ? "Verifying…" : "Unlock Vault"}
          </button>
        </div>
      </div>
    );
  }

  if (isVerified === false) {
    return (
      <div className="review-shell fade-in" style={{ display: "flex", alignItems: "center", justifyContent: "center", minHeight: "100vh" }}>
        <div style={{ textAlign: "center", maxWidth: 420, padding: 32 }}>
          <div style={{ fontSize: 48, marginBottom: 16 }}>🔒</div>
          <h2 style={{ fontSize: 20, fontWeight: 700, marginBottom: 10, color: "var(--text)" }}>Evidence Vault Locked</h2>
          <p style={{ fontSize: 14, color: "var(--text2)", lineHeight: 1.6 }}>
            The Evidence Vault is available after your account is verified by a platform administrator.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="review-shell fade-in">
      {/* Header */}
      <div className="review-header" style={{ justifyContent: "space-between" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 16 }}>
          <div className="logo" style={{ cursor: "pointer" }} onClick={() => navigate("/tracker")}>PRISM</div>
          <div className="review-title">
            Evidence Vault
            {pinSet && <span style={{ fontSize: 14, color: "var(--dp-quiet)" }}>🔒</span>}
          </div>
        </div>
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
          <NotificationBell token={token} />
          <button className="btn btn-ghost" onClick={() => navigate("/dashboard")}>Dashboard</button>
          {isAdmin && (
            <button className="btn btn-ghost" onClick={() => { setShowSetPin(true); setNewPin(""); setAdminPinError(""); }}>
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ marginRight: 2 }}>
                <path d="M21 2l-2 2m-1.5 1.5L14 9l-2-2-4 4 1.5 1.5-1.5 1.5L6.5 13 4 15.5 2.5 14 1 15.5 4.5 19 6 17.5 7.5 19 10 16.5l-1-1 1.5-1.5L12 15.5l2-2-2-2 3.5-3.5 1.5 1.5 2-2z"/>
              </svg>
              {pinSet ? "Reset PIN" : "Set PIN"}
            </button>
          )}
          {canWrite && (
            <button className="btn btn-primary" onClick={() => { setShowUpload(true); setUploadError(""); }}>
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                <line x1="12" y1="5" x2="12" y2="19"></line>
                <line x1="5" y1="12" x2="19" y2="12"></line>
              </svg>
              Upload Evidence
            </button>
          )}
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
        {error && (
          <div style={{ padding: "12px 18px", background: "rgba(239,68,68,0.1)", border: "1px solid var(--red)", borderRadius: 12, color: "var(--red)", marginBottom: 18, fontSize: 13.5, display: "flex", alignItems: "center", gap: 10 }}>
            <span style={{ flex: 1 }}>{error}</span>
            {getCooldownInfo().active && (
              <button onClick={() => { setCooldownPinInput(""); setCooldownPinError(""); setCooldownPinModal(true); }} style={{ background: "none", border: "1px solid var(--red)", borderRadius: 6, color: "var(--red)", cursor: "pointer", fontSize: 12, padding: "3px 10px", fontWeight: 600 }}>Reset &amp; retry</button>
            )}
            <button onClick={() => setError("")} style={{ background: "none", border: "none", color: "var(--red)", cursor: "pointer", fontSize: 16 }}>×</button>
          </div>
        )}

        {/* Source Segmented Tabs */}
        <div className="dash-segment" style={{ marginBottom: 20, width: "fit-content" }}>
          <button
            className={`dash-segment-btn ${source === "all" ? "active" : ""}`}
            onClick={() => setSource("all")}
          >
            All Evidence
          </button>
          <button
            className={`dash-segment-btn ${source === "automated" ? "active" : ""}`}
            onClick={() => setSource("automated")}
          >
            Automated
          </button>
        </div>

        {(scanNotice || quarantined.length > 0) && (
          <div className="card" style={{ marginBottom: 16, padding: "12px 16px", borderLeft: "3px solid var(--amber)", fontSize: 13, color: "var(--text2)" }}>
            {scanNotice && <div style={{ marginBottom: quarantined.length ? 6 : 0 }}>🛡 {scanNotice}</div>}
            {quarantined.length > 0 && (
              <div>
                <strong>{quarantined.length} upload{quarantined.length !== 1 ? "s" : ""} waiting for a malware scan:</strong>{" "}
                {quarantined.map(q => q.fileName).join(", ")}
              </div>
            )}
          </div>
        )}

        {/* Search Bar */}
        <div className="vault-search-wrap" style={{ marginBottom: 24 }}>
          <input
            type="text"
            className="vault-search-input"
            placeholder="Search by title or description…"
            value={search}
            onChange={e => setSearch(e.target.value)}
          />
          {search && (
            <button className="vault-search-clear" onClick={() => setSearch("")}>×</button>
          )}
        </div>

        <div style={{ display: "flex", gap: 24, alignItems: "flex-start" }}>
          {/* Item list */}
          <div style={{ flex: 1, minWidth: 0 }}>
            {loading ? (
              <div style={{ textAlign: "center", padding: 48, color: "var(--dp-quiet)" }}>
                <div className="loading-spinner" />
                <p style={{ marginTop: 14, fontSize: 14.5 }}>Loading vault…</p>
              </div>
            ) : items.length === 0 ? (
              <div className="card" style={{ textAlign: "center", padding: 48 }}>
                <div style={{ fontSize: 36, marginBottom: 14 }}>🗄</div>
                <p style={{ color: "var(--dp-quiet)", margin: 0, fontSize: 15 }}>
                  {search ? "No evidence matches your search." : "No evidence in the vault yet."}
                </p>
                {canWrite && !search && (
                  <button className="btn btn-primary" style={{ marginTop: 18 }} onClick={() => setShowUpload(true)}>
                    Upload first evidence
                  </button>
                )}
              </div>
            ) : (
              <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
                {items.map(item => (
                  <div
                    key={item.id}
                    className="card"
                    style={{
                      padding: "16px 20px", cursor: "pointer",
                      border: selected?.id === item.id ? "1.5px solid var(--dp-accent)" : "1px solid var(--dp-line, rgba(163, 178, 204, 0.6))",
                      transition: "all 0.2s cubic-bezier(0.16, 1, 0.3, 1)"
                    }}
                    onClick={() => selected?.id === item.id ? closeDetail() : openDetail(item)}
                  >
                    <div style={{ display: "flex", alignItems: "flex-start", gap: 16 }}>
                      <div style={{
                        fontSize: 26, flexShrink: 0, width: 44, height: 44,
                        borderRadius: 10, display: "flex", alignItems: "center", justifyContent: "center",
                        background: "var(--dp-surface-2, rgba(163, 178, 204, 0.2))",
                        boxShadow: "var(--neu-inset-sm)"
                      }}>
                        {fileIcon(item.fileType)}
                      </div>
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div style={{
                          fontFamily: "var(--dp-font-sans, 'Sora', sans-serif)",
                          fontWeight: 700, fontSize: 15.5, color: "var(--dp-ink, #0F172A)",
                          marginBottom: 4, wordBreak: "break-word", letterSpacing: "-0.01em"
                        }}>
                          {item.title}
                          {item.locked && (
                            <span title="Locked — linked to a reviewer-approved control" style={{ marginLeft: 8, fontSize: 13, cursor: "default" }}>🔒</span>
                          )}
                        </div>
                        {item.description && (
                          <div style={{
                            fontFamily: "var(--dp-font-sans, 'Sora', sans-serif)",
                            fontSize: 13.5, color: "var(--dp-quiet, #475569)",
                            marginBottom: 8, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", lineHeight: 1.4
                          }}>
                            {item.description}
                          </div>
                        )}
                        <div style={{ display: "flex", gap: 14, flexWrap: "wrap", fontSize: 12.5, color: "var(--dp-quiet, #64748B)", fontFamily: "var(--dp-font-mono, monospace)", alignItems: "center" }}>
                          {item.fileType && <span style={{ fontWeight: 600 }}>{item.fileType.split("/")[1]?.toUpperCase() || item.fileType}</span>}
                          {item.fileSize && <span>{formatBytes(item.fileSize)}</span>}
                          <span style={{ fontFamily: "var(--dp-font-sans)" }}>Uploaded by {item.uploadedBy || "—"}</span>
                          {item.freshnessStatus && (
                            <span style={{
                              color: item.freshnessStatus === "fresh" ? "var(--green)" : item.freshnessStatus === "stale" ? "var(--amber)" : "var(--red)",
                              fontWeight: 700
                            }}>
                              {item.freshnessStatus}
                            </span>
                          )}
                          {item.auditedThrough && new Date(`${String(item.auditedThrough).slice(0, 10)}T23:59:59`) >= new Date() && (
                            <span title="Evidence behind an audited assessment stays valid for the whole audited period" style={{ color: "var(--dp-accent)", fontWeight: 600 }}>
                              valid for audit until {formatDate(item.auditedThrough)}
                            </span>
                          )}
                          <span>{formatDate(item.uploadedAt)}</span>
                          <span style={{ color: item.linkedCount > 0 ? "var(--dp-accent)" : "var(--dp-quiet)", fontWeight: item.linkedCount > 0 ? 700 : 500 }}>
                            {item.linkedCount} question{item.linkedCount !== 1 ? "s" : ""} linked
                          </span>
                        </div>
                      </div>
                      <div style={{ display: "flex", gap: 8, flexShrink: 0 }}>
                        {item.storagePath && canDownload && (
                          <button
                            className="btn btn-ghost"
                            style={{ fontSize: 12.5, padding: "6px 12px" }}
                            onClick={e => { e.stopPropagation(); handleDownload(item); }}
                          >
                            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                              <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"></path>
                              <polyline points="7 10 12 15 17 10"></polyline>
                              <line x1="12" y1="15" x2="12" y2="3"></line>
                            </svg>
                            Download
                          </button>
                        )}
                        {item.storagePath && !canDownload && (
                          <button
                            className="btn btn-ghost"
                            style={{ fontSize: 12.5, padding: "6px 12px" }}
                            onClick={e => { e.stopPropagation(); handleView(item); }}
                          >
                            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                              <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"></path>
                              <polyline points="15 3 21 3 21 9"></polyline>
                              <line x1="10" y1="14" x2="21" y2="3"></line>
                            </svg>
                            View
                          </button>
                        )}
                        {canWrite && (
                          <button
                            className="btn btn-ghost"
                            style={{ fontSize: 12.5, padding: "6px 12px" }}
                            onClick={e => { e.stopPropagation(); setEditing(item); setEditTitle(item.title); setEditDesc(item.description || ""); }}
                          >
                            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                              <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"></path>
                              <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"></path>
                            </svg>
                            Edit
                          </button>
                        )}
                        {canDelete && !item.locked && (
                          <button
                            className="btn btn-ghost"
                            style={{ fontSize: 12.5, padding: "6px 12px", color: "var(--red)" }}
                            onClick={e => { e.stopPropagation(); handleDeleteClick(item); }}
                          >
                            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                              <polyline points="3 6 5 6 21 6"></polyline>
                              <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path>
                            </svg>
                            Delete
                          </button>
                        )}
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Detail panel */}
          {selected && (
            <div className="card vault-detail-panel" style={{ width: 360, flexShrink: 0, padding: 22, position: "sticky", top: 20 }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 16 }}>
                <div style={{
                  fontSize: 26, width: 46, height: 46, borderRadius: 12,
                  display: "flex", alignItems: "center", justifyContent: "center",
                  background: "var(--dp-surface-2, rgba(163, 178, 204, 0.2))",
                  boxShadow: "var(--neu-inset-sm)"
                }}>
                  {fileIcon(selected.fileType)}
                </div>
                <button onClick={closeDetail} style={{ background: "none", border: "none", color: "var(--dp-quiet)", cursor: "pointer", fontSize: 20, lineHeight: 1 }}>×</button>
              </div>

              {detailLoading ? (
                <div style={{ textAlign: "center", padding: 24, color: "var(--dp-quiet)" }}>Loading…</div>
              ) : selectedDetail ? (
                <>
                  <div style={{ fontFamily: "var(--dp-font-sans, 'Sora')", fontWeight: 700, fontSize: 16, marginBottom: 8, wordBreak: "break-word", color: "var(--dp-ink)" }}>
                    {selectedDetail.title}
                  </div>
                  {selectedDetail.approvalState === "audited" ? (
                    <div style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 12, color: "var(--red)", background: "rgba(239,68,68,0.08)", border: "1px solid rgba(239,68,68,0.25)", borderRadius: 8, padding: "6px 12px", marginBottom: 12, fontWeight: 600 }}>
                      🔒 <span>Locked — linked to an audited control. Upload new evidence as a separate item.</span>
                    </div>
                  ) : selectedDetail.approvalState === "approved" ? (
                    <div style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 12, color: "var(--amber)", background: "rgba(245,158,11,0.08)", border: "1px solid rgba(245,158,11,0.3)", borderRadius: 8, padding: "6px 12px", marginBottom: 12, fontWeight: 600 }}>
                      🔒 <span>Linked to a reviewer-approved control — changing this file sends the control back for review.</span>
                    </div>
                  ) : selectedDetail.locked && (
                    <div style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 12, color: "var(--red)", background: "rgba(239,68,68,0.08)", border: "1px solid rgba(239,68,68,0.25)", borderRadius: 8, padding: "6px 12px", marginBottom: 12, fontWeight: 600 }}>
                      🔒 <span>Locked — linked to a reviewer-approved control</span>
                    </div>
                  )}
                  {selectedDetail.description && (
                    <div style={{ fontFamily: "var(--dp-font-sans)", fontSize: 13.5, color: "var(--dp-quiet)", marginBottom: 14, lineHeight: 1.5 }}>
                      {selectedDetail.description}
                    </div>
                  )}

                  {/* Image preview */}
                  {previewUrl && (
                    <div style={{ marginBottom: 14, borderRadius: 10, overflow: "hidden", border: "1px solid var(--dp-line, rgba(163,178,204,0.6))" }}>
                      <img src={previewUrl} alt={selectedDetail.title} style={{ width: "100%", display: "block", maxHeight: 200, objectFit: "contain" }} />
                    </div>
                  )}

                  <div style={{ display: "flex", flexDirection: "column", gap: 8, fontSize: 12.5, fontFamily: "var(--dp-font-mono)", color: "var(--dp-ink)", marginBottom: 18 }}>
                    {selectedDetail.fileName && (
                      <div><span style={{ color: "var(--dp-quiet)" }}>File: </span>{selectedDetail.fileName}</div>
                    )}
                    {selectedDetail.fileType && (
                      <div><span style={{ color: "var(--dp-quiet)" }}>Type: </span>{selectedDetail.fileType}</div>
                    )}
                    {selectedDetail.fileSize && (
                      <div><span style={{ color: "var(--dp-quiet)" }}>Size: </span>{formatBytes(selectedDetail.fileSize)}</div>
                    )}
                    <div><span style={{ color: "var(--dp-quiet)" }}>Uploaded by: </span>{selectedDetail.uploadedBy || "—"}</div>
                    <div><span style={{ color: "var(--dp-quiet)" }}>Date: </span>{formatDate(selectedDetail.uploadedAt)}</div>
                  </div>

                  {selectedDetail.storagePath && (
                    <button className="btn btn-ghost" style={{ width: "100%", marginBottom: 8 }} onClick={() => handleViewInBrowser(selectedDetail)}>
                      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" style={{ marginRight: 6 }}>
                        <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"></path>
                        <polyline points="15 3 21 3 21 9"></polyline>
                        <line x1="10" y1="14" x2="21" y2="3"></line>
                      </svg>
                      View file in browser
                    </button>
                  )}
                  {selectedDetail.storagePath && canDownload && (
                    <button className="btn btn-primary" style={{ width: "100%", marginBottom: 8 }} onClick={() => handleDownload(selectedDetail)}>
                      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" style={{ marginRight: 6 }}>
                        <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"></path>
                        <polyline points="7 10 12 15 17 10"></polyline>
                        <line x1="12" y1="15" x2="12" y2="3"></line>
                      </svg>
                      Download
                    </button>
                  )}
                  {canWrite && selectedDetail.approvalState !== "audited" && (
                    <button
                      className="btn btn-ghost"
                      style={{ width: "100%", marginBottom: 8, fontSize: 13 }}
                      onClick={() => { setShowUploadVersion(true); setVersionError(""); }}
                    >
                      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" style={{ marginRight: 6 }}>
                        <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"></path>
                        <polyline points="17 8 12 3 7 8"></polyline>
                        <line x1="12" y1="3" x2="12" y2="15"></line>
                      </svg>
                      Upload New Version
                    </button>
                  )}

                  <EvidenceAiPanel evidence={selectedDetail} />

                  {/* Version history */}
                  <div style={{ borderTop: "1px solid var(--border2)", paddingTop: 14, marginBottom: 16 }}>
                    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 10 }}>
                      <div style={{ fontWeight: 600, fontSize: 13, color: "var(--text2)" }}>Version History</div>
                      {!showVersionHistory && (
                        <button
                          style={{ background: "none", border: "none", color: "var(--accent)", cursor: "pointer", fontSize: 12, padding: 0 }}
                          onClick={() => loadVersions(selectedDetail.id)}
                          disabled={versionsLoading}
                        >
                          {versionsLoading ? "Loading…" : "Show"}
                        </button>
                      )}
                      {showVersionHistory && (
                        <button
                          style={{ background: "none", border: "none", color: "var(--text3)", cursor: "pointer", fontSize: 12, padding: 0 }}
                          onClick={() => setShowVersionHistory(false)}
                        >
                          Hide
                        </button>
                      )}
                    </div>
                    {showVersionHistory && (
                      versions.length === 0 ? (
                        <p style={{ fontSize: 12, color: "var(--text3)", margin: 0 }}>No versions recorded yet.</p>
                      ) : (
                        <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                          {versions.map((ver, idx) => (
                            <div key={ver.id} style={{ padding: "8px 10px", background: "var(--bg3)", borderRadius: 6, border: idx === 0 ? "1px solid var(--accent)" : "1px solid transparent" }}>
                              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 4 }}>
                                <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                                  <span style={{ fontFamily: "var(--mono)", fontSize: 12, fontWeight: 700, color: idx === 0 ? "var(--accent)" : "var(--text2)" }}>
                                    v{ver.versionNumber}
                                  </span>
                                  {idx === 0 && (
                                    <span style={{ fontSize: 10, background: "var(--accent)", color: "#fff", padding: "1px 5px", borderRadius: 3, fontWeight: 600 }}>LATEST</span>
                                  )}
                                </div>
                                <div style={{ display: "flex", gap: 4 }}>
                                  {ver.storagePath && canDownload && (
                                    <button
                                      style={{ background: "none", border: "none", color: "var(--accent)", cursor: "pointer", fontSize: 11, padding: "2px 4px" }}
                                      onClick={() => handleDownloadVersion(selectedDetail.id, ver)}
                                      title="Download"
                                    >
                                      ↓
                                    </button>
                                  )}
                                  {ver.storagePath && !canDownload && (
                                    <button
                                      style={{ background: "none", border: "none", color: "var(--accent)", cursor: "pointer", fontSize: 11, padding: "2px 4px" }}
                                      onClick={() => handleViewVersion(selectedDetail.id, ver)}
                                      title="View"
                                    >
                                      ↗
                                    </button>
                                  )}
                                  {idx !== 0 && canWrite && selectedDetail.approvalState !== "audited" && (
                                    <button
                                      style={{ background: "none", border: "none", color: "var(--text3)", cursor: "pointer", fontSize: 11, padding: "2px 4px" }}
                                      onClick={() => handleRestoreVersion(ver)}
                                      disabled={restoringVersionId === ver.id}
                                      title="Restore this version"
                                    >
                                      {restoringVersionId === ver.id ? "…" : "↺"}
                                    </button>
                                  )}
                                </div>
                              </div>
                              <div style={{ fontSize: 11, color: "var(--text3)" }}>{formatDate(ver.uploadedAt)}</div>
                              {ver.uploadedBy && <div style={{ fontSize: 11, color: "var(--text3)" }}>by {ver.uploadedBy}</div>}
                              {ver.fileName && <div style={{ fontSize: 11, color: "var(--text3)", marginTop: 2, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{ver.fileName}</div>}
                              {ver.versionNotes && <div style={{ fontSize: 11, color: "var(--text2)", marginTop: 4, fontStyle: "italic" }}>{ver.versionNotes}</div>}
                            </div>
                          ))}
                        </div>
                      )
                    )}
                  </div>

                  {/* Linked questions */}
                  <div style={{ borderTop: "1px solid var(--border2)", paddingTop: 14 }}>
                    <div style={{ fontWeight: 600, fontSize: 13, marginBottom: 10, color: "var(--text2)" }}>
                      Linked Questions ({selectedDetail.linkedQuestions?.length || 0})
                    </div>
                    {selectedDetail.linkedQuestions?.length === 0 ? (
                      <p style={{ fontSize: 12, color: "var(--text3)", margin: 0 }}>Not linked to any questions yet.</p>
                    ) : (
                      <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                        {selectedDetail.linkedQuestions.map(q => {
                          const dueInfo = computeDueDate(selectedDetail.uploadedAt, q.recurrenceInterval, q.nextDueDate);
                          return (
                            <div key={q.questId} style={{ padding: "8px 10px", background: "var(--bg3)", borderRadius: 6 }}>
                              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                                <div>
                                  <div
                                    style={{ fontFamily: "var(--mono)", fontSize: 12, color: "var(--accent)", fontWeight: 600, cursor: "pointer", textDecoration: "underline" }}
                                    onClick={() => navigate(`/questions/${q.questId}`)}
                                  >
                                    {q.questId}
                                  </div>
                                  {q.controlArea && <div style={{ fontSize: 11, color: "var(--text3)", marginTop: 1 }}>{q.controlArea}</div>}
                                </div>
                                {canWrite && !q.isReviewed && (
                                  <button
                                    onClick={() => handleUnlink(q.questId)}
                                    style={{ background: "none", border: "none", color: "var(--text3)", cursor: "pointer", fontSize: 12, padding: "2px 6px" }}
                                    title="Unlink"
                                  >
                                    ×
                                  </button>
                                )}
                                {q.isReviewed && (
                                  <span title="Control has been reviewed — link cannot be removed" style={{ fontSize: 11, cursor: "default", padding: "2px 6px" }}>🔒</span>
                                )}
                              </div>
                              {dueInfo && (
                                <div style={{ marginTop: 5, display: "flex", gap: 4, alignItems: "center", fontSize: 10 }}>
                                  <span style={{ color: "var(--text3)" }}>🔄 {q.recurrenceInterval || "monthly"}</span>
                                  <span style={{ color: "var(--text3)" }}>·</span>
                                  <span style={{ color: dueInfo.overdue ? "var(--red)" : dueInfo.soon ? "var(--amber)" : "var(--green)", fontWeight: 600 }}>
                                    {dueInfo.overdue ? "⚠ Overdue" : dueInfo.soon ? `⏳ Due in ${dueInfo.daysLeft}d` : `✓ Due ${dueInfo.dateStr}`}
                                  </span>
                                </div>
                              )}
                            </div>
                          );
                        })}
                      </div>
                    )}
                  </div>
                </>
              ) : null}
            </div>
          )}
        </div>
      </div>

      {/* Upload modal */}
      {showUpload && (
        <div className="modal-overlay" onClick={() => setShowUpload(false)}>
          <div className="module-modal" style={{ maxWidth: 480 }} onClick={e => e.stopPropagation()}>
            <div className="module-modal-header">
              <div className="module-modal-title">Upload to Evidence Vault</div>
              <button className="modal-close" onClick={() => setShowUpload(false)}>×</button>
            </div>
            <div className="module-modal-content" style={{ padding: 20, display: "flex", flexDirection: "column", gap: 14 }}>
              <div>
                <label style={{ fontSize: 12, color: "var(--text3)", display: "block", marginBottom: 4 }}>Title *</label>
                <input
                  type="text"
                  value={uploadTitle}
                  onChange={e => setUploadTitle(e.target.value)}
                  placeholder="e.g. ISO 27001 Certificate 2025"
                  style={{ width: "100%", padding: "8px 12px", borderRadius: 6, border: "1px solid var(--border2)", background: "var(--bg3)", color: "var(--text)", fontSize: 13, boxSizing: "border-box" }}
                />
              </div>
              <div>
                <label style={{ fontSize: 12, color: "var(--text3)", display: "block", marginBottom: 4 }}>Description</label>
                <textarea
                  value={uploadDesc}
                  onChange={e => setUploadDesc(e.target.value)}
                  placeholder="Brief description of what this evidence demonstrates…"
                  rows={3}
                  style={{ width: "100%", padding: "8px 12px", borderRadius: 6, border: "1px solid var(--border2)", background: "var(--bg3)", color: "var(--text)", fontSize: 13, resize: "vertical", boxSizing: "border-box" }}
                />
              </div>
              <div>
                <label style={{ fontSize: 12, color: "var(--text3)", display: "block", marginBottom: 4 }}>File *</label>
                <div
                  onDragOver={e => { e.preventDefault(); setUploadDrag(true); }}
                  onDragLeave={() => setUploadDrag(false)}
                  onDrop={e => { e.preventDefault(); setUploadDrag(false); if (e.dataTransfer.files[0]) setUploadFile(e.dataTransfer.files[0]); }}
                  onClick={() => fileInputRef.current?.click()}
                  style={{
                    border: `2px dashed ${uploadDrag ? "var(--accent)" : "var(--border2)"}`,
                    borderRadius: 8, padding: "20px 16px", textAlign: "center",
                    cursor: "pointer", background: uploadDrag ? "rgba(99,102,241,0.05)" : "var(--bg3)",
                    transition: "all 0.15s"
                  }}
                >
                  <input ref={fileInputRef} type="file" style={{ display: "none" }} onChange={e => setUploadFile(e.target.files[0])} />
                  {uploadFile ? (
                    <div>
                      <div style={{ fontSize: 24 }}>{fileIcon(uploadFile.type)}</div>
                      <div style={{ fontSize: 13, fontWeight: 600, marginTop: 4 }}>{uploadFile.name}</div>
                      <div style={{ fontSize: 11, color: "var(--text3)" }}>{formatBytes(uploadFile.size)}</div>
                    </div>
                  ) : (
                    <div style={{ color: "var(--text3)", fontSize: 13 }}>
                      <div style={{ fontSize: 24, marginBottom: 6 }}>📁</div>
                      Drag a file here or click to browse
                    </div>
                  )}
                </div>
              </div>
              {uploadError && <div style={{ fontSize: 12, color: "var(--red)" }}>✗ {uploadError}</div>}
              <div style={{ display: "flex", gap: 8 }}>
                <button className="btn btn-primary" style={{ flex: 1 }} onClick={handleUpload} disabled={uploading}>
                  {uploading ? "Uploading…" : "Upload to Vault"}
                </button>
                <button className="btn btn-ghost" onClick={() => setShowUpload(false)}>Cancel</button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Edit modal */}
      {editing && (
        <div className="modal-overlay" onClick={() => setEditing(null)}>
          <div className="module-modal" style={{ maxWidth: 440 }} onClick={e => e.stopPropagation()}>
            <div className="module-modal-header">
              <div className="module-modal-title">Edit Evidence</div>
              <button className="modal-close" onClick={() => setEditing(null)}>×</button>
            </div>
            <div className="module-modal-content" style={{ padding: 20, display: "flex", flexDirection: "column", gap: 14 }}>
              <div>
                <label style={{ fontSize: 12, color: "var(--text3)", display: "block", marginBottom: 4 }}>Title *</label>
                <input
                  type="text"
                  value={editTitle}
                  onChange={e => setEditTitle(e.target.value)}
                  style={{ width: "100%", padding: "8px 12px", borderRadius: 6, border: "1px solid var(--border2)", background: "var(--bg3)", color: "var(--text)", fontSize: 13, boxSizing: "border-box" }}
                />
              </div>
              <div>
                <label style={{ fontSize: 12, color: "var(--text3)", display: "block", marginBottom: 4 }}>Description</label>
                <textarea
                  value={editDesc}
                  onChange={e => setEditDesc(e.target.value)}
                  rows={3}
                  style={{ width: "100%", padding: "8px 12px", borderRadius: 6, border: "1px solid var(--border2)", background: "var(--bg3)", color: "var(--text)", fontSize: 13, resize: "vertical", boxSizing: "border-box" }}
                />
              </div>
              <div style={{ display: "flex", gap: 8 }}>
                <button className="btn btn-primary" style={{ flex: 1 }} onClick={handleEdit} disabled={editSaving}>
                  {editSaving ? "Saving…" : "Save Changes"}
                </button>
                <button className="btn btn-ghost" onClick={() => setEditing(null)}>Cancel</button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Upload new version modal */}
      {showUploadVersion && selectedDetail && (
        <div className="modal-overlay" onClick={() => setShowUploadVersion(false)}>
          <div className="module-modal" style={{ maxWidth: 480 }} onClick={e => e.stopPropagation()}>
            <div className="module-modal-header">
              <div className="module-modal-title">Upload New Version</div>
              <button className="modal-close" onClick={() => setShowUploadVersion(false)}>×</button>
            </div>
            <div className="module-modal-content" style={{ padding: 20, display: "flex", flexDirection: "column", gap: 14 }}>
              <div style={{ fontSize: 13, color: "var(--text2)" }}>
                Uploading a new version of <strong>{selectedDetail.title}</strong>. The previous file is kept in version history.
              </div>
              <div>
                <label style={{ fontSize: 12, color: "var(--text3)", display: "block", marginBottom: 4 }}>File *</label>
                <div
                  onDragOver={e => { e.preventDefault(); setVersionDrag(true); }}
                  onDragLeave={() => setVersionDrag(false)}
                  onDrop={e => { e.preventDefault(); setVersionDrag(false); if (e.dataTransfer.files[0]) setVersionFile(e.dataTransfer.files[0]); }}
                  onClick={() => versionFileInputRef.current?.click()}
                  style={{
                    border: `2px dashed ${versionDrag ? "var(--accent)" : "var(--border2)"}`,
                    borderRadius: 8, padding: "20px 16px", textAlign: "center",
                    cursor: "pointer", background: versionDrag ? "rgba(99,102,241,0.05)" : "var(--bg3)",
                    transition: "all 0.15s"
                  }}
                >
                  <input ref={versionFileInputRef} type="file" style={{ display: "none" }} onChange={e => setVersionFile(e.target.files[0])} />
                  {versionFile ? (
                    <div>
                      <div style={{ fontSize: 24 }}>{fileIcon(versionFile.type)}</div>
                      <div style={{ fontSize: 13, fontWeight: 600, marginTop: 4 }}>{versionFile.name}</div>
                      <div style={{ fontSize: 11, color: "var(--text3)" }}>{formatBytes(versionFile.size)}</div>
                    </div>
                  ) : (
                    <div style={{ color: "var(--text3)", fontSize: 13 }}>
                      <div style={{ fontSize: 24, marginBottom: 6 }}>📁</div>
                      Drag a file here or click to browse
                    </div>
                  )}
                </div>
              </div>
              <div>
                <label style={{ fontSize: 12, color: "var(--text3)", display: "block", marginBottom: 4 }}>Version notes (optional)</label>
                <input
                  type="text"
                  value={versionNotes}
                  onChange={e => setVersionNotes(e.target.value)}
                  placeholder="e.g. Updated after Q3 audit"
                  style={{ width: "100%", padding: "8px 12px", borderRadius: 6, border: "1px solid var(--border2)", background: "var(--bg3)", color: "var(--text)", fontSize: 13, boxSizing: "border-box" }}
                />
              </div>
              {versionError && <div style={{ fontSize: 12, color: "var(--red)" }}>✗ {versionError}</div>}
              <div style={{ display: "flex", gap: 8 }}>
                <button className="btn btn-primary" style={{ flex: 1 }} onClick={handleUploadVersion} disabled={uploadingVersion}>
                  {uploadingVersion ? "Uploading…" : "Upload Version"}
                </button>
                <button className="btn btn-ghost" onClick={() => { setShowUploadVersion(false); setVersionFile(null); setVersionNotes(""); }}>Cancel</button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Set/Reset PIN modal (admin only) */}
      {showSetPin && (
        <div className="modal-overlay" onClick={() => setShowSetPin(false)}>
          <div className="module-modal" style={{ maxWidth: 380 }} onClick={e => e.stopPropagation()}>
            <div className="module-modal-header">
              <div className="module-modal-title">{pinSet ? "Reset Vault PIN" : "Set Vault PIN"}</div>
              <button className="modal-close" onClick={() => setShowSetPin(false)}>×</button>
            </div>
            <div className="module-modal-content" style={{ padding: 20, display: "flex", flexDirection: "column", gap: 14 }}>
              <div style={{ fontSize: 13, color: "var(--text2)" }}>
                {pinSet
                  ? "Enter a new 6-digit PIN. All existing vault sessions will need to re-enter the new PIN."
                  : "Set a 6-digit numeric PIN. All users (except admins) will need to enter it to access the vault."}
              </div>
              <input
                type="password"
                inputMode="numeric"
                maxLength={6}
                value={newPin}
                onChange={e => setNewPin(e.target.value.replace(/\D/g, "").slice(0, 6))}
                onKeyDown={e => e.key === "Enter" && handleSetPin()}
                placeholder="6-digit PIN"
                autoFocus
                style={{ width: "100%", padding: "10px 14px", borderRadius: 8, border: "1px solid var(--border2)", background: "var(--bg3)", color: "var(--text)", fontSize: 20, textAlign: "center", letterSpacing: 6, boxSizing: "border-box" }}
              />
              {adminPinError && <div style={{ fontSize: 12, color: "var(--red)" }}>✗ {adminPinError}</div>}
              <div style={{ display: "flex", gap: 8 }}>
                <button className="btn btn-primary" style={{ flex: 1 }} onClick={handleSetPin} disabled={setPinSaving}>
                  {setPinSaving ? "Saving…" : pinSet ? "Reset PIN" : "Set PIN"}
                </button>
                <button className="btn btn-ghost" onClick={() => setShowSetPin(false)}>Cancel</button>
              </div>
              {pinSet && (
                <button
                  className="btn btn-ghost"
                  style={{ color: "var(--red)", fontSize: 12 }}
                  onClick={() => { setShowSetPin(false); handleRemovePin(); }}
                  disabled={removingPin}
                >
                  {removingPin ? "Removing…" : "Remove PIN (open access)"}
                </button>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Cooldown PIN verification modal */}
      {cooldownPinModal && (
        <div className="modal-overlay" onClick={() => setCooldownPinModal(false)}>
          <div className="module-modal" style={{ maxWidth: 360, textAlign: "center" }} onClick={e => e.stopPropagation()}>
            <div className="module-modal-header">
              <div className="module-modal-title">Vault PIN required</div>
              <button className="modal-close" onClick={() => setCooldownPinModal(false)}>×</button>
            </div>
            <div className="module-modal-content" style={{ padding: 24, display: "flex", flexDirection: "column", gap: 14 }}>
              <div style={{ fontSize: 13, color: "var(--text2)" }}>
                Enter your vault PIN to reset the cooldown and regain access.
              </div>
              <input
                type="password"
                inputMode="numeric"
                maxLength={6}
                value={cooldownPinInput}
                onChange={e => { setCooldownPinInput(e.target.value.replace(/\D/g, "").slice(0, 6)); setCooldownPinError(""); }}
                onKeyDown={e => e.key === "Enter" && handleCooldownPinVerify()}
                placeholder="••••••"
                autoFocus
                style={{ width: "100%", padding: "10px 14px", borderRadius: 8, border: `1px solid ${cooldownPinError ? "var(--red)" : "var(--border2)"}`, background: "var(--bg3)", color: "var(--text)", fontSize: 22, textAlign: "center", letterSpacing: 8, boxSizing: "border-box" }}
              />
              {cooldownPinError && <div style={{ fontSize: 12, color: "var(--red)" }}>✗ {cooldownPinError}</div>}
              <div style={{ display: "flex", gap: 8 }}>
                <button className="btn btn-primary" style={{ flex: 1 }} onClick={handleCooldownPinVerify} disabled={cooldownPinVerifying}>
                  {cooldownPinVerifying ? "Verifying…" : "Unlock & reset"}
                </button>
                <button className="btn btn-ghost" onClick={() => setCooldownPinModal(false)}>Cancel</button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Delete confirmation modal */}
      {deleteConfirm && (
        <div className="modal-overlay" onClick={() => setDeleteConfirm(null)}>
          <div className="module-modal" style={{ maxWidth: 400 }} onClick={e => e.stopPropagation()}>
            <div className="module-modal-header">
              <div className="module-modal-title">Delete Evidence</div>
              <button className="modal-close" onClick={() => setDeleteConfirm(null)}>×</button>
            </div>
            <div className="module-modal-content" style={{ padding: 20 }}>
              <p style={{ fontSize: 14, marginBottom: 16 }}>
                <strong>{deleteConfirm.item.title}</strong> is currently linked to{" "}
                <strong>{deleteConfirm.linkedCount} question{deleteConfirm.linkedCount !== 1 ? "s" : ""}</strong>.
                Deleting it will remove all those links.
              </p>
              <div style={{ display: "flex", gap: 8 }}>
                <button
                  className="btn btn-ghost"
                  style={{ flex: 1, color: "var(--red)", borderColor: "var(--red)" }}
                  onClick={handleForceDelete}
                  disabled={deleting}
                >
                  {deleting ? "Deleting…" : "Delete anyway"}
                </button>
                <button className="btn btn-ghost" onClick={() => setDeleteConfirm(null)}>Cancel</button>
              </div>
            </div>
          </div>
        </div>
      )}
      {/* File viewer modal — in-app PDF/image preview for the detail panel */}
      {showFileViewer && selectedDetail && (
        <div className="modal-overlay" onClick={closeFileViewer}>
          <div className="module-modal" style={{ maxWidth: 860, width: "90vw" }} onClick={e => e.stopPropagation()}>
            <div className="module-modal-header">
              <div className="module-modal-title">{selectedDetail.fileName || selectedDetail.title}</div>
              <button className="modal-close" onClick={closeFileViewer}>×</button>
            </div>
            <div className="module-modal-content" style={{ padding: 0, height: "75vh", display: "flex", alignItems: "center", justifyContent: "center", background: "var(--bg3)" }}>
              {viewerLoading ? (
                <div style={{ color: "var(--text3)" }}>Loading…</div>
              ) : viewerUrl ? (
                selectedDetail.fileType?.startsWith("image/") ? (
                  <img src={viewerUrl} alt={selectedDetail.title} style={{ maxWidth: "100%", maxHeight: "100%", objectFit: "contain" }} />
                ) : (
                  <iframe src={viewerUrl} title={selectedDetail.fileName || selectedDetail.title} style={{ width: "100%", height: "100%", border: "none" }} />
                )
              ) : null}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
