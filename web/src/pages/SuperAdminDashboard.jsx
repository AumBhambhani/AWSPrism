import { useState, useEffect, useCallback, useRef } from "react";
import { useNavigate, useLocation } from "react-router-dom";
import { apiFetch, apiUpload } from "../api/client.js";
import DependencySelect from "../components/DependencySelect.jsx";

const TAB_STORAGE_KEY = "superadmin_active_tab";

function useToast() {
  const [toast, setToast] = useState(null);
  const timerRef = useRef(null);

  const showToast = useCallback((message, type = "success") => {
    if (timerRef.current) clearTimeout(timerRef.current);
    setToast({ message, type });
    timerRef.current = setTimeout(() => setToast(null), 3500);
  }, []);

  return { toast, showToast };
}

export default function SuperAdminDashboard({ token, user, onLogout, theme, onThemeToggle }) {
  // --- Tab State (persisted via sessionStorage) ---
  const [activeTab, setActiveTab] = useState(() => {
    try {
      return sessionStorage.getItem(TAB_STORAGE_KEY) || "companies";
    } catch { return "companies"; }
  });

  // --- Data State ---
  const [companies, setCompanies] = useState([]);
  const [templates, setTemplates] = useState([]);

  // --- Loading/Error per tab ---
  const [loadingCompanies, setLoadingCompanies] = useState(false);
  const [errorCompanies, setErrorCompanies] = useState(null);
  const [loadingTemplates, setLoadingTemplates] = useState(false);
  const [errorTemplates, setErrorTemplates] = useState(null);

  // --- Toast ---
  const { toast, showToast } = useToast();
  const navigate = useNavigate();

  // --- Import state ---
  const [importFile, setImportFile] = useState(null);
  const [importCompanyId, setImportCompanyId] = useState("");
  const [importFrameworkKey, setImportFrameworkKey] = useState("");
  const [frameworks, setFrameworks] = useState([]);
  const [saveAsTemplate, setSaveAsTemplate] = useState(false);
  const [templateName, setTemplateName] = useState("");
  const [importing, setImporting] = useState(false);
  const [importResult, setImportResult] = useState(null);
  const [importError, setImportError] = useState(null);
  const [dragOver, setDragOver] = useState(false);
  const [importPreview, setImportPreview] = useState(null);
  const [previewLoading, setPreviewLoading] = useState(false);
  // null = publish as a brand-new template lineage; otherwise the rootTemplateId
  // of an existing lineage this upload should be published as the next version of.
  const [publishTargetRootId, setPublishTargetRootId] = useState(null);

  // --- Modules tab state ---
  const [assignCompanyId, setAssignCompanyId] = useState({});
  const [deleteConfirm, setDeleteConfirm] = useState(null);

  // --- Template detail state ---
  const [selectedTemplate, setSelectedTemplate] = useState(null);
  const [templateVersions, setTemplateVersions] = useState([]);
  const [loadingTemplateVersions, setLoadingTemplateVersions] = useState(false);
  const [templateQuestionSearch, setTemplateQuestionSearch] = useState("");

  // --- Company detail state ---
  const [selectedCompany, setSelectedCompany] = useState(null);
  const [companyModules, setCompanyModules] = useState([]);
  const [loadingModules, setLoadingModules] = useState(false);
  const [companyImportFile, setCompanyImportFile] = useState(null);
  const [companyImporting, setCompanyImporting] = useState(false);
  const [companyImportResult, setCompanyImportResult] = useState(null);
  const [companyDragOver, setCompanyDragOver] = useState(false);
  const [companyImportPreview, setCompanyImportPreview] = useState(null);
  const [companyPreviewLoading, setCompanyPreviewLoading] = useState(false);
  const [deleteModulesConfirm, setDeleteModulesConfirm] = useState(false);

  // --- Company detail: self-assessment ---
  const [companySelfAssessment, setCompanySelfAssessment] = useState(null);
  const [loadingSelfAssessment, setLoadingSelfAssessment] = useState(false);
  const [expandedSubmission, setExpandedSubmission] = useState(null);
  const [gapReportBusy, setGapReportBusy] = useState(false);
  const [gapReportError, setGapReportError] = useState("");
  const [gapReportHtml, setGapReportHtml] = useState(null);
  const [gapReportEmailedTo, setGapReportEmailedTo] = useState(null);
  // true when the browser blocked the report tab (window.open after a long fetch is not a user gesture)
  const [gapReportPopupBlocked, setGapReportPopupBlocked] = useState(false);

  // --- Add Module form state ---
  const [newModuleId, setNewModuleId] = useState("");
  const [newModuleName, setNewModuleName] = useState("");
  const [newModuleOwner, setNewModuleOwner] = useState("");
  const [newModuleFrequency, setNewModuleFrequency] = useState("");
  const [addingModule, setAddingModule] = useState(false);

  // --- Delete single module state ---
  const [deleteModuleConfirm, setDeleteModuleConfirm] = useState(null);

  // --- Add Question form state ---
  const [newQuestId, setNewQuestId] = useState("");
  const [newQuestModuleId, setNewQuestModuleId] = useState("");
  const [newQuestControlArea, setNewQuestControlArea] = useState("");
  const [newQuestText, setNewQuestText] = useState("");
  const [newQuestPriority, setNewQuestPriority] = useState("Medium");
  const [newQuestDeps, setNewQuestDeps] = useState([]);
  const [addingQuestion, setAddingQuestion] = useState(false);
  const [questionError, setQuestionError] = useState(null);

  // --- Delete single question state ---
  const [deleteQuestionConfirm, setDeleteQuestionConfirm] = useState(null);
  const [companyQuestions, setCompanyQuestions] = useState([]);

  // --- Users tab state ---
  const [companyUsers, setCompanyUsers] = useState([]);

  // --- Branding tab state ---
  const [brandCompanyId, setBrandCompanyId] = useState("");
  const [brandColor, setBrandColor] = useState("");
  const [brandLogoFile, setBrandLogoFile] = useState(null);
  const [brandLogoPreview, setBrandLogoPreview] = useState(null);
  const [brandSaving, setBrandSaving] = useState(false);
  const [brandMsg, setBrandMsg] = useState("");
  const [brandLoading, setBrandLoading] = useState(false);
  const brandLogoRef = useRef(null);

  // --- Persist tab ---
  useEffect(() => {
    try { sessionStorage.setItem(TAB_STORAGE_KEY, activeTab); } catch {}
  }, [activeTab]);

  // --- Fetch companies ---
  const fetchCompanies = useCallback(async () => {
    setLoadingCompanies(true);
    setErrorCompanies(null);
    try {
      const data = await apiFetch("/api/superadmin/companies", { token });
      setCompanies(data || []);
    } catch (err) {
      setErrorCompanies(err.message || "Failed to load companies");
    } finally {
      setLoadingCompanies(false);
    }
  }, [token]);

  // --- Fetch templates ---
  const fetchTemplates = useCallback(async () => {
    setLoadingTemplates(true);
    setErrorTemplates(null);
    try {
      const data = await apiFetch("/api/superadmin/templates", { token });
      setTemplates(data || []);
    } catch (err) {
      setErrorTemplates(err.message || "Failed to load templates");
    } finally {
      setLoadingTemplates(false);
    }
  }, [token]);

  // --- Fetch framework catalog ---
  const fetchFrameworks = useCallback(async () => {
    try {
      const data = await apiFetch("/api/frameworks", { token });
      setFrameworks(data || []);
    } catch {
      // non-fatal — the picker just falls back to a free selection
    }
  }, [token]);

  // --- Load data on mount and tab change ---
  useEffect(() => {
    if (activeTab === "companies") fetchCompanies();
    if (activeTab === "modules") { fetchTemplates(); fetchCompanies(); }
    if (activeTab === "import") { fetchCompanies(); fetchFrameworks(); }
    if (activeTab === "branding") fetchCompanies();
  }, [activeTab, fetchCompanies, fetchTemplates, fetchFrameworks]);

  // --- Company status change (optimistic) ---
  const handleStatusChange = async (companyId, newStatus) => {
    const prev = [...companies];
    setCompanies(cs => cs.map(c => c.id === companyId ? { ...c, status: newStatus, is_verified: newStatus === "approved" } : c));
    try {
      await apiFetch(`/api/superadmin/companies/${companyId}/status`, {
        token,
        method: "PATCH",
        body: JSON.stringify({ status: newStatus }),
      });
      showToast(`Company ${newStatus} successfully`, "success");
    } catch (err) {
      setCompanies(prev);
      showToast(err.message || "Status update failed", "error");
    }
  };

  // --- Delete company ---
  const handleDeleteCompany = async (companyId, companyName) => {
    if (!window.confirm(`Permanently delete "${companyName}" and all its data? This cannot be undone.`)) return;
    try {
      await apiFetch(`/api/superadmin/companies/${companyId}`, {
        token,
        method: "DELETE",
      });
      setCompanies(cs => cs.filter(c => c.id !== companyId));
      if (selectedCompany?.id === companyId) setSelectedCompany(null);
      showToast(`Company "${companyName}" deleted`, "success");
    } catch (err) {
      showToast(err.message || "Delete failed", "error");
    }
  };

  // --- Billing update ---
  const handleBillingUpdate = async (companyId, patch) => {
    try {
      const updated = await apiFetch(`/api/superadmin/companies/${companyId}/billing`, {
        token,
        method: "PATCH",
        body: JSON.stringify(patch),
      });
      setCompanies(cs => cs.map(c => c.id === companyId ? { ...c, ...updated } : c));
      if (selectedCompany?.id === companyId) setSelectedCompany(prev => ({ ...prev, ...updated }));
      showToast("Billing updated", "success");
    } catch (err) {
      showToast(err.message || "Billing update failed", "error");
    }
  };

  // --- Unapprove (revoke verification without changing status) ---
  const handleUnapprove = async (companyId, companyName) => {
    try {
      await apiFetch(`/api/superadmin/companies/${companyId}/unapprove`, { token, method: "PATCH" });
      setCompanies(cs => cs.map(c => c.id === companyId ? { ...c, is_verified: false } : c));
      if (selectedCompany?.id === companyId) setSelectedCompany(prev => ({ ...prev, is_verified: false }));
      showToast(`Verification revoked for ${companyName}`, "success");
    } catch (err) {
      showToast(err.message || "Unapprove failed", "error");
    }
  };

  // --- Start Onboarding (wipe dept data + reset flag) — kept for API use ---
  const handleStartOnboarding = async (companyId, companyName) => {
    if (!window.confirm(`This will delete all department modules/questions for "${companyName}" and show the department selection on their next login. Continue?`)) return;
    try {
      await apiFetch(`/api/superadmin/companies/${companyId}/start-onboarding`, { token, method: "PATCH" });
      showToast(`Onboarding started fresh for ${companyName}`, "success");
    } catch (err) {
      showToast(err.message || "Failed to start onboarding", "error");
    }
  };

  // --- AI toggle (optimistic) ---
  const handleResetOnboarding = async (companyId, companyName) => {
    try {
      const result = await apiFetch(`/api/superadmin/companies/${companyId}/reset-onboarding`, { token, method: "PATCH" });
      showToast(`Policy onboarding reset for ${companyName} (${result.usersUpdated} admin${result.usersUpdated !== 1 ? "s" : ""})`, "success");
    } catch (err) {
      showToast(err.message || "Failed to reset onboarding", "error");
    }
  };

  const handleAIToggle = async (companyId, currentVal) => {
    const newVal = !currentVal;
    const prev = [...companies];
    setCompanies(cs => cs.map(c => c.id === companyId ? { ...c, ai_enabled: newVal } : c));
    try {
      await apiFetch(`/api/superadmin/companies/${companyId}/ai-toggle`, {
        token,
        method: "PATCH",
        body: JSON.stringify({ aiEnabled: newVal }),
      });
      showToast(`AI ${newVal ? "enabled" : "disabled"} successfully`, "success");
    } catch (err) {
      setCompanies(prev);
      showToast(err.message || "AI toggle failed", "error");
    }
  };

  const handleAIProviderChange = async (companyId, rawValue) => {
    const aiProvider = rawValue || null; // "" (Default) -> null
    const prev = [...companies];
    setCompanies(cs => cs.map(c => c.id === companyId ? { ...c, ai_provider: aiProvider } : c));
    try {
      await apiFetch(`/api/superadmin/companies/${companyId}/ai-provider`, {
        token,
        method: "PATCH",
        body: JSON.stringify({ aiProvider }),
      });
      const label = aiProvider === "azure" ? "Azure" : aiProvider === "bedrock" ? "AWS Bedrock" : "platform default";
      showToast(`AI provider set to ${label}`, "success");
    } catch (err) {
      setCompanies(prev);
      showToast(err.message || "Failed to change AI provider", "error");
    }
  };

  // --- Import handler ---
  const handleImport = async () => {
    if (!importFile) return;
    setImporting(true);
    setImportResult(null);
    setImportError(null);
    try {
      const body = {};
      if (importCompanyId) body.companyId = importCompanyId;
      if (importFrameworkKey) body.frameworkKey = importFrameworkKey;
      if (saveAsTemplate || publishTargetRootId) {
        body.saveAsTemplate = "true";
        body.templateName = templateName || importFile.name;
      }
      if (publishTargetRootId) body.publishAsVersionOf = publishTargetRootId;
      const result = await apiUpload("/api/superadmin/import-modules", importFile, body, token);
      setImportResult(result);
      showToast(
        result.publishedVersion
          ? `Published v${result.publishedVersion} — ${result.notifiedCompanyCount} compan${result.notifiedCompanyCount === 1 ? "y" : "ies"} notified`
          : "Import completed successfully",
        "success"
      );
      setImportFile(null);
      setSaveAsTemplate(false);
      setTemplateName("");
      setImportCompanyId("");
      setImportFrameworkKey("");
      setPublishTargetRootId(null);
    } catch (err) {
      setImportError(err.message || "Import failed");
      showToast(err.message || "Import failed", "error");
    } finally {
      setImporting(false);
    }
  };

  // --- File validation ---
  const validateFile = (file) => {
    if (!file) return null;
    const validExts = [".xlsx", ".xls"];
    const ext = file.name.substring(file.name.lastIndexOf(".")).toLowerCase();
    if (!validExts.includes(ext)) return "Only .xlsx and .xls files are allowed";
    if (file.size > 10 * 1024 * 1024) return "File size must be under 10MB";
    return null;
  };

  const fetchPreview = async (file, setPreview, setLoading) => {
    setLoading(true);
    setPreview(null);
    try {
      const result = await apiUpload("/api/superadmin/preview-import", file, {}, token);
      setPreview(result);
    } catch (err) {
      setPreview({ error: err.message || "Preview failed" });
    } finally {
      setLoading(false);
    }
  };

  const handleFileSelect = (file) => {
    const err = validateFile(file);
    if (err) {
      showToast(err, "error");
      return;
    }
    setImportFile(file);
    setImportResult(null);
    setImportError(null);
    setImportFrameworkKey("");
    setPublishTargetRootId(null);
    fetchPreview(file, setImportPreview, setPreviewLoading);
  };

  // Prefill the framework picker from the server's filename-based guess.
  useEffect(() => {
    if (importPreview?.frameworkGuess && !importFrameworkKey) {
      setImportFrameworkKey(importPreview.frameworkGuess);
    }
  }, [importPreview, importFrameworkKey]);

  // Prefill the publish target from the best-scoring match, but only ever as a
  // suggestion — the superadmin can always switch to a different target or to
  // "create new" via the radio picker below.
  useEffect(() => {
    if (!importPreview?.templateMatches?.length) return;
    const best = importPreview.templateMatches[0];
    if (best.score >= 0.5) {
      setPublishTargetRootId(best.rootTemplateId);
      setSaveAsTemplate(true);
      setTemplateName((prev) => prev || best.name);
    }
  }, [importPreview]);

  // --- Template assign ---
  const handleAssignTemplate = async (templateId) => {
    const companyId = assignCompanyId[templateId];
    if (!companyId) {
      showToast("Please select a company", "error");
      return;
    }
    try {
      const result = await apiFetch(`/api/superadmin/templates/${templateId}/assign`, {
        token,
        method: "POST",
        body: JSON.stringify({ companyId }),
      });
      showToast(`Assigned ${result.moduleCount} modules, ${result.questionCount} questions`, "success");
      setAssignCompanyId(prev => ({ ...prev, [templateId]: "" }));
    } catch (err) {
      showToast(err.message || "Assignment failed", "error");
    }
  };

  // --- Template delete ---
  const handleDeleteTemplate = async (templateId) => {
    try {
      await apiFetch(`/api/superadmin/templates/${templateId}`, {
        token,
        method: "DELETE",
      });
      setTemplates(ts => ts.filter(t => t.id !== templateId));
      showToast("Template deleted", "success");
      setDeleteConfirm(null);
    } catch (err) {
      showToast(err.message || "Delete failed", "error");
    }
  };

  const location = useLocation();

  // Load company data without touching history (used by both open and forward-restore).
  const loadCompanyData = useCallback(async (company) => {
    setSelectedCompany(company);
    setCompanyModules([]);
    setCompanyQuestions([]);
    setCompanyUsers([]);
    setCompanyImportFile(null);
    setCompanyImportResult(null);
    setDeleteModulesConfirm(false);
    setDeleteModuleConfirm(null);
    setDeleteQuestionConfirm(null);
    setQuestionError(null);
    setCompanySelfAssessment(null);
    setExpandedSubmission(null);
    setGapReportError("");
    setGapReportHtml(null);
    setGapReportEmailedTo(null);
    setLoadingModules(true);
    setLoadingSelfAssessment(true);
    try {
      const [modulesData, questionsData, usersData] = await Promise.all([
        apiFetch(`/api/superadmin/companies/${company.id}/modules`, { token }),
        apiFetch(`/api/superadmin/companies/${company.id}/questions`, { token }),
        apiFetch(`/api/superadmin/companies/${company.id}/users`, { token }),
      ]);
      setCompanyModules(modulesData || []);
      setCompanyQuestions(questionsData || []);
      setCompanyUsers(usersData || []);
    } catch {
      setCompanyModules([]);
      setCompanyQuestions([]);
      setCompanyUsers([]);
    }
    setLoadingModules(false);

    try {
      const sa = await apiFetch(`/api/superadmin/companies/${company.id}/self-assessment/submissions`, { token });
      setCompanySelfAssessment(sa || null);
    } catch {
      setCompanySelfAssessment(null);
    }
    setLoadingSelfAssessment(false);
  }, [token]);

  // Opens the server-built Big-4 readiness document (report.document) in a new
  // tab. It is already a complete paginated HTML document (Paged.js polyfill
  // inlined, its own "Download / Print PDF" button). `print` also fires the
  // browser print dialog once Paged.js has laid the pages out.
  const openGapReportWindow = (reportDoc, { print = false } = {}) => {
    const url = URL.createObjectURL(new Blob([reportDoc], { type: "text/html" }));
    const w = window.open(url, "_blank");
    setGapReportPopupBlocked(!w);
    if (print && w) {
      const fire = () => {
        try {
          w.focus();
          if (w.__pagedDone) w.print();
          else { const t = setInterval(() => { if (w.closed) return clearInterval(t); if (w.__pagedDone) { clearInterval(t); w.print(); } }, 400); setTimeout(() => clearInterval(t), 15000); }
        } catch { /* popup blocked */ }
      };
      w.addEventListener?.("load", () => setTimeout(fire, 400));
      setTimeout(fire, 2000);
    }
    setTimeout(() => URL.revokeObjectURL(url), 300000);
    return !!w;
  };

  // Fetch + (server-side) email the report, cache the HTML, and open it.
  const generateGapReport = async (refresh) => {
    if (!selectedCompany) return;
    setGapReportBusy(true);
    setGapReportError("");
    try {
      const qs = new URLSearchParams({ email: "1" });
      if (refresh) qs.set("refresh", "1");
      const data = await apiFetch(
        `/api/superadmin/companies/${selectedCompany.id}/self-assessment?${qs}`,
        { token, timeout: 120000 }
      );
      const doc = data?.report?.document;
      if (!doc) {
        setGapReportError("No submissions yet — nothing to report on.");
        return;
      }
      setGapReportHtml(doc);
      setGapReportEmailedTo(data.emailedTo || null);
      openGapReportWindow(doc);
    } catch (err) {
      setGapReportError(err.message || "Failed to generate the report.");
    } finally {
      setGapReportBusy(false);
    }
  };

  // Download as PDF — reuse the cached report if we have one, otherwise fetch it
  // (without re-sending the email), then open the print dialog.
  const downloadGapReportPdf = async () => {
    if (!selectedCompany) return;
    if (gapReportHtml) { openGapReportWindow(gapReportHtml, { print: true }); return; }
    setGapReportBusy(true);
    setGapReportError("");
    try {
      const data = await apiFetch(
        `/api/superadmin/companies/${selectedCompany.id}/self-assessment`,
        { token, timeout: 120000 }
      );
      const doc = data?.report?.document;
      if (!doc) { setGapReportError("No submissions yet — nothing to report on."); return; }
      setGapReportHtml(doc);
      openGapReportWindow(doc, { print: true });
    } catch (err) {
      setGapReportError(err.message || "Failed to generate the report.");
    } finally {
      setGapReportBusy(false);
    }
  };

  // Download as Word — the server builds the .docx from the same report; stream
  // it straight to a file (no email, no cache reuse — it is a fresh conversion).
  const downloadGapReportDocx = async () => {
    if (!selectedCompany) return;
    setGapReportBusy(true);
    setGapReportError("");
    try {
      const res = await fetch(
        `${import.meta.env.VITE_API_URL || ""}/api/superadmin/companies/${selectedCompany.id}/self-assessment?format=docx`,
        { headers: { Authorization: `Bearer ${token}` } }
      );
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error || `Download failed (${res.status})`);
      }
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `${(selectedCompany.name || "Company").replace(/[^\w.-]+/g, "_")}_DPDPA_Readiness_Assessment.docx`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
    } catch (err) {
      setGapReportError(err.message || "Failed to build the Word document.");
    } finally {
      setGapReportBusy(false);
    }
  };

  // Drive selectedCompany from location.state so back AND forward both work.
  // Back clears companyId from state → closes detail.
  // Forward restores companyId → reopens detail.
  useEffect(() => {
    const companyId = location.state?.companyId;
    if (!companyId) {
      setSelectedCompany(null);
      return;
    }
    if (selectedCompany?.id === companyId) return; // already showing
    const company = companies.find(c => c.id === companyId);
    if (company) loadCompanyData(company);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [location.state?.companyId, companies]); // selectedCompany and loadCompanyData intentionally omitted to avoid loops

  // --- Company detail: push location state so history back/forward work ---
  const openCompanyDetail = (company) => {
    navigate("/superadmin", { state: { companyId: company.id } });
  };

  // Drive selectedTemplate from location.state, same back/forward pattern as companies.
  useEffect(() => {
    const templateId = location.state?.templateId;
    if (!templateId) {
      setSelectedTemplate(null);
      return;
    }
    if (selectedTemplate?.id === templateId) return; // already showing
    const tpl = templates.find(t => t.id === templateId);
    if (tpl) {
      setSelectedTemplate(tpl);
      setTemplateQuestionSearch("");
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [location.state?.templateId, templates]); // selectedTemplate intentionally omitted to avoid loops

  // --- Template detail: push location state so history back/forward work ---
  const openTemplateDetail = (tpl) => {
    navigate("/superadmin", { state: { templateId: tpl.id } });
  };

  // --- Template detail: publish history for this lineage ---
  useEffect(() => {
    if (!selectedTemplate) {
      setTemplateVersions([]);
      return;
    }
    const rootId = selectedTemplate.root_template_id || selectedTemplate.id;
    setLoadingTemplateVersions(true);
    apiFetch(`/api/superadmin/templates/${rootId}/versions`, { token })
      .then((data) => setTemplateVersions(data || []))
      .catch(() => setTemplateVersions([]))
      .finally(() => setLoadingTemplateVersions(false));
  }, [selectedTemplate, token]);

  // --- Company detail: import for this company ---
  const handleCompanyImport = async () => {
    if (!companyImportFile || !selectedCompany) return;
    setCompanyImporting(true);
    setCompanyImportResult(null);
    try {
      const result = await apiUpload("/api/superadmin/import-modules", companyImportFile, { companyId: String(selectedCompany.id) }, token);
      setCompanyImportResult(result);
      showToast(`Imported ${result.modulesImported} modules, ${result.questionsImported} questions`, "success");
      setCompanyImportFile(null);
      // Refresh modules list
      const data = await apiFetch(`/api/superadmin/companies/${selectedCompany.id}/modules`, { token });
      setCompanyModules(data || []);
    } catch (err) {
      showToast(err.message || "Import failed", "error");
    } finally {
      setCompanyImporting(false);
    }
  };

  // --- Company detail: delete all modules ---
  const handleDeleteCompanyModules = async () => {
    if (!selectedCompany) return;
    try {
      await apiFetch(`/api/superadmin/companies/${selectedCompany.id}/modules`, {
        token,
        method: "DELETE",
      });
      setCompanyModules([]);
      setDeleteModulesConfirm(false);
      showToast("All modules and questions deleted for this company", "success");
    } catch (err) {
      showToast(err.message || "Delete failed", "error");
    }
  };

  // --- Add single module ---
  const handleAddModule = async () => {
    if (!newModuleId.trim() || !newModuleName.trim()) {
      showToast("Module ID and Name are required", "error");
      return;
    }
    setAddingModule(true);
    try {
      await apiFetch(`/api/superadmin/companies/${selectedCompany.id}/modules`, {
        token,
        method: "POST",
        body: JSON.stringify({
          moduleId: newModuleId.trim(),
          name: newModuleName.trim(),
          primaryOwner: newModuleOwner.trim() || undefined,
          frequency: newModuleFrequency.trim() || undefined,
        }),
      });
      showToast("Module added successfully", "success");
      setNewModuleId("");
      setNewModuleName("");
      setNewModuleOwner("");
      setNewModuleFrequency("");
      // Refresh modules
      const data = await apiFetch(`/api/superadmin/companies/${selectedCompany.id}/modules`, { token });
      setCompanyModules(data || []);
    } catch (err) {
      showToast(err.message || "Failed to add module", "error");
    } finally {
      setAddingModule(false);
    }
  };

  // --- Reorder module (up/down) ---
  const handleMoveModule = async (index, direction) => {
    const newIndex = index + direction;
    if (newIndex < 0 || newIndex >= companyModules.length) return;
    const reordered = [...companyModules];
    [reordered[index], reordered[newIndex]] = [reordered[newIndex], reordered[index]];
    setCompanyModules(reordered);
    try {
      await Promise.all([
        apiFetch(`/api/superadmin/companies/${selectedCompany.id}/modules/${encodeURIComponent(reordered[index].module_id)}/order`, {
          token, method: "PATCH", body: { sortOrder: index * 10 },
        }),
        apiFetch(`/api/superadmin/companies/${selectedCompany.id}/modules/${encodeURIComponent(reordered[newIndex].module_id)}/order`, {
          token, method: "PATCH", body: { sortOrder: newIndex * 10 },
        }),
      ]);
    } catch (err) {
      showToast(err.message || "Reorder failed", "error");
      const data = await apiFetch(`/api/superadmin/companies/${selectedCompany.id}/modules`, { token });
      setCompanyModules(data || []);
    }
  };

  // --- Delete single module ---
  const handleDeleteSingleModule = async (moduleId) => {
    try {
      await apiFetch(`/api/superadmin/companies/${selectedCompany.id}/modules/${encodeURIComponent(moduleId)}`, {
        token,
        method: "DELETE",
      });
      showToast("Module deleted", "success");
      setDeleteModuleConfirm(null);
      const data = await apiFetch(`/api/superadmin/companies/${selectedCompany.id}/modules`, { token });
      setCompanyModules(data || []);
    } catch (err) {
      showToast(err.message || "Delete failed", "error");
    }
  };

  // --- Add single question ---
  const handleAddQuestion = async () => {
    if (!newQuestId.trim() || !newQuestModuleId.trim()) {
      showToast("Quest ID and Module ID are required", "error");
      return;
    }
    setAddingQuestion(true);
    setQuestionError(null);
    try {
      const createdQuestId = newQuestId.trim();
      await apiFetch(`/api/superadmin/companies/${selectedCompany.id}/questions`, {
        token,
        method: "POST",
        body: JSON.stringify({
          questId: createdQuestId,
          moduleId: newQuestModuleId.trim(),
          controlArea: newQuestControlArea.trim() || undefined,
          baselineQuestion: newQuestText.trim() || undefined,
          priority: newQuestPriority,
        }),
      });
      if (newQuestDeps.length > 0) {
        try {
          await apiFetch(`/api/superadmin/companies/${selectedCompany.id}/questions/${encodeURIComponent(createdQuestId)}/dependencies`, {
            token,
            method: "PUT",
            body: JSON.stringify({ dependsOn: newQuestDeps }),
          });
        } catch (depErr) {
          showToast(`Question added but deps failed: ${depErr.message}`, "error");
        }
      }
      showToast("Question added successfully", "success");
      setNewQuestId("");
      setNewQuestModuleId("");
      setNewQuestControlArea("");
      setNewQuestText("");
      setNewQuestPriority("Medium");
      setNewQuestDeps([]);
      // Refresh questions
      try {
        const data = await apiFetch(`/api/superadmin/companies/${selectedCompany.id}/questions`, { token });
        setCompanyQuestions(data || []);
      } catch { /* ignore if endpoint not available */ }
    } catch (err) {
      setQuestionError(err.message || "Failed to add question");
      showToast(err.message || "Failed to add question", "error");
    } finally {
      setAddingQuestion(false);
    }
  };

  // --- Delete single question ---
  const handleDeleteSingleQuestion = async (questId) => {
    try {
      await apiFetch(`/api/superadmin/companies/${selectedCompany.id}/questions/${encodeURIComponent(questId)}`, {
        token,
        method: "DELETE",
      });
      showToast("Question deleted", "success");
      setDeleteQuestionConfirm(null);
      try {
        const data = await apiFetch(`/api/superadmin/companies/${selectedCompany.id}/questions`, { token });
        setCompanyQuestions(data || []);
      } catch { /* ignore */ }
    } catch (err) {
      showToast(err.message || "Delete failed", "error");
    }
  };

  // --- Branding tab render ---
  const renderBrandingTab = () => (
    <section style={{ maxWidth: 560 }}>
      <h2 style={{ fontSize: 18, fontWeight: 700, marginBottom: 4 }}>Company Branding</h2>
      <p style={{ fontSize: 13, color: "var(--text3)", marginBottom: 20 }}>
        Set a logo and accent colour for any company. Changes take effect on the company's next login.
      </p>

      <div style={{ marginBottom: 20 }}>
        <label style={{ fontSize: 12, color: "var(--text3)", display: "block", marginBottom: 6 }}>Select Company</label>
        <select
          value={brandCompanyId}
          onChange={async (e) => {
            const id = e.target.value;
            setBrandCompanyId(id);
            setBrandColor("");
            setBrandLogoPreview(null);
            setBrandLogoFile(null);
            setBrandMsg("");
            if (!id) return;
            setBrandLoading(true);
            try {
              const s = await apiFetch(`/api/superadmin/companies/${id}/settings`, { token });
              setBrandColor(s.primaryColor || "");
              setBrandLogoPreview(s.logoUrl ? `${import.meta.env.VITE_API_URL || ""}${s.logoUrl}` : null);
            } catch { /* ignore */ }
            finally { setBrandLoading(false); }
          }}
          style={{ padding: "8px 12px", borderRadius: 6, border: "1px solid var(--border2)", background: "var(--bg3)", color: "var(--text)", fontSize: 13, width: "100%" }}
        >
          <option value="">— choose a company —</option>
          {companies.map(c => <option key={c.id} value={c.id}>{c.name} ({c.domain})</option>)}
        </select>
      </div>

      {brandCompanyId && (
        brandLoading ? (
          <p style={{ fontSize: 13, color: "var(--text3)" }}>Loading…</p>
        ) : (
          <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>
            <div>
              <label style={{ fontSize: 12, color: "var(--text3)", display: "block", marginBottom: 6 }}>Company Logo</label>
              <div style={{ display: "flex", alignItems: "center", gap: 14 }}>
                {brandLogoPreview && (
                  <img src={brandLogoPreview} alt="Logo preview" style={{ height: 48, objectFit: "contain", borderRadius: 6, background: "var(--bg3)", padding: 4 }} />
                )}
                <button className="btn btn-ghost" style={{ fontSize: 13 }} onClick={() => brandLogoRef.current?.click()}>
                  {brandLogoPreview ? "Change Logo" : "Upload Logo"}
                </button>
                <input
                  ref={brandLogoRef}
                  type="file"
                  accept="image/png,image/jpeg,image/gif,image/webp"
                  style={{ display: "none" }}
                  onChange={e => {
                    const f = e.target.files?.[0];
                    if (!f) return;
                    setBrandLogoFile(f);
                    setBrandLogoPreview(URL.createObjectURL(f));
                  }}
                />
              </div>
              <p style={{ fontSize: 11, color: "var(--text3)", marginTop: 6 }}>PNG, JPG, GIF or WebP — max 2 MB</p>
            </div>

            <div>
              <label style={{ fontSize: 12, color: "var(--text3)", display: "block", marginBottom: 6 }}>Accent Colour</label>
              <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                <input
                  type="color"
                  value={brandColor || "#6366f1"}
                  onChange={e => setBrandColor(e.target.value)}
                  style={{ width: 44, height: 36, border: "none", borderRadius: 6, cursor: "pointer", background: "none", padding: 0 }}
                />
                <input
                  type="text"
                  value={brandColor}
                  onChange={e => setBrandColor(e.target.value)}
                  placeholder="#6366f1"
                  style={{ width: 110, padding: "7px 10px", borderRadius: 6, border: "1px solid var(--border2)", background: "var(--bg3)", color: "var(--text)", fontSize: 13, fontFamily: "var(--mono)" }}
                />
              </div>
            </div>

            {brandMsg && <p style={{ fontSize: 13, color: brandMsg.startsWith("✗") ? "var(--red)" : "var(--green)", margin: 0 }}>{brandMsg}</p>}

            <button
              className="btn btn-primary"
              style={{ alignSelf: "flex-start" }}
              disabled={brandSaving}
              onClick={async () => {
                setBrandSaving(true);
                setBrandMsg("");
                try {
                  if (brandLogoFile) {
                    const fd = new FormData();
                    fd.append("logo", brandLogoFile);
                    const r = await fetch(`${import.meta.env.VITE_API_URL || ""}/api/superadmin/companies/${brandCompanyId}/logo`, {
                      method: "POST",
                      headers: { Authorization: `Bearer ${token}` },
                      body: fd,
                    });
                    if (!r.ok) throw new Error("Logo upload failed");
                  }
                  await apiFetch(`/api/superadmin/companies/${brandCompanyId}/settings`, {
                    token,
                    method: "PUT",
                    body: JSON.stringify({ primaryColor: brandColor || null }),
                  });
                  setBrandMsg("✓ Saved");
                  setBrandLogoFile(null);
                } catch (e) {
                  setBrandMsg("✗ " + e.message);
                } finally {
                  setBrandSaving(false);
                }
              }}
            >
              {brandSaving ? "Saving…" : "Save Branding"}
            </button>
          </div>
        )
      )}
    </section>
  );

  // --- Styles ---
  const styles = {
    tabs: {
      display: "flex",
      gap: "0",
      borderBottom: "1px solid var(--border)",
      marginBottom: "24px",
    },
    tab: {
      padding: "12px 24px",
      background: "none",
      border: "none",
      borderBottom: "2px solid transparent",
      color: "var(--text2)",
      fontSize: "13px",
      fontWeight: 500,
      cursor: "pointer",
      transition: "all 0.15s",
      fontFamily: "var(--sans)",
    },
    tabActive: {
      color: "var(--accent2)",
      borderBottomColor: "var(--accent)",
    },
    toggle: {
      position: "relative",
      width: "36px",
      height: "20px",
      borderRadius: "10px",
      border: "none",
      cursor: "pointer",
      transition: "background 0.2s",
      padding: 0,
    },
    toggleDot: {
      position: "absolute",
      top: "3px",
      width: "14px",
      height: "14px",
      borderRadius: "50%",
      background: "#fff",
      transition: "left 0.2s",
    },
    statusBadge: {
      display: "inline-block",
      padding: "3px 8px",
      borderRadius: "12px",
      fontSize: "11px",
      fontWeight: 600,
      textTransform: "capitalize",
    },
    dropZone: {
      border: "2px dashed var(--border2)",
      borderRadius: "8px",
      padding: "40px 20px",
      textAlign: "center",
      cursor: "pointer",
      transition: "all 0.15s",
      background: "var(--bg3)",
    },
    dropZoneActive: {
      borderColor: "var(--accent)",
      background: "rgba(99,102,241,0.05)",
    },
    resultBox: {
      background: "var(--bg3)",
      border: "1px solid var(--border)",
      borderRadius: "8px",
      padding: "16px",
      marginTop: "16px",
    },
  };

  const getStatusColor = (status) => {
    switch (status) {
      case "approved": return { bg: "rgba(34,197,94,0.1)", color: "var(--green)", border: "rgba(34,197,94,0.3)" };
      case "rejected": return { bg: "rgba(239,68,68,0.1)", color: "var(--red)", border: "rgba(239,68,68,0.3)" };
      case "suspended": return { bg: "rgba(245,158,11,0.1)", color: "var(--amber)", border: "rgba(245,158,11,0.3)" };
      default: return { bg: "rgba(99,102,241,0.1)", color: "var(--accent2)", border: "rgba(99,102,241,0.3)" };
    }
  };

  // --- Render Excel Import Preview ---
  const renderImportPreview = (preview, loading) => {
    if (loading) return (
      <div style={{ padding: "16px", textAlign: "center", color: "var(--text3)", fontSize: "13px" }}>
        <div className="loading-spinner" style={{ margin: "0 auto 8px", width: "20px", height: "20px" }} />
        Parsing file…
      </div>
    );
    if (!preview) return null;
    if (preview.error) return (
      <div style={{ padding: "12px 14px", background: "rgba(239,68,68,0.08)", border: "1px solid rgba(239,68,68,0.25)", borderRadius: "7px", fontSize: "12px", color: "var(--red)", marginTop: "12px" }}>
        Preview failed: {preview.error}
      </div>
    );

    const cellStyle = { padding: "5px 10px", borderBottom: "1px solid var(--border)", fontSize: "12px", color: "var(--text2)", maxWidth: "220px", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" };
    const headStyle = { padding: "5px 10px", fontSize: "11px", fontWeight: 600, color: "var(--text3)", textAlign: "left", background: "var(--bg4)", borderBottom: "1px solid var(--border2)", whiteSpace: "nowrap" };

    return (
      <div style={{ marginTop: "14px", border: "1px solid var(--border)", borderRadius: "8px", overflow: "hidden", background: "var(--bg3)" }}>
        {/* Summary bar */}
        <div style={{ display: "flex", gap: "20px", padding: "10px 14px", background: "var(--bg4)", borderBottom: "1px solid var(--border)", alignItems: "center", flexWrap: "wrap" }}>
          <span style={{ fontSize: "12px", fontWeight: 600, color: "var(--text)" }}>Preview</span>
          <span style={{ fontSize: "12px", color: "var(--accent2)" }}>{preview.totalModules} module{preview.totalModules !== 1 ? "s" : ""}</span>
          <span style={{ fontSize: "12px", color: "var(--text2)" }}>{preview.totalQuestions} question{preview.totalQuestions !== 1 ? "s" : ""}</span>
          {preview.errors?.length > 0 && (
            <span style={{ fontSize: "12px", color: "var(--amber)" }}>⚠ {preview.errors.length} row error{preview.errors.length !== 1 ? "s" : ""}</span>
          )}
        </div>

        {/* Modules */}
        {preview.modules?.length > 0 && (
          <div style={{ overflowX: "auto" }}>
            <div style={{ padding: "8px 14px 4px", fontSize: "11px", fontWeight: 600, color: "var(--text3)", textTransform: "uppercase", letterSpacing: "0.05em" }}>Modules</div>
            <table style={{ width: "100%", borderCollapse: "collapse" }}>
              <thead>
                <tr>
                  <th style={headStyle}>Module ID</th>
                  <th style={headStyle}>Name</th>
                  <th style={headStyle}>Questions</th>
                  <th style={headStyle}>Owner</th>
                  <th style={headStyle}>Frequency</th>
                </tr>
              </thead>
              <tbody>
                {preview.modules.map((m, i) => (
                  <tr key={i} style={{ background: i % 2 === 0 ? "transparent" : "rgba(255,255,255,0.02)" }}>
                    <td style={{ ...cellStyle, fontFamily: "var(--mono)", color: "var(--accent2)" }}>{m.module_id}</td>
                    <td style={cellStyle}>{m.name || m.module_id}</td>
                    <td style={{ ...cellStyle, textAlign: "center" }}>{m.total_quests ?? 0}</td>
                    <td style={cellStyle}>{m.primary_owner || <span style={{ color: "var(--border2)" }}>—</span>}</td>
                    <td style={cellStyle}>{m.frequency || <span style={{ color: "var(--border2)" }}>—</span>}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {/* Sample Questions */}
        {preview.questions?.length > 0 && (
          <div style={{ overflowX: "auto", borderTop: "1px solid var(--border)" }}>
            <div style={{ padding: "8px 14px 4px", fontSize: "11px", fontWeight: 600, color: "var(--text3)", textTransform: "uppercase", letterSpacing: "0.05em" }}>
              Questions (showing first {Math.min(10, preview.questions.length)} of {preview.questions.length})
            </div>
            <table style={{ width: "100%", borderCollapse: "collapse" }}>
              <thead>
                <tr>
                  <th style={headStyle}>Quest ID</th>
                  <th style={headStyle}>Module ID</th>
                  <th style={{ ...headStyle, minWidth: "260px" }}>Question Text</th>
                  <th style={headStyle}>Control Area</th>
                  <th style={headStyle}>Priority</th>
                </tr>
              </thead>
              <tbody>
                {preview.questions.slice(0, 10).map((q, i) => (
                  <tr key={i} style={{ background: i % 2 === 0 ? "transparent" : "rgba(255,255,255,0.02)" }}>
                    <td style={{ ...cellStyle, fontFamily: "var(--mono)", color: "var(--accent2)" }}>{q.quest_id}</td>
                    <td style={{ ...cellStyle, fontFamily: "var(--mono)" }}>{q.module_id}</td>
                    <td style={{ ...cellStyle, whiteSpace: "normal", maxWidth: "260px" }}>{q.baseline_question || <span style={{ color: "var(--border2)" }}>—</span>}</td>
                    <td style={cellStyle}>{q.control_area || <span style={{ color: "var(--border2)" }}>—</span>}</td>
                    <td style={cellStyle}>{q.priority || "Medium"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {/* Parse errors */}
        {preview.errors?.length > 0 && (
          <div style={{ borderTop: "1px solid var(--border)", padding: "10px 14px" }}>
            <div style={{ fontSize: "11px", fontWeight: 600, color: "var(--amber)", marginBottom: "6px", textTransform: "uppercase", letterSpacing: "0.05em" }}>Row Errors / Skipped</div>
            <ul style={{ margin: 0, paddingLeft: "18px" }}>
              {preview.errors.slice(0, 10).map((e, i) => (
                <li key={i} style={{ fontSize: "11px", color: "var(--text3)", marginBottom: "2px" }}>{e}</li>
              ))}
              {preview.errors.length > 10 && (
                <li style={{ fontSize: "11px", color: "var(--text3)", fontStyle: "italic" }}>…and {preview.errors.length - 10} more</li>
              )}
            </ul>
          </div>
        )}

        {/* Empty state */}
        {preview.totalModules === 0 && preview.totalQuestions === 0 && !preview.errors?.length && (
          <div style={{ padding: "16px 14px", fontSize: "12px", color: "var(--text3)" }}>No data found in this file.</div>
        )}
      </div>
    );
  };

  // --- Render Companies Tab ---
  const renderCompaniesTab = () => {
    if (loadingCompanies) return <div style={{ textAlign: "center", padding: "40px", color: "var(--text2)" }}><div className="loading-spinner" style={{ margin: "0 auto 12px" }} /><p>Loading companies...</p></div>;
    if (errorCompanies) return <div style={{ textAlign: "center", padding: "40px", color: "var(--red)" }}>Error: {errorCompanies}<br /><button className="btn btn-ghost" style={{ marginTop: "12px" }} onClick={fetchCompanies}>Retry</button></div>;
    if (companies.length === 0) return <p style={{ color: "var(--text3)", textAlign: "center", padding: "40px" }}>No companies registered yet.</p>;

    // If a company is selected, show detail panel
    if (selectedCompany) {
      return renderCompanyDetail();
    }

    return (
      <div style={{ overflowX: "auto" }}>
        <table className="data-table" style={{ width: "100%", borderCollapse: "collapse" }}>
          <thead>
            <tr>
              <th style={thStyle}>Name</th>
              <th style={thStyle}>Domain</th>
              <th style={thStyle}>Admin Email</th>
              <th style={thStyle}>Status</th>
              <th style={thStyle}>Template</th>
              <th style={thStyle}>AI</th>
              <th style={thStyle}>Actions</th>
              <th style={thStyle}>Created</th>
            </tr>
          </thead>
          <tbody>
            {companies.map((c) => {
              const sc = getStatusColor(c.status);
              return (
                <tr key={c.id} style={{ borderBottom: "1px solid var(--border)", cursor: "pointer" }} onClick={() => openCompanyDetail(c)}>
                  <td style={tdStyle}>
                    <strong style={{ color: "var(--accent2)" }}>{c.name}</strong>
                    {c.self_assessment_completed_at && (
                      c.self_assessment_all_departments_at ? (
                        <span title={`All departments in ${new Date(c.self_assessment_all_departments_at).toLocaleDateString()}`}
                          style={{ marginLeft: "6px", fontSize: "10px", fontWeight: 600, padding: "1px 6px", borderRadius: "10px", background: "rgba(34,197,94,0.12)", color: "var(--green,#22c55e)" }}>
                          ✓ Self-assessed
                        </span>
                      ) : (
                        <span title={`Admin submitted ${new Date(c.self_assessment_completed_at).toLocaleDateString()} — some departments still pending`}
                          style={{ marginLeft: "6px", fontSize: "10px", fontWeight: 600, padding: "1px 6px", borderRadius: "10px", background: "rgba(245,158,11,0.12)", color: "var(--amber,#f59e0b)" }}>
                          ◑ Self-assess: partial
                        </span>
                      )
                    )}
                  </td>
                  <td style={tdStyle}><span style={{ fontFamily: "var(--mono)", fontSize: "11px" }}>{c.domain}</span></td>
                  <td style={tdStyle}><span style={{ fontSize: "12px" }}>{c.admin_email}</span></td>
                  <td style={tdStyle}>
                    <span style={{ ...styles.statusBadge, background: sc.bg, color: sc.color, border: `1px solid ${sc.border}` }}>
                      {c.status}
                    </span>
                  </td>
                  <td style={tdStyle}>
                    {c.template_name ? (
                      <span style={{
                        display: "inline-flex",
                        alignItems: "center",
                        gap: "6px",
                        fontSize: "11px",
                        fontWeight: 500,
                        padding: "3px 10px",
                        borderRadius: "12px",
                        background: "rgba(99, 102, 241, 0.1)",
                        color: "var(--accent)",
                        border: "1px solid rgba(99, 102, 241, 0.2)",
                      }}>
                        {c.template_name}
                      </span>
                    ) : (
                      <span style={{ fontSize: "11px", color: "var(--text3)", fontStyle: "italic" }}>None</span>
                    )}
                  </td>
                  <td style={tdStyle}>
                    <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
                      <button
                        onClick={(e) => { e.stopPropagation(); handleAIToggle(c.id, c.ai_enabled); }}
                        style={{
                          ...styles.toggle,
                          background: c.ai_enabled ? "var(--green)" : "var(--bg4)",
                        }}
                        title={c.ai_enabled ? "AI Enabled - Click to disable" : "AI Disabled - Click to enable"}
                      >
                        <span style={{ ...styles.toggleDot, left: c.ai_enabled ? "19px" : "3px" }} />
                      </button>
                      <select
                        value={c.ai_provider || ""}
                        disabled={!c.ai_enabled}
                        onClick={(e) => e.stopPropagation()}
                        onChange={(e) => { e.stopPropagation(); handleAIProviderChange(c.id, e.target.value); }}
                        title="AI provider for this company"
                        style={{
                          fontSize: "11px", padding: "3px 6px", borderRadius: "6px",
                          background: "var(--bg3)", color: "var(--text2)",
                          border: "1px solid var(--border)", cursor: c.ai_enabled ? "pointer" : "not-allowed",
                        }}
                      >
                        <option value="">Default</option>
                        <option value="bedrock">AWS Bedrock</option>
                        <option value="azure">Azure</option>
                      </select>
                    </div>
                  </td>
                  <td style={tdStyle}>
                    <div style={{ display: "flex", gap: "4px", flexWrap: "wrap" }}>
                      {(c.status !== "approved" || !c.is_verified) && (
                        <button className="btn" style={{ padding: "4px 8px", fontSize: "11px", background: "rgba(34,197,94,0.15)", color: "var(--green)", border: "1px solid rgba(34,197,94,0.3)" }} onClick={(e) => { e.stopPropagation(); handleStatusChange(c.id, "approved"); }}>Approve</button>
                      )}
                      {c.is_verified && (
                        <button className="btn" style={{ padding: "4px 8px", fontSize: "11px", background: "rgba(245,158,11,0.15)", color: "var(--amber)", border: "1px solid rgba(245,158,11,0.3)" }} onClick={(e) => { e.stopPropagation(); handleUnapprove(c.id, c.name); }}>Unapprove</button>
                      )}
                      {c.status !== "suspended" && (
                        <button className="btn" style={{ padding: "4px 8px", fontSize: "11px", background: "rgba(245,158,11,0.15)", color: "var(--amber)", border: "1px solid rgba(245,158,11,0.3)" }} onClick={(e) => { e.stopPropagation(); handleStatusChange(c.id, "suspended"); }}>Suspend</button>
                      )}
                      {c.status !== "rejected" && (
                        <button className="btn" style={{ padding: "4px 8px", fontSize: "11px", background: "rgba(239,68,68,0.15)", color: "var(--red)", border: "1px solid rgba(239,68,68,0.3)" }} onClick={(e) => { e.stopPropagation(); handleStatusChange(c.id, "rejected"); }}>Reject</button>
                      )}
                      <button className="btn" style={{ padding: "4px 8px", fontSize: "11px", background: "rgba(127,29,29,0.2)", color: "#fca5a5", border: "1px solid rgba(127,29,29,0.4)" }} onClick={(e) => { e.stopPropagation(); handleDeleteCompany(c.id, c.name); }}>Delete</button>
                    </div>
                  </td>
                  <td style={tdStyle}><span style={{ fontSize: "11px", color: "var(--text3)" }}>{new Date(c.created_at).toLocaleDateString()}</span></td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    );
  };

  // --- Render Self-Assessment Panel (inside Company Detail) ---
  const renderSelfAssessmentPanel = () => {
    const sa = companySelfAssessment;
    const submissions = sa?.submissions || [];
    const dstatus = sa?.departmentStatus || null;
    const reportReady = submissions.length > 0 && (!dstatus || dstatus.complete);
    const ANSWER_COLORS = {
      Yes:     { bg: "rgba(34,197,94,0.12)",  color: "var(--green,#22c55e)" },
      Partial: { bg: "rgba(245,158,11,0.12)", color: "var(--amber,#f59e0b)" },
      No:      { bg: "rgba(239,68,68,0.12)",  color: "var(--red,#ef4444)" },
      "N/A":   { bg: "rgba(107,114,128,0.12)", color: "var(--text3)" },
    };

    return (
      <div style={{ background: "var(--bg3)", border: "1px solid var(--border)", borderRadius: "8px", padding: "20px", marginBottom: "20px" }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: "10px", marginBottom: "14px" }}>
          <h4 style={{ fontSize: "14px", fontWeight: 600, color: "var(--text)", margin: 0 }}>
            Self-Assessment
            {sa && <span style={{ color: "var(--text3)", fontWeight: 400 }}> · {sa.respondentCount} respondent{sa.respondentCount !== 1 ? "s" : ""}</span>}
          </h4>
          <div style={{ display: "flex", gap: "8px", flexWrap: "wrap" }}>
            <button className="btn" onClick={() => generateGapReport(false)} disabled={gapReportBusy || !reportReady}
              title={reportReady ? "Builds the report, emails a copy out, and opens it" : "Every selected department must submit before the report can be generated"}
              style={{ padding: "5px 12px", fontSize: "11px", background: reportReady ? "var(--accent)" : "var(--bg4)", color: reportReady ? "#fff" : "var(--text3)", border: `1px solid ${reportReady ? "var(--accent)" : "var(--border)"}`, cursor: reportReady ? "pointer" : "not-allowed" }}>
              {gapReportBusy ? "Working…" : "Generate & email report"}
            </button>
            <button className="btn" onClick={downloadGapReportPdf} disabled={gapReportBusy || !reportReady}
              title="Open the report and print / save as PDF"
              style={{ padding: "5px 12px", fontSize: "11px", background: "var(--bg4)", color: "var(--text2)", border: "1px solid var(--border)", cursor: reportReady ? "pointer" : "not-allowed" }}>
              ⬇ Download PDF
            </button>
            <button className="btn" onClick={downloadGapReportDocx} disabled={gapReportBusy || !reportReady}
              title="Download the report as an editable Word document"
              style={{ padding: "5px 12px", fontSize: "11px", background: "var(--bg4)", color: "var(--text2)", border: "1px solid var(--border)", cursor: reportReady ? "pointer" : "not-allowed" }}>
              ⬇ Download Word
            </button>
            <button className="btn" onClick={() => generateGapReport(true)} disabled={gapReportBusy || !reportReady}
              style={{ padding: "5px 12px", fontSize: "11px", background: "var(--bg4)", color: "var(--text3)", border: "1px solid var(--border)", cursor: reportReady ? "pointer" : "not-allowed" }}>
              Regenerate (fresh AI)
            </button>
          </div>
        </div>

        <div style={{ fontSize: "12px", color: "var(--text3)", marginBottom: "12px" }}>
          {sa?.completedAt
            ? `Admin submitted ${new Date(sa.completedAt).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" })}`
            : "Not yet marked complete"}
          {dstatus && dstatus.expected.length > 0 && (
            <> · {dstatus.submitted.length}/{dstatus.expected.length} departments in</>
          )}
        </div>

        {gapReportEmailedTo && (
          <div style={{ background: "rgba(34,197,94,0.1)", border: "1px solid rgba(34,197,94,0.3)", borderRadius: "6px", padding: "8px 12px", fontSize: "12px", color: "var(--text2)", marginBottom: "12px" }}>
            ✓ Report generated and emailed to <strong>{gapReportEmailedTo}</strong>.
          </div>
        )}
        {gapReportPopupBlocked && gapReportHtml && (
          <div style={{ background: "rgba(245,158,11,0.1)", border: "1px solid rgba(245,158,11,0.3)", borderRadius: "6px", padding: "8px 12px", fontSize: "12px", color: "var(--text2)", marginBottom: "12px", display: "flex", alignItems: "center", gap: "10px", flexWrap: "wrap" }}>
            <span>Your browser blocked the report from opening automatically.</span>
            <button className="btn btn-primary" style={{ fontSize: "12px", padding: "4px 12px" }} onClick={() => openGapReportWindow(gapReportHtml)}>Open report</button>
          </div>
        )}

        {dstatus && !dstatus.complete && dstatus.expected.length > 0 && (
          <div style={{ background: "rgba(245,158,11,0.1)", border: "1px solid rgba(245,158,11,0.3)", borderRadius: "6px", padding: "10px 14px", fontSize: "12px", color: "var(--text2)", marginBottom: "12px" }}>
            <div style={{ fontWeight: 700, color: "var(--amber,#f59e0b)", marginBottom: "6px" }}>
              Report locked — {dstatus.missing.length} department{dstatus.missing.length !== 1 ? "s" : ""} still to submit
            </div>
            <ul style={{ margin: 0, paddingLeft: "16px", lineHeight: 1.7 }}>
              {(sa?.pendingDepartments?.length ? sa.pendingDepartments : dstatus.missing.map(d => ({ department: d, assignees: [] }))).map(p => (
                <li key={p.department}>
                  <strong>{p.department}</strong>
                  {p.assignees.length === 0 ? (
                    <span style={{ color: "var(--text3)" }}> — not delegated to anyone (the admin needs to invite someone or answer it)</span>
                  ) : (
                    <span style={{ color: "var(--text3)" }}>
                      {" "}— invited{" "}
                      {p.assignees.map((a, i) => (
                        <span key={a.email}>
                          {i > 0 ? ", " : ""}{a.email}{a.acceptedAt ? " (accepted, not submitted)" : " (invite not accepted)"}
                        </span>
                      ))}
                    </span>
                  )}
                </li>
              ))}
            </ul>
          </div>
        )}

        {gapReportError && <p style={{ color: "var(--red,#ef4444)", fontSize: "12px", margin: "0 0 12px" }}>{gapReportError}</p>}

        {loadingSelfAssessment ? (
          <p style={{ fontSize: "13px", color: "var(--text3)" }}>Loading responses…</p>
        ) : submissions.length === 0 ? (
          <p style={{ fontSize: "13px", color: "var(--text3)" }}>No self-assessment responses submitted yet.</p>
        ) : (
          <div style={{ display: "flex", flexDirection: "column", gap: "8px" }}>
            {submissions.map((s) => {
              const key = `${s.userEmail}|${s.department}`;
              const open = expandedSubmission === key;
              return (
                <div key={key} style={{ border: "1px solid var(--border)", borderRadius: "6px", overflow: "hidden" }}>
                  <button
                    onClick={() => setExpandedSubmission(open ? null : key)}
                    style={{ width: "100%", textAlign: "left", background: "var(--bg4)", border: "none", cursor: "pointer", padding: "10px 12px", display: "flex", justifyContent: "space-between", alignItems: "center", gap: "10px" }}
                  >
                    <span style={{ fontSize: "12px", color: "var(--text)" }}>
                      <strong>{s.department}</strong> · {s.userName}
                      <span style={{ color: "var(--text3)", fontFamily: "var(--mono)" }}> ({s.userEmail})</span>
                    </span>
                    <span style={{ fontSize: "11px", color: "var(--text3)", flexShrink: 0 }}>
                      {s.answeredCount}/{s.totalCount} answered · {open ? "▲" : "▼"}
                    </span>
                  </button>
                  {open && (
                    <div style={{ padding: "8px 12px", maxHeight: "340px", overflowY: "auto" }}>
                      <table style={{ width: "100%", borderCollapse: "collapse", fontSize: "12px" }}>
                        <tbody>
                          {s.items.map(item => {
                            const ac = ANSWER_COLORS[item.answerLabel] || ANSWER_COLORS["N/A"];
                            return (
                              <tr key={item.id} style={{ borderBottom: "1px solid var(--border)" }}>
                                <td style={{ padding: "6px 8px", color: "var(--text2)", verticalAlign: "top" }}>{item.text}</td>
                                <td style={{ padding: "6px 8px", textAlign: "right", whiteSpace: "nowrap", verticalAlign: "top" }}>
                                  <span style={{ fontSize: "10px", fontWeight: 600, padding: "2px 8px", borderRadius: "10px", background: ac.bg, color: ac.color }}>
                                    {item.answerLabel}
                                  </span>
                                </td>
                              </tr>
                            );
                          })}
                        </tbody>
                      </table>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>
    );
  };

  // --- Render Company Detail Panel ---
  const renderCompanyDetail = () => {
    const c = selectedCompany;
    const sc = getStatusColor(c.status);

    return (
      <div>
        {/* Back button */}
        <button className="btn btn-ghost" style={{ marginBottom: "16px", fontSize: "13px" }} onClick={() => navigate(-1)}>
          ← Back to Companies
        </button>

        {/* Company header */}
        <div style={{ background: "var(--bg3)", border: "1px solid var(--border)", borderRadius: "8px", padding: "20px", marginBottom: "20px" }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: "12px" }}>
            <div>
              <h3 style={{ fontSize: "18px", fontWeight: 600, color: "var(--text)", margin: "0 0 4px" }}>{c.name}</h3>
              <p style={{ fontSize: "12px", color: "var(--text3)", margin: 0 }}>{c.domain} • {c.admin_email}</p>
            </div>
            <span style={{ ...styles.statusBadge, background: sc.bg, color: sc.color, border: `1px solid ${sc.border}`, fontSize: "12px", padding: "4px 12px" }}>
              {c.status}
            </span>
          </div>
        </div>

        {/* Users */}
        <div style={{ background: "var(--bg3)", border: "1px solid var(--border)", borderRadius: "8px", padding: "20px", marginBottom: "20px" }}>
          <h4 style={{ fontSize: "14px", fontWeight: 600, color: "var(--text)", margin: "0 0 14px" }}>
            Users ({companyUsers.length})
          </h4>
          {companyUsers.length === 0 ? (
            <p style={{ fontSize: "13px", color: "var(--text3)" }}>No users found.</p>
          ) : (() => {
            const roleOrder = ["ADMIN", "LEAD", "CONTRIBUTOR", "REVIEWER", "AUDITOR"];
            const roleColors = {
              ADMIN:       { bg: "rgba(99,102,241,0.12)",  color: "var(--accent2)",   border: "rgba(99,102,241,0.3)" },
              LEAD:        { bg: "rgba(20,184,166,0.1)",   color: "var(--teal)",       border: "rgba(20,184,166,0.3)" },
              CONTRIBUTOR: { bg: "rgba(245,158,11,0.1)",   color: "var(--amber)",      border: "rgba(245,158,11,0.3)" },
              REVIEWER:    { bg: "rgba(107,114,128,0.1)",  color: "var(--text3)",      border: "rgba(107,114,128,0.3)" },
              AUDITOR:     { bg: "rgba(239,68,68,0.08)",   color: "var(--red,#ef4444)", border: "rgba(239,68,68,0.25)" },
            };
            const roleCounts = {};
            for (const u of companyUsers) roleCounts[u.role] = (roleCounts[u.role] || 0) + 1;

            return (
              <>
                {/* Role summary chips */}
                <div style={{ display: "flex", gap: "8px", flexWrap: "wrap", marginBottom: "14px" }}>
                  {roleOrder.filter(r => roleCounts[r]).map(r => {
                    const rc = roleColors[r] || roleColors.REVIEWER;
                    return (
                      <span key={r} style={{ fontSize: "11px", fontWeight: 600, padding: "4px 10px", borderRadius: "12px", background: rc.bg, color: rc.color, border: `1px solid ${rc.border}` }}>
                        {r}: {roleCounts[r]}
                      </span>
                    );
                  })}
                </div>

                {/* User list */}
                <div style={{ maxHeight: "220px", overflowY: "auto" }}>
                  <table style={{ width: "100%", borderCollapse: "collapse", fontSize: "12px" }}>
                    <thead>
                      <tr>
                        <th style={{ ...thStyle, fontSize: "10px", padding: "6px 8px" }}>Name</th>
                        <th style={{ ...thStyle, fontSize: "10px", padding: "6px 8px" }}>Email</th>
                        <th style={{ ...thStyle, fontSize: "10px", padding: "6px 8px" }}>Role</th>
                        <th style={{ ...thStyle, fontSize: "10px", padding: "6px 8px" }}>Joined</th>
                      </tr>
                    </thead>
                    <tbody>
                      {companyUsers.map(u => {
                        const rc = roleColors[u.role] || roleColors.REVIEWER;
                        return (
                          <tr key={u.id} style={{ borderBottom: "1px solid var(--border)" }}>
                            <td style={{ padding: "6px 8px", color: "var(--text)" }}>{u.fullName || <span style={{ color: "var(--text3)", fontStyle: "italic" }}>—</span>}</td>
                            <td style={{ padding: "6px 8px", color: "var(--text2)", fontFamily: "var(--mono)", fontSize: "11px" }}>{u.email}</td>
                            <td style={{ padding: "6px 8px" }}>
                              <span style={{ fontSize: "10px", fontWeight: 600, padding: "2px 7px", borderRadius: "10px", background: rc.bg, color: rc.color, border: `1px solid ${rc.border}` }}>
                                {u.role}
                              </span>
                            </td>
                            <td style={{ padding: "6px 8px", color: "var(--text3)", fontSize: "11px" }}>
                              {u.createdAt ? new Date(u.createdAt).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" }) : "—"}
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              </>
            );
          })()}
        </div>

        {/* Self-Assessment */}
        {renderSelfAssessmentPanel()}

        {/* Billing */}
        <div style={{ background: "var(--bg3)", border: "1px solid var(--border)", borderRadius: "8px", padding: "20px", marginBottom: "20px" }}>
          <h4 style={{ fontSize: "14px", fontWeight: 600, color: "var(--text)", margin: "0 0 14px" }}>Billing & Plan</h4>
          <div style={{ display: "flex", gap: "24px", flexWrap: "wrap", alignItems: "flex-start" }}>
            <div>
              <div style={{ fontSize: 11, color: "var(--text3)", marginBottom: 4 }}>PLAN</div>
              <div style={{ display: "flex", gap: 6 }}>
                {["starter","custom"].map(p => (
                  <button key={p} className="btn" onClick={() => handleBillingUpdate(c.id, { plan: p })} style={{
                    padding: "4px 12px", fontSize: "11px", textTransform: "capitalize",
                    background: c.plan === p ? "var(--accent)" : "var(--bg4)",
                    color: c.plan === p ? "#fff" : "var(--text2)",
                    border: `1px solid ${c.plan === p ? "var(--accent)" : "var(--border)"}`,
                    fontWeight: c.plan === p ? 700 : 400,
                  }}>{p}</button>
                ))}
              </div>
            </div>
            <div>
              <div style={{ fontSize: 11, color: "var(--text3)", marginBottom: 4 }}>BILLING STATUS</div>
              <div style={{ display: "flex", gap: 6 }}>
                {["trial","active","expired"].map(s => (
                  <button key={s} className="btn" onClick={() => handleBillingUpdate(c.id, { billingStatus: s })} style={{
                    padding: "4px 12px", fontSize: "11px", textTransform: "capitalize",
                    background: c.billing_status === s ? (s === "active" ? "rgba(34,197,94,0.2)" : s === "expired" ? "rgba(239,68,68,0.15)" : "rgba(245,158,11,0.15)") : "var(--bg4)",
                    color: c.billing_status === s ? (s === "active" ? "var(--green)" : s === "expired" ? "var(--red)" : "var(--amber)") : "var(--text2)",
                    border: `1px solid ${c.billing_status === s ? "currentColor" : "var(--border)"}`,
                    fontWeight: c.billing_status === s ? 700 : 400,
                  }}>{s}</button>
                ))}
              </div>
            </div>
            <div>
              <div style={{ fontSize: 11, color: "var(--text3)", marginBottom: 4 }}>EXTEND TRIAL</div>
              <div style={{ display: "flex", gap: 6 }}>
                {[7, 14, 30].map(days => (
                  <button key={days} className="btn" onClick={() => handleBillingUpdate(c.id, { trialDays: days, billingStatus: "trial" })} style={{ padding: "4px 10px", fontSize: "11px", background: "var(--bg4)", color: "var(--text2)", border: "1px solid var(--border)" }}>
                    +{days}d
                  </button>
                ))}
              </div>
            </div>
            <div style={{ fontSize: 12, color: "var(--text3)", alignSelf: "flex-end", paddingBottom: 2 }}>
              Trial ends: {c.trial_ends_at ? new Date(c.trial_ends_at).toLocaleDateString() : "—"}
            </div>
          </div>
        </div>

        {/* Account Tools */}
        <div style={{ background: "var(--bg3)", border: "1px solid var(--border)", borderRadius: "8px", padding: "16px 20px", marginBottom: "20px" }}>
          <div style={{ fontSize: "13px", fontWeight: 600, color: "var(--text)", marginBottom: "12px" }}>Onboarding Controls</div>
          <div style={{ display: "flex", gap: "12px", flexWrap: "wrap" }}>
            <div style={{ background: "var(--bg4)", borderRadius: "6px", padding: "12px 14px", display: "flex", flexDirection: "column", gap: 8 }}>
              <div style={{ fontSize: "12px", fontWeight: 600, color: "var(--text)" }}>↺ Reset Onboarding</div>
              <div style={{ fontSize: "11px", color: "var(--text3)", lineHeight: 1.5 }}>Prompts the company admin to complete the full onboarding flow — tech stack questions and uploading the 19 required vault documents — on their next login.</div>
              <button
                className="btn"
                style={{ padding: "5px 12px", fontSize: "11px", background: "var(--bg)", color: "var(--text2)", border: "1px solid var(--border)", whiteSpace: "nowrap", alignSelf: "flex-start" }}
                onClick={() => handleResetOnboarding(c.id, c.name)}
              >
                Reset Onboarding
              </button>
            </div>
          </div>
        </div>

        {/* Modules list */}
        <div style={{ background: "var(--bg3)", border: "1px solid var(--border)", borderRadius: "8px", padding: "20px", marginBottom: "20px" }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "12px" }}>
            <h4 style={{ fontSize: "14px", fontWeight: 600, color: "var(--text)", margin: 0 }}>
              Modules ({companyModules.length})
            </h4>
            {companyModules.length > 0 && !deleteModulesConfirm && (
              <button className="btn" style={{ padding: "5px 12px", fontSize: "11px", background: "rgba(239,68,68,0.12)", color: "var(--red)", border: "1px solid rgba(239,68,68,0.3)" }} onClick={() => setDeleteModulesConfirm(true)}>
                Delete All Modules
              </button>
            )}
          </div>

          {deleteModulesConfirm && (
            <div style={{ padding: "12px", background: "rgba(239,68,68,0.06)", border: "1px solid rgba(239,68,68,0.2)", borderRadius: "6px", marginBottom: "12px" }}>
              <p style={{ fontSize: "12px", color: "var(--text2)", margin: "0 0 8px" }}>This will delete ALL modules and questions for "{c.name}". This cannot be undone.</p>
              <div style={{ display: "flex", gap: "8px" }}>
                <button className="btn" style={{ padding: "5px 12px", fontSize: "11px", background: "var(--red)", color: "#fff", border: "none" }} onClick={handleDeleteCompanyModules}>Confirm Delete All</button>
                <button className="btn btn-ghost" style={{ padding: "5px 12px", fontSize: "11px" }} onClick={() => setDeleteModulesConfirm(false)}>Cancel</button>
              </div>
            </div>
          )}

          {loadingModules ? (
            <p style={{ color: "var(--text3)", fontSize: "13px" }}>Loading modules...</p>
          ) : companyModules.length === 0 ? (
            <p style={{ color: "var(--text3)", fontSize: "13px" }}>No modules assigned yet. Upload an Excel file below.</p>
          ) : (
            <div style={{ maxHeight: "200px", overflow: "auto" }}>
              <table style={{ width: "100%", borderCollapse: "collapse", fontSize: "12px" }}>
                <thead>
                  <tr>
                    <th style={{ ...thStyle, fontSize: "10px", padding: "6px 4px", width: "28px" }}></th>
                    <th style={{ ...thStyle, fontSize: "10px", padding: "6px 8px" }}>Module ID</th>
                    <th style={{ ...thStyle, fontSize: "10px", padding: "6px 8px" }}>Name</th>
                    <th style={{ ...thStyle, fontSize: "10px", padding: "6px 8px" }}>Questions</th>
                    <th style={{ ...thStyle, fontSize: "10px", padding: "6px 8px" }}>Owner</th>
                    <th style={{ ...thStyle, fontSize: "10px", padding: "6px 8px" }}>Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {companyModules.map((m, idx) => (
                    <tr key={m.id || m.module_id} style={{ borderBottom: "1px solid var(--border)" }}>
                      <td style={{ padding: "6px 4px", whiteSpace: "nowrap" }}>
                        <span style={{ display: "inline-flex", flexDirection: "column", gap: "1px" }}>
                          <button
                            title="Move up"
                            disabled={idx === 0}
                            style={{ padding: "0 4px", fontSize: "10px", lineHeight: "14px", background: "none", border: "none", cursor: idx === 0 ? "default" : "pointer", opacity: idx === 0 ? 0.3 : 1, color: "var(--text2)" }}
                            onClick={() => handleMoveModule(idx, -1)}
                          >▲</button>
                          <button
                            title="Move down"
                            disabled={idx === companyModules.length - 1}
                            style={{ padding: "0 4px", fontSize: "10px", lineHeight: "14px", background: "none", border: "none", cursor: idx === companyModules.length - 1 ? "default" : "pointer", opacity: idx === companyModules.length - 1 ? 0.3 : 1, color: "var(--text2)" }}
                            onClick={() => handleMoveModule(idx, 1)}
                          >▼</button>
                        </span>
                      </td>
                      <td style={{ padding: "6px 8px", fontFamily: "var(--mono)", fontSize: "11px" }}>{m.module_id}</td>
                      <td style={{ padding: "6px 8px" }}>{m.name}</td>
                      <td style={{ padding: "6px 8px" }}>{m.total_quests || 0}</td>
                      <td style={{ padding: "6px 8px", color: "var(--text3)" }}>{m.primary_owner}</td>
                      <td style={{ padding: "6px 8px" }}>
                        {deleteModuleConfirm === m.module_id ? (
                          <span style={{ display: "flex", gap: "4px", alignItems: "center" }}>
                            <button
                              style={{ padding: "2px 6px", fontSize: "10px", background: "var(--red)", color: "#fff", border: "none", borderRadius: "3px", cursor: "pointer" }}
                              onClick={() => handleDeleteSingleModule(m.module_id)}
                            >Yes</button>
                            <button
                              style={{ padding: "2px 6px", fontSize: "10px", background: "var(--bg4)", color: "var(--text2)", border: "1px solid var(--border)", borderRadius: "3px", cursor: "pointer" }}
                              onClick={() => setDeleteModuleConfirm(null)}
                            >No</button>
                          </span>
                        ) : (
                          <button
                            title="Delete module"
                            style={{ padding: "2px 6px", fontSize: "12px", background: "none", border: "none", cursor: "pointer" }}
                            onClick={() => setDeleteModuleConfirm(m.module_id)}
                          >🗑</button>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>

        {/* Add Module Form */}
        <div style={{ background: "var(--bg3)", border: "1px solid var(--border)", borderRadius: "8px", padding: "20px", marginBottom: "20px" }}>
          <h4 style={{ fontSize: "14px", fontWeight: 600, color: "var(--text)", margin: "0 0 12px" }}>Add Module</h4>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "10px" }}>
            <div>
              <label style={{ fontSize: "11px", color: "var(--text3)", display: "block", marginBottom: "4px" }}>Module ID *</label>
              <input
                type="text"
                value={newModuleId}
                onChange={(e) => setNewModuleId(e.target.value)}
                placeholder="e.g. P - Policies & Governance"
                style={{ width: "100%", padding: "7px 10px", background: "var(--bg4)", border: "1px solid var(--border2)", borderRadius: "5px", color: "var(--text)", fontSize: "12px" }}
              />
            </div>
            <div>
              <label style={{ fontSize: "11px", color: "var(--text3)", display: "block", marginBottom: "4px" }}>Name *</label>
              <input
                type="text"
                value={newModuleName}
                onChange={(e) => setNewModuleName(e.target.value)}
                placeholder="e.g. Policies & Governance"
                style={{ width: "100%", padding: "7px 10px", background: "var(--bg4)", border: "1px solid var(--border2)", borderRadius: "5px", color: "var(--text)", fontSize: "12px" }}
              />
            </div>
            <div>
              <label style={{ fontSize: "11px", color: "var(--text3)", display: "block", marginBottom: "4px" }}>Owner (optional)</label>
              <input
                type="text"
                value={newModuleOwner}
                onChange={(e) => setNewModuleOwner(e.target.value)}
                placeholder="e.g. CISO"
                style={{ width: "100%", padding: "7px 10px", background: "var(--bg4)", border: "1px solid var(--border2)", borderRadius: "5px", color: "var(--text)", fontSize: "12px" }}
              />
            </div>
            <div>
              <label style={{ fontSize: "11px", color: "var(--text3)", display: "block", marginBottom: "4px" }}>Frequency (optional)</label>
              <input
                type="text"
                value={newModuleFrequency}
                onChange={(e) => setNewModuleFrequency(e.target.value)}
                placeholder="e.g. Monthly"
                style={{ width: "100%", padding: "7px 10px", background: "var(--bg4)", border: "1px solid var(--border2)", borderRadius: "5px", color: "var(--text)", fontSize: "12px" }}
              />
            </div>
          </div>
          <button
            className="btn btn-primary"
            style={{ marginTop: "12px", fontSize: "12px", padding: "7px 16px", opacity: addingModule ? 0.5 : 1 }}
            disabled={addingModule}
            onClick={handleAddModule}
          >
            {addingModule ? "Adding..." : "Add Module"}
          </button>
        </div>

        {/* Add Question Form */}
        <div style={{ background: "var(--bg3)", border: "1px solid var(--border)", borderRadius: "8px", padding: "20px", marginBottom: "20px" }}>
          <h4 style={{ fontSize: "14px", fontWeight: 600, color: "var(--text)", margin: "0 0 12px" }}>Add Question</h4>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "10px" }}>
            <div>
              <label style={{ fontSize: "11px", color: "var(--text3)", display: "block", marginBottom: "4px" }}>Quest ID *</label>
              <input
                type="text"
                value={newQuestId}
                onChange={(e) => setNewQuestId(e.target.value)}
                placeholder="e.g. P-1.1"
                style={{ width: "100%", padding: "7px 10px", background: "var(--bg4)", border: "1px solid var(--border2)", borderRadius: "5px", color: "var(--text)", fontSize: "12px" }}
              />
            </div>
            <div>
              <label style={{ fontSize: "11px", color: "var(--text3)", display: "block", marginBottom: "4px" }}>Module ID *</label>
              <select
                value={newQuestModuleId}
                onChange={(e) => setNewQuestModuleId(e.target.value)}
                style={{ width: "100%", padding: "7px 10px", background: "var(--bg4)", border: "1px solid var(--border2)", borderRadius: "5px", color: "var(--text)", fontSize: "12px" }}
              >
                <option value="">Select module...</option>
                {companyModules.map((m) => (
                  <option key={m.module_id} value={m.module_id}>{m.module_id} - {m.name}</option>
                ))}
              </select>
            </div>
            <div>
              <label style={{ fontSize: "11px", color: "var(--text3)", display: "block", marginBottom: "4px" }}>Control Area</label>
              <input
                type="text"
                value={newQuestControlArea}
                onChange={(e) => setNewQuestControlArea(e.target.value)}
                placeholder="e.g. Policy Documentation"
                style={{ width: "100%", padding: "7px 10px", background: "var(--bg4)", border: "1px solid var(--border2)", borderRadius: "5px", color: "var(--text)", fontSize: "12px" }}
              />
            </div>
            <div>
              <label style={{ fontSize: "11px", color: "var(--text3)", display: "block", marginBottom: "4px" }}>Question Text</label>
              <input
                type="text"
                value={newQuestText}
                onChange={(e) => setNewQuestText(e.target.value)}
                placeholder="e.g. Is there a documented policy..."
                style={{ width: "100%", padding: "7px 10px", background: "var(--bg4)", border: "1px solid var(--border2)", borderRadius: "5px", color: "var(--text)", fontSize: "12px" }}
              />
            </div>
            <div>
              <label style={{ fontSize: "11px", color: "var(--text3)", display: "block", marginBottom: "4px" }}>Priority</label>
              <select
                value={newQuestPriority}
                onChange={(e) => setNewQuestPriority(e.target.value)}
                style={{ width: "100%", padding: "7px 10px", background: "var(--bg4)", border: "1px solid var(--border2)", borderRadius: "5px", color: "var(--text)", fontSize: "12px" }}
              >
                <option value="Critical">Critical</option>
                <option value="High">High</option>
                <option value="Medium">Medium</option>
                <option value="Low">Low</option>
              </select>
            </div>
          </div>
          {companyQuestions.length > 0 && (
            <div style={{ marginTop: 12 }}>
              <label style={{ fontSize: "11px", color: "var(--text3)", display: "block", marginBottom: "4px" }}>Dependencies (optional)</label>
              <DependencySelect
                allQuestions={companyQuestions}
                value={newQuestDeps}
                onChange={setNewQuestDeps}
                selfQuestId={newQuestId.trim()}
              />
            </div>
          )}
          {questionError && (
            <p style={{ fontSize: "12px", color: "var(--red)", margin: "8px 0 0" }}>✗ {questionError}</p>
          )}
          <button
            className="btn btn-primary"
            style={{ marginTop: "12px", fontSize: "12px", padding: "7px 16px", opacity: addingQuestion ? 0.5 : 1 }}
            disabled={addingQuestion}
            onClick={handleAddQuestion}
          >
            {addingQuestion ? "Adding..." : "Add Question"}
          </button>
        </div>

        {/* Questions list with delete */}
        {companyQuestions.length > 0 && (
          <div style={{ background: "var(--bg3)", border: "1px solid var(--border)", borderRadius: "8px", padding: "20px", marginBottom: "20px" }}>
            <h4 style={{ fontSize: "14px", fontWeight: 600, color: "var(--text)", margin: "0 0 12px" }}>
              Questions ({companyQuestions.length})
            </h4>
            <div style={{ maxHeight: "200px", overflow: "auto" }}>
              <table style={{ width: "100%", borderCollapse: "collapse", fontSize: "12px" }}>
                <thead>
                  <tr>
                    <th style={{ ...thStyle, fontSize: "10px", padding: "6px 8px" }}>Quest ID</th>
                    <th style={{ ...thStyle, fontSize: "10px", padding: "6px 8px" }}>Module</th>
                    <th style={{ ...thStyle, fontSize: "10px", padding: "6px 8px" }}>Control Area</th>
                    <th style={{ ...thStyle, fontSize: "10px", padding: "6px 8px" }}>Priority</th>
                    <th style={{ ...thStyle, fontSize: "10px", padding: "6px 8px" }}>Deps</th>
                    <th style={{ ...thStyle, fontSize: "10px", padding: "6px 8px" }}>Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {companyQuestions.map((q) => (
                    <tr key={q.quest_id || q.questId} style={{ borderBottom: "1px solid var(--border)" }}>
                      <td style={{ padding: "6px 8px", fontFamily: "var(--mono)", fontSize: "11px" }}>{q.quest_id || q.questId}</td>
                      <td style={{ padding: "6px 8px", fontSize: "11px" }}>{q.module_id || q.moduleId}</td>
                      <td style={{ padding: "6px 8px", fontSize: "11px", color: "var(--text3)" }}>{q.control_area || q.controlArea}</td>
                      <td style={{ padding: "6px 8px" }}>
                        {q.priority && (
                          <span className={`priority-badge priority-${q.priority.toLowerCase()}`} style={{ fontSize: "10px", padding: "2px 8px" }}>{q.priority}</span>
                        )}
                      </td>
                      <td style={{ padding: "6px 8px", fontSize: "11px", color: "var(--text3)" }}>
                        {(q.dependency_count || 0) > 0 ? `${q.dependency_count} dep${q.dependency_count !== 1 ? "s" : ""}` : "None"}
                      </td>
                      <td style={{ padding: "6px 8px" }}>
                        {deleteQuestionConfirm === (q.quest_id || q.questId) ? (
                          <span style={{ display: "flex", gap: "4px", alignItems: "center" }}>
                            <button
                              style={{ padding: "2px 6px", fontSize: "10px", background: "var(--red)", color: "#fff", border: "none", borderRadius: "3px", cursor: "pointer" }}
                              onClick={() => handleDeleteSingleQuestion(q.quest_id || q.questId)}
                            >Yes</button>
                            <button
                              style={{ padding: "2px 6px", fontSize: "10px", background: "var(--bg4)", color: "var(--text2)", border: "1px solid var(--border)", borderRadius: "3px", cursor: "pointer" }}
                              onClick={() => setDeleteQuestionConfirm(null)}
                            >No</button>
                          </span>
                        ) : (
                          <button
                            title="Delete question"
                            style={{ padding: "2px 6px", fontSize: "12px", background: "none", border: "none", cursor: "pointer" }}
                            onClick={() => setDeleteQuestionConfirm(q.quest_id || q.questId)}
                          >🗑</button>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {/* Import for this company */}
        <div style={{ background: "var(--bg3)", border: "1px solid var(--border)", borderRadius: "8px", padding: "20px" }}>
          <h4 style={{ fontSize: "14px", fontWeight: 600, color: "var(--text)", margin: "0 0 12px" }}>Import Modules for {c.name}</h4>

          <div
            style={{ ...styles.dropZone, padding: "24px 16px", ...(companyDragOver ? styles.dropZoneActive : {}) }}
            onDragOver={(e) => { e.preventDefault(); setCompanyDragOver(true); }}
            onDragLeave={() => setCompanyDragOver(false)}
            onDrop={(e) => { e.preventDefault(); setCompanyDragOver(false); const f = e.dataTransfer.files[0]; if (f) { const err = validateFile(f); if (err) { showToast(err, "error"); } else { setCompanyImportFile(f); setCompanyImportResult(null); fetchPreview(f, setCompanyImportPreview, setCompanyPreviewLoading); } } }}
            onClick={() => document.getElementById("company-file-input").click()}
          >
            <p style={{ color: "var(--text2)", fontSize: "13px", margin: 0 }}>
              <strong style={{ color: "var(--text)" }}>
                {companyImportFile ? companyImportFile.name : "Drop Excel file here or click to browse"}
              </strong>
            </p>
          </div>
          <input
            id="company-file-input"
            type="file"
            accept=".xlsx,.xls"
            style={{ display: "none" }}
            onChange={(e) => { if (e.target.files[0]) { const f = e.target.files[0]; const err = validateFile(f); if (err) { showToast(err, "error"); } else { setCompanyImportFile(f); setCompanyImportResult(null); fetchPreview(f, setCompanyImportPreview, setCompanyPreviewLoading); } } e.target.value = ""; }}
          />

          {renderImportPreview(companyImportPreview, companyPreviewLoading)}

          <button
            className="btn btn-primary"
            style={{ marginTop: "12px", opacity: (!companyImportFile || companyImporting) ? 0.5 : 1 }}
            disabled={!companyImportFile || companyImporting}
            onClick={handleCompanyImport}
          >
            {companyImporting ? "Importing..." : `Import to ${c.name}`}
          </button>

          {companyImportResult && (
            <div style={{ ...styles.resultBox, marginTop: "12px" }}>
              <p style={{ fontSize: "13px", color: "var(--green)", margin: "0 0 4px", fontWeight: 600 }}>✓ Import Complete</p>
              <p style={{ fontSize: "12px", color: "var(--text2)", margin: "2px 0" }}>Modules: {companyImportResult.modulesImported} • Questions: {companyImportResult.questionsImported}</p>
              {companyImportResult.errors?.length > 0 && (
                <p style={{ fontSize: "11px", color: "var(--amber)", margin: "4px 0 0" }}>{companyImportResult.errors.length} warning(s)</p>
              )}
            </div>
          )}
        </div>
      </div>
    );
  };

  // --- Render Import Tab ---
  const renderImportTab = () => {
    if (loadingCompanies) return <div style={{ textAlign: "center", padding: "40px", color: "var(--text2)" }}><div className="loading-spinner" style={{ margin: "0 auto 12px" }} /><p>Loading...</p></div>;

    return (
      <div style={{ maxWidth: "640px" }}>
        <h3 style={{ fontSize: "16px", fontWeight: 600, marginBottom: "16px", color: "var(--text)" }}>Import Modules from Excel</h3>

        {/* File Drop Zone */}
        <div
          style={{ ...styles.dropZone, ...(dragOver ? styles.dropZoneActive : {}) }}
          onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
          onDragLeave={() => setDragOver(false)}
          onDrop={(e) => { e.preventDefault(); setDragOver(false); const f = e.dataTransfer.files[0]; if (f) handleFileSelect(f); }}
          onClick={() => document.getElementById("file-input").click()}
        >
          <div style={{ fontSize: "28px", marginBottom: "8px" }}>📄</div>
          <p style={{ color: "var(--text2)", fontSize: "13px", margin: 0 }}>
            <strong style={{ color: "var(--text)", display: "block", marginBottom: "4px" }}>
              {importFile ? importFile.name : "Drop Excel file here or click to browse"}
            </strong>
            {importFile
              ? `${(importFile.size / 1024).toFixed(1)} KB`
              : "Accepts .xlsx and .xls (max 10MB)"}
          </p>
        </div>
        <input
          id="file-input"
          type="file"
          accept=".xlsx,.xls"
          style={{ display: "none" }}
          onChange={(e) => { if (e.target.files[0]) handleFileSelect(e.target.files[0]); e.target.value = ""; }}
        />

        {renderImportPreview(importPreview, previewLoading)}

        {/* Publish target — is this a new version of an existing template? */}
        {importPreview?.templateMatches?.length > 0 && (
          <div className="form-group" style={{ marginTop: "16px" }}>
            <label>Publish As</label>
            <div style={{ display: "flex", flexDirection: "column", gap: "8px" }}>
              {importPreview.templateMatches.map((m) => {
                const selected = publishTargetRootId === m.rootTemplateId;
                return (
                  <label
                    key={m.templateId}
                    style={{
                      display: "flex", gap: "10px", alignItems: "flex-start", padding: "10px 12px",
                      border: `1px solid ${selected ? "var(--accent)" : "var(--border)"}`,
                      borderRadius: "7px", cursor: "pointer",
                      background: selected ? "rgba(99,102,241,0.06)" : "var(--bg3)",
                    }}
                  >
                    <input
                      type="radio"
                      name="publish-target"
                      checked={selected}
                      onChange={() => { setPublishTargetRootId(m.rootTemplateId); setSaveAsTemplate(true); setTemplateName(m.name); }}
                      style={{ marginTop: "3px", accentColor: "var(--accent)" }}
                    />
                    <div style={{ flex: 1 }}>
                      <div style={{ fontSize: "13px", color: "var(--text)" }}>
                        New version of <strong>{m.name}</strong>
                        <span style={{ color: "var(--text3)" }}> — currently v{m.currentVersion}</span>
                      </div>
                      <div style={{ fontSize: "11px", color: "var(--text3)", marginTop: "3px" }}>
                        {Math.round(m.score * 100)}% match
                        {m.summary && (
                          <> · {m.summary.unchanged} unchanged, {m.summary.reworded} reworded,{" "}
                          {m.summary.renamed} renamed, {m.summary.added} added, {m.summary.removed} removed</>
                        )}
                      </div>
                    </div>
                  </label>
                );
              })}
              <label
                style={{
                  display: "flex", gap: "10px", alignItems: "center", padding: "10px 12px",
                  border: `1px solid ${publishTargetRootId === null ? "var(--accent)" : "var(--border)"}`,
                  borderRadius: "7px", cursor: "pointer",
                  background: publishTargetRootId === null ? "rgba(99,102,241,0.06)" : "var(--bg3)",
                }}
              >
                <input
                  type="radio"
                  name="publish-target"
                  checked={publishTargetRootId === null}
                  onChange={() => setPublishTargetRootId(null)}
                  style={{ accentColor: "var(--accent)" }}
                />
                <span style={{ fontSize: "13px", color: "var(--text)" }}>Create a new template (not a version of any existing one)</span>
              </label>
            </div>
          </div>
        )}

        {/* Framework Selector */}
        <div className="form-group" style={{ marginTop: "16px" }}>
          <label>Compliance Framework (optional)</label>
          <select
            value={importFrameworkKey}
            onChange={(e) => setImportFrameworkKey(e.target.value)}
          >
            <option value="">— Not a framework sheet —</option>
            {frameworks.map(f => (
              <option key={f.key} value={f.key}>{f.name}</option>
            ))}
          </select>
          <p style={{ fontSize: "12px", color: "var(--text2)", margin: "6px 0 0" }}>
            {importPreview?.frameworkGuess
              ? `Detected "${importPreview.frameworkGuess}" from the filename. `
              : ""}
            When set, questions are de-duplicated by control and mapped to this framework
            (the framework is activated for the assigned company).
          </p>
          <p style={{ fontSize: "12px", color: "var(--text2)", margin: "8px 0 0" }}>
            To merge a control that repeats across frameworks into one canonical question
            (AI-assisted, with review), use{" "}
            <button
              type="button"
              className="link-button"
              style={{ background: "none", border: "none", color: "var(--accent)", cursor: "pointer", padding: 0, textDecoration: "underline" }}
              onClick={() => navigate("/superadmin/framework-import")}
            >
              Framework Import &amp; Review
            </button>.
          </p>
        </div>

        {/* Company Selector */}
        <div className="form-group" style={{ marginTop: "16px" }}>
          <label>Assign to Company (optional)</label>
          <select
            value={importCompanyId}
            onChange={(e) => setImportCompanyId(e.target.value)}
          >
            <option value="">— No direct assignment —</option>
            {companies.map(c => (
              <option key={c.id} value={c.id}>{c.name} ({c.domain})</option>
            ))}
          </select>
        </div>

        {/* Save as Template — hidden once a publish target is picked above, since
            publishing a version always saves it. */}
        {!publishTargetRootId && (
          <div style={{ display: "flex", alignItems: "center", gap: "8px", margin: "12px 0" }}>
            <input
              type="checkbox"
              id="save-template"
              checked={saveAsTemplate}
              onChange={(e) => setSaveAsTemplate(e.target.checked)}
              style={{ width: "16px", height: "16px", accentColor: "var(--accent)" }}
            />
            <label htmlFor="save-template" style={{ fontSize: "13px", color: "var(--text2)", cursor: "pointer" }}>Save as Template</label>
          </div>
        )}

        {saveAsTemplate && (
          <div className="form-group">
            <label>Template Name</label>
            <input
              type="text"
              value={templateName}
              onChange={(e) => setTemplateName(e.target.value)}
              placeholder="e.g. ISO 27001 Module Set"
              disabled={!!publishTargetRootId}
            />
            {publishTargetRootId && (
              <p style={{ fontSize: "11px", color: "var(--text3)", margin: "4px 0 0" }}>
                Publishing as the next version of the selected template above.
              </p>
            )}
          </div>
        )}

        {/* Upload Button */}
        <button
          className="btn btn-primary"
          style={{ marginTop: "16px", opacity: (!importFile || importing) ? 0.5 : 1 }}
          disabled={!importFile || importing}
          onClick={handleImport}
        >
          {importing ? "Importing..." : "Upload & Import"}
        </button>

        {/* Import Result */}
        {importResult && (
          <div style={styles.resultBox}>
            <h4 style={{ fontSize: "14px", fontWeight: 600, color: "var(--green)", marginBottom: "8px" }}>✓ Import Complete</h4>
            <p style={{ fontSize: "13px", color: "var(--text2)", margin: "4px 0" }}>Modules imported: <strong style={{ color: "var(--text)" }}>{importResult.modulesImported}</strong></p>
            <p style={{ fontSize: "13px", color: "var(--text2)", margin: "4px 0" }}>Questions imported: <strong style={{ color: "var(--text)" }}>{importResult.questionsImported}</strong></p>
            {importResult.publishedVersion ? (
              <p style={{ fontSize: "13px", color: "var(--accent2)", margin: "4px 0" }}>
                Published as v{importResult.publishedVersion} — {importResult.notifiedCompanyCount} compan{importResult.notifiedCompanyCount === 1 ? "y" : "ies"} notified
              </p>
            ) : importResult.templateId && (
              <p style={{ fontSize: "13px", color: "var(--accent2)", margin: "4px 0" }}>Template saved (ID: {importResult.templateId})</p>
            )}
            {importResult.errors && importResult.errors.length > 0 && (
              <div style={{ marginTop: "8px" }}>
                <p style={{ fontSize: "12px", color: "var(--amber)", marginBottom: "4px" }}>Warnings ({importResult.errors.length}):</p>
                <ul style={{ paddingLeft: "16px", fontSize: "11px", color: "var(--text3)" }}>
                  {importResult.errors.slice(0, 10).map((err, i) => <li key={i}>{err}</li>)}
                  {importResult.errors.length > 10 && <li>...and {importResult.errors.length - 10} more</li>}
                </ul>
              </div>
            )}
          </div>
        )}

        {importError && (
          <div style={{ ...styles.resultBox, borderColor: "rgba(239,68,68,0.3)" }}>
            <p style={{ fontSize: "13px", color: "var(--red)" }}>✗ {importError}</p>
          </div>
        )}
      </div>
    );
  };

  // --- Render Template Detail ---
  const renderTemplateDetail = () => {
    const tpl = selectedTemplate;
    const modules = Array.isArray(tpl.module_data) ? tpl.module_data
      : (typeof tpl.module_data === "string" ? JSON.parse(tpl.module_data) : []);
    const questions = Array.isArray(tpl.question_data) ? tpl.question_data
      : (typeof tpl.question_data === "string" ? JSON.parse(tpl.question_data) : []);

    const search = templateQuestionSearch.trim().toLowerCase();
    const filteredQuestions = search
      ? questions.filter((q) =>
          [q.quest_id, q.baseline_question, q.module_id, q.control_area, q.iso_reference]
            .filter(Boolean).some((v) => String(v).toLowerCase().includes(search)))
      : questions;

    const questionCountByModule = questions.reduce((acc, q) => {
      acc[q.module_id] = (acc[q.module_id] || 0) + 1;
      return acc;
    }, {});

    return (
      <div>
        <button className="btn btn-ghost" style={{ marginBottom: "16px", fontSize: "13px" }} onClick={() => navigate(-1)}>
          ← Back to Templates
        </button>

        {/* Header */}
        <div style={{ background: "var(--bg3)", border: "1px solid var(--border)", borderRadius: "8px", padding: "20px", marginBottom: "20px" }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", flexWrap: "wrap", gap: "12px" }}>
            <div>
              <h3 style={{ fontSize: "18px", fontWeight: 600, color: "var(--text)", margin: "0 0 4px", display: "flex", alignItems: "center", gap: "8px" }}>
                {tpl.name}
                <span style={{ fontSize: "11px", fontWeight: 600, padding: "2px 8px", borderRadius: "4px", background: "var(--bg2)", border: "1px solid var(--border)", color: "var(--accent2)", fontFamily: "var(--mono)" }}>
                  v{tpl.version}
                </span>
                {tpl.framework_key && (
                  <span style={{ fontSize: "11px", fontWeight: 600, padding: "2px 8px", borderRadius: "4px", background: "var(--bg2)", border: "1px solid var(--border)", color: "var(--text2)", fontFamily: "var(--mono)" }}>
                    {tpl.framework_key}
                  </span>
                )}
              </h3>
              <p style={{ fontSize: "12px", color: "var(--text3)", fontFamily: "var(--mono)", margin: 0 }}>
                {tpl.file_name} • {modules.length} modules • {questions.length} questions
              </p>
              <p style={{ fontSize: "12px", color: "var(--text3)", margin: "4px 0 0" }}>
                Created: {new Date(tpl.created_at).toLocaleString()}
                {tpl.published_at && <> • Published: {new Date(tpl.published_at).toLocaleString()}</>}
              </p>
            </div>
          </div>
        </div>

        {/* Version history */}
        {templateVersions.length > 1 && (
          <div style={{ background: "var(--bg3)", border: "1px solid var(--border)", borderRadius: "8px", padding: "20px", marginBottom: "20px" }}>
            <h4 style={{ fontSize: "14px", fontWeight: 600, color: "var(--text)", margin: "0 0 14px" }}>
              Publish History ({templateVersions.length} version{templateVersions.length === 1 ? "" : "s"})
            </h4>
            {loadingTemplateVersions ? (
              <p style={{ fontSize: "13px", color: "var(--text3)" }}>Loading…</p>
            ) : (
              <table style={{ width: "100%", borderCollapse: "collapse", fontSize: "12px" }}>
                <thead>
                  <tr>
                    <th style={{ ...thStyle, fontSize: "10px", padding: "6px 8px" }}>Version</th>
                    <th style={{ ...thStyle, fontSize: "10px", padding: "6px 8px" }}>Questions</th>
                    <th style={{ ...thStyle, fontSize: "10px", padding: "6px 8px" }}>Published</th>
                    <th style={{ ...thStyle, fontSize: "10px", padding: "6px 8px" }}>Status</th>
                  </tr>
                </thead>
                <tbody>
                  {templateVersions.map((v) => (
                    <tr key={v.id} style={{ borderBottom: "1px solid var(--border)", background: v.id === tpl.id ? "rgba(99,102,241,0.06)" : undefined }}>
                      <td style={{ ...tdStyle, fontFamily: "var(--mono)" }}>v{v.version}</td>
                      <td style={tdStyle}>{v.question_count}</td>
                      <td style={tdStyle}>{v.published_at ? new Date(v.published_at).toLocaleString() : "—"}</td>
                      <td style={tdStyle}>
                        {v.is_current ? (
                          <span style={{ fontSize: "10px", fontWeight: 600, padding: "2px 8px", borderRadius: "10px", background: "rgba(34,197,94,0.12)", color: "var(--green)", border: "1px solid rgba(34,197,94,0.3)" }}>Current</span>
                        ) : (
                          <span style={{ fontSize: "10px", color: "var(--text3)" }}>Superseded</span>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        )}

        {/* Modules */}
        <div style={{ background: "var(--bg3)", border: "1px solid var(--border)", borderRadius: "8px", padding: "20px", marginBottom: "20px" }}>
          <h4 style={{ fontSize: "14px", fontWeight: 600, color: "var(--text)", margin: "0 0 14px" }}>
            Modules ({modules.length})
          </h4>
          {modules.length === 0 ? (
            <p style={{ fontSize: "13px", color: "var(--text3)" }}>No modules recorded on this template.</p>
          ) : (
            <div style={{ maxHeight: "260px", overflowY: "auto" }}>
              <table style={{ width: "100%", borderCollapse: "collapse", fontSize: "12px" }}>
                <thead>
                  <tr>
                    <th style={{ ...thStyle, fontSize: "10px", padding: "6px 8px" }}>Module</th>
                    <th style={{ ...thStyle, fontSize: "10px", padding: "6px 8px" }}>Owner</th>
                    <th style={{ ...thStyle, fontSize: "10px", padding: "6px 8px" }}>Frequency</th>
                    <th style={{ ...thStyle, fontSize: "10px", padding: "6px 8px" }}>Questions</th>
                  </tr>
                </thead>
                <tbody>
                  {modules.map((m) => (
                    <tr key={m.module_id} style={{ borderBottom: "1px solid var(--border)" }}>
                      <td style={tdStyle}>
                        <div style={{ fontWeight: 600, color: "var(--text)" }}>{m.name || m.module_id}</div>
                        <div style={{ fontSize: "10px", color: "var(--text3)", fontFamily: "var(--mono)" }}>{m.module_id}</div>
                      </td>
                      <td style={tdStyle}>{m.primary_owner || "—"}</td>
                      <td style={tdStyle}>{m.frequency || "—"}</td>
                      <td style={tdStyle}>{questionCountByModule[m.module_id] || 0}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>

        {/* Questions */}
        <div style={{ background: "var(--bg3)", border: "1px solid var(--border)", borderRadius: "8px", padding: "20px" }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: "12px", marginBottom: "14px" }}>
            <h4 style={{ fontSize: "14px", fontWeight: 600, color: "var(--text)", margin: 0 }}>
              Questions ({filteredQuestions.length}{search ? ` of ${questions.length}` : ""})
            </h4>
            <input
              type="text"
              value={templateQuestionSearch}
              onChange={(e) => setTemplateQuestionSearch(e.target.value)}
              placeholder="Search by id, module, or text…"
              style={{ padding: "6px 10px", background: "var(--bg4)", border: "1px solid var(--border2)", borderRadius: "5px", color: "var(--text)", fontSize: "12px", minWidth: "220px" }}
            />
          </div>
          {questions.length === 0 ? (
            <p style={{ fontSize: "13px", color: "var(--text3)" }}>No questions recorded on this template.</p>
          ) : filteredQuestions.length === 0 ? (
            <p style={{ fontSize: "13px", color: "var(--text3)" }}>No questions match "{templateQuestionSearch}".</p>
          ) : (
            <div style={{ maxHeight: "480px", overflowY: "auto" }}>
              <table style={{ width: "100%", borderCollapse: "collapse", fontSize: "12px" }}>
                <thead>
                  <tr>
                    <th style={{ ...thStyle, fontSize: "10px", padding: "6px 8px" }}>Quest ID</th>
                    <th style={{ ...thStyle, fontSize: "10px", padding: "6px 8px" }}>Module</th>
                    <th style={{ ...thStyle, fontSize: "10px", padding: "6px 8px" }}>Clause/Control</th>
                    <th style={{ ...thStyle, fontSize: "10px", padding: "6px 8px" }}>Question</th>
                  </tr>
                </thead>
                <tbody>
                  {filteredQuestions.map((q) => (
                    <tr key={q.quest_id} style={{ borderBottom: "1px solid var(--border)" }}>
                      <td style={{ ...tdStyle, fontFamily: "var(--mono)", whiteSpace: "nowrap" }}>{q.quest_id}</td>
                      <td style={{ ...tdStyle, fontSize: "11px", color: "var(--text3)" }}>{q.module_id}</td>
                      <td style={{ ...tdStyle, fontSize: "11px", color: "var(--text3)", fontFamily: "var(--mono)" }}>{q.iso_reference || q.control_reference || "—"}</td>
                      <td style={tdStyle}>{q.baseline_question}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>
    );
  };

  // --- Render Modules Tab ---
  const renderModulesTab = () => {
    if (loadingTemplates) return <div style={{ textAlign: "center", padding: "40px", color: "var(--text2)" }}><div className="loading-spinner" style={{ margin: "0 auto 12px" }} /><p>Loading templates...</p></div>;
    if (errorTemplates) return <div style={{ textAlign: "center", padding: "40px", color: "var(--red)" }}>Error: {errorTemplates}<br /><button className="btn btn-ghost" style={{ marginTop: "12px" }} onClick={fetchTemplates}>Retry</button></div>;
    if (templates.length === 0) return <p style={{ color: "var(--text3)", textAlign: "center", padding: "40px" }}>No templates available. Import an Excel file and save as template first.</p>;

    if (selectedTemplate) {
      return renderTemplateDetail();
    }

    return (
      <div>
        <h3 style={{ fontSize: "16px", fontWeight: 600, marginBottom: "16px", color: "var(--text)" }}>Module Templates</h3>
        <div style={{ display: "flex", flexDirection: "column", gap: "12px" }}>
          {templates.map((tpl) => (
            <div key={tpl.id} style={{ background: "var(--bg3)", border: "1px solid var(--border)", borderRadius: "8px", padding: "16px" }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: "12px", flexWrap: "wrap" }}>
                <div
                  style={{ flex: 1, cursor: "pointer" }}
                  onClick={() => openTemplateDetail(tpl)}
                  title="View template details"
                >
                  <h4 style={{ fontSize: "14px", fontWeight: 600, color: "var(--text)", margin: "0 0 4px", display: "flex", alignItems: "center", gap: "8px" }}>
                    {tpl.name}
                    {tpl.version > 1 && (
                      <span title={tpl.published_at ? `Published ${new Date(tpl.published_at).toLocaleDateString()}` : undefined}
                        style={{ fontSize: "10px", fontWeight: 600, padding: "2px 6px", borderRadius: "4px", background: "var(--bg2)", border: "1px solid var(--border)", color: "var(--accent2)", fontFamily: "var(--mono)" }}>
                        v{tpl.version}
                      </span>
                    )}
                    {tpl.framework_key ? (
                      <span style={{ fontSize: "10px", fontWeight: 600, padding: "2px 6px", borderRadius: "4px", background: "var(--bg2)", border: "1px solid var(--border)", color: "var(--text2)", fontFamily: "var(--mono)" }}>
                        {tpl.framework_key}
                      </span>
                    ) : (
                      <span title="Saved without a framework mapping — assigning it will be refused. Re-upload the sheet to refresh it." style={{ fontSize: "10px", fontWeight: 600, padding: "2px 6px", borderRadius: "4px", background: "rgba(245,158,11,0.12)", border: "1px solid rgba(245,158,11,0.4)", color: "#b45309" }}>
                        No framework — re-upload
                      </span>
                    )}
                  </h4>
                  <p style={{ fontSize: "11px", color: "var(--text3)", fontFamily: "var(--mono)", margin: 0 }}>
                    {tpl.file_name} • {tpl.module_count} modules • {tpl.question_count} questions
                  </p>
                  <p style={{ fontSize: "11px", color: "var(--text3)", margin: "4px 0 0" }}>
                    Created: {new Date(tpl.created_at).toLocaleDateString()}
                  </p>
                </div>
                <button
                  className="btn"
                  style={{ padding: "4px 10px", fontSize: "11px", background: "rgba(239,68,68,0.12)", color: "var(--red)", border: "1px solid rgba(239,68,68,0.3)" }}
                  onClick={() => setDeleteConfirm(tpl.id)}
                >
                  Delete
                </button>
              </div>

              {/* Assign to company */}
              <div style={{ display: "flex", gap: "8px", alignItems: "center", marginTop: "12px", flexWrap: "wrap" }}>
                <select
                  value={assignCompanyId[tpl.id] || ""}
                  onChange={(e) => setAssignCompanyId(prev => ({ ...prev, [tpl.id]: e.target.value }))}
                  style={{ flex: 1, minWidth: "180px", padding: "7px 10px", background: "var(--bg4)", border: "1px solid var(--border2)", borderRadius: "5px", color: "var(--text)", fontSize: "12px" }}
                >
                  <option value="">Select company to assign...</option>
                  {companies.map(c => (
                    <option key={c.id} value={c.id}>{c.name} ({c.domain})</option>
                  ))}
                </select>
                <button
                  className="btn btn-primary"
                  style={{ padding: "7px 14px", fontSize: "12px" }}
                  onClick={() => handleAssignTemplate(tpl.id)}
                  disabled={!assignCompanyId[tpl.id]}
                >
                  Assign
                </button>
              </div>

              {/* Delete Confirmation */}
              {deleteConfirm === tpl.id && (
                <div style={{ marginTop: "12px", padding: "12px", background: "rgba(239,68,68,0.06)", border: "1px solid rgba(239,68,68,0.2)", borderRadius: "6px" }}>
                  <p style={{ fontSize: "12px", color: "var(--text2)", margin: "0 0 8px" }}>Are you sure you want to delete "{tpl.name}"?</p>
                  <div style={{ display: "flex", gap: "8px" }}>
                    <button className="btn" style={{ padding: "5px 12px", fontSize: "11px", background: "var(--red)", color: "#fff", border: "none" }} onClick={() => handleDeleteTemplate(tpl.id)}>Confirm Delete</button>
                    <button className="btn btn-ghost" style={{ padding: "5px 12px", fontSize: "11px" }} onClick={() => setDeleteConfirm(null)}>Cancel</button>
                  </div>
                </div>
              )}
            </div>
          ))}
        </div>
      </div>
    );
  };

  // --- Main Render ---
  return (
    <div className="page-container" style={{ minHeight: "100vh", background: "var(--bg)" }}>
      {/* Header */}
      <header style={{ padding: "20px 32px", borderBottom: "1px solid var(--border)", background: "var(--bg2)", display: "flex", alignItems: "center", justifyContent: "space-between", gap: "16px" }}>
        <div>
          <div style={{ fontFamily: "var(--mono)", fontSize: "11px", color: "var(--accent2)", letterSpacing: "0.1em", textTransform: "uppercase" }}>PLATFORM ADMIN</div>
          <h1 style={{ fontSize: "20px", fontWeight: 600, marginTop: "4px", color: "var(--text)" }}>Super Admin Dashboard</h1>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
          <span style={{ fontSize: "12px", color: "var(--text3)" }}>{user?.email}</span>
          <button onClick={onThemeToggle} className="btn btn-ghost" style={{ padding: "6px 10px" }}>
            {theme === "dark" ? "☀️" : "🌙"}
          </button>
          <button onClick={onLogout} className="btn" style={{ padding: "6px 14px", fontSize: "12px", background: "rgba(239,68,68,0.12)", color: "var(--red)", border: "1px solid rgba(239,68,68,0.3)" }}>
            Logout
          </button>
        </div>
      </header>

      {/* Tabs */}
      <div style={styles.tabs}>
        {["companies", "modules", "import", "branding"].map((tab) => (
          <button
            key={tab}
            style={{ ...styles.tab, ...(activeTab === tab ? styles.tabActive : {}) }}
            onClick={() => setActiveTab(tab)}
          >
            {tab === "companies" ? "Companies" : tab === "modules" ? "Modules" : tab === "import" ? "Import" : "Branding"}
          </button>
        ))}
      </div>

      {/* Tab Content */}
      <main style={{ padding: "0 32px 32px" }}>
        {activeTab === "companies" && renderCompaniesTab()}
        {activeTab === "modules" && renderModulesTab()}
        {activeTab === "import" && renderImportTab()}
        {activeTab === "branding" && renderBrandingTab()}
      </main>

      {/* Toast */}
      {toast && (
        <div className={`toast show ${toast.type === "success" ? "success" : ""}`} style={toast.type === "error" ? { borderColor: "rgba(239,68,68,0.3)" } : {}}>
          <span className="t-dot" style={toast.type === "error" ? { background: "var(--red)" } : {}} />
          {toast.message}
        </div>
      )}
    </div>
  );
}

// --- Helper styles ---
const thStyle = {
  textAlign: "left",
  padding: "10px 12px",
  fontSize: "11px",
  fontWeight: 600,
  color: "var(--text3)",
  textTransform: "uppercase",
  letterSpacing: "0.06em",
  borderBottom: "1px solid var(--border)",
  whiteSpace: "nowrap",
};

const tdStyle = {
  padding: "10px 12px",
  fontSize: "13px",
  color: "var(--text)",
  verticalAlign: "middle",
};
