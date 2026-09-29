import { describe, expect, test, vi } from "vitest";
import request from "supertest";
import app from "../../app.js";
import { query } from "../../db/index.js";
import { createCompany, createUser } from "../setup/helpers.js";

vi.mock("../../utils/email.js", () => ({ sendEmail: vi.fn().mockResolvedValue(undefined), sendInvitationEmail: vi.fn() }));

// F-24 — ADMIN/LEAD could DELETE an AUDITED assessment (and its evidence rows) with no
// lock and no audit trail. Same rule as reopening an audit: only an ADMIN may undo an
// audited assessment, and every assessment deletion is audit-logged.

async function setup(status) {
  const s = `${Date.now()}-${Math.random().toString(16).slice(2)}`;
  const company = await createCompany({ domain: `f24-${s}.test` });
  const admin = await createUser(company.id, "ADMIN", { email: `admin-${s}@f24.test` });
  const lead = await createUser(company.id, "LEAD", { email: `lead-${s}@f24.test` });
  const { rows } = await query(
    `INSERT INTO assessments (company_id, quest_id, module_id, month, answer, review_status, audited_at)
     VALUES ($1, 'Q-F24', 'M-F24', '2026-09', 'IMPLEMENTED', $2, $3) RETURNING id`,
    [company.id, status, status === "AUDITED" ? new Date() : null]
  );
  const id = rows[0].id;
  await query(
    `INSERT INTO evidence (company_id, quest_id, module_id, month, evidence_id, evidence_type, evidence_name, evidence_link)
     VALUES ($1, 'Q-F24', 'M-F24', '2026-09', $2, 'LINK', 'audited link', 'https://example.com')`,
    [company.id, String(id)]
  );
  return { company, admin, lead, id };
}

const del = (u, id) => request(app).delete(`/api/assessments/${id}`).set("Authorization", `Bearer ${u.token}`);
const exists = async (id) => (await query("SELECT 1 FROM assessments WHERE id = $1", [id])).rows.length === 1;
const evidenceCount = async (cid) => Number((await query("SELECT COUNT(*) FROM evidence WHERE company_id = $1", [cid])).rows[0].count);
const logs = async (cid) => (await query("SELECT email, detail FROM audit_logs WHERE company_id = $1 AND action = 'ASSESSMENT_DELETED'", [cid])).rows;

describe("F-24 deleting assessments", () => {
  test("a LEAD cannot delete an AUDITED assessment or its evidence", async () => {
    const ctx = await setup("AUDITED");
    const res = await del(ctx.lead, ctx.id);
    expect(res.status).toBe(409);
    expect(await exists(ctx.id)).toBe(true);
    expect(await evidenceCount(ctx.company.id)).toBe(1);
  });

  test("an ADMIN can delete an AUDITED assessment, and it is audit-logged", async () => {
    const ctx = await setup("AUDITED");
    expect((await del(ctx.admin, ctx.id)).status).toBe(204);
    expect(await exists(ctx.id)).toBe(false);
    const l = await logs(ctx.company.id);
    expect(l).toHaveLength(1);
    expect(l[0].email).toBe(ctx.admin.email);
    expect(l[0].detail).toMatchObject({ assessmentId: ctx.id, reviewStatus: "AUDITED", evidenceRowsDeleted: 1 });
  });

  test("a LEAD can still delete a non-audited assessment, and it is audit-logged", async () => {
    const ctx = await setup("FINISHED");
    expect((await del(ctx.lead, ctx.id)).status).toBe(204);
    expect(await exists(ctx.id)).toBe(false);
    expect((await logs(ctx.company.id))[0]).toMatchObject({ email: ctx.lead.email });
  });

  test("another tenant's assessment is 404", async () => {
    const ctx = await setup("WIP");
    const other = await createCompany({ domain: `f24o-${Date.now()}.test` });
    const otherAdmin = await createUser(other.id, "ADMIN", { email: `oa-${Date.now()}@f24.test` });
    expect((await del(otherAdmin, ctx.id)).status).toBe(404);
    expect(await exists(ctx.id)).toBe(true);
  });
});
