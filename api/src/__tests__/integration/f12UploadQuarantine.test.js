import { beforeEach, describe, expect, test, vi } from "vitest";
import request from "supertest";
import app from "../../app.js";
import { query } from "../../db/index.js";
import { readObjectBuffer } from "../../utils/evidenceStorage.js";
import { processQuarantine } from "../../utils/uploadQuarantine.js";
import { createCompany, createUser } from "../setup/helpers.js";

// F-12 — while ClamAV is configured but unavailable, uploads are quarantined instead of
// accepted unscanned; the rescan job releases, rejects or expires them.

const scanner = vi.hoisted(() => ({ mode: "unavailable", configured: true, gate: null }));
vi.mock("../../utils/scanFile.js", () => ({
  isScannerConfigured: () => scanner.configured,
  scanBuffer: vi.fn(async () => {
    if (scanner.gate) { const g = scanner.gate; scanner.gate = null; await g; }
    if (scanner.mode === "unavailable") return { safe: false, unavailable: true, reason: "Malware scanner is temporarily unavailable" };
    if (scanner.mode === "infected") return { safe: false, reason: "Malware detected: Eicar-Test-Signature" };
    return { safe: true };
  }),
  scanFile: vi.fn(async () => ({ safe: true })),
}));
vi.mock("../../utils/email.js", () => ({
  sendEmail: vi.fn().mockResolvedValue(undefined),
  sendInvitationEmail: vi.fn().mockResolvedValue(undefined),
}));

const BODY = "quarantined evidence body";
const MONTH = new Date().toISOString().slice(0, 7);

async function setup() {
  const suffix = `${Date.now()}-${Math.random().toString(16).slice(2)}`;
  const company = await createCompany({ domain: `f12-${suffix}.test` });
  const admin = await createUser(company.id, "ADMIN", { email: `admin-${suffix}@f12.test` });
  const lead = await createUser(company.id, "LEAD", { email: `lead-${suffix}@f12.test` });
  const contributor = await createUser(company.id, "CONTRIBUTOR", { email: `c-${suffix}@f12.test` });
  await query(
    `INSERT INTO questions (quest_id, company_id, module_id, module_name, control_area, baseline_question)
     VALUES ('Q-F12', $1, 'M-F12', 'Ops', 'Ops', 'Is malware scanned?')`,
    [company.id]
  );
  return { company, admin, lead, contributor };
}

const as = (r, u) => r.set("Authorization", `Bearer ${u.token}`);
const vaultUpload = (u, fields = {}) => {
  let r = as(request(app).post("/api/vault"), u).attach("file", Buffer.from(BODY), { filename: "scan-me.txt", contentType: "text/plain" }).field("title", "Scan me");
  for (const [k, v] of Object.entries(fields)) r = r.field(k, String(v));
  return r;
};
const quarantineRow = async (id) => (await query("SELECT * FROM upload_quarantine WHERE id = $1", [id])).rows[0];
const vaultCount = async (cid) => Number((await query("SELECT COUNT(*) FROM evidence_vault WHERE company_id = $1", [cid])).rows[0].count);
const notificationsFor = async (u) => (await query("SELECT title FROM notifications WHERE user_id = $1", [u.id])).rows.map((r) => r.title);

beforeEach(() => {
  scanner.mode = "unavailable";
  scanner.configured = true;
});

