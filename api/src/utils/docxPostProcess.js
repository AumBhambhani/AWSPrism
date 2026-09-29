// Post-processing surgery on the .docx html-to-docx produces, for defects it
// has itself, independent of anything this codebase asks it to render:
//   1. Table column widths — html-to-docx ignores <colgroup>/<col width:%> and
//      always emits an equal-width <w:tblGrid>. This rewrites the grid (and each
//      row's matching <w:tcW>) to the same proportions the PDF uses.
//   2. A Word watermark — Word watermarks are a VML shape in the header, a
//      different mechanism from the browser/PDF's CSS watermark div (which is
//      stripped for Word, per docxHtmlFromDocument). There is no "watermark"
//      option in html-to-docx, so this hand-builds the same shape Word's own
//      Insert ▸ Watermark ▸ Custom Watermark feature generates, and splices it
//      into header1.xml.
//   3. Section-properties position — html-to-docx's own document.xml template is
//      `<w:body><w:sectPr>...</w:sectPr></w:body>`, and it then IMPORTS the real
//      content (every paragraph/table) into that already-populated <w:body>,
//      landing AFTER the sectPr already there. Per the OOXML schema (CT_Body:
//      zero or more block-level elements, THEN an optional final sectPr), the
//      body's sectPr must be its LAST child, not first. This is confirmed from
//      html-to-docx's own source (the sectPr template followed by a `.import()`
//      onto the same body node), present in 100% of its output regardless of
//      anything passed to it — this repo's docx generation had never produced a
//      document without this defect. moveSectPrToEnd fixes it.
//
// Both (1)-(3) were diagnosed the hard way: xmllint (well-formedness only),
// @xmldom/xmldom (same), mammoth and python-docx (schema-aware but still too
// lenient to flag element ORDER within a valid parent, or ignore invalid
// numeric-looking attribute values like the sibling `w:gutter="undefined"` bug
// fixed at the source in selfAssessmentDocx.js's MARGINS) and even a real
// LibreOffice conversion all accepted files with this defect — only real
// Microsoft Word rejected them outright ("Word experienced an error trying to
// open the file"). Nothing short of opening the result in real Word is proof;
// treat every check in this file as necessary, not sufficient.
//
// All operations are best-effort: a failure (bad XML, a table shape that
// doesn't match expectations) is logged and the ORIGINAL buffer is returned
// unmodified — a plain-but-correct Word file beats a corrupt one. Every edit is
// verified by re-parsing the resulting XML with a real parser before it is
// accepted, but that only proves well-formedness, not Word-openability — see
// above.

import JSZip from "jszip";
import { DOMParser } from "@xmldom/xmldom";

function parseOrThrow(xml, label) {
  const errors = [];
  const parser = new DOMParser({
    errorHandler: { warning: () => {}, error: (m) => errors.push(m), fatalError: (m) => errors.push(m) },
  });
  const doc = parser.parseFromString(xml, "text/xml");
  if (errors.length) throw new Error(`${label}: not well-formed XML — ${errors[0]}`);
  return doc;
}

// ─── 0. section-properties position ─────────────────────────────────────────

// html-to-docx always writes the body's (only) <w:sectPr> as the FIRST child of
// <w:body>, then appends the real content after it — see the file header for
// why. Per OOXML's CT_Body content model the final sectPr must be the LAST
// child, so this cuts it from wherever it landed and re-appends it immediately
// before </w:body>. A no-op if it's already last (e.g. a future html-to-docx
// fixes this upstream) or if there's no body-level sectPr at all.
function moveSectPrToEnd(documentXml) {
  const bodyOpen = /<w:body>/.exec(documentXml);
  if (!bodyOpen) throw new Error("no <w:body> element found");
  const afterOpen = bodyOpen.index + bodyOpen[0].length;
  const rest = documentXml.slice(afterOpen);
  const leading = /^\s*(<w:sectPr>[\s\S]*?<\/w:sectPr>)/.exec(rest);
  if (!leading) return documentXml; // no sectPr immediately after <w:body> — nothing to move
  const sectPr = leading[1];
  const withoutLeading = documentXml.slice(0, afterOpen) + rest.slice(leading[0].length);
  const bodyClose = withoutLeading.lastIndexOf("</w:body>");
  if (bodyClose === -1) throw new Error("no </w:body> element found");
  return withoutLeading.slice(0, bodyClose) + sectPr + withoutLeading.slice(bodyClose);
}

