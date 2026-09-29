import fs from 'fs';
import crypto from 'crypto';
import ExcelJS from 'exceljs';
import { normalizeStrictWorkbook } from './normalizeStrictWorkbook.js';

/**
 * Parse an Excel workbook and extract modules + questions.
 *
 * Supports two formats:
 * 1. Combined format (single sheet): columns like "Module Grouping", "Module ID",
 *    "Question ID", "Question Text", etc. Modules are derived from unique Module IDs.
 * 2. Separate sheets: "Modules" sheet + "Questions" sheet with dedicated columns.
 *
 * @param {string} filePath - Path to the uploaded .xlsx file
 * @param {{ originalName?: string }} [opts] - originalName is the upload's real
 *   filename (multer stores a `Date.now()-` prefixed copy); used to guess the framework.
 * @returns {Promise<{ modules: object[], questions: object[], errors: string[], frameworkGuess: string|null }>}
 */
export async function parseExcelImport(filePath, opts = {}) {
  const workbook = await readWorkbook(filePath);
  const errors = [];

  const sheetNames = workbook.worksheets.map(ws => ws.name);

  // First-pass framework guess from the upload filename; combined-sheet parsing
  // refines it with the worksheet name and the clause-reference column header.
  const nameGuess = guessFrameworkKey(opts.originalName || '');

  // Check for separate "Modules" and "Questions" sheets
  const moduleSheetName = sheetNames.find(
    (name) => name.toLowerCase() === 'modules'
  );
  const questionSheetName = sheetNames.find(
    (name) => name.toLowerCase() === 'questions'
  );

  // If we have dedicated sheets, use the legacy parser
  if (moduleSheetName || questionSheetName) {
    const result = parseSeparateSheets(workbook, moduleSheetName, questionSheetName, errors);
    const guess = nameGuess || guessFrameworkKey(questionSheetName || moduleSheetName || '');
    decorateQuestions(result.questions, guess);
    return { ...result, frameworkGuess: guess };
  }

  // Otherwise, parse as combined format (single sheet with all data)
  return parseCombinedSheet(workbook, errors, { nameGuess });
}

/**
 * Read a workbook, transparently recovering from the "Strict Open XML
 * Spreadsheet" / namespace-prefixed shape ExcelJS can't parse. Any remaining
 * failure is rethrown as an actionable 400.
 */
async function readWorkbook(filePath) {
  const workbook = new ExcelJS.Workbook();
  try {
    await workbook.xlsx.readFile(filePath);
    return workbook;
  } catch (err) {
    if (/reading 'sheets'/.test(err?.message || "")) {
      try {
        const recovered = new ExcelJS.Workbook();
        await recovered.xlsx.load(await normalizeStrictWorkbook(fs.readFileSync(filePath)));
        return recovered;
      } catch {
        // normalisation didn't help — fall through to the friendly error
      }
    }
    throw translateWorkbookReadError(err);
  }
}

/**
 * Turn an opaque ExcelJS/JSZip parse failure into an actionable 400.
 *
 * The most common real-world offender is the "Strict Open XML Spreadsheet"
 * variant (and other generators that emit a namespace-prefixed `<x:workbook>`
 * root): ExcelJS's WorkbookXform only recognises a bare `<workbook>` element, so
 * it never builds a model and a later `model.sheets = workbook.sheets` in
 * exceljs throws "Cannot read properties of undefined (reading 'sheets')".
 */
