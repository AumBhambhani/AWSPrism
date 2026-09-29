import { describe, test, expect, vi } from "vitest";
import { createCompany, createUser } from "../setup/helpers.js";
import { query } from "../../db/index.js";
import { storeCredential } from "../../db/integrationCredentials.js";

// Independent review 7 (reviewer 7A) — 6A1 "same finding" rule vs. the numeric keys the
// real connectors emit. User decision: a number under a clock-driven key (age /
// time-since / time-until counter) is noise; every other number is a finding change.

vi.mock("../../utils/email.js", () => ({ sendEmail: vi.fn().mockResolvedValue(undefined), sendInvitationEmail: vi.fn() }));
vi.mock("../../utils/notifyReviewers.js", () => ({ notifyReviewers: vi.fn().mockResolvedValue(undefined) }));

const runTests = vi.fn();
vi.mock("../../connectors/registry.js", () => ({
  getConnector: vi.fn(() => ({ key: "aws", testConnection: vi.fn(), runTests })),
}));

const { runCollection, __testing } = await import("../../utils/collectionRunner.js");
const { buildEvidencePayload } = await import("../../connectors/shared/evidencePayload.js");
const { isSignificantEvidenceChange } = __testing;

const sfx = () => `${Date.now()}-${Math.random().toString(16).slice(2)}`;

async function setup() {
  const company = await createCompany({ domain: `r7a-${sfx()}.test` });
  await createUser(company.id, "ADMIN", { email: `admin-${sfx()}@r7a.test` });
  await query(`INSERT INTO modules (module_id, company_id, name) VALUES ('M1', $1, 'Access Control')`, [company.id]);
  // Q1 <- aws.iam.mfa_enforced (A.9.4.2); Q2 <- aws.network.s3_public_access_blocked (A.8.2.3)
  await query(`INSERT INTO questions (quest_id, company_id, module_id, iso_reference) VALUES ('Q1', $1, 'M1', 'A.9.4.2'), ('Q2', $1, 'M1', 'A.8.2.3')`, [company.id]);
  const conn = (await query(
    `INSERT INTO integration_connections (company_id, integration_key, name) VALUES ($1, 'aws', 'Prod') RETURNING *`,
    [company.id]
  )).rows[0];
  await storeCredential({ connectionId: conn.id, companyId: company.id, authType: "iam_role", secret: { externalId: "ext-1" } });
  const run = () => runCollection({ connectionId: conn.id, companyId: company.id, triggerType: "manual" });
  return { company, run };
}
const MONTH = new Date().toISOString().slice(0, 7);
async function insertAudited(companyId, questId) {
  return (await query(
    `INSERT INTO assessments (month, module_id, quest_id, company_id, answer, review_status, score_eligible, reviewed_by, reviewed_at, audited_by, audited_at, audit_period_end)
     VALUES ($1, 'M1', $2, $3, 'IMPLEMENTED', 'AUDITED', TRUE, 'reviewer@r7a.test', NOW(), 'auditor@r7a.test', NOW(), CURRENT_DATE + 20) RETURNING id`,
    [MONTH, questId, companyId]
  )).rows[0].id;
}
const statusOf = async (id) => (await query(`SELECT review_status FROM assessments WHERE id = $1`, [id])).rows[0].review_status;

