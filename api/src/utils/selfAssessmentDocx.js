// Word (.docx) rendering of the DPDP Act readiness report.
//
// The PDF path is client-side (Paged.js in the browser → print). Word cannot be
// produced that way, so this module converts the same `report.document` HTML on
// the server with `html-to-docx`.
//
// Two transforms are needed before conversion:
//   1. strip the browser-only furniture — the ~500 KB Paged.js polyfill, the
//      print toolbar, the fixed watermark and running-header divs, all of which
//      html-to-docx would either choke on or render as stray content. Word
//      supplies its own running header / footer / page numbers instead.
//   2. rasterise the two inline-SVG dashboard charts to PNG — html-to-docx drops
//      <svg>. Their underlying numbers are also in the §3 and §4 tables, so a
//      chart that fails to rasterise is downgraded to nothing, never an error.
//
// Two more transforms run AFTER html-to-docx, as a post-process on the generated
// .docx (see docxPostProcess.js): html-to-docx always emits equal-width table
// columns (colgroup/col widths are ignored), so that's rewritten to match the
// PDF's proportions; and a watermark is added via a VML shape in the header,
// since html-to-docx has no watermark concept of its own. Both are best-effort —
// either failing falls back to the plain, unmodified file rather than a broken one.

import { fileURLToPath } from "node:url";
import HTMLtoDOCX from "html-to-docx";
import { Resvg } from "@resvg/resvg-js";
import { fixSectionPropertiesOrder, fixTableColumnWidths, addWatermark } from "./docxPostProcess.js";

// Vendored so chart text renders identically on a dev Mac, in CI and in the
// slim container (which ships no fonts). DejaVu Sans is the fontconfig default
// on Debian anyway.
const FONT_FILES = [
  fileURLToPath(new URL("../vendor/fonts/DejaVuSans.ttf", import.meta.url)),
  fileURLToPath(new URL("../vendor/fonts/DejaVuSans-Bold.ttf", import.meta.url)),
];

const DOCX_MIME = "application/vnd.openxmlformats-officedocument.wordprocessingml.document";

// A4 portrait, ~20 mm top/bottom, ~17 mm left/right, in twips (1 mm ≈ 56.7 twip).
// `gutter` MUST be present: html-to-docx interpolates `margins.gutter` directly
// into `w:gutter="${...}"` with no fallback of its own, so an omitted key
// doesn't take its documented "defaults to 0" — it writes the literal string
// `w:gutter="undefined"` into every document, an invalid ST_TwipsMeasure that
// (per real-Word testing) is enough on its own to make Word refuse to open the
// file outright, while more lenient readers (LibreOffice, macOS Preview,
// python-docx) silently ignore it. See docxPostProcess.js's header comment for
// the matching sectPr-ordering defect this same investigation found.
const MARGINS = { top: 1134, right: 964, bottom: 1134, left: 964, header: 567, footer: 567, gutter: 0 };

function esc(s) {
  return String(s ?? "").replace(/[&<>"]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
}

// Render one <svg …>…</svg> string to a PNG data URI. Returns null on any failure.
function svgToPngDataUri(svg, widthPx = 900) {
  try {
    // the report's inline charts omit the SVG namespace — resvg requires it
    const withNs = /xmlns=/.test(svg) ? svg : svg.replace(/^<svg\b/, '<svg xmlns="http://www.w3.org/2000/svg"');
    const r = new Resvg(withNs, {
      fitTo: { mode: "width", value: widthPx },
      font: {
        loadSystemFonts: false,
        fontFiles: FONT_FILES,
        defaultFontFamily: "DejaVu Sans",
        sansSerifFamily: "DejaVu Sans",
      },
      background: "rgba(255,255,255,0)",
    });
    const png = r.render().asPng();
    return `data:image/png;base64,${Buffer.from(png).toString("base64")}`;
  } catch (err) {
    console.error("[self-assessment/docx] chart rasterisation failed:", err.message);
    return null;
  }
}

// Turn the paginated browser document into HTML html-to-docx can consume.
export function docxHtmlFromDocument(documentHtml, { companyName } = {}) {
  let html = documentHtml
    .replace(/<script[\s\S]*?<\/script>/g, "")
    .replace(/<div class="toolbar[\s\S]*?<\/div>/g, "")
    .replace(/<div class="watermark"[\s\S]*?<\/div>/g, "")
    .replace(/<div class="running-header"[\s\S]*?<\/div>/g, "")
    // the cover page reserves a full A4 height on screen — pointless in Word
    .replace(/min-height:\s*296mm;?/g, "")
    .replace(/min-height:\s*0;?/g, "");

  // swap each inline chart for a rasterised PNG (or drop it if raster fails)
  for (const svg of html.match(/<svg[\s\S]*?<\/svg>/g) || []) {
    const uri = svgToPngDataUri(svg);
    html = html.replace(
      svg,
      uri ? `<img src="${uri}" style="width:340px;height:auto" alt="chart" />` : ""
    );
  }

  // html-to-docx ignores CSS `break-before: page`; it does honour a div with
  // `page-break-after: always`. Put one before every <section> bar the cover so
  // each section starts on a fresh page, as in the PDF.
  const parts = html.split("<section");
  html = parts[0] + parts.slice(1)
    .map((p, i) => (i === 0 ? "" : '<div style="page-break-after:always"></div>') + "<section" + p)
    .join("");

  return html;
}

/**
 * Build the readiness report as a .docx.
 * @param {{ document: string, companyName?: string }} report - the object from
 *   buildSelfAssessmentReport (needs at least `.document`).
 * @returns {Promise<Buffer>}
 */
export async function buildReadinessDocx(report, { companyName, watermark = "CONFIDENTIAL" } = {}) {
  if (!report || typeof report.document !== "string") {
    throw new Error("buildReadinessDocx: report.document is required");
  }
  const co = companyName || report.companyName || "the Company";
  const html = docxHtmlFromDocument(report.document, { companyName: co });

  const headerHTMLString = `<p style="font-size:8pt;color:#8A8F99;margin:0">${esc(co)} — DPDP Act 2023 Readiness Assessment</p>`;
  const footerHTMLString = `<p style="font-size:8pt;color:#8A8F99;margin:0">Neozaar Digital Private Limited&nbsp;&nbsp;&#183;&nbsp;&nbsp;Confidential</p>`;

  const out = await HTMLtoDOCX(html, headerHTMLString, {
    orientation: "portrait",
    margins: MARGINS,
    title: `${co} — DPDP Act 2023 Readiness Assessment`,
    header: true,
    footer: true,
    pageNumber: true,
    font: "Calibri",
    fontSize: 21, // half-points → 10.5 pt
    table: { row: { cantSplit: true } },
  }, footerHTMLString);

  let buf = Buffer.isBuffer(out) ? out : Buffer.from(out);
  buf = await fixSectionPropertiesOrder(buf);
  buf = await fixTableColumnWidths(buf, html);
  if (watermark) buf = await addWatermark(buf, watermark);
  return buf;
}

export { DOCX_MIME };
