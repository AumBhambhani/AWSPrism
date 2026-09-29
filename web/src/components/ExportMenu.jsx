import { useState } from "react";
import { downloadBlob, makeXmlSheet, buildWorkbook } from "../utils/exportWorkbook.js";

function exportXLS(stats, company) {
  const {
    overall = {},
    moduleCompletion = [],
    evidenceCoverage = [],
    actionStatus = [],
    answerDistribution = [],
    maturityDistribution = {},
    notesMetrics = {},
    requestMetrics = {},
    vaultMetrics = {},
    recentlyReviewed = [],
  } = stats || {};

  const pct = (a, b) => (b > 0 ? `${Math.round((a / b) * 100)}%` : "0%");
  const date = new Date().toLocaleDateString("en-GB");

  const sheets = [
    makeXmlSheet("Summary", [
      [company?.name || "Compliance Report", "", "Exported", date],
      [],
      ["OVERALL COMPLETION"],
      ["Total Questions", "Assessed", "Finished", "Score-Eligible"],
      [overall.total ?? 0, overall.assessed ?? 0, overall.finished ?? 0, stats?.scoreEligible?.count ?? 0],
      [],
      ["NOTES COVERAGE"],
      ["With Internal Notes", "With Reviewer Notes", "Without Any Notes"],
      [notesMetrics.withNotes ?? 0, notesMetrics.withReviewerNotes ?? 0, notesMetrics.withoutAnyNotes ?? 0],
      [],
      ["EVIDENCE REQUESTS"],
      ["Open", "Overdue", "Completed"],
      [requestMetrics.open ?? 0, requestMetrics.overdue ?? 0, requestMetrics.completed ?? 0],
      [],
      ["EVIDENCE VAULT"],
      ["Total Versions", "Updated This Month", "Last Modified"],
      [vaultMetrics.totalVersions ?? 0, vaultMetrics.updatedThisMonth ?? 0, vaultMetrics.latestModifiedTitle ?? ""],
    ]),

    makeXmlSheet("Module Completion", [
      ["Module ID", "Name", "Total Quests", "Assessed", "Finished", "% Finished"],
      ...moduleCompletion.map(m => [
        m.moduleId, m.name, m.total, m.assessed, m.finished, pct(m.finished, m.total),
      ]),
    ]),

    makeXmlSheet("Evidence Coverage", [
      ["Module ID", "Covered", "Total", "% Covered"],
      ...evidenceCoverage.map(e => [e.moduleId, e.covered, e.total, pct(e.covered, e.total)]),
    ]),

    makeXmlSheet("Maturity & Answers", [
      ["MATURITY DISTRIBUTION"],
      ["Level", "Description", "Count"],
      ["L1", "Ad-hoc",     maturityDistribution.l1 ?? 0],
      ["L2", "Repeatable", maturityDistribution.l2 ?? 0],
      ["L3", "Defined",    maturityDistribution.l3 ?? 0],
      ["L4", "Managed",    maturityDistribution.l4 ?? 0],
      ["L5", "Optimised",  maturityDistribution.l5 ?? 0],
      [],
      ["ANSWER DISTRIBUTION"],
      ["Answer", "Count"],
      ...answerDistribution.map(a => [a.answer, a.count]),
      [],
      ["ACTION STATUS"],
      ["Status", "Count"],
      ...actionStatus.map(a => [a.status, a.count]),
    ]),

    ...(recentlyReviewed.length > 0 ? [
      makeXmlSheet("Recent Reviews", [
        ["Quest ID", "Module", "Control Area", "Status", "Reviewed By", "Reviewed At", "Notes"],
        ...recentlyReviewed.map(r => [
          r.questId,
          r.moduleId,
          r.controlArea || "",
          r.reviewStatus,
          r.reviewedBy || "",
          r.reviewedAt ? new Date(r.reviewedAt).toLocaleDateString("en-GB") : "",
          r.reviewerNotes || "",
        ]),
      ]),
    ] : []),
  ];

  const xml = buildWorkbook(sheets);
  const name = (company?.name || "compliance").replace(/\s+/g, "-").toLowerCase();
  downloadBlob(`${name}-report.xls`, xml, "application/vnd.ms-excel");
}