// ─── 1. table column widths ─────────────────────────────────────────────────

// The <table ... class="... fixed">, immediately followed by its <colgroup>, in
// document order — mirrors utils/selfAssessmentDocument.js's table() helper,
// which only emits a colgroup (and the "fixed" class) when `widths` was passed.
function extractColumnWidths(html) {
  const out = [];
  const tableRe = /<table\b[^>]*>/g;
  let m;
  while ((m = tableRe.exec(html))) {
    const tag = m[0];
    const rest = html.slice(m.index + tag.length);
    const cg = /^\s*<colgroup>([\s\S]*?)<\/colgroup>/.exec(rest);
    if (!/class="[^"]*\bfixed\b/.test(tag) || !cg) { out.push(null); continue; }
    const pct = [...cg[1].matchAll(/width:\s*([\d.]+)%/g)].map(x => Number(x[1]));
    out.push(pct.length ? pct : null);
  }
  return out;
}

/**
 * Sanitises EVERY table's <w:tblGrid> and <w:tcW> widths — not just the ones
 * with a declared `widths` proportion — because html-to-docx has two defects
 * of its own that corrupt the file regardless of anything this module does:
 *
 *  1. It sometimes writes the grid definition MORE THAN ONCE inside one
 *     <w:tbl> (observed: a 5-column table's grid repeated 3×, 15 <w:gridCol>
 *     total). Per the OOXML schema (CT_Tbl) a table has at most one
 *     <w:tblGrid> — this drops every repeat but the first.
 *  2. Its own default equal-column-width arithmetic often doesn't divide
 *     evenly and it writes the raw repeating decimal straight into the file
 *     (e.g. w:w="3437.3333333333335") — an integer-only attribute per the
 *     schema. This was reproduced on a real generated .docx (24 of 41 tables)
 *     and is almost certainly why Word refuses to open the file outright,
 *     independent of the widths feature below. Every width is rounded to an
 *     integer twip, whether or not a custom proportion was requested.
 *
 * For a table with a declared `widths` proportion, the (now single,
 * integer-valued) grid is additionally re-proportioned to match the PDF.
 */
