/*
 * Zero-dependency export helpers shared by the dashboard export menus.
 * CSV + XML Spreadsheet 2003 (multi-sheet, opens in Excel / Sheets / Numbers).
 */

export function toCSV(rows) {
  return rows
    .map((r) => r.map((c) => `"${String(c ?? "").replace(/"/g, '""')}"`).join(","))
    .join("\n");
}

export function downloadBlob(filename, content, type) {
  const blob = new Blob([content], { type });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.style.display = "none";
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  setTimeout(() => URL.revokeObjectURL(url), 100);
}

export function xmlEsc(v) {
  return String(v ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

export function makeXmlSheet(name, rows) {
  const xmlRows = rows.map((row) => {
    const cells = row.map((cell) => {
      const val = cell ?? "";
      const isNum =
        typeof val === "number" ||
        (typeof val === "string" && val !== "" && !isNaN(Number(val)) && val.trim() !== "");
      const type = isNum ? "Number" : "String";
      const data = isNum ? val : xmlEsc(val);
      return `<Cell><Data ss:Type="${type}">${data}</Data></Cell>`;
    });
    return `<Row>${cells.join("")}</Row>`;
  });
  return `<Worksheet ss:Name="${xmlEsc(name)}"><Table>${xmlRows.join("")}</Table></Worksheet>`;
}

/** Wrap one or more `makeXmlSheet(...)` strings in an Excel workbook envelope. */
export function buildWorkbook(sheets) {
  return [
    `<?xml version="1.0" encoding="UTF-8"?>`,
    `<?mso-application progid="Excel.Sheet"?>`,
    `<Workbook xmlns="urn:schemas-microsoft-com:office:spreadsheet"`,
    ` xmlns:ss="urn:schemas-microsoft-com:office:spreadsheet"`,
    ` xmlns:x="urn:schemas-microsoft-com:office:excel">`,
    ...sheets,
    `</Workbook>`,
  ].join("\n");
}

export function slugify(s) {
  return String(s || "prism").trim().replace(/\s+/g, "-").toLowerCase();
}
