import fs from "fs";
import { normalizeStrictWorkbook } from "./normalizeStrictWorkbook.js";

// Shared evidence/policy file-content extraction, used by every AI provider so
// PDF/DOCX/XLSX/image handling stays identical regardless of which backend
// (Bedrock, Azure) actually runs the analysis.

const MAX_CONTENT_CHARS = 20000;

const IMAGE_TYPES = {
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  png: "image/png",
  gif: "image/gif",
  webp: "image/webp"
};

// Lazy singletons — imported once on first use, cached thereafter.
let _pdfParse, _xlsx, _mammoth;
async function getPdfParse() { return (_pdfParse ??= (await import("pdf-parse/lib/pdf-parse.js")).default); }
async function getExcelJS()  { return (_xlsx     ??= (await import("exceljs")).default); }
async function getMammoth()  { return (_mammoth  ??= (await import("mammoth")).default); }

export async function extractFileContent(filePath, fileExt) {
  if (["txt", "csv", "log", "json", "md", "html", "xml"].includes(fileExt)) {
    const content = fs.readFileSync(filePath, "utf8");
    return { type: "text", content: content.substring(0, MAX_CONTENT_CHARS) };
  }

  if (fileExt === "pdf") {
    const pdfParse = await getPdfParse();
    const buffer = fs.readFileSync(filePath);
    const data = await pdfParse(buffer);
    const text = data.text.trim().substring(0, MAX_CONTENT_CHARS);
    console.log(`[AI] Extracted ${text.length} chars from PDF (${data.numpages} pages)`);
    return { type: "text", content: text || "(PDF contained no extractable text)" };
  }

  if (["xlsx", "xlsm"].includes(fileExt)) {
    const ExcelJS = await getExcelJS();
    const wb = new ExcelJS.Workbook();
    try {
      await wb.xlsx.load(fs.readFileSync(filePath));
    } catch (err) {
      // ExcelJS can't read "Strict Open XML Spreadsheet" workbooks (namespace-prefixed
      // <x:workbook> root) — it throws a bare "reading 'sheets'". Retry once via a
      // Transitional-normalised copy before degrading.
      let recovered = false;
      if (/reading 'sheets'/.test(err?.message || "")) {
        try {
          await wb.xlsx.load(await normalizeStrictWorkbook(fs.readFileSync(filePath)));
          recovered = true;
        } catch { /* normalisation didn't help */ }
      }
      if (!recovered) {
        // Corrupt / encrypted / still-unreadable — degrade gracefully rather than
        // aborting the whole AI analysis.
        console.warn(`[AI] Could not read Excel file (${fileExt}): ${err?.message}`);
        return {
          type: "text",
          content: /reading 'sheets'/.test(err?.message || "")
            ? "(Excel file is in an unsupported \"Strict Open XML Spreadsheet\" format — analyzing based on filename and metadata only.)"
            : "(Excel file could not be read — it may be corrupt or password-protected. Analyzing based on filename and metadata only.)"
        };
      }
    }
    const sheets = wb.worksheets.map(ws => {
      const rows = [];
      ws.eachRow({ includeEmpty: true }, row => {
        const cells = [];
        row.eachCell({ includeEmpty: true }, cell => {
          let v = cell.value;
          if (v !== null && v !== undefined && typeof v === 'object') {
            if ('result' in v) v = v.result ?? '';
            else if ('richText' in v) v = v.richText.map(t => t.text).join('');
            else if (v instanceof Date) v = v.toISOString();
            else v = '';
          }
          const s = (v === null || v === undefined) ? '' : String(v);
          cells.push(s.includes(',') || s.includes('"') ? `"${s.replace(/"/g, '""')}"` : s);
        });
        rows.push(cells.join(','));
      });
      return `--- Sheet: ${ws.name} ---\n${rows.join('\n')}`;
    }).join("\n\n");
    const content = sheets.substring(0, MAX_CONTENT_CHARS);
    console.log(`[AI] Extracted ${content.length} chars from Excel (${wb.worksheets.length} sheets)`);
    return { type: "text", content };
  }

  if (fileExt === "docx") {
    const mammoth = await getMammoth();
    const result = await mammoth.extractRawText({ path: filePath });
    const content = result.value.trim().substring(0, MAX_CONTENT_CHARS);
    console.log(`[AI] Extracted ${content.length} chars from DOCX`);
    return { type: "text", content: content || "(DOCX contained no extractable text)" };
  }

  if (IMAGE_TYPES[fileExt]) {
    const buffer = fs.readFileSync(filePath);
    const base64 = buffer.toString("base64");
    console.log(`[AI] Loaded image (${fileExt}, ${Math.round(buffer.length / 1024)}KB) for vision`);
    return { type: "image", mediaType: IMAGE_TYPES[fileExt], base64 };
  }

  return { type: "text", content: `Unsupported file type: ${fileExt.toUpperCase()} — analyzing based on filename and metadata only.` };
}

export { MAX_CONTENT_CHARS, IMAGE_TYPES };
