import { describe, test, expect } from "vitest";
import request from "supertest";
import app from "../../app.js";
import { query } from "../../db/index.js";
import { createCompany, createUser, createDepartment } from "../setup/helpers.js";

async function setup() {
  const company = await createCompany({ domain: `inv-${Date.now()}-${Math.random()}.com` });
  const admin = await createUser(company.id, "ADMIN", { email: `admin-${Date.now()}@t.com` });
  const it = await createDepartment(company.id, "IT");
  const sec = await createDepartment(company.id, "Security");
  return { company, admin, it, sec, auth: { Authorization: `Bearer ${admin.token}` } };
}

async function membership(userId) {
  const u = (await query("SELECT all_departments, department FROM users WHERE id = $1", [userId])).rows[0];
  const ids = (await query("SELECT department_id FROM user_departments WHERE user_id = $1 ORDER BY department_id", [userId]))
    .rows.map((r) => r.department_id);
  return { allDepartments: u.all_departments, department: u.department, departmentIds: ids };
}

describe("invites carry department membership", () => {
  test("accepting a scoped invite creates the memberships", async () => {
    const { auth, it, sec } = await setup();
    const inv = await request(app).post("/api/users/invite").set(auth)
      .send({ email: "scoped@t.com", role: "LEAD", allDepartments: false, departmentIds: [it.id, sec.id] });
    expect(inv.status).toBe(201);

    const token = inv.body.invitation.token;
    const accepted = await request(app).post("/api/auth/accept-invitation").send({ token, password: "Str0ng!Pass" });
    expect(accepted.status).toBe(200);

    const user = (await query("SELECT id FROM users WHERE email = 'scoped@t.com'")).rows[0];
    expect(await membership(user.id)).toEqual({
      allDepartments: false,
      department: "IT, Security",
      departmentIds: [it.id, sec.id],
    });
  });

  test("an invite without department fields defaults to all departments", async () => {
    const { auth } = await setup();
    const inv = await request(app).post("/api/users/invite").set(auth).send({ email: "plain@t.com", role: "CONTRIBUTOR" });
    await request(app).post("/api/auth/accept-invitation").send({ token: inv.body.invitation.token, password: "Str0ng!Pass" });
    const user = (await query("SELECT id FROM users WHERE email = 'plain@t.com'")).rows[0];
    expect(await membership(user.id)).toMatchObject({ allDepartments: true, departmentIds: [] });
  });

  test("the legacy self-assessment department label on an invite still round-trips", async () => {
    const { auth } = await setup();
    const inv = await request(app).post("/api/users/invite").set(auth)
      .send({ email: "delegate@t.com", role: "CONTRIBUTOR", department: "HR" });
    const accepted = await request(app).post("/api/auth/accept-invitation")
      .send({ token: inv.body.invitation.token, password: "Str0ng!Pass" });
    expect(accepted.body.department).toBe("HR");
  });

  test("inviting with another company's department is rejected", async () => {
    const { auth } = await setup();
    const other = await createCompany({ domain: `x-${Date.now()}.com` });
    const foreign = await createDepartment(other.id, "Spy");
    const inv = await request(app).post("/api/users/invite").set(auth)
      .send({ email: "bad@t.com", role: "CONTRIBUTOR", allDepartments: false, departmentIds: [foreign.id] });
    expect(inv.status).toBe(400);
  });
});

describe("admin edits department membership", () => {
  test("PUT /api/users/:id replaces memberships without needing a role", async () => {
    const { company, auth, it, sec } = await setup();
    const contrib = await createUser(company.id, "CONTRIBUTOR", { email: `c-${Date.now()}@t.com` });

    const first = await request(app).put(`/api/users/${contrib.id}`).set(auth)
      .send({ allDepartments: false, departmentIds: [it.id] });
    expect(first.status).toBe(200);
    expect(first.body).toMatchObject({ role: "CONTRIBUTOR", allDepartments: false, departmentIds: [it.id] });

    await request(app).put(`/api/users/${contrib.id}`).set(auth).send({ allDepartments: false, departmentIds: [sec.id] });
    expect(await membership(contrib.id)).toEqual({ allDepartments: false, department: "Security", departmentIds: [sec.id] });

    await request(app).put(`/api/users/${contrib.id}`).set(auth).send({ allDepartments: true });
    expect(await membership(contrib.id)).toEqual({ allDepartments: true, department: null, departmentIds: [] });
  });

  test("an admin can set their own departments but still not their own role", async () => {
    const { admin, auth, it } = await setup();
    const self = await request(app).put(`/api/users/${admin.id}`).set(auth).send({ allDepartments: false, departmentIds: [it.id] });
    expect(self.status).toBe(200);
    const role = await request(app).put(`/api/users/${admin.id}`).set(auth).send({ role: "LEAD" });
    expect(role.status).toBe(400);
  });

  test("foreign department ids are rejected on update", async () => {
    const { company, auth } = await setup();
    const contrib = await createUser(company.id, "CONTRIBUTOR", { email: `c2-${Date.now()}@t.com` });
    const other = await createCompany({ domain: `y-${Date.now()}.com` });
    const foreign = await createDepartment(other.id, "Spy");
    const res = await request(app).put(`/api/users/${contrib.id}`).set(auth).send({ allDepartments: false, departmentIds: [foreign.id] });
    expect(res.status).toBe(400);
  });

  test("GET /api/users includes department membership", async () => {
    const { company, auth, it } = await setup();
    const contrib = await createUser(company.id, "CONTRIBUTOR", { email: `c3-${Date.now()}@t.com` });
    await request(app).put(`/api/users/${contrib.id}`).set(auth).send({ allDepartments: false, departmentIds: [it.id] });
    const list = await request(app).get("/api/users").set(auth);
    const row = list.body.find((u) => u.id === contrib.id);
    expect(row).toMatchObject({ allDepartments: false, departmentIds: [it.id] });
    const adminRow = list.body.find((u) => u.role === "ADMIN");
    expect(adminRow).toMatchObject({ allDepartments: true, departmentIds: [] });
  });

  test("self-edit of the department label is ignored once the company uses departments", async () => {
    const { company, auth, it } = await setup();
    const contrib = await createUser(company.id, "CONTRIBUTOR", { email: `c4-${Date.now()}@t.com` });
    await request(app).put(`/api/users/${contrib.id}`).set(auth).send({ allDepartments: false, departmentIds: [it.id] });
    const res = await request(app).put("/api/users/me").set({ Authorization: `Bearer ${contrib.token}` })
      .send({ fullName: "New Name", department: "Finance" });
    expect(res.status).toBe(200);
    expect(await membership(contrib.id)).toMatchObject({ department: "IT", departmentIds: [it.id] });
  });
});
