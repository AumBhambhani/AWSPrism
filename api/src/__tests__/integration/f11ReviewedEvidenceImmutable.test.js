import { describe, expect, test, vi } from "vitest";
import request from "supertest";
import app from "../../app.js";
import { query } from "../../db/index.js";
import { createCompany, createUser } from "../setup/helpers.js";

vi.mock("../../utils/scanFile.js", () => ({
  scanFile: vi.fn().mockResolvedValue({ safe: true }),
  scanBuffer: vi.fn().mockResolvedValue({ safe: true }),
}));
vi.mock("../../utils/email.js", () => ({
  sendEmail: vi.fn().mockResolvedValue(undefined),
  sendInvitationEmail: vi.fn().mockResolvedValue(undefined),
}));

// F-11 — evidence behind an approved control must not be replaced silently.
//   AUDITED  -> locked (409 LOCKED), content unchanged.
//   FINISHED -> change allowed, control reopened for review (Submitted + auto-revert reason).

const V1 = "approved evidence body v1";
const V2 = "changed content after approval";
const MONTH = new Date().toISOString().slice(0, 7);

async function setup(reviewStatus) {
  const suffix = `${Date.now()}-${Math.random().toString(16).slice(2)}`;
  const company = await createCompany({ domain: `f11-${suffix}.test` });
  const lead = await createUser(company.id, "LEAD", { email: `lead-${suffix}@f11.test` });
  const contributor = await createUser(company.id, "CONTRIBUTOR", { email: `c-${suffix}@f11.test` });
  const auditor = await createUser(company.id, "AUDITOR", { email: `a-${suffix}@f11.test` });
  await query(
    `INSERT INTO auditor_profiles (user_id, company_id, start_date, expiry_date, active)
     VALUES ($1, $2, CURRENT_DATE - 1, CURRENT_DATE + 30, TRUE)`,
    [auditor.id, company.id]
  );
  await query(
    `INSERT INTO questions (quest_id, company_id, module_id, module_name, control_area, baseline_question)
     VALUES ('Q-F11', $1, 'M-F11', 'Access', 'Access control', 'Is access reviewed?')`,
    [company.id]
  );
  const up = await request(app)
    .post("/api/vault")
    .set("Authorization", `Bearer ${contributor.token}`)
    .attach("file", Buffer.from(V1), { filename: "policy.txt", contentType: "text/plain" })
    .field("title", "Access policy");
  expect(up.status).toBe(201);
  const vaultId = up.body.id;
  await query("INSERT INTO question_evidence (company_id, quest_id, vault_id, linked_by) VALUES ($1, 'Q-F11', $2, 'seed')", [company.id, vaultId]);
  const { rows } = await query(
    `INSERT INTO assessments (company_id, quest_id, module_id, month, answer, review_status, reviewed_by, audited_by, reviewed_at, audited_at)
     VALUES ($1, 'Q-F11', 'M-F11', $2, 'IMPLEMENTED', $3, $4, $5, NOW(), $6) RETURNING id`,
    [company.id, MONTH, reviewStatus, lead.email, reviewStatus === "AUDITED" ? auditor.email : null, reviewStatus === "AUDITED" ? new Date() : null]
  );
  // Approval stamps a minute in the past, so rows a test creates "after the audit" are
  // unambiguously later (Node and Postgres clocks can differ by a few ms).
  await query(
    `UPDATE assessments SET reviewed_at = NOW() - INTERVAL '1 minute',
       audited_at = CASE WHEN audited_at IS NULL THEN NULL ELSE NOW() - INTERVAL '1 minute' END
     WHERE id = $1`,
    [rows[0].id]
  );
  return { company, lead, contributor, auditor, vaultId, assessmentId: rows[0].id };
}

const as = (r, u) => r.set("Authorization", `Bearer ${u.token}`);
const auditorView = async (auditor, vaultId) => (await as(request(app).get(`/api/vault/${vaultId}/view`), auditor)).text;
const uploadVersion = (u, vaultId) =>
  as(request(app).post(`/api/vault/${vaultId}/versions`), u).attach("file", Buffer.from(V2), { filename: "policy.txt", contentType: "text/plain" });
