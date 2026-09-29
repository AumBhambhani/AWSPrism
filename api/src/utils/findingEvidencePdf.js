import PDFDocument from "pdfkit";
import { PRISM_LOGO_DATA_URI } from "../data/prismLogo.js";
import {
  buildControlMappings,
  buildFindingNarrative,
  buildFindingRef,
  remediationSla,
} from "../data/findingGuidance.js";

const LOGO_BUFFER = (() => {
  try {
    const b64 = PRISM_LOGO_DATA_URI.split(",")[1];
    return b64 ? Buffer.from(b64, "base64") : null;
  } catch {
    return null;
  }
})();

// ── Brand palette (shared with the self-assessment report) ────────────────
const NAVY = "#1E3A5F";
const INK = "#22252E";
const BODY = "#334155";
const MUTED = "#5A6270";
const BORDER = "#DADEE6";
const SOFT = "#F0F3F8";
const FAINT = "#8B85A0";

const SEVERITY_STYLE = {
  critical: { bg: "#B91C1C" },
  high: { bg: "#C2410C" },
  medium: { bg: "#B45309" },
  low: { bg: "#15803D" },
};

const STATUS_STYLE = {
  open: { bg: "#B45309", label: "OPEN" },
  acknowledged: { bg: "#1E3A5F", label: "ACKNOWLEDGED" },
  "in progress": { bg: "#1E3A5F", label: "IN PROGRESS" },
  resolved: { bg: "#15803D", label: "RESOLVED" },
  suppressed: { bg: "#5A6270", label: "SUPPRESSED" },
  false_positive: { bg: "#5A6270", label: "FALSE POSITIVE" },
};

/**
 * Renders an audit-ready "compliance finding report" PDF for a single failing
 * security-test finding: identification, executive risk summary, detection,
 * impact, compliance mapping, structured remediation, lifecycle tracking,
 * verification and separated detection / remediation evidence.
 *
 * Backward compatible with the original flat input (title/testKey/…/
 * isoReferences). Extra optional inputs enrich the report:
 *
 * @param {object} opts
 * @param {string}   opts.title
 * @param {string}   opts.testKey
 * @param {string}   opts.resourceId
 * @param {string}   opts.severity
 * @param {string|null} opts.message
 * @param {object}   opts.evidencePayload
 * @param {string[]} [opts.isoReferences]
 * @param {Array<{framework?:string,isoReference?:string}>} [opts.controlMappings]
 * @param {string|null} [opts.testDescription]
 * @param {string|null} [opts.remediationGuidance]
 * @param {string|null} opts.connectionName
 * @param {string|null} opts.integrationKey
 * @param {string|null} [opts.findingRef]        - stable finding id; derived if omitted and identity fields are given.
 * @param {number|null} [opts.companyId]         - used only to derive findingRef.
 * @param {number|null} [opts.connectionId]      - used only to derive findingRef.
 * @param {string|null} [opts.status]            - finding lifecycle status.
 * @param {Date|string|null} [opts.firstDetectedAt]
 * @param {number|string|null} [opts.linkedActionId]
 * @param {string|null} [opts.remediationOwner]
 * @param {string|null} [opts.remediationDueDate]
 * @returns {Promise<Buffer>}
 */