function translateWorkbookReadError(err) {
  const clean = new Error();
  clean.status = 400;
  const msg = err && err.message ? String(err.message) : "";

  if (/reading 'sheets'/.test(msg)) {
    clean.message =
      'This file appears to be a "Strict Open XML Spreadsheet", which is not supported. ' +
      'Open it in Excel and use File → Save As → "Excel Workbook (.xlsx)" ' +
      '(not the "Strict" option), or re-export it from Google Sheets, then upload again.';
    return clean;
  }

  if (/end of central directory|is this a zip file|corrupted zip/i.test(msg)) {
    clean.message =
      "This file is not a readable .xlsx workbook — it may be corrupt, password-protected, " +
      "or a different format (e.g. .xls or .csv) saved with an .xlsx extension. " +
      'Re-save it as "Excel Workbook (.xlsx)" and try again.';
    return clean;
  }

  clean.message = `Could not read the Excel file: ${msg || "unknown error"}`;
  return clean;
}

/**
 * Parse a combined single-sheet format where each row is a question
 * and modules are derived from unique "Module ID" values.
 *
 * Expected columns (flexible matching):
 * - Module Grouping / module_grouping
 * - Module ID / module_id
 * - Question ID / quest_id / Question_ID
 * - Question Text / baseline_question
 * - Control Area / control_area
 * - ISO / Clause Reference / iso_reference
 * - Owner / default_owner
 * - Frequency / frequency
 * - Purpose / Description / purpose
 * - Level 3 Criteria / level3_yes_criteria
 * - Required Evidence / required_evidence
 */
function parseCombinedSheet(workbook, errors, { nameGuess = null } = {}) {
  const modules = [];
  const questions = [];
  const seenModules = new Map(); // module_id -> module object

  const worksheet = workbook.worksheets[0];
  if (!worksheet) {
    errors.push('No sheets found in workbook');
    return { modules, questions, errors, frameworkGuess: nameGuess };
  }

  const rows = sheetToJson(worksheet);

  // Framework guess: filename → worksheet name → (refined below) clause-ref header.
  let frameworkGuess = nameGuess || guessFrameworkKey(worksheet.name || '');
  let refHeaderSeen = null;

  for (let i = 0; i < rows.length; i++) {
    const row = rows[i];
    if (isEmptyRow(row)) continue;

    // Remove any empty-string keys (blank columns from Excel)
    const cleanRow = {};
    for (const [k, v] of Object.entries(row)) {
      if (k.trim()) cleanRow[k.trim()] = v;
    }

    // Extract module info. CIS renames Module ID -> "CIS Control".
    const moduleId = getField(cleanRow, [
      'Module ID', 'module_id', 'ModuleID', 'Module_ID', 'moduleId', 'CIS Control'
    ]);
    const moduleGrouping = getField(cleanRow, [
      'Module Grouping', 'module_grouping', 'ModuleGrouping', 'Module_Grouping'
    ]);

    // Extract question info. CIS renames Question ID -> "Audit ID",
    // Question Text -> "Audit Question", Control Area -> "Safeguard / Control Area".
    const questId = getField(cleanRow, [
      'Question ID', 'quest_id', 'QuestID', 'Quest_ID', 'questionId', 'Question_ID', 'Audit ID'
    ]);
    const questionText = getField(cleanRow, [
      'Question Text', 'baseline_question', 'BaselineQuestion', 'Baseline_Question', 'question_text', 'Audit Question'
    ]);
    const controlArea = getField(cleanRow, [
      'Control Area', 'control_area', 'ControlArea', 'Control_Area', 'Safeguard / Control Area'
    ]);
    const { value: isoRef, header: isoRefHeader } = findClauseRef(cleanRow);
    if (isoRefHeader && !refHeaderSeen) refHeaderSeen = isoRefHeader;
    const owner = getField(cleanRow, [
      'Owner', 'default_owner', 'DefaultOwner', 'Default_Owner'
    ]);
    const frequency = getField(cleanRow, [
      'Frequency', 'frequency'
    ]);
    const purpose = getField(cleanRow, [
      'Purpose / Description', 'Purpose/Description', 'purpose', 'Purpose', 'Description'
    ]);
    const level3Criteria = getField(cleanRow, [
      'Level 3 Criteria', 'level3_yes_criteria', 'Level3YesCriteria', 'Level3_Yes_Criteria', 'Level 3 Yes Criteria',
      'Audit-Ready Criteria', 'Audit Ready Criteria'
    ]);
    const requiredEvidence = getField(cleanRow, [
      'Required Evidence', 'required_evidence', 'RequiredEvidence', 'Required_Evidence'
    ]);
    const priority = getField(cleanRow, [
      'Priority', 'priority', 'Risk Level', 'risk_level', 'RiskLevel'
    ]);
    const tags = getField(cleanRow, [
      'Tags', 'tags', 'Labels', 'labels', 'Categories', 'categories'
    ]);

    if (!questId) {
      errors.push(`Row ${i + 2}: missing Question ID`);
      continue;
    }
    if (!moduleId) {
      errors.push(`Row ${i + 2}: missing Module ID`);
      continue;
    }

    // Derive module from row (deduplicate by module_id)
    const modIdStr = String(moduleId).trim();
    if (!seenModules.has(modIdStr)) {
      seenModules.set(modIdStr, {
        module_id: modIdStr,
        name: modIdStr, // Use module ID as name (e.g., "P - Policies & Governance")
        primary_owner: String(owner || '').trim(),
        frequency: String(frequency || '').trim(),
        total_quests: 0,
        purpose: String(purpose || '').trim(),
        module_grouping: String(moduleGrouping || '').trim(),
      });
    }
    // Increment question count for this module
    seenModules.get(modIdStr).total_quests++;

    // Add question
    questions.push({
      quest_id: String(questId).trim(),
      module_id: modIdStr,
      module_name: modIdStr,
      control_area: String(controlArea || '').trim(),
      iso_reference: String(isoRef || '').trim(),
      baseline_question: String(questionText || '').trim(),
      level3_yes_criteria: String(level3Criteria || '').trim(),
      required_evidence: String(requiredEvidence || '').trim(),
      default_owner: String(owner || '').trim(),
      frequency: String(frequency || '').trim(),
      priority: String(priority || '').trim(),
      tags: String(tags || '').trim(),
    });
  }

  // Convert modules map to array
  for (const mod of seenModules.values()) {
    modules.push(mod);
  }

  // Refine the framework guess from the clause-reference column header
  // (e.g. "GDPR Reference", "SOC 2 / TSC Reference") when name-based guessing failed.
  if (!frameworkGuess && refHeaderSeen) frameworkGuess = guessFrameworkKey(refHeaderSeen);

  decorateQuestions(questions, frameworkGuess);

  return { modules, questions, errors, frameworkGuess };
}

