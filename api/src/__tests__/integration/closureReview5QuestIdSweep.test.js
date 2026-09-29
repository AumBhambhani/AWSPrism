import { describe, expect, test, vi } from "vitest";
import request from "supertest";
import app from "../../app.js";
import { query } from "../../db/index.js";
import { createCompany, createUser } from "../setup/helpers.js";

vi.mock("../../utils/email.js", () => ({ sendEmail: vi.fn().mockResolvedValue(undefined), sendInvitationEmail: vi.fn() }));
vi.mock("../../utils/notifyReviewers.js", () => ({ notifyReviewers: vi.fn().mockResolvedValue(undefined) }));
vi.mock("../../utils/scanFile.js", () => ({ isScannerConfigured: () => false, scanBuffer: vi.fn().mockResolvedValue({ safe: true }), scanFile: vi.fn() }));

// Reviewer C — F-22 sweep: write routes that still accept another tenant's private questId.

async function setup() {
  const s = `${Date.now()}-${Math.random().toString(16).slice(2)}`;
  const victim = await createCompany({ domain: `rc22v-${s}.test` });
  const tenant = await createCompany({ domain: `rc22t-${s}.test` });
  const admin = await createUser(tenant.id, "ADMIN", { email: `a-${s}@rc22.test` });
  const vq = `Q-RC22-VICTIM-${s}`;
  const oq = `Q-RC22-OWN-${s}`;
  await query("INSERT INTO questions (quest_id, company_id, module_id) VALUES ($1, $2, 'M'), ($3, $4, 'M')", [vq, victim.id, oq, tenant.id]);
  const { rows: a } = await query("INSERT INTO actions (company_id, quest_id, module_id, owner) VALUES ($1, $2, 'M', 'o') RETURNING id", [tenant.id, oq]);
  const { rows: e } = await query("INSERT INTO evidence (company_id, quest_id, module_id, evidence_name) VALUES ($1, $2, 'M', 'n') RETURNING id", [tenant.id, oq]);
  return { tenant, admin, vq, oq, actionId: a[0].id, evidenceId: e[0].id };
}
const as = (r, u) => r.set("Authorization", `Bearer ${u.token}`);

describe("reviewC F-22 questId sweep", () => {
  test("PUT /api/actions/:id refuses another tenant's questId", async () => {
    const ctx = await setup();
    const res = await as(request(app).put(`/api/actions/${ctx.actionId}`), ctx.admin).send({ questId: ctx.vq });
    expect(res.status).toBe(400);
    expect((await query("SELECT quest_id FROM actions WHERE id = $1", [ctx.actionId])).rows[0].quest_id).toBe(ctx.oq);
  });

  test("PUT /api/evidence/:id refuses another tenant's questId", async () => {
    const ctx = await setup();
    const res = await as(request(app).put(`/api/evidence/${ctx.evidenceId}`), ctx.admin).send({ questId: ctx.vq });
    expect(res.status).toBe(400);
    expect((await query("SELECT quest_id FROM evidence WHERE id = $1", [ctx.evidenceId])).rows[0].quest_id).toBe(ctx.oq);
  });

  test("POST /api/vault (upload with questId auto-link) refuses another tenant's questId", async () => {
    const ctx = await setup();
    const res = await as(request(app).post("/api/vault"), ctx.admin).field("title", "doc").field("questId", ctx.vq);
    expect(res.status).toBe(400);
    const links = await query("SELECT 1 FROM question_evidence WHERE company_id = $1 AND quest_id = $2", [ctx.tenant.id, ctx.vq]);
    expect(links.rows.length).toBe(0);
  });
});
