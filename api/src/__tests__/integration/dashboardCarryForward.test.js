import { describe, test, expect } from "vitest";
import request from "supertest";
import app from "../../app.js";
import { createCompany, createUser } from "../setup/helpers.js";
import { query } from "../../db/index.js";

// A FINISHED assessment on a recurring control must keep counting on the
// dashboard for later months until its recurrence window actually elapses —
// matching the web tracker's carry-forward (getEffectiveAssessment /
// carriesForwardTo). Previously the Detailed dashboard was strict month-match,
// so a control approved on 17 Aug (evidence valid through 17 Sept) showed as
// 0 on the September dashboard.
describe("GET /api/dashboard — carry-forward", () => {
  async function seedRecurringApproval(companyId, { questId, recurrence, month, reviewedAt, level = 3 }) {
    await query(
      `INSERT INTO modules (company_id, module_id, name, total_quests)
       VALUES ($1, 'M1', 'Module One', 1)
       ON CONFLICT (company_id, module_id) DO UPDATE SET total_quests = modules.total_quests + 1`,
      [companyId]
    );
    await query(
      `INSERT INTO questions (company_id, quest_id, module_id, baseline_question, control_area, recurrence_interval)
       VALUES ($1, $2, 'M1', 'Implemented?', 'Area', $3)`,
      [companyId, questId, recurrence]
    );
    await query(
      `INSERT INTO assessments
         (company_id, quest_id, module_id, month, answer, current_level, review_status, score_eligible, reviewed_at, updated_at, created_at)
       VALUES ($1, $2, 'M1', $3, 'IMPLEMENTED', $4, 'FINISHED', TRUE, $5, $5, $5)`,
      [companyId, questId, month, level, reviewedAt]
    );
  }

  test("carries a monthly approval forward into the next month, then drops it once the window elapses", async () => {
    const company = await createCompany({ domain: `dashcf1-${Date.now()}.com` });
    const admin = await createUser(company.id, "ADMIN");
    await seedRecurringApproval(company.id, {
      questId: "Q1", recurrence: "monthly", month: "2026-08", reviewedAt: "2026-08-17T12:00:00Z",
    });

    const sept = await request(app)
      .get("/api/dashboard?month=2026-09")
      .set("Authorization", `Bearer ${admin.token}`);
    expect(sept.status).toBe(200);
    expect(sept.body.overall.assessed).toBe(1);
    expect(sept.body.overall.finished).toBe(1);
    expect(sept.body.answerDistribution).toContainEqual({ answer: "IMPLEMENTED", count: 1 });
    expect(sept.body.maturityDistribution.l3).toBe(1);
    expect(sept.body.scoreEligible.count).toBe(1);
    const septM1 = sept.body.moduleCompletion.find(m => m.moduleId === "M1");
    expect(septM1.finished).toBe(1);

    const oct = await request(app)
      .get("/api/dashboard?month=2026-10")
      .set("Authorization", `Bearer ${admin.token}`);
    expect(oct.status).toBe(200);
    expect(oct.body.overall.assessed).toBe(0);
    expect(oct.body.overall.finished).toBe(0);
    expect(oct.body.maturityDistribution.l3).toBe(0);
    expect(oct.body.scoreEligible.count).toBe(0);
  });

  test("does not carry forward a non-recurring control", async () => {
    const company = await createCompany({ domain: `dashcf2-${Date.now()}.com` });
    const admin = await createUser(company.id, "ADMIN");
    await seedRecurringApproval(company.id, {
      questId: "Q1", recurrence: "none", month: "2026-08", reviewedAt: "2026-08-17T12:00:00Z",
    });

    const sept = await request(app)
      .get("/api/dashboard?month=2026-09")
      .set("Authorization", `Bearer ${admin.token}`);
    expect(sept.status).toBe(200);
    expect(sept.body.overall.finished).toBe(0);
  });

  test("an explicit this-month assessment still wins over a carried one", async () => {
    const company = await createCompany({ domain: `dashcf3-${Date.now()}.com` });
    const admin = await createUser(company.id, "ADMIN");
    await seedRecurringApproval(company.id, {
      questId: "Q1", recurrence: "quarterly", month: "2026-08", reviewedAt: "2026-08-17T12:00:00Z",
    });
    // Re-assessed in September, still WIP (not yet approved)
    await query(
      `INSERT INTO assessments
         (company_id, quest_id, module_id, month, answer, current_level, review_status)
       VALUES ($1, 'Q1', 'M1', '2026-09', 'PARTIALLY_IMPLEMENTED', 2, 'WIP')`,
      [company.id]
    );

    const sept = await request(app)
      .get("/api/dashboard?month=2026-09")
      .set("Authorization", `Bearer ${admin.token}`);
    expect(sept.status).toBe(200);
    expect(sept.body.overall.assessed).toBe(1);
    expect(sept.body.overall.finished).toBe(0);
    expect(sept.body.answerDistribution).toContainEqual({ answer: "PARTIALLY_IMPLEMENTED", count: 1 });
  });
});
