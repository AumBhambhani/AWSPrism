import { beforeEach, describe, expect, test, vi } from "vitest";
import request from "supertest";
import app from "../../app.js";
import { query } from "../../db/index.js";
import { sendEmail } from "../../utils/email.js";
import { createCompany, createUser } from "../setup/helpers.js";

vi.mock("../../utils/email.js", () => ({
  sendEmail: vi.fn().mockResolvedValue(undefined),
  sendInvitationEmail: vi.fn().mockResolvedValue(undefined),
}));

// F-09 — evidence requests must never reference, disclose, notify or mutate
// users/records that belong to another tenant.

async function tenant(label) {
  const suffix = `${Date.now()}-${Math.random().toString(16).slice(2)}`;
  const company = await createCompany({ name: `F09 ${label}`, domain: `f09-${label}-${suffix}.test` });
  const admin = await createUser(company.id, "ADMIN", { email: `admin-${label}-${suffix}@f09.test`, fullName: `${label} Admin` });
  const contributor = await createUser(company.id, "CONTRIBUTOR", { email: `contrib-${label}-${suffix}@f09.test`, fullName: `${label} Contributor` });
  return { company, admin, contributor };
}

async function seedRequest(companyId, requesterId, overrides = {}) {
  const { rows } = await query(
    `INSERT INTO evidence_requests (company_id, requester_id, assignee_id, title, status)
     VALUES ($1, $2, $3, $4, $5) RETURNING id`,
    [companyId, requesterId, overrides.assigneeId ?? null, overrides.title ?? "Victim secret request", overrides.status ?? "Open"]
  );
  return rows[0].id;
}

async function seedVault(companyId, title = "Victim vault doc") {
  const { rows } = await query(
    "INSERT INTO evidence_vault (company_id, title, file_name) VALUES ($1, $2, 'victim.pdf') RETURNING id",
    [companyId, title]
  );
  return rows[0].id;
}

async function seedTenantQuestion(companyId, questId) {
  await query(
    `INSERT INTO questions (quest_id, company_id, module_id, module_name, control_area, baseline_question)
     VALUES ($1, $2, 'M-F09', 'Victim module', 'Victim area', 'Victim private question text')`,
    [questId, companyId]
  );
}

const auth = (r, u) => r.set("Authorization", `Bearer ${u.token}`);

