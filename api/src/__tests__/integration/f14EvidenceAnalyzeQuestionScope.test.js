import { describe, expect, test, vi } from "vitest";
import request from "supertest";
import app from "../../app.js";
import { query } from "../../db/index.js";
import { analyzeEvidence } from "../../utils/aiProvider.js";
import { createCompany, createUser } from "../setup/helpers.js";

vi.mock("../../utils/aiProvider.js", async (importOriginal) => ({
  ...(await importOriginal()),
  analyzeEvidence: vi.fn(async () => ({ contributorComments: "ok", reviewerComments: "ok", gaps: [], suggestions: [] })),
}));

// F-14 — POST /api/evidence/:id/analyze joined questions on quest_id alone, so the
// question context fed to the AI (required evidence, recurrence) could come from any
// tenant's copy of the same quest_id.

describe("F-14 evidence analysis uses the caller's own question copy", () => {
  test("another tenant's copy of the same quest_id is never used", async () => {
    const suffix = `${Date.now()}-${Math.random().toString(16).slice(2)}`;
    const questId = `Q-F14E-${suffix}`;
    const victim = await createCompany({ domain: `f14v-${suffix}.test` });
    const tenant = await createCompany({ domain: `f14t-${suffix}.test` });
    // Victim's copy is inserted first so an unscoped join would tend to pick it.
    await query(
      `INSERT INTO questions (quest_id, company_id, module_id, required_evidence, recurrence_interval)
       VALUES ($1, $2, 'M-F14', 'VICTIM secret requirement', 'weekly'), ($1, $3, 'M-F14', 'Own requirement', 'annual')`,
      [questId, victim.id, tenant.id]
    );
    await query(
      `INSERT INTO company_settings (company_id, ai_enabled) VALUES ($1, TRUE)
       ON CONFLICT (company_id) DO UPDATE SET ai_enabled = TRUE`,
      [tenant.id]
    );
    const admin = await createUser(tenant.id, "ADMIN", { email: `a-${suffix}@f14.test` });
    const { rows } = await query(
      `INSERT INTO evidence (company_id, quest_id, module_id, evidence_type, evidence_name, evidence_link)
       VALUES ($1, $2, 'M-F14', 'LINK', 'Policy link', 'https://example.com/policy') RETURNING id`,
      [tenant.id, questId]
    );

    const res = await request(app).post(`/api/evidence/${rows[0].id}/analyze`).set("Authorization", `Bearer ${admin.token}`);
    expect(res.status).toBe(200);
    const args = vi.mocked(analyzeEvidence).mock.calls.at(-1)[0];
    expect(args.requiredEvidence).toBe("Own requirement");
    expect(args.recurrenceInterval).toBe("annual");
  });
});
