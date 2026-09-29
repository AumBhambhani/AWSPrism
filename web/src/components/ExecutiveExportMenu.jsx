import { useState } from "react";
import { toCSV, downloadBlob, makeXmlSheet, buildWorkbook, slugify } from "../utils/exportWorkbook.js";

const SEV_LABEL = { critical: "Critical", high: "High", medium: "Medium", low: "Low" };

function blocks(data, company) {
  const d = data || {};
  const cs = d.controlStatus || {};
  const ev = d.evidenceStatus || {};
  const axes = d.riskHeatmapAxes || { likelihood: [], impact: [] };
  const generated = new Date().toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric" });

  const summary = [
    [company?.name || "Executive Overview", "", "Generated", generated],
    [],
    ["READINESS"],
    ["Overall readiness %", d.readiness ?? 0],
    ["Change vs previous period (pts)", d.readinessDelta ?? 0],
    [],
    ["RISK"],
    ["Open risks", d.openRisks ?? 0],
    ["High-severity risks", d.highRisks ?? 0],
    [],
    ["CONTROLS"],
    ["Total", cs.total ?? 0],
    ["Compliant", cs.compliant ?? 0],
    ["Partially compliant", cs.partial ?? 0],
    ["Non-compliant", cs.nonCompliant ?? 0],
    ["Not approved", cs.notAssessed ?? 0],
    [],
    ["EVIDENCE"],
    ["Collected", ev.collected ?? 0],
    ["Pending", ev.pending ?? 0],
    ["Overdue", ev.overdue ?? 0],
    [],
    ["Control owners", d.departmentCount ?? 0],
  ];

  const trend = [["Month", "Readiness %"], ...(d.readinessTrend || []).map((p) => [p.month, p.value ?? ""])];

  const controls = [
    ["Status", "Count"],
    ["Compliant", cs.compliant ?? 0],
    ["Partially compliant", cs.partial ?? 0],
    ["Non-compliant", cs.nonCompliant ?? 0],
    ["Not approved", cs.notAssessed ?? 0],
  ];

  const departments = [
    ["Owner", "Controls", "Approved", "Readiness %"],
    ...(d.departments || []).map((r) => [r.name, r.controls, r.assessed ?? 0, r.readiness]),
  ];

  const risks = [
    ["Risk", "Severity", "Count"],
    ...(d.topRisks || []).map((r) => [r.title, SEV_LABEL[r.severity] || r.severity, r.count]),
  ];

  const heatmap = [
    ["Likelihood \\ Impact", ...(axes.impact || [])],
    ...(d.riskHeatmap || []).map((row, ri) => [axes.likelihood?.[ri] ?? `L${ri}`, ...row]),
  ];

  return { summary, trend, controls, departments, risks, heatmap };
}

function exportCSV(data, company) {
  const b = blocks(data, company);
  const rows = [
    ...b.summary,
    [],
    ["READINESS TREND"],
    ...b.trend,
    [],
    ["CONTROL STATUS"],
    ...b.controls,
    [],
    ["READINESS BY OWNER"],
    ...b.departments,
    [],
    ["TOP RISKS"],
    ...b.risks,
    [],
    ["RISK HEATMAP"],
    ...b.heatmap,
  ];
  downloadBlob(`${slugify(company?.name)}-executive.csv`, toCSV(rows), "text/csv");
}

function exportXLS(data, company) {
  const b = blocks(data, company);
  const xml = buildWorkbook([
    makeXmlSheet("Summary", b.summary),
    makeXmlSheet("Readiness trend", b.trend),
    makeXmlSheet("Control status", b.controls),
    makeXmlSheet("Readiness by owner", b.departments),
    makeXmlSheet("Top risks", b.risks),
    makeXmlSheet("Risk heatmap", b.heatmap),
  ]);
  const date = new Date().toISOString().slice(0, 10);
  downloadBlob(`${slugify(company?.name)}-executive-${date}.xls`, xml, "application/vnd.ms-excel");
}

export default function ExecutiveExportMenu({ data, company }) {
  const [open, setOpen] = useState(false);
  const run = (fn) => () => {
    fn(data, company);
    setOpen(false);
  };

  return (
    <div className="export-wrap">
      <button className="btn btn-ghost" onClick={() => setOpen((o) => !o)} style={{ display: "inline-flex", alignItems: "center", gap: 8 }}>
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" style={{ color: "var(--dp-accent, #4F46E5)" }}>
          <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
          <polyline points="7 10 12 15 17 10" />
          <line x1="12" y1="15" x2="12" y2="3" />
        </svg>
        <span>Export</span>
      </button>
      {open && (
        <>
          <div className="export-backdrop" onClick={() => setOpen(false)} />
          <div className="export-dropdown">
            <button className="export-item" onClick={run(exportCSV)}>
              <div className="export-item-title">
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ color: "var(--teal, #06B6D4)" }}>
                  <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"></path>
                  <polyline points="14 2 14 8 20 8"></polyline>
                  <line x1="8" y1="13" x2="16" y2="13"></line>
                  <line x1="8" y1="17" x2="16" y2="17"></line>
                </svg>
                <span>CSV Export</span>
              </div>
              <span className="export-item-sub">flat file · all blocks</span>
            </button>
            <button className="export-item" onClick={run(exportXLS)}>
              <div className="export-item-title">
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ color: "var(--green, #10B981)" }}>
                  <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"></path>
                  <polyline points="14 2 14 8 20 8"></polyline>
                  <rect x="8" y="12" width="8" height="6"></rect>
                </svg>
                <span>Excel Workbook</span>
              </div>
              <span className="export-item-sub">6-sheet workbook · .xls</span>
            </button>
            <button className="export-item" onClick={() => { setOpen(false); window.print(); }}>
              <div className="export-item-title">
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ color: "var(--red, #EF4444)" }}>
                  <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"></path>
                  <polyline points="14 2 14 8 20 8"></polyline>
                  <path d="M9 15h6"></path>
                </svg>
                <span>Print / PDF</span>
              </div>
              <span className="export-item-sub">formatted one-page report</span>
            </button>
          </div>
        </>
      )}
    </div>
  );
}