describe("F-09 evidence request tenant boundary", () => {
  let A; // attacker
  let B; // victim

  beforeEach(async () => {
    vi.mocked(sendEmail).mockClear();
    A = await tenant("attacker");
    B = await tenant("victim");
  });

  describe("POST /api/requests", () => {
    test.each(["ADMIN", "CONTRIBUTOR"])("%s cannot assign a request to a foreign-tenant user (no leak, no email)", async (role) => {
      const actor = role === "ADMIN" ? A.admin : A.contributor;
      const res = await auth(request(app).post("/api/requests"), actor).send({ title: "x", assigneeId: B.contributor.id });
      expect(res.status).toBe(400);
      expect(JSON.stringify(res.body)).not.toContain(B.contributor.email);
      expect(sendEmail).not.toHaveBeenCalled();
      const { rows } = await query("SELECT 1 FROM evidence_requests WHERE assignee_id = $1", [B.contributor.id]);
      expect(rows).toHaveLength(0);
    });

    test("cannot reference a foreign-tenant assessment", async () => {
      const { rows } = await query("INSERT INTO assessments (company_id, quest_id) VALUES ($1, 'Q-F09') RETURNING id", [B.company.id]);
      const res = await auth(request(app).post("/api/requests"), A.admin).send({ title: "x", assessmentId: rows[0].id });
      expect(res.status).toBe(400);
    });

    test("cannot reference a foreign tenant-specific question (and its text is not disclosed)", async () => {
      await seedTenantQuestion(B.company.id, "Q-F09-PRIVATE");
      const res = await auth(request(app).post("/api/requests"), A.admin).send({ title: "x", questionId: "Q-F09-PRIVATE" });
      expect(res.status).toBe(400);
      expect(JSON.stringify(res.body)).not.toContain("Victim private question text");
    });

    test.each([
      ["assigneeId", "1 OR 1=1"],
      ["assigneeId", "5.5"],
      ["assessmentId", "-1"],
      ["artifactGroupId", "abc"],
    ])("rejects malformed %s=%s", async (field, value) => {
      const res = await auth(request(app).post("/api/requests"), A.admin).send({ title: "x", [field]: value });
      expect(res.status).toBe(400);
    });

    test("same-tenant references are accepted and the assignee is notified", async () => {
      await seedTenantQuestion(A.company.id, "Q-F09-OWN");
      const res = await auth(request(app).post("/api/requests"), A.admin)
        .send({ title: "own", assigneeId: A.contributor.id, questionId: "Q-F09-OWN" });
      expect(res.status).toBe(201);
      expect(res.body.assigneeEmail).toBe(A.contributor.email);
      expect(sendEmail).toHaveBeenCalledTimes(1);
      expect(sendEmail.mock.calls[0][0].to).toBe(A.contributor.email);
    });
  });

  describe("PUT /api/requests/:id", () => {
    test("cannot reassign own request to a foreign-tenant user", async () => {
      const id = await seedRequest(A.company.id, A.admin.id);
      const res = await auth(request(app).put(`/api/requests/${id}`), A.admin).send({ assigneeId: B.contributor.id });
      expect(res.status).toBe(400);
      expect(sendEmail).not.toHaveBeenCalled();
      const { rows } = await query("SELECT assignee_id FROM evidence_requests WHERE id = $1", [id]);
      expect(rows[0].assignee_id).toBeNull();
    });

    test("cannot modify a foreign-tenant request", async () => {
      const id = await seedRequest(B.company.id, B.admin.id);
      const res = await auth(request(app).put(`/api/requests/${id}`), A.admin).send({ title: "pwned", status: "Cancelled", assigneeId: A.contributor.id });
      expect(res.status).toBe(404);
      const { rows } = await query("SELECT title, status, assignee_id FROM evidence_requests WHERE id = $1", [id]);
      expect(rows[0]).toEqual({ title: "Victim secret request", status: "Open", assignee_id: null });
    });

    test("ignores body attempts to move a request's assessment/question/company", async () => {
      const id = await seedRequest(A.company.id, A.admin.id);
      const { rows: ar } = await query("INSERT INTO assessments (company_id, quest_id) VALUES ($1, 'Q-F09') RETURNING id", [B.company.id]);
      await auth(request(app).put(`/api/requests/${id}`), A.admin)
        .send({ title: "t", assessmentId: ar[0].id, questionId: "Q-X", companyId: B.company.id, company_id: B.company.id });
      const { rows } = await query("SELECT company_id, assessment_id, question_id FROM evidence_requests WHERE id = $1", [id]);
      expect(rows[0]).toEqual({ company_id: A.company.id, assessment_id: null, question_id: null });
    });
  });

  describe("read paths", () => {
    test("list never includes foreign-tenant requests", async () => {
      await seedRequest(B.company.id, B.admin.id);
      const res = await auth(request(app).get("/api/requests"), A.admin);
      expect(res.status).toBe(200);
      expect(JSON.stringify(res.body)).not.toContain("Victim secret request");
    });

    test("detail of a foreign-tenant request is 404", async () => {
      const id = await seedRequest(B.company.id, B.admin.id);
      const res = await auth(request(app).get(`/api/requests/${id}`), A.admin);
      expect(res.status).toBe(404);
    });

    test("assignable users list excludes foreign-tenant users", async () => {
      const res = await auth(request(app).get("/api/requests/users"), A.admin);
      expect(res.status).toBe(200);
      const ids = res.body.map((u) => u.id);
      expect(ids).not.toContain(B.admin.id);
      expect(ids).not.toContain(B.contributor.id);
    });
  });

  describe("downstream paths", () => {
    test("cannot fulfil own request with a foreign-tenant vault item", async () => {
      const id = await seedRequest(A.company.id, A.admin.id);
      const vaultId = await seedVault(B.company.id);
      const res = await auth(request(app).post(`/api/requests/${id}/fulfill`), A.admin).send({ vaultId });
      expect(res.status).toBe(404);
      const { rows } = await query("SELECT fulfilled_evidence_id, status FROM evidence_requests WHERE id = $1", [id]);
      expect(rows[0]).toEqual({ fulfilled_evidence_id: null, status: "Open" });
    });

    test("cannot fulfil a foreign-tenant request (no link, no notification)", async () => {
      const id = await seedRequest(B.company.id, B.admin.id);
      const vaultId = await seedVault(A.company.id, "Attacker doc");
      const res = await auth(request(app).post(`/api/requests/${id}/fulfill`), A.admin).send({ vaultId });
      expect(res.status).toBe(404);
      expect(sendEmail).not.toHaveBeenCalled();
      const { rows } = await query("SELECT fulfilled_evidence_id FROM evidence_requests WHERE id = $1", [id]);
      expect(rows[0].fulfilled_evidence_id).toBeNull();
    });

    test("cannot comment on a foreign-tenant request", async () => {
      const id = await seedRequest(B.company.id, B.admin.id);
      const res = await auth(request(app).post(`/api/requests/${id}/comments`), A.admin).send({ body: "hi" });
      expect(res.status).toBe(404);
      const { rows } = await query("SELECT 1 FROM evidence_request_comments WHERE request_id = $1", [id]);
      expect(rows).toHaveLength(0);
    });

    test("cannot cancel a foreign-tenant request", async () => {
      const id = await seedRequest(B.company.id, B.admin.id);
      const res = await auth(request(app).delete(`/api/requests/${id}`), A.admin);
      expect(res.status).toBe(404);
      const { rows } = await query("SELECT status FROM evidence_requests WHERE id = $1", [id]);
      expect(rows[0].status).toBe("Open");
    });
  });

  describe("pre-existing cross-tenant rows (created before references were validated)", () => {
    // Found by the independent closure review: the dashboard's "requests by assignee"
    // rollup joined users without a tenant predicate.
    test.each(["ADMIN", "CONTRIBUTOR"])("%s dashboard does not disclose a foreign assignee", async (role) => {
      await seedRequest(A.company.id, A.admin.id, { assigneeId: B.contributor.id });
      const actor = role === "ADMIN" ? A.admin : A.contributor;
      const res = await auth(request(app).get("/api/dashboard"), actor);
      expect(res.status).toBe(200);
      expect(JSON.stringify(res.body)).not.toContain("victim Contributor");
      expect(JSON.stringify(res.body)).not.toContain(B.contributor.email);
    });

    test("detail does not disclose a foreign assignee's identity", async () => {
      const id = await seedRequest(A.company.id, A.admin.id, { assigneeId: B.contributor.id });
      const res = await auth(request(app).get(`/api/requests/${id}`), A.admin);
      expect(res.status).toBe(200);
      expect(res.body.assigneeEmail ?? null).toBeNull();
      expect(res.body.assigneeName ?? null).toBeNull();
    });

    test("detail does not disclose a foreign fulfilled vault item", async () => {
      const id = await seedRequest(A.company.id, A.admin.id);
      const vaultId = await seedVault(B.company.id, "Victim board minutes");
      await query("UPDATE evidence_requests SET fulfilled_evidence_id = $1 WHERE id = $2", [vaultId, id]);
      const res = await auth(request(app).get(`/api/requests/${id}`), A.admin);
      expect(res.status).toBe(200);
      expect(JSON.stringify(res.body)).not.toContain("Victim board minutes");
    });
  });
});

describe("F-17 contributors cannot complete requests without evidence", () => {
  test.each(["Completed", "Submitted", "Cancelled"])("an assigned CONTRIBUTOR cannot PUT status=%s", async (status) => {
    const A = await tenant("f17");
    const id = await seedRequest(A.company.id, A.admin.id, { assigneeId: A.contributor.id });
    const res = await auth(request(app).put(`/api/requests/${id}`), A.contributor).send({ status });
    expect(res.status).toBe(403);
    const { rows } = await query("SELECT status, fulfilled_evidence_id FROM evidence_requests WHERE id = $1", [id]);
    expect(rows[0]).toEqual({ status: "Open", fulfilled_evidence_id: null });
  });

  test("an assigned CONTRIBUTOR can still mark a request In Progress; a LEAD/ADMIN can complete it", async () => {
    const A = await tenant("f17b");
    const id = await seedRequest(A.company.id, A.admin.id, { assigneeId: A.contributor.id });
    expect((await auth(request(app).put(`/api/requests/${id}`), A.contributor).send({ status: "In Progress" })).status).toBe(200);
    expect((await auth(request(app).put(`/api/requests/${id}`), A.admin).send({ status: "Completed" })).status).toBe(200);
  });
});
