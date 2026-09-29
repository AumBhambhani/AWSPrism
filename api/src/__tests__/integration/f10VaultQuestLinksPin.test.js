import { describe, expect, test, vi } from "vitest";
import request from "supertest";
import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";
import app from "../../app.js";
import { query } from "../../db/index.js";
import { createCompany, createUser } from "../setup/helpers.js";

vi.mock("../../utils/notifyReviewers.js", () => ({
  notifyReviewers: vi.fn().mockResolvedValue(undefined),
}));

// F-10 — GET /api/vault/quest-links returned linked vault metadata and AI analysis
// without the vault PIN that gates the equivalent GET /api/vault?questId=.

const PIN = "482913";
const SECRET_AI = "AI says: board minutes reveal an unreported breach";

async function tenantWithLinkedEvidence({ pin = true } = {}) {
  const suffix = `${Date.now()}-${Math.random().toString(16).slice(2)}`;
  const company = await createCompany({ domain: `f10-${suffix}.test` });
  if (pin) {
    await query(
      `INSERT INTO company_settings (company_id, vault_pin_hash) VALUES ($1, $2)
       ON CONFLICT (company_id) DO UPDATE SET vault_pin_hash = EXCLUDED.vault_pin_hash`,
      [company.id, await bcrypt.hash(PIN, 4)]
    );
  }
  const { rows } = await query(
    `INSERT INTO evidence_vault (company_id, title, file_name, ai_reviewer_comments)
     VALUES ($1, 'Board minutes Q3', 'minutes.pdf', $2) RETURNING id`,
    [company.id, SECRET_AI]
  );
  await query(
    "INSERT INTO question_evidence (company_id, quest_id, vault_id, linked_by) VALUES ($1, 'Q-F10', $2, 'seed')",
    [company.id, rows[0].id]
  );
  return { company, vaultId: rows[0].id };
}

async function userIn(companyId, role) {
  const suffix = `${Date.now()}-${Math.random().toString(16).slice(2)}`;
  const user = await createUser(companyId, role, { email: `${role.toLowerCase()}-${suffix}@f10.test` });
  if (role === "AUDITOR") {
    await query(
      `INSERT INTO auditor_profiles (user_id, company_id, start_date, expiry_date, active)
       VALUES ($1, $2, CURRENT_DATE - 1, CURRENT_DATE + 30, TRUE)`,
      [user.id, companyId]
    );
  }
  return user;
}

// A real vault token, obtained the way the app does it.
const vaultTokenFor = async (user) => {
  const res = await request(app).post("/api/vault/pin/verify").set("Authorization", `Bearer ${user.token}`).send({ pin: PIN });
  expect(res.status).toBe(200);
  return res.body.token;
};

const questLinks = (user, vaultToken) => {
  const r = request(app).get("/api/vault/quest-links?questIds=Q-F10").set("Authorization", `Bearer ${user.token}`);
  return vaultToken ? r.set("X-Vault-Token", vaultToken) : r;
};

