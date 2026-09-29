import { afterEach, describe, expect, test, vi } from "vitest";
import request from "supertest";
import app from "../../app.js";
import { query } from "../../db/index.js";
import { createSuperAdmin } from "../setup/helpers.js";
import { seedSuperAdmin } from "../../utils/seedSuperAdmin.js";

vi.mock("../../utils/email.js", () => ({ sendEmail: vi.fn().mockResolvedValue(undefined), sendInvitationEmail: vi.fn() }));

// F-21 — rotating SUPERADMIN_PASSWORD re-hashed the password on boot but left every
// existing super-admin session (7-day JWT) valid.

const saved = { email: process.env.SUPERADMIN_EMAIL, password: process.env.SUPERADMIN_PASSWORD };
afterEach(() => {
  process.env.SUPERADMIN_EMAIL = saved.email;
  process.env.SUPERADMIN_PASSWORD = saved.password;
  if (saved.email === undefined) delete process.env.SUPERADMIN_EMAIL;
  if (saved.password === undefined) delete process.env.SUPERADMIN_PASSWORD;
});

const listCompanies = (token) => request(app).get("/api/superadmin/companies").set("Authorization", `Bearer ${token}`);

describe("F-21 super-admin password rotation revokes sessions", () => {
  test("a session issued before the rotation is refused afterwards; a fresh login works", async () => {
    const sa = await createSuperAdmin({ email: `sa-${Date.now()}@f21.test`, password: "Old@12345" });
    expect((await listCompanies(sa.token)).status).toBe(200);

    process.env.SUPERADMIN_EMAIL = sa.email;
    process.env.SUPERADMIN_PASSWORD = "New@12345";
    await seedSuperAdmin();

    const res = await listCompanies(sa.token);
    expect(res.status).toBe(401);
    expect(res.body.code).toBe("SESSION_REVOKED");

    const login = await request(app).post("/api/auth/login").send({ email: sa.email, password: "New@12345" });
    expect(login.status).toBe(200);
    expect((await listCompanies(login.body.token)).status).toBe(200);
  });

  test("a boot with the unchanged password keeps sessions", async () => {
    const sa = await createSuperAdmin({ email: `sa2-${Date.now()}@f21.test`, password: "Same@12345" });
    process.env.SUPERADMIN_EMAIL = sa.email;
    process.env.SUPERADMIN_PASSWORD = "Same@12345";
    await seedSuperAdmin();
    expect((await listCompanies(sa.token)).status).toBe(200);
    expect((await query("SELECT token_version FROM super_admins WHERE id = $1", [sa.id])).rows[0].token_version).toBe(0);
  });
});
