import { beforeEach, describe, expect, test, vi } from "vitest";
import request from "supertest";
import app from "../../app.js";
import { query } from "../../db/index.js";
import { createCompany, createUser } from "../setup/helpers.js";

vi.mock("../../utils/email.js", () => ({ sendEmail: vi.fn().mockResolvedValue(undefined), sendInvitationEmail: vi.fn() }));
vi.mock("../../utils/notifyReviewers.js", () => ({ notifyReviewers: vi.fn().mockResolvedValue(undefined) }));

// Reviewer C — adversarial probes for F-17 (contributor status changes on evidence requests).

async function tenant(label) {
  const s = `${Date.now()}-${Math.random().toString(16).slice(2)}`;
  const company = await createCompany({ domain: `rc17-${label}-${s}.test` });
  const admin = await createUser(company.id, "ADMIN", { email: `a-${label}-${s}@rc17.test` });
  const contributor = await createUser(company.id, "CONTRIBUTOR", { email: `c-${label}-${s}@rc17.test` });
  const other = await createUser(company.id, "CONTRIBUTOR", { email: `o-${label}-${s}@rc17.test` });
  return { company, admin, contributor, other };
}
async function seedRequest(companyId, requesterId, { assigneeId = null, status = "Open", dueDate = "2026-10-01", priority = "Critical", fulfilled = null } = {}) {
  const { rows } = await query(
    `INSERT INTO evidence_requests (company_id, requester_id, assignee_id, title, status, due_date, priority, fulfilled_evidence_id)
     VALUES ($1, $2, $3, 'Mgr request', $4, $5, $6, $7) RETURNING id`,
    [companyId, requesterId, assigneeId, status, dueDate, priority, fulfilled]
  );
  return rows[0].id;
}
const put = (u, id, body) => request(app).put(`/api/requests/${id}`).set("Authorization", `Bearer ${u.token}`).send(body);

describe("reviewC F-17 held checks", () => {
  let T;
  beforeEach(async () => { T = await tenant("t"); });

  test("contributor cannot set manager statuses, incl. case/whitespace variants", async () => {
    const id = await seedRequest(T.company.id, T.admin.id, { assigneeId: T.contributor.id });
    for (const s of ["Submitted", "Completed", "Cancelled"]) expect((await put(T.contributor, id, { status: s })).status).toBe(403);
    for (const s of ["completed", " Completed", "Completed ", "COMPLETED", ["Completed"], { a: 1 }]) {
      expect((await put(T.contributor, id, { status: s })).status).toBe(400);
    }
    const row = (await query("SELECT status, completed_at FROM evidence_requests WHERE id = $1", [id])).rows[0];
    expect(row.status).toBe("Open");
    expect(row.completed_at).toBeNull();
  });

  test("unassigned contributor / cross-tenant id / non-requester DELETE are refused", async () => {
    const id = await seedRequest(T.company.id, T.admin.id, { assigneeId: T.contributor.id });
    expect((await put(T.other, id, { status: "In Progress" })).status).toBe(403);
    const B = await tenant("b");
    expect((await put(B.admin, id, { status: "Completed" })).status).toBe(404);
    expect((await request(app).delete(`/api/requests/${id}`).set("Authorization", `Bearer ${T.contributor.token}`)).status).toBe(403);
  });
});

describe("reviewC F-17 faults", () => {
  let T;
  beforeEach(async () => { T = await tenant("f"); });

  // P4: the contributor-status rule only covers `status`; an assignee can still rewrite
  // the manager's due date / priority and hand the request to someone else.
  test("assigned contributor cannot change manager-set dueDate, priority or assignee", async () => {
    const id = await seedRequest(T.company.id, T.admin.id, { assigneeId: T.contributor.id });
    const res = await put(T.contributor, id, { dueDate: "2099-12-31", priority: "Low", assigneeId: T.other.id });
    expect(res.status).toBe(403);
    const row = (await query("SELECT due_date::text AS d, priority, assignee_id FROM evidence_requests WHERE id = $1", [id])).rows[0];
    expect(row).toEqual({ d: "2026-10-01", priority: "Critical", assignee_id: T.contributor.id });
  });

  // P4: Submitted -> In Progress ("return to contributor") is manager-only in the UI, but
  // the API lets the contributor pull a submission back out of the manager's review queue.
  test("contributor cannot pull a Submitted request back to Open / In Progress", async () => {
    const { rows } = await query("INSERT INTO evidence_vault (company_id, title) VALUES ($1, 'doc') RETURNING id", [T.company.id]);
    const id = await seedRequest(T.company.id, T.admin.id, { assigneeId: T.contributor.id, status: "Submitted", fulfilled: rows[0].id });
    expect((await put(T.contributor, id, { status: "Open" })).status).toBe(403);
    expect((await query("SELECT status FROM evidence_requests WHERE id = $1", [id])).rows[0].status).toBe("Submitted");
  });
});