describe("F-10 vault quest-links honours the vault PIN", () => {
  test.each(["LEAD", "CONTRIBUTOR", "REVIEWER"])(
    "%s without a vault token is refused when a PIN is set",
    async (role) => {
      const { company } = await tenantWithLinkedEvidence();
      const user = await userIn(company.id, role);
      const res = await questLinks(user);
      expect(res.status).toBe(403);
      expect(res.body.code).toBe("VAULT_PIN_REQUIRED");
      expect(JSON.stringify(res.body)).not.toContain(SECRET_AI);
      expect(JSON.stringify(res.body)).not.toContain("Board minutes");
    }
  );

  test("parity: the PIN-gated GET /api/vault?questId= refuses the same caller", async () => {
    const { company } = await tenantWithLinkedEvidence();
    const lead = await userIn(company.id, "LEAD");
    const res = await request(app).get("/api/vault?questId=Q-F10").set("Authorization", `Bearer ${lead.token}`);
    expect(res.status).toBe(403);
  });

  test("a vault token minted for a different user is refused", async () => {
    const { company } = await tenantWithLinkedEvidence();
    const lead = await userIn(company.id, "LEAD");
    const other = await userIn(company.id, "CONTRIBUTOR");
    const res = await questLinks(lead, await vaultTokenFor(other));
    expect(res.status).toBe(403);
  });

  test("a valid vault token unlocks quest-links", async () => {
    const { company, vaultId } = await tenantWithLinkedEvidence();
    const lead = await userIn(company.id, "LEAD");
    const res = await questLinks(lead, await vaultTokenFor(lead));
    expect(res.status).toBe(200);
    expect(res.body.map((r) => r.id)).toEqual([vaultId]);
  });

  test.each(["ADMIN", "AUDITOR"])("%s is exempt from the PIN", async (role) => {
    const { company } = await tenantWithLinkedEvidence();
    const user = await userIn(company.id, role);
    const res = await questLinks(user);
    expect(res.status).toBe(200);
    expect(res.body).toHaveLength(1);
  });

  test("AUDITOR is exempt on the PIN-gated vault list too", async () => {
    const { company } = await tenantWithLinkedEvidence();
    const auditor = await userIn(company.id, "AUDITOR");
    const list = await request(app).get("/api/vault?questId=Q-F10").set("Authorization", `Bearer ${auditor.token}`);
    expect(list.status).toBe(200);
    expect(list.body).toHaveLength(1);
  });

  test("no PIN set — vault is open to readers", async () => {
    const { company } = await tenantWithLinkedEvidence({ pin: false });
    const lead = await userIn(company.id, "LEAD");
    const res = await questLinks(lead);
    expect(res.status).toBe(200);
    expect(res.body).toHaveLength(1);
  });

  test("never returns another tenant's vault items", async () => {
    await tenantWithLinkedEvidence({ pin: false }); // victim, same quest id
    const attacker = await tenantWithLinkedEvidence({ pin: false });
    const admin = await userIn(attacker.company.id, "ADMIN");
    const res = await questLinks(admin);
    expect(res.body.map((r) => r.id)).toEqual([attacker.vaultId]);
  });

  test("a legacy link row pointing at a foreign vault item is not disclosed", async () => {
    const victim = await tenantWithLinkedEvidence({ pin: false });
    const attacker = await tenantWithLinkedEvidence({ pin: false });
    await query(
      "INSERT INTO question_evidence (company_id, quest_id, vault_id, linked_by) VALUES ($1, 'Q-F10', $2, 'legacy')",
      [attacker.company.id, victim.vaultId]
    );
    const admin = await userIn(attacker.company.id, "ADMIN");
    const res = await questLinks(admin);
    expect(res.body.map((r) => r.id)).toEqual([attacker.vaultId]);
  });
});

describe("F-19 / F-20 vault PIN hardening", () => {
  test("F-20: changing the PIN invalidates outstanding vault tokens", async () => {
    const { company } = await tenantWithLinkedEvidence();
    const lead = await userIn(company.id, "LEAD");
    const admin = await userIn(company.id, "ADMIN");
    const token = await vaultTokenFor(lead);
    expect((await questLinks(lead, token)).status).toBe(200);
    const change = await request(app).put("/api/vault/pin").set("Authorization", `Bearer ${admin.token}`).send({ pin: "135790" });
    expect(change.status).toBe(200);
    expect((await questLinks(lead, token)).status).toBe(403);
  });

  test("F-20: a hand-made token without the PIN fingerprint is refused", async () => {
    const { company } = await tenantWithLinkedEvidence();
    const lead = await userIn(company.id, "LEAD");
    const forged = jwt.sign({ userId: lead.id, companyId: company.id }, process.env.JWT_SECRET + ":vault", { expiresIn: "8h" });
    expect((await questLinks(lead, forged)).status).toBe(403);
  });

  test("F-19: PIN guessing is limited per user", async () => {
    const { company } = await tenantWithLinkedEvidence();
    const lead = await userIn(company.id, "LEAD");
    const guess = (pin) => request(app).post("/api/vault/pin/verify").set("Authorization", `Bearer ${lead.token}`).send({ pin });
    for (let i = 0; i < 10; i++) expect((await guess("000000")).status).toBe(401);
    const blocked = await guess(PIN); // even the right PIN is refused once locked out
    expect(blocked.status).toBe(429);
    expect(blocked.body.code).toBe("VAULT_PIN_LOCKED");
    const other = await userIn(company.id, "CONTRIBUTOR");
    expect((await request(app).post("/api/vault/pin/verify").set("Authorization", `Bearer ${other.token}`).send({ pin: PIN })).status).toBe(200);
  });
});
