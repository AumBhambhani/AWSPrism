import { describe, test, expect } from "vitest";
import request from "supertest";
import app from "../../app.js";
import { query } from "../../db/index.js";
import { createCompany, createUser, createDepartment, setUserDepartments } from "../setup/helpers.js";

async function seedQuestion(companyId, questId, defaultOwner) {
  await query(
    `INSERT INTO questions (quest_id, company_id, module_id, baseline_question, default_owner)
     VALUES ($1, $2, 'M1', 'Q?', $3)`,
    [questId, companyId, defaultOwner]
  );
}

async function setup() {
  const company = await createCompany({ domain: `dept-${Date.now()}-${Math.random()}.com` });
  const admin = await createUser(company.id, "ADMIN", { email: `admin-${Date.now()}@t.com` });
  return { company, admin };
}

describe("departments API", () => {
  test("ADMIN can create, list, rename and delete departments", async () => {
    const { admin } = await setup();
    const auth = { Authorization: `Bearer ${admin.token}` };

    const created = await request(app).post("/api/departments").set(auth).send({ name: " IT " });
    expect(created.status).toBe(201);
    expect(created.body.name).toBe("IT");

    const list = await request(app).get("/api/departments").set(auth);
    expect(list.status).toBe(200);
    expect(list.body.map((d) => d.name)).toEqual(["IT"]);
    expect(list.body[0]).toMatchObject({ memberCount: 0, controlCount: 0 });

    const renamed = await request(app).put(`/api/departments/${created.body.id}`).set(auth).send({ name: "Information Technology" });
    expect(renamed.status).toBe(200);
    expect(renamed.body.name).toBe("Information Technology");

    const del = await request(app).delete(`/api/departments/${created.body.id}`).set(auth);
    expect(del.status).toBe(204);
    const after = await request(app).get("/api/departments").set(auth);
    expect(after.body).toEqual([]);
  });

  test("duplicate names are rejected case-insensitively", async () => {
    const { admin } = await setup();
    const auth = { Authorization: `Bearer ${admin.token}` };
    await request(app).post("/api/departments").set(auth).send({ name: "Legal" });
    const dup = await request(app).post("/api/departments").set(auth).send({ name: "legal" });
    expect(dup.status).toBe(409);
  });

  test("blank names are rejected", async () => {
    const { admin } = await setup();
    const res = await request(app).post("/api/departments").set("Authorization", `Bearer ${admin.token}`).send({ name: "  " });
    expect(res.status).toBe(400);
  });

  test("non-admins cannot manage departments but can list them", async () => {
    const { company } = await setup();
    const lead = await createUser(company.id, "LEAD", { email: `lead-${Date.now()}@t.com` });
    const auth = { Authorization: `Bearer ${lead.token}` };
    expect((await request(app).post("/api/departments").set(auth).send({ name: "HR" })).status).toBe(403);
    expect((await request(app).get("/api/departments").set(auth)).status).toBe(200);
  });

  test("cannot rename or delete another company's department", async () => {
    const { admin } = await setup();
    const other = await createCompany({ domain: `other-${Date.now()}.com` });
    const foreign = await createDepartment(other.id, "Finance");
    const auth = { Authorization: `Bearer ${admin.token}` };
    expect((await request(app).put(`/api/departments/${foreign.id}`).set(auth).send({ name: "X" })).status).toBe(404);
    expect((await request(app).delete(`/api/departments/${foreign.id}`).set(auth)).status).toBe(404);
  });

  test("seed-from-self-assessment creates the self-assessment departments, skipping existing", async () => {
    const { company, admin } = await setup();
    await query("UPDATE companies SET self_assessment_departments = $1 WHERE id = $2", [JSON.stringify(["IT", "Legal", "HR"]), company.id]);
    await createDepartment(company.id, "it");
    const res = await request(app).post("/api/departments/seed-from-self-assessment").set("Authorization", `Bearer ${admin.token}`);
    expect(res.status).toBe(200);
    expect(res.body.created.sort()).toEqual(["HR", "Legal"]);
    const names = (await query("SELECT name FROM departments WHERE company_id = $1 ORDER BY LOWER(name)", [company.id])).rows.map((r) => r.name);
    expect(names).toEqual(["HR", "it", "Legal"]);
  });

  test("map-owners maps default_owner text and reports what is left unassigned", async () => {
    const { company, admin } = await setup();
    const it = await createDepartment(company.id, "IT");
    const sec = await createDepartment(company.id, "Security");
    await seedQuestion(company.id, "Q1", "IT / Security");
    await seedQuestion(company.id, "Q2", "CISO");
    await seedQuestion(company.id, "Q3", "Legal");
    await seedQuestion(company.id, "Q4", null);

    const res = await request(app).post("/api/departments/map-owners").set("Authorization", `Bearer ${admin.token}`);
    expect(res.status).toBe(200);
    expect(res.body.mapped).toBe(2);
    expect(res.body.unassigned).toEqual(expect.arrayContaining([
      { ownerText: "Legal", questCount: 1 },
      { ownerText: "(no owner)", questCount: 1 },
    ]));

    const rows = (await query(
      "SELECT quest_id, department_id FROM question_departments WHERE company_id = $1 ORDER BY quest_id, department_id",
      [company.id]
    )).rows;
    expect(rows).toEqual([
      { quest_id: "Q1", department_id: it.id },
      { quest_id: "Q1", department_id: sec.id },
      { quest_id: "Q2", department_id: sec.id },
    ]);
  });

  test("PUT controls/:questId replaces ownership and rejects foreign department ids", async () => {
    const { company, admin } = await setup();
    const auth = { Authorization: `Bearer ${admin.token}` };
    const it = await createDepartment(company.id, "IT");
    const hr = await createDepartment(company.id, "HR");
    const other = await createCompany({ domain: `o2-${Date.now()}.com` });
    const foreign = await createDepartment(other.id, "Spy");
    await seedQuestion(company.id, "Q1", "IT");

    const bad = await request(app).put("/api/departments/controls/Q1").set(auth).send({ departmentIds: [foreign.id] });
    expect(bad.status).toBe(400);

    const ok = await request(app).put("/api/departments/controls/Q1").set(auth).send({ departmentIds: [it.id, hr.id] });
    expect(ok.status).toBe(200);
    expect(ok.body.departments.map((d) => d.name)).toEqual(["HR", "IT"]);

    const cleared = await request(app).put("/api/departments/controls/Q1").set(auth).send({ departmentIds: [] });
    expect(cleared.body.departments).toEqual([]);

    const missing = await request(app).put("/api/departments/controls/NOPE").set(auth).send({ departmentIds: [it.id] });
    expect(missing.status).toBe(404);
  });

  test("GET /me reports dormant, all-departments and scoped users", async () => {
    const { company, admin } = await setup();
    const contrib = await createUser(company.id, "CONTRIBUTOR", { email: `c-${Date.now()}@t.com` });
    const cAuth = { Authorization: `Bearer ${contrib.token}` };

    const dormant = await request(app).get("/api/departments/me").set(cAuth);
    expect(dormant.body).toMatchObject({ enabled: false, all: true, departmentIds: [] });

    const it = await createDepartment(company.id, "IT");
    const allDefault = await request(app).get("/api/departments/me").set(cAuth);
    expect(allDefault.body).toMatchObject({ enabled: true, all: true });

    await setUserDepartments(contrib.id, [it.id]);
    const scoped = await request(app).get("/api/departments/me").set(cAuth);
    expect(scoped.body).toMatchObject({ enabled: true, all: false, departmentIds: [it.id] });
    expect(scoped.body.departments).toEqual([{ id: it.id, name: "IT" }]);

    const adminMe = await request(app).get("/api/departments/me").set("Authorization", `Bearer ${admin.token}`);
    expect(adminMe.body.all).toBe(true);
  });

  test("question list and detail carry owning departments", async () => {
    const { company, admin } = await setup();
    const auth = { Authorization: `Bearer ${admin.token}` };
    const it = await createDepartment(company.id, "IT");
    await seedQuestion(company.id, "Q1", "IT");
    await seedQuestion(company.id, "Q2", "Legal");
    await request(app).put("/api/departments/controls/Q1").set(auth).send({ departmentIds: [it.id] });

    const list = await request(app).get("/api/questions").set(auth);
    const byId = Object.fromEntries(list.body.map((q) => [q.questId, q]));
    expect(byId.Q1.departments).toEqual([{ id: it.id, name: "IT" }]);
    expect(byId.Q2.departments).toEqual([]);

    const detail = await request(app).get("/api/questions/Q1").set(auth);
    expect(detail.body.departments).toEqual([{ id: it.id, name: "IT" }]);
  });

  test("bulk PUT /controls assigns many controls in one request", async () => {
    const { company, admin } = await setup();
    const auth = { Authorization: `Bearer ${admin.token}` };
    const it = await createDepartment(company.id, "IT");
    const sec = await createDepartment(company.id, "Security");
    await seedQuestion(company.id, "Q1", "IT");
    await seedQuestion(company.id, "Q2", "IT");
    await seedQuestion(company.id, "Q3", "IT");

    const res = await request(app).put("/api/departments/controls").set(auth)
      .send({ questIds: ["Q1", "Q2"], departmentIds: [it.id, sec.id] });
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ updated: 2 });

    const rows = (await query(
      "SELECT quest_id, department_id FROM question_departments WHERE company_id = $1 ORDER BY quest_id, department_id",
      [company.id]
    )).rows;
    expect(rows).toEqual([
      { quest_id: "Q1", department_id: it.id }, { quest_id: "Q1", department_id: sec.id },
      { quest_id: "Q2", department_id: it.id }, { quest_id: "Q2", department_id: sec.id },
    ]);
  });

  test("bulk PUT /controls rejects foreign departments, unknown controls and non-admins", async () => {
    const { company, admin } = await setup();
    const auth = { Authorization: `Bearer ${admin.token}` };
    const it = await createDepartment(company.id, "IT");
    const other = await createCompany({ domain: `o3-${Date.now()}.com` });
    const foreign = await createDepartment(other.id, "Spy");
    await seedQuestion(company.id, "Q1", "IT");
    await seedQuestion(other.id, "QX", "IT");

    expect((await request(app).put("/api/departments/controls").set(auth)
      .send({ questIds: ["Q1"], departmentIds: [foreign.id] })).status).toBe(400);
    expect((await request(app).put("/api/departments/controls").set(auth)
      .send({ questIds: ["Q1", "QX"], departmentIds: [it.id] })).status).toBe(404);
    expect((await request(app).put("/api/departments/controls").set(auth)
      .send({ questIds: [], departmentIds: [it.id] })).status).toBe(400);
    const lead = await createUser(company.id, "LEAD", { email: `l-${Date.now()}@t.com` });
    expect((await request(app).put("/api/departments/controls").set({ Authorization: `Bearer ${lead.token}` })
      .send({ questIds: ["Q1"], departmentIds: [it.id] })).status).toBe(403);
    const count = (await query("SELECT COUNT(*)::int AS n FROM question_departments WHERE company_id = $1", [company.id])).rows[0].n;
    expect(count).toBe(0);
  });
});