/**
 * Parse separate "Modules" and "Questions" sheets (legacy format).
 */
function parseSeparateSheets(workbook, moduleSheetName, questionSheetName, errors) {
  const modules = [];
  const questions = [];

  const moduleSheet = moduleSheetName ? workbook.getWorksheet(moduleSheetName) : null;
  const questionSheet = questionSheetName
    ? workbook.getWorksheet(questionSheetName)
    : (!moduleSheetName ? workbook.worksheets[0] : null);

  // Parse modules sheet
  if (moduleSheet) {
    const rows = sheetToJson(moduleSheet);
    for (let i = 0; i < rows.length; i++) {
      const row = rows[i];
      if (isEmptyRow(row)) continue;

      const moduleId = getField(row, ['module_id', 'ModuleID', 'Module_ID', 'moduleId', 'Module ID']);
      if (!moduleId) {
        errors.push(`Modules sheet row ${i + 2}: missing module_id`);
        continue;
      }

      modules.push({
        module_id: String(moduleId).trim(),
        name: String(getField(row, ['name', 'Name', 'module_name', 'ModuleName']) || '').trim(),
        primary_owner: String(getField(row, ['primary_owner', 'PrimaryOwner', 'primaryOwner', 'Owner']) || '').trim(),
        frequency: String(getField(row, ['frequency', 'Frequency']) || '').trim(),
        total_quests: parseInt(getField(row, ['total_quests', 'TotalQuests', 'totalQuests']) || 0),
        purpose: String(getField(row, ['purpose', 'Purpose', 'Purpose / Description']) || '').trim(),
      });
    }
  }

  // Parse questions sheet
  if (questionSheet) {
    const rows = sheetToJson(questionSheet);
    for (let i = 0; i < rows.length; i++) {
      const row = rows[i];
      if (isEmptyRow(row)) continue;

      const questId = getField(row, ['quest_id', 'QuestID', 'Quest_ID', 'questId', 'Question ID']);
      const moduleId = getField(row, ['module_id', 'ModuleID', 'Module_ID', 'moduleId', 'Module ID']);

      if (!questId) {
        errors.push(`Questions sheet row ${i + 2}: missing quest_id`);
        continue;
      }
      if (!moduleId) {
        errors.push(`Questions sheet row ${i + 2}: missing module_id`);
        continue;
      }

      questions.push({
        quest_id: String(questId).trim(),
        module_id: String(moduleId).trim(),
        module_name: String(getField(row, ['module_name', 'ModuleName', 'Module_Name']) || '').trim(),
        control_area: String(getField(row, ['control_area', 'ControlArea', 'Control Area']) || '').trim(),
        iso_reference: String(getField(row, ['iso_reference', 'ISOReference', 'ISO / Clause Reference']) || '').trim(),
        baseline_question: String(getField(row, ['baseline_question', 'BaselineQuestion', 'Question Text']) || '').trim(),
        level3_yes_criteria: String(getField(row, ['level3_yes_criteria', 'Level3YesCriteria', 'Level 3 Criteria']) || '').trim(),
        required_evidence: String(getField(row, ['required_evidence', 'RequiredEvidence', 'Required Evidence']) || '').trim(),
        default_owner: String(getField(row, ['default_owner', 'DefaultOwner', 'Owner']) || '').trim(),
        frequency: String(getField(row, ['frequency', 'Frequency']) || '').trim(),
        priority: String(getField(row, ['priority', 'Priority', 'Risk Level', 'risk_level']) || '').trim(),
        tags: String(getField(row, ['tags', 'Tags', 'Labels', 'labels', 'Categories']) || '').trim(),
      });
    }
  }

  return { modules, questions, errors };
}

