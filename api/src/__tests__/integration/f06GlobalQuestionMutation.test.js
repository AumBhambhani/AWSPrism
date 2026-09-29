import { describe, test, expect } from "vitest";
import request from "supertest";
import app from "../../app.js";
import { query } from "../../db/index.js";
import { createCompany, createUser, createSuperAdmin } from "../setup/helpers.js";

/**
 * F-06 regression suite — PUT /api/questions/:questId and
 * PUT /api/questions/:questId/recurrence must never mutate the global canonical
 * row (company_id IS NULL) for a tenant ADMIN/LEAD write. When the tenant has no
 * company-specific copy yet, the fix (routes/questions.js `ensureTenantQuestion`)
 * creates one from the global row and writes there instead.
 *
 * The first block's assertions were RED against the pre-fix handler (see the
 * F-06 validation report) and must be GREEN now. Later blocks cover the
 * override lifecycle (create-once, reuse, no duplicates under concurrency) and
 * confirm the SUPERADMIN global-catalog commit path (frameworks.js, untouched
 * by this fix) still legitimately mutates company_id IS NULL rows.
 */

async function seedGlobalQuestion(questId, overrides = {}) {
  const result = await query(
    `INSERT INTO questions
       (quest_id, module_id, control_area, baseline_question, priority, due_date,
        recurrence_interval, next_due_date, company_id)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, NULL)
     RETURNING *`,
    [
      questId,
      overrides.moduleId || "M1",
      overrides.controlArea || "Policies for information security",
      overrides.questionText || "Is there a documented policy?",
      overrides.priority || "Medium",
      overrides.dueDate || "2030-01-01",
      overrides.recurrenceInterval || "annual",
      overrides.nextDueDate || "2030-01-01",
    ]
  );
  return result.rows[0];
}

async function fetchGlobalQuestion(questId) {
  const result = await query(
    "SELECT * FROM questions WHERE quest_id = $1 AND company_id IS NULL",
    [questId]
  );
  return result.rows[0];
}

