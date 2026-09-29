import { describe, test, expect, vi } from "vitest";
import { createCompany, createUser } from "../setup/helpers.js";
import { query } from "../../db/index.js";
import { storeCredential } from "../../db/integrationCredentials.js";

// Independent review 6 (reviewer A) — connector re-collection rule probes.

vi.mock("../../utils/email.js", () => ({ sendEmail: vi.fn().mockResolvedValue(undefined), sendInvitationEmail: vi.fn() }));
vi.mock("../../utils/notifyReviewers.js", () => ({ notifyReviewers: vi.fn().mockResolvedValue(undefined) }));

const runTests = vi.fn();
vi.mock("../../connectors/registry.js", () => ({
  getConnector: vi.fn(() => ({ key: "aws", testConnection: vi.fn(), runTests })),
}));

const { runCollection } = await import("../../utils/collectionRunner.js");
const { buildEvidencePayload } = await import("../../connectors/shared/evidencePayload.js");

async function setup() {
  const company = await createCompany({ domain: `r6a-${Date.now()}-${Math.random().toString(16).slice(2)}.test` });
  await createUser(company.id, "ADMIN", { email: `admin-${Date.now()}-${Math.random().toString(16).slice(2)}@r6a.test` });
  await query(`INSERT INTO modules (module_id, company_id, name) VALUES ('M1', $1, 'Access Control')`, [company.id]);
  // Q1 <- aws.iam.mfa_enforced (A.9.4.2); Q2 <- aws.network.s3_public_access_blocked (A.8.2.3)
  await query(`INSERT INTO questions (quest_id, company_id, module_id, iso_reference) VALUES ('Q1', $1, 'M1', 'A.9.4.2'), ('Q2', $1, 'M1', 'A.8.2.3')`, [company.id]);
  const conn = (await query(
    `INSERT INTO integration_connections (company_id, integration_key, name) VALUES ($1, 'aws', 'Prod AWS') RETURNING *`,
    [company.id]
  )).rows[0];
  await storeCredential({ connectionId: conn.id, companyId: company.id, authType: "iam_role", secret: { externalId: "ext-1" } });
  const run = () => runCollection({ connectionId: conn.id, companyId: company.id, triggerType: "manual" });
  return { company, run };
}

const month = (offset = 0) => {
  const n = new Date();
  return new Date(Date.UTC(n.getUTCFullYear(), n.getUTCMonth() + offset, 1)).toISOString().slice(0, 7);
};

async function insertAudited(companyId, questId, m) {
  return (await query(
    `INSERT INTO assessments (month, module_id, quest_id, company_id, answer, review_status, score_eligible, reviewed_by, reviewed_at, audited_by, audited_at, audit_period_end)
     VALUES ($1, 'M1', $2, $3, 'IMPLEMENTED', 'AUDITED', TRUE, 'reviewer@r6a.test', NOW(), 'auditor@r6a.test', NOW(), CURRENT_DATE + 20) RETURNING id`,
    [m, questId, companyId]
  )).rows[0].id;
}
const statusOf = async (id) => (await query(`SELECT review_status, audited_by FROM assessments WHERE id = $1`, [id])).rows[0];

const mfaPass = (details) => ({
  testKey: "aws.iam.mfa_enforced", title: "IAM users have MFA enabled", severity: "critical", resourceId: "user-1", status: "pass",
  message: "MFA enabled",
  evidencePayload: buildEvidencePayload({ resourceType: "aws_iam_user", resourceId: "user-1", resourceName: "alice", region: null, details }),
});
const s3Fail = (details) => ({
  testKey: "aws.network.s3_public_access_blocked", title: "S3 buckets block public access", severity: "critical", resourceId: "bucket-1", status: "fail",
  message: "Public access not blocked",
  evidencePayload: buildEvidencePayload({ resourceType: "aws_s3_bucket", resourceId: "bucket-1", resourceName: "bucket-1", region: "us-east-1", details }),
});

describe("review6A: volatile-only drift inside the shared connector payload shape", () => {
  // 68 connector test files build their payload with buildEvidencePayload, which puts
  // every compliance datum under a nested `details` object. isSignificantEvidenceChange
  // only exempts TOP-LEVEL numbers/timestamps; a nested object is compared verbatim, so
  // a host count or a "last seen" timestamp ticking inside `details` counts as a changed
  // finding and wipes an in-effect audit sign-off every poll.
  test("a passing check whose only change is a timestamp/count inside details keeps the audit", async () => {
    const { company, run } = await setup();
    runTests.mockResolvedValueOnce([mfaPass({ mfaDevices: 1, lastSeen: "2026-09-01T10:00:00Z" })]);
    await run();
    const id = await insertAudited(company.id, "Q1", month(0));
    runTests.mockResolvedValueOnce([mfaPass({ mfaDevices: 1, lastSeen: "2026-09-02T10:00:00Z" })]);
    await run();
    expect(await statusOf(id)).toEqual({ review_status: "AUDITED", audited_by: "auditor@r6a.test" });
  });

  test("an open finding whose only change is a counter inside details keeps the audit", async () => {
    const { company, run } = await setup();
    runTests.mockResolvedValueOnce([s3Fail({ publicAcl: true, daysOpen: 2 })]);
    await run();
    const id = await insertAudited(company.id, "Q2", month(0));
    runTests.mockResolvedValueOnce([s3Fail({ publicAcl: true, daysOpen: 3 })]);
    await run();
    expect(await statusOf(id)).toEqual({ review_status: "AUDITED", audited_by: "auditor@r6a.test" });
  });
});

describe("review6A: every in-effect approval is reached", () => {
  // An audit signed off now for next month's period holds the evidence (heldByAuditSql
  // uses audit_period_end >= today) but findApprovedAssessmentsForVaultItem requires
  // a.month <= current month, so a new failure never sends it back. When next month
  // arrives the finding is already open (wasAlreadyOpen) and nothing re-fires.
  test("a new failure sends back an AUDITED assessment signed off for next month", async () => {
    const { company, run } = await setup();
    runTests.mockResolvedValueOnce([mfaPass({ mfaDevices: 1 })]);
    await run();
    const id = await insertAudited(company.id, "Q2", month(1));
    runTests.mockResolvedValueOnce([s3Fail({ publicAcl: true })]);
    await run();
    expect((await statusOf(id)).review_status).toBe("Submitted");
  });

  test("HELD: another tenant's audited control of the same quest id is untouched", async () => {
    const a = await setup();
    const b = await setup();
    const bId = await insertAudited(b.company.id, "Q2", month(0));
    runTests.mockResolvedValueOnce([s3Fail({ publicAcl: true })]);
    await a.run();
    expect((await statusOf(bId)).review_status).toBe("AUDITED");
  });
});