const trackerUpload = (u) =>
  as(request(app).post("/api/evidence"), u)
    .attach("file", Buffer.from(V2), { filename: "policy.txt", contentType: "text/plain" })
    .field("questId", "Q-F11").field("moduleId", "M-F11").field("month", MONTH);
const assessment = async (id) => (await query("SELECT review_status, auto_reverted_reason, reviewed_by FROM assessments WHERE id = $1", [id])).rows[0];

async function addSecondVersionThenSetStatus(ctx, status) {
  await query("UPDATE assessments SET review_status = 'Submitted' WHERE id = $1", [ctx.assessmentId]);
  expect((await uploadVersion(ctx.contributor, ctx.vaultId)).status).toBe(201);
  await query("UPDATE assessments SET review_status = $1, auto_reverted_at = NULL, auto_reverted_reason = NULL WHERE id = $2", [status, ctx.assessmentId]);
  const versions = await as(request(app).get(`/api/vault/${ctx.vaultId}/versions`), ctx.contributor);
  return versions.body.find((v) => v.versionNumber === 1);
}

describe("F-11 AUDITED evidence is locked", () => {
  test("new version upload is refused and content is unchanged", async () => {
    const ctx = await setup("AUDITED");
    const res = await uploadVersion(ctx.contributor, ctx.vaultId);
    expect(res.status).toBe(409);
    expect(res.body.code).toBe("LOCKED");
    expect(await auditorView(ctx.auditor, ctx.vaultId)).toBe(V1);
    expect((await assessment(ctx.assessmentId)).review_status).toBe("AUDITED");
  });

  test("restoring an older version is refused", async () => {
    const ctx = await setup("AUDITED");
    const v1 = await addSecondVersionThenSetStatus(ctx, "AUDITED");
    const res = await as(request(app).post(`/api/vault/${ctx.vaultId}/versions/${v1.id}/restore`), ctx.contributor);
    expect(res.status).toBe(409);
    expect(await auditorView(ctx.auditor, ctx.vaultId)).toBe(V2);
  });

  test("title/description cannot be rewritten", async () => {
    const ctx = await setup("AUDITED");
    const res = await as(request(app).put(`/api/vault/${ctx.vaultId}`), ctx.contributor).send({ title: "Something else" });
    expect(res.status).toBe(409);
    const { rows } = await query("SELECT title FROM evidence_vault WHERE id = $1", [ctx.vaultId]);
    expect(rows[0].title).toBe("Access policy");
  });

  test("Tracker re-upload on the question is refused before anything is stored", async () => {
    const ctx = await setup("AUDITED");
    const res = await trackerUpload(ctx.contributor);
    expect(res.status).toBe(409);
    expect(res.body.code).toBe("LOCKED");
    const { rows } = await query("SELECT 1 FROM evidence WHERE company_id = $1", [ctx.company.id]);
    expect(rows).toHaveLength(0);
    expect(await auditorView(ctx.auditor, ctx.vaultId)).toBe(V1);
  });
});

describe("F-11 FINISHED evidence can change but reopens review", () => {
  test("new version is accepted and the control goes back to Submitted", async () => {
    const ctx = await setup("FINISHED");
    const res = await uploadVersion(ctx.contributor, ctx.vaultId);
    expect(res.status).toBe(201);
    const a = await assessment(ctx.assessmentId);
    expect(a.review_status).toBe("Submitted");
    expect(a.auto_reverted_reason).toMatch(/changed after approval/);
    const { rows } = await query(
      "SELECT 1 FROM notifications WHERE company_id = $1 AND user_id = $2 AND title ILIKE '%re-review%'",
      [ctx.company.id, ctx.lead.id]
    );
    expect(rows.length).toBeGreaterThan(0);
    const log = await query("SELECT 1 FROM audit_logs WHERE company_id = $1 AND action = 'ASSESSMENT_AUTO_REVERTED'", [ctx.company.id]);
    expect(log.rows.length).toBe(1);
  });

  test("restore is accepted and reopens review", async () => {
    const ctx = await setup("FINISHED");
    const v1 = await addSecondVersionThenSetStatus(ctx, "FINISHED");
    const res = await as(request(app).post(`/api/vault/${ctx.vaultId}/versions/${v1.id}/restore`), ctx.contributor);
    expect(res.status).toBe(201);
    expect((await assessment(ctx.assessmentId)).review_status).toBe("Submitted");
  });

  test("rename is accepted and reopens review", async () => {
    const ctx = await setup("FINISHED");
    const res = await as(request(app).put(`/api/vault/${ctx.vaultId}`), ctx.contributor).send({ title: "Access policy 2026" });
    expect(res.status).toBe(200);
    expect((await assessment(ctx.assessmentId)).review_status).toBe("Submitted");
  });

  test("Tracker re-upload is accepted and reopens review", async () => {
    const ctx = await setup("FINISHED");
    const res = await trackerUpload(ctx.contributor);
    expect(res.status).toBe(201);
    expect((await assessment(ctx.assessmentId)).review_status).toBe("Submitted");
    expect(await auditorView(ctx.auditor, ctx.vaultId)).toBe(V2);
  });
});