/**
 * Convert an ExcelJS worksheet to an array of row objects, replicating
 * XLSX.utils.sheet_to_json(sheet, { defval: '' }): row 1 = headers,
 * subsequent rows = objects keyed by header, missing cells default to ''.
 */
function sheetToJson(worksheet) {
  const headers = [];
  const rows = [];

  worksheet.eachRow({ includeEmpty: true }, (row, rowNumber) => {
    if (rowNumber === 1) {
      row.eachCell({ includeEmpty: true }, (cell, colNumber) => {
        headers[colNumber] = getCellValue(cell);
      });
      return;
    }
    const obj = {};
    // Pre-fill all header keys with defval ''
    for (let c = 1; c < headers.length; c++) {
      const h = headers[c];
      if (h !== undefined && h !== '') obj[String(h)] = '';
    }
    row.eachCell({ includeEmpty: true }, (cell, colNumber) => {
      const h = headers[colNumber];
      if (h !== undefined && h !== '') {
        obj[String(h)] = getCellValue(cell);
      }
    });
    rows.push(obj);
  });

  return rows;
}

/**
 * Normalise an ExcelJS cell value to a plain JS primitive.
 * Formula cells return their cached result; null/undefined return ''.
 */
function getCellValue(cell) {
  const v = cell.value;
  if (v === null || v === undefined) return '';
  if (typeof v === 'object') {
    if (v instanceof Date) return v;
    if ('result' in v) return v.result ?? '';
    if ('richText' in v) return v.richText.map(t => t.text).join('');
    return String(v);
  }
  return v;
}

/**
 * Get a field value from a row using multiple possible header names.
 */
