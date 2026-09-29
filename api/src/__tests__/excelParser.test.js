import { describe, test, expect, afterEach } from "vitest";
import fs from "fs";
import os from "os";
import path from "path";
import { fileURLToPath } from "url";
import ExcelJS from "exceljs";
import { parseExcelImport, guessFrameworkKey } from "../utils/excelParser.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const tmpFiles = [];

function tmpPath(name) {
  const p = path.join(os.tmpdir(), `xp-${Date.now()}-${Math.random().toString(16).slice(2)}-${name}`);
  tmpFiles.push(p);
  return p;
}

afterEach(() => {
  while (tmpFiles.length) fs.rmSync(tmpFiles.pop(), { force: true });
});

async function writeValidWorkbook() {
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet("Sheet1");
  ws.addRow(["Module ID", "Question ID", "Question Text"]);
  ws.addRow(["P - Policies", "P-1", "Is there an information security policy?"]);
  const p = tmpPath("valid.xlsx");
  await wb.xlsx.writeFile(p);
  return p;
}

describe("parseExcelImport", () => {
  test("parses a normal .xlsx workbook", async () => {
    const p = await writeValidWorkbook();
    const parsed = await parseExcelImport(p);
    expect(parsed.questions).toHaveLength(1);
    expect(parsed.questions[0].quest_id).toBe("P-1");
    expect(parsed.modules).toHaveLength(1);
  });

  test("recovers a Strict Open XML Spreadsheet that ExcelJS can't read directly", async () => {
    // Fixture: workbook using the ISO-Strict namespace + a prefixed <x:workbook>
    // root — ExcelJS bails with a bare "reading 'sheets'"; the normaliser rescues it.
    // Header row: "Module ID" | "Question ID"; data row: "P - Policies" | "P-1".
    const fixture = path.join(__dirname, "fixtures", "strict-ooxml.xlsx");
    const parsed = await parseExcelImport(fixture);
    expect(parsed.questions).toHaveLength(1);
    expect(parsed.questions[0].quest_id).toBe("P-1");
    expect(parsed.questions[0].module_id).toBe("P - Policies");
    expect(parsed.modules).toHaveLength(1);
  });

  test("rejects a non-xlsx file saved with an .xlsx extension", async () => {
    const p = tmpPath("fake.xlsx");
    fs.writeFileSync(p, "col1,col2\n1,2\n");
    await expect(parseExcelImport(p)).rejects.toMatchObject({
      status: 400,
      message: expect.stringMatching(/not a readable \.xlsx workbook/i),
    });
  });

  test("rejects an unrecoverable workbook with an actionable 400", async () => {
    // A zip that looks like an xlsx but has a workbook.xml ExcelJS can't model
    // and the normaliser can't fix — the friendly Strict message still fires.
    const fixture = path.join(__dirname, "fixtures", "strict-unrecoverable.xlsx");
    await expect(parseExcelImport(fixture)).rejects.toMatchObject({
      status: 400,
      message: expect.stringMatching(/Strict Open XML Spreadsheet/i),
    });
  });
});

// ─── Cross-framework mapping fields ─────────────────────────────────────────

/**
 * Write a combined-format audit sheet with the given header row and data rows.
 */
async function writeSheet(headers, rows, name = "sheet.xlsx") {
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet("Audit Framework");
  ws.addRow(headers);
  for (const r of rows) ws.addRow(r);
  const p = tmpPath(name);
  await wb.xlsx.writeFile(p);
  return p;
}

describe("guessFrameworkKey", () => {
  test.each([
    ["PRISM_GDPR_Audit_Framework.xlsx", "GDPR"],
    ["PRISM_HIPAA_Audit_Framework.xlsx", "HIPAA"],
    ["PRISM_SOC2_TypeII_Audit_Framework.xlsx", "SOC2"],
    ["PRISM_PCI_DSS_v4.0.1_Audit_Framework.xlsx", "PCIDSS"],
    ["PRISM_CIS_Controls_v8.1_Audit_Framework.xlsx", "CIS"],
    ["PRISM_CERT-In_Audit_Framework.xlsx", "CERTIN"],
    ["PRISM_AWS_WAF_Audit_Framework.xlsx", "AWSWAF"],
    ["PRISM_Azure_WAF_Audit_Framework.xlsx", "AZUREWAF"],
    ["ISO 27001 controls.xlsx", "ISO27001"],
    ["SOC 2 / TSC Reference", "SOC2"],
    ["random spreadsheet.xlsx", null],
  ])("%s -> %s", (input, expected) => {
    expect(guessFrameworkKey(input)).toBe(expected);
  });
});

