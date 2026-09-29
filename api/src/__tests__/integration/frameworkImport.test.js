import { describe, test, expect, vi } from "vitest";
import request from "supertest";
import ExcelJS from "exceljs";
import app from "../../app.js";
import { createCompany, createUser, createSuperAdmin } from "../setup/helpers.js";
import { query } from "../../db/index.js";

vi.mock("../../utils/scanFile.js", () => ({
  scanFile: vi.fn().mockResolvedValue({ safe: true }),
  scanBuffer: vi.fn().mockResolvedValue({ safe: true }),
}));
vi.mock("../../utils/notifyReviewers.js", () => ({
  notifyReviewers: vi.fn().mockResolvedValue(undefined),
}));

const AUDIT_HEADERS = [
  "Module Grouping", "Module ID", "Question ID", "Question Text", "Control Area",
  "GDPR Reference", "Owner", "Frequency", "Purpose / Description",
  "Audit-Ready Criteria", "Required Evidence",
];

/** One control → 3 facet rows, matching the real audit-ready sheet shape. */
function controlRows(prefix, area, ref) {
  return [
    ["PRISM", "G - Governance", `${prefix}-Q1`,
     `Is ${area} implemented, documented, and assigned to an accountable owner?`, area, ref,
     "DPO", "Annual", "purpose", "criteria", "policy pack"],
    ["PRISM", "G - Governance", `${prefix}-Q2`,
     `Can the organization provide current, dated evidence demonstrating operation of ${area}?`, area, ref,
     "DPO", "Annual", "purpose", "criteria", "policy pack"],
    ["PRISM", "G - Governance", `${prefix}-Q3`,
     `Is ${area} periodically reviewed or tested?`, area, ref,
     "DPO", "Annual", "purpose", "criteria", "policy pack"],
  ];
}

async function sheetBuffer(headers, rows) {
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet("GDPR Audit Framework");
  ws.addRow(headers);
  for (const r of rows) ws.addRow(r);
  return wb.xlsx.writeBuffer();
}