function getField(row, keys) {
  for (const key of keys) {
    if (row[key] !== undefined && row[key] !== '') {
      return row[key];
    }
  }
  return undefined;
}

/**
 * Check if a row is effectively empty.
 */
function isEmptyRow(row) {
  return Object.values(row).every(
    (val) => val === '' || val === undefined || val === null
  );
}

// ─── Framework / control mapping helpers ─────────────────────────────────────

// Header names for the clause-reference column, tried in order. The explicit
// per-framework dialects come first (they are unambiguous), then the generic
// legacy names.
const CLAUSE_REF_HEADERS = [
  'ISO / Clause Reference', 'ISO/Clause Reference',
  'AWS WAF Reference', 'Azure WAF Reference', 'CERT-In Reference',
  'CIS v8.1 Reference', 'GDPR Reference', 'HIPAA Reference',
  'PCI DSS v4.0.1 Reference', 'SOC 2 / TSC Reference',
  'iso_reference', 'ISOReference', 'ISO_Reference',
  'Clause Reference', 'Framework Reference', 'framework_reference',
];

// Columns that must never be treated as the clause-ref column by the generic
// fallback scan, even though some contain the word "Reference".
const CLAUSE_REF_EXCLUDE = new Set([
  'Module Grouping', 'Module ID', 'Question ID', 'Question Text', 'Control Area',
  'Owner', 'Frequency', 'Priority', 'Tags', 'Purpose / Description',
  'Level 3 Criteria', 'Audit-Ready Criteria', 'Required Evidence',
  'Assessment Status', 'Score', 'Gap / Observation', 'Remediation Owner',
  'Target Date', 'Control Type', 'Implementation Group',
  'CIS Control', 'Audit ID', 'Audit Question', 'Safeguard / Control Area',
]);

/**
 * Find the clause-reference cell for a row: explicit dialect headers first, then
 * a generic scan for a `* Reference` / `* Clause` column.
 * @returns {{ value: any, header: string|null }}
 */
function findClauseRef(row) {
  for (const key of CLAUSE_REF_HEADERS) {
    if (row[key] !== undefined && row[key] !== '') return { value: row[key], header: key };
  }
  for (const key of Object.keys(row)) {
    if (CLAUSE_REF_EXCLUDE.has(key)) continue;
    if (/\breference$/i.test(key) || /\bclause\b/i.test(key) || /\btsc reference\b/i.test(key)) {
      if (row[key] !== undefined && row[key] !== '') return { value: row[key], header: key };
    }
  }
  return { value: undefined, header: null };
}

/**
 * Split a clause-reference cell that lists several controls
 * (e.g. "Art. 5(2), 24" or "CC1.1, CC1.2" or "Sec 8 / Sec 10") into distinct refs.
 * Conservative: only splits on ";" or "/" or a comma that is NOT inside parentheses.
 */
export function splitRefs(raw) {
  const s = String(raw || '').trim();
  if (!s) return [];
  const parts = [];
  let buf = '';
  let depth = 0;
  for (const ch of s) {
    if (ch === '(') depth++;
    else if (ch === ')') depth = Math.max(0, depth - 1);
    if ((ch === ';' || ch === '/' || (ch === ',' && depth === 0))) {
      if (buf.trim()) parts.push(buf.trim());
      buf = '';
      continue;
    }
    buf += ch;
  }
  if (buf.trim()) parts.push(buf.trim());
  // dedupe, preserve order
  return [...new Set(parts.length ? parts : [s])];
}

/**
 * Classify which facet of a control a question row is asking about. Audit-ready
 * sheets emit ~3 near-identical rows per control; the facet lets us collapse them.
 */
