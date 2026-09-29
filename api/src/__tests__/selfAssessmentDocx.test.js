import { describe, test, expect, beforeAll } from "vitest";
import JSZip from "jszip";
import { buildSelfAssessmentReport } from "../utils/selfAssessmentReport.js";
import { buildReadinessDocx, docxHtmlFromDocument, DOCX_MIME } from "../utils/selfAssessmentDocx.js";

function sub(department, userEmail, answers) {
  return { department, userEmail, userName: userEmail, answers, submittedAt: new Date().toISOString() };
}

const submissions = [
  sub("IT", "it@co.com", { "it-1": "NO", "it-8": "NO", "it-12": "NO", "it-11": "NO", "it-15": "NO", "lg-6": "NO" }),
  sub("Legal", "lg@co.com", { "lg-2": "PARTIAL", "lg-3": "YES" }),
];

describe("docxHtmlFromDocument — the HTML transform", () => {
  const report = buildSelfAssessmentReport({ companyName: "Acme Ltd", submissions, aiExposureMappings: [], narrative: null });
  const html = docxHtmlFromDocument(report.document, { companyName: "Acme Ltd" });

  test("strips the browser-only furniture", () => {
    expect(html).not.toContain("PagedConfig");
    expect(html).not.toContain("<script");
    expect(html).not.toContain('class="watermark"');
    expect(html).not.toContain('class="toolbar');
    expect(html).not.toContain('class="running-header"');
  });

  test("keeps the report content", () => {
    expect(html).toContain("Acme Ltd");
    expect(html).toContain("Findings Register");
    expect(html).toContain("Annexure G");
    expect(html).toContain("Document Control");
  });

  test("inserts a page break before every section except the cover", () => {
    const sections = (html.match(/<section/g) || []).length;
    const breaks = (html.match(/page-break-after:always/g) || []).length;
    expect(sections).toBeGreaterThan(15);
    expect(breaks).toBe(sections - 1);
  });

  test("rasterises the inline <svg> charts to PNG <img>", () => {
    expect(html).not.toContain("<svg");
    // both dashboard charts become embedded PNGs (plus the cover logo → 3)
    expect((html.match(/<img [^>]*src="data:image\/png;base64,/g) || []).length).toBeGreaterThanOrEqual(3);
  });
});

describe("buildReadinessDocx — the .docx", () => {
  let buf, docXml;

  beforeAll(async () => {
    const report = buildSelfAssessmentReport({ companyName: "Acme Ltd", submissions, aiExposureMappings: [], narrative: null });
    buf = await buildReadinessDocx(report, { companyName: "Acme Ltd" });
    const zip = await JSZip.loadAsync(buf);
    docXml = await zip.file("word/document.xml").async("string");
  }, 30000);

  test("returns a non-trivial Buffer that is a valid docx zip", async () => {
    expect(Buffer.isBuffer(buf)).toBe(true);
    expect(buf.length).toBeGreaterThan(20_000);
    const zip = await JSZip.loadAsync(buf);
    expect(zip.file("word/document.xml")).toBeTruthy();
    expect(zip.file("word/header1.xml")).toBeTruthy();
    expect(zip.file("word/footer1.xml")).toBeTruthy();
  });

  test("carries the report content, tables and section page breaks", () => {
    expect(docXml).toContain("Acme Ltd");
    expect(docXml).toContain("Findings Register");
    expect(docXml).toContain("Annexure G");
    expect((docXml.match(/<w:tbl>/g) || []).length).toBeGreaterThan(25);
    expect((docXml.match(/<w:br w:type="page"\/>/g) || []).length).toBeGreaterThan(15);
  });

  test("running header names the company; footer has a page-number field", async () => {
    const zip = await JSZip.loadAsync(buf);
    const header = await zip.file("word/header1.xml").async("string");
    const footer = await zip.file("word/footer1.xml").async("string");
    expect(header).toContain("Acme Ltd");
    expect(footer).toContain("Neozaar Digital Private Limited");
    expect(footer).toContain("PAGE");
  });

  test("rejects a report with no document", async () => {
    await expect(buildReadinessDocx({})).rejects.toThrow(/document is required/);
  });

  test("exports the Word MIME type", () => {
    expect(DOCX_MIME).toBe("application/vnd.openxmlformats-officedocument.wordprocessingml.document");
  });

  // Regression for the real cause of a file Word refused to open (LibreOffice,
  // python-docx, textutil and xmllint all accepted it regardless): html-to-docx
  // writes `w:gutter="${margins.gutter}"` with no fallback of its own, so an
  // omitted key produced the literal string "undefined" in every document.
  test("page margins never carry the literal string \"undefined\" (html-to-docx's own gutter bug)", () => {
    expect(docXml).not.toMatch(/w:gutter="undefined"/);
    expect(docXml).toMatch(/w:gutter="\d+"/);
  });

  // Regression for the same investigation: html-to-docx's document.xml template
  // is <w:body><w:sectPr>...</w:sectPr></w:body>, with the real content then
  // IMPORTED after the already-present sectPr — landing it FIRST, in violation
  // of OOXML's CT_Body content model (final sectPr must be the body's LAST
  // child). Word enforced this strictly; nothing else tried did.
  test("the body's sectPr is its LAST child, not its first (OOXML CT_Body order)", () => {
    const bodyOpen = docXml.indexOf("<w:body>") + "<w:body>".length;
    const afterOpen = docXml.slice(bodyOpen, bodyOpen + 50);
    expect(afterOpen).not.toMatch(/^\s*<w:sectPr>/);

    const bodyClose = docXml.lastIndexOf("</w:body>");
    const beforeClose = docXml.slice(Math.max(0, bodyClose - 30), bodyClose);
    expect(beforeClose).toMatch(/<\/w:sectPr>\s*$/);
  });
});

describe("buildReadinessDocx — colour and layout fidelity", () => {
  let buf, docXml, header1Xml;

  beforeAll(async () => {
    const report = buildSelfAssessmentReport({ companyName: "Acme Ltd", submissions, aiExposureMappings: [], narrative: null });
    buf = await buildReadinessDocx(report, { companyName: "Acme Ltd" });
    const zip = await JSZip.loadAsync(buf);
    docXml = await zip.file("word/document.xml").async("string");
    header1Xml = await zip.file("word/header1.xml").async("string");
  }, 30000);

  test("a CSS-class-only colour (Yes/No/Partial answer badges) now carries an explicit <w:color> run property", () => {
    // it-15 fires NO in the fixture — its Annexure E badge is "No" (a-no, #B91C1C)
    expect(docXml).toMatch(/<w:color w:val="B91C1C"\/>[\s\S]{0,120}<w:t[^>]*>No<\/w:t>/);
  });

  test("severity/rating colours (already inline in the HTML) still survive, unaffected by the badge fix", () => {
    expect(docXml).toMatch(/<w:color w:val="B91C1C"\/>[\s\S]{0,120}<w:t[^>]*>Critical<\/w:t>/);
  });

  test("the Findings Register table's columns are NOT equal width (6/20/40/10/24%, not 20% each)", () => {
    const tables = [...docXml.matchAll(/<w:tbl>[\s\S]*?<\/w:tbl>/g)];
    const findingsTable = tables.find(t => t[0].includes(">Observation<"));
    const grid = findingsTable[0].match(/<w:tblGrid>[\s\S]*?<\/w:tblGrid>/)[0];
    const widths = [...grid.matchAll(/w:w="(\d+)"/g)].map(m => Number(m[1]));
    expect(new Set(widths).size).toBeGreaterThan(1); // not all equal
    // Observation (40%) should be roughly 4x the ID column (6%)
    expect(widths[2] / widths[0]).toBeGreaterThan(5);
    expect(widths[2] / widths[0]).toBeLessThan(8);
  });

  test("a table with NO declared widths (no colgroup) is left with its original equal columns", async () => {
    // Annexure D's document/status table has no widths param — must survive untouched
    const tables = [...docXml.matchAll(/<w:tbl>[\s\S]*?<\/w:tbl>/g)];
    const t = tables.find(t => t[0].includes(">Document<") && t[0].includes(">Status<"));
    expect(t).toBeTruthy();
  });

  test("header carries a VML watermark shape alongside the existing company-name text", () => {
    expect(header1Xml).toContain("Acme Ltd"); // the original header content is preserved
    expect(header1Xml).toContain("v:shape");
    expect(header1Xml).toContain("CONFIDENTIAL");
    expect(header1Xml).toContain('xmlns:v="urn:schemas-microsoft-com:vml"');
  });

  test("every part of the .docx is still well-formed XML after both post-processing passes", async () => {
    const { DOMParser } = await import("@xmldom/xmldom");
    const zip = await JSZip.loadAsync(buf);
    const errors = [];
    const parser = new DOMParser({ errorHandler: { warning: () => {}, error: (m) => errors.push(m), fatalError: (m) => errors.push(m) } });
    for (const path of ["word/document.xml", "word/header1.xml", "word/footer1.xml"]) {
      parser.parseFromString(await zip.file(path).async("string"), "text/xml");
    }
    expect(errors).toEqual([]);
  });

  test("a custom watermark string is used verbatim, and watermark: null/false skips it entirely", async () => {
    const report = buildSelfAssessmentReport({ companyName: "Acme Ltd", submissions, aiExposureMappings: [], narrative: null });
    const withText = await buildReadinessDocx(report, { companyName: "Acme Ltd", watermark: "DRAFT — NOT FOR DISTRIBUTION" });
    const zipA = await JSZip.loadAsync(withText);
    expect(await zipA.file("word/header1.xml").async("string")).toContain("DRAFT");

    const withoutMark = await buildReadinessDocx(report, { companyName: "Acme Ltd", watermark: null });
    const zipB = await JSZip.loadAsync(withoutMark);
    expect(await zipB.file("word/header1.xml").async("string")).not.toContain("v:shape");
  });
});

describe("docxPostProcess — fails soft, never returns a corrupt buffer", () => {
  test("fixTableColumnWidths returns the input unchanged if the source HTML doesn't match the docx's table count", async () => {
    const { fixTableColumnWidths } = await import("../utils/docxPostProcess.js");
    const report = buildSelfAssessmentReport({ companyName: "Acme Ltd", submissions, aiExposureMappings: [], narrative: null });
    const buf = await buildReadinessDocx(report, { companyName: "Acme Ltd", watermark: null });
    const out = await fixTableColumnWidths(buf, "<html>not the real source html, zero <table> tags</html>");
    expect(out).toBe(buf); // same buffer identity — nothing touched
  });

  test("addWatermark returns the input unchanged if there is no header part to patch", async () => {
    const { addWatermark } = await import("../utils/docxPostProcess.js");
    const notADocx = Buffer.from("PK\x03\x04not really a zip");
    const out = await addWatermark(notADocx, "CONFIDENTIAL");
    expect(out).toBe(notADocx);
  });

  test("fixSectionPropertiesOrder returns the input unchanged on an unparseable buffer", async () => {
    const { fixSectionPropertiesOrder } = await import("../utils/docxPostProcess.js");
    const notADocx = Buffer.from("PK\x03\x04not really a zip");
    const out = await fixSectionPropertiesOrder(notADocx);
    expect(out).toBe(notADocx);
  });

  test("fixSectionPropertiesOrder is a no-op (not a failure) when sectPr is already last", async () => {
    // Reproduces html-to-docx's own document.xml shape, but with sectPr already
    // correctly positioned — must be left exactly as-is, not treated as an error.
    const { fixSectionPropertiesOrder } = await import("../utils/docxPostProcess.js");
    const xml = `<?xml version="1.0"?><w:document xmlns:w="x"><w:body><w:p/><w:sectPr><w:pgSz/></w:sectPr></w:body></w:document>`;
    const zip = new JSZip();
    zip.file("word/document.xml", xml);
    const buf = await zip.generateAsync({ type: "nodebuffer" });
    const out = await fixSectionPropertiesOrder(buf);
    const outXml = await (await JSZip.loadAsync(out)).file("word/document.xml").async("string");
    expect(outXml).toBe(xml);
  });

  test("fixSectionPropertiesOrder moves a leading sectPr (html-to-docx's actual shape) to the end", async () => {
    const { fixSectionPropertiesOrder } = await import("../utils/docxPostProcess.js");
    const xml = `<?xml version="1.0"?><w:document xmlns:w="x"><w:body><w:sectPr><w:pgSz w:w="1"/></w:sectPr><w:p><w:r><w:t>hi</w:t></w:r></w:p></w:body></w:document>`;
    const zip = new JSZip();
    zip.file("word/document.xml", xml);
    const buf = await zip.generateAsync({ type: "nodebuffer" });
    const out = await fixSectionPropertiesOrder(buf);
    const outXml = await (await JSZip.loadAsync(out)).file("word/document.xml").async("string");
    expect(outXml).not.toMatch(/^<\?xml[^>]*>\s*<w:document[^>]*><w:body>\s*<w:sectPr>/);
    expect(outXml.indexOf("<w:sectPr>")).toBeGreaterThan(outXml.indexOf("<w:t>hi</w:t>"));
    expect(outXml.trim().endsWith("</w:sectPr></w:body></w:document>")).toBe(true);
  });
});
