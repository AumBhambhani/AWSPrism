import { describe, test, expect } from "vitest";
import request from "supertest";
import app from "../../app.js";
import { createCompany, createUser, createSuperAdmin } from "../setup/helpers.js";
import { query } from "../../db/index.js";

describe("GET /api/settings", () => {
  test("returns default settings for a company", async () => {
    const company = await createCompany();
    const admin = await createUser(company.id, "ADMIN");

    const res = await request(app)
      .get("/api/settings")
      .set("Authorization", `Bearer ${admin.token}`);

    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty("aiEnabled");
    expect(res.body).toHaveProperty("logoUrl");
  });

  test("returns 401 without token", async () => {
    const res = await request(app).get("/api/settings");
    expect(res.status).toBe(401);
  });
});

describe("GET /api/settings/tech-stack", () => {
  test("returns empty tech stack by default", async () => {
    const company = await createCompany();
    const admin = await createUser(company.id, "ADMIN");

    const res = await request(app)
      .get("/api/settings/tech-stack")
      .set("Authorization", `Bearer ${admin.token}`);

    expect(res.status).toBe(200);
    expect(res.body).toBeDefined();
  });
});

describe("PUT /api/settings/tech-stack", () => {
  test("ADMIN can save tech stack", async () => {
    const company = await createCompany();
    const admin = await createUser(company.id, "ADMIN");

    const stack = { cloud: ["AWS", "GCP"], databases: ["PostgreSQL"] };

    const res = await request(app)
      .put("/api/settings/tech-stack")
      .set("Authorization", `Bearer ${admin.token}`)
      .send(stack);

    expect(res.status).toBe(200);
    expect(res.body.saved).toBe(true);
  });

  test("REVIEWER is forbidden from updating tech stack", async () => {
    const company = await createCompany();
    const reviewer = await createUser(company.id, "REVIEWER");

    const res = await request(app)
      .put("/api/settings/tech-stack")
      .set("Authorization", `Bearer ${reviewer.token}`)
      .send({ cloud: ["AWS"] });

    expect(res.status).toBe(403);
  });
});

describe("AI is opt-in per company", () => {
  test("a fresh company has AI disabled (no company_settings row)", async () => {
    const company = await createCompany({ domain: `ai-optin-${Date.now()}.com` });
    const admin = await createUser(company.id, "ADMIN");

    const res = await request(app)
      .get("/api/settings")
      .set("Authorization", `Bearer ${admin.token}`);
    expect(res.body.aiEnabled).toBe(false);
  });

  test("AI-gated endpoints 403 until a superadmin enables AI", async () => {
    const company = await createCompany({ domain: `ai-gate-${Date.now()}.com` });
    const admin = await createUser(company.id, "ADMIN");
    const su = await createSuperAdmin();

    // The AI-enabled gate is checked before the evidence lookup, so a
    // non-existent evidence id still exercises it.
    const blocked = await request(app)
      .post(`/api/evidence/999999/analyze`)
      .set("Authorization", `Bearer ${admin.token}`);
    expect(blocked.status).toBe(403);
    expect(blocked.body.error).toMatch(/disabled/i);

    // superadmin flips it on
    const toggle = await request(app)
      .patch(`/api/superadmin/companies/${company.id}/ai-toggle`)
      .set("Authorization", `Bearer ${su.token}`)
      .send({ aiEnabled: true });
    expect(toggle.status).toBe(200);

    // now it gets past the gate (404 for the missing evidence, not a 403)
    const allowed = await request(app)
      .post(`/api/evidence/999999/analyze`)
      .set("Authorization", `Bearer ${admin.token}`);
    expect(allowed.status).not.toBe(403);
  });

  test("a company ADMIN cannot enable AI via PUT /api/settings", async () => {
    const company = await createCompany({ domain: `ai-selfserve-${Date.now()}.com` });
    const admin = await createUser(company.id, "ADMIN");

    await request(app)
      .put("/api/settings")
      .set("Authorization", `Bearer ${admin.token}`)
      .send({ aiEnabled: true, primaryColor: "#123456" });

    const row = await query("SELECT ai_enabled FROM company_settings WHERE company_id = $1", [company.id]);
    // row may exist (primaryColor written) but ai_enabled must not be TRUE
    expect(row.rows[0]?.ai_enabled ?? false).toBe(false);
  });
});
