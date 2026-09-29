import { describe, test, expect } from "vitest";
import request from "supertest";
import app from "../../app.js";
import { query } from "../../db/index.js";
import { createCompany, createUser, createSuperAdmin } from "../setup/helpers.js";

describe("PATCH /api/superadmin/companies/:id/ai-provider", () => {
  test("SUPERADMIN can switch a company to azure", async () => {
    const company = await createCompany();
    const su = await createSuperAdmin();

    const res = await request(app)
      .patch(`/api/superadmin/companies/${company.id}/ai-provider`)
      .set("Authorization", `Bearer ${su.token}`)
      .send({ aiProvider: "azure" });

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ companyId: company.id, aiProvider: "azure" });

    const row = await query("SELECT ai_provider FROM company_settings WHERE company_id = $1", [company.id]);
    expect(row.rows[0].ai_provider).toBe("azure");
  });

  test("switching back to bedrock then clearing the override", async () => {
    const company = await createCompany();
    const su = await createSuperAdmin();

    await request(app)
      .patch(`/api/superadmin/companies/${company.id}/ai-provider`)
      .set("Authorization", `Bearer ${su.token}`)
      .send({ aiProvider: "bedrock" });

    const clear = await request(app)
      .patch(`/api/superadmin/companies/${company.id}/ai-provider`)
      .set("Authorization", `Bearer ${su.token}`)
      .send({ aiProvider: null });

    expect(clear.status).toBe(200);
    expect(clear.body.aiProvider).toBeNull();

    const row = await query("SELECT ai_provider FROM company_settings WHERE company_id = $1", [company.id]);
    expect(row.rows[0].ai_provider).toBeNull();
  });

  test("rejects an unknown provider value", async () => {
    const company = await createCompany();
    const su = await createSuperAdmin();

    const res = await request(app)
      .patch(`/api/superadmin/companies/${company.id}/ai-provider`)
      .set("Authorization", `Bearer ${su.token}`)
      .send({ aiProvider: "openai" });

    expect(res.status).toBe(400);
  });

  test("returns 404 for a company that does not exist", async () => {
    const su = await createSuperAdmin();

    const res = await request(app)
      .patch(`/api/superadmin/companies/999999/ai-provider`)
      .set("Authorization", `Bearer ${su.token}`)
      .send({ aiProvider: "azure" });

    expect(res.status).toBe(404);
  });

  test("a company ADMIN cannot change the AI provider", async () => {
    const company = await createCompany();
    const admin = await createUser(company.id, "ADMIN");

    const res = await request(app)
      .patch(`/api/superadmin/companies/${company.id}/ai-provider`)
      .set("Authorization", `Bearer ${admin.token}`)
      .send({ aiProvider: "azure" });

    expect(res.status).toBe(403);
  });

  test("the company list reflects the configured provider", async () => {
    const company = await createCompany();
    const su = await createSuperAdmin();

    await request(app)
      .patch(`/api/superadmin/companies/${company.id}/ai-provider`)
      .set("Authorization", `Bearer ${su.token}`)
      .send({ aiProvider: "azure" });

    const list = await request(app)
      .get("/api/superadmin/companies")
      .set("Authorization", `Bearer ${su.token}`);

    expect(list.status).toBe(200);
    const found = list.body.find((c) => c.id === company.id);
    expect(found.ai_provider).toBe("azure");
  });
});