describe("F-12 upload while the scanner is unavailable", () => {
  test("vault upload is quarantined, not stored as evidence", async () => {
    const { company, contributor } = await setup();
    const res = await vaultUpload(contributor, { questId: "Q-F12" });
    expect(res.status).toBe(202);
    expect(res.body.status).toBe("pending_scan");
    expect(await vaultCount(company.id)).toBe(0);
    const row = await quarantineRow(res.body.quarantineId);
    expect(row.status).toBe("pending");
    expect(row.storage_ref).toMatch(/quarantine/);
    const list = await as(request(app).get("/api/vault"), contributor);
    expect(list.body).toHaveLength(0);
    const held = await as(request(app).get("/api/vault/quarantine"), contributor);
    expect(held.body.map((r) => r.id)).toEqual([res.body.quarantineId]);
  });

  test("rescan while still unavailable keeps it held", async () => {
    const { company, contributor } = await setup();
    const res = await vaultUpload(contributor);
    await processQuarantine();
    expect((await quarantineRow(res.body.quarantineId)).status).toBe("pending");
    expect(await vaultCount(company.id)).toBe(0);
  });

  test("clean rescan releases it exactly like a normal upload and deletes the held copy", async () => {
    const { company, contributor } = await setup();
    const res = await vaultUpload(contributor, { questId: "Q-F12" });
    const held = await quarantineRow(res.body.quarantineId);
    scanner.mode = "clean";
    await processQuarantine();
    const row = await quarantineRow(res.body.quarantineId);
    expect(row.status).toBe("released");
    const { rows } = await query("SELECT id, title, file_name FROM evidence_vault WHERE company_id = $1", [company.id]);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ title: "Scan me", file_name: "scan-me.txt", id: row.result.vaultId });
    const link = await query("SELECT 1 FROM question_evidence WHERE vault_id = $1 AND quest_id = 'Q-F12'", [rows[0].id]);
    expect(link.rows).toHaveLength(1);
    const view = await as(request(app).get(`/api/vault/${rows[0].id}/view`), contributor);
    expect(view.text).toBe(BODY);
    expect(await readObjectBuffer(company.id, held.storage_ref)).toBeNull();
    expect(await notificationsFor(contributor)).toContain("Quarantined upload has been added");
  });

  test("infected rescan deletes it and tells the uploader", async () => {
    const { company, contributor } = await setup();
    const res = await vaultUpload(contributor);
    const held = await quarantineRow(res.body.quarantineId);
    scanner.mode = "infected";
    await processQuarantine();
    expect((await quarantineRow(res.body.quarantineId)).status).toBe("infected");
    expect(await vaultCount(company.id)).toBe(0);
    expect(await readObjectBuffer(company.id, held.storage_ref)).toBeNull();
    expect(await notificationsFor(contributor)).toContain("Upload rejected by the malware scanner");
  });

  test("expires after 24h without a scan", async () => {
    const { company, contributor } = await setup();
    const res = await vaultUpload(contributor);
    await query("UPDATE upload_quarantine SET created_at = NOW() - INTERVAL '25 hours' WHERE id = $1", [res.body.quarantineId]);
    await processQuarantine();
    expect((await quarantineRow(res.body.quarantineId)).status).toBe("expired");
    expect(await vaultCount(company.id)).toBe(0);
    expect(await notificationsFor(contributor)).toContain("Upload expired before it could be scanned");
  });

  test("nothing is released when no scanner is configured", async () => {
    const { contributor } = await setup();
    const res = await vaultUpload(contributor);
    scanner.configured = false;
    scanner.mode = "clean";
    expect(await processQuarantine()).toEqual({ skipped: true });
    expect((await quarantineRow(res.body.quarantineId)).status).toBe("pending");
  });

  test("an uploader who lost write access is not released", async () => {
    const { company, contributor } = await setup();
    const res = await vaultUpload(contributor);
    await query("UPDATE users SET role = 'REVIEWER' WHERE id = $1", [contributor.id]);
    scanner.mode = "clean";
    await processQuarantine();
    expect((await quarantineRow(res.body.quarantineId)).status).toBe("rejected");
    expect(await vaultCount(company.id)).toBe(0);
  });

  test("a suspended company's held upload is not released", async () => {
    const { company, contributor } = await setup();
    const res = await vaultUpload(contributor);
    await query("UPDATE companies SET status = 'suspended' WHERE id = $1", [company.id]);
    scanner.mode = "clean";
    await processQuarantine();
    expect((await quarantineRow(res.body.quarantineId)).status).toBe("rejected");
    expect(await vaultCount(company.id)).toBe(0);
  });

  test("held uploads still expire when no scanner is configured", async () => {
    const { contributor } = await setup();
    const res = await vaultUpload(contributor);
    await query("UPDATE upload_quarantine SET created_at = NOW() - INTERVAL '25 hours' WHERE id = $1", [res.body.quarantineId]);
    scanner.configured = false;
    expect(await processQuarantine()).toEqual({ skipped: true, expired: 1 });
    expect((await quarantineRow(res.body.quarantineId)).status).toBe("expired");
  });

  test("a claim recovered by another run is not released twice (second review race)", async () => {
    const { company, contributor } = await setup();
    const res = await vaultUpload(contributor);
    scanner.mode = "clean";
    let open;
    scanner.gate = new Promise((r) => { open = r; });
    const runA = processQuarantine();                  // claims the row, first scan held
    while (scanner.gate) await new Promise((r) => setTimeout(r, 20));
    await query("UPDATE upload_quarantine SET last_attempt_at = NOW() - INTERVAL '11 minutes' WHERE id = $1", [res.body.quarantineId]);
    await processQuarantine();                         // recovers the stale claim and releases
    open();
    await runA;                                        // original worker must stop
    expect(await vaultCount(company.id)).toBe(1);
    expect((await quarantineRow(res.body.quarantineId)).status).toBe("released");
    expect((await notificationsFor(contributor)).filter((t) => t === "Quarantined upload has been added")).toHaveLength(1);
  });

  test("a row stuck mid-release is never retried automatically", async () => {
    const { company, contributor } = await setup();
    const res = await vaultUpload(contributor);
    await query("UPDATE upload_quarantine SET status = 'finalizing', last_attempt_at = NOW() - INTERVAL '1 hour' WHERE id = $1", [res.body.quarantineId]);
    scanner.mode = "clean";
    vi.spyOn(console, "error").mockImplementation(() => {});
    await processQuarantine();
    expect((await quarantineRow(res.body.quarantineId)).status).toBe("finalizing");
    expect(await vaultCount(company.id)).toBe(0);
  });

  test("a claimed row is not released twice", async () => {
    const { company, contributor } = await setup();
    await vaultUpload(contributor);
    scanner.mode = "clean";
    await Promise.all([processQuarantine(), processQuarantine()]);
    expect(await vaultCount(company.id)).toBe(1);
  });

  test("with the scanner up, uploads are unchanged (201, no quarantine)", async () => {
    const { company, contributor } = await setup();
    scanner.mode = "clean";
    const res = await vaultUpload(contributor);
    expect(res.status).toBe(201);
    expect(await vaultCount(company.id)).toBe(1);
    expect((await query("SELECT 1 FROM upload_quarantine WHERE company_id = $1", [company.id])).rows).toHaveLength(0);
  });

  test("infected at upload time is still rejected immediately", async () => {
    const { contributor } = await setup();
    scanner.mode = "infected";
    expect((await vaultUpload(contributor)).status).toBe(400);
  });
});

