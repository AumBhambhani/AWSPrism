import { describe, expect, test, vi } from "vitest";
import request from "supertest";
import app from "../../app.js";
import { query } from "../../db/index.js";
import { createCompany, createUser } from "../setup/helpers.js";

vi.mock("../../utils/email.js", () => ({
  sendEmail: vi.fn().mockResolvedValue(undefined),
  sendInvitationEmail: vi.fn().mockResolvedValue(undefined),
}));

// F-14 (found by the independent closure review) — assessments.js looked questions up
// by quest_id alone when creating remediation actions, copying another tenant's
// control_area / default_owner into the caller's actions.

const as = (r, u) => r.set("Authorization", `Bearer ${u.token}`);

async function two() {
  const s = `${Date.now()}-${Math.random().toString(16).slice(2)}`;
  const victim = await createCompany({ domain: `f14av-${s}.test` });
  const tenant = await createCompany({ domain: `f14at-${s}.test` });
  const admin = await createUser(tenant.id, "ADMIN", { email: `admin-${s}@f14a.test` });
  const contributor = await createUser(tenant.id, "CONTRIBUTOR", { email: `c-${s}@f14a.test` });
  return { victim, tenant, admin, contributor, s };
}

const gap = (questId, moduleId) => ({
  questId, moduleId, month: "2026-09", answer: "NO", reviewStatus: "FINISHED",
  actionOwner: "me", actionDueDate: "2026-12-01", actionNotes: "n",
});

describe("F-14 assessment actions use the caller's own question copy", () => {
  test("a quest_id that only another tenant has is refused", async () => {
    const { victim, contributor, s } = await two();
    const qid = `Q-VICTIM-${s}`;
    await query(
      `INSERT INTO questions (quest_id, company_id, module_id, control_area, baseline_question, default_owner)
       VALUES ($1, $2, 'MV', 'VICTIM PRIVATE AREA', 'VICTIM PRIVATE TEXT', 'victim-owner@victim.test')`,
      [qid, victim.id]
    );
    const res = await as(request(app).post("/api/assessments"), contributor).send(gap(qid, "MV"));
    expect(res.status).toBe(400);
    const acts = await as(request(app).get(`/api/actions?questId=${qid}`), contributor);
    expect(JSON.stringify(acts.body)).not.toContain("VICTIM PRIVATE");
  });

  test("with only the global row, the action uses global text, not another tenant's override", async () => {
    const { victim, tenant, admin, s } = await two();
    const qid = `Q-SHARED-${s}`;
    await query(
      `INSERT INTO questions (quest_id, company_id, module_id, control_area, baseline_question) VALUES
         ($1, $2, 'MS', 'VICTIM OVERRIDE AREA', 'v'), ($1, NULL, 'MS', 'GLOBAL AREA', 'g')`,
      [qid, victim.id]
    );
    expect((await as(request(app).post("/api/assessments"), admin).send(gap(qid, "MS"))).status).toBeLessThan(300);
    const { rows } = await query("SELECT defeated_quest FROM actions WHERE company_id = $1 AND quest_id = $2", [tenant.id, qid]);
    expect(rows[0]?.defeated_quest).toBe("GLOBAL AREA");
  });

  test("reverting to WIP does not copy another tenant's default_owner", async () => {
    const { victim, tenant, admin, s } = await two();
    const qid = `Q-VICTIM2-${s}`;
    await query(
      `INSERT INTO questions (quest_id, company_id, module_id, control_area, default_owner) VALUES
         ($1, $2, 'MV', 'VICTIM AREA 2', 'victim-owner2@victim.test'),
         ($1, $3, 'MV', 'OWN AREA 2', 'own-owner@tenant.test')`,
      [qid, victim.id, tenant.id]
    );
    const { rows: ar } = await query(
      `INSERT INTO assessments (company_id, quest_id, module_id, month, answer, review_status)
       VALUES ($1, $2, 'MV', '2026-09', 'NO', 'FINISHED') RETURNING id`,
      [tenant.id, qid]
    );
    expect((await as(request(app).put(`/api/assessments/${ar[0].id}`), admin).send({ reviewStatus: "WIP" })).status).toBeLessThan(300);
    const { rows } = await query("SELECT owner, defeated_quest FROM actions WHERE company_id = $1 AND quest_id = $2", [tenant.id, qid]);
    expect(JSON.stringify(rows)).not.toContain("victim");
    expect(rows[0].defeated_quest).toBe("OWN AREA 2");
  });
});