describe("F-06 validation: tenant mutation of global canonical questions", () => {
  test("EXPLOIT: Tenant A ADMIN with no tenant-specific copy mutates the shared global question via PUT /:questId", async () => {
    const questId = `F06-PRI-${Date.now()}`;
    await seedGlobalQuestion(questId, { priority: "Low", dueDate: "2030-01-01" });

    const companyA = await createCompany({ domain: `f06-a-${Date.now()}.com` });
    const adminA = await createUser(companyA.id, "ADMIN", {
      email: `admin-a-${Date.now()}@testcorp.com`,
    });

    const res = await request(app)
      .put(`/api/questions/${questId}`)
      .set("Authorization", `Bearer ${adminA.token}`)
      .send({ priority: "Critical", dueDate: "2099-12-31" });

    const globalRow = await fetchGlobalQuestion(questId);

    console.log(
      "EXPLOIT priority PUT — EXPECTED (secure): global row unchanged (Low/2030-01-01), request rejected or scoped to a tenant override.",
      "ACTUAL: status=", res.status, "global priority=", globalRow?.priority, "global due_date=", globalRow?.due_date
    );

    // The shared canonical row (company_id IS NULL) must never be mutated by a
    // tenant ADMIN/LEAD write. This was RED pre-fix; must be GREEN now.
    expect(globalRow.priority).toBe("Low");

    // The write must still succeed for the caller — it should now land on a
    // freshly-created tenant-specific override instead of being silently dropped.
    const tenantRow = await query(
      "SELECT * FROM questions WHERE quest_id = $1 AND company_id = $2",
      [questId, companyA.id]
    );
    expect(res.status).toBe(200);
    expect(tenantRow.rows[0].priority).toBe("Critical");
    expect(tenantRow.rows[0].due_date).not.toEqual(globalRow.due_date);
  });

  test("EXPLOIT: Tenant A LEAD mutates global recurrence fields via PUT /:questId/recurrence", async () => {
    const questId = `F06-REC-${Date.now()}`;
    await seedGlobalQuestion(questId, { recurrenceInterval: "annual", nextDueDate: "2030-01-01" });

    const companyA = await createCompany({ domain: `f06-b-${Date.now()}.com` });
    const leadA = await createUser(companyA.id, "LEAD", {
      email: `lead-a-${Date.now()}@testcorp.com`,
    });

    const res = await request(app)
      .put(`/api/questions/${questId}/recurrence`)
      .set("Authorization", `Bearer ${leadA.token}`)
      .send({ recurrenceInterval: "none", nextDueDate: null });

    const globalRow = await fetchGlobalQuestion(questId);
    console.log(
      "EXPLOIT recurrence PUT — EXPECTED (secure): global row unchanged (annual).",
      "ACTUAL: status=", res.status, "recurrence_interval=", globalRow?.recurrence_interval, "next_due_date=", globalRow?.next_due_date
    );

    // Global row untouched (was RED pre-fix; must be GREEN now).
    expect(globalRow.recurrence_interval).toBe("annual");

    const tenantRow = await query(
      "SELECT * FROM questions WHERE quest_id = $1 AND company_id = $2",
      [questId, companyA.id]
    );
    expect(res.status).toBe(200);
    expect(tenantRow.rows[0].recurrence_interval).toBe("none");
    expect(tenantRow.rows[0].next_due_date).toBeNull();
  });

  test("CROSS-TENANT BLAST RADIUS: Tenant B (uninvolved, no override) observes Tenant A's mutation via GET /api/questions", async () => {
    const questId = `F06-BLAST-${Date.now()}`;
    await seedGlobalQuestion(questId, { priority: "Low" });

    const companyA = await createCompany({ domain: `f06-c-a-${Date.now()}.com` });
    const adminA = await createUser(companyA.id, "ADMIN", {
      email: `admin-c-a-${Date.now()}@testcorp.com`,
    });
    const companyB = await createCompany({ domain: `f06-c-b-${Date.now()}.com` });
    const reviewerB = await createUser(companyB.id, "REVIEWER", {
      email: `reviewer-c-b-${Date.now()}@testcorp.com`,
    });

    await request(app)
      .put(`/api/questions/${questId}`)
      .set("Authorization", `Bearer ${adminA.token}`)
      .send({ priority: "Critical" });

    const listRes = await request(app)
      .get(`/api/questions`)
      .set("Authorization", `Bearer ${reviewerB.token}`);

    const seen = listRes.body.find((q) => q.questId === questId);
    console.log(
      "CROSS-TENANT — EXPECTED (secure): Tenant B still sees Low (unaffected by Tenant A's write).",
      "ACTUAL: Tenant B sees priority=", seen?.priority
    );

    expect(seen).toBeTruthy();
    // Tenant B, who never interacted with Tenant A or this mutation, must not
    // observe its effect (was RED pre-fix; must be GREEN now).
    expect(seen.priority).toBe("Low");
  });

  test("CONTROL: Tenant A cannot mutate the global row once it already owns a tenant-specific copy (list-path unaffected)", async () => {
    const questId = `F06-CTRL-${Date.now()}`;
    await seedGlobalQuestion(questId, { priority: "Low" });

    const companyA = await createCompany({ domain: `f06-d-${Date.now()}.com` });
    const adminA = await createUser(companyA.id, "ADMIN", {
      email: `admin-d-${Date.now()}@testcorp.com`,
    });
    // Give Tenant A its own copy of the same quest_id.
    await query(
      `INSERT INTO questions (quest_id, module_id, control_area, baseline_question, priority, company_id)
       VALUES ($1, 'M1', 'Policies for information security', 'Is there a documented policy?', 'Low', $2)`,
      [questId, companyA.id]
    );

    const res = await request(app)
      .put(`/api/questions/${questId}`)
      .set("Authorization", `Bearer ${adminA.token}`)
      .send({ priority: "Critical" });

    const globalRow = await fetchGlobalQuestion(questId);
    const tenantRow = await query(
      "SELECT * FROM questions WHERE quest_id = $1 AND company_id = $2",
      [questId, companyA.id]
    );

    expect(res.status).toBe(200);
    expect(tenantRow.rows[0].priority).toBe("Critical");
    // Global row must remain untouched when a tenant-specific override exists.
    expect(globalRow.priority).toBe("Low");
  });

  test("CONTROL: unauthenticated request is rejected", async () => {
    const questId = `F06-UNAUTH-${Date.now()}`;
    await seedGlobalQuestion(questId);

    const res = await request(app)
      .put(`/api/questions/${questId}`)
      .send({ priority: "Critical" });

    expect(res.status).toBe(401);
  });

  test("CONTROL: CONTRIBUTOR role is rejected by the role gate", async () => {
    const questId = `F06-CONTRIB-${Date.now()}`;
    await seedGlobalQuestion(questId);
    const company = await createCompany({ domain: `f06-e-${Date.now()}.com` });
    const contributor = await createUser(company.id, "CONTRIBUTOR", {
      email: `contrib-e-${Date.now()}@testcorp.com`,
    });

    const res = await request(app)
      .put(`/api/questions/${questId}`)
      .set("Authorization", `Bearer ${contributor.token}`)
      .send({ priority: "Critical" });

    expect(res.status).toBe(403);
    const globalRow = await fetchGlobalQuestion(questId);
    expect(globalRow.priority).not.toBe("Critical");
  });

  test("CONTROL: REVIEWER role is rejected by the role gate", async () => {
    const questId = `F06-REVIEWER-${Date.now()}`;
    await seedGlobalQuestion(questId);
    const company = await createCompany({ domain: `f06-f-${Date.now()}.com` });
    const reviewer = await createUser(company.id, "REVIEWER", {
      email: `reviewer-f-${Date.now()}@testcorp.com`,
    });

    const res = await request(app)
      .put(`/api/questions/${questId}`)
      .set("Authorization", `Bearer ${reviewer.token}`)
      .send({ priority: "Critical" });

    expect(res.status).toBe(403);
  });

  test("CONTROL: AUDITOR role is rejected by the role gate (not in requireRole allowlist)", async () => {
    const questId = `F06-AUDITOR-${Date.now()}`;
    await seedGlobalQuestion(questId);
    const company = await createCompany({ domain: `f06-g-${Date.now()}.com` });
    const auditor = await createUser(company.id, "AUDITOR", {
      email: `auditor-g-${Date.now()}@testcorp.com`,
    });
    await query(
      `INSERT INTO auditor_profiles (user_id, company_id, expiry_date, active)
       VALUES ($1, $2, CURRENT_DATE + INTERVAL '30 days', TRUE)`,
      [auditor.id, company.id]
    );

    const res = await request(app)
      .put(`/api/questions/${questId}`)
      .set("Authorization", `Bearer ${auditor.token}`)
      .send({ priority: "Critical" });

    expect(res.status).toBe(403);
  });

  test("CONTROL: nonexistent quest_id returns 404, no row created", async () => {
    const questId = `F06-NOTFOUND-${Date.now()}`;
    const company = await createCompany({ domain: `f06-h-${Date.now()}.com` });
    const admin = await createUser(company.id, "ADMIN", {
      email: `admin-h-${Date.now()}@testcorp.com`,
    });

    const res = await request(app)
      .put(`/api/questions/${questId}`)
      .set("Authorization", `Bearer ${admin.token}`)
      .send({ priority: "Critical" });

    expect(res.status).toBe(404);
  });

  test("REACHABILITY: attacker can discover a global-only quest_id via GET /api/questions without prior knowledge", async () => {
    const questId = `F06-DISCOVER-${Date.now()}`;
    await seedGlobalQuestion(questId, { priority: "Medium" });

    const company = await createCompany({ domain: `f06-i-${Date.now()}.com` });
    const admin = await createUser(company.id, "ADMIN", {
      email: `admin-i-${Date.now()}@testcorp.com`,
    });

    const listRes = await request(app)
      .get(`/api/questions`)
      .set("Authorization", `Bearer ${admin.token}`);

    const found = listRes.body.find((q) => q.questId === questId);
    expect(found).toBeTruthy();
    expect(found.companyId).toBeNull();

    // Now use the discovered questId to mutate the global row, proving no
    // out-of-band knowledge (UUID guessing, etc.) is required beyond an
    // authenticated ADMIN/LEAD session plus a single GET /api/questions call.
    const res = await request(app)
      .put(`/api/questions/${questId}`)
      .set("Authorization", `Bearer ${admin.token}`)
      .send({ priority: "Critical" });

    const globalRow = await fetchGlobalQuestion(questId);
    console.log(
      "REACHABILITY — EXPECTED (secure): global row unchanged (Medium) after PUT using a discovered questId.",
      "ACTUAL: status=", res.status, "priority=", globalRow?.priority
    );

    // Global row untouched (was RED pre-fix; must be GREEN now).
    expect(globalRow.priority).toBe("Medium");
    expect(res.status).toBe(200);
  });

  test("OVERRIDE LIFECYCLE: subsequent GET /api/questions list reflects Tenant A's new override, not the untouched global row", async () => {
    const questId = `F06-LIFE-A-${Date.now()}`;
    await seedGlobalQuestion(questId, { priority: "Low" });

    const company = await createCompany({ domain: `f06-j-${Date.now()}.com` });
    const admin = await createUser(company.id, "ADMIN", {
      email: `admin-j-${Date.now()}@testcorp.com`,
    });

    await request(app)
      .put(`/api/questions/${questId}`)
      .set("Authorization", `Bearer ${admin.token}`)
      .send({ priority: "Critical" });

    // GET /api/questions (list) explicitly prefers the tenant-specific row via
    // `DISTINCT ON (quest_id) ... ORDER BY quest_id ASC, company_id ASC NULLS LAST`.
    const listRes = await request(app)
      .get(`/api/questions`)
      .set("Authorization", `Bearer ${admin.token}`);

    const seen = listRes.body.find((q) => q.questId === questId);
    expect(listRes.status).toBe(200);
    expect(seen).toBeTruthy();
    expect(seen.priority).toBe("Critical");
    expect(seen.companyId).toBe(company.id);

    // Confirm the override row itself at the DB layer too.
    const tenantRow = await query(
      "SELECT * FROM questions WHERE quest_id = $1 AND company_id = $2",
      [questId, company.id]
    );
    expect(tenantRow.rows[0].priority).toBe("Critical");
  });

  test("OVERRIDE LIFECYCLE: repeating the mutation updates the existing tenant override, never creates a duplicate", async () => {
    const questId = `F06-LIFE-B-${Date.now()}`;
    await seedGlobalQuestion(questId, { priority: "Low" });

    const company = await createCompany({ domain: `f06-k-${Date.now()}.com` });
    const admin = await createUser(company.id, "ADMIN", {
      email: `admin-k-${Date.now()}@testcorp.com`,
    });

    const first = await request(app)
      .put(`/api/questions/${questId}`)
      .set("Authorization", `Bearer ${admin.token}`)
      .send({ priority: "High" });
    const second = await request(app)
      .put(`/api/questions/${questId}`)
      .set("Authorization", `Bearer ${admin.token}`)
      .send({ priority: "Critical" });

    expect(first.status).toBe(200);
    expect(second.status).toBe(200);

    const tenantRows = await query(
      "SELECT * FROM questions WHERE quest_id = $1 AND company_id = $2",
      [questId, company.id]
    );
    // Exactly one tenant override — the second write updated it in place.
    expect(tenantRows.rows.length).toBe(1);
    expect(tenantRows.rows[0].priority).toBe("Critical");

    const globalRow = await fetchGlobalQuestion(questId);
    expect(globalRow.priority).toBe("Low");
  });

  test("CONCURRENCY: two simultaneous first-writes for the same tenant/questId never create duplicate overrides", async () => {
    const questId = `F06-RACE-${Date.now()}`;
    await seedGlobalQuestion(questId, { priority: "Low" });

    const company = await createCompany({ domain: `f06-l-${Date.now()}.com` });
    const admin = await createUser(company.id, "ADMIN", {
      email: `admin-l-${Date.now()}@testcorp.com`,
    });

    const [resA, resB] = await Promise.all([
      request(app)
        .put(`/api/questions/${questId}`)
        .set("Authorization", `Bearer ${admin.token}`)
        .send({ priority: "High" }),
      request(app)
        .put(`/api/questions/${questId}`)
        .set("Authorization", `Bearer ${admin.token}`)
        .send({ priority: "Critical" }),
    ]);

    expect(resA.status).toBe(200);
    expect(resB.status).toBe(200);

    const tenantRows = await query(
      "SELECT * FROM questions WHERE quest_id = $1 AND company_id = $2",
      [questId, company.id]
    );
    // The (company_id, quest_id) unique index guarantees at most one row
    // survives the race, regardless of which request's value "won".
    expect(tenantRows.rows.length).toBe(1);
    expect(["High", "Critical"]).toContain(tenantRows.rows[0].priority);

    const globalRow = await fetchGlobalQuestion(questId);
    expect(globalRow.priority).toBe("Low");
  });

  test("SUPERADMIN COMPATIBILITY: the existing global-catalog commit path can still legitimately mutate a company_id IS NULL row", async () => {
    const questId = `F06-SA-${Date.now()}`;
    await seedGlobalQuestion(questId, { questionText: "Old canonical wording", priority: "Medium" });

    const superAdmin = await createSuperAdmin();

    const batch = await query(
      `INSERT INTO import_batches (kind, primary_framework_key, status)
       VALUES ('IMPORT', 'ISO27001', 'STAGED') RETURNING id`
    );
    const batchId = batch.rows[0].id;

    const staging = await query(
      `INSERT INTO import_staging_rows
         (batch_id, framework_key, source_quest_id, module_id, module_name, control_area,
          baseline_question, level3_yes_criteria)
       VALUES ($1, 'ISO27001', $2, 'M1', 'M1', 'Policies for information security',
               'New canonical wording via superadmin', 'updated criteria')
       RETURNING id`,
      [batchId, questId]
    );
    const stagingRowId = staging.rows[0].id;

    const cluster = await query(
      `INSERT INTO import_clusters
         (batch_id, proposed_action, existing_quest_id, decision, decided_action,
          decided_canonical_question, decided_level3)
       VALUES ($1, 'MERGE_INTO_EXISTING', $2, 'MODIFIED', 'MERGE_INTO_EXISTING',
               'New canonical wording via superadmin', 'updated criteria')
       RETURNING id`,
      [batchId, questId]
    );
    const clusterId = cluster.rows[0].id;

    await query(
      `INSERT INTO import_cluster_members (cluster_id, staging_row_id) VALUES ($1, $2)`,
      [clusterId, stagingRowId]
    );

    const res = await request(app)
      .post(`/api/frameworks/import/batches/${batchId}/commit`)
      .set("Authorization", `Bearer ${superAdmin.token}`);

    expect(res.status).toBe(200);

    const globalRow = await fetchGlobalQuestion(questId);
    // SUPERADMIN's legitimate global-catalog path (frameworks.js, untouched by
    // the F-06 fix) must still be able to mutate the canonical row directly.
    expect(globalRow.baseline_question).toBe("New canonical wording via superadmin");
    expect(globalRow.company_id).toBeNull();
  });
});
