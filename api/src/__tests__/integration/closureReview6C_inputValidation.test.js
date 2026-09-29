import { beforeEach, describe, expect, test, vi } from "vitest";
import request from "supertest";
import app from "../../app.js";
import { query } from "../../db/index.js";
import { createCompany, createUser } from "../setup/helpers.js";

vi.mock("../../utils/email.js", () => ({ sendEmail: vi.fn().mockResolvedValue(undefined), sendInvitationEmail: vi.fn() }));
vi.mock("../../utils/notifyReviewers.js", () => ({ notifyReviewers: vi.fn().mockResolvedValue(undefined) }));

// Reviewer 6C — input-validation probes on the stricter validation added by the audit work.

async function tenant(label) {
  const s = `${Date.now()}-${Math.random().toString(16).slice(2)}`;
  const company = await createCompany({ domain: `r6c-${label}-${s}.test` });
  const admin = await createUser(company.id, "ADMIN", { email: `a-${label}-${s}@r6c.test` });
  const contributor = await createUser(company.id, "CONTRIBUTOR", { email: `c-${label}-${s}@r6c.test` });
  const auditor = await createUser(company.id, "AUDITOR", { email: `au-${label}-${s}@r6c.test` });
  return { company, admin, contributor, auditor };
}

describe("review6C input validation", () => {
  let T;
  beforeEach(async () => { T = await tenant("iv"); });

  // P4: the new dueDate check (closure review 5, "invalid dueDate -> 400") uses
  // Date.parse, which accepts calendar-invalid and trailing-garbage dates that
  // Postgres DATE then rejects -> unhandled 22008/22007 -> 500.
  test("PUT /api/requests dueDate that JS accepts but Postgres rejects -> 400, not 500", async () => {
    const { rows } = await query(
      `INSERT INTO evidence_requests (company_id, requester_id, title, status) VALUES ($1, $2, 'r', 'Open') RETURNING id`,
      [T.company.id, T.admin.id]
    );
    for (const dueDate of ["2026-02-30", "2026-01-01 junk"]) {
      const res = await request(app).put(`/api/requests/${rows[0].id}`)
        .set("Authorization", `Bearer ${T.admin.token}`).send({ dueDate });
      expect(res.status, dueDate).toBe(400);
    }
  });

  // P4: VALID_MONTH is tested against String(month), but the raw value is stored.
  // month: ["2026-01"] passes the regex and is persisted as the text '{2026-01}',
  // re-parenting evidence rows onto that junk month too.
  test("POST /api/assessments month as a one-element array is rejected", async () => {
    await query("INSERT INTO questions (quest_id, company_id, module_id) VALUES ('Q-R6C-M', $1, 'M') ON CONFLICT DO NOTHING", [T.company.id]);
    const res = await request(app).post("/api/assessments")
      .set("Authorization", `Bearer ${T.contributor.token}`)
      .send({ questId: "Q-R6C-M", moduleId: "M", month: ["2026-01"], answer: "IMPLEMENTED", reviewStatus: "WIP" });
    const stored = (await query("SELECT month FROM assessments WHERE company_id = $1 AND quest_id = 'Q-R6C-M'", [T.company.id])).rows;
    expect({ status: res.status, stored }).toEqual({ status: 400, stored: [] });
  });
});

describe("review6C int4 overflow on new id parameters", () => {
  let T;
  beforeEach(async () => { T = await tenant("ov"); });

  // P4: new digit-only id checks don't cap at int4, so an out-of-range id reaches
  // Postgres ("out of range for type integer") -> 500 instead of 400/404.
  test("POST /api/vault fulfilRequestId beyond int4 -> 4xx", async () => {
    const res = await request(app).post("/api/vault")
      .set("Authorization", `Bearer ${T.admin.token}`)
      .send({ title: "t", fulfilRequestId: "99999999999" });
    expect(res.status).toBeLessThan(500);
  });

  test("POST /api/requests/:id/fulfill vaultId beyond int4 -> 4xx", async () => {
    const { rows } = await query(
      `INSERT INTO evidence_requests (company_id, requester_id, title, status) VALUES ($1, $2, 'r', 'Open') RETURNING id`,
      [T.company.id, T.admin.id]
    );
    const res = await request(app).post(`/api/requests/${rows[0].id}/fulfill`)
      .set("Authorization", `Bearer ${T.admin.token}`)
      .send({ vaultId: "99999999999" });
    expect(res.status).toBeLessThan(500);
  });
});