describe("parseExcelImport — framework mapping fields", () => {
  const HEADERS = [
    "Module Grouping", "Module ID", "Question ID", "Question Text", "Control Area",
    "GDPR Reference", "Owner", "Frequency", "Purpose / Description",
    "Audit-Ready Criteria", "Required Evidence",
  ];

  test("guesses framework from filename and splits multi-value clause refs", async () => {
    const p = await writeSheet(HEADERS, [
      ["PRISM", "G - Gov", "GDPR-Q001",
       "Is Accountability framework implemented, documented, and assigned to an owner?",
       "Accountability framework", "Art. 5(2), 24", "DPO", "Annual", "purpose",
       "criteria text", "policy pack"],
    ]);
    const parsed = await parseExcelImport(p, { originalName: "PRISM_GDPR_Audit_Framework.xlsx" });
    expect(parsed.frameworkGuess).toBe("GDPR");
    const q = parsed.questions[0];
    expect(q.control_references).toEqual(["Art. 5(2)", "24"]);
    expect(q.iso_reference).toBe("Art. 5(2), 24"); // raw kept for back-compat
    expect(q.level3_yes_criteria).toBe("criteria text"); // Audit-Ready Criteria folded
    expect(q.facet).toBe("IMPLEMENTED");
  });

  test("guesses framework from the clause-ref column header when filename is opaque", async () => {
    const p = await writeSheet(HEADERS, [
      ["PRISM", "G - Gov", "GDPR-Q002", "Can the org provide current, dated evidence for X?",
       "Accountability framework", "Art. 5(2)", "DPO", "Annual", "purpose", "crit", "ev"],
    ]);
    const parsed = await parseExcelImport(p, { originalName: "upload-123.xlsx" });
    expect(parsed.frameworkGuess).toBe("GDPR");
    expect(parsed.questions[0].facet).toBe("EVIDENCE");
  });

  test("collapse_group_key groups the 3 facets of one control, splits distinct controls", async () => {
    const p = await writeSheet(HEADERS, [
      ["PRISM", "G", "Q1", "Is X implemented, documented, and assigned to an owner?", "X", "A.1", "o", "f", "p", "c", "e"],
      ["PRISM", "G", "Q2", "Can the org provide current, dated evidence for X?", "X", "A.1", "o", "f", "p", "c", "e"],
      ["PRISM", "G", "Q3", "Is X periodically reviewed or tested?", "X", "A.1", "o", "f", "p", "c", "e"],
      ["PRISM", "G", "Q4", "Is Y implemented, documented, and assigned to an owner?", "Y", "A.2", "o", "f", "p", "c", "e"],
    ]);
    const parsed = await parseExcelImport(p, { originalName: "PRISM_GDPR_Audit_Framework.xlsx" });
    const [q1, q2, q3, q4] = parsed.questions;
    expect(q1.collapse_group_key).toBe(q2.collapse_group_key);
    expect(q1.collapse_group_key).toBe(q3.collapse_group_key);
    expect(q1.collapse_group_key).not.toBe(q4.collapse_group_key);
    expect([q1.facet, q2.facet, q3.facet]).toEqual(["IMPLEMENTED", "EVIDENCE", "REVIEWED"]);
  });

  test("handles the CIS column dialect (CIS Control / Audit ID / Audit Question / Safeguard)", async () => {
    const p = await writeSheet(
      ["Module Grouping", "CIS Control", "Audit ID", "Audit Question", "Safeguard / Control Area",
       "CIS v8.1 Reference", "Owner", "Frequency", "Purpose / Description", "Audit-Ready Criteria", "Required Evidence"],
      [["PRISM", "CIS 1 - Inventory", "CIS-Q001",
        "Is Enterprise asset inventory implemented, documented, and assigned to an owner?",
        "Enterprise asset inventory", "1.1", "IT", "Quarterly", "purpose", "crit", "CMDB"]],
    );
    const parsed = await parseExcelImport(p, { originalName: "PRISM_CIS_Controls_v8.1_Audit_Framework.xlsx" });
    const q = parsed.questions[0];
    expect(q.quest_id).toBe("CIS-Q001");
    expect(q.module_id).toBe("CIS 1 - Inventory");
    expect(q.control_area).toBe("Enterprise asset inventory");
    expect(q.baseline_question).toMatch(/Enterprise asset inventory/);
    expect(q.control_references).toEqual(["1.1"]);
  });

  test("does not over-split a parenthesised clause ref", async () => {
    const p = await writeSheet(
      HEADERS.map((h) => (h === "GDPR Reference" ? "HIPAA Reference" : h)),
      [["PRISM", "A", "HIP-Q001", "Is Security Management Process implemented, documented, and assigned?",
        "Security Management Process", "164.308(a)(1)", "Sec", "Ongoing", "p", "c", "e"]],
    );
    const parsed = await parseExcelImport(p, { originalName: "PRISM_HIPAA_Audit_Framework.xlsx" });
    expect(parsed.questions[0].control_references).toEqual(["164.308(a)(1)"]);
  });
});