function classifyFacet(text) {
  const t = String(text || '').toLowerCase();
  if (/rate\s+the\s+maturity|maturity\s+of\s+.+\s+on\s+a\s+0.?5/.test(t)) return 'MATURITY';
  if (/\bprovide\s+(current,?\s*)?(dated\s+)?evidence/.test(t)) return 'EVIDENCE';
  if (/dated\s+evidence\s+(that|demonstrating|for)\b/.test(t)) return 'EVIDENCE';
  if (/\bevidence\s+(be\s+)?(uploaded|linked|retriev)/.test(t)) return 'EVIDENCE';
  if (/periodically\s+reviewed|reviewed\s+periodically|reviewed\s+or\s+tested|tested\s+or\s+reviewed|reviewed\s+and\s+improved/.test(t)) return 'REVIEWED';
  if (/reviewed\s+(or\s+\w+\s+)?(at\s+the\s+)?(required|defined)\s+frequency/.test(t)) return 'REVIEWED';
  if (/implemented,?\s*(formally\s+)?documented,?\s*and\s+assigned/.test(t)) return 'IMPLEMENTED';
  if (/\bimplemented\s+and\s+(formally\s+)?documented/.test(t)) return 'IMPLEMENTED';
  if (/\bimplemented,?\s+operational\b|formally\s+implemented\s+and\s+operational/.test(t)) return 'IMPLEMENTED';
  return 'OTHER';
}

/**
 * Stable key grouping every sheet row that describes the same underlying control:
 * same framework + module + control area + first clause reference.
 */
function collapseGroupKey(frameworkGuess, moduleId, controlArea, firstRef) {
  return crypto
    .createHash('sha1')
    .update([
      String(frameworkGuess || ''),
      String(moduleId || '').trim().toLowerCase(),
      String(controlArea || '').trim().toLowerCase(),
      String(firstRef || '').trim().toLowerCase(),
    ].join('|'))
    .digest('hex');
}

// Ordered filename / sheet-name / header patterns → framework catalog key.
const FRAMEWORK_PATTERNS = [
  [/aws[^a-z]*waf|aws.*well.?architected/i, 'AWSWAF'],
  [/azure[^a-z]*waf|azure.*well.?architected/i, 'AZUREWAF'],
  [/cert[^a-z]*in/i, 'CERTIN'],
  [/\bcis\b|cis.*controls/i, 'CIS'],
  [/pci[^a-z]*dss|\bpci\b/i, 'PCIDSS'],
  [/\bgdpr\b/i, 'GDPR'],
  [/\bhipaa\b/i, 'HIPAA'],
  [/soc[^a-z]*2|\bsoc2\b|\btsc\b/i, 'SOC2'],
  [/iso[^a-z]*27001|\biso27001\b/i, 'ISO27001'],
  [/\bdpdpa?\b/i, 'DPDPA'],
];

/**
 * Guess a framework catalog key from a filename, worksheet name, or column header.
 * Returns null when nothing matches unambiguously.
 */
export function guessFrameworkKey(text) {
  // Normalise separators so word boundaries work in filenames like
  // "PRISM_HIPAA_Audit_Framework.xlsx" (underscore is a word char, so \bHIPAA\b
  // would never match without this).
  const s = String(text || '').replace(/[_.\-]+/g, ' ');
  for (const [re, key] of FRAMEWORK_PATTERNS) {
    if (re.test(s)) return key;
  }
  return null;
}

/**
 * Attach cross-framework mapping fields to each parsed question in place:
 *   control_references: string[]  — the clause ref cell split into distinct refs
 *   facet:              string    — IMPLEMENTED | EVIDENCE | REVIEWED | MATURITY | OTHER
 *   collapse_group_key: string    — groups the ~3 rows describing one control
 */
export function decorateQuestions(questions, frameworkGuess) {
  for (const q of questions) {
    const refs = splitRefs(q.iso_reference);
    q.control_references = refs;
    q.facet = classifyFacet(q.baseline_question);
    q.collapse_group_key = collapseGroupKey(
      frameworkGuess, q.module_id, q.control_area, refs[0] || ''
    );
  }
  return questions;
}
