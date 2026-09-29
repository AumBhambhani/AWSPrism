import { beforeEach, describe, expect, test, vi } from "vitest";
import request from "supertest";
import app from "../../app.js";
import { query } from "../../db/index.js";
import { createCompany, createUser } from "../setup/helpers.js";

vi.mock("../../utils/email.js", () => ({ sendEmail: vi.fn().mockResolvedValue(undefined), sendInvitationEmail: vi.fn() }));
vi.mock("../../utils/notifyReviewers.js", () => ({ notifyReviewers: vi.fn().mockResolvedValue(undefined) }));

// Reviewer 7B — 6C2 follow-up + P4 sweep of client ids/dates still reaching Postgres.
async function tenant() {
  const s = `${Date.now()}-${Math.random().toString(16).slice(2)}`;
  const company = await createCompany({ domain: `r7b-${s}.test` });
  const admin = await createUser(company.id, "ADMIN", { email: `a-${s}@r7b.test` });
  return { company, admin, s };
}

describe("review7B 6C2: isValidDueDate year 0000", () => {
  let T;
  beforeEach(async () => { T = await tenant(); });

  // JS Date accepts year 0000 (round-trips), Postgres DATE has no year 0 -> 22008 -> 500.
  test("FAULT: POST /api/requests dueDate 0000-01-01 -> 400, not 500", async () => {
    const res = await request(app).post("/api/requests").set("Authorization", `Bearer ${T.admin.token}`)
      .send({ title: "r", dueDate: "0000-01-01" });
    expect(res.status).toBe(400);
  });

  test("FAULT: PUT /api/requests/:id dueDate 0000-01-01 -> 400, not 500", async () => {
    const { rows } = await query(
      `INSERT INTO evidence_requests (company_id, requester_id, title, status) VALUES ($1, $2, 'r', 'Open') RETURNING id`,
      [T.company.id, T.admin.id]);
    const res = await request(app).put(`/api/requests/${rows[0].id}`).set("Authorization", `Bearer ${T.admin.token}`)
      .send({ dueDate: "0000-01-01" });
    expect(res.status).toBe(400);
  });
});

describe("review7B P4 sweep: unbounded ids / unvalidated dates -> 500", () => {
  let T;
  beforeEach(async () => { T = await tenant(); });
  const auth = () => ({ Authorization: `Bearer ${T.admin.token}` });

  test("FAULT: GET /api/requests/:id beyond int4 -> 4xx", async () => {
    const res = await request(app).get("/api/requests/99999999999").set(auth());
    expect(res.status).toBeLessThan(500);
  });

  test("FAULT: POST /api/notifications/:id/read with non-numeric id -> 4xx", async () => {
    const res = await request(app).post("/api/notifications/abc/read").set(auth());
    expect(res.status).toBeLessThan(500);
  });

  test("FAULT: PUT /api/questions/:questId dueDate garbage -> 4xx", async () => {
    await query("INSERT INTO questions (quest_id, company_id, module_id) VALUES ($1, $2, 'M') ON CONFLICT DO NOTHING", [`Q-R7B-${T.s}`, T.company.id]);
    const res = await request(app).put(`/api/questions/Q-R7B-${T.s}`).set(auth()).send({ dueDate: "not-a-date" });
    expect(res.status).toBeLessThan(500);
  });

  test("FAULT: PUT /api/auditors/:id expiryDate garbage -> 4xx", async () => {
    const res = await request(app).put("/api/auditors/1").set(auth()).send({ expiryDate: "not-a-date" });
    expect(res.status).toBeLessThan(500);
  });
});