describe("framework import — superadmin", () => {
  test("import-modules with frameworkKey activates the framework and maps controls", async () => {
    const company = await createCompany({ domain: `fw-import-${Date.now()}.com` });
    const sa = await createSuperAdmin();

    const buf = await sheetBuffer(AUDIT_HEADERS, [
      ...controlRows("ACC", "Accountability framework", "Art. 5(2), 24"),
      ...controlRows("POL", "Data protection policies", "Art. 24"),
    ]);

    const res = await request(app)
      .post("/api/superadmin/import-modules")
      .set("Authorization", `Bearer ${sa.token}`)
      .attach("file", Buffer.from(buf), { filename: "PRISM_GDPR_Audit_Framework.xlsx" })
      .field("companyId", String(company.id))
      .field("frameworkKey", "GDPR");

    expect(res.status).toBe(200);
    expect(res.body.questionsImported).toBe(6);

    const cf = await query(
      "SELECT framework_key FROM company_frameworks WHERE company_id = $1",
      [company.id]
    );
    expect(cf.rows.map(r => r.framework_key)).toEqual(["GDPR"]);

    const qfc = await query(
      `SELECT DISTINCT control_reference FROM question_framework_controls
       WHERE company_id = $1 AND framework_key = 'GDPR' ORDER BY control_reference`,
      [company.id]
    );
    // iso_reference is stored raw at this phase; both controls mapped.
    expect(qfc.rows.map(r => r.control_reference)).toEqual(["Art. 24", "Art. 5(2), 24"]);

    const qs = await query("SELECT COUNT(*)::int AS n FROM questions WHERE company_id = $1", [company.id]);
    expect(qs.rows[0].n).toBe(6);
  });

  test("importing the same sheet twice is idempotent (no duplicate questions)", async () => {
    const company = await createCompany({ domain: `fw-import2-${Date.now()}.com` });
    const sa = await createSuperAdmin();
    const buf = await sheetBuffer(AUDIT_HEADERS, controlRows("ACC", "Accountability framework", "Art. 5(2)"));

    for (let i = 0; i < 2; i++) {
      const res = await request(app)
        .post("/api/superadmin/import-modules")
        .set("Authorization", `Bearer ${sa.token}`)
        .attach("file", Buffer.from(buf), { filename: "PRISM_GDPR_Audit_Framework.xlsx" })
        .field("companyId", String(company.id))
        .field("frameworkKey", "GDPR");
      expect(res.status).toBe(200);
    }
    const qs = await query("SELECT COUNT(*)::int AS n FROM questions WHERE company_id = $1", [company.id]);
    expect(qs.rows[0].n).toBe(3);
  });

  test("rejects an unknown framework key", async () => {
    const sa = await createSuperAdmin();
    const buf = await sheetBuffer(AUDIT_HEADERS, controlRows("ACC", "Accountability framework", "Art. 5(2)"));
    const res = await request(app)
      .post("/api/superadmin/import-modules")
      .set("Authorization", `Bearer ${sa.token}`)
      .attach("file", Buffer.from(buf), { filename: "sheet.xlsx" })
      .field("companyId", "1")
      .field("frameworkKey", "NOPE");
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/Unknown framework/i);
  });

  test("preview-import returns a framework guess from the filename", async () => {
    const sa = await createSuperAdmin();
    const buf = await sheetBuffer(AUDIT_HEADERS, controlRows("ACC", "Accountability framework", "Art. 5(2)"));
    const res = await request(app)
      .post("/api/superadmin/preview-import")
      .set("Authorization", `Bearer ${sa.token}`)
      .attach("file", Buffer.from(buf), { filename: "PRISM_GDPR_Audit_Framework.xlsx" });
    expect(res.status).toBe(200);
    expect(res.body.frameworkGuess).toBe("GDPR");
  });

  test("import-modules without frameworkKey falls back to the detected framework", async () => {
    const company = await createCompany({ domain: `fw-guess-${Date.now()}.com` });
    const sa = await createSuperAdmin();
    const buf = await sheetBuffer(AUDIT_HEADERS, controlRows("ACC", "Accountability framework", "Art. 5(2), 24"));

    const res = await request(app)
      .post("/api/superadmin/import-modules")
      .set("Authorization", `Bearer ${sa.token}`)
      .attach("file", Buffer.from(buf), { filename: "PRISM_GDPR_Audit_Framework.xlsx" })
      .field("companyId", String(company.id));
    expect(res.status).toBe(200);

    const cf = await query("SELECT framework_key FROM company_frameworks WHERE company_id = $1", [company.id]);
    expect(cf.rows.map(r => r.framework_key)).toEqual(["GDPR"]);
    const qfc = await query(
      "SELECT COUNT(DISTINCT quest_id)::int AS n FROM question_framework_controls WHERE company_id = $1 AND framework_key = 'GDPR'",
      [company.id]
    );
    expect(qfc.rows[0].n).toBe(3);
  });

  test("assigning a template with no framework mapping is refused", async () => {
    const company = await createCompany({ domain: `fw-stale-${Date.now()}.com` });
    const sa = await createSuperAdmin();
    const tpl = await query(
      `INSERT INTO module_templates (name, description, file_name, module_data, question_data)
       VALUES ('stale', '', 'stale.xlsx', $1, $2) RETURNING id`,
      [JSON.stringify([{ module_id: "G - Governance", name: "G - Governance" }]),
       JSON.stringify([{ quest_id: "STALE-Q1", module_id: "G - Governance", iso_reference: "", baseline_question: "q?" }])]
    );

    const res = await request(app)
      .post(`/api/superadmin/templates/${tpl.rows[0].id}/assign`)
      .set("Authorization", `Bearer ${sa.token}`)
      .send({ companyId: company.id });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/no framework mapping/i);

    const qs = await query("SELECT COUNT(*)::int AS n FROM questions WHERE company_id = $1", [company.id]);
    expect(qs.rows[0].n).toBe(0);
  });
});