describe("F-12 quarantined new versions", () => {
  async function withItem() {
    const ctx = await setup();
    scanner.mode = "clean";
    const up = await vaultUpload(ctx.contributor, { questId: "Q-F12" });
    scanner.mode = "unavailable";
    return { ...ctx, vaultId: up.body.id };
  }
  const versionUpload = (u, vaultId) =>
    as(request(app).post(`/api/vault/${vaultId}/versions`), u).attach("file", Buffer.from("v2 body"), { filename: "v2.txt", contentType: "text/plain" });
  const setStatus = (cid, status) => query(
    `INSERT INTO assessments (company_id, quest_id, module_id, month, answer, review_status, reviewed_at)
     VALUES ($1, 'Q-F12', 'M-F12', $2, 'IMPLEMENTED', $3, NOW())`, [cid, MONTH, status]);

  test("is held, then becomes v2 on release", async () => {
    const { contributor, vaultId } = await withItem();
    const res = await versionUpload(contributor, vaultId);
    expect(res.status).toBe(202);
    const before = await query("SELECT COUNT(*) FROM evidence_versions WHERE evidence_id = $1", [vaultId]);
    expect(Number(before.rows[0].count)).toBe(1);
    scanner.mode = "clean";
    await processQuarantine();
    const after = await query("SELECT version_number FROM evidence_versions WHERE evidence_id = $1 ORDER BY version_number", [vaultId]);
    expect(after.rows.map((r) => r.version_number)).toEqual([1, 2]);
  });

  test("is refused immediately when the control is already audited", async () => {
    const { company, contributor, vaultId } = await withItem();
    await setStatus(company.id, "AUDITED");
    const res = await versionUpload(contributor, vaultId);
    expect(res.status).toBe(409);
    expect((await query("SELECT 1 FROM upload_quarantine WHERE company_id = $1", [company.id])).rows).toHaveLength(0);
  });

  test("is rejected on release if the control was audited while it waited", async () => {
    const { company, contributor, vaultId } = await withItem();
    const res = await versionUpload(contributor, vaultId);
    await setStatus(company.id, "AUDITED");
    scanner.mode = "clean";
    await processQuarantine();
    expect((await quarantineRow(res.body.quarantineId)).status).toBe("rejected");
    const v = await query("SELECT COUNT(*) FROM evidence_versions WHERE evidence_id = $1", [vaultId]);
    expect(Number(v.rows[0].count)).toBe(1);
    expect(await notificationsFor(contributor)).toContain("Quarantined upload could not be added");
  });

  test("reopens review on release when the control is FINISHED", async () => {
    const { company, contributor, vaultId } = await withItem();
    await versionUpload(contributor, vaultId);
    await setStatus(company.id, "FINISHED");
    scanner.mode = "clean";
    await processQuarantine();
    const a = await query("SELECT review_status FROM assessments WHERE company_id = $1", [company.id]);
    expect(a.rows[0].review_status).toBe("Submitted");
  });
});

