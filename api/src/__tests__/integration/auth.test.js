import { describe, test, expect, vi } from "vitest";
import request from "supertest";
import app from "../../app.js";
import { createCompany, createUser, createSignupToken } from "../setup/helpers.js";
import { query } from "../../db/index.js";

vi.mock("../../utils/email.js", () => ({
  sendEmail: vi.fn().mockResolvedValue(undefined),
  sendInvitationEmail: vi.fn().mockResolvedValue(undefined),
}));

describe("POST /api/auth/signup/start + /verify", () => {
  test("creates a verification row and verify returns the name/email", async () => {
    const start = await request(app)
      .post("/api/auth/signup/start")
      .send({ fullName: "Jane Doe", email: "jane@acmecorp.io" });
    expect(start.status).toBe(200);

    const row = (await query("SELECT token FROM signup_verifications WHERE email = $1", ["jane@acmecorp.io"])).rows[0];
    expect(row).toBeDefined();

    const verify = await request(app).get(`/api/auth/signup/verify?token=${row.token}`);
    expect(verify.status).toBe(200);
    expect(verify.body).toMatchObject({ email: "jane@acmecorp.io", fullName: "Jane Doe" });
  });

  test("start rejects generic email providers", async () => {
    const res = await request(app)
      .post("/api/auth/signup/start")
      .send({ fullName: "Jane Doe", email: "jane@gmail.com" });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/corporate/i);
  });

  test("start does not leak that an account already exists", async () => {
    const company = await createCompany();
    await createUser(company.id, "ADMIN", { email: "taken@acmecorp.io" });
    const res = await request(app)
      .post("/api/auth/signup/start")
      .send({ fullName: "Someone", email: "taken@acmecorp.io" });
    expect(res.status).toBe(200);
    const rows = (await query("SELECT 1 FROM signup_verifications WHERE email = $1", ["taken@acmecorp.io"])).rows;
    expect(rows.length).toBe(0);
  });

  test("verify rejects an expired token", async () => {
    const v = await createSignupToken({ email: "exp@acmecorp.io" });
    await query("UPDATE signup_verifications SET expires_at = NOW() - INTERVAL '1 minute' WHERE id = $1", [v.id]);
    const res = await request(app).get(`/api/auth/signup/verify?token=${v.token}`);
    expect(res.status).toBe(400);
  });
});

describe("POST /api/auth/register", () => {
  const baseBody = {
    companyName: "Acme Corp",
    domain: "acme-corp",
    password: "Test@1234",
    industry: "Technology",
    companySize: "50-200",
  };

  test("creates company + ADMIN user from a verified sign-up token", async () => {
    const v = await createSignupToken({ email: "admin@acmecorp.io", fullName: "John Admin" });
    const res = await request(app).post("/api/auth/register").send({ ...baseBody, signupToken: v.token });
    expect(res.status).toBe(201);
    expect(res.body.token).toBeDefined();
    expect(res.body.user.role).toBe("ADMIN");
    expect(res.body.user.email).toBe("admin@acmecorp.io");
    expect(res.body.company.name).toBe("Acme Corp");
    expect(res.body.company.isVerified).toBe(false);

    const consumed = (await query("SELECT consumed_at FROM signup_verifications WHERE id = $1", [v.id])).rows[0];
    expect(consumed.consumed_at).not.toBeNull();
  });

  test("rejects a request with no sign-up token", async () => {
    const res = await request(app).post("/api/auth/register").send(baseBody);
    expect(res.status).toBe(400);
  });

  test("rejects an already-consumed sign-up token", async () => {
    const v = await createSignupToken({ email: "admin@acmecorp.io" });
    await query("UPDATE signup_verifications SET consumed_at = NOW() WHERE id = $1", [v.id]);
    const res = await request(app).post("/api/auth/register").send({ ...baseBody, signupToken: v.token });
    expect(res.status).toBe(400);
  });

  test("rejects weak password (no uppercase)", async () => {
    const v = await createSignupToken({ email: "admin@acmecorp.io" });
    const res = await request(app)
      .post("/api/auth/register")
      .send({ ...baseBody, password: "test@1234", signupToken: v.token });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/uppercase/i);
  });

  test("rejects duplicate domain", async () => {
    const v1 = await createSignupToken({ email: "a@acmecorp.io" });
    await request(app).post("/api/auth/register").send({ ...baseBody, signupToken: v1.token });
    const v2 = await createSignupToken({ email: "b@acmecorp.io" });
    const res = await request(app).post("/api/auth/register").send({ ...baseBody, signupToken: v2.token });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/domain/i);
  });
});

describe("POST /api/auth/login", () => {
  test("returns token for valid credentials", async () => {
    const company = await createCompany();
    const user = await createUser(company.id, "ADMIN", { email: "login@testcorp.com" });

    const res = await request(app)
      .post("/api/auth/login")
      .send({ email: "login@testcorp.com", password: "Test@1234" });

    expect(res.status).toBe(200);
    expect(res.body.token).toBeDefined();
    expect(res.body.user.email).toBe("login@testcorp.com");
  });

  test("returns 401 for wrong password", async () => {
    const company = await createCompany();
    await createUser(company.id, "ADMIN", { email: "badpw@testcorp.com" });

    const res = await request(app)
      .post("/api/auth/login")
      .send({ email: "badpw@testcorp.com", password: "Wrong@9999" });

    expect(res.status).toBe(401);
    expect(res.body.error).toBeDefined();
  });

  test("returns 400 for missing email", async () => {
    const res = await request(app)
      .post("/api/auth/login")
      .send({ password: "Test@1234" });
    expect(res.status).toBe(400);
  });
});

describe("GET /api/auth/me", () => {
  test("returns user and company for valid token", async () => {
    const company = await createCompany({ name: "Me Corp" });
    const user = await createUser(company.id, "ADMIN");

    const res = await request(app)
      .get("/api/auth/me")
      .set("Authorization", `Bearer ${user.token}`);

    expect(res.status).toBe(200);
    expect(res.body.user.email).toBe(user.email);
    expect(res.body.company.name).toBe("Me Corp");
  });

  test("returns 401 without token", async () => {
    const res = await request(app).get("/api/auth/me");
    expect(res.status).toBe(401);
  });

  test("returns 401 for invalid token", async () => {
    const res = await request(app)
      .get("/api/auth/me")
      .set("Authorization", "Bearer garbage-token");
    expect(res.status).toBe(401);
  });
});
