import { afterAll, beforeAll, describe, expect, test, vi } from "vitest";
import http from "http";
import request from "supertest";
import app from "../../app.js";
import { query } from "../../db/index.js";
import { createCompany, createUser } from "../setup/helpers.js";
import { __testing } from "../../utils/collectionRunner.js";

vi.mock("../../utils/email.js", () => ({ sendEmail: vi.fn().mockResolvedValue(undefined), sendInvitationEmail: vi.fn() }));
vi.mock("../../utils/notifyReviewers.js", () => ({ notifyReviewers: vi.fn().mockResolvedValue(undefined) }));

// Independent review 7 (reviewer C) probes. Each test asserts the CORRECT behaviour, so
// a red test is a confirmed fault.

const sfx = () => `${Date.now()}-${Math.random().toString(16).slice(2)}`;
const MONTH = new Date().toISOString().slice(0, 7);

async function setup() {
  const c = await createCompany({ domain: `r7c-${sfx()}.test` });
  const me = await createUser(c.id, "CONTRIBUTOR", { email: `me-${sfx()}@r7c.test` });
  const colleague = await createUser(c.id, "CONTRIBUTOR", { email: `col-${sfx()}@r7c.test` });
  await query(`INSERT INTO modules (module_id, company_id, name) VALUES ('M-R7', $1, 'Mod')`, [c.id]);
  await query(`INSERT INTO questions (quest_id, company_id, module_id, baseline_question) VALUES ('Q-R7', $1, 'M-R7', 'Control?')`, [c.id]);
  return { c, me, colleague };
}

describe("review7C: connector number-change rule", () => {
  const { isSignificantEvidenceChange, isClockKey } = __testing;

  // FAULT (P3): CLOCK_KEY_PATTERNS[0] is /^(age|...)([A-Z_]|$)/i — with the i flag
  // [A-Z_] matches any letter, so "agents", "agentCount", "agedBeyondWindow" are
  // treated as clock counters and their changes ignored.
  test("FAULT: 'agents' / 'agentCount' / 'agedBeyondWindow' are not clock keys", () => {
    expect(isClockKey("agents")).toBe(false);
    expect(isClockKey("agentCount")).toBe(false);
    expect(isClockKey("agedBeyondWindow")).toBe(false);
  });

  // carbonite-server/tests/monitoring.js details.agents; crowdstrike detections details.agedBeyondWindow
  test("FAULT: a change in details.agents (0 -> 12) or details.agedBeyondWindow (0 -> 5) is a finding change", () => {
    expect(isSignificantEvidenceChange({ details: { agents: 0 } }, { details: { agents: 12 } })).toBe(true);
    expect(isSignificantEvidenceChange({ details: { agedBeyondWindow: 0 } }, { details: { agedBeyondWindow: 5 } })).toBe(true);
  });

  test("HELD: real clock counters are still noise; retention change is not", () => {
    expect(isSignificantEvidenceChange({ details: { ageDays: 3 } }, { details: { ageDays: 4 } })).toBe(false);
    expect(isSignificantEvidenceChange({ details: { retentionDays: 90 } }, { details: { retentionDays: 0 } })).toBe(true);
  });
});