describe("F-11 unreviewed evidence is unaffected", () => {
  test("versioning and renaming work and the assessment is untouched", async () => {
    const ctx = await setup("Submitted");
    expect((await uploadVersion(ctx.contributor, ctx.vaultId)).status).toBe(201);
    expect((await as(request(app).put(`/api/vault/${ctx.vaultId}`), ctx.contributor).send({ title: "Renamed" })).status).toBe(200);
    const a = await assessment(ctx.assessmentId);
    expect(a.review_status).toBe("Submitted");
    expect(a.auto_reverted_reason).toBeNull();
  });
});

describe("F-11 closure-review bypasses", () => {
  test("a current-month WIP draft does not unlock AUDITED evidence", async () => {
    const ctx = await setup("AUDITED");
    // The API no longer lets a new row be created over an audited month (closure review
    // 6A) — a legacy draft that already exists must still not unlock the evidence.
    const draft = await as(request(app).post("/api/assessments"), ctx.contributor)
      .send({ questId: "Q-F11", moduleId: "M-F11", month: MONTH, reviewStatus: "WIP" });
    expect(draft.status).toBe(409);
    await query(
      "INSERT INTO assessments (company_id, quest_id, module_id, month, answer, review_status) VALUES ($1, 'Q-F11', 'M-F11', $2, 'IMPLEMENTED', 'WIP')",
      [ctx.company.id, MONTH]
    );
    const res = await uploadVersion(ctx.contributor, ctx.vaultId);
    expect(res.status).toBe(409);
    expect(await auditorView(ctx.auditor, ctx.vaultId)).toBe(V1);
  });

  test("an AUDITED approval from an earlier month still locks the evidence", async () => {
    const ctx = await setup("AUDITED");
    await query("UPDATE assessments SET month = '2025-01' WHERE id = $1", [ctx.assessmentId]);
    expect((await uploadVersion(ctx.contributor, ctx.vaultId)).status).toBe(409);
  });

  test("a WIP draft does not dodge the re-review of a FINISHED approval", async () => {
    const ctx = await setup("FINISHED");
    await as(request(app).post("/api/assessments"), ctx.contributor)
      .send({ questId: "Q-F11", moduleId: "M-F11", month: MONTH, reviewStatus: "WIP" });
    expect((await uploadVersion(ctx.contributor, ctx.vaultId)).status).toBe(201);
    expect((await assessment(ctx.assessmentId)).review_status).toBe("Submitted");
  });

  test("editing a Tracker evidence row that was part of an AUDITED assessment is refused", async () => {
    const ctx = await setup("AUDITED");
    const { rows } = await query(
      `INSERT INTO evidence (company_id, quest_id, module_id, month, evidence_id, evidence_type, evidence_name, evidence_link)
       VALUES ($1, 'Q-F11', 'M-F11', $2, $3, 'LINK', 'link', 'https://example.com/original') RETURNING id`,
      [ctx.company.id, MONTH, String(ctx.assessmentId)]
    );
    const res = await as(request(app).put(`/api/evidence/${rows[0].id}`), ctx.contributor).send({ evidenceLink: "https://swapped.example" });
    expect(res.status).toBe(409);
    const after = await query("SELECT evidence_link FROM evidence WHERE id = $1", [rows[0].id]);
    expect(after.rows[0].evidence_link).toBe("https://example.com/original");
  });

  test("a fresh Tracker row for a later period can still be attached to a new assessment", async () => {
    const ctx = await setup("AUDITED");
    await query("UPDATE assessments SET month = '2025-01' WHERE id = $1", [ctx.assessmentId]);
    const { rows } = await query(
      `INSERT INTO evidence (company_id, quest_id, module_id, month, evidence_type, evidence_name, evidence_link)
       VALUES ($1, 'Q-F11', 'M-F11', $2, 'LINK', 'new period', 'https://example.com/new') RETURNING id`,
      [ctx.company.id, MONTH]
    );
    const { rows: next } = await query(
      "INSERT INTO assessments (company_id, quest_id, module_id, month, answer, review_status) VALUES ($1, 'Q-F11', 'M-F11', $2, 'IMPLEMENTED', 'Submitted') RETURNING id",
      [ctx.company.id, MONTH]
    );
    const res = await as(request(app).put(`/api/evidence/${rows[0].id}`), ctx.contributor).send({ evidenceId: String(next[0].id) });
    expect(res.status).toBe(200);
  });

  test("editing a Tracker row of a FINISHED assessment reopens that assessment", async () => {
    const ctx = await setup("FINISHED");
    // The contributor's own approved submission (a colleague's is refused: closure review 7C).
    await query("UPDATE assessments SET submitted_by = $1 WHERE id = $2", [ctx.contributor.email, ctx.assessmentId]);
    const { rows } = await query(
      `INSERT INTO evidence (company_id, quest_id, module_id, month, evidence_id, evidence_type, evidence_name, evidence_link)
       VALUES ($1, 'Q-F11', 'M-F11', $2, $3, 'LINK', 'link', 'https://example.com/original') RETURNING id`,
      [ctx.company.id, MONTH, String(ctx.assessmentId)]
    );
    expect((await as(request(app).put(`/api/evidence/${rows[0].id}`), ctx.contributor).send({ evidenceLink: "https://changed.example" })).status).toBe(200);
    expect((await assessment(ctx.assessmentId)).review_status).toBe("Submitted");
  });

  test("new evidence can still be linked to an AUDITED control (it does not alter what was audited)", async () => {
    const ctx = await setup("AUDITED");
    const up = await as(request(app).post("/api/vault"), ctx.contributor)
      .attach("file", Buffer.from("next period"), { filename: "next.txt", contentType: "text/plain" })
      .field("title", "Next period").field("questId", "Q-F11");
    expect(up.status).toBe(201);
    expect((await assessment(ctx.assessmentId)).review_status).toBe("AUDITED");
    expect(await auditorView(ctx.auditor, ctx.vaultId)).toBe(V1);
  });
});

