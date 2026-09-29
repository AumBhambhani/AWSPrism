#!/usr/bin/env node
/**
 * One-off repair: module templates saved by the pre-2026-09 parser have no
 * framework_key and empty iso_reference on every question, so assigning them
 * created questions no framework owns (no company_frameworks row, no
 * question_framework_controls) — the dashboard's framework scope never saw them.
 *
 * For each such template with a matching sheet in sample-imports/:
 *   1. re-parse the sheet and refresh module_data / question_data / framework_key
 *   2. for every company assigned that template, backfill questions.iso_reference,
 *      modules.framework_key, company_frameworks and question_framework_controls
 *      (matched by quest_id; existing answers are untouched).
 *
 * Idempotent. Runs in one transaction.
 *   DATABASE_URL=postgresql://compliance:…@localhost:5433/compliance \
 *     node scripts/repairTemplateFrameworks.js [--dry-run]
 */
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { getClient } from "../src/db/index.js";
import { parseExcelImport } from "../src/utils/excelParser.js";

const DRY_RUN = process.argv.includes("--dry-run");
const SAMPLE_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../sample-imports");

const client = await getClient();
try {
  await client.query("BEGIN");

  const { rows: templates } = await client.query(
    `SELECT id, name, file_name FROM module_templates
     WHERE framework_key IS NULL
        OR NOT EXISTS (SELECT 1 FROM jsonb_array_elements(question_data) e
                       WHERE COALESCE(e->>'iso_reference', '') <> '')`
  );

  for (const tpl of templates) {
    const file = path.join(SAMPLE_DIR, tpl.file_name || "");
    if (!tpl.file_name || !fs.existsSync(file)) {
      console.log(`template #${tpl.id} "${tpl.name}": no sheet at ${file} — skipped`);
      continue;
    }

    const parsed = await parseExcelImport(file, { originalName: tpl.file_name });
    const frameworkKey = parsed.frameworkGuess;
    const withRef = parsed.questions.filter(q => q.iso_reference);
    if (!frameworkKey || withRef.length === 0) {
      console.log(`template #${tpl.id} "${tpl.name}": re-parse found no framework/refs — skipped`);
      continue;
    }

    await client.query(
      `UPDATE module_templates
       SET module_data = $1, question_data = $2, framework_key = $3, updated_at = NOW()
       WHERE id = $4`,
      [JSON.stringify(parsed.modules), JSON.stringify(parsed.questions), frameworkKey, tpl.id]
    );
    console.log(`template #${tpl.id} "${tpl.name}" → ${frameworkKey}, ${withRef.length}/${parsed.questions.length} questions with refs`);

    const refByQuest = new Map(withRef.map(q => [q.quest_id, q.iso_reference]));
    const moduleIds = [...new Set(parsed.modules.map(m => m.module_id))];

    const { rows: companies } = await client.query(
      "SELECT id, name FROM companies WHERE template_id = $1 ORDER BY id", [tpl.id]
    );
    for (const co of companies) {
      const { rows: present } = await client.query(
        "SELECT quest_id FROM questions WHERE company_id = $1 AND quest_id = ANY($2)",
        [co.id, [...refByQuest.keys()]]
      );
      if (present.length === 0) {
        console.log(`  company ${co.id} "${co.name}": none of this template's questions present — skipped`);
        continue;
      }

      await client.query(
        `INSERT INTO company_frameworks (company_id, framework_key) VALUES ($1, $2) ON CONFLICT DO NOTHING`,
        [co.id, frameworkKey]
      );
      const mods = await client.query(
        `UPDATE modules SET framework_key = $1, updated_at = NOW()
         WHERE company_id = $2 AND module_id = ANY($3) AND framework_key IS NULL`,
        [frameworkKey, co.id, moduleIds]
      );

      let mapped = 0;
      for (const { quest_id } of present) {
        const ref = refByQuest.get(quest_id);
        await client.query(
          `UPDATE questions SET iso_reference = $1
           WHERE company_id = $2 AND quest_id = $3 AND COALESCE(iso_reference, '') = ''`,
          [ref, co.id, quest_id]
        );
        const ins = await client.query(
          `INSERT INTO question_framework_controls (company_id, quest_id, framework_key, control_reference)
           VALUES ($1, $2, $3, $4)
           ON CONFLICT (company_id, quest_id, framework_key, control_reference) DO NOTHING
           RETURNING id`,
          [co.id, quest_id, frameworkKey, ref]
        );
        mapped += ins.rowCount;
      }
      console.log(`  company ${co.id} "${co.name}": ${present.length} questions matched, ${mapped} mappings added, ${mods.rowCount} modules tagged`);
    }
  }

  if (DRY_RUN) {
    await client.query("ROLLBACK");
    console.log("\n--dry-run: rolled back, nothing written");
  } else {
    await client.query("COMMIT");
    console.log("\ncommitted");
  }
} catch (err) {
  await client.query("ROLLBACK");
  console.error(err);
  process.exitCode = 1;
} finally {
  client.release();
  process.exit();
}
