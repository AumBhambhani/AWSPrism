import { describe, test, expect } from "vitest";
import request from "supertest";
import app from "../../app.js";
import { query } from "../../db/index.js";
import {
  createCompany, createUser, createDepartment, setUserDepartments, setQuestDepartments,
} from "../setup/helpers.js";

async function seedAssessment(companyId, questId, reviewStatus = "Submitted") {
  const r = await query(
    `INSERT INTO assessments (assessment_id, month, module_id, quest_id, company_id, answer, current_level, review_status, submitted_by)
     VALUES ($1, '2026-09', 'M1', $2, $3, 'IMPLEMENTED', 3, $4, 'someone@t.com') RETURNING *`,
    [`a-${questId}-${Math.random()}`, questId, companyId, reviewStatus]
  );
  return r.rows[0];
}

const statusOf = async (id) => (await query("SELECT review_status FROM assessments WHERE id = $1", [id])).rows[0]?.review_status;

async function scopedWorld() {
  const company = await createCompany({ domain: `lead-${Date.now()}-${Math.random()}.com` });
  const it = await createDepartment(company.id, "IT");
  const legal = await createDepartment(company.id, "Legal");
  await setQuestDepartments(company.id, "Q-IT", [it.id]);
  await setQuestDepartments(company.id, "Q-LEGAL", [legal.id]);
  await setQuestDepartments(company.id, "Q-JOINT", [it.id, legal.id]);
  // Q-NONE deliberately has no owning department.
  const lead = await createUser(company.id, "LEAD", { email: `lead-${Date.now()}@t.com` });
  await setUserDepartments(lead.id, [it.id]);
  return { company, it, legal, lead, auth: { Authorization: `Bearer ${lead.token}` } };
}

const approve = (id, auth) => request(app).put(`/api/assessments/${id}`).set(auth).send({ reviewStatus: "FINISHED" });

describe("department LEAD approval enforcement", () => {
  test("scoped LEAD can approve a control their department owns", async () => {
    const { company, auth } = await scopedWorld();
    const a = await seedAssessment(company.id, "Q-IT");
    expect((await approve(a.id, auth)).status).toBe(200);
    expect(await statusOf(a.id)).toBe("FINISHED");
  });

  test("scoped LEAD cannot approve or reject another department's control", async () => {
    const { company, auth } = await scopedWorld();
    const a = await seedAssessment(company.id, "Q-LEGAL");
    const res = await approve(a.id, auth);
    expect(res.status).toBe(403);
    expect(res.body).toMatchObject({ code: "OUT_OF_DEPARTMENT_SCOPE", owningDepartments: ["Legal"] });
    const reject = await request(app).put(`/api/assessments/${a.id}`).set(auth).send({ reviewStatus: "WIP" });
    expect(reject.status).toBe(403);
    expect(await statusOf(a.id)).toBe("Submitted");
  });

  test("a jointly owned control can be approved by a lead of either department", async () => {
    const { company, auth } = await scopedWorld();
    const a = await seedAssessment(company.id, "Q-JOINT");
    expect((await approve(a.id, auth)).status).toBe(200);
  });

  test("an unassigned control is out of scope for a scoped LEAD", async () => {
    const { company, auth } = await scopedWorld();
    const a = await seedAssessment(company.id, "Q-NONE");
    const res = await approve(a.id, auth);
    expect(res.status).toBe(403);
    expect(res.body.owningDepartments).toEqual([]);
  });

  test("an All-departments LEAD can approve anything", async () => {
    const { company } = await scopedWorld();
    const allLead = await createUser(company.id, "LEAD", { email: `all-${Date.now()}@t.com` });
    const a = await seedAssessment(company.id, "Q-LEGAL");
    expect((await approve(a.id, { Authorization: `Bearer ${allLead.token}` })).status).toBe(200);
  });

  test("ADMIN is never department-limited", async () => {
    const { company, it } = await scopedWorld();
    const admin = await createUser(company.id, "ADMIN", { email: `adm-${Date.now()}@t.com` });
    await setUserDepartments(admin.id, [it.id]);
    const a = await seedAssessment(company.id, "Q-LEGAL");
    expect((await approve(a.id, { Authorization: `Bearer ${admin.token}` })).status).toBe(200);
  });

  test("a company with no departments behaves exactly as before", async () => {
    const company = await createCompany({ domain: `dorm-${Date.now()}.com` });
    const lead = await createUser(company.id, "LEAD", { email: `dl-${Date.now()}@t.com` });
    await query("UPDATE users SET all_departments = FALSE WHERE id = $1", [lead.id]);
    const a = await seedAssessment(company.id, "Q-ANY");
    expect((await approve(a.id, { Authorization: `Bearer ${lead.token}` })).status).toBe(200);
  });

  test("scoped LEAD cannot delete another department's assessment", async () => {
    const { company, auth } = await scopedWorld();
    const a = await seedAssessment(company.id, "Q-LEGAL");
    const res = await request(app).delete(`/api/assessments/${a.id}`).set(auth);
    expect(res.status).toBe(403);
    expect(await statusOf(a.id)).toBe("Submitted");
    const mine = await seedAssessment(company.id, "Q-IT");
    expect((await request(app).delete(`/api/assessments/${mine.id}`).set(auth)).status).toBe(204);
  });
});

describe("contributor soft scope", () => {
  test("?scope=mine filters to the caller's departments; no param returns everything", async () => {
    const { company, it } = await scopedWorld();
    const contrib = await createUser(company.id, "CONTRIBUTOR", { email: `c-${Date.now()}@t.com` });
    await setUserDepartments(contrib.id, [it.id]);
    const auth = { Authorization: `Bearer ${contrib.token}` };
    for (const q of ["Q-IT", "Q-LEGAL", "Q-JOINT", "Q-NONE"]) await seedAssessment(company.id, q);

    const mine = await request(app).get("/api/assessments?scope=mine").set(auth);
    expect(mine.body.map((a) => a.questId).sort()).toEqual(["Q-IT", "Q-JOINT"]);

    const all = await request(app).get("/api/assessments").set(auth);
    expect(all.body).toHaveLength(4);
    const legalRow = all.body.find((a) => a.questId === "Q-LEGAL");
    expect(legalRow.departments).toEqual([{ id: expect.any(Number), name: "Legal" }]);
    expect(all.body.find((a) => a.questId === "Q-NONE").departments).toEqual([]);
  });

  test("?scope=mine is a no-op for an All-departments user", async () => {
    const { company } = await scopedWorld();
    const contrib = await createUser(company.id, "CONTRIBUTOR", { email: `c2-${Date.now()}@t.com` });
    for (const q of ["Q-IT", "Q-LEGAL"]) await seedAssessment(company.id, q);
    const res = await request(app).get("/api/assessments?scope=mine").set({ Authorization: `Bearer ${contrib.token}` });
    expect(res.body).toHaveLength(2);
  });
});
