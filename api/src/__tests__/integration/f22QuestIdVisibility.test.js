import { describe, expect, test, vi } from "vitest";
import request from "supertest";
import app from "../../app.js";
import { query } from "../../db/index.js";
import { createCompany, createUser } from "../setup/helpers.js";

vi.mock("../../utils/email.js", () => ({ sendEmail: vi.fn().mockResolvedValue(undefined), sendInvitationEmail: vi.fn() }));
vi.mock("../../utils/scanFile.js", () => ({ isScannerConfigured: () => false, scanBuffer: vi.fn().mockResolvedValue({ safe: true }), scanFile: vi.fn() }));

// F-22 — client-supplied questId must be a question the caller's company can see
// (its own or a global template) on actions, reminders, vault links and evidence.

async function setup() {
  const s = `${Date.now()}-${Math.random().toString(16).slice(2)}`;
  const victim = await createCompany({ domain: `f22v-${s}.test` });
  const tenant = await createCompany({ domain: `f22t-${s}.test` });
  const admin = await createUser(tenant.id, "ADMIN", { email: `a-${s}@f22.test` });
  await query("INSERT INTO questions (quest_id, company_id, module_id) VALUES ('Q-VICTIM', $1, 'M'), ('Q-OWN', $2, 'M'), ('Q-GLOBAL-F22', NULL, 'M') ON CONFLICT DO NOTHING", [victim.id, tenant.id]);
  const { rows } = await query("INSERT INTO evidence_vault (company_id, title) VALUES ($1, 'doc') RETURNING id", [tenant.id]);
  return { tenant, admin, vaultId: rows[0].id };
}
const as = (r, u) => r.set("Authorization", `Bearer ${u.token}`);

describe("F-22 questId must be visible to the caller", () => {
  const calls = {
    actions: (ctx, questId) => as(request(app).post("/api/actions"), ctx.admin).send({ questId, moduleId: "M", owner: "o", dueDate: "2026-12-01" }),
    reminders: (ctx, questId) => as(request(app).post("/api/reminders"), ctx.admin).send({ questId, remindAt: "2026-12-01T09:00:00Z", message: "m" }),
    link: (ctx, questId) => as(request(app).post(`/api/vault/${ctx.vaultId}/link`), ctx.admin).send({ questId }),
    evidence: (ctx, questId) => as(request(app).post("/api/evidence"), ctx.admin).send({ questId, moduleId: "M", evidenceLink: "https://e.example", evidenceName: "n" }),
  };
  test.each(Object.keys(calls))("%s refuses another tenant's questId and accepts own/global", async (name) => {
    const ctx = await setup();
    expect((await calls[name](ctx, "Q-VICTIM")).status).toBe(400);
    expect((await calls[name](ctx, ["Q-OWN"])).status).toBe(400);
    expect((await calls[name](ctx, "Q-OWN")).status).toBeLessThan(300);
    expect((await calls[name](ctx, "Q-GLOBAL-F22")).status).toBeLessThan(300);
  });
});
