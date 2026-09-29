import { describe, expect, test } from "vitest";
import request from "supertest";
import app from "../../app.js";
import { query } from "../../db/index.js";
import { createCompany, createUser } from "../setup/helpers.js";

// F-14 — wherever a global catalog row (company_id IS NULL) and the caller's tenant
// override share an id, reads must return exactly one row per id, and it must be the
// tenant's. Archiving the tenant override must not resurrect the global row.

async function setup() {
  const suffix = `${Date.now()}-${Math.random().toString(16).slice(2)}`;
  const mod = `M-F14-${suffix}`;
  const dep = `M-F14D-${suffix}`;
  const q1 = `Q-F14A-${suffix}`; // overridden by tenant
  const q2 = `Q-F14B-${suffix}`; // global only
  const q3 = `Q-F14C-${suffix}`; // tenant override archived
  const company = await createCompany({ domain: `f14-${suffix}.test` });
  const other = await createCompany({ domain: `f14o-${suffix}.test` });
  const admin = await createUser(company.id, "ADMIN", { email: `a-${suffix}@f14.test` });

  await query(
    `INSERT INTO modules (module_id, company_id, name, sort_order) VALUES
       ($1, NULL, 'Global module name', 1), ($1, $2, 'Tenant module name', 1), ($1, $3, 'Other tenant module', 1),
       ($4, NULL, 'Global dep name', 2), ($4, $2, 'Tenant dep name', 2)`,
    [mod, company.id, other.id, dep]
  );
  await query(
    `INSERT INTO questions (quest_id, company_id, module_id, control_area, baseline_question, archived_at) VALUES
       ($1, NULL, $4, 'Area', 'GLOBAL text A', NULL),
       ($1, $5,   $4, 'Area', 'TENANT text A', NULL),
       ($1, $6,   $4, 'Area', 'OTHER TENANT text A', NULL),
       ($2, NULL, $4, 'Area', 'GLOBAL text B', NULL),
       ($3, NULL, $4, 'Area', 'GLOBAL text C', NULL),
       ($3, $5,   $4, 'Area', 'TENANT text C (archived)', NOW())`,
    [q1, q2, q3, mod, company.id, other.id]
  );
  await query("INSERT INTO module_dependencies (company_id, module_id, depends_on_module_id) VALUES ($1, $2, $3)", [company.id, mod, dep]);
  return { company, admin, mod, dep, q1, q2, q3 };
}

const get = (u, path) => request(app).get(path).set("Authorization", `Bearer ${u.token}`);

describe("F-14 questions", () => {
  test("GET /api/questions returns one row per quest_id, preferring the tenant copy", async () => {
    const { admin, q1, q2, q3 } = await setup();
    const res = await get(admin, "/api/questions");
    expect(res.status).toBe(200);
    const mine = res.body.filter((q) => [q1, q2, q3].includes(q.questId));
    expect(mine.map((q) => q.questId).sort()).toEqual([q1, q2].sort());
    expect(mine.find((q) => q.questId === q1).baselineQuestion).toBe("TENANT text A");
    expect(mine.find((q) => q.questId === q2).baselineQuestion).toBe("GLOBAL text B");
  });

  test("GET /api/questions?moduleId= behaves the same", async () => {
    const { admin, mod, q1, q2 } = await setup();
    const res = await get(admin, `/api/questions?moduleId=${mod}`);
    expect(res.body.map((q) => q.questId).sort()).toEqual([q1, q2].sort());
    expect(res.body.find((q) => q.questId === q1).baselineQuestion).toBe("TENANT text A");
  });

  test("an archived tenant override hides the question rather than falling back to global", async () => {
    const { admin, q3 } = await setup();
    const res = await get(admin, "/api/questions");
    expect(res.body.some((q) => q.questId === q3)).toBe(false);
  });
});

describe("F-14 modules", () => {
  test("GET /api/modules lists each module once, with the tenant's name", async () => {
    const { admin, mod, dep } = await setup();
    const res = await get(admin, "/api/modules");
    const rows = res.body.filter((m) => m.moduleId === mod || m.moduleId === dep);
    expect(rows.map((m) => m.name).sort()).toEqual(["Tenant dep name", "Tenant module name"]);
  });

  test("GET /api/modules/:moduleId returns the tenant module and de-duplicated questions", async () => {
    const { admin, mod, q1, q2 } = await setup();
    const res = await get(admin, `/api/modules/${mod}`);
    expect(res.status).toBe(200);
    expect(res.body.name).toBe("Tenant module name");
    expect(res.body.companyId).toBe(admin.company_id);
    expect(res.body.questions.map((q) => q.questId).sort()).toEqual([q1, q2].sort());
    expect(res.body.questions.find((q) => q.questId === q1).baselineQuestion).toBe("TENANT text A");
  });

  test("GET /api/modules/:moduleId/dependencies lists each dependency once, with the tenant's name", async () => {
    const { admin, mod, dep } = await setup();
    const res = await get(admin, `/api/modules/${mod}/dependencies`);
    expect(res.status).toBe(200);
    expect(res.body).toEqual([{ module_id: dep, name: "Tenant dep name" }]);
  });

  test("dashboard module completion lists each module once", async () => {
    const { admin, mod } = await setup();
    const res = await get(admin, "/api/dashboard");
    expect(res.status).toBe(200);
    const rows = res.body.moduleCompletion.filter((m) => m.moduleId === mod);
    expect(rows).toHaveLength(1);
    expect(rows[0].name).toBe("Tenant module name");
  });
});