// Payload shapes copied from the connectors (poll N vs poll N+1, one day apart).
const REAL_CLOCK_DRIFT = {
  // akamai/tests/cps.js:54 (pass AND fail rows): days until the cert expires, -1 per day
  "akamai cps daysToExpiry": [{ expiry: "2026-12-01T00:00:00Z", daysToExpiry: 67, thresholdDays: 30 }, { expiry: "2026-12-01T00:00:00Z", daysToExpiry: 66, thresholdDays: 30 }],
  // onetrust/tests/risk.js:68 (fail rows): days past the treatment deadline, +1 per day
  "onetrust risk overdueDays": [
    buildEvidencePayload({ resourceType: "onetrust_risk", resourceId: "r1", resourceName: "r1", region: null, details: { level: "High", deadline: "2026-09-01", overdueDays: 24 } }),
    buildEvidencePayload({ resourceType: "onetrust_risk", resourceId: "r1", resourceName: "r1", region: null, details: { level: "High", deadline: "2026-09-01", overdueDays: 25 } }),
  ],
  // onetrust/tests/privacyRights.js:73 + privy/tests/dataRights.js:79 (fail rows): DSAR age minus paused days
  "dsar activeDays": [
    buildEvidencePayload({ resourceType: "onetrust_dsar_request", resourceId: "d1", resourceName: "d1", region: null, details: { status: "In Progress", creationDate: "2026-08-01", daysPaused: 0, activeDays: 55 } }),
    buildEvidencePayload({ resourceType: "onetrust_dsar_request", resourceId: "d1", resourceName: "d1", region: null, details: { status: "In Progress", creationDate: "2026-08-01", daysPaused: 0, activeDays: 56 } }),
  ],
  // salesforce/tests/audit.js:55: daysSince(oldest trail entry)
  "salesforce audit spanDays": [
    buildEvidencePayload({ resourceType: "salesforce_setup_audit_trail", resourceId: "setup-audit-trail", resourceName: "Setup Audit Trail", region: null, details: { entries: 120, oldestEntry: "2026-06-01T00:00:00.000+0000", newestEntry: "2026-09-20T00:00:00.000+0000", spanDays: 116, requiredWindowDays: 180 } }),
    buildEvidencePayload({ resourceType: "salesforce_setup_audit_trail", resourceId: "setup-audit-trail", resourceName: "Setup Audit Trail", region: null, details: { entries: 120, oldestEntry: "2026-06-01T00:00:00.000+0000", newestEntry: "2026-09-20T00:00:00.000+0000", spanDays: 117, requiredWindowDays: 180 } }),
  ],
};

describe("review7A: real clock-driven counters must count as 'same finding'", () => {
  for (const [name, [before, after]] of Object.entries(REAL_CLOCK_DRIFT)) {
    test(`${name} ticking by one day is not a finding change`, () => {
      expect(isSignificantEvidenceChange(before, after)).toBe(false);
    });
  }

  test("end-to-end: a passing cert-expiry check whose daysToExpiry ticks down keeps the audit", async () => {
    const { company, run } = await setup();
    const pass = (payload) => ({ testKey: "aws.iam.mfa_enforced", title: "t", severity: "critical", resourceId: "www.example.com", status: "pass", message: "ok", evidencePayload: payload });
    const [d1, d2] = REAL_CLOCK_DRIFT["akamai cps daysToExpiry"];
    runTests.mockResolvedValueOnce([pass(d1)]);
    await run();
    const id = await insertAudited(company.id, "Q1");
    runTests.mockResolvedValueOnce([pass(d2)]);
    await run();
    expect(await statusOf(id)).toBe("AUDITED");
  });

  test("end-to-end: an open OneTrust overdue-risk finding whose overdueDays ticks up keeps the audit", async () => {
    const { company, run } = await setup();
    const fail = (payload) => ({ testKey: "aws.network.s3_public_access_blocked", title: "t", severity: "high", resourceId: "r1", status: "fail", message: "overdue", evidencePayload: payload });
    const [d1, d2] = REAL_CLOCK_DRIFT["onetrust risk overdueDays"];
    runTests.mockResolvedValueOnce([fail(d1)]);
    await run();
    const id = await insertAudited(company.id, "Q2");
    runTests.mockResolvedValueOnce([fail(d2)]);
    await run();
    expect(await statusOf(id)).toBe("AUDITED");
  });
});

describe("review7A: real counts must NOT be treated as clock noise", () => {
  // privy/tests/consent.js:72 — total consent artefacts held (a count, not a clock).
  test("privy artifactsSeen 5000 -> 0 is a finding change", () => {
    const p = (n) => buildEvidencePayload({ resourceType: "privy_consent_artifact_activity", resourceId: "consent-artifacts", resourceName: "Consent artefacts", region: null, details: { artifactsSeen: n, artifactsLast30Days: 12 } });
    expect(isSignificantEvidenceChange(p(5000), p(0))).toBe(true);
  });
  // Case-insensitive /^(age|...)([A-Z_]|$)/i matches any lowercase continuation.
  test("a count under a key that merely starts with 'age'/'last' (agents, lastN) is compared", () => {
    expect(isSignificantEvidenceChange({ details: { agents: 12 } }, { details: { agents: 0 } })).toBe(true);
    expect(isSignificantEvidenceChange({ details: { agedBeyondWindow: 0 } }, { details: { agedBeyondWindow: 7 } })).toBe(true);
  });
});