describe("review7C: POST /api/assessments evidenceIds", () => {
  // FAULT (P4): evidenceIds beyond int4 reach `$2::int[]` -> Postgres 22003 -> 500.
  test("FAULT: evidenceIds beyond int4 is a 400, not a 500", async () => {
    const { me } = await setup();
    const res = await request(app).post("/api/assessments").set("Authorization", `Bearer ${me.token}`).send({
      month: MONTH, moduleId: "M-R7", questId: "Q-R7", answer: "IMPLEMENTED", reviewStatus: "WIP", evidenceIds: [99999999999],
    });
    expect(res.status).not.toBe(500);
  });

  // FAULT (P3, regression from 6A3): Tracker.jsx getResponse() pre-fills resp.files
  // with EVERY evidence row of the quest+month (any uploader) and sends them as
  // evidenceIds on "Save progress" / submit. A contributor continuing a control whose
  // evidence a colleague uploaded (colleague's WIP draft, or not yet attached) now gets
  // 403 NOT_OWN_EVIDENCE — even for a WIP save, with nothing approved involved.
  test("FAULT: contributor saving progress on a colleague's WIP-draft evidence (web Tracker flow) is not refused", async () => {
    const { c, me, colleague } = await setup();
    const draft = (await query(
      `INSERT INTO assessments (company_id, quest_id, module_id, month, answer, current_level, review_status, submitted_by)
       VALUES ($1, 'Q-R7', 'M-R7', $2, 'IMPLEMENTED', 2, 'WIP', $3) RETURNING id`, [c.id, MONTH, colleague.email])).rows[0];
    const ev = (await query(
      `INSERT INTO evidence (company_id, quest_id, module_id, month, evidence_id, evidence_name, evidence_link, uploaded_by)
       VALUES ($1, 'Q-R7', 'M-R7', $2, $3, 'policy.pdf', 'https://e.example/p', $4) RETURNING id`,
      [c.id, MONTH, String(draft.id), colleague.email])).rows[0];
    const res = await request(app).post("/api/assessments").set("Authorization", `Bearer ${me.token}`).send({
      month: MONTH, moduleId: "M-R7", questId: "Q-R7", answer: "IMPLEMENTED", reviewStatus: "WIP", evidenceIds: [ev.id],
    });
    expect(res.status).not.toBe(403);
  });

  test("FAULT: contributor saving progress with a colleague's unattached upload (web Tracker flow) is not refused", async () => {
    const { c, me, colleague } = await setup();
    const ev = (await query(
      `INSERT INTO evidence (company_id, quest_id, module_id, month, evidence_name, evidence_link, uploaded_by)
       VALUES ($1, 'Q-R7', 'M-R7', $2, 'policy.pdf', 'https://e.example/p', $3) RETURNING id`,
      [c.id, MONTH, colleague.email])).rows[0];
    const res = await request(app).post("/api/assessments").set("Authorization", `Bearer ${me.token}`).send({
      month: MONTH, moduleId: "M-R7", questId: "Q-R7", answer: "IMPLEMENTED", reviewStatus: "WIP", evidenceIds: [ev.id],
    });
    expect(res.status).not.toBe(403);
  });

  // FAULT (P4, 6A3 incomplete): the same re-parenting 6A3 refuses on POST is still
  // open on PUT /api/evidence/:id { evidenceId }, sending the colleague's FINISHED back.
  test("FAULT: PUT /api/evidence/:id cannot re-parent a colleague's FINISHED evidence onto my draft", async () => {
    const { c, me, colleague } = await setup();
    const fin = (await query(
      `INSERT INTO assessments (company_id, quest_id, module_id, month, answer, current_level, review_status, submitted_by, reviewed_by, reviewed_at, evidence_link)
       VALUES ($1, 'Q-R7', 'M-R7', $2, 'IMPLEMENTED', 3, 'FINISHED', $3, 'lead@r7c.test', NOW() - INTERVAL '1 minute', 'https://e.example/p') RETURNING id`,
      [c.id, MONTH, colleague.email])).rows[0];
    const ev = (await query(
      `INSERT INTO evidence (company_id, quest_id, module_id, month, evidence_id, evidence_name, evidence_link, uploaded_by, created_at)
       VALUES ($1, 'Q-R7', 'M-R7', $2, $3, 'proof.pdf', 'https://e.example/p', $4, NOW() - INTERVAL '2 minutes') RETURNING id`,
      [c.id, MONTH, String(fin.id), colleague.email])).rows[0];
    const mine = (await query(
      `INSERT INTO assessments (company_id, quest_id, module_id, month, answer, current_level, review_status, submitted_by)
       VALUES ($1, 'Q-R7', 'M-R7', $2, 'IMPLEMENTED', 2, 'WIP', $3) RETURNING id`, [c.id, MONTH, me.email])).rows[0];
    const res = await request(app).put(`/api/evidence/${ev.id}`).set("Authorization", `Bearer ${me.token}`).send({ evidenceId: String(mine.id) });
    const after = (await query("SELECT evidence_id FROM evidence WHERE id = $1", [ev.id])).rows[0].evidence_id;
    const status = (await query("SELECT review_status FROM assessments WHERE id = $1", [fin.id])).rows[0].review_status;
    expect({ http: res.status, owner: after, status }).toMatchObject({ owner: String(fin.id), status: "FINISHED" });
  });
});

// FAULT (P3, 6B1 bypass): azureConnectionStringError parses keys case-insensitively with
// last-wins, the SDK takes the FIRST case-sensitive match, and AccountName is not
// validated although the SDK interpolates it into `${proto}://${AccountName}.blob.${suffix}`.
describe("review7C: storage connection string SSRF", () => {
  let server, port, hits = 0;
  beforeAll(async () => {
    server = http.createServer((req, res) => { hits++; res.writeHead(403); res.end(); });
    await new Promise((r) => server.listen(0, "127.0.0.1", r));
    port = server.address().port;
  });
  afterAll(() => new Promise((r) => server.close(r)));

  test("FAULT: AccountName host injection + duplicate protocol does not reach an internal host", async () => {
    const c = await createCompany({ domain: `r7c-${sfx()}.test` });
    const admin = await createUser(c.id, "ADMIN", { email: `a-${sfx()}@r7c.test` });
    const K = Buffer.from("k").toString("base64");
    const cs = `DefaultEndpointsProtocol=http;DefaultEndpointsProtocol=https;AccountName=127.0.0.1:${port}/x?;AccountKey=${K};EndpointSuffix=core.windows.net`;
    const before = hits;
    const res = await request(app).put("/api/settings/evidence-storage").set("Authorization", `Bearer ${admin.token}`)
      .send({ backend: "azure_blob", config: { container: "c" }, secret: { connectionString: cs } });
    expect({ http: res.status, hits: hits - before }).toMatchObject({ http: 400, hits: 0 });
  }, 60000);
});