describe("F-11 second-review bypasses", () => {
  test("audited Tracker evidence cannot be moved out via POST /api/assessments evidenceIds, edited and moved back", async () => {
    const ctx = await setup("AUDITED");
    const { rows } = await query(
      `INSERT INTO evidence (company_id, quest_id, module_id, month, evidence_id, evidence_type, evidence_name, evidence_link)
       VALUES ($1, 'Q-F11', 'M-F11', $2, $3, 'LINK', 'Audited link', 'https://good.example/report') RETURNING id`,
      [ctx.company.id, MONTH, String(ctx.assessmentId)]
    );
    const eid = rows[0].id;
    const move = await as(request(app).post("/api/assessments"), ctx.contributor)
      .send({ questId: "Q-F11", moduleId: "M-F11", month: "2020-01", answer: "IMPLEMENTED", reviewStatus: "WIP", evidenceIds: [eid] });
    expect(move.status).toBe(409);
    const edit = await as(request(app).put(`/api/evidence/${eid}`), ctx.contributor)
      .send({ evidenceLink: "https://evil.example/", evidenceId: String(ctx.assessmentId), month: MONTH });
    expect(edit.status).toBe(409);
    const after = (await query("SELECT evidence_link, evidence_id FROM evidence WHERE id = $1", [eid])).rows[0];
    expect(after).toEqual({ evidence_link: "https://good.example/report", evidence_id: String(ctx.assessmentId) });
  });

  test("an unrelated row cannot be edited into an audited assessment", async () => {
    const ctx = await setup("AUDITED");
    const { rows } = await query(
      `INSERT INTO evidence (company_id, quest_id, module_id, month, evidence_type, evidence_name, evidence_link)
       VALUES ($1, 'Q-F11', 'M-F11', '2020-01', 'LINK', 'other', 'https://other.example') RETURNING id`,
      [ctx.company.id]
    );
    const res = await as(request(app).put(`/api/evidence/${rows[0].id}`), ctx.contributor)
      .send({ evidenceId: String(ctx.assessmentId), month: MONTH, evidenceLink: "https://evil.example/" });
    expect(res.status).toBe(409);
  });

  test("taking evidence from a FINISHED assessment sends it back for review", async () => {
    const ctx = await setup("FINISHED");
    // The contributor's own approved submission (they may only move their own evidence).
    await query("UPDATE assessments SET submitted_by = $1 WHERE id = $2", [ctx.contributor.email, ctx.assessmentId]);
    const { rows } = await query(
      `INSERT INTO evidence (company_id, quest_id, module_id, month, evidence_id, evidence_type, evidence_name, evidence_link)
       VALUES ($1, 'Q-F11', 'M-F11', $2, $3, 'LINK', 'link', 'https://example.com') RETURNING id`,
      [ctx.company.id, MONTH, String(ctx.assessmentId)]
    );
    const move = await as(request(app).post("/api/assessments"), ctx.contributor)
      .send({ questId: "Q-F11", moduleId: "M-F11", month: "2020-01", answer: "IMPLEMENTED", reviewStatus: "WIP", evidenceIds: [rows[0].id] });
    expect(move.status).toBe(201);
    expect((await assessment(ctx.assessmentId)).review_status).toBe("Submitted");
  });

  test("an invalid month is rejected", async () => {
    const ctx = await setup("Submitted");
    for (const month of ["2026-13", "2026-00", "26-01", "2026-1"]) {
      const res = await as(request(app).post("/api/assessments"), ctx.contributor)
        .send({ questId: "Q-F11", moduleId: "M-F11", month, answer: "IMPLEMENTED", reviewStatus: "WIP" });
      expect(res.status).toBe(400);
    }
  });
});