export function renderFindingEvidencePdf({
  title,
  testKey,
  resourceId,
  severity,
  message,
  evidencePayload,
  isoReferences,
  controlMappings,
  testDescription,
  remediationGuidance,
  connectionName,
  integrationKey,
  findingRef,
  companyId,
  connectionId,
  status,
  firstDetectedAt,
  linkedActionId,
  remediationOwner,
  remediationDueDate,
}) {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({
      size: "A4",
      margins: { top: 128, bottom: 58, left: 54, right: 54 },
      bufferPages: true,
      info: {
        Title: `Compliance Finding Report — ${title || testKey}`,
        Author: "PRISM",
        Subject: `Automated compliance finding for ${resourceId || testKey}`,
      },
    });

    const chunks = [];
    doc.on("data", (c) => chunks.push(c));
    doc.on("end", () => resolve(Buffer.concat(chunks)));
    doc.on("error", reject);

    const left = doc.page.margins.left;
    const right = doc.page.width - doc.page.margins.right;
    const cw = right - left;
    const pageBottom = doc.page.height - doc.page.margins.bottom;

    const now = new Date();
    const detectedDate = (() => {
      if (firstDetectedAt instanceof Date && !Number.isNaN(firstDetectedAt.getTime())) return firstDetectedAt;
      if (typeof firstDetectedAt === "string") {
        const d = new Date(firstDetectedAt);
        if (!Number.isNaN(d.getTime())) return d;
      }
      return now;
    })();
    const fmt = (d) => d.toLocaleString("en-GB");
    const fmtDate = (d) => d.toLocaleDateString("en-GB");

    const ref =
      findingRef ||
      buildFindingRef({ companyId, connectionId, testKey, resourceId });

    const sevKey = String(severity || "").toLowerCase();
    const sevBg = (SEVERITY_STYLE[sevKey] || { bg: MUTED }).bg;
    const sevLabel = (severity || "—").toUpperCase();

    const statusKey = String(status || "open").toLowerCase();
    const statusStyle = STATUS_STYLE[statusKey] || { bg: MUTED, label: statusKey.toUpperCase() };
    const statusDisplay = statusKey.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());

    const mappingRows =
      controlMappings && controlMappings.length
        ? buildControlMappings(controlMappings)
        : buildControlMappings((isoReferences || []).map((r) => ({ framework: "ISO27001", isoReference: r })));
    const frameworkNames = mappingRows.map((r) => r.framework);

    const narrative = buildFindingNarrative({
      testKey,
      title,
      message,
      severity,
      dbDescription: testDescription,
      dbRemediation: remediationGuidance,
      resourceId,
      connectionName,
      frameworkNames,
    });

    const sla = remediationSla(severity, detectedDate);

    // ── Page furniture ──────────────────────────────────────────────────
    const drawLetterhead = () => {
      const topY = 40;
      if (LOGO_BUFFER) {
        try {
          doc.image(LOGO_BUFFER, left, topY, { width: 128 });
        } catch {
          doc.font("Helvetica-Bold").fontSize(15).fillColor(NAVY).text("PRISM", left, topY + 6);
        }
      } else {
        doc.font("Helvetica-Bold").fontSize(15).fillColor(NAVY).text("PRISM", left, topY + 6);
      }
      doc
        .font("Helvetica-Bold")
        .fontSize(8)
        .fillColor(MUTED)
        .text("COMPLIANCE FINDING REPORT", left, topY + 2, { width: cw, align: "right", characterSpacing: 1.1 });
      doc
        .font("Helvetica")
        .fontSize(8.5)
        .fillColor(FAINT)
        .text(`${ref}  ·  generated ${fmt(now)}`, left, topY + 16, { width: cw, align: "right" });
      doc.moveTo(left, topY + 44).lineTo(right, topY + 44).lineWidth(2).strokeColor(NAVY).stroke();
    };

    const drawFooter = (idx, count) => {
      const savedBottom = doc.page.margins.bottom;
      doc.page.margins.bottom = 0;
      const y = doc.page.height - 42;
      doc.moveTo(left, y - 8).lineTo(right, y - 8).lineWidth(0.75).strokeColor(BORDER).stroke();
      doc
        .font("Helvetica")
        .fontSize(7.5)
        .fillColor(MUTED)
        .text(
          `${ref}  ·  Generated by PRISM  ·  Confidential — internal use & authorised auditors only`,
          left,
          y,
          { width: cw - 70, align: "left", lineBreak: false }
        );
      doc
        .font("Helvetica")
        .fontSize(7.5)
        .fillColor(MUTED)
        .text(`Page ${idx + 1} of ${count}`, left, y, { width: cw, align: "right" });
      doc.page.margins.bottom = savedBottom;
    };

    // ── Layout helpers ──────────────────────────────────────────────────
    const ensureSpace = (need) => {
      if (doc.y + need > pageBottom) doc.addPage();
    };

    const sectionHeading = (text) => {
      ensureSpace(58);
      doc.moveDown(0.7);
      const y = doc.y;
      doc.font("Helvetica-Bold").fontSize(11).fillColor(NAVY).text(text.toUpperCase(), left, y, { characterSpacing: 0.6 });
      doc.moveTo(left, doc.y + 3).lineTo(right, doc.y + 3).lineWidth(1).strokeColor(NAVY).stroke();
      doc.moveDown(0.65);
    };

    const subHeading = (text) => {
      ensureSpace(24);
      doc.moveDown(0.35);
      doc.font("Helvetica-Bold").fontSize(9.5).fillColor(NAVY).text(text, left, doc.y, { characterSpacing: 0.3 });
      doc.moveDown(0.2);
    };

    const paragraph = (text, opts = {}) => {
      if (!text) return;
      const size = opts.size || 9.8;
      const font = opts.italic ? "Helvetica-Oblique" : "Helvetica";
      ensureSpace(doc.font(font).fontSize(size).heightOfString(text, { width: cw }) + 5);
      doc.font(font).fontSize(size).fillColor(opts.color || BODY).text(text, left, doc.y, { width: cw, lineGap: 1.6 });
      doc.moveDown(opts.tight ? 0.25 : 0.45);
    };

    const metaGrid = (pairs) => {
      const gutter = 18;
      const colW = (cw - gutter) / 2;
      const labelH = (label) =>
        doc.font("Helvetica-Bold").fontSize(7.5).heightOfString(label.toUpperCase(), { width: colW });
      const valueH = (value) =>
        doc.font("Helvetica").fontSize(9.5).heightOfString(String(value ?? "—"), { width: colW });
      for (let i = 0; i < pairs.length; i += 2) {
        const row = [pairs[i], pairs[i + 1]].filter(Boolean);
        const h = Math.max(...row.map(([l, v]) => labelH(l) + 2.5 + valueH(v)));
        ensureSpace(h + 11);
        const y = doc.y;
        row.forEach(([label, value], c) => {
          const x = left + c * (colW + gutter);
          const lh = labelH(label);
          doc
            .font("Helvetica-Bold")
            .fontSize(7.5)
            .fillColor(MUTED)
            .text(label.toUpperCase(), x, y, { width: colW, characterSpacing: 0.4 });
          doc
            .font("Helvetica")
            .fontSize(9.5)
            .fillColor(INK)
            .text(String(value ?? "—"), x, y + lh + 2.5, { width: colW });
        });
        doc.y = y + h + 7;
        doc.moveTo(left, doc.y - 3.5).lineTo(right, doc.y - 3.5).lineWidth(0.5).strokeColor(BORDER).stroke();
      }
    };

    const kvRow = (label, value) => {
      const labelW = 150;
      const valW = cw - labelW;
      const text = value == null || value === "" ? "—" : String(value);
      const h = Math.max(
        doc.font("Helvetica-Bold").fontSize(8).heightOfString(label.toUpperCase(), { width: labelW - 10 }),
        doc.font("Helvetica").fontSize(9.5).heightOfString(text, { width: valW })
      );
      ensureSpace(h + 11);
      const y = doc.y;
      doc.font("Helvetica-Bold").fontSize(8).fillColor(MUTED).text(label.toUpperCase(), left, y + 1, { width: labelW - 10, characterSpacing: 0.4 });
      doc.font("Helvetica").fontSize(9.5).fillColor(INK).text(text, left + labelW, y, { width: valW });
      doc.y = y + h + 7;
      doc.moveTo(left, doc.y - 3.5).lineTo(right, doc.y - 3.5).lineWidth(0.5).strokeColor(BORDER).stroke();
    };

    const numberedList = (items) => {
      const numW = 20;
      items.forEach((step, i) => {
        const h = doc.font("Helvetica").fontSize(9.5).heightOfString(step, { width: cw - numW });
        ensureSpace(h + 8);
        const y = doc.y;
        doc.font("Helvetica-Bold").fontSize(9.5).fillColor(NAVY).text(`${i + 1}.`, left, y, { width: numW - 4 });
        doc.font("Helvetica").fontSize(9.5).fillColor(BODY).text(step, left + numW, y, { width: cw - numW, lineGap: 1.5 });
        doc.y = y + h + 5.5;
      });
    };

    const twoColBlock = (leftTitle, leftBody, rightTitle, rightBody) => {
      const gutter = 18;
      const colW = (cw - gutter) / 2;
      const bodyH = (t) =>
        doc.font("Helvetica").fontSize(9).heightOfString(t, { width: colW - 20, lineGap: 1.3 });
      const h = Math.max(bodyH(leftBody), bodyH(rightBody)) + 34;
      ensureSpace(h + 8);
      const y = doc.y;
      [
        [left, leftTitle, leftBody],
        [left + colW + gutter, rightTitle, rightBody],
      ].forEach(([x, t, b]) => {
        doc.roundedRect(x, y, colW, h, 3).fillAndStroke(SOFT, BORDER);
        doc.font("Helvetica-Bold").fontSize(7.5).fillColor(MUTED).text(t.toUpperCase(), x + 10, y + 9, { width: colW - 20, characterSpacing: 0.5 });
        doc.font("Helvetica").fontSize(9).fillColor(INK).text(b, x + 10, y + 24, { width: colW - 20, lineGap: 1.3 });
      });
      doc.y = y + h + 6;
    };

    const noteBox = (text) => {
      const innerW = cw - 20;
      const th = doc.font("Helvetica").fontSize(8.5).heightOfString(text, { width: innerW });
      const h = th + 16;
      ensureSpace(h + 6);
      const y = doc.y;
      doc.save();
      doc.dash(2, { space: 2 }).roundedRect(left, y, cw, h, 3).lineWidth(0.75).strokeColor(MUTED).stroke();
      doc.restore();
      doc.font("Helvetica-Oblique").fontSize(8.5).fillColor(MUTED).text(text, left + 10, y + 8, { width: innerW, lineGap: 1.2 });
      doc.y = y + h + 6;
    };

    const codePanel = (json) => {
      const innerW = cw - 20;
      const jsonH = doc.font("Courier").fontSize(8.5).heightOfString(json, { width: innerW });
      const h = jsonH + 16;
      if (doc.y + h > pageBottom) {
        // Let it flow / paginate naturally rather than clip.
        doc.font("Courier").fontSize(8.5).fillColor(BODY).text(json, left + 10, doc.y, { width: innerW });
        doc.moveDown(0.5);
        return;
      }
      const y = doc.y;
      doc.roundedRect(left, y, cw, h, 3).fillAndStroke(SOFT, BORDER);
      doc.font("Courier").fontSize(8.5).fillColor(BODY).text(json, left + 10, y + 8, { width: innerW });
      doc.y = y + h + 6;
    };

    const controlTable = () => {
      if (!mappingRows.length) {
        paragraph("No control mappings are recorded for this test.");
        return;
      }
      const fwW = 178;
      const ctrlX = left + fwW;
      const ctrlW = cw - fwW;
      ensureSpace(22);
      let y = doc.y;
      doc.rect(left, y, cw, 16).fill(SOFT);
      doc.font("Helvetica-Bold").fontSize(7.5).fillColor(MUTED);
      doc.text("FRAMEWORK", left + 6, y + 4.5, { width: fwW - 8, characterSpacing: 0.5 });
      doc.text("CONTROL / ARTICLE / SECTION", ctrlX + 2, y + 4.5, { width: ctrlW - 4, characterSpacing: 0.5 });
      doc.y = y + 16;
      mappingRows.forEach((rowd) => {
        const controls = rowd.controls.join(",  ");
        const rh = Math.max(
          doc.font("Helvetica-Bold").fontSize(9).heightOfString(rowd.framework, { width: fwW - 12 }),
          doc.font("Helvetica").fontSize(9).heightOfString(controls, { width: ctrlW - 6 })
        );
        ensureSpace(rh + 10);
        y = doc.y;
        doc.font("Helvetica-Bold").fontSize(9).fillColor(INK).text(rowd.framework, left + 6, y + 3, { width: fwW - 12 });
        doc.font("Helvetica").fontSize(9).fillColor(BODY).text(controls, ctrlX + 2, y + 3, { width: ctrlW - 6 });
        doc.y = y + rh + 7;
        doc.moveTo(left, doc.y - 3).lineTo(right, doc.y - 3).lineWidth(0.5).strokeColor(BORDER).stroke();
      });
    };

    // ══ TITLE + pills ═══════════════════════════════════════════════════
    doc.font("Helvetica-Bold").fontSize(18).fillColor(INK).text(title || testKey, left, doc.page.margins.top, { width: cw });
    doc.moveDown(0.45);
    {
      const pill = (label, bg, x) => {
        doc.font("Helvetica-Bold").fontSize(8);
        const tw = doc.widthOfString(label, { characterSpacing: 0.8 });
        const w = tw + 18;
        doc.roundedRect(x, doc.y, w, 16, 3).fill(bg);
        doc.fillColor("#FFFFFF").text(label, x + 9, doc.y + 4, { characterSpacing: 0.8, lineBreak: false });
        return x + w + 8;
      };
      const y0 = doc.y;
      let x = pill(sevLabel, sevBg, left);
      doc.y = y0;
      x = pill(statusStyle.label, statusStyle.bg, x);
      doc.y = y0 + 16 + 6;
    }

    // ══ Identification ═════════════════════════════════════════════════
    sectionHeading("Finding identification");
    const idPairs = [
      ["Finding ID", ref],
      ["Status", statusDisplay],
      ["Severity", sevLabel],
      ["Source connection", `${connectionName || "—"} (${integrationKey || "—"})`],
      ["First detected", fmt(detectedDate)],
      ["Test key", testKey],
    ];
    if (evidencePayload && typeof evidencePayload === "object") {
      if (evidencePayload.resourceType != null) idPairs.push(["Resource type", evidencePayload.resourceType]);
      if (evidencePayload.resourceName != null) idPairs.push(["Resource name", evidencePayload.resourceName]);
      if (evidencePayload.region != null) idPairs.push(["Region", evidencePayload.region]);
    }
    metaGrid(idPairs);
    kvRow("Affected resource", resourceId);

    // ══ Executive risk summary ═════════════════════════════════════════
    sectionHeading("Executive risk summary");
    paragraph(narrative.executiveSummary, { size: 10 });

    // ══ What was detected ══════════════════════════════════════════════
    sectionHeading("What was detected");
    paragraph(narrative.whatDetected);
    paragraph(
      `Detection method — PRISM automated check "${testKey}" run against the ${connectionName || "source"} connection on ${fmtDate(detectedDate)}.`,
      { italic: true, size: 8.7, color: MUTED, tight: true }
    );

    // ══ Detection evidence ═════════════════════════════════════════════
    sectionHeading("Detection evidence");
    paragraph(
      `Collected automatically by PRISM on ${fmt(detectedDate)}. Machine-generated from the connector response; not modified. This is the state that caused the finding.`,
      { italic: true, size: 8.5, color: MUTED, tight: true }
    );
    codePanel(JSON.stringify(evidencePayload ?? {}, null, 2));

    // ══ Why it matters ═════════════════════════════════════════════════
    sectionHeading("Why it matters");
    paragraph(narrative.whyItMatters);

    // ══ Compliance impact ══════════════════════════════════════════════
    sectionHeading("Compliance impact");
    paragraph(narrative.complianceImpact);
    if (mappingRows.length) {
      doc.moveDown(0.2);
      controlTable();
      doc.moveDown(0.35);
      paragraph(
        "ISO/IEC 27001:2022 references follow the official ISO/IEC 27002:2022 correspondence table. GDPR, DPDPA and other framework references (SOC 2, HIPAA, CIS, PCI DSS, CERT-In) indicate the control most directly engaged, derived from published informative mappings. These are indicative mappings to support triage and routing, not a certified crosswalk.",
        { italic: true, size: 7.5, color: MUTED, tight: true }
      );
    }

    // ── Remediation & lifecycle (flows continuously; sectionHeading keeps
    //    a heading from being orphaned at a page foot) ───────────────────
    sectionHeading("Remediation");
    subHeading("Immediate action");
    paragraph(narrative.immediateAction);
    subHeading("Recommended target architecture");
    paragraph(narrative.targetArchitecture);
    subHeading("Step-by-step");
    numberedList(narrative.remediationSteps);

    sectionHeading("Remediation tracking");
    metaGrid([
      ["Assigned owner", remediationOwner || "Not yet assigned"],
      ["Target remediation date", remediationDueDate || `${sla.dueDate}  (suggested: ${sla.label})`],
      ["Current status", statusDisplay],
      ["Linked remediation action", linkedActionId ? `#${linkedActionId}` : "Not yet linked"],
    ]);
    paragraph(
      "Maintained by the control owner until the finding is closed. The target date is a severity-based suggestion (critical 7 days, high 30, medium 90, low 180); record the committed owner and date on approval.",
      { italic: true, size: 7.5, color: MUTED, tight: true }
    );

    sectionHeading("Verification");
    twoColBlock(
      "Before (observed at detection)",
      message
        ? `${message.trim()}\n\nCaptured automatically by PRISM on ${fmtDate(detectedDate)}.`
        : `The check "${testKey}" returned a fail for this resource. Captured automatically by PRISM on ${fmtDate(detectedDate)}.`,
      "After (expected once remediated)",
      `The PRISM check "${testKey}" returns PASS for this resource, with the recommended target architecture in place. No exception or risk acceptance is recorded.`
    );
    kvRow("PRISM re-scan result", "Pending — re-run the collection for this connection after remediation and attach the passing result to this report.");

    sectionHeading("Remediation evidence");
    paragraph(
      "To close this finding, attach the following as evidence that the remediation was applied and verified:",
      { tight: true }
    );
    numberedList([
      "A screenshot or CLI / API output showing the corrected configuration on the affected resource.",
      "The change-request reference or the infrastructure-as-code commit that made the change.",
      `The passing PRISM re-scan result for ${ref} (the check returning PASS for this resource).`,
    ]);
    noteBox(
      "Detection evidence (above) is machine-generated by PRISM and fixed. Remediation evidence is supplied by the control owner at closure and should be dated and attributed.",
    );

    // ══ Review & sign-off ══════════════════════════════════════════════
    sectionHeading("Review & sign-off");
    paragraph(
      "Complete on remediation and review. This report, with the remediation evidence attached, is the audit record for this finding.",
      { tight: true }
    );
    doc.moveDown(0.5);
    {
      const gutter = 26;
      const colW = (cw - gutter) / 2;
      const rows = [
        ["Remediated by (name / role)", "Date"],
        ["Reviewed by (name / role)", "Date"],
        ["Outcome", "Residual risk accepted by (if applicable)"],
      ];
      rows.forEach(([l1, l2]) => {
        ensureSpace(34);
        const y = doc.y;
        [
          [left, l1],
          [left + colW + gutter, l2],
        ].forEach(([x, label]) => {
          doc.moveTo(x, y + 15).lineTo(x + colW, y + 15).lineWidth(0.75).strokeColor(MUTED).stroke();
          doc.font("Helvetica").fontSize(7.5).fillColor(MUTED).text(label.toUpperCase(), x, y + 19, { width: colW, characterSpacing: 0.4 });
        });
        doc.y = y + 34;
      });
    }

    // ── Stamp furniture on every page ──────────────────────────────────
    const range = doc.bufferedPageRange();
    for (let i = range.start; i < range.start + range.count; i += 1) {
      doc.switchToPage(i);
      drawLetterhead();
      drawFooter(i - range.start, range.count);
    }
    doc.flushPages();
    doc.end();
  });
}