describe("framework import — stage / cluster / review / commit (PRISM_AI_PROVIDER=none)", () => {
  async function stageBatch(sa, name, rows) {
    const buf = await sheetBuffer(AUDIT_HEADERS, rows);
    const res = await request(app)
      .post("/api/frameworks/import/batches")
      .set("Authorization", `Bearer ${sa.token}`)
      .attach("file", Buffer.from(buf), { filename: name });
    expect(res.status).toBe(201);
    return res.body;
  }

  async function decideAll(sa, batchId) {
    const detail = await request(app)
      .get(`/api/frameworks/import/batches/${batchId}`)
      .set("Authorization", `Bearer ${sa.token}`);
    expect(detail.status).toBe(200);
    for (const cl of detail.body.clusters) {
      const r = await request(app)
        .patch(`/api/frameworks/import/batches/${batchId}/clusters/${cl.id}`)
        .set("Authorization", `Bearer ${sa.token}`)
        .send({ decision: "ACCEPT" });
      expect(r.status).toBe(200);
    }
  }

  test("GDPR sheet: 3 facet rows collapse to one canonical, multi-ref fans out, template written", async () => {
    const sa = await createSuperAdmin();
    const staged = await stageBatch(sa, "PRISM_GDPR_Audit_Framework.xlsx", [
      ...controlRows("ACC", "Accountability framework", "Art. 5(2), 24"),
      ...controlRows("POL", "Data protection policies", "Art. 24"),
    ]);
    expect(staged.frameworkKey).toBe("GDPR");
    expect(staged.counts.controls).toBe(2); // 6 rows -> 2 controls

    const clustered = await request(app)
      .post(`/api/frameworks/import/batches/${staged.batchId}/cluster`)
      .set("Authorization", `Bearer ${sa.token}`);
    expect(clustered.status).toBe(200);
    expect(clustered.body.status).toBe("REVIEW");

    await decideAll(sa, staged.batchId);

    const commit = await request(app)
      .post(`/api/frameworks/import/batches/${staged.batchId}/commit`)
      .set("Authorization", `Bearer ${sa.token}`);
    expect(commit.status).toBe(200);
    expect(commit.body.summary.canonicalCreated).toBe(2);

    const canon = await query("SELECT quest_id, baseline_question FROM questions WHERE company_id IS NULL ORDER BY quest_id");
    expect(canon.rows).toHaveLength(2);
    expect(canon.rows[0].baseline_question).toMatch(/implemented, operating effectively/i);

    const qfc = await query(
      "SELECT quest_id, framework_key, control_reference FROM question_framework_controls WHERE company_id IS NULL ORDER BY control_reference"
    );
    // "Art. 5(2), 24" comma-splits to ["Art. 5(2)", "24"]; "Art. 24" stays whole.
    expect(qfc.rows.map(r => r.control_reference).sort()).toEqual(["24", "Art. 24", "Art. 5(2)"]);
    expect(new Set(qfc.rows.map(r => r.framework_key))).toEqual(new Set(["GDPR"]));

    const tpl = await query("SELECT name, question_data FROM module_templates WHERE framework_key = 'GDPR'");
    expect(tpl.rows).toHaveLength(1);
    expect(tpl.rows[0].name).toMatch(/canonical/i);
    const qd = typeof tpl.rows[0].question_data === "string" ? JSON.parse(tpl.rows[0].question_data) : tpl.rows[0].question_data;
    expect(qd[0].canonical).toBe(true);
    expect(qd[0].controls.length).toBeGreaterThan(0);
  });

  test("second framework merges into an existing canonical when hand-decided", async () => {
    const sa = await createSuperAdmin();

    // Seed a canonical directly (as a prior GDPR commit would have).
    await query(
      `INSERT INTO questions (quest_id, company_id, module_id, control_area, baseline_question, priority)
       VALUES ('CANON-ACC', NULL, 'G', 'Accountability framework', 'Is accountability governed?', 'Medium')`
    );
    await query(
      `INSERT INTO question_framework_controls (company_id, quest_id, framework_key, control_reference)
       VALUES (NULL, 'CANON-ACC', 'GDPR', 'Art. 5(2)')`
    );

    const staged = await stageBatch(sa, "PRISM_SOC2_TypeII_Audit_Framework.xlsx",
      controlRows("SC", "Accountability framework", "CC1.1"));
    // filename guesses SOC2 but our rows use "Accountability framework" wording:
    expect(["SOC2"]).toContain(staged.frameworkKey);

    await request(app).post(`/api/frameworks/import/batches/${staged.batchId}/cluster`).set("Authorization", `Bearer ${sa.token}`);

    const detail = await request(app)
      .get(`/api/frameworks/import/batches/${staged.batchId}`)
      .set("Authorization", `Bearer ${sa.token}`);
    const cluster = detail.body.clusters[0];
    const r = await request(app)
      .patch(`/api/frameworks/import/batches/${staged.batchId}/clusters/${cluster.id}`)
      .set("Authorization", `Bearer ${sa.token}`)
      .send({ decision: "MODIFIED", action: "MERGE_INTO_EXISTING", existingQuestId: "CANON-ACC" });
    expect(r.status).toBe(200);

    const commit = await request(app)
      .post(`/api/frameworks/import/batches/${staged.batchId}/commit`)
      .set("Authorization", `Bearer ${sa.token}`);
    expect(commit.status).toBe(200);
    expect(commit.body.summary.merged).toBe(1);

    const canon = await query("SELECT COUNT(*)::int AS n FROM questions WHERE company_id IS NULL");
    expect(canon.rows[0].n).toBe(1); // no new canonical row

    const maps = await query(
      "SELECT framework_key FROM question_framework_controls WHERE company_id IS NULL AND quest_id = 'CANON-ACC' ORDER BY framework_key"
    );
    expect(maps.rows.map(m => m.framework_key)).toEqual(["GDPR", "SOC2"]);
  });

  test("reconcile: bulk-merges existing framework templates into one canonical set", async () => {
    const sa = await createSuperAdmin();

    // Two legacy framework templates for the same underlying control.
    await query(
      `INSERT INTO module_templates (name, module_data, question_data, framework_key)
       VALUES ('GDPR set', $1, $2, 'GDPR')`,
      [JSON.stringify([{ module_id: "G", name: "G" }]),
       JSON.stringify([{ quest_id: "GDPR-Q1", module_id: "G", control_area: "Access control",
         baseline_question: "Is access control governed?", iso_reference: "Art. 32" }])]
    );
    await query(
      `INSERT INTO module_templates (name, module_data, question_data, framework_key)
       VALUES ('SOC2 set', $1, $2, 'SOC2')`,
      [JSON.stringify([{ module_id: "S", name: "S" }]),
       JSON.stringify([{ quest_id: "SC-Q1", module_id: "S", control_area: "Access control",
         baseline_question: "Is logical access controlled?", iso_reference: "CC6.1" }])]
    );

    const r = await request(app).post("/api/frameworks/reconcile")
      .set("Authorization", `Bearer ${sa.token}`).send({});
    expect(r.status).toBe(201);
    expect(r.body.kind).toBe("RECONCILE");
    expect(r.body.counts.controls).toBe(2);

    await request(app).post(`/api/frameworks/import/batches/${r.body.batchId}/cluster`)
      .set("Authorization", `Bearer ${sa.token}`);
    // deterministic clusterer groups the two "Access control" rows into one
    const detail = await request(app).get(`/api/frameworks/import/batches/${r.body.batchId}`)
      .set("Authorization", `Bearer ${sa.token}`);
    expect(detail.body.clusters).toHaveLength(1);
    expect(detail.body.clusters[0].members).toHaveLength(2);

    await request(app).patch(`/api/frameworks/import/batches/${r.body.batchId}/clusters/${detail.body.clusters[0].id}`)
      .set("Authorization", `Bearer ${sa.token}`).send({ decision: "ACCEPT" });
    const commit = await request(app).post(`/api/frameworks/import/batches/${r.body.batchId}/commit`)
      .set("Authorization", `Bearer ${sa.token}`);
    expect(commit.status).toBe(200);
    expect(commit.body.summary.canonicalCreated).toBe(1);

    const maps = await query(
      "SELECT framework_key FROM question_framework_controls WHERE company_id IS NULL ORDER BY framework_key"
    );
    expect(maps.rows.map(m => m.framework_key)).toEqual(["GDPR", "SOC2"]);

    // Both frameworks got a canonical template pointing at the same quest_id.
    const tpls = await query("SELECT framework_key, question_data FROM module_templates WHERE name LIKE '%(canonical)%' ORDER BY framework_key");
    expect(tpls.rows.map(t => t.framework_key)).toEqual(["GDPR", "SOC2"]);
    const gdprQ = (typeof tpls.rows[0].question_data === "string" ? JSON.parse(tpls.rows[0].question_data) : tpls.rows[0].question_data)[0];
    const soc2Q = (typeof tpls.rows[1].question_data === "string" ? JSON.parse(tpls.rows[1].question_data) : tpls.rows[1].question_data)[0];
    expect(gdprQ.quest_id).toBe(soc2Q.quest_id);
  });

  test("provisionTemplate instantiates a canonical template into a company with per-company qfc", async () => {
    const sa = await createSuperAdmin();
    const staged = await stageBatch(sa, "PRISM_GDPR_Audit_Framework.xlsx",
      controlRows("ACC", "Accountability framework", "Art. 5(2)"));
    await request(app).post(`/api/frameworks/import/batches/${staged.batchId}/cluster`).set("Authorization", `Bearer ${sa.token}`);
    await decideAll(sa, staged.batchId);
    await request(app).post(`/api/frameworks/import/batches/${staged.batchId}/commit`).set("Authorization", `Bearer ${sa.token}`);

    const tpl = await query("SELECT id FROM module_templates WHERE framework_key = 'GDPR' LIMIT 1");
    const company = await createCompany({ domain: `prov-${Date.now()}.com` });
    const assign = await request(app)
      .post(`/api/superadmin/templates/${tpl.rows[0].id}/assign`)
      .set("Authorization", `Bearer ${sa.token}`)
      .send({ companyId: company.id });
    expect(assign.status).toBe(200);

    const cf = await query("SELECT framework_key FROM company_frameworks WHERE company_id = $1", [company.id]);
    expect(cf.rows.map(r => r.framework_key)).toEqual(["GDPR"]);
    const qfc = await query(
      "SELECT quest_id, framework_key FROM question_framework_controls WHERE company_id = $1", [company.id]
    );
    expect(qfc.rows.length).toBeGreaterThan(0);
    expect(qfc.rows[0].framework_key).toBe("GDPR");
  });
});

