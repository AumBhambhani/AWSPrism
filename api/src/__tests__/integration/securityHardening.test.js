import { describe, test, expect, vi } from "vitest";
import request from "supertest";
import app from "../../app.js";
import { createCompany, createUser } from "../setup/helpers.js";
import { query } from "../../db/index.js";

vi.mock("../../utils/email.js", () => ({
  sendEmail: vi.fn().mockResolvedValue(undefined),
  sendInvitationEmail: vi.fn().mockResolvedValue(undefined),
}));
vi.mock("../../utils/scanFile.js", () => ({
  scanFile: vi.fn().mockResolvedValue({ safe: true }),
  scanBuffer: vi.fn().mockResolvedValue({ safe: true }),
}));
vi.mock("../../utils/notifyReviewers.js", () => ({
  notifyReviewers: vi.fn().mockResolvedValue(undefined),
}));

describe("PRISM-002 — evidence request references are tenant-scoped", () => {
  test("cannot assign a request to a user in another company", async () => {
    const a = await createCompany();
    const b = await createCompany();
    const adminA = await createUser(a.id, "ADMIN");
    const userB = await createUser(b.id, "CONTRIBUTOR");

    const res = await request(app)
      .post("/api/requests")
      .set("Authorization", `Bearer ${adminA.token}`)
      .send({ title: "x", assigneeId: userB.id });
    expect(res.status).toBe(400);
  });

  test("cannot attach another company's assessment", async () => {
    const a = await createCompany();
    const b = await createCompany();
    const adminA = await createUser(a.id, "ADMIN");
    const { rows } = await query(
      "INSERT INTO assessments (company_id, quest_id) VALUES ($1, 'Q-X') RETURNING id",
      [b.id]
    );

    const res = await request(app)
      .post("/api/requests")
      .set("Authorization", `Bearer ${adminA.token}`)
      .send({ title: "x", assessmentId: rows[0].id });
    expect(res.status).toBe(400);
  });

  test("same-tenant assignee is accepted", async () => {
    const a = await createCompany();
    const adminA = await createUser(a.id, "ADMIN");
    const userA = await createUser(a.id, "CONTRIBUTOR");

    const res = await request(app)
      .post("/api/requests")
      .set("Authorization", `Bearer ${adminA.token}`)
      .send({ title: "x", assigneeId: userA.id });
    expect(res.status).toBe(201);
  });
});

describe("PRISM-003 — password reset rate limiting", () => {
  test("forgot-password is limited per target email", async () => {
    const email = `victim-${Date.now()}@example.com`;
    const statuses = [];
    for (let i = 0; i < 5; i++) {
      const res = await request(app).post("/api/auth/forgot-password").send({ email });
      statuses.push(res.status);
    }
    expect(statuses.slice(0, 3).every((s) => s === 200)).toBe(true);
    expect(statuses.slice(3)).toEqual([429, 429]);
  });

  test("verify-otp is limited per target email", async () => {
    const email = `guess-${Date.now()}@example.com`;
    let last;
    for (let i = 0; i < 12; i++) {
      last = await request(app).post("/api/auth/verify-otp").send({ email, otp: "000000" });
    }
    expect(last.status).toBe(429);
  });
});

describe("PRISM-005 — upload restrictions", () => {
  test("rejects an extension that does not match the declared type", async () => {
    const c = await createCompany();
    const admin = await createUser(c.id, "ADMIN");
    const res = await request(app)
      .post("/api/vault")
      .set("Authorization", `Bearer ${admin.token}`)
      .attach("file", Buffer.from("<script>alert(1)</script>"), { filename: "x.html", contentType: "text/plain" })
      .field("title", "bad");
    expect(res.status).toBe(400);
  });
});

describe("PRISM-004 — no filesystem paths in responses", () => {
  test("vault upload response does not expose storagePath", async () => {
    const c = await createCompany();
    const admin = await createUser(c.id, "ADMIN");
    const res = await request(app)
      .post("/api/vault")
      .set("Authorization", `Bearer ${admin.token}`)
      .attach("file", Buffer.from("hello"), { filename: "ok.txt", contentType: "text/plain" })
      .field("title", "ok");
    expect(res.status).toBe(201);
    expect(JSON.stringify(res.body)).not.toMatch(/uploads|local:/);
    expect(res.body.storagePath).toBe(true);
  });
});
