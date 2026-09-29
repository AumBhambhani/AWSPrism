import { describe, test, expect } from "vitest";
import request from "supertest";
import app from "../../app.js";
import { query } from "../../db/index.js";
import { createCompany, createUser } from "../setup/helpers.js";

/**
 * GET /api/questions/:questId must prefer a tenant-specific row over the
 * global canonical row when both exist for the same quest_id — the normal
 * state for any template-provisioned company, and now also reachable via a
 * lazily-created tenant override (see the F-06 fix in routes/questions.js).
 * Previously this query had no ORDER BY, so Postgres could return either row.
 */
describe("GET /api/questions/:questId prefers the tenant-specific row", () => {
  test("returns the tenant override, not the stale global row, when both exist", async () => {
    const questId = `GETPREF-${Date.now()}`;
    await query(
      `INSERT INTO questions (quest_id, module_id, control_area, baseline_question, priority, company_id)
       VALUES ($1, 'M1', 'Policies for information security', 'Is there a documented policy?', 'Low', NULL)`,
      [questId]
    );

    const company = await createCompany({ domain: `getpref-${Date.now()}.com` });
    const admin = await createUser(company.id, "ADMIN", {
      email: `admin-getpref-${Date.now()}@testcorp.com`,
    });
    // Tenant-specific override, inserted after the global row (mirrors the
    // insertion order ensureTenantQuestion produces).
    await query(
      `INSERT INTO questions (quest_id, module_id, control_area, baseline_question, priority, company_id)
       VALUES ($1, 'M1', 'Policies for information security', 'Is there a documented policy?', 'Critical', $2)`,
      [questId, company.id]
    );

    const res = await request(app)
      .get(`/api/questions/${questId}`)
      .set("Authorization", `Bearer ${admin.token}`);

    expect(res.status).toBe(200);
    expect(res.body.priority).toBe("Critical");
    expect(res.body.companyId).toBe(company.id);
  });

  test("still falls back to the global row when the tenant has no override", async () => {
    const questId = `GETPREF-GLOBAL-${Date.now()}`;
    await query(
      `INSERT INTO questions (quest_id, module_id, control_area, baseline_question, priority, company_id)
       VALUES ($1, 'M1', 'Policies for information security', 'Is there a documented policy?', 'Medium', NULL)`,
      [questId]
    );
    const company = await createCompany({ domain: `getpref-g-${Date.now()}.com` });
    const admin = await createUser(company.id, "ADMIN", {
      email: `admin-getpref-g-${Date.now()}@testcorp.com`,
    });

    const res = await request(app)
      .get(`/api/questions/${questId}`)
      .set("Authorization", `Bearer ${admin.token}`);

    expect(res.status).toBe(200);
    expect(res.body.priority).toBe("Medium");
    expect(res.body.companyId).toBeNull();
  });
});
