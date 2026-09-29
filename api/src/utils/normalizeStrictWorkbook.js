import JSZip from "jszip";

/**
 * ExcelJS (4.x) only understands the *Transitional* OOXML flavour: it matches a
 * bare `<workbook>` root and the `http://schemas.openxmlformats.org/...` family
 * of namespaces. Files saved as "Strict Open XML Spreadsheet" (Excel's Save As
 * option), or emitted by generators that namespace-prefix the root element
 * (`<x:workbook>`), parse to an empty model and blow up downstream with
 * "Cannot read properties of undefined (reading 'sheets')".
 *
 * This best-effort pass rewrites a workbook buffer into the shape ExcelJS
 * expects: Strict namespace URIs → their Transitional equivalents, and any
 * prefix bound to the spreadsheetml main namespace collapsed to the default
 * namespace (so `<x:sheet>` becomes `<sheet>`). It does NOT convert Strict's
 * ISO-8601 date cells back to serial numbers — good enough for extracting text
 * (module/question imports, AI evidence read-through), not for numeric fidelity.
 *
 * @param {Buffer} buffer - raw .xlsx bytes
 * @returns {Promise<Buffer>} a normalised .xlsx buffer (re-zipped)
 */
export async function normalizeStrictWorkbook(buffer) {
  const MAIN_NS = "http://schemas.openxmlformats.org/spreadsheetml/2006/main";

  // Strict (purl.oclc.org) namespace URIs → Transitional (openxmlformats.org).
  const NS_REWRITES = [
    ["http://purl.oclc.org/ooxml/spreadsheetml/main", MAIN_NS],
    ["http://purl.oclc.org/ooxml/officeDocument/relationships", "http://schemas.openxmlformats.org/officeDocument/2006/relationships"],
    ["http://purl.oclc.org/ooxml/package/relationships", "http://schemas.openxmlformats.org/package/2006/relationships"],
    ["http://purl.oclc.org/ooxml/officeDocument/sharedTypes", "http://schemas.openxmlformats.org/officeDocument/2006/sharedTypes"],
    ["http://purl.oclc.org/ooxml/drawingml/main", "http://schemas.openxmlformats.org/drawingml/2006/main"],
    ["http://purl.oclc.org/ooxml/officeDocument/math", "http://schemas.openxmlformats.org/officeDocument/2006/math"],
    ["http://purl.oclc.org/ooxml/officeDocument/extendedProperties", "http://schemas.openxmlformats.org/officeDocument/2006/extended-properties"],
  ];

  const escapeRe = (s) => s.replace(/[.*+?^${}()|[\]\\/]/g, "\\$&");

  const src = await JSZip.loadAsync(buffer);
  const out = new JSZip();

  for (const [name, entry] of Object.entries(src.files)) {
    if (entry.dir) continue;

    if (!/\.(xml|rels)$/i.test(name)) {
      out.file(name, await entry.async("nodebuffer"));
      continue;
    }

    let xml = await entry.async("string");
    for (const [from, to] of NS_REWRITES) xml = xml.split(from).join(to);

    // Collapse every prefix bound to the spreadsheetml main namespace to the
    // default namespace, then drop that prefix from element and attribute names.
    const declRe = new RegExp(`\\sxmlns:([A-Za-z0-9_]+)="${escapeRe(MAIN_NS)}"`, "g");
    const prefixes = new Set();
    let m;
    while ((m = declRe.exec(xml))) prefixes.add(m[1]);

    for (const p of prefixes) {
      xml = xml.replace(new RegExp(`\\sxmlns:${p}="`, "g"), ' xmlns="');
      xml = xml.replace(new RegExp(`<${p}:`, "g"), "<").replace(new RegExp(`</${p}:`, "g"), "</");
      xml = xml.replace(new RegExp(`\\s${p}:([A-Za-z])`, "g"), " $1");
    }

    out.file(name, xml);
  }

  return out.generateAsync({ type: "nodebuffer" });
}