function applyColumnWidths(documentXml, widthsPerTable) {
  const tables = [...documentXml.matchAll(/<w:tbl>[\s\S]*?<\/w:tbl>/g)];
  if (tables.length !== widthsPerTable.length) {
    throw new Error(`table count mismatch: ${tables.length} <w:tbl> in the docx vs ${widthsPerTable.length} <table> in the source HTML`);
  }

  let out = documentXml;
  let cursor = 0;
  const pieces = [];
  tables.forEach((t, i) => {
    pieces.push(out.slice(cursor, t.index));
    const pct = widthsPerTable[i];

    // Dedupe repeated <w:tblGrid> blocks on EVERY table, not just ones with
    // custom widths — the duplication is invalid regardless.
    let block = t[0];
    const grids = [...block.matchAll(/<w:tblGrid>[\s\S]*?<\/w:tblGrid>/g)];
    if (grids.length > 1) {
      let first = true;
      block = block.replace(/<w:tblGrid>[\s\S]*?<\/w:tblGrid>/g, (g) => {
        if (first) { first = false; return g; }
        return "";
      });
    }

    let twips = null;
    block = block.replace(/<w:tblGrid>[\s\S]*?<\/w:tblGrid>/, (gridBlock) => {
      const gridCols = [...gridBlock.matchAll(/<w:gridCol w:w="([\d.]+)"\/>/g)];
      if (pct && gridCols.length !== pct.length) {
        throw new Error(`table ${i}: <w:tblGrid> has ${gridCols.length} columns vs ${pct.length} declared widths`);
      }
      if (pct) {
        const total = gridCols.reduce((a, g) => a + Number(g[1]), 0);
        const pctTotal = pct.reduce((a, p) => a + p, 0) || 100;
        twips = pct.map(p => Math.round((p / pctTotal) * total));
      } else {
        // No custom proportion requested — keep html-to-docx's own equal split,
        // just rounded to a valid integer (this is the fix for defect #2 above).
        twips = gridCols.map(g => Math.round(Number(g[1])));
      }
      let gi = 0;
      return gridBlock.replace(/<w:gridCol w:w="[\d.]+"\/>/g, () => `<w:gridCol w:w="${twips[gi++]}"/>`);
    });
    if (!twips) { pieces.push(block); cursor = t.index + t[0].length; return; } // no tblGrid at all — leave untouched

    // Each <w:tr> repeats the same left-to-right column sequence (no rowspan/
    // colspan in this report's tables) — walk row by row so a header row with a
    // different cell count (shouldn't happen, but don't silently mis-map if it does).
    block = block.replace(/<w:tr\b[\s\S]*?<\/w:tr>/g, (row) => {
      const cells = [...row.matchAll(/<w:tcW w:w="[\d.]+" w:type="dxa"\/>/g)];
      if (cells.length !== twips.length) return row; // leave an unexpected shape untouched
      let ci = 0;
      return row.replace(/<w:tcW w:w="[\d.]+" w:type="dxa"\/>/g, () => `<w:tcW w:w="${twips[ci++]}" w:type="dxa"/>`);
    });

    pieces.push(block);
    cursor = t.index + t[0].length;
  });
  pieces.push(out.slice(cursor));
  return pieces.join("");
}

// ─── 2. watermark ───────────────────────────────────────────────────────────