describe("F-11 who may reopen an AUDITED assessment", () => {
  test.each(["CONTRIBUTOR", "LEAD"])("%s cannot reopen an audited assessment (lock stays)", async (role) => {
    const ctx = await setup("AUDITED");
    const actor = role === "LEAD" ? ctx.lead : ctx.contributor;
    const res = await as(request(app).put(`/api/assessments/${ctx.assessmentId}`), actor)
      .send({ reviewStatus: role === "LEAD" ? "FINISHED" : "WIP" });
    expect(res.status).toBe(409);
    expect((await assessment(ctx.assessmentId)).review_status).toBe("AUDITED");
    expect((await uploadVersion(ctx.contributor, ctx.vaultId)).status).toBe(409);
  });

  test.each(["AUDITOR", "ADMIN"])("%s can reopen an audited assessment, and it is audit-logged", async (role) => {
    const ctx = await setup("AUDITED");
    const actor = role === "AUDITOR" ? ctx.auditor : await createUser(ctx.company.id, "ADMIN", { email: `admin-${Date.now()}@f11.test` });
    const res = await as(request(app).put(`/api/assessments/${ctx.assessmentId}`), actor).send({ reviewStatus: "WIP" });
    expect(res.status).toBe(200);
    expect((await assessment(ctx.assessmentId)).review_status).toBe("WIP");
    const log = await query("SELECT email FROM audit_logs WHERE company_id = $1 AND action = 'ASSESSMENT_AUDIT_REOPENED'", [ctx.company.id]);
    expect(log.rows.map((r) => r.email)).toEqual([actor.email]);
  });
});

