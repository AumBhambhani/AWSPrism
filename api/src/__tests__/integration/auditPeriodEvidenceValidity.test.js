import { describe, expect, test, vi } from "vitest";
import request from "supertest";
import app from "../../app.js";
import { query } from "../../db/index.js";
import { markStaleAutomatedEvidence } from "../../utils/scheduler.js";
import { heldByAuditSql } from "../../utils/auditCoverage.js";
import { createCompany, createUser } from "../setup/helpers.js";

vi.mock("../../utils/email.js", () => ({ sendEmail: vi.fn().mockResolvedValue(undefined), sendInvitationEmail: vi.fn() }));

// Evidence behind an AUDITED assessment stays valid for the whole period the audit
// covers (the assessment's month through one recurrence interval), both for the
// "valid until / review due" date and for automated-evidence staleness.

const MONTH = new Date().toISOString().slice(0, 7);
const lastDayAfter = (month, months) => {
  const [y, m] = month.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1 + months, 0)).toISOString().slice(0, 10); // day 0 = last day of prior month
};

async function setup({ recurrence = "quarterly", status = "AUDITED", month = MONTH, linkedAfterAudit = false } = {}) {
  const s = `${Date.now()}-${Math.random().toString(16).slice(2)}`;
  const company = await createCompany({ domain: `ap-${s}.test` });
  const admin = await createUser(company.id, "ADMIN", { email: `a-${s}@ap.test` });
  await query(
    "INSERT INTO questions (quest_id, company_id, module_id, baseline_question, recurrence_interval) VALUES ('Q-AP', $1, 'M-AP', 'q', $2)",
    [company.id, recurrence]
  );
  const { rows: v } = await query(
    "INSERT INTO evidence_vault (company_id, title, file_name, uploaded_at) VALUES ($1, 'Policy', 'p.pdf', NOW() - INTERVAL '80 days') RETURNING id",
    [company.id]
  );
  const auditedAt = new Date(Date.now() - 24 * 3600 * 1000);
  const linkedAt = linkedAfterAudit ? new Date() : new Date(Date.now() - 80 * 24 * 3600 * 1000);
  await query("INSERT INTO question_evidence (company_id, quest_id, vault_id, linked_by, linked_at) VALUES ($1, 'Q-AP', $2, 'seed', $3)", [company.id, v[0].id, linkedAt]);
  await query(
    `INSERT INTO assessments (company_id, quest_id, module_id, month, answer, review_status, reviewed_at, audited_at)
     VALUES ($1, 'Q-AP', 'M-AP', $2, 'IMPLEMENTED', $3, $4, $5)`,
    [company.id, month, status, auditedAt, status === "AUDITED" ? auditedAt : null]
  );
  return { company, admin, vaultId: v[0].id };
}

const vaultItem = async (admin, vaultId) => {
  const res = await request(app).get(`/api/vault/${vaultId}`).set("Authorization", `Bearer ${admin.token}`);
  return res.body;
};
const dateOnly = (v) => (v ? new Date(v).toISOString().slice(0, 10) : null);

describe("audited period keeps evidence valid", () => {
  test("a quarterly control audited this month keeps its evidence valid to the end of the quarter", async () => {
    const { admin, vaultId } = await setup({ recurrence: "quarterly" });
    const item = await vaultItem(admin, vaultId);
    expect(dateOnly(item.auditedThrough)).toBe(lastDayAfter(MONTH, 3));
    const list = await request(app).get("/api/vault?questId=Q-AP").set("Authorization", `Bearer ${admin.token}`);
    expect(dateOnly(list.body[0].auditedThrough)).toBe(lastDayAfter(MONTH, 3));
  });

  test("a monthly control's audited period ends with the month", async () => {
    const { admin, vaultId } = await setup({ recurrence: "monthly" });
    expect(dateOnly((await vaultItem(admin, vaultId)).auditedThrough)).toBe(lastDayAfter(MONTH, 1));
  });

  test("evidence linked after the audit sign-off is not extended", async () => {
    const { admin, vaultId } = await setup({ linkedAfterAudit: true });
    expect((await vaultItem(admin, vaultId)).auditedThrough).toBeNull();
  });

  test("a FINISHED (not audited) assessment does not extend anything", async () => {
    const { admin, vaultId } = await setup({ status: "FINISHED" });
    expect((await vaultItem(admin, vaultId)).auditedThrough).toBeNull();
  });
});