// The standard VML text-watermark shape Word's own "Insert ▸ Watermark" feature
// writes into a section's header — same tag names, attributes and formula set
// Word has used since the VML watermark format was introduced (Word 2007+),
// so any Word version that can open a .docx at all recognises it as a watermark
// (editable via Design ▸ Watermark, not just a picture). rotation:315 = the
// standard diagonal.
function watermarkParagraphXml(text, { color = "#C0C0C0", opacity = "0.35", fontSizePt = 1 } = {}) {
  const t = String(text ?? "").replace(/[&<>"]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
  return `<p><r><rPr><noProof/></rPr><pict>` +
    `<v:shapetype id="_x0000_t136" coordsize="1600,21600" o:spt="136" adj="10800" path="m@7,0l@8,0m@5,21600l@6,21600e">` +
    `<v:formulas>` +
    `<v:f eqn="sum #0 0 10800"/><v:f eqn="prod #0 2 1"/><v:f eqn="sum 21600 0 @1"/><v:f eqn="sum 0 0 @2"/>` +
    `<v:f eqn="sum 21600 0 @3"/><v:f eqn="if @0 @3 0"/><v:f eqn="if @0 21600 @1"/><v:f eqn="if @0 0 @2"/>` +
    `<v:f eqn="if @0 @4 21600"/><v:f eqn="mid @5 @6"/><v:f eqn="mid @8 @5"/><v:f eqn="mid @7 @8"/><v:f eqn="mid @6 @7"/>` +
    `<v:f eqn="sum @6 0 @5"/>` +
    `</v:formulas>` +
    `<v:path textpathok="t" o:connecttype="custom" o:connectlocs="@9,0;@10,10800;@11,21600;@12,10800" o:connectangles="270,180,90,0"/>` +
    `<v:textpath on="t" fitshape="t"/>` +
    `<v:handles><v:h position="#0,bottomRight" xrange="0,21600"/></v:handles>` +
    `<o:lock v:ext="edit" text="t" shapetype="t"/>` +
    `</v:shapetype>` +
    `<v:shape id="PRISM_Watermark" o:spid="_x0000_s2049" type="#_x0000_t136" ` +
    `style="position:absolute;margin-left:0;margin-top:0;width:415pt;height:207.5pt;rotation:315;` +
    `z-index:-251654144;mso-position-horizontal:center;mso-position-horizontal-relative:margin;` +
    `mso-position-vertical:center;mso-position-vertical-relative:margin" ` +
    `o:allowincell="f" fillcolor="${color}" stroked="f">` +
    `<v:fill opacity="${opacity}"/>` +
    `<v:textpath style="font-family:&quot;Calibri&quot;;font-size:${fontSizePt}pt" string="${t}"/>` +
    `<w10:wrap anchorx="margin" anchory="margin"/>` +
    `</v:shape>` +
    `</pict></r></p>`;
}

const VML_NAMESPACES = ' xmlns:v="urn:schemas-microsoft-com:vml" xmlns:o="urn:schemas-microsoft-com:office:office" xmlns:w10="urn:schemas-microsoft-com:office:word"';

function addWatermarkToHeaderXml(headerXml, text) {
  if (!/<hdr[^>]*>/.test(headerXml)) throw new Error("unrecognised header XML — no <hdr> root");
  let out = headerXml.replace(/<hdr([^>]*)>/, (m, attrs) => `<hdr${attrs}${VML_NAMESPACES}>`);
  out = out.replace(/<\/hdr>/, `${watermarkParagraphXml(text)}</hdr>`);
  parseOrThrow(out, "header1.xml with watermark"); // throws if the splice broke well-formedness
  return out;
}

// ─── entry points ───────────────────────────────────────────────────────────

/**
 * Move the body's sectPr to be the last child of <w:body>, per the OOXML
 * schema — see moveSectPrToEnd above. Best-effort: returns the input buffer
 * unchanged (and logs) on any failure.
 * @param {Buffer} docxBuffer
 */
export async function fixSectionPropertiesOrder(docxBuffer) {
  try {
    const zip = await JSZip.loadAsync(docxBuffer);
    const path = "word/document.xml";
    const xml = await zip.file(path).async("string");
    const patched = moveSectPrToEnd(xml);
    parseOrThrow(patched, path);
    zip.file(path, patched);
    return await zip.generateAsync({ type: "nodebuffer" });
  } catch (err) {
    console.error("[self-assessment/docx] sectPr position not fixed:", err.message);
    return docxBuffer;
  }
}

/**
 * Rewrite fixed-width tables' column proportions to match the source HTML.
 * Best-effort: returns the input buffer unchanged (and logs) on any mismatch.
 * @param {Buffer} docxBuffer
 * @param {string} sourceHtml the exact HTML string passed to HTMLtoDOCX
 */
export async function fixTableColumnWidths(docxBuffer, sourceHtml) {
  try {
    const zip = await JSZip.loadAsync(docxBuffer);
    const path = "word/document.xml";
    const xml = await zip.file(path).async("string");
    const widths = extractColumnWidths(sourceHtml);
    const patched = applyColumnWidths(xml, widths);
    parseOrThrow(patched, path);
    zip.file(path, patched);
    return await zip.generateAsync({ type: "nodebuffer" });
  } catch (err) {
    console.error("[self-assessment/docx] table column widths not applied, tables keep equal columns:", err.message);
    return docxBuffer;
  }
}

/**
 * Add a diagonal text watermark to every page (via the header) of a generated
 * .docx. Best-effort: returns the input buffer unchanged (and logs) on failure —
 * never ships a file that fails to re-parse as well-formed XML.
 * @param {Buffer} docxBuffer
 * @param {string} text
 */
export async function addWatermark(docxBuffer, text) {
  try {
    const zip = await JSZip.loadAsync(docxBuffer);
    const headerPaths = Object.keys(zip.files).filter(p => /^word\/header\d+\.xml$/.test(p));
    if (!headerPaths.length) throw new Error("no header part in this .docx to add the watermark to");
    for (const path of headerPaths) {
      const xml = await zip.file(path).async("string");
      zip.file(path, addWatermarkToHeaderXml(xml, text));
    }
    return await zip.generateAsync({ type: "nodebuffer" });
  } catch (err) {
    console.error("[self-assessment/docx] watermark not applied:", err.message);
    return docxBuffer;
  }
}