describe("F-11 third-review: rows the auditor was shown", () => {
  const mkRow = async (ctx, body) => {
    const r = await as(request(app).post("/api/evidence"), ctx.contributor)
      .send({ questId: "Q-F11", moduleId: "M-F11", evidenceLink: "https://good.example/evidence", evidenceName: "Good", ...body });
    expect(r.status).toBe(201);
    return r.body.id;
  };
  const audit = (ctx) => query(
    `INSERT INTO assessments (company_id, quest_id, module_id, month, answer, review_status, reviewed_by, audited_by, reviewed_at, audited_at)
     VALUES ($1, 'Q-F11', 'M-F11', $2, 'IMPLEMENTED', 'AUDITED', $3, $4, NOW(), NOW() + INTERVAL '1 second') RETURNING id`,
    [ctx.company.id, MONTH, ctx.lead.email, ctx.auditor.email]
  );
  const editLink = (ctx, id) => as(request(app).put(`/api/evidence/${id}`), ctx.contributor).send({ evidenceLink: "https://evil.example/swapped" });

  test("a row with no month that existed at audit time is locked", async () => {
    const ctx = await setup("Submitted");
    const id = await mkRow(ctx, {});
    await audit(ctx);
    expect((await editLink(ctx, id)).status).toBe(409);
  });

  test("a row still attached to an earlier WIP draft that existed at audit time is locked", async () => {
    const ctx = await setup("Submitted");
    const { rows: wip } = await query(
      "INSERT INTO assessments (company_id, quest_id, module_id, month, answer, review_status) VALUES ($1, 'Q-F11', 'M-F11', $2, 'IMPLEMENTED', 'WIP') RETURNING id",
      [ctx.company.id, MONTH]
    );
    const id = await mkRow(ctx, { month: MONTH, evidenceId: String(wip[0].id) });
    await audit(ctx);
    expect((await editLink(ctx, id)).status).toBe(409);
  });

  test("evidenceId must be an assessment of the same company and question", async () => {
    const ctx = await setup("Submitted");
    const other = await createCompany({ domain: `f11o-${Date.now()}.test` });
    const { rows: foreign } = await query("INSERT INTO assessments (company_id, quest_id, month) VALUES ($1, 'Q-F11', $2) RETURNING id", [other.id, MONTH]);
    for (const evidenceId of ["x", "1.5", String(foreign[0].id)]) {
      const r = await as(request(app).post("/api/evidence"), ctx.contributor)
        .send({ questId: "Q-F11", moduleId: "M-F11", month: MONTH, evidenceId, evidenceLink: "https://e.example", evidenceName: "n" });
      expect(r.status).toBe(400);
    }
  });

  test("new evidence cannot be attached straight into an AUDITED assessment", async () => {
    const ctx = await setup("AUDITED");
    const r = await as(request(app).post("/api/evidence"), ctx.contributor)
      .send({ questId: "Q-F11", moduleId: "M-F11", month: MONTH, evidenceId: String(ctx.assessmentId), evidenceLink: "https://late.example", evidenceName: "late" });
    expect(r.status).toBe(409);
  });

  test("evidence added after the audit stays editable", async () => {
    const ctx = await setup("AUDITED");
    const id = await mkRow(ctx, { month: "2030-01" });
    expect((await editLink(ctx, id)).status).toBe(200);
  });
});