describe("evidence AI analysis on the shared vault item", () => {
  // perTest truncates before every test, so each test builds its own fixture.
  async function seedEvidence(domain) {
    const company = await createCompany({ domain });
    const admin = await createUser(company.id, "ADMIN");
    // AI is opt-in per company — enable it for the analysis endpoints under test.
    await query(
      `INSERT INTO company_settings (company_id, ai_enabled) VALUES ($1, TRUE)
       ON CONFLICT (company_id) DO UPDATE SET ai_enabled = TRUE`,
      [company.id]
    );
    await query(`INSERT INTO modules (module_id, company_id, name) VALUES ('M1', $1, 'Module 1')`, [company.id]);
    await query(
      `INSERT INTO questions (quest_id, company_id, module_id, control_area, baseline_question, required_evidence, priority)
       VALUES ('Q-EV-1', $1, 'M1', 'Access control', 'Is access reviewed?', 'Access review report', 'Medium')`,
      [company.id]
    );
    const up = await request(app)
      .post("/api/evidence")
      .set("Authorization", `Bearer ${admin.token}`)
      .attach("file", Buffer.from("access review Q1 2026"), { filename: "review.txt", contentType: "text/plain" })
      .field("questId", "Q-EV-1")
      .field("moduleId", "M1");
    expect(up.status).toBe(201);
    const v = await query("SELECT id FROM evidence_vault WHERE legacy_evidence_id = $1", [up.body.id]);
    return { company, admin, questId: "Q-EV-1", evidenceId: up.body.id, vaultId: v.rows[0].id };
  }

  test("POST /api/vault/:id/analyze writes analysis onto the vault row and GET /api/evidence surfaces it", async () => {
    const { admin, questId, evidenceId, vaultId } = await seedEvidence(`ev-ai-1-${Date.now()}.com`);

    const res = await request(app)
      .post(`/api/vault/${vaultId}/analyze`)
      .set("Authorization", `Bearer ${admin.token}`);
    expect(res.status).toBe(200);
    expect(res.body.aiReviewerComments).toMatch(/manual review/i);
    expect(res.body.aiAnalyzedAt).toBeTruthy();

    // evidence.ai_* is untouched; the vault row carries the analysis.
    const ev = await query("SELECT ai_reviewer_comments FROM evidence WHERE id = $1", [evidenceId]);
    expect(ev.rows[0].ai_reviewer_comments).toBeNull();

    const list = await request(app)
      .get(`/api/evidence?questId=${questId}`)
      .set("Authorization", `Bearer ${admin.token}`);
    expect(list.status).toBe(200);
    const rec = list.body.find(r => r.id === evidenceId);
    expect(rec.aiReviewerComments).toMatch(/manual review/i); // COALESCE from the vault
  });

  test("POST /api/evidence/:id/analyze dual-writes evidence + vault", async () => {
    const { admin, evidenceId, vaultId } = await seedEvidence(`ev-ai-2-${Date.now()}.com`);

    const res = await request(app)
      .post(`/api/evidence/${evidenceId}/analyze`)
      .set("Authorization", `Bearer ${admin.token}`);
    expect(res.status).toBe(200);
    expect(res.body.aiReviewerComments).toMatch(/manual review/i);

    const [ev, vault] = await Promise.all([
      query("SELECT ai_reviewer_comments FROM evidence WHERE id = $1", [evidenceId]),
      query("SELECT ai_analyzed_at FROM evidence_vault WHERE id = $1", [vaultId]),
    ]);
    expect(ev.rows[0].ai_reviewer_comments).toMatch(/manual review/i);
    expect(vault.rows[0].ai_analyzed_at).toBeTruthy();
  });
});
