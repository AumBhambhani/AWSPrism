// report.js — render evaluation as console summary + printable HTML report (PRISM format).

import { PRISM_LOGO_DATA_URI } from '../data/prismLogo.js';

function scoreColor(score) {
  if (score >= 75) return '#16a34a';
  if (score >= 60) return '#d97706';
  if (score >= 40) return '#ea580c';
  return '#dc2626';
}

function esc(s) {
  return String(s == null ? '' : s).replace(/[&<>"]/g, (c) =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c])
  );
}

// ── Console summary ──────────────────────────────────────────────────────────

export function renderConsole(target, signals, evalResult) {
  const e = evalResult;
  const bar = (n) => '█'.repeat(Math.round(n / 5)) + '░'.repeat(20 - Math.round(n / 5));
  const L = [];
  L.push('');
  L.push('═'.repeat(64));
  L.push(`  COMPLIANCE REPORT — ${target}`);
  L.push(`  Scanned: ${signals.scannedAt}`);
  L.push('═'.repeat(64));
  L.push('');
  L.push(`  OVERALL SCORE   ${e.overall.score}/100  (${e.overall.grade})  ${e.overall.label}`);
  L.push(`                  ${bar(e.overall.score)}`);
  L.push('');
  L.push(`  GDPR   ${String(e.frameworks.GDPR.score).padStart(3)}/100 (${e.frameworks.GDPR.grade})  ${bar(e.frameworks.GDPR.score)}`);
  L.push(`  DPDPA  ${String(e.frameworks.DPDPA.score).padStart(3)}/100 (${e.frameworks.DPDPA.grade})  ${bar(e.frameworks.DPDPA.score)}`);
  L.push('');
  L.push('  ── Category scores ──');
  for (const c of e.categoryScores.slice().sort((a, b) => a.score - b.score))
    L.push(`     ${String(c.score).padStart(3)}%  ${c.name}`);
  L.push('');
  if (e.remediation.length) {
    L.push('  ── Top remediation actions ──');
    for (const r of e.remediation.slice(0, 8)) {
      L.push(`     • [${r.severity.toUpperCase()}] ${r.title}`);
      if (r.recommendation) L.push(`       → ${r.recommendation}`);
    }
  } else {
    L.push('  No remediation actions — all evaluated checks passed.');
  }
  L.push('');
  L.push('═'.repeat(64));
  return L.join('\n');
}

// ── HTML report ──────────────────────────────────────────────────────────────

function catStatus(score) {
  if (score >= 75) return { icon: '✅', label: 'Strong',      color: '#16a34a' };
  if (score >= 60) return { icon: '⚠️', label: 'Adequate',   color: '#d97706' };
  if (score >= 40) return { icon: '⚠️', label: 'Partial',    color: '#ea580c' };
  return              { icon: '❌', label: 'Inadequate',  color: '#dc2626' };
}

function priorityLabel(score) {
  if (score >= 75) return { text: 'Low Priority',         color: '#16a34a' };
  if (score >= 60) return { text: 'Medium Priority',      color: '#d97706' };
  if (score >= 40) return { text: 'Medium-High Priority', color: '#ea580c' };
  return              { text: 'High Priority',        color: '#dc2626' };
}

function verdictText(score) {
  if (score >= 90) return 'Verdict: Strong Compliance Posture';
  if (score >= 75) return 'Verdict: Largely Conformant';
  if (score >= 60) return 'Verdict: Partially Conformant with Notable Gaps';
  if (score >= 40) return 'Verdict: Partially Conformant with Significant Gaps';
  return 'Verdict: Non-Conformant — Urgent Remediation Required';
}

function verdictBody(score) {
  if (score >= 90) return 'The website demonstrates a strong compliance posture across both DPDPA and GDPR requirements.';
  if (score >= 75) return `Overall, the website can be considered <strong>Largely Conformant</strong> with DPDPA and GDPR requirements. Minor gaps remain.`;
  if (score >= 60) return `Overall, the website can be considered <strong>Partially Conformant</strong> with DPDPA and GDPR requirements. Targeted improvements are needed.`;
  if (score >= 40) return `Overall, the website can be considered <strong>Partially Conformant with Significant Gaps</strong> with DPDPA and GDPR requirements and would benefit from targeted remediation activities.`;
  return `Overall, the website is <strong>Non-Conformant</strong> with DPDPA and GDPR requirements. Urgent remediation is required across multiple areas.`;
}

export function renderHtml(target, signals, evalResult, opts = {}) {
  const e = evalResult;
  const scannedAt = signals.scannedAt || new Date().toISOString();
  const type = signals.type === 'mobile-app' ? 'Mobile App' : 'Website';

  // ── Category table rows ──────────────────────────────────────────────────
  const catsSorted = e.categoryScores.slice().sort((a, b) => b.score - a.score);

  const catTableRows = catsSorted.map(c => {
    const st = catStatus(c.score);
    return `<tr>
      <td>${esc(c.name)}</td>
      <td style="font-weight:700;color:${scoreColor(c.score)}">${c.score}%</td>
      <td>${st.icon} <span style="color:${st.color};font-weight:600">${st.label}</span></td>
    </tr>`;
  }).join('');

  // ── Gap cards: group remediation by category ─────────────────────────────
  const catOrder = catsSorted.map(c => c.name);
  const remByCat = {};
  for (const r of e.remediation) {
    // find category from results
    const matched = e.results.find(res => res.id === r.id);
    const cat = matched?.category || 'Other';
    (remByCat[cat] ||= []).push(r);
  }

  // Sort categories by score ascending (worst first) for gap cards
  const gapCategories = catsSorted
    .slice()
    .sort((a, b) => a.score - b.score)
    .filter(c => remByCat[c.name]?.length > 0);

  let gapIdx = 1;
  const gapCards = gapCategories.map(c => {
    const items = remByCat[c.name];
    const pl = priorityLabel(c.score);

    const gapSummary = c.score >= 75
      ? 'Strong implementation detected with minor enhancements recommended.'
      : c.score >= 60
        ? 'Basic implementation is present; however, additional measures would strengthen compliance.'
        : 'The assessment identified significant gaps requiring urgent attention.';

    const gaps = items.map(r => `<li>${esc(r.detail)}</li>`).join('');
    const recs = items
      .filter(r => r.recommendation)
      .map(r => `<li>${esc(r.recommendation)}</li>`).join('');

    const card = `<div class="gap-card">
      <div class="gap-title">${gapIdx}. ${esc(c.name)} (${c.score}%) — <span style="color:${pl.color}">${pl.text}</span></div>
      <p class="gap-summary">${gapSummary}</p>
      ${gaps ? `<p class="gap-label">Key gaps identified:</p><ul>${gaps}</ul>` : ''}
      ${recs ? `<p class="gap-label">Recommended actions:</p><ul>${recs}</ul>` : ''}
    </div>`;
    gapIdx++;
    return card;
  }).join('');

  // ── Strengths ────────────────────────────────────────────────────────────
  const strong = catsSorted.filter(c => c.score >= 75);
  const strengthsList = strong.length
    ? strong.map(c => `<li><strong>${esc(c.name)}</strong> (${c.score}%)</li>`).join('')
    : '<li>No categories reached the 75% threshold in this assessment.</li>';

  // ── PRISM logo (base64 embedded so it renders in emails and blob-URL tabs) ──
  const logoHtml = `<img src="${PRISM_LOGO_DATA_URI}" class="report-logo" alt="PRISM" />`;

  const fontLink = opts.email
    ? ''
    : `<link href="https://fonts.googleapis.com/css2?family=IBM+Plex+Sans:wght@400;500;600;700&display=swap" rel="stylesheet"/>`;

  const submissionNote = opts.submission
    ? `<div class="submission-note">
        <strong>Site Scanner Submission</strong><br/>
        Submitted email: ${esc(opts.submission.email)}<br/>
        Scanned URL: ${esc(target)}
      </div>`
    : '';

  const ctaHtml = opts.cta
    ? `<div class="report-cta">
        <div class="report-cta-title">Take Your Free Self-Assessment</div>
        <p class="report-cta-body">
          Go beyond this automated scan with a guided, comprehensive readiness review across your whole
          organisation — policies, controls, vendors and more. Free, and takes minutes to start.
        </p>
        <a class="report-cta-btn" href="${esc(opts.cta.url)}">Take Free Self-Assessment →</a>
      </div>`
    : '';

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8"/>
<meta name="viewport" content="width=device-width,initial-scale=1"/>
<title>DPDPA &amp; GDPR Compliance Assessment Report — ${esc(target)}</title>
${fontLink}
<style>
  *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }

  body {
    font-family: 'IBM Plex Sans', -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
    background: #fff;
    color: #1a1a2e;
    font-size: 13px;
    line-height: 1.6;
  }

  .page {
    max-width: 820px;
    margin: 0 auto;
    padding: 48px 48px 64px;
  }

  .submission-note {
    background: #f1f5f9;
    border: 1px solid #cbd5e1;
    border-radius: 8px;
    padding: 12px 16px;
    margin-bottom: 24px;
    font-size: 12px;
    color: #334155;
    line-height: 1.6;
  }

  /* ── Header ── */
  .report-header {
    text-align: center;
    margin-bottom: 36px;
    padding-bottom: 24px;
    border-bottom: 2px solid #5b21b6;
  }

  .report-logo {
    height: 52px;
    margin-bottom: 16px;
    display: block;
    margin-left: auto;
    margin-right: auto;
  }

  .report-title {
    font-size: 26px;
    font-weight: 700;
    color: #1a1a2e;
    margin-bottom: 12px;
    line-height: 1.3;
  }

  .report-meta {
    font-size: 12px;
    color: #6b7280;
    line-height: 1.8;
  }

  /* ── Section headings ── */
  .section {
    margin-top: 32px;
    margin-bottom: 16px;
  }

  .section-title {
    font-size: 16px;
    font-weight: 700;
    color: #1a1a2e;
    margin-bottom: 8px;
    padding-bottom: 6px;
    border-bottom: 1px solid #e5e7eb;
  }

  /* ── Exec summary ── */
  .exec-text {
    font-size: 13px;
    color: #374151;
    line-height: 1.8;
    margin-bottom: 12px;
  }

  /* ── Score cards ── */
  .score-cards {
    display: flex;
    gap: 16px;
    justify-content: center;
    margin: 20px 0;
    flex-wrap: wrap;
  }

  .score-card {
    border: 1px solid #e5e7eb;
    border-radius: 12px;
    padding: 20px 28px;
    text-align: center;
    min-width: 160px;
    flex: 1;
  }

  .score-num {
    font-size: 48px;
    font-weight: 700;
    line-height: 1;
    margin-bottom: 8px;
  }

  .score-fw {
    font-size: 11px;
    font-weight: 700;
    color: #6b7280;
    text-transform: uppercase;
    letter-spacing: 0.08em;
    margin-bottom: 2px;
  }

  .score-grade {
    font-size: 12px;
    color: #6b7280;
    margin-top: 4px;
  }

  .verdict-line {
    text-align: center;
    font-size: 15px;
    font-weight: 700;
    margin: 16px 0 8px;
  }

  .verdict-body {
    font-size: 13px;
    color: #374151;
    line-height: 1.7;
    margin-bottom: 4px;
  }

  /* ── Category table ── */
  table.cat-table {
    width: 100%;
    border-collapse: collapse;
    font-size: 13px;
    margin-top: 12px;
  }

  table.cat-table thead th {
    background: #f3f4f6;
    padding: 10px 14px;
    text-align: left;
    font-size: 11px;
    font-weight: 700;
    text-transform: uppercase;
    letter-spacing: 0.06em;
    color: #6b7280;
    border-bottom: 1px solid #e5e7eb;
  }

  table.cat-table tbody td {
    padding: 10px 14px;
    border-bottom: 1px solid #f3f4f6;
    vertical-align: middle;
  }

  table.cat-table tbody tr:last-child td { border-bottom: none; }

  /* ── Gap cards ── */
  .gap-card {
    border: 1px solid #e5e7eb;
    border-radius: 10px;
    padding: 18px 20px;
    margin-bottom: 14px;
    break-inside: avoid;
  }

  .gap-title {
    font-size: 14px;
    font-weight: 700;
    color: #1a1a2e;
    margin-bottom: 6px;
  }

  .gap-summary {
    font-size: 12px;
    color: #6b7280;
    margin-bottom: 10px;
    line-height: 1.6;
  }

  .gap-label {
    font-size: 12px;
    font-weight: 700;
    color: #374151;
    margin: 10px 0 4px;
  }

  ul {
    padding-left: 20px;
    margin-bottom: 6px;
  }

  li {
    font-size: 12px;
    color: #374151;
    line-height: 1.7;
    margin-bottom: 2px;
  }

  /* ── Strengths ── */
  .strength-intro {
    font-size: 13px;
    color: #374151;
    margin-bottom: 10px;
  }

  .strength-close {
    font-size: 13px;
    color: #374151;
    margin-top: 10px;
  }

  /* ── CTA ── */
  .report-cta {
    background: linear-gradient(135deg, #f5f3ff 0%, #ede9fe 100%);
    border: 1px solid #ddd6fe;
    border-radius: 14px;
    padding: 24px 28px;
    text-align: center;
    margin-top: 32px;
  }

  .report-cta-title {
    font-size: 17px;
    font-weight: 700;
    color: #1a1a2e;
    margin-bottom: 8px;
  }

  .report-cta-body {
    font-size: 13px;
    color: #4b5563;
    line-height: 1.6;
    max-width: 480px;
    margin: 0 auto 18px;
  }

  .report-cta-btn {
    display: inline-block;
    background: #5b21b6;
    color: #ffffff !important;
    font-size: 14px;
    font-weight: 700;
    text-decoration: none;
    padding: 12px 28px;
    border-radius: 8px;
  }

  /* ── Disclaimer ── */
  .disclaimer {
    font-size: 11px;
    color: #9ca3af;
    margin-top: 40px;
    padding-top: 16px;
    border-top: 1px solid #e5e7eb;
    line-height: 1.6;
  }

  /* ── Print ── */
  @media print {
    @page { margin: 18mm 16mm; size: A4 portrait; }
    body { background: #fff; }
    .no-print { display: none !important; }
    .gap-card { break-inside: avoid; }
    .score-cards { break-inside: avoid; }
  }
</style>
</head>
<body>
<div class="page">
  ${submissionNote}

  <!-- Header -->
  <div class="report-header">
    ${logoHtml}
    <div class="report-title">DPDPA &amp; GDPR Compliance Assessment Report</div>
    <div class="report-meta">
      ${esc(target)}<br/>
      Assessment Date: ${esc(scannedAt)}<br/>
      Type: ${esc(type)}
    </div>
  </div>

  <!-- Executive Summary -->
  <div class="section">
    <div class="section-title">Executive Summary</div>
    <p class="exec-text">
      We have completed a preliminary assessment of your website against key requirements of India's Digital
      Personal Data Protection Act, 2023 (DPDPA) and the EU General Data Protection Regulation (GDPR). The
      assessment was performed using an automated privacy and compliance review of publicly available website
      content, including privacy notices, consent mechanisms, cookie disclosures, and data processing
      transparency information.
    </p>
    <p class="exec-text">
      ${e.overall.score >= 75
        ? 'The assessment indicates that the website demonstrates a strong compliance posture. Targeted improvements would further strengthen the programme.'
        : e.overall.score >= 60
          ? 'The assessment indicates that the website has a partial compliance posture. Targeted remediation activities are recommended.'
          : 'The assessment indicates that the website requires significant improvements. Several important compliance gaps remain that require targeted remediation activities.'}
    </p>
  </div>

  <!-- Scores -->
  <div class="section">
    <div class="section-title">Assessment Scores</div>
    <div class="score-cards">
      <div class="score-card">
        <div class="score-num" style="color:${scoreColor(e.overall.score)}">${e.overall.score}</div>
        <div class="score-fw">Overall Score</div>
        <div class="score-grade">Grade ${e.overall.grade}</div>
      </div>
      <div class="score-card">
        <div class="score-num" style="color:${scoreColor(e.frameworks.GDPR.score)}">${e.frameworks.GDPR.score}</div>
        <div class="score-fw">GDPR (EU)</div>
        <div class="score-grade">Grade ${e.frameworks.GDPR.grade}</div>
      </div>
      <div class="score-card">
        <div class="score-num" style="color:${scoreColor(e.frameworks.DPDPA.score)}">${e.frameworks.DPDPA.score}</div>
        <div class="score-fw">DPDPA (India)</div>
        <div class="score-grade">Grade ${e.frameworks.DPDPA.grade}</div>
      </div>
    </div>
    <div class="verdict-line" style="color:${scoreColor(e.overall.score)}">${esc(verdictText(e.overall.score))}</div>
    <p class="verdict-body">${verdictBody(e.overall.score)}</p>
  </div>

  <!-- Category table -->
  <div class="section">
    <div class="section-title">Assessment Results by Category</div>
    <table class="cat-table">
      <thead>
        <tr>
          <th>Category</th>
          <th>Score</th>
          <th>Status</th>
        </tr>
      </thead>
      <tbody>
        ${catTableRows}
      </tbody>
    </table>
  </div>

  <!-- Gap cards -->
  ${gapCards.length ? `
  <div class="section">
    <div class="section-title">Key Observations and Compliance Gaps</div>
    ${gapCards}
  </div>` : ''}

  <!-- Strengths -->
  <div class="section">
    <div class="section-title">Areas of Strength</div>
    <p class="strength-intro">The assessment identified strong performance in the following areas:</p>
    <ul>${strengthsList}</ul>
    <p class="strength-close">These areas demonstrate a positive foundation upon which broader compliance can be built.</p>
  </div>

  ${ctaHtml}

  <!-- Disclaimer -->
  <p class="disclaimer">
    This automated report evaluates publicly observable signals (privacy policy text, cookies, trackers, security headers,
    forms, store disclosures). It is a technical pre-assessment to prioritise remediation — not legal advice and not a
    certification of compliance. A full DPDPA/GDPR assessment also requires review of internal processing records,
    contracts (DPAs), consent logs, DPIAs, and data-flow mapping. Generated by PRISM Compliance Scanner.
  </p>

</div>
${opts.email ? '' : `<script>
  // Auto-trigger print dialog so user can Save as PDF
  window.addEventListener('load', () => {
    setTimeout(() => window.print(), 400);
  });
</script>`}
</body>
</html>`;
}
