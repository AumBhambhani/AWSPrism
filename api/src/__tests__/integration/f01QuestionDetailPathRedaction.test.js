import { describe, expect, test, vi } from "vitest";
import request from "supertest";
import app from "../../app.js";
import { query } from "../../db/index.js";
import { createCompany, createUser } from "../setup/helpers.js";

vi.mock("../../utils/scanFile.js", () => ({
  isScannerConfigured: () => false,
  scanBuffer: vi.fn().mockResolvedValue({ safe: true }),
  scanFile: vi.fn().mockResolvedValue({ safe: true }),
}));
vi.mock("../../utils/email.js", () => ({ sendEmail: vi.fn(), sendInvitationEmail: vi.fn() }));

// F-01 property (found by the independent closure review of F-10/F-11): GET
// /api/questions/:questId returned evidence rows with the raw file_path storage ref.

describe("F-01 question detail never exposes storage refs", () => {
  test("evidence on the question detail has no raw filePath", async () => {
    const suffix = `${Date.now()}-${Math.random().toString(16).slice(2)}`;
    const company = await createCompany({ domain: `f01q-${suffix}.test` });
    const user = await createUser(company.id, "CONTRIBUTOR", { email: `c-${suffix}@f01q.test` });
    await query(
      "INSERT INTO questions (quest_id, company_id, module_id, baseline_question) VALUES ('Q-F01Q', $1, 'M-F01Q', 'q')",
      [company.id]
    );
    const up = await request(app).post("/api/evidence").set("Authorization", `Bearer ${user.token}`)
      .attach("file", Buffer.from("evidence"), { filename: "e.txt", contentType: "text/plain" })
      .field("questId", "Q-F01Q").field("moduleId", "M-F01Q").field("month", "2026-09");
    expect(up.status).toBe(201);

    const res = await request(app).get("/api/questions/Q-F01Q").set("Authorization", `Bearer ${user.token}`);
    expect(res.status).toBe(200);
    expect(res.body.evidence.length).toBeGreaterThan(0);
    const body = JSON.stringify(res.body);
    expect(body).not.toMatch(/local:|uploads\//);
    expect(res.body.evidence[0].filePath).toBe(true);
  });
});