describe("F-12 quarantined Tracker uploads", () => {
  test("is held, then creates the evidence row and vault mirror on release", async () => {
    const { company, contributor } = await setup();
    const res = await as(request(app).post("/api/evidence"), contributor)
      .attach("file", Buffer.from(BODY), { filename: "tracker.txt", contentType: "text/plain" })
      .field("questId", "Q-F12").field("moduleId", "M-F12").field("month", MONTH);
    expect(res.status).toBe(202);
    expect((await query("SELECT 1 FROM evidence WHERE company_id = $1", [company.id])).rows).toHaveLength(0);
    scanner.mode = "clean";
    await processQuarantine();
    const ev = await query("SELECT quest_id, month, module_id, uploaded_by, evidence_name FROM evidence WHERE company_id = $1", [company.id]);
    expect(ev.rows).toEqual([{ quest_id: "Q-F12", month: MONTH, module_id: "M-F12", uploaded_by: contributor.email, evidence_name: "tracker.txt" }]);
    expect(await vaultCount(company.id)).toBe(1);
  });
});

describe("F-12 release re-checks the Tracker assessment link", () => {
  test("a held Tracker upload attached to an assessment audited while it waited is rejected", async () => {
    const { company, contributor } = await setup();
    const { rows: a } = await query(
      "INSERT INTO assessments (company_id, quest_id, module_id, month, answer, review_status) VALUES ($1, 'Q-F12', 'M-F12', $2, 'IMPLEMENTED', 'Submitted') RETURNING id",
      [company.id, MONTH]
    );
    const res = await as(request(app).post("/api/evidence"), contributor)
      .attach("file", Buffer.from(BODY), { filename: "t.txt", contentType: "text/plain" })
      .field("questId", "Q-F12").field("moduleId", "M-F12").field("month", MONTH).field("evidenceId", String(a[0].id));
    expect(res.status).toBe(202);
    await query("UPDATE assessments SET review_status = 'AUDITED', audited_at = NOW() WHERE id = $1", [a[0].id]);
    scanner.mode = "clean";
    await processQuarantine();
    expect((await quarantineRow(res.body.quarantineId)).status).toBe("rejected");
    expect((await query("SELECT 1 FROM evidence WHERE company_id = $1", [company.id])).rows).toHaveLength(0);
  });
});

describe("F-12 fulfilling an evidence request with a quarantined upload", () => {
  async function requestFor(ctx, assignee) {
    const { rows } = await query(
      "INSERT INTO evidence_requests (company_id, requester_id, assignee_id, title, question_id) VALUES ($1, $2, $3, 'Need policy', 'Q-F12') RETURNING id",
      [ctx.company.id, ctx.lead.id, assignee.id]
    );
    return rows[0].id;
  }

  test("the request is fulfilled automatically once the file clears", async () => {
    const ctx = await setup();
    const requestId = await requestFor(ctx, ctx.contributor);
    const res = await vaultUpload(ctx.contributor, { fulfilRequestId: requestId });
    expect(res.status).toBe(202);
    expect((await query("SELECT status FROM evidence_requests WHERE id = $1", [requestId])).rows[0].status).toBe("Open");
    scanner.mode = "clean";
    await processQuarantine();
    const er = (await query("SELECT status, fulfilled_evidence_id FROM evidence_requests WHERE id = $1", [requestId])).rows[0];
    expect(er.status).toBe("Submitted");
    expect(er.fulfilled_evidence_id).toBe((await quarantineRow(res.body.quarantineId)).result.vaultId);
  });

  test("an upload cannot target a request the uploader may not fulfil", async () => {
    const ctx = await setup();
    const other = await createUser(ctx.company.id, "CONTRIBUTOR", { email: `other-${Date.now()}@f12.test` });
    const requestId = await requestFor(ctx, other);
    const res = await vaultUpload(ctx.contributor, { fulfilRequestId: requestId });
    expect(res.status).toBe(403);
    expect((await query("SELECT 1 FROM upload_quarantine WHERE company_id = $1", [ctx.company.id])).rows).toHaveLength(0);
  });

  test("an upload cannot target another tenant's request", async () => {
    const victim = await setup();
    const attacker = await setup();
    const requestId = await requestFor(victim, victim.contributor);
    const res = await vaultUpload(attacker.admin, { fulfilRequestId: requestId });
    expect(res.status).toBe(404);
  });
});