// ── PDF (print-formatted HTML in new window) ─────────────────────────────────

function exportPDF(stats, company) {
  const {
    overall = {},
    moduleCompletion = [],
    evidenceCoverage = [],
    actionStatus = [],
    answerDistribution = [],
    maturityDistribution = {},
    notesMetrics = {},
    requestMetrics = {},
    vaultMetrics = {},
    recentlyReviewed = [],
  } = stats || {};

  const date = new Date().toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric" });
  const co = company?.name || "Compliance Report";
  const pct = (a, b) => (b > 0 ? `${Math.round((a / b) * 100)}%` : "0%");

  const th = `style="background:#1e293b;color:#fff;padding:8px 10px;text-align:left;font-weight:600"`;
  const thR = `style="background:#1e293b;color:#fff;padding:8px 10px;text-align:right;font-weight:600"`;
  const td = `style="padding:7px 10px;border-bottom:1px solid #e2e8f0"`;
  const tdR = `style="padding:7px 10px;border-bottom:1px solid #e2e8f0;text-align:right"`;
  const sec = t => `<h3 style="font-size:12px;font-weight:700;color:#1e293b;text-transform:uppercase;letter-spacing:.06em;margin:28px 0 8px;padding-bottom:4px;border-bottom:1px solid #e2e8f0">${t}</h3>`;

  const moduleRows = moduleCompletion.map(m =>
    `<tr><td ${td}>${m.moduleId}</td><td ${td}>${m.name}</td><td ${tdR}>${m.total}</td><td ${tdR}>${m.assessed}</td><td ${tdR}>${m.finished}</td><td ${tdR}>${pct(m.finished, m.total)}</td></tr>`
  ).join("") || `<tr><td colspan="6" ${td}>No data</td></tr>`;

  const evidenceRows = evidenceCoverage.map(e =>
    `<tr><td ${td}>${e.moduleId}</td><td ${tdR}>${e.covered}</td><td ${tdR}>${e.total}</td><td ${tdR}>${pct(e.covered, e.total)}</td></tr>`
  ).join("") || `<tr><td colspan="4" ${td}>No data</td></tr>`;

  const maturityRows = [
    ["L1", "Ad-hoc", maturityDistribution.l1 ?? 0],
    ["L2", "Repeatable", maturityDistribution.l2 ?? 0],
    ["L3", "Defined", maturityDistribution.l3 ?? 0],
    ["L4", "Managed", maturityDistribution.l4 ?? 0],
    ["L5", "Optimised", maturityDistribution.l5 ?? 0],
  ].map(([l, d, n]) => `<tr><td ${td}>${l} — ${d}</td><td ${tdR}>${n}</td></tr>`).join("");

  const html = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<title>${co} — Compliance Report</title>
<style>
  *{box-sizing:border-box;margin:0;padding:0}
  body{font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;color:#0f172a;background:#fff;padding:40px;font-size:13px}
  @media print{body{padding:20px}.no-print{display:none}h3{page-break-before:auto}}
  .header{border-bottom:3px solid #1e293b;padding-bottom:18px;margin-bottom:28px;display:flex;justify-content:space-between;align-items:flex-end}
  .company{font-size:20px;font-weight:700;color:#1e293b}
  .subtitle{font-size:12px;color:#64748b;margin-top:3px}
  .date{font-size:11px;color:#94a3b8;white-space:nowrap}
  .grid{display:grid;grid-template-columns:repeat(4,1fr);gap:12px;margin-bottom:24px}
  .box{background:#f8fafc;border:1px solid #e2e8f0;border-radius:8px;padding:12px 14px}
  .val{font-size:26px;font-weight:700;color:#1e293b}
  .lbl{font-size:10px;color:#64748b;margin-top:2px;text-transform:uppercase;letter-spacing:.04em}
  table{border-collapse:collapse;width:100%;margin-bottom:4px}
  tr:nth-child(even) td{background:#f8fafc}
  .print-btn{position:fixed;top:18px;right:18px;padding:9px 18px;background:#1e293b;color:#fff;border:none;border-radius:8px;font-size:13px;font-weight:600;cursor:pointer}
</style>
</head>
<body>
<button class="print-btn no-print" onclick="window.print()">Print / Save PDF</button>

<div class="header">
  <div><div class="company">${co}</div><div class="subtitle">Compliance Status Report — PRISM</div></div>
  <div class="date">Generated ${date}</div>
</div>

<div class="grid">
  <div class="box"><div class="val">${overall.total ?? 0}</div><div class="lbl">Total Quests</div></div>
  <div class="box"><div class="val">${overall.assessed ?? 0}</div><div class="lbl">Assessed</div></div>
  <div class="box"><div class="val">${overall.finished ?? 0}</div><div class="lbl">Finished</div></div>
  <div class="box"><div class="val">${pct(overall.finished ?? 0, overall.total ?? 0)}</div><div class="lbl">Completion Rate</div></div>
</div>

${sec("Module Completion")}
<table><thead><tr>
  <th ${th}>Module ID</th><th ${th}>Name</th><th ${thR}>Total</th><th ${thR}>Assessed</th><th ${thR}>Finished</th><th ${thR}>% Done</th>
</tr></thead><tbody>${moduleRows}</tbody></table>

${sec("Evidence Coverage")}
<table><thead><tr>
  <th ${th}>Module</th><th ${thR}>Covered</th><th ${thR}>Total</th><th ${thR}>% Covered</th>
</tr></thead><tbody>${evidenceRows}</tbody></table>

${sec("Maturity Distribution")}
<table><thead><tr><th ${th}>Level</th><th ${thR}>Count</th></tr></thead><tbody>${maturityRows}</tbody></table>

${sec("Answer Distribution")}
<table><thead><tr><th ${th}>Answer</th><th ${thR}>Count</th></tr></thead>
<tbody>${answerDistribution.map(a => `<tr><td ${td}>${a.answer}</td><td ${tdR}>${a.count}</td></tr>`).join("") || `<tr><td colspan="2" ${td}>No data</td></tr>`}</tbody></table>

${sec("Action Status")}
<table><thead><tr><th ${th}>Status</th><th ${thR}>Count</th></tr></thead>
<tbody>${actionStatus.map(a => `<tr><td ${td}>${a.status}</td><td ${tdR}>${a.count}</td></tr>`).join("") || `<tr><td colspan="2" ${td}>No data</td></tr>`}</tbody></table>

${sec("Supplementary Metrics")}
<table><thead><tr><th ${th}>Metric</th><th ${thR}>Value</th></tr></thead><tbody>
  <tr><td ${td}>Questions with Internal Notes</td><td ${tdR}>${notesMetrics.withNotes ?? 0}</td></tr>
  <tr><td ${td}>Questions with Reviewer Notes</td><td ${tdR}>${notesMetrics.withReviewerNotes ?? 0}</td></tr>
  <tr><td ${td}>Questions without Any Notes</td><td ${tdR}>${notesMetrics.withoutAnyNotes ?? 0}</td></tr>
  <tr><td ${td}>Open Evidence Requests</td><td ${tdR}>${requestMetrics.open ?? 0}</td></tr>
  <tr><td ${td}>Overdue Evidence Requests</td><td ${tdR}>${requestMetrics.overdue ?? 0}</td></tr>
  <tr><td ${td}>Completed Evidence Requests</td><td ${tdR}>${requestMetrics.completed ?? 0}</td></tr>
  <tr><td ${td}>Vault — Total Versions</td><td ${tdR}>${vaultMetrics.totalVersions ?? 0}</td></tr>
  <tr><td ${td}>Vault — Updated This Month</td><td ${tdR}>${vaultMetrics.updatedThisMonth ?? 0}</td></tr>
</tbody></table>

${recentlyReviewed.length > 0 ? `
${sec("Recent Reviews")}
<table><thead><tr>
  <th ${th}>Quest ID</th><th ${th}>Control Area</th><th ${th}>Status</th><th ${th}>Reviewed By</th><th ${th}>Date</th>
</tr></thead><tbody>
${recentlyReviewed.map(r => `<tr>
  <td ${td}>${r.questId}</td>
  <td ${td}>${r.controlArea || r.moduleId || ""}</td>
  <td ${td}>${r.reviewStatus}</td>
  <td ${td}>${r.reviewedBy?.split("@")[0] || ""}</td>
  <td ${td}>${r.reviewedAt ? new Date(r.reviewedAt).toLocaleDateString("en-GB") : ""}</td>
</tr>`).join("")}
</tbody></table>` : ""}

</body></html>`;

  const win = window.open("", "_blank", "width=900,height=700");
  win.document.write(html);
  win.document.close();
}

// ── Component ────────────────────────────────────────────────────────────────

export default function ExportMenu({ stats, company }) {
  const [open, setOpen] = useState(false);

  const handleCSV = () => {
    const {
      overall = {},
      moduleCompletion = [],
      evidenceCoverage = [],
      actionStatus = [],
      answerDistribution = [],
      maturityDistribution = {},
    } = stats || {};
    const rows = [
      [`${company?.name || "Compliance"} Report`, new Date().toLocaleDateString()],
      [],
      ["COMPLETION METRICS"],
      ["Total Questions", "Assessed", "Finished"],
      [overall.total ?? 0, overall.assessed ?? 0, overall.finished ?? 0],
      [],
      ["MODULE COMPLETION"],
      ["Module", "Name", "Total", "Assessed", "Finished"],
      ...moduleCompletion.map(m => [m.moduleId, m.name, m.total, m.assessed, m.finished]),
      [],
      ["EVIDENCE COVERAGE"],
      ["Module", "Covered", "Total"],
      ...evidenceCoverage.map(e => [e.moduleId, e.covered, e.total]),
      [],
      ["MATURITY DISTRIBUTION"],
      ["Level", "Count"],
      ["L1 — Ad-hoc",    maturityDistribution.l1 ?? 0],
      ["L2 — Repeatable", maturityDistribution.l2 ?? 0],
      ["L3 — Defined",   maturityDistribution.l3 ?? 0],
      ["L4 — Managed",   maturityDistribution.l4 ?? 0],
      ["L5 — Optimised", maturityDistribution.l5 ?? 0],
      [],
      ["ANSWER DISTRIBUTION"],
      ["Answer", "Count"],
      ...answerDistribution.map(a => [a.answer, a.count]),
      [],
      ["ACTION STATUS"],
      ["Status", "Count"],
      ...actionStatus.map(a => [a.status, a.count]),
    ];
    const csv = rows.map(r =>
      r.map(c => `"${String(c ?? "").replace(/"/g, '""')}"`).join(",")
    ).join("\n");
    downloadBlob("compliance-report.csv", csv, "text/csv");
    setOpen(false);
  };

  const handleXLS = () => {
    exportXLS(stats, company);
    setOpen(false);
  };

  const handlePDF = () => {
    exportPDF(stats, company);
    setOpen(false);
  };

  return (
    <div className="export-wrap">
      <button className="btn btn-ghost" onClick={() => setOpen(o => !o)} style={{ display: "inline-flex", alignItems: "center", gap: 8 }}>
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
            <button className="export-item" onClick={handleCSV}>
              <div className="export-item-title">
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ color: "var(--teal, #06B6D4)" }}>
                  <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"></path>
                  <polyline points="14 2 14 8 20 8"></polyline>
                  <line x1="8" y1="13" x2="16" y2="13"></line>
                  <line x1="8" y1="17" x2="16" y2="17"></line>
                </svg>
                <span>CSV Export</span>
              </div>
              <span className="export-item-sub">flat file · all metrics</span>
            </button>
            <button className="export-item" onClick={handleXLS}>
              <div className="export-item-title">
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ color: "var(--green, #10B981)" }}>
                  <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"></path>
                  <polyline points="14 2 14 8 20 8"></polyline>
                  <rect x="8" y="12" width="8" height="6"></rect>
                </svg>
                <span>Excel Workbook</span>
              </div>
              <span className="export-item-sub">multi-sheet workbook · .xls</span>
            </button>
            <button className="export-item" onClick={handlePDF}>
              <div className="export-item-title">
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ color: "var(--red, #EF4444)" }}>
                  <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"></path>
                  <polyline points="14 2 14 8 20 8"></polyline>
                  <path d="M9 15h6"></path>
                </svg>
                <span>PDF Report</span>
              </div>
              <span className="export-item-sub">formatted report · print or save</span>
            </button>
          </div>
        </>
      )}
    </div>
  );
}
