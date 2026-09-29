import { describe, test, expect, vi } from "vitest";
import request from "supertest";
import app from "../../app.js";
import { createCompany, createUser } from "../setup/helpers.js";

vi.mock("../../utils/email.js", () => ({
  sendEmail: vi.fn().mockResolvedValue(undefined),
  sendInvitationEmail: vi.fn().mockResolvedValue(undefined),
}));

describe("GET /api/users", () => {
  test("ADMIN sees all users in company", async () => {
    const company = await createCompany();
    const admin = await createUser(company.id, "ADMIN");
    await createUser(company.id, "CONTRIBUTOR");

    const res = await request(app)
      .get("/api/users")
      .set("Authorization", `Bearer ${admin.token}`);

    expect(res.status).toBe(200);
    expect(Array.isArray(res.body)).toBe(true);
    expect(res.body.length).toBeGreaterThanOrEqual(2);
  });

  test("REVIEWER is forbidden", async () => {
    const company = await createCompany();
    const reviewer = await createUser(company.id, "REVIEWER");

    const res = await request(app)
      .get("/api/users")
      .set("Authorization", `Bearer ${reviewer.token}`);

    expect(res.status).toBe(403);
  });

  test("returns 401 without token", async () => {
    const res = await request(app).get("/api/users");
    expect(res.status).toBe(401);
  });
});

describe("PUT /api/users/me", () => {
  test("user can update their own profile", async () => {
    const company = await createCompany();
    const user = await createUser(company.id, "CONTRIBUTOR");

    const res = await request(app)
      .put("/api/users/me")
      .set("Authorization", `Bearer ${user.token}`)
      .send({ fullName: "Updated Name", department: "Engineering" });

    expect(res.status).toBe(200);
    expect(res.body.fullName ?? res.body.full_name).toBe("Updated Name");
  });
});

describe("POST /api/users/invite", () => {
  test("ADMIN can invite a new user", async () => {
    const company = await createCompany();
    const admin = await createUser(company.id, "ADMIN");

    const res = await request(app)
      .post("/api/users/invite")
      .set("Authorization", `Bearer ${admin.token}`)
      .send({ email: "newuser@testcorp.com", role: "CONTRIBUTOR" });

    expect([200, 201]).toContain(res.status);
  });

  test("CONTRIBUTOR cannot invite users", async () => {
    const company = await createCompany();
    const contributor = await createUser(company.id, "CONTRIBUTOR");

    const res = await request(app)
      .post("/api/users/invite")
      .set("Authorization", `Bearer ${contributor.token}`)
      .send({ email: "other@testcorp.com", role: "REVIEWER" });

    expect(res.status).toBe(403);
  });
});