describe("audit hold is per control and robust to bad data", () => {
  const held = async (companyId, vaultId, questId) =>
    (await query(`SELECT ${heldByAuditSql("$2::int", "$1::int", "$3::text")} AS held`, [companyId, vaultId, questId])).rows[0].held;

  test("the hold applies to the audited control only, not to other controls sharing the evidence", async () => {
    const ctx = await setup();
    await query(
      "INSERT INTO questions (quest_id, company_id, module_id, baseline_question, recurrence_interval) VALUES ('Q-OTHER', $1, 'M-AP', 'q', 'quarterly')",
      [ctx.company.id]
    );
    await query("INSERT INTO question_evidence (company_id, quest_id, vault_id, linked_by, linked_at) VALUES ($1, 'Q-OTHER', $2, 'seed', NOW() - INTERVAL '80 days')", [ctx.company.id, ctx.vaultId]);
    expect(await held(ctx.company.id, ctx.vaultId, "Q-AP")).toBe(true);
    expect(await held(ctx.company.id, ctx.vaultId, "Q-OTHER")).toBe(false);
  });

  test("the staleness sweep still reports real freshness (the hold is applied where evidence is read)", async () => {
    const ctx = await setup();
    const { rows: c } = await query(
      "INSERT INTO integration_connections (company_id, integration_key, name, collection_frequency_hours) VALUES ($1, 'aws', 'AWS', 24) RETURNING id",
      [ctx.company.id]
    );
    const { rows } = await query(
      `INSERT INTO automated_evidence_items (company_id, connection_id, evidence_vault_id, test_key, resource_id, status, next_collection_due_at)
       VALUES ($1, $2, $3, 'aws.iam.access_key_age', 'res-1', 'fresh', NOW() - INTERVAL '1 hour') RETURNING id`,
      [ctx.company.id, c[0].id, ctx.vaultId]
    );
    await markStaleAutomatedEvidence();
    expect((await query("SELECT status FROM automated_evidence_items WHERE id = $1", [rows[0].id])).rows[0].status).toBe("stale");
    expect(await held(ctx.company.id, ctx.vaultId, "Q-AP")).toBe(true);
  });

  test("an invalid month on an AUDITED row does not break the vault or the sweep", async () => {
    const ctx = await setup({ month: "2026-13" });
    const res = await request(app).get("/api/vault").set("Authorization", `Bearer ${ctx.admin.token}`);
    expect(res.status).toBe(200);
    expect(res.body[0].auditedThrough).toBeNull();
    await expect(markStaleAutomatedEvidence()).resolves.toBeUndefined();
  });

  test("a far-future audited month cannot hold evidence beyond one interval after sign-off", async () => {
    const ctx = await setup({ recurrence: "quarterly", month: "2099-01" });
    const through = dateOnly((await vaultItem(ctx.admin, ctx.vaultId)).auditedThrough);
    const signedOff = new Date(Date.now() - 24 * 3600 * 1000);
    const cap = new Date(Date.UTC(signedOff.getUTCFullYear(), signedOff.getUTCMonth() + 3, signedOff.getUTCDate() - 1)).toISOString().slice(0, 10);
    expect(through <= cap).toBe(true);
    expect(through < "2099-01-01").toBe(true);
  });

  test("a legacy AUDITED row without audited_at does not extend evidence linked after it", async () => {
    const ctx = await setup({ linkedAfterAudit: true });
    await query("UPDATE assessments SET audited_at = NULL, updated_at = NOW() - INTERVAL '1 day' WHERE company_id = $1", [ctx.company.id]);
    expect((await vaultItem(ctx.admin, ctx.vaultId)).auditedThrough).toBeNull();
  });
});
