import { useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { apiFetch, apiDownload } from "../api/client.js";
import { BarChart, DonutChart, StackedBarChart, RingChart, BKColumnChart } from "../components/Charts.jsx";
import {
  GRID_COLS, ROW_PX, GRID_MARGIN, MIN_H,
  buildLayout, moveItem, resizeItem,
  layoutRows, itemBox, colWidth, pxToCell,
} from "../utils/gridLayout.js";
import ExportMenu from "../components/ExportMenu.jsx";
import Logo from "../components/Logo";
import NotificationBell from "../components/NotificationBell.jsx";
import EvidenceAiPanel from "../components/EvidenceAiPanel.jsx";
import GlassSelect from "../components/GlassSelect.jsx";
import UserMenu from "../components/UserMenu.jsx";
import { isApprovedStatus } from "../utils/reviewStatus.js";

const WIDGET_DEFS = [
  { id: "maturity-dist",      cls: "dash-card dash-card-wide" },
  { id: "module-bar",         cls: "dash-card dash-card-wide" },
  { id: "module-donuts",      cls: "dash-card dash-card-wide", style: { gridColumn: "1 / -1" } },
  { id: "answer-dist",        cls: "dash-card" },
  { id: "evidence-coverage",  cls: "dash-card dash-card-wide" },
  { id: "action-status",      cls: "dash-card" },
  { id: "evidence-requests",  cls: "dash-card" },
  { id: "evidence-vault",     cls: "dash-card" },
  { id: "score-eligible",     cls: "dash-card" },
  { id: "automated-coverage", cls: "dash-card" },
  { id: "notes-coverage",     cls: "dash-card" },
  { id: "recently-reviewed",  cls: "dash-card dash-card-wide" },
  { id: "rejected-controls",  cls: "dash-card dash-card-wide" },
];
const DEFAULT_WIDGET_ORDER = WIDGET_DEFS.map(w => w.id);

// Health tone for a 0–100 ratio: green healthy, amber mid, indigo default/fresh.
const toneFor = (pct) =>
  pct >= 75 ? "var(--green)" : pct >= 45 ? "var(--dp-accent)" : pct >= 20 ? "var(--amber)" : "var(--dp-accent)";

// The leading-edge data-rule value + colour for a widget. Panels that aren't a
// single ratio return null and the rule stays a quiet hairline.
function ruleFor(id, s) {
  if (!s) return null;
  const ratio = (a, b) => (b > 0 ? Math.round((a / b) * 100) : 0);
  switch (id) {
    case "maturity-dist": {
      const m = s.maturityDistribution || {};
      const n = (m.l1 || 0) + (m.l2 || 0) + (m.l3 || 0) + (m.l4 || 0) + (m.l5 || 0);
      const score = n > 0 ? ((m.l1 || 0) + 2 * (m.l2 || 0) + 3 * (m.l3 || 0) + 4 * (m.l4 || 0) + 5 * (m.l5 || 0)) / n : 0;
      return { pct: Math.round((score / 5) * 100) };
    }
    case "module-bar": return { pct: ratio(s.overall?.finished || 0, s.overall?.total || 0) };
    case "answer-dist": {
      const get = (a) => s.answerDistribution?.find((x) => x.answer === a)?.count || 0;
      const assessed = s.overall?.assessed || 0;
      return { pct: ratio(get("IMPLEMENTED") + get("NOT_APPLICABLE") + 0.5 * get("PARTIALLY_IMPLEMENTED"), assessed) };
    }
    case "evidence-coverage": {
      const cov = (s.evidenceCoverage || []).reduce((t, e) => t + (e.covered || 0), 0);
      const tot = (s.evidenceCoverage || []).reduce((t, e) => t + (e.total || 0), 0);
      return { pct: ratio(cov, tot) };
    }
    case "score-eligible": return { pct: ratio(s.scoreEligible?.count || 0, s.scoreEligible?.total || 0) };
    case "automated-coverage": return { pct: ratio(s.automatedCoverage?.count || 0, s.automatedCoverage?.total || 0) };
    case "notes-coverage": {
      const nm = s.notesMetrics || {};
      const withAny = (nm.withNotes || 0) + (nm.withReviewerNotes || 0);
      return { pct: ratio(withAny, withAny + (nm.withoutAnyNotes || 0)) };
    }
    case "rejected-controls":
      return (s.rejectedControls || []).length > 0
        ? { pct: 100, color: "var(--red)" }
        : { pct: 100, color: "var(--green)" };
    default:
      return null;
  }
}

// One-shot count-up for the standing headline. Honours reduced-motion.
function CountUp({ value, suffix = "", duration = 700 }) {
  const [n, setN] = useState(() =>
    typeof window !== "undefined" && window.matchMedia?.("(prefers-reduced-motion: reduce)").matches ? value : 0
  );
  useEffect(() => {
    if (window.matchMedia?.("(prefers-reduced-motion: reduce)").matches) { setN(value); return; }
    let raf;
    const t0 = performance.now();
    const tick = (t) => {
      const p = Math.min(1, (t - t0) / duration);
      setN(Math.round((1 - Math.pow(1 - p, 3)) * value));
      if (p < 1) raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [value, duration]);
  return <>{n}{suffix}</>;
}

const AVG_MATURITY_LABEL = ["not yet rated", "L1 — Ad-hoc", "L2 — Repeatable", "L3 — Defined", "L4 — Managed", "L5 — Optimised"];

export default function Dashboard({ token, user, company, onLogout, theme, onThemeToggle, isVerified }) {
  const navigate = useNavigate();
  const [stats, setStats] = useState(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const [selectedModule, setSelectedModule] = useState(null);
  const [moduleData, setModuleData] = useState(null);
  const [moduleError, setModuleError] = useState("");
  const [loadingModule, setLoadingModule] = useState(false);
  const [auditorNotesModal, setAuditorNotesModal] = useState(null);
  const auditorNotesRef = useRef("");
  const [reviewLockedOpen, setReviewLockedOpen] = useState(false);
  const [automatedCoverageModalOpen, setAutomatedCoverageModalOpen] = useState(false);
  const [recentReviewsModalOpen, setRecentReviewsModalOpen] = useState(false);
  const [rejectedControlsModalOpen, setRejectedControlsModalOpen] = useState(false);
  const [selectedMonth, setSelectedMonth] = useState(() => {
    const now = new Date();
    return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
  });
  const [dashPriorityFilter, setDashPriorityFilter] = useState("");
  const [dashTagFilter, setDashTagFilter] = useState("");
  const [dashOwnerFilter, setDashOwnerFilter] = useState("");
  const [dashStatusFilter, setDashStatusFilter] = useState("");
  const [dashFramework, setDashFramework] = useState("");
  const [frameworks, setFrameworks] = useState([]);
  const [availableTags, setAvailableTags] = useState([]);
  const [availableOwners, setAvailableOwners] = useState([]);

  // Widget drag-and-drop order (persisted to localStorage)
  const [widgetOrder, setWidgetOrder] = useState(() => {
    try {
      const saved = JSON.parse(localStorage.getItem("prism-widget-order") || "null");
      if (!saved) return DEFAULT_WIDGET_ORDER;
      const merged = saved.filter(id => DEFAULT_WIDGET_ORDER.includes(id));
      DEFAULT_WIDGET_ORDER.forEach(id => { if (!merged.includes(id)) merged.push(id); });
      return merged;
    } catch { return DEFAULT_WIDGET_ORDER; }
  });
  const [dashMenuOpen, setDashMenuOpen] = useState(false);
  const [dashFiltersOpen, setDashFiltersOpen] = useState(false);

  // ── Dashboard layout engine — 12-col grid, absolute-positioned + animated ──
  const defaultW = (id) => {
    const def = WIDGET_DEFS.find((w) => w.id === id);
    if (def?.style?.gridColumn === "1 / -1" || id === "module-donuts") return 12;
    if ((def?.cls || "").includes("dash-card-wide")) return 8;
    return 4;
  };
  const defaultH = (id) => {
    if (id === "module-bar" || id === "evidence-coverage") return 13;
    if (id === "maturity-dist") return 10;
    if (id === "recently-reviewed" || id === "rejected-controls") return 10;
    if (id === "action-status") return 9;
    return 9;
  };
  const [savedLayout, setSavedLayout] = useState(() => {
    try { return JSON.parse(localStorage.getItem("prism-widget-layout") || "{}") || {}; }
    catch { return {}; }
  });
  const [heights, setHeights] = useState({});        // measured content height per id (row units)
  const [narrow, setNarrow] = useState(() =>
    typeof window !== "undefined" && window.matchMedia("(max-width: 820px)").matches
  );
  const [gridW, setGridW] = useState(0);             // grid container inner width (px)
  const [editLayout, setEditLayout] = useState(false);
  // live gesture state: { id, mode: "move"|"e"|"s"|"se", items } — items is the working layout
  const [gesture, setGesture] = useState(null);

  const gridRef = useRef(null);
  const contentRefs = useRef(new Map());
  const roRef = useRef(null);
  const itemsRef = useRef([]);
  const gestureRef = useRef(null);
  useEffect(() => { gestureRef.current = gesture; }, [gesture]);

  const saveOrder = (next) => {
    setWidgetOrder(next);
    try { localStorage.setItem("prism-widget-order", JSON.stringify(next)); } catch {}
  };

  const persist = (items) => {
    const map = {};
    for (const it of items) map[it.id] = { x: it.x, y: it.y, w: it.w, h: it.h };
    setSavedLayout(map);
    try { localStorage.setItem("prism-widget-layout", JSON.stringify(map)); } catch {}
  };

  const resetLayout = () => {
    saveOrder(DEFAULT_WIDGET_ORDER);
    setSavedLayout({});
    setHeights({});
    try { localStorage.removeItem("prism-widget-layout"); } catch {}
  };

  useEffect(() => {
    const mq = window.matchMedia("(max-width: 820px)");
    const h = (e) => setNarrow(e.matches);
    mq.addEventListener("change", h);
    return () => mq.removeEventListener("change", h);
  }, []);

  // Track the grid's inner width so px geometry stays in sync with the viewport.
  useEffect(() => {
    if (narrow || !gridRef.current) return;
    const el = gridRef.current;
    const ro = new ResizeObserver(() => setGridW(el.clientWidth));
    ro.observe(el);
    setGridW(el.clientWidth);
    return () => ro.disconnect();
  }, [narrow, stats]);

  // Reset dynamic data-driven widget heights on framework/data changes so layout immediately auto-sizes to the new module count
  useEffect(() => {
    setHeights((prev) => {
      if (!prev["module-donuts"]) return prev;
      const next = { ...prev };
      delete next["module-donuts"];
      return next;
    });
  }, [dashFramework, stats]);

  // Measure each widget's natural content height → row units (adapts to data changes,
  // e.g. switching frameworks with different module counts or large datasets).
  useEffect(() => {
    const ro = new ResizeObserver((entries) => {
      setHeights((prev) => {
        let changed = false;
        const next = { ...prev };
        for (const entry of entries) {
          const id = entry.target.dataset.wid;
          if (!id) continue;
          const scrollH = entry.target.scrollHeight;
          const offsetH = entry.target.offsetHeight;
          const measuredPx = Math.max(scrollH, offsetH);
          const rows = Math.max(4, Math.ceil((measuredPx + 16) / (ROW_PX + GRID_MARGIN)));
          if ((next[id] ?? 0) !== rows) {
            next[id] = rows;
            changed = true;
          }
        }
        return changed ? next : prev;
      });
    });
    roRef.current = ro;
    for (const el of contentRefs.current.values()) ro.observe(el);
    return () => ro.disconnect();
  }, [savedLayout, stats]);

  // Stable ref callback per widget id (recreating it each render would make
  // React thrash observe/unobserve and drop height measurements).
  const refCbs = useRef(new Map());
  const setContentRef = (id) => {
    if (!refCbs.current.has(id)) {
      refCbs.current.set(id, (el) => {
        const map = contentRefs.current;
        if (el) {
          el.dataset.wid = id;
          map.set(id, el);
          roRef.current?.observe(el);
        } else {
          const prev = map.get(id);
          if (prev) roRef.current?.unobserve(prev);
          map.delete(id);
        }
      });
    }
    return refCbs.current.get(id);
  };

  const colW = () => colWidth(gridW || (gridRef.current?.clientWidth ?? 1200));

  const startGesture = (e, id, mode) => {
    if (!editLayout || !gridRef.current) return;
    e.preventDefault();
    e.stopPropagation();
    const base = itemsRef.current.map((i) => ({ ...i }));
    const start = base.find((i) => i.id === id);
    if (!start) return;
    const cw = colW();
    const stride = cw + GRID_MARGIN;
    const rowStride = ROW_PX + GRID_MARGIN;
    const startBox = itemBox(start, cw);
    const px0 = { x: e.clientX, y: e.clientY };
    let working = base;

    const move = (ev) => {
      const rawDx = ev.clientX - px0.x;
      const rawDy = ev.clientY - px0.y;
      const dxCells = Math.round(rawDx / stride);
      const dyCells = Math.round(rawDy / rowStride);
      if (mode === "move") {
        working = moveItem(base, id, start.x + dxCells, start.y + dyCells);
        itemsRef.current = working;
        setGesture({ id, mode, items: working, ghost: { left: startBox.left + rawDx, top: startBox.top + rawDy } });
      } else {
        const w = mode === "s" ? start.w : start.w + dxCells;
        const h = mode === "e" ? start.h : start.h + dyCells;
        // Let the user shrink freely down to MIN_H — content scrolls inside
        // rather than the drag being clamped back up to the natural content size.
        working = resizeItem(base, id, w, h, MIN_H);
        itemsRef.current = working;
        setGesture({ id, mode, items: working });
      }
    };
    const up = () => {
      document.removeEventListener("pointermove", move);
      document.removeEventListener("pointerup", up);
      persist(working);
      setGesture(null);
    };
    setGesture({ id, mode, items: base });
    document.addEventListener("pointermove", move);
    document.addEventListener("pointerup", up);
  };

  const generateMonthOptions = () => {
    const options = [];
    for (let year = new Date().getFullYear() + 1; year >= 2023; year--) {
      for (let month = 12; month >= 1; month--) {
        options.push(`${year}-${String(month).padStart(2, '0')}`);
      }
    }
    return options;
  };

  // Load filter options (tags, owners) from the sheet once on mount
  useEffect(() => {
    apiFetch("/api/questions", { token })
      .then(qs => {
        const tags = new Set();
        const owners = new Set();
        for (const q of qs || []) {
          if (q.tags) q.tags.split(",").forEach(t => { const s = t.trim(); if (s) tags.add(s); });
          if (q.defaultOwner || q.default_owner) owners.add(q.defaultOwner || q.default_owner);
        }
        setAvailableTags([...tags].sort());
        setAvailableOwners([...owners].sort());
      })
      .catch(() => {});
  }, [token]);

  // The compliance frameworks this company has activated (drives the scope switch)
  useEffect(() => {
    apiFetch("/api/frameworks/mine", { token })
      .then(fw => setFrameworks(Array.isArray(fw) ? fw : []))
      .catch(() => {});
  }, [token]);

  useEffect(() => {
    let active = true;
    setLoading(true);
    let url = `/api/dashboard?month=${selectedMonth}`;
    if (dashFramework) url += `&framework=${encodeURIComponent(dashFramework)}`;
    if (dashPriorityFilter) url += `&priority=${encodeURIComponent(dashPriorityFilter)}`;
    if (dashTagFilter) url += `&tag=${encodeURIComponent(dashTagFilter)}`;
    if (dashOwnerFilter) url += `&owner=${encodeURIComponent(dashOwnerFilter)}`;
    if (dashStatusFilter) url += `&status=${encodeURIComponent(dashStatusFilter)}`;
    apiFetch(url, { token })
      .then(data => { if (active) { setStats(data); setLoading(false); } })
      .catch(err => { if (active) { setError(err.message); setLoading(false); } });
    return () => { active = false; };
  }, [token, selectedMonth, dashFramework, dashPriorityFilter, dashTagFilter, dashOwnerFilter, dashStatusFilter]);

  const isAdmin       = user?.role === "ADMIN";
  const isLeadOrAdmin = user?.role === "ADMIN" || user?.role === "LEAD";
  const isAuditor     = user?.role === "AUDITOR";

  // The module drill-down is month-scoped for everyone except the auditor: an
  // auditor signs off on whichever assessment is current for a control, whatever
  // month it was logged under, so their view drops the month filter and keeps
  // the most recent (approved-if-present) row per question.
  const assessmentsUrl = (moduleId) =>
    isAuditor
      ? `/api/assessments?moduleId=${encodeURIComponent(moduleId)}`
      : `/api/assessments?moduleId=${encodeURIComponent(moduleId)}&month=${selectedMonth}`;
  const evidenceUrl = (moduleId) =>
    isAuditor
      ? `/api/evidence?moduleId=${encodeURIComponent(moduleId)}`
      : `/api/evidence?moduleId=${encodeURIComponent(moduleId)}&month=${selectedMonth}`;

  const dedupeAssessments = (rows) => {
    if (!isAuditor) return rows;
    const rank = (s) => (s === "AUDITED" ? 3 : s === "FINISHED" ? 2 : s === "Submitted" ? 1 : 0);
    const best = new Map();
    for (const a of rows) {
      const key = a.questId || a.quest_id;
      const cur = best.get(key);
      if (!cur) { best.set(key, a); continue; }
      const aS = rank(a.reviewStatus || a.review_status);
      const cS = rank(cur.reviewStatus || cur.review_status);
      if (aS > cS || (aS === cS && (a.month || "") > (cur.month || ""))) best.set(key, a);
    }
    return [...best.values()];
  };

  const openModule = async (module) => {
    setSelectedModule(module);
    setModuleData(null);
    setModuleError("");
    setLoadingModule(true);
    try {
      const [questions, assessments, evidence] = await Promise.all([
        apiFetch(`/api/questions?moduleId=${encodeURIComponent(module.moduleId)}`, { token }),
        apiFetch(assessmentsUrl(module.moduleId), { token }),
        apiFetch(evidenceUrl(module.moduleId), { token })
      ]);
      setModuleData({
        questions:   questions   || [],
        assessments: dedupeAssessments(assessments || []),
        evidence:    evidence    || [],
      });
    } catch (err) {
      setModuleError(err.message || "Failed to load module data");
    } finally {
      setLoadingModule(false);
    }
  };

  const closeModule = () => {
    setSelectedModule(null);
    setModuleData(null);
    setModuleError("");
  };

  const promptAuditorApproval = (assessmentId, status) => {
    auditorNotesRef.current = "";
    setAuditorNotesModal({ assessmentId, status });
  };

  const confirmAuditorApproval = async () => {
    const { assessmentId, status } = auditorNotesModal;
    const notes = auditorNotesRef.current;
    setAuditorNotesModal(null);
    await updateAssessmentStatus(assessmentId, status, notes);
  };

  const updateAssessmentStatus = async (assessmentId, status, auditorNotes) => {
    const moduleId = selectedModule?.moduleId;
    try {
      const response = await apiFetch(`/api/assessments/${assessmentId}`, {
        token,
        method: "PUT",
        body: JSON.stringify({
          reviewStatus: status,
          auditedBy: user?.email,
          auditorNotes: auditorNotes || undefined
        })
      });

      if (!response) throw new Error("Failed to update assessment");

      const [questions, assessments, evidence] = await Promise.all([
        apiFetch(`/api/questions?moduleId=${encodeURIComponent(moduleId)}`, { token }),
        apiFetch(assessmentsUrl(moduleId), { token }),
        apiFetch(evidenceUrl(moduleId), { token })
      ]);
      setModuleData({
        questions:   questions   || [],
        assessments: dedupeAssessments(assessments || []),
        evidence:    evidence    || []
      });

      const dashData = await apiFetch(`/api/dashboard?month=${selectedMonth}`, { token });
      setStats(dashData);
    } catch (err) {
      setError(err.message);
    }
  };

  const viewEvidence = async (id, filename) => {
    try {
      const endpoint = isAuditor ? `/api/evidence/${id}/view` : `/api/evidence/${id}/download`;
      const res = await fetch(apiDownload(endpoint), {
        headers: { Authorization: `Bearer ${token}` }
      });
      if (!res.ok) throw new Error(`Failed to load file (${res.status})`);
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      window.open(url, '_blank');
      setTimeout(() => URL.revokeObjectURL(url), 10000);
    } catch (e) {
      alert(`Error viewing file: ${e.message}`);
      setError(e.message || "Failed to view file");
    }
  };

  const renderWidget = (id) => {
    if (!stats) return null;

    switch (id) {

      case "maturity-dist": {
        const md = stats.maturityDistribution || {};
        const levels = [
          { key: "l1", label: "L1 — Ad-hoc",     color: "var(--red)" },
          { key: "l2", label: "L2 — Repeatable",  color: "var(--amber)" },
          { key: "l3", label: "L3 — Defined",     color: "var(--teal)" },
          { key: "l4", label: "L4 — Managed",     color: "var(--dp-accent)" },
          { key: "l5", label: "L5 — Optimised",   color: "var(--green)" },
        ];
        const total = levels.reduce((s, l) => s + (md[l.key] || 0), 0);
        const avg = total > 0
          ? (levels.reduce((s, l, i) => s + (i + 1) * (md[l.key] || 0), 0) / total)
          : 0;
        return (
          <div className="dash-widget-inner-flex">
            <div className="dash-card-title">
              Maturity distribution
              {total > 0 && <span className="dash-card-tag">avg L{avg.toFixed(1)}</span>}
            </div>
            {total === 0 ? (
              <p className="dash-empty">No maturity levels recorded this period.</p>
            ) : (
              <div className="dash-bars">
                {levels.map(({ key, label, color }) => {
                  const val = md[key] || 0;
                  const pct = Math.round((val / total) * 100);
                  return (
                    <div key={key} className="dash-bar-row">
                      <span className="dash-bar-label">{label}</span>
                      <span className="dash-bar-track">
                        <span className="dash-bar-fill" style={{ width: `${pct}%`, background: color }} />
                      </span>
                      <span className="dash-bar-val">{val}</span>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        );
      }

      case "module-bar":
        return (
          <div className="dash-widget-inner-flex">
            <div className="dash-card-title">
              Per-module completion
              <span className="dash-card-tag">{stats.moduleCompletion?.length || 0} modules</span>
            </div>
            <div className="chart-legend-row" style={{ marginBottom: 8 }}>
              <span className="chart-legend-dot" style={{ background: "var(--green)" }} />
              <span style={{ fontSize: 13, color: "var(--dp-quiet)", fontWeight: 600 }}>Signed off</span>
              <span className="chart-legend-dot" style={{ background: "var(--amber)", marginLeft: 16 }} />
              <span style={{ fontSize: 13, color: "var(--dp-quiet)", fontWeight: 600 }}>In progress</span>
            </div>
            <div className="dash-chart-flex-grow">
              <BKColumnChart
                height={220}
                data={(stats.moduleCompletion || []).map(m => ({
                  label: m.moduleId || m.name,
                  name: m.name,
                  finished: m.finished,
                  assessed: m.assessed,
                  total: m.total
                }))}
                onBarClick={(module) => openModule(module)}
              />
            </div>
          </div>
        );

      case "module-donuts":
        return (
          <div className="dash-widget-inner-flex">
            <div className="dash-card-title">
              Per-module donut breakdown
              <span className="dash-card-tag">{stats.moduleCompletion?.length || 0} modules</span>
            </div>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(200px, 1fr))", gap: 16, paddingTop: 4 }}>
              {stats.moduleCompletion.map((module, idx) => {
                const assessedNotFinished = Math.max(0, module.assessed - module.finished);
                const notStarted = Math.max(0, module.total - Math.max(module.assessed, module.finished));
                const pct = module.total > 0 ? Math.round((module.finished / module.total) * 100) : 0;
                const moduleTitle = module.name && module.name !== module.moduleId
                  ? `${module.moduleId} - ${module.name}`
                  : (module.name || module.moduleId);

                return (
                  <div
                    key={idx}
                    className="dash-card dash-card-module"
                    style={{
                      cursor: "pointer",
                      margin: 0,
                      padding: "16px 16px 14px",
                      display: "flex",
                      flexDirection: "column",
                      alignItems: "stretch",
                      "--rule": `${pct}%`,
                      "--rule-color": toneFor(pct)
                    }}
                    onClick={() => openModule(module)}
                  >
                    <div
                      style={{
                        fontFamily: "var(--dp-font-mono, monospace)",
                        fontSize: 12.5,
                        fontWeight: 600,
                        color: "var(--dp-ink, #0F172A)",
                        textAlign: "center",
                        paddingBottom: 8,
                        borderBottom: "1px solid var(--dp-line, #E2E8F0)",
                        marginBottom: 14,
                        overflow: "hidden",
                        textOverflow: "ellipsis",
                        whiteSpace: "nowrap",
                      }}
                      title={moduleTitle}
                    >
                      {moduleTitle}
                    </div>
                    <DonutChart
                      size={118}
                      centerValue={`${pct}%`}
                      centerCaption="SIGNED OFF"
                      vertical={true}
                      segments={[
                        { label: "Signed off",  value: module.finished,     color: "var(--green, #10B981)" },
                        { label: "In progress", value: assessedNotFinished, color: "var(--amber, #F59E0B)" },
                        { label: "Not started", value: notStarted,          color: "var(--dp-surface-2, #F1F5F9)" }
                      ]}
                    />
                    <div style={{ marginTop: 14, paddingTop: 8, fontSize: 12, color: "var(--dp-quiet, #64748B)", textAlign: "center", fontWeight: 500 }}>
                      {module.finished} of {module.total} controls
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        );

      case "answer-dist": {
        const answered = (a) => stats.answerDistribution?.find(x => x.answer === a)?.count || 0;
        const assessed = stats.overall?.assessed || 0;
        return (
          <div className="dash-widget-inner-flex">
            <div className="dash-card-title">
              Answer mix
              <span className="dash-card-tag">{assessed} assessed</span>
            </div>
            <div style={{ flex: 1, display: "flex", alignItems: "center", justifyContent: "center" }}>
              <RingChart
                size={150}
                strokeWidth={7.5}
                ringGap={4.5}
                defaultCenterValue={answered("IMPLEMENTED")}
                defaultCenterLabel="Impl."
                data={[
                  { label: "Implemented",     value: answered("IMPLEMENTED"),           maxValue: assessed, color: "var(--green)" },
                  { label: "Not Implemented", value: answered("NOT_IMPLEMENTED"),       maxValue: assessed, color: "var(--red)" },
                  { label: "Partial",         value: answered("PARTIALLY_IMPLEMENTED"), maxValue: assessed, color: "var(--amber)" },
                  { label: "Planned",         value: answered("PLANNED"),               maxValue: assessed, color: "var(--dp-accent)" },
                  { label: "Not Applicable",  value: answered("NOT_APPLICABLE"),        maxValue: assessed, color: "var(--dp-quiet)" }
                ]}
              />
            </div>
          </div>
        );
      }

      case "evidence-coverage": {
        const cov = stats.evidenceCoverage.reduce((t, e) => t + (e.covered || 0), 0);
        const tot = stats.evidenceCoverage.reduce((t, e) => t + (e.total || 0), 0);
        const pct = tot > 0 ? Math.round((cov / tot) * 100) : 0;
        return (
          <div className="dash-widget-inner-flex">
            <div className="dash-card-title">
              Evidence coverage
              <span className="dash-card-tag">{cov} of {tot} controls ({pct}%)</span>
            </div>
            <div className="chart-legend-row" style={{ marginBottom: 8 }}>
              <span className="chart-legend-dot" style={{ background: "var(--dp-accent)" }} />
              <span style={{ fontSize: 13, color: "var(--dp-quiet)", fontWeight: 600 }}>Covered</span>
              <span className="chart-legend-dot" style={{ background: "var(--dp-surface-3, rgba(203, 213, 225, 0.7))", marginLeft: 16 }} />
              <span style={{ fontSize: 13, color: "var(--dp-quiet)", fontWeight: 600 }}>Uncovered</span>
            </div>
            <div className="dash-chart-flex-grow">
              <BKColumnChart
                height={220}
                data={stats.evidenceCoverage.map(e => ({
                  label: e.moduleId,
                  name: e.name || e.moduleId,
                  covered: e.covered || 0,
                  total: e.total || 1,
                }))}
                valueKey="covered"
                primaryColor="var(--dp-accent)"
                valueLabel="Evidence Covered"
              />
            </div>
          </div>
        );
      }

      case "action-status":
        return (
          <div className="dash-widget-inner-flex">
            <div className="dash-card-title">Action status</div>
            {stats.actionStatus.length === 0 ? (
              <p className="dash-empty">No remediation actions yet.</p>
            ) : (
              <BarChart
                data={stats.actionStatus.map(a => ({
                  label: (a.status || "OPEN").replace(/_/g, " ").toLowerCase().replace(/^./, (c) => c.toUpperCase()),
                  value: a.count,
                }))}
                valueKey="value"
                labelKey="label"
                color="var(--dp-accent)"
              />
            )}
          </div>
        );

      case "evidence-requests":
        if (!stats.requestMetrics) return null;
        return (
          <div className="dash-widget-inner-flex" onClick={() => navigate("/requests")} style={{ cursor: "pointer" }}>
            <div className="dash-card-title">
              Evidence requests
              <span className="dash-card-tag">tap to open</span>
            </div>
            <div className="dash-kpi-row">
              <div className="dash-kpi">
                <div className="dash-kpi-val" style={{ color: "var(--dp-accent)" }}>{stats.requestMetrics.open}</div>
                <div className="dash-kpi-label">Open</div>
              </div>
              <div className="dash-kpi">
                <div className="dash-kpi-val" style={{ color: "var(--red)" }}>{stats.requestMetrics.overdue}</div>
                <div className="dash-kpi-label">Overdue</div>
              </div>
              <div className="dash-kpi">
                <div className="dash-kpi-val" style={{ color: "var(--green)" }}>{stats.requestMetrics.completed}</div>
                <div className="dash-kpi-label">Completed</div>
              </div>
            </div>
            {stats.requestMetrics.byUser?.length > 0 && (
              <div style={{ marginTop: 12, borderTop: "1px solid var(--dp-line)", paddingTop: 10 }}>
                <div style={{ fontSize: 11, color: "var(--dp-quiet)", marginBottom: 6, fontWeight: 600 }}>By assignee</div>
                {stats.requestMetrics.byUser.map((u, i) => (
                  <div key={i} style={{ display: "flex", justifyContent: "space-between", fontSize: 12, marginBottom: 4 }}>
                    <span style={{ color: "var(--dp-quiet)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", maxWidth: "80%" }}>{u.name}</span>
                    <span style={{ color: "var(--dp-ink)", fontFamily: "var(--mono)", flexShrink: 0 }}>{u.count}</span>
                  </div>
                ))}
              </div>
            )}
          </div>
        );

      case "evidence-vault":
        if (!stats.vaultMetrics) return null;
        return (
          <div className="dash-widget-inner-flex" onClick={() => navigate("/vault")} style={{ cursor: "pointer" }}>
            <div className="dash-card-title">
              Evidence vault
              <span className="dash-card-tag">tap to open</span>
            </div>
            <div className="dash-kpi-row">
              <div className="dash-kpi">
                <div className="dash-kpi-val" style={{ color: "var(--teal)" }}>{stats.vaultMetrics.totalVersions}</div>
                <div className="dash-kpi-label">Total versions</div>
              </div>
              <div className="dash-kpi">
                <div className="dash-kpi-val" style={{ color: "var(--dp-accent)" }}>{stats.vaultMetrics.updatedThisMonth}</div>
                <div className="dash-kpi-label">Updated this month</div>
              </div>
            </div>
            {stats.vaultMetrics.latestModifiedTitle && (
              <div style={{ marginTop: 12, borderTop: "1px solid var(--dp-line)", paddingTop: 10 }}>
                <div style={{ fontSize: 11, color: "var(--dp-quiet)", marginBottom: 4, fontWeight: 600 }}>Last modified</div>
                <div style={{ fontSize: 12, color: "var(--dp-ink)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{stats.vaultMetrics.latestModifiedTitle}</div>
                {stats.vaultMetrics.latestModifiedAt && (
                  <div style={{ fontSize: 11, color: "var(--dp-quiet)", marginTop: 2 }}>
                    {new Date(stats.vaultMetrics.latestModifiedAt).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" })}
                  </div>
                )}
              </div>
            )}
          </div>
        );

      case "score-eligible": {
        if (stats.scoreEligible === undefined) return null;
        const pct = stats.scoreEligible.total > 0
          ? Math.round((stats.scoreEligible.count / stats.scoreEligible.total) * 100) : 0;
        return (
          <div className="dash-widget-inner-flex">
            <div className="dash-card-title">
              Score-eligible controls
              <span className="dash-card-tag">{pct}%</span>
            </div>
            <div className="dash-figure">
              <DonutChart
                segments={[
                  { label: "Eligible", value: stats.scoreEligible.count, color: "var(--green)" },
                  { label: "Other",    value: Math.max(0, stats.scoreEligible.total - stats.scoreEligible.count), color: "var(--dp-surface-2)" }
                ]}
                size={96}
                centerValue={`${pct}%`}
                centerCaption="eligible"
              />
              <div>
                <div className="dash-figure-val">{stats.scoreEligible.count}</div>
                <div className="dash-figure-label">of {stats.scoreEligible.total} controls scored</div>
              </div>
            </div>
          </div>
        );
      }

      case "automated-coverage": {
        if (stats.automatedCoverage === undefined) return null;
        const pct = stats.automatedCoverage.total > 0
          ? Math.round((stats.automatedCoverage.count / stats.automatedCoverage.total) * 100) : 0;
        const hasCoveredQuestions = stats.automatedCoverage.count > 0;
        return (
          <div
            className="dash-widget-inner-flex"
            onClick={hasCoveredQuestions ? () => setAutomatedCoverageModalOpen(true) : undefined}
            style={hasCoveredQuestions ? { cursor: "pointer" } : undefined}
          >
            <div className="dash-card-title">
              Automated coverage
              <span className="dash-card-tag">{hasCoveredQuestions ? "tap to view" : `${pct}%`}</span>
            </div>
            <div className="dash-figure">
              <DonutChart
                segments={[
                  { label: "Automated", value: stats.automatedCoverage.count, color: "var(--dp-accent)" },
                  { label: "Other",     value: Math.max(0, stats.automatedCoverage.total - stats.automatedCoverage.count), color: "var(--dp-surface-2)" }
                ]}
                size={96}
                centerValue={`${pct}%`}
                centerCaption="automated"
              />
              <div>
                <div className="dash-figure-val">{stats.automatedCoverage.count}</div>
                <div className="dash-figure-label">of {stats.automatedCoverage.total} controls automated</div>
              </div>
            </div>
          </div>
        );
      }

      case "notes-coverage":
        if (!stats.notesMetrics) return null;
        return (
          <div className="dash-widget-inner-flex">
            <div className="dash-card-title">Notes coverage</div>
            <div className="dash-kpi-row">
              <div className="dash-kpi">
                <div className="dash-kpi-val" style={{ color: "var(--teal)" }}>{stats.notesMetrics.withNotes}</div>
                <div className="dash-kpi-label">Internal notes</div>
              </div>
              <div className="dash-kpi">
                <div className="dash-kpi-val" style={{ color: "var(--amber)" }}>{stats.notesMetrics.withReviewerNotes}</div>
                <div className="dash-kpi-label">Reviewer notes</div>
              </div>
              <div className="dash-kpi">
                <div className="dash-kpi-val" style={{ color: "var(--dp-quiet)" }}>{stats.notesMetrics.withoutAnyNotes}</div>
                <div className="dash-kpi-label">No notes</div>
              </div>
            </div>
          </div>
        );

      case "recently-reviewed": {
        const allItems = stats.recentlyReviewed || [];
        if (allItems.length === 0) return null;
        const items = allItems.slice(0, 8);
        const fmtTime = (iso) => {
          if (!iso) return "";
          const diff = Date.now() - new Date(iso).getTime();
          const mins = Math.floor(diff / 60000);
          if (mins < 60) return `${mins}m ago`;
          const hrs = Math.floor(mins / 60);
          if (hrs < 24) return `${hrs}h ago`;
          return `${Math.floor(hrs / 24)}d ago`;
        };
        return (
          <div
            className="dash-widget-inner-flex"
            onClick={() => setRecentReviewsModalOpen(true)}
            style={{ cursor: "pointer" }}
          >
            <div className="dash-card-title">
              Recent reviews
              <span className="dash-card-tag">{allItems.length > 8 ? `${allItems.length} · view all` : `${allItems.length} this month`}</span>
            </div>
            <div className="dash-list">
              {items.map(item => {
                const approved = isApprovedStatus(item.reviewStatus);
                const audited = item.reviewStatus === "AUDITED";
                const who = (item.activityBy || item.reviewedBy || "")?.split("@")[0];
                return (
                  <div
                    key={item.id}
                    className="dash-list-row"
                    style={{ "--row-tone": approved ? "var(--green)" : "var(--amber)" }}
                  >
                    <span style={{ flexShrink: 0, color: approved ? "var(--green)" : "var(--amber)" }}>
                      {approved ? "✓" : "•"}
                    </span>
                    <span className="dash-list-code">{item.questId}</span>
                    <span className="dash-list-main">{item.controlArea || item.moduleId}</span>
                    <span className="dash-list-meta">{audited ? `audit · ${who}` : who}</span>
                    <span className="dash-list-meta">{fmtTime(item.activityAt || item.reviewedAt)}</span>
                  </div>
                );
              })}
            </div>
          </div>
        );
      }

      case "rejected-controls": {
        const allItems = stats.rejectedControls || [];
        const items = allItems.slice(0, 8);
        const fmtTime = (iso) => {
          if (!iso) return "";
          const diff = Date.now() - new Date(iso).getTime();
          const mins = Math.floor(diff / 60000);
          if (mins < 60) return `${mins}m ago`;
          const hrs = Math.floor(mins / 60);
          if (hrs < 24) return `${hrs}h ago`;
          return `${Math.floor(hrs / 24)}d ago`;
        };
        return (
          <div
            className="dash-widget-inner-flex"
            onClick={allItems.length > 0 ? () => setRejectedControlsModalOpen(true) : undefined}
            style={allItems.length > 0 ? { cursor: "pointer" } : undefined}
          >
            <div className="dash-card-title">
              Rejected controls
              <span className="dash-card-tag" style={allItems.length > 0 ? { color: "var(--red)" } : undefined}>
                {allItems.length > 0 ? (allItems.length > 8 ? `${allItems.length} · view all` : `${allItems.length} to rework`) : "all clear"}
              </span>
            </div>
            {items.length === 0 ? (
              <p className="dash-empty" style={{ color: "var(--green)" }}>
                <span>✓</span> Nothing sent back this cycle.
              </p>
            ) : (
              <div className="dash-list">
                {items.map(item => {
                  const byAuditor = item.auditorNotes && item.auditorNotes.trim();
                  const rejectorEmail = byAuditor ? item.auditedBy : item.reviewedBy;
                  const rejectorLabel = byAuditor ? "Auditor" : "Reviewer";
                  const reason = byAuditor ? item.auditorNotes : item.reviewerNotes;
                  const rejectedAt = byAuditor ? item.auditedAt : item.reviewedAt;
                  return (
                    <div
                      key={item.id}
                      className="dash-list-row"
                      style={{ "--row-tone": "var(--red)", flexDirection: "column", alignItems: "stretch", gap: 5, cursor: "pointer" }}
                      onClick={(e) => { e.stopPropagation(); navigate(`/tracker?quest=${encodeURIComponent(item.questId)}`); }}
                    >
                      <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                        <span className="dash-list-code" style={{ color: "var(--red)" }}>{item.questId}</span>
                        <span className="dash-list-main" style={{ fontWeight: 600 }}>{item.controlArea}</span>
                        <span className="dash-list-meta" style={{ fontFamily: "var(--mono)", fontSize: 10 }}>{rejectorLabel}</span>
                        {rejectedAt && <span className="dash-list-meta">{fmtTime(rejectedAt)}</span>}
                      </div>
                      {reason && (
                        <div style={{ fontSize: 12, color: "var(--dp-quiet)", lineHeight: 1.5 }}>
                          <span style={{ fontFamily: "var(--mono)", fontSize: 11 }}>
                            {rejectorEmail?.split("@")[0] || rejectorLabel}:{" "}
                          </span>
                          {reason}
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        );
      }

      default:
        return null;
    }
  };

  const activeFilterCount = [dashStatusFilter, dashPriorityFilter, dashOwnerFilter, dashTagFilter].filter(Boolean).length;
  const clearDashFilters = () => { setDashTagFilter(""); setDashPriorityFilter(""); setDashOwnerFilter(""); setDashStatusFilter(""); };

  // ── Audit-standing hero (derived, read-only) ──
  const pctOf = (a, b) => (b > 0 ? Math.round((a / b) * 100) : 0);
  const monthLabel = new Date(selectedMonth + "-01").toLocaleDateString("en-US", { month: "long", year: "numeric" });
  const activeFramework = frameworks.find((f) => f.key === dashFramework);
  const frameworkLabel = activeFramework
    ? activeFramework.name
    : frameworks.length === 1
      ? frameworks[0].name
      : frameworks.length > 1
        ? "All frameworks"
        : "Compliance workspace";
  const o = stats?.overall || { total: 0, assessed: 0, finished: 0 };
  const inProgress = Math.max(0, o.assessed - o.finished);
  const notStarted = Math.max(0, o.total - Math.max(o.assessed, o.finished));
  const signedOffPct = pctOf(o.finished, o.total);
  const auditedCount = stats?.auditorStats?.audited ?? 0;
  const awaitingAuditCount = stats?.auditorStats?.awaitingAudit ?? 0;
  const notYetReviewedForAudit = Math.max(0, o.total - auditedCount - awaitingAuditCount);
  const auditedPct = pctOf(auditedCount, o.total);
  const md = stats?.maturityDistribution || {};
  const mdN = (md.l1 || 0) + (md.l2 || 0) + (md.l3 || 0) + (md.l4 || 0) + (md.l5 || 0);
  const avgMat = mdN > 0
    ? ((md.l1 || 0) + 2 * (md.l2 || 0) + 3 * (md.l3 || 0) + 4 * (md.l4 || 0) + 5 * (md.l5 || 0)) / mdN
    : 0;
  const avgMatLabel = AVG_MATURITY_LABEL[Math.round(avgMat)] || "not yet rated";
  const evCov = (stats?.evidenceCoverage || []).reduce((t, e) => t + (e.covered || 0), 0);
  const evTot = (stats?.evidenceCoverage || []).reduce((t, e) => t + (e.total || 0), 0);
  const openActions = (stats?.actionStatus || [])
    .filter((a) => !["DONE", "CLOSED", "COMPLETED"].includes(a.status))
    .reduce((t, a) => t + (a.count || 0), 0);
  const overdue = stats?.overdueQuestions || 0;

  return (
    <div className="dash-shell fade-in" id="print-area">
      <div className="dash-header no-print">
        <div className="dash-brand">
          <div className="dash-brand-logo">
            <Logo style={{ height: 82, display: "block", transform: "scale(0.46)", transformOrigin: "left center" }} />
          </div>
          {company?.name && (
            <>
              <div className="dash-brand-rule" />
              <div className="dash-brand-text">
                <span className="dash-brand-name">{company.name}</span>
                <span className="dash-brand-kicker">{frameworkLabel}</span>
              </div>
            </>
          )}
        </div>
        <div className="dash-header-actions">
          {/* Compliance scope — only when the company runs more than one framework */}
          {frameworks.length > 1 && (
            <GlassSelect
              value={dashFramework}
              onChange={setDashFramework}
              placeholder="All frameworks"
              options={[
                { value: "", label: "All frameworks" },
                ...frameworks.map(f => ({ value: f.key, label: f.name }))
              ]}
              icon={
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/>
                </svg>
              }
            />
          )}
          {/* Month */}
          <GlassSelect
            value={selectedMonth}
            onChange={setSelectedMonth}
            options={generateMonthOptions().map(month => ({
              value: month,
              label: new Date(month + '-01').toLocaleDateString('en-US', { year: 'numeric', month: 'long' })
            }))}
            icon={
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <rect x="3" y="4" width="18" height="18" rx="2" ry="2"/>
                <line x1="16" y1="2" x2="16" y2="6"/>
                <line x1="8" y1="2" x2="8" y2="6"/>
                <line x1="3" y1="10" x2="21" y2="10"/>
              </svg>
            }
          />
          {/* Filters — collapsed into a popover */}
          <div style={{ position: "relative" }}>
            <button
              className={`btn ${activeFilterCount ? "btn-primary" : "btn-ghost"}`}
              onClick={() => setDashFiltersOpen(v => !v)}
              title="Filter by status, priority, owner or tag"
              style={{ display: "inline-flex", alignItems: "center", gap: 8 }}
            >
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" style={{ color: activeFilterCount ? "#fff" : "var(--dp-accent, #4F46E5)" }}>
                <polygon points="22 3 2 3 10 12.46 10 19 14 21 14 12.46 22 3" />
              </svg>
              <span>Filters{activeFilterCount ? ` · ${activeFilterCount}` : ""}</span>
            </button>
            {dashFiltersOpen && (
              <>
                <div style={{ position: "fixed", inset: 0, zIndex: 1999 }} onClick={() => setDashFiltersOpen(false)} />
                <div style={{
                  position: "absolute", top: "calc(100% + 8px)", right: 0, zIndex: 2000,
                  background: "linear-gradient(135deg, rgba(255, 255, 255, 0.68) 0%, rgba(255, 255, 255, 0.42) 100%)",
                  backdropFilter: "blur(36px) saturate(210%)",
                  WebkitBackdropFilter: "blur(36px) saturate(210%)",
                  border: "1px solid rgba(255, 255, 255, 0.75)",
                  borderRadius: 16,
                  boxShadow: "0 24px 50px -8px rgba(15, 23, 42, 0.2), 0 0 0 1px rgba(255, 255, 255, 0.4), inset 0 1.5px 1px 0 rgba(255, 255, 255, 0.95)",
                  width: 270, padding: 16,
                  display: "flex", flexDirection: "column", gap: 12,
                }}>
                  <div className="dash-filter-field">
                    <span style={{ fontSize: 12, fontWeight: 700, color: "var(--dp-muted)", textTransform: "uppercase", letterSpacing: "0.06em", marginBottom: 4, display: "block" }}>Status</span>
                    <GlassSelect
                      value={dashStatusFilter}
                      onChange={setDashStatusFilter}
                      style={{ width: "100%" }}
                      align="left"
                      options={[
                        { value: "", label: "All statuses" },
                        { value: "IMPLEMENTED", label: "Implemented" },
                        { value: "PARTIALLY_IMPLEMENTED", label: "Partially Implemented" },
                        { value: "PLANNED", label: "Planned" },
                        { value: "NOT_IMPLEMENTED", label: "Not Implemented" },
                        { value: "NOT_APPLICABLE", label: "Not Applicable" },
                      ]}
                    />
                  </div>
                  <div className="dash-filter-field">
                    <span style={{ fontSize: 12, fontWeight: 700, color: "var(--dp-muted)", textTransform: "uppercase", letterSpacing: "0.06em", marginBottom: 4, display: "block" }}>Priority</span>
                    <GlassSelect
                      value={dashPriorityFilter}
                      onChange={setDashPriorityFilter}
                      style={{ width: "100%" }}
                      align="left"
                      options={[
                        { value: "", label: "All priorities" },
                        { value: "Critical", label: "Critical" },
                        { value: "High", label: "High" },
                        { value: "Medium", label: "Medium" },
                        { value: "Low", label: "Low" },
                      ]}
                    />
                  </div>
                  {availableOwners.length > 0 && (
                    <div className="dash-filter-field">
                      <span style={{ fontSize: 12, fontWeight: 700, color: "var(--dp-muted)", textTransform: "uppercase", letterSpacing: "0.06em", marginBottom: 4, display: "block" }}>Owner</span>
                      <GlassSelect
                        value={dashOwnerFilter}
                        onChange={setDashOwnerFilter}
                        style={{ width: "100%" }}
                        align="left"
                        options={[
                          { value: "", label: "All owners" },
                          ...availableOwners.map(o => ({ value: o, label: o }))
                        ]}
                      />
                    </div>
                  )}
                  {availableTags.length > 0 && (
                    <div className="dash-filter-field">
                      <span style={{ fontSize: 12, fontWeight: 700, color: "var(--dp-muted)", textTransform: "uppercase", letterSpacing: "0.06em", marginBottom: 4, display: "block" }}>Tag</span>
                      <GlassSelect
                        value={dashTagFilter}
                        onChange={setDashTagFilter}
                        style={{ width: "100%" }}
                        align="left"
                        options={[
                          { value: "", label: "All tags" },
                          ...availableTags.map(t => ({ value: t, label: t }))
                        ]}
                      />
                    </div>
                  )}
                  {activeFilterCount > 0 && (
                    <button
                      className="btn btn-ghost"
                      style={{ fontSize: 13, fontWeight: 600, color: "var(--red, #EF4444)", marginTop: 4 }}
                      onClick={clearDashFilters}
                    >
                      Clear all filters
                    </button>
                  )}
                </div>
              </>
            )}
          </div>
          {/* Core actions */}
          <div className="dash-segment">
            <span className="dash-segment-btn active">Detailed</span>
            <button className="dash-segment-btn" onClick={() => navigate("/executive")}>Executive</button>
          </div>
          {!narrow && (
            <button
              className={`btn ${editLayout ? "btn-primary" : "btn-ghost"}`}
              onClick={() => setEditLayout(v => !v)}
              title="Rearrange and resize dashboard widgets"
              style={{ display: "inline-flex", alignItems: "center", gap: 8 }}
            >
              {editLayout ? (
                <>
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round">
                    <polyline points="20 6 9 17 4 12" />
                  </svg>
                  <span>Done</span>
                </>
              ) : (
                <>
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" style={{ color: "var(--dp-accent, #4F46E5)" }}>
                    <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7" />
                    <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z" />
                  </svg>
                  <span>Customize</span>
                </>
              )}
            </button>
          )}
          <NotificationBell token={token} />
          {!isAuditor && (
            <button
              className="btn btn-ghost"
              onClick={() => navigate("/tracker")}
              style={{ display: "inline-flex", alignItems: "center", gap: 8 }}
            >
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" style={{ color: "var(--dp-accent, #4F46E5)" }}>
                <path d="M9 11l3 3L22 4" />
                <path d="M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11" />
              </svg>
              <span>Tracker</span>
            </button>
          )}
          {isAuditor && (
            <button
              className="btn btn-ghost"
              onClick={() => navigate("/review")}
              style={{ display: "inline-flex", alignItems: "center", gap: 8 }}
            >
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" style={{ color: "var(--dp-accent, #4F46E5)" }}>
                <path d="M9 11l3 3L22 4" />
                <path d="M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11" />
              </svg>
              <span>Audit queue</span>
            </button>
          )}
          {stats && <ExportMenu stats={stats} company={company} />}
          <UserMenu
            user={user}
            company={company}
            theme={theme}
            onThemeToggle={onThemeToggle}
            onLogout={onLogout}
            isVerified={isVerified}
            onResetLayout={resetLayout}
          />
        </div>
      </div>

      {stats && !loading && (
        <div className="dash-standing">
          <div className="dash-standing-hero">
            <div className="dash-eyebrow">
              <span>{isAuditor ? "Audit progress" : "Audit standing"}</span>
              <span className="dash-tag">{monthLabel}</span>
              {activeFramework && (
                <span className="dash-tag dash-tag-framework" title={activeFramework.name}>
                  {activeFramework.name}
                </span>
              )}
            </div>
            <div className="dash-standing-num">
              <CountUp value={isAuditor ? auditedPct : signedOffPct} /><span className="dash-standing-pct">%</span>
            </div>
            <div className="dash-standing-num-label">
              {o.total > 0
                ? (isAuditor ? `of ${o.total} in-scope controls audited` : `of ${o.total} in-scope controls signed off`)
                : "no controls in scope yet"}
            </div>
            <div
              className="dash-tristate"
              role="img"
              aria-label={
                isAuditor
                  ? `${auditedCount} audited, ${awaitingAuditCount} awaiting audit, ${notYetReviewedForAudit} not yet reviewed`
                  : `${o.finished} signed off, ${inProgress} in progress, ${notStarted} not started`
              }
            >
              {isAuditor ? (
                <>
                  <span style={{ width: `${pctOf(auditedCount, o.total)}%`, background: "var(--green)" }} />
                  <span style={{ width: `${pctOf(awaitingAuditCount, o.total)}%`, background: "var(--amber)" }} />
                </>
              ) : (
                <>
                  <span style={{ width: `${pctOf(o.finished, o.total)}%`, background: "var(--green)" }} />
                  <span style={{ width: `${pctOf(inProgress, o.total)}%`, background: "var(--amber)" }} />
                </>
              )}
            </div>
            <div className="dash-tristate-legend">
              {isAuditor ? (
                <>
                  <span><span className="dash-tristate-dot" style={{ background: "var(--green)" }} />Audited <i>{auditedCount}</i></span>
                  <span><span className="dash-tristate-dot" style={{ background: "var(--amber)" }} />Awaiting audit <i>{awaitingAuditCount}</i></span>
                  <span><span className="dash-tristate-dot" style={{ background: "var(--dp-line-strong)" }} />Not yet reviewed <i>{notYetReviewedForAudit}</i></span>
                </>
              ) : (
                <>
                  <span><span className="dash-tristate-dot" style={{ background: "var(--green)" }} />Signed off <i>{o.finished}</i></span>
                  <span><span className="dash-tristate-dot" style={{ background: "var(--amber)" }} />In progress <i>{inProgress}</i></span>
                  <span><span className="dash-tristate-dot" style={{ background: "var(--dp-line-strong)" }} />Not started <i>{notStarted}</i></span>
                </>
              )}
            </div>
          </div>

          <div className="dash-standing-read">
            {/* Executive Highlighted Assessment Banner */}
            <div className="dash-standing-sentence">
              {o.total > 0 ? (
                <div className="dash-sentence-inner">
                  {isAuditor ? (
                    <>
                      <span className="dash-sentence-chunk">
                        <strong className="dash-highlight-num green">{auditedCount}</strong>
                        <span className="dash-highlight-denom">of {o.total}</span> controls audited
                      </span>
                      <span className="dash-sentence-dot">·</span>
                      <span className="dash-sentence-chunk">
                        <strong className="dash-highlight-num">{awaitingAuditCount}</strong> awaiting your sign-off
                      </span>
                    </>
                  ) : (
                    <>
                      <span className="dash-sentence-chunk">
                        <strong className="dash-highlight-num">{o.assessed}</strong>
                        <span className="dash-highlight-denom">of {o.total}</span> controls assessed
                      </span>
                      <span className="dash-sentence-dot">·</span>
                      <span className="dash-sentence-chunk">
                        <strong className="dash-highlight-num green">{o.finished}</strong> signed off
                      </span>
                    </>
                  )}
                  <span className="dash-sentence-dot">·</span>
                  <span className="dash-sentence-chunk">
                    Average maturity sits at <strong className="dash-highlight-badge purple">{avgMatLabel}</strong>
                  </span>
                  <span className="dash-sentence-dot">·</span>
                  <span className="dash-sentence-chunk">
                    {overdue > 0 ? (
                      <span className="dash-highlight-badge red"><b>{overdue}</b> overdue</span>
                    ) : (
                      <span className="dash-highlight-badge green">✓ Nothing is overdue</span>
                    )}
                  </span>
                </div>
              ) : (
                "Import your control set to start tracking audit readiness."
              )}
            </div>

            {/* Operational Metrics Readout (2x2 Grid) */}
            <div className="dash-readouts">
              <div className="dash-readout">
                <span className="dash-readout-val">{pctOf(evCov, evTot)}%</span>
                <span className="dash-readout-label">Evidence coverage</span>
              </div>
              {isAuditor ? (
                <div
                  className="dash-readout"
                  onClick={() => navigate("/review")}
                  style={{ cursor: "pointer" }}
                >
                  <span className="dash-readout-val">{awaitingAuditCount}</span>
                  <span className="dash-readout-label">Awaiting audit</span>
                </div>
              ) : (
                <div
                  className="dash-readout"
                  onClick={() => navigate("/remediation")}
                  style={{ cursor: "pointer" }}
                >
                  <span className="dash-readout-val">{openActions}</span>
                  <span className="dash-readout-label">Open actions</span>
                </div>
              )}
              <div className="dash-readout">
                <span className="dash-readout-val">{stats.scoreEligible?.count ?? 0}</span>
                <span className="dash-readout-label">Score-eligible controls</span>
              </div>
              <div
                className="dash-readout"
                onClick={stats.automatedCoverage?.count > 0 ? () => setAutomatedCoverageModalOpen(true) : undefined}
                style={stats.automatedCoverage?.count > 0 ? { cursor: "pointer" } : undefined}
              >
                <span className="dash-readout-val">{stats.automatedCoverage?.count ?? 0}</span>
                <span className="dash-readout-label">Automated checks</span>
              </div>
            </div>
          </div>
        </div>
      )}

      {(dashPriorityFilter || dashTagFilter || dashOwnerFilter || dashStatusFilter) && !loading && (
        <div style={{
          margin: "14px 28px 0",
          padding: "8px 14px",
          background: "color-mix(in srgb, var(--dp-accent) 8%, transparent)",
          border: "1px solid color-mix(in srgb, var(--dp-accent) 28%, transparent)",
          borderRadius: 8,
          display: "flex",
          alignItems: "center",
          gap: 10,
          fontSize: 13,
          color: "var(--dp-quiet)",
        }}>
          <span style={{ color: "var(--dp-accent)", fontWeight: 600 }}>Filtered:</span>
          {dashStatusFilter && <span>Status: <strong>{dashStatusFilter.replace(/_/g, " ")}</strong></span>}
          {dashPriorityFilter && <span>Priority: <strong>{dashPriorityFilter}</strong></span>}
          {dashOwnerFilter && <span>Owner: <strong>{dashOwnerFilter}</strong></span>}
          {dashTagFilter && <span>Tag: <strong>{dashTagFilter}</strong></span>}
          {stats?.overall?.total === 0 && (
            <span style={{ color: "var(--red, #ef4444)", marginLeft: 4 }}>— no questions match this filter</span>
          )}
          <button
            onClick={clearDashFilters}
            style={{ marginLeft: "auto", background: "none", border: "none", color: "var(--text3)", cursor: "pointer", fontSize: 13 }}
          >
            ✕ Clear filters
          </button>
        </div>
      )}
      {error && <div className="error-text" style={{ padding: "0 28px 16px" }}>{error}</div>}

      {loading ? (
        <div className="tracker-loading">
          <div className="loading-spinner" />
          <p>Loading dashboard…</p>
        </div>
      ) : stats ? (
        (() => {
          const rendered = widgetOrder
            .map((id) => ({ id, def: WIDGET_DEFS.find((w) => w.id === id), content: renderWidget(id) }))
            .filter((x) => x.def && x.content !== null);

          const ruleStyleFor = (id) => {
            const r = ruleFor(id, stats);
            return r ? { "--rule": `${r.pct}%`, "--rule-color": r.color || toneFor(r.pct) } : undefined;
          };

          // Narrow screens: single-column stack, no layout engine.
          if (narrow) {
            return (
              <div className="dash-grid-stack">
                {rendered.map(({ id, def, content }) => (
                  <div key={id} className={`dash-widget ${def.cls}`} style={ruleStyleFor(id)}>
                    <div className="dash-card-scroll"><div className="dash-card-measure">{content}</div></div>
                  </div>
                ))}
              </div>
            );
          }

          const order = rendered.map((x) => x.id);
          const base = buildLayout(order, savedLayout, heights, defaultW, defaultH);
          const items = gesture ? gesture.items : base;
          itemsRef.current = items;
          const byId = Object.fromEntries(items.map((i) => [i.id, i]));
          const cw = colWidth(gridW || 1200);
          const rows = layoutRows(items);
          return (
            <div className={`dash-canvas-wrap ${editLayout ? "dash-canvas-edit" : ""}`}>
              <div
                ref={gridRef}
                className="dash-canvas"
                style={{ height: rows * (ROW_PX + GRID_MARGIN) + 4 }}
              >
              {gesture?.ghost && byId[gesture.id] && (
                (() => {
                  const slot = itemBox(byId[gesture.id], cw);
                  return (
                    <div
                      className="dash-drop-slot"
                      style={{ transform: `translate(${slot.left}px, ${slot.top}px)`, width: slot.width, height: slot.height }}
                    />
                  );
                })()
              )}
              {rendered.map(({ id, def, content }) => {
                const it = byId[id];
                if (!it) return null;
                const slotBox = itemBox(it, cw);
                const active = gesture?.id === id;
                const box = active && gesture.ghost
                  ? { ...slotBox, left: gesture.ghost.left, top: gesture.ghost.top }
                  : slotBox;
                return (
                  <div
                    key={id}
                    className={`dash-widget ${def.cls} ${editLayout ? "dash-widget-edit" : ""} ${active ? "dash-widget-active" : ""}`}
                    style={{
                      transform: `translate(${box.left}px, ${box.top}px)`,
                      width: box.width,
                      height: box.height,
                      transition: active ? "none" : undefined,
                      zIndex: active ? 30 : undefined,
                      userSelect: editLayout ? "none" : "auto",
                      ...ruleStyleFor(id),
                    }}
                  >
                    {editLayout && (
                      <button
                        type="button"
                        className="dash-grip no-print"
                        title="Drag to move"
                        onPointerDown={(e) => startGesture(e, id, "move")}
                      >⠿ <span>Move</span></button>
                    )}
                    <div className="dash-card-scroll">
                      <div className="dash-card-measure" ref={setContentRef(id)}>{content}</div>
                    </div>
                    {editLayout && (
                      <>
                        <span className="dash-rz dash-rz-e no-print" title="Resize width"
                          onPointerDown={(e) => startGesture(e, id, "e")} />
                        <span className="dash-rz dash-rz-s no-print" title="Resize height"
                          onPointerDown={(e) => startGesture(e, id, "s")} />
                        <span className="dash-rz dash-rz-se no-print" title="Resize"
                          onPointerDown={(e) => startGesture(e, id, "se")} />
                      </>
                    )}
                  </div>
                );
              })}
              </div>
            </div>
          );
        })()
      ) : null}

      {/* Module Detail Modal */}
      {selectedModule && (
        <div className="modal-overlay" onClick={closeModule}>
          <div className="module-modal" onClick={(e) => e.stopPropagation()}>
            <div className="module-modal-header">
              <div>
                <div className="module-modal-title">{selectedModule.moduleId}</div>
                <div className="module-modal-subtitle">{selectedModule.name}</div>
              </div>
              <button className="modal-close" onClick={closeModule}>×</button>
            </div>

            <div className="module-modal-content">
              {loadingModule ? (
                <div style={{ padding: 40, textAlign: "center", color: "var(--text3)" }}>
                  <div className="loading-spinner" />
                  <p style={{ marginTop: 16 }}>Loading module data...</p>
                </div>
              ) : moduleError ? (
                <div style={{ padding: 32, textAlign: "center", color: "var(--red)" }}>
                  <p style={{ fontWeight: 600 }}>Failed to load module</p>
                  <p style={{ fontSize: 13, marginTop: 8, color: "var(--text2)" }}>{moduleError}</p>
                </div>
              ) : moduleData && moduleData.questions.length === 0 ? (
                <div style={{ padding: 40, textAlign: "center", color: "var(--text3)", fontSize: 14 }}>
                  No questions found for this module.
                </div>
              ) : moduleData ? (
                <div className="quest-details-list">
                  {moduleData.questions
                    .filter(q => {
                      if (dashPriorityFilter && q.priority !== dashPriorityFilter) return false;
                      if (dashTagFilter) {
                        const qTags = (q.tags || '').split(',').map(t => t.trim());
                        if (!qTags.includes(dashTagFilter)) return false;
                      }
                      return true;
                    })
                    .map(q => {
                      const qId = q.questId || q.quest_id;
                      const assessment = (moduleData.assessments || []).find(a =>
                        (a.questId || a.quest_id) === qId
                      );
                      const ev = (moduleData.evidence || []).filter(e => e.questId === q.questId);
                      const statusColor = isApprovedStatus(assessment?.reviewStatus || assessment?.review_status)
                        ? "var(--green)"
                        : assessment ? "var(--amber)" : "var(--text3)";

                      return (
                        <div key={q.questId || q.quest_id} className="quest-detail-item">
                          <div className="quest-detail-header">
                            <div style={{ flex: 1 }}>
                              <div style={{ fontWeight: 600, fontSize: 13, color: "var(--text)" }}>
                                {q.questId || q.quest_id}: {q.controlArea || q.control_area}
                              </div>
                              <div style={{ fontSize: 12, color: "var(--text2)", marginTop: 4 }}>
                                {q.baselineQuestion || q.baseline_question}
                              </div>
                              <div style={{ display: "flex", gap: 6, marginTop: 6, flexWrap: "wrap" }}>
                                {q.priority && (
                                  <span className={`priority-badge priority-${(q.priority || '').toLowerCase()}`}>
                                    {q.priority}
                                  </span>
                                )}
                                {(q.tags || '').split(',').filter(t => t.trim()).map(tag => (
                                  <span key={tag.trim()} className="tag-badge">{tag.trim()}</span>
                                ))}
                              </div>
                            </div>
                            <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap", justifyContent: "flex-end" }}>
                              {assessment && (
                                <>
                                  <div className="quest-badge" style={{ background: statusColor }}>
                                    {assessment.answer}
                                  </div>
                                  <div className="quest-maturity">
                                    L{assessment.currentLevel || assessment.current_level}
                                  </div>
                                  {assessment.comments && (
                                    <span title={assessment.comments.slice(0, 100)} style={{ fontSize: 11, fontWeight: 600, padding: "2px 6px", borderRadius: 4, background: "var(--bg4)", color: "var(--text2)", border: "1px solid var(--border2)", cursor: "default" }}>📝 Notes</span>
                                  )}
                                  {(assessment.reviewerNotes || assessment.reviewer_notes) && (
                                    <span title={(assessment.reviewerNotes || assessment.reviewer_notes).slice(0, 100)} style={{ fontSize: 11, fontWeight: 600, padding: "2px 6px", borderRadius: 4, background: "var(--bg4)", color: "var(--amber)", border: "1px solid var(--border2)", cursor: "default" }}>👁 Review</span>
                                  )}
                                </>
                              )}
                            </div>
                          </div>

                          {assessment && (
                            <div style={{ marginTop: 12, fontSize: 12, color: "var(--text3)" }}>
                              <div><strong>Status:</strong> {assessment.reviewStatus || assessment.review_status}</div>
                              {assessment.comments && (
                                <div style={{ marginTop: 4 }}><strong>Internal Notes:</strong> {assessment.comments}</div>
                              )}
                              {(assessment.reviewedBy || assessment.reviewed_by) && (
                                <div style={{ marginTop: 4 }}>
                                  <strong>Reviewed by:</strong> {assessment.reviewedBy || assessment.reviewed_by}
                                  {(assessment.reviewedAt || assessment.reviewed_at) && (
                                    <span style={{ marginLeft: 6 }}>
                                      on {new Date(assessment.reviewedAt || assessment.reviewed_at).toLocaleString()}
                                    </span>
                                  )}
                                </div>
                              )}
                              {(assessment.reviewerNotes || assessment.reviewer_notes) && (
                                <div style={{ marginTop: 4, color: "var(--amber)" }}>
                                  <strong>Reviewer Notes:</strong> {assessment.reviewerNotes || assessment.reviewer_notes}
                                </div>
                              )}
                              {(assessment.auditedBy || assessment.audited_by) && (
                                <div style={{ marginTop: 4 }}>
                                  <strong>Audited by:</strong> {assessment.auditedBy || assessment.audited_by}
                                  {(assessment.auditedAt || assessment.audited_at) && (
                                    <span style={{ marginLeft: 6 }}>
                                      on {new Date(assessment.auditedAt || assessment.audited_at).toLocaleString()}
                                    </span>
                                  )}
                                </div>
                              )}
                              {(assessment.auditorNotes || assessment.auditor_notes) && (
                                <div style={{ marginTop: 4, color: "var(--amber)" }}>
                                  <strong>Auditor notes:</strong> {assessment.auditorNotes || assessment.auditor_notes}
                                </div>
                              )}
                            </div>
                          )}

                          {ev.length > 0 && (
                            <div className="evidence-list-modal">
                              <div style={{ fontSize: 11, color: "var(--text3)", marginBottom: 6, fontWeight: 600, textTransform: "uppercase" }}>
                                Evidence ({ev.length})
                              </div>
                              {ev.map(e => (
                                <div key={e.id}>
                                  <div className="evidence-item-modal">
                                    <span style={{ flex: 1, fontSize: 12 }}>
                                      {e.evidenceName || e.evidence_name}
                                    </span>
                                    <div style={{ display: "flex", gap: 6 }}>
                                      {e.hasFile && (
                                        <button
                                          className="btn-compact"
                                          onClick={() => viewEvidence(e.id, e.evidenceName || e.evidence_name)}
                                        >
                                          View File
                                        </button>
                                      )}
                                      {(e.evidenceLink || e.evidence_link) && (
                                        <a
                                          href={e.evidenceLink || e.evidence_link}
                                          target="_blank"
                                          rel="noopener noreferrer"
                                          className="btn-compact"
                                        >
                                          View Link
                                        </a>
                                      )}
                                    </div>
                                  </div>
                                  <EvidenceAiPanel evidence={e} compact />
                                </div>
                              ))}
                            </div>
                          )}

                          {isAuditor && assessment && ["FINISHED", "AUDITED"].includes(assessment.reviewStatus || assessment.review_status) && (
                            <div style={{ marginTop: 12, display: "flex", gap: 8 }}>
                              <button
                                className="btn btn-primary"
                                style={{ flex: 1, fontSize: 11, padding: "6px 12px" }}
                                onClick={(e) => {
                                  e.stopPropagation();
                                  promptAuditorApproval(assessment.id, "AUDITED");
                                }}
                              >
                                ✓ {(assessment.reviewStatus || assessment.review_status) === "AUDITED" ? "Re-confirm audit" : "Approve (audit)"}
                              </button>
                              <button
                                className="btn btn-ghost"
                                style={{ flex: 1, fontSize: 11, padding: "6px 12px" }}
                                onClick={(e) => {
                                  e.stopPropagation();
                                  promptAuditorApproval(assessment.id, "WIP");
                                }}
                              >
                                ✗ Reject
                              </button>
                            </div>
                          )}
                        </div>
                      );
                    })}
                </div>
              ) : null}
            </div>
          </div>
        </div>
      )}

      {/* Automated Coverage Modal */}
      {automatedCoverageModalOpen && stats?.automatedCoverage && (
        <div className="modal-overlay" onClick={() => setAutomatedCoverageModalOpen(false)}>
          <div className="module-modal" onClick={(e) => e.stopPropagation()}>
            <div className="module-modal-header">
              <div>
                <div className="module-modal-title">Automated coverage</div>
                <div className="module-modal-subtitle">
                  {stats.automatedCoverage.count} of {stats.automatedCoverage.total} controls have fresh automated evidence
                </div>
              </div>
              <button className="modal-close" onClick={() => setAutomatedCoverageModalOpen(false)}>×</button>
            </div>
            <div className="module-modal-content">
              {(stats.automatedCoverage.questions || []).length === 0 ? (
                <div style={{ padding: 40, textAlign: "center", color: "var(--text3)", fontSize: 14 }}>
                  No questions have automated evidence yet.
                </div>
              ) : (
                <div className="quest-details-list">
                  {stats.automatedCoverage.questions.map(q => (
                    <div
                      key={q.questId}
                      className="quest-detail-item"
                      style={{ cursor: "pointer" }}
                      onClick={() => {
                        setAutomatedCoverageModalOpen(false);
                        navigate(`/tracker?quest=${encodeURIComponent(q.questId)}`);
                      }}
                    >
                      <div className="quest-detail-header">
                        <div style={{ flex: 1 }}>
                          <div style={{ fontWeight: 600, fontSize: 13, color: "var(--text)" }}>
                            {q.questId}: {q.controlArea}
                          </div>
                          <div style={{ fontSize: 12, color: "var(--text2)", marginTop: 4 }}>
                            {q.baselineQuestion}
                          </div>
                          <div style={{ display: "flex", gap: 6, marginTop: 6, flexWrap: "wrap" }}>
                            {(q.integrationKeys || []).map(key => (
                              <span key={key} className="tag-badge">{key}</span>
                            ))}
                          </div>
                          <div style={{ fontSize: 11, color: "var(--dp-quiet)", marginTop: 6, fontFamily: "var(--mono)" }}>
                            {(q.testKeys || []).join(", ")}
                          </div>
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Recent reviews — full history modal */}
      {recentReviewsModalOpen && stats?.recentlyReviewed && (
        <div className="modal-overlay" onClick={() => setRecentReviewsModalOpen(false)}>
          <div className="module-modal" onClick={(e) => e.stopPropagation()}>
            <div className="module-modal-header">
              <div>
                <div className="module-modal-title">Recent reviews</div>
                <div className="module-modal-subtitle">
                  {stats.recentlyReviewed.length} review{stats.recentlyReviewed.length !== 1 ? "s" : ""} and audit sign-offs, most recent first
                </div>
              </div>
              <button className="modal-close" onClick={() => setRecentReviewsModalOpen(false)}>×</button>
            </div>
            <div className="module-modal-content">
              {stats.recentlyReviewed.length === 0 ? (
                <div style={{ padding: 40, textAlign: "center", color: "var(--text3)", fontSize: 14 }}>
                  Nothing reviewed yet.
                </div>
              ) : (
                <div className="dash-list" style={{ padding: 12 }}>
                  {stats.recentlyReviewed.map(item => {
                    const approved = isApprovedStatus(item.reviewStatus);
                    const audited = item.reviewStatus === "AUDITED";
                    const who = (item.activityBy || item.reviewedBy || "")?.split("@")[0];
                    const when = item.activityAt || item.reviewedAt;
                    return (
                      <div
                        key={item.id}
                        className="dash-list-row"
                        style={{ "--row-tone": approved ? "var(--green)" : "var(--amber)", cursor: "pointer" }}
                        onClick={() => {
                          setRecentReviewsModalOpen(false);
                          navigate(`/tracker?quest=${encodeURIComponent(item.questId)}`);
                        }}
                      >
                        <span style={{ flexShrink: 0, color: approved ? "var(--green)" : "var(--amber)" }}>
                          {approved ? "✓" : "•"}
                        </span>
                        <span className="dash-list-code">{item.questId}</span>
                        <span className="dash-list-main">{item.controlArea || item.moduleId}</span>
                        <span className="dash-list-meta">{audited ? `audit · ${who}` : who}</span>
                        <span className="dash-list-meta" title={when ? new Date(when).toLocaleString() : ""}>
                          {when ? new Date(when).toLocaleDateString() : ""}
                        </span>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Rejected controls — full history modal */}
      {rejectedControlsModalOpen && stats?.rejectedControls && (
        <div className="modal-overlay" onClick={() => setRejectedControlsModalOpen(false)}>
          <div className="module-modal" onClick={(e) => e.stopPropagation()}>
            <div className="module-modal-header">
              <div>
                <div className="module-modal-title">Rejected controls</div>
                <div className="module-modal-subtitle">
                  {stats.rejectedControls.length} control{stats.rejectedControls.length !== 1 ? "s" : ""} sent back for rework, most recent first
                </div>
              </div>
              <button className="modal-close" onClick={() => setRejectedControlsModalOpen(false)}>×</button>
            </div>
            <div className="module-modal-content">
              {stats.rejectedControls.length === 0 ? (
                <div style={{ padding: 40, textAlign: "center", color: "var(--green)", fontSize: 14 }}>
                  ✓ Nothing sent back this cycle.
                </div>
              ) : (
                <div className="dash-list" style={{ padding: 12 }}>
                  {stats.rejectedControls.map(item => {
                    const byAuditor = item.auditorNotes && item.auditorNotes.trim();
                    const rejectorEmail = byAuditor ? item.auditedBy : item.reviewedBy;
                    const rejectorLabel = byAuditor ? "Auditor" : "Reviewer";
                    const reason = byAuditor ? item.auditorNotes : item.reviewerNotes;
                    const rejectedAt = byAuditor ? item.auditedAt : item.reviewedAt;
                    return (
                      <div
                        key={item.id}
                        className="dash-list-row"
                        style={{ "--row-tone": "var(--red)", flexDirection: "column", alignItems: "stretch", gap: 5, cursor: "pointer" }}
                        onClick={() => {
                          setRejectedControlsModalOpen(false);
                          navigate(`/tracker?quest=${encodeURIComponent(item.questId)}`);
                        }}
                      >
                        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                          <span className="dash-list-code" style={{ color: "var(--red)" }}>{item.questId}</span>
                          <span className="dash-list-main" style={{ fontWeight: 600 }}>{item.controlArea}</span>
                          <span className="dash-list-meta" style={{ fontFamily: "var(--mono)", fontSize: 10 }}>{rejectorLabel}</span>
                          {rejectedAt && (
                            <span className="dash-list-meta" title={new Date(rejectedAt).toLocaleString()}>
                              {new Date(rejectedAt).toLocaleDateString()}
                            </span>
                          )}
                        </div>
                        {reason && (
                          <div style={{ fontSize: 12, color: "var(--dp-quiet)", lineHeight: 1.5 }}>
                            <span style={{ fontFamily: "var(--mono)", fontSize: 11 }}>
                              {rejectorEmail?.split("@")[0] || rejectorLabel}:{" "}
                            </span>
                            {reason}
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Review locked modal (unverified accounts) */}
      {reviewLockedOpen && (
        <div className="modal-overlay" onClick={() => setReviewLockedOpen(false)}>
          <div className="module-modal" style={{ maxWidth: 420, textAlign: "center" }} onClick={e => e.stopPropagation()}>
            <div style={{ fontSize: 48, marginBottom: 16, marginTop: 8 }}>🔒</div>
            <h2 style={{ fontSize: 18, fontWeight: 700, marginBottom: 10, color: "var(--text)" }}>Review Workflow Locked</h2>
            <p style={{ fontSize: 14, color: "var(--text2)", lineHeight: 1.6, marginBottom: 20 }}>
              The review workflow is available after your account is verified by a platform administrator.
            </p>
            <button className="btn btn-ghost" style={{ width: "100%" }} onClick={() => setReviewLockedOpen(false)}>Close</button>
          </div>
        </div>
      )}

      {/* Auditor notes modal */}
      {auditorNotesModal && (
        <div className="modal-overlay" onClick={() => setAuditorNotesModal(null)}>
          <div className="module-modal" style={{ maxWidth: 460 }} onClick={e => e.stopPropagation()}>
            <div className="module-modal-header">
              <div className="module-modal-title">
                {auditorNotesModal.status === "AUDITED" ? "Confirm audit sign-off" : "Reject assessment"}
              </div>
              <button className="modal-close" onClick={() => setAuditorNotesModal(null)}>×</button>
            </div>
            <div className="module-modal-content" style={{ padding: 20 }}>
              <label style={{ display: "block", marginBottom: 8, fontSize: 13, color: "var(--text2)" }}>
                {auditorNotesModal.status === "AUDITED"
                  ? "Audit note (optional)"
                  : "Reason for rejection (optional)"}
              </label>
              <textarea
                className="comments-textarea"
                rows={4}
                placeholder="Add feedback, comments, or instructions for the contributor..."
                onChange={e => { auditorNotesRef.current = e.target.value; }}
                style={{ width: "100%", marginBottom: 16 }}
              />
              <div style={{ display: "flex", gap: 8 }}>
                <button
                  className={`btn ${auditorNotesModal.status === "AUDITED" ? "btn-primary" : "btn-ghost"}`}
                  style={{ flex: 1 }}
                  onClick={confirmAuditorApproval}
                >
                  {auditorNotesModal.status === "AUDITED" ? "✓ Confirm Audit" : "✗ Confirm Rejection"}
                </button>
                <button className="btn btn-ghost" onClick={() => setAuditorNotesModal(null)}>Cancel</button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