describe("F-11 fourth-review", () => {
  const mkRow = async (ctx, body) => {
    const r = await as(request(app).post("/api/evidence"), ctx.contributor)
      .send({ questId: "Q-F11", moduleId: "M-F11", evidenceLink: "https://good.example/e", evidenceName: "Good", ...body });
    return r;
  };

  test("a template rename keeps the audit lock on the renamed control", async () => {
    const { applyTemplateDiff } = await import("../../routes/frameworks.js");
    const { getClient } = await import("../../db/index.js");
    const ctx = await setup("AUDITED");
    const { rows } = await query(
      `INSERT INTO evidence (company_id, quest_id, module_id, month, evidence_id, evidence_type, evidence_name, evidence_link)
       VALUES ($1, 'Q-F11', 'M-F11', $2, $3, 'LINK', 'audited', 'https://good.example/r') RETURNING id`,
      [ctx.company.id, MONTH, String(ctx.assessmentId)]
    );
    const client = await getClient();
    try {
      await client.query("BEGIN");
      await applyTemplateDiff(client, {
        companyId: ctx.company.id,
        diff: { reworded: [], renamed: [{ oldQuestId: "Q-F11", newQuestId: "Q-F11-v2" }], added: [], removed: [] },
        toQuestions: [{ quest_id: "Q-F11-v2", baseline_question: "q?" }], toVersion: 2, frameworkKey: null,
      });
      await client.query("COMMIT");
    } finally {
      client.release();
    }
    expect((await as(request(app).put(`/api/evidence/${rows[0].id}`), ctx.contributor).send({ notes: "changed" })).status).toBe(409);
    expect((await uploadVersion(ctx.contributor, ctx.vaultId)).status).toBe(409);
  });

  test("out-of-range and non-scalar evidenceIds are 400, not 500", async () => {
    const ctx = await setup("Submitted");
    for (const evidenceId of ["2147483648", "99999999999999999999999", [String(ctx.assessmentId)], { id: 1 }]) {
      expect((await mkRow(ctx, { month: MONTH, evidenceId })).status).toBe(400);
    }
  });

  test("a leading-zero evidenceId is stored canonically", async () => {
    const ctx = await setup("Submitted");
    const r = await mkRow(ctx, { month: MONTH, evidenceId: `000${ctx.assessmentId}` });
    expect(r.status).toBe(201);
    expect(r.body.evidenceId).toBe(String(ctx.assessmentId));
  });

  test("next period's evidence uploaded before a late audit of the previous period stays usable", async () => {
    const ctx = await setup("Submitted");
    const feb = await mkRow(ctx, { month: "2026-02" }); // uploaded first
    expect(feb.status).toBe(201);
    // January audited afterwards
    const { rows: jan } = await query(
      `INSERT INTO assessments (company_id, quest_id, module_id, month, answer, review_status, reviewed_at, audited_at)
       VALUES ($1, 'Q-F11', 'M-F11', '2026-01', 'IMPLEMENTED', 'AUDITED', NOW(), NOW() + INTERVAL '1 second') RETURNING id`,
      [ctx.company.id]
    );
    const submit = await as(request(app).post("/api/assessments"), ctx.contributor)
      .send({ questId: "Q-F11", moduleId: "M-F11", month: "2026-02", answer: "IMPLEMENTED", reviewStatus: "WIP", evidenceIds: [feb.body.id] });
    expect(submit.status).toBe(201);
    expect((await as(request(app).put(`/api/evidence/${feb.body.id}`), ctx.contributor).send({ notes: "feb notes" })).status).toBe(200);
    expect((await assessment(jan[0].id)).review_status).toBe("AUDITED");
  });

  test("submitting next period's evidence does not reopen the previous period's FINISHED approval", async () => {
    const ctx = await setup("Submitted");
    const feb = await mkRow(ctx, { month: "2026-02" });
    const { rows: jan } = await query(
      `INSERT INTO assessments (company_id, quest_id, module_id, month, answer, review_status, reviewed_at)
       VALUES ($1, 'Q-F11', 'M-F11', '2026-01', 'IMPLEMENTED', 'FINISHED', NOW() + INTERVAL '1 second') RETURNING id`,
      [ctx.company.id]
    );
    await as(request(app).post("/api/assessments"), ctx.contributor)
      .send({ questId: "Q-F11", moduleId: "M-F11", month: "2026-02", answer: "IMPLEMENTED", reviewStatus: "WIP", evidenceIds: [feb.body.id] });
    expect((await assessment(jan[0].id)).review_status).toBe("FINISHED");
  });

  test("the third-review cases stay locked (same-month / no-month rows existing at audit time)", async () => {
    const ctx = await setup("Submitted");
    const noMonth = await mkRow(ctx, {});
    const sameMonth = await mkRow(ctx, { month: MONTH });
    await query(
      `INSERT INTO assessments (company_id, quest_id, module_id, month, answer, review_status, reviewed_at, audited_at)
       VALUES ($1, 'Q-F11', 'M-F11', $2, 'IMPLEMENTED', 'AUDITED', NOW(), NOW() + INTERVAL '1 second')`,
      [ctx.company.id, MONTH]
    );
    for (const r of [noMonth, sameMonth]) {
      expect((await as(request(app).put(`/api/evidence/${r.body.id}`), ctx.contributor).send({ evidenceLink: "https://evil.example" })).status).toBe(409);
    }
  });
});
