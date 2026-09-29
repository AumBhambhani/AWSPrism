import { describe, test, expect, vi } from "vitest";
import { createCompany, createUser } from "../setup/helpers.js";
import { query } from "../../db/index.js";
import { storeCredential } from "../../db/integrationCredentials.js";

const CONNECTOR_FIXTURES = {
  aws: {
    key: "aws",
    testConnection: vi.fn(async () => ({ ok: true, externalAccountId: "123456789012" })),
    runTests: vi.fn(async () => ([
      { testKey: "aws.iam.mfa_enforced", title: "IAM users have MFA enabled", severity: "critical", resourceId: "user-1", status: "pass", message: "MFA enabled", evidencePayload: { userName: "alice" } },
      { testKey: "aws.network.s3_public_access_blocked", title: "S3 buckets block public access", severity: "critical", resourceId: "bucket-1", status: "fail", message: "Public access not blocked", evidencePayload: { bucket: "bucket-1" } },
    ])),
  },
  azure: {
    key: "azure",
    testConnection: vi.fn(async () => ({ ok: true, externalAccountId: "sub-1" })),
    runTests: vi.fn(async () => ([
      { testKey: "azure.storage.public_access_blocked", title: "Storage accounts block public blob access", severity: "critical", resourceId: "/subscriptions/sub-1/storageAccounts/data1", status: "pass", message: "data1 blocks public blob access", evidencePayload: { accountName: "data1" } },
      { testKey: "azure.network.nsg_no_open_ingress", title: "Network security groups do not expose management ports publicly", severity: "critical", resourceId: "/subscriptions/sub-1/nsg/web", status: "fail", message: "web allows inbound access to ports 22/3389 from *", evidencePayload: { nsgName: "web" } },
    ])),
  },
  github: {
    key: "github",
    testConnection: vi.fn(async () => ({ ok: true, externalAccountId: "42424242" })),
    runTests: vi.fn(async () => ([
      { testKey: "github.org.two_factor_required", title: "Organization requires two-factor authentication", severity: "critical", resourceId: "acme-corp", status: "pass", message: "acme-corp requires two-factor authentication for all members", evidencePayload: { org: "acme-corp" } },
      { testKey: "github.repo.branch_protection_required_reviews", title: "Default branch requires pull request review before merging", severity: "high", resourceId: "acme-corp/api", status: "fail", message: "api has no pull request review protection configured on main", evidencePayload: { repo: "api" } },
    ])),
  },
  acronis: {
    key: "acronis",
    testConnection: vi.fn(async () => ({ ok: true, externalAccountId: "TENANT-123" })),
    runTests: vi.fn(async () => ([
      { testKey: "acronis.backup.protection_enabled", title: "Every workload has an assigned protection plan", failTitle: "A workload has no active protection plan", severity: "high", resourceId: "m1", status: "pass", message: "All workloads report a Protected status", evidencePayload: { machines: 3 } },
      { testKey: "acronis.malware.no_open_detections", title: "No unresolved malware or ransomware alerts", failTitle: "An unresolved malware / ransomware alert is open", severity: "critical", resourceId: "al1", status: "fail", message: "Open ransomware alert on web-01", evidencePayload: { alertId: "al1" } },
    ])),
  },
  commvault: {
    key: "commvault",
    testConnection: vi.fn(async () => ({ ok: true, externalAccountId: "commvault.example.com" })),
    runTests: vi.fn(async () => ([
      { testKey: "commvault.backup.sla_compliance", title: "Monitored entities meet their backup SLA", failTitle: "Monitored entities are missing their backup SLA", severity: "critical", resourceId: "commcell", status: "pass", message: "All 10 monitored entities meet their backup SLA", evidencePayload: { totalEntities: 10 } },
      { testKey: "commvault.storage.worm_lock_enabled", title: "Storage policy copies have WORM / compliance lock enabled", failTitle: "A storage policy copy is missing WORM / compliance lock", severity: "high", resourceId: "Primary/Primary Copy", status: "fail", message: "Primary/Primary Copy does not have WORM / compliance lock enabled", evidencePayload: { policyName: "Primary" } },
    ])),
  },
  "carbonite-server": {
    key: "carbonite-server",
    testConnection: vi.fn(async () => ({ ok: true, externalAccountId: "backup.example.com" })),
    runTests: vi.fn(async () => ([
      { testKey: "carbonite-server.backup.recent_successful_safeset", title: "Safesets have a recent successful backup run", failTitle: "A safeset has a stale or failed most-recent backup run", severity: "critical", resourceId: "SQL nightly", status: "pass", message: "Safeset \"SQL nightly\" completed successfully 2h ago", evidencePayload: { lastRunStatus: "Success" } },
      { testKey: "carbonite-server.monitoring.agent_online", title: "Backup agents are online and checking in", failTitle: "A backup agent is offline / not checking in", severity: "high", resourceId: "web-01", status: "fail", message: "Agent \"web-01\" is offline / not checking in", evidencePayload: { agentState: "offline" } },
    ])),
  },
  carbonite: {
    key: "carbonite",
    testConnection: vi.fn(async () => ({ ok: true, externalAccountId: "dashboard.carbonite.com" })),
    runTests: vi.fn(async () => ([
      { testKey: "carbonite.backup.recent_successful_backup", title: "Devices have a recent successful backup", failTitle: "A device has a stale or missing last completed backup", severity: "critical", resourceId: "d1", status: "pass", message: "Device \"laptop-1\" completed a backup 3h ago", evidencePayload: { lastCompleteBackupUtc: "x" } },
      { testKey: "carbonite.backup.device_coverage", title: "Devices remain actively protected", failTitle: "A device has silently lapsed out of protection", severity: "high", resourceId: "d2", status: "fail", message: "Device \"laptop-2\" has lapsed protection (state: Suspended)", evidencePayload: { state: "Suspended" } },
    ])),
  },
  sophos: {
    key: "sophos",
    testConnection: vi.fn(async () => ({ ok: true, externalAccountId: "tenant-sophos-1" })),
    runTests: vi.fn(async () => ([
      { testKey: "sophos.endpoint.protection_health", title: "All managed endpoints report good overall health", failTitle: "Some managed endpoints do not report good overall health", severity: "high", resourceId: "endpoint-1", status: "pass", message: "Endpoint health is good", evidencePayload: { health: "good" } },
      { testKey: "sophos.common.no_unresolved_critical_alerts", title: "No unresolved critical Sophos Central alerts", failTitle: "A critical Sophos Central alert is unresolved", severity: "critical", resourceId: "alert-1", status: "fail", message: "Critical malware alert is unresolved", evidencePayload: { severity: "critical" } },
    ])),
  },
  akamai: {
    key: "akamai",
    testConnection: vi.fn(async () => ({ ok: true, externalAccountId: "ctr_1-ABC" })),
    runTests: vi.fn(async () => ([
      { testKey: "akamai.appsec.waf_policies_in_block_mode", title: "WAF security policies enforce in block/deny mode", failTitle: "A WAF security policy is not enforcing in block/deny mode", severity: "high", resourceId: "main/default", status: "pass", message: "main/default: all 12 attack groups enforce in deny mode", evidencePayload: {} },
      { testKey: "akamai.cps.no_certs_near_expiry", title: "No production certificate expires soon", failTitle: "A production certificate expires within the warning window", severity: "critical", resourceId: "www.example.com", status: "fail", message: "www.example.com: certificate expires in 10 days (threshold 30)", evidencePayload: { daysToExpiry: 10 } },
      { testKey: "akamai.property.force_https", title: "Production properties force HTTPS", failTitle: "A production property does not force HTTPS", severity: "high", resourceId: "akamai", status: "not_applicable", message: "No property is activated on the production network", evidencePayload: {} },
    ])),
  },
};

// Never send real email from tests (the local stack is wired to a live SMTP account).
vi.mock("../../utils/email.js", () => ({ sendEmail: vi.fn().mockResolvedValue(undefined), sendInvitationEmail: vi.fn() }));

vi.mock("../../connectors/registry.js", () => ({
  getConnector: vi.fn((integrationKey) => CONNECTOR_FIXTURES[integrationKey]),
}));

const { runCollection } = await import("../../utils/collectionRunner.js");

async function setupConnection() {
  const company = await createCompany();
  const admin = await createUser(company.id, "ADMIN");
  await query(`INSERT INTO modules (module_id, company_id, name) VALUES ('M1', $1, 'Access Control')`, [company.id]);
  await query(
    `INSERT INTO questions (quest_id, company_id, module_id, iso_reference) VALUES ('Q1', $1, 'M1', 'A.9.4.2')`,
    [company.id]
  );
  const connResult = await query(
    `INSERT INTO integration_connections (company_id, integration_key, name) VALUES ($1, 'aws', 'Prod AWS') RETURNING *`,
    [company.id]
  );
  const connection = connResult.rows[0];
  await storeCredential({ connectionId: connection.id, companyId: company.id, authType: "iam_role", secret: { externalId: "ext-1" } });
  return { company, admin, connection };
}

describe("runCollection", () => {
  test("records a run, generates evidence for a pass, and a finding for a fail", async () => {
    const { company, admin, connection } = await setupConnection();

    const run = await runCollection({ connectionId: connection.id, companyId: company.id, triggeredBy: admin.id, triggerType: "manual" });

    expect(run.status).toBe("partial_failure");
    expect(run.testsRun).toBe(2);
    expect(run.testsPassed).toBe(1);
    expect(run.testsFailed).toBe(1);

    // One vault item for the pass (metadata) + one for the fail (finding PDF).
    const vaultRows = await query(`SELECT * FROM evidence_vault WHERE company_id = $1`, [company.id]);
    expect(vaultRows.rows.length).toBe(2);

    // Each vault item starts at version 1.
    const versionRows = await query(
      `SELECT * FROM evidence_versions WHERE evidence_id IN (SELECT id FROM evidence_vault WHERE company_id = $1)`,
      [company.id]
    );
    expect(versionRows.rows.length).toBe(2);
    expect(versionRows.rows.every(v => v.version_number === 1)).toBe(true);

    const linkRows = await query(`SELECT * FROM question_evidence WHERE company_id = $1 AND quest_id = 'Q1'`, [company.id]);
    expect(linkRows.rows.length).toBe(1);

    const findingRows = await query(`SELECT * FROM findings WHERE company_id = $1`, [company.id]);
    expect(findingRows.rows.length).toBe(1);
    expect(findingRows.rows[0].status).toBe("open");
    expect(findingRows.rows[0].title).toBe("S3 buckets block public access");
    expect(findingRows.rows[0].title).not.toBe("aws.network.s3_public_access_blocked");
  });

  test("links automated evidence to a question mapped only via question_framework_controls (crosswalk propagation)", async () => {
    const { company, connection } = await setupConnection();

    // A GDPR question whose own iso_reference/control_area does NOT match the
    // connector's ISO clause — it is tied to GDPR Art. 32(1)(b) only through the
    // per-company canonical crosswalk.
    await query(
      `INSERT INTO questions (quest_id, company_id, module_id, iso_reference) VALUES ('QG', $1, 'M1', 'GDPR-32')`,
      [company.id]
    );
    await query(
      `INSERT INTO question_framework_controls (company_id, quest_id, framework_key, control_reference)
       VALUES ($1, 'QG', 'GDPR', 'Art. 32(1)(b)')`,
      [company.id]
    );
    // The GDPR row testDefinitionSync would derive from aws.iam.mfa_enforced's
    // A.9.4.2 reference via the crosswalk.
    await query(
      `INSERT INTO test_control_mappings (test_key, framework, iso_reference)
       VALUES ('aws.iam.mfa_enforced', 'GDPR', 'Art. 32(1)(b)')
       ON CONFLICT (test_key, framework, iso_reference) DO NOTHING`
    );

    await runCollection({ connectionId: connection.id, companyId: company.id, triggerType: "manual" });

    const gdprLink = await query(
      `SELECT * FROM question_evidence WHERE company_id = $1 AND quest_id = 'QG'`,
      [company.id]
    );
    expect(gdprLink.rows.length).toBe(1);
    expect(gdprLink.rows[0].linked_by).toBe("automated");
  });

  test("flags a FINISHED assessment for re-review when a still-passing check's evidence content changes", async () => {
    const { company, connection } = await setupConnection();
    const aws = CONNECTOR_FIXTURES.aws;
    const currentMonth = new Date().toISOString().slice(0, 7);

    // Run 1: baseline pass for aws.iam.mfa_enforced (Q1 is already linked to A.9.4.2
    // by setupConnection). Nothing is approved yet, so no flag should fire.
    await runCollection({ connectionId: connection.id, companyId: company.id, triggerType: "manual" });

    // A reviewer approves Q1 on the strength of that first evidence.
    await query(
      `INSERT INTO assessments (month, module_id, quest_id, company_id, answer, review_status, score_eligible, reviewed_by, reviewed_at)
       VALUES ($1, 'M1', 'Q1', $2, 'IMPLEMENTED', 'FINISHED', TRUE, 'reviewer@acme.com', NOW())`,
      [currentMonth, company.id]
    );

    // Run 2: still passes, but the evidence content is different (e.g. a different
    // MFA device fingerprint) — the exact evidence the reviewer saw no longer matches.
    aws.runTests.mockResolvedValueOnce([
      { testKey: "aws.iam.mfa_enforced", title: "IAM users have MFA enabled", severity: "critical", resourceId: "user-1", status: "pass", message: "MFA enabled via a new hardware key", evidencePayload: { userName: "alice", device: "yubikey-2" } },
      { testKey: "aws.network.s3_public_access_blocked", title: "S3 buckets block public access", severity: "critical", resourceId: "bucket-1", status: "fail", message: "Public access not blocked", evidencePayload: { bucket: "bucket-1" } },
    ]);
    await runCollection({ connectionId: connection.id, companyId: company.id, triggerType: "manual" });

    const assessment = (await query(
      `SELECT * FROM assessments WHERE company_id = $1 AND quest_id = 'Q1'`,
      [company.id]
    )).rows[0];
    expect(assessment.review_status).toBe("Submitted");
    expect(assessment.score_eligible).toBe(true);
    expect(assessment.auto_reverted_reason).toContain("still compliant");
    expect(assessment.auto_reverted_reason).toContain("re-collected different evidence");
  });

  test("does not flag a FINISHED assessment when only numeric/timestamp fields drift on a still-passing check", async () => {
    const { company, connection } = await setupConnection();
    const aws = CONNECTOR_FIXTURES.aws;
    const currentMonth = new Date().toISOString().slice(0, 7);

    // aws.iam.access_key_age maps to ISO27001 A.9.2.4 (init.sql seed).
    await query(
      `INSERT INTO questions (quest_id, company_id, module_id, iso_reference) VALUES ('Q3', $1, 'M1', 'A.9.2.4')`,
      [company.id]
    );

    // Run 1: access key is 80 days old.
    aws.runTests.mockResolvedValueOnce([
      { testKey: "aws.iam.access_key_age", title: "IAM access keys are rotated", severity: "medium", resourceId: "AKIA-1", status: "pass", message: "Access key AKIA-1 is 80 days old (within 90-day limit)", evidencePayload: { keyId: "AKIA-1", ageDays: 80 } },
    ]);
    await runCollection({ connectionId: connection.id, companyId: company.id, triggerType: "manual" });

    // A reviewer approves Q3 on the strength of that first evidence.
    await query(
      `INSERT INTO assessments (month, module_id, quest_id, company_id, answer, review_status, score_eligible, reviewed_by, reviewed_at)
       VALUES ($1, 'M1', 'Q3', $2, 'IMPLEMENTED', 'FINISHED', TRUE, 'reviewer@acme.com', NOW())`,
      [currentMonth, company.id]
    );

    // Run 2: same key, now 84 days old — the payload hash differs (still gets a new
    // version for the audit trail) but nothing compliance-relevant actually changed.
    aws.runTests.mockResolvedValueOnce([
      { testKey: "aws.iam.access_key_age", title: "IAM access keys are rotated", severity: "medium", resourceId: "AKIA-1", status: "pass", message: "Access key AKIA-1 is 84 days old (within 90-day limit)", evidencePayload: { keyId: "AKIA-1", ageDays: 84 } },
    ]);
    await runCollection({ connectionId: connection.id, companyId: company.id, triggerType: "manual" });

    const assessment = (await query(
      `SELECT * FROM assessments WHERE company_id = $1 AND quest_id = 'Q3'`,
      [company.id]
    )).rows[0];
    expect(assessment.review_status).toBe("FINISHED");
    expect(assessment.auto_reverted_at).toBeNull();

    // The version history still recorded the change — only the reviewer-facing flag was suppressed.
    const vaultRows = await query(
      `SELECT id FROM evidence_vault WHERE company_id = $1 AND title = 'aws.iam.access_key_age — AKIA-1'`,
      [company.id]
    );
    const versionRows = await query(`SELECT version_number FROM evidence_versions WHERE evidence_id = $1`, [vaultRows.rows[0].id]);
    expect(versionRows.rows.map(v => v.version_number)).toEqual([1, 2]);
  });

  test("does not flag anything on the very first collection, even though it's technically a 'change' from nothing", async () => {
    const { company, connection } = await setupConnection();
    const currentMonth = new Date().toISOString().slice(0, 7);

    await query(
      `INSERT INTO assessments (month, module_id, quest_id, company_id, answer, review_status, score_eligible, reviewed_by, reviewed_at)
       VALUES ($1, 'M1', 'Q1', $2, 'IMPLEMENTED', 'FINISHED', TRUE, 'reviewer@acme.com', NOW())`,
      [currentMonth, company.id]
    );

    // Q1 isn't linked to anything yet — the very first collection both creates the
    // evidence AND links it via question_evidence in the same call, so there is
    // nothing pre-existing to have been approved against.
    await runCollection({ connectionId: connection.id, companyId: company.id, triggerType: "manual" });

    const assessment = (await query(
      `SELECT * FROM assessments WHERE company_id = $1 AND quest_id = 'Q1'`,
      [company.id]
    )).rows[0];
    expect(assessment.review_status).toBe("FINISHED");
    expect(assessment.auto_reverted_at).toBeNull();
  });

  test("re-collecting the same resource appends a version instead of a new vault item", async () => {
    const { company, connection } = await setupConnection();
    const aws = CONNECTOR_FIXTURES.aws;

    // Run 1: access key is 80 days old.
    aws.runTests.mockResolvedValueOnce([
      { testKey: "aws.iam.access_key_age", title: "IAM access keys are rotated", severity: "medium", resourceId: "AKIA-1", status: "pass", message: "Access key AKIA-1 is 80 days old (within 90-day limit)", evidencePayload: { keyId: "AKIA-1", ageDays: 80 } },
    ]);
    await runCollection({ connectionId: connection.id, companyId: company.id, triggerType: "manual" });

    // Run 2: same key, now 84 days old — a changed payload.
    aws.runTests.mockResolvedValueOnce([
      { testKey: "aws.iam.access_key_age", title: "IAM access keys are rotated", severity: "medium", resourceId: "AKIA-1", status: "pass", message: "Access key AKIA-1 is 84 days old (within 90-day limit)", evidencePayload: { keyId: "AKIA-1", ageDays: 84 } },
    ]);
    await runCollection({ connectionId: connection.id, companyId: company.id, triggerType: "manual" });

    const vaultRows = await query(
      `SELECT * FROM evidence_vault WHERE company_id = $1 AND title = 'aws.iam.access_key_age — AKIA-1'`,
      [company.id]
    );
    expect(vaultRows.rows.length).toBe(1);
    expect(vaultRows.rows[0].description).toBe("Access key AKIA-1 is 84 days old (within 90-day limit)");

    const versionRows = await query(
      `SELECT * FROM evidence_versions WHERE evidence_id = $1 ORDER BY version_number`,
      [vaultRows.rows[0].id]
    );
    expect(versionRows.rows.map(v => v.version_number)).toEqual([1, 2]);
    expect(versionRows.rows[0].version_notes).toContain("80 days old");
    expect(versionRows.rows[1].version_notes).toContain("84 days old");

    const itemRows = await query(
      `SELECT * FROM automated_evidence_items WHERE company_id = $1 AND resource_id = 'AKIA-1'`,
      [company.id]
    );
    expect(itemRows.rows.length).toBe(1);
    expect(itemRows.rows[0].evidence_vault_id).toBe(vaultRows.rows[0].id);
  });

  test("populates next_collection_due_at on a passing check, based on the connection's collection_frequency_hours", async () => {
    const { company, connection } = await setupConnection();
    await query(`UPDATE integration_connections SET collection_frequency_hours = 12 WHERE id = $1`, [connection.id]);

    const before = Date.now();
    await runCollection({ connectionId: connection.id, companyId: company.id, triggerType: "manual" });

    const itemRows = await query(
      `SELECT * FROM automated_evidence_items WHERE company_id = $1 AND test_key = 'aws.iam.mfa_enforced'`,
      [company.id]
    );
    expect(itemRows.rows.length).toBe(1);
    expect(itemRows.rows[0].status).toBe("fresh");
    const dueAt = new Date(itemRows.rows[0].next_collection_due_at).getTime();
    // ~12h out from the run, generously bounded to avoid clock-skew flakiness.
    expect(dueAt).toBeGreaterThan(before + 11 * 60 * 60 * 1000);
    expect(dueAt).toBeLessThan(before + 13 * 60 * 60 * 1000);
  });

  test("re-collecting with an unchanged payload adds no new version", async () => {
    const { company, connection } = await setupConnection();
    const aws = CONNECTOR_FIXTURES.aws;
    const result = { testKey: "aws.iam.access_key_age", title: "IAM access keys are rotated", severity: "medium", resourceId: "AKIA-2", status: "pass", message: "Access key AKIA-2 is 30 days old (within 90-day limit)", evidencePayload: { keyId: "AKIA-2", ageDays: 30 } };

    aws.runTests.mockResolvedValueOnce([result]);
    await runCollection({ connectionId: connection.id, companyId: company.id, triggerType: "manual" });
    aws.runTests.mockResolvedValueOnce([result]);
    await runCollection({ connectionId: connection.id, companyId: company.id, triggerType: "manual" });

    const vaultRows = await query(
      `SELECT id FROM evidence_vault WHERE company_id = $1 AND title = 'aws.iam.access_key_age — AKIA-2'`,
      [company.id]
    );
    expect(vaultRows.rows.length).toBe(1);
    const versionRows = await query(
      `SELECT version_number FROM evidence_versions WHERE evidence_id = $1`,
      [vaultRows.rows[0].id]
    );
    expect(versionRows.rows.length).toBe(1);
  });

  test("re-detecting a finding appends a version to the same evidence item", async () => {
    const { company, connection } = await setupConnection();
    const aws = CONNECTOR_FIXTURES.aws;

    const failResult = (msg, payload) => ([
      { testKey: "aws.network.s3_public_access_blocked", title: "S3 buckets block public access", severity: "critical", resourceId: "bucket-x", status: "fail", message: msg, evidencePayload: payload },
    ]);

    aws.runTests.mockResolvedValueOnce(failResult("bucket-x is public via ACL", { bucket: "bucket-x", via: "acl" }));
    await runCollection({ connectionId: connection.id, companyId: company.id, triggerType: "manual" });

    aws.runTests.mockResolvedValueOnce(failResult("bucket-x is public via policy", { bucket: "bucket-x", via: "policy" }));
    await runCollection({ connectionId: connection.id, companyId: company.id, triggerType: "manual" });

    const vaultRows = await query(
      `SELECT * FROM evidence_vault WHERE company_id = $1 AND title = 'aws.network.s3_public_access_blocked — bucket-x'`,
      [company.id]
    );
    expect(vaultRows.rows.length).toBe(1);

    const versionRows = await query(
      `SELECT version_number, storage_path FROM evidence_versions WHERE evidence_id = $1 ORDER BY version_number`,
      [vaultRows.rows[0].id]
    );
    expect(versionRows.rows.map(v => v.version_number)).toEqual([1, 2]);
    expect(versionRows.rows.every(v => v.storage_path)).toBe(true);

    const findingRows = await query(
      `SELECT evidence_vault_id FROM findings WHERE company_id = $1 AND resource_id = 'bucket-x'`,
      [company.id]
    );
    expect(findingRows.rows.length).toBe(1);
    expect(findingRows.rows[0].evidence_vault_id).toBe(vaultRows.rows[0].id);
  });

  test("throws when there is no active credential", async () => {
    const company = await createCompany();
    const connResult = await query(
      `INSERT INTO integration_connections (company_id, integration_key, name) VALUES ($1, 'aws', 'No creds') RETURNING *`,
      [company.id]
    );
    await expect(
      runCollection({ connectionId: connResult.rows[0].id, companyId: company.id, triggerType: "manual" })
    ).rejects.toThrow("No active credential for this connection");
  });

  test("re-running resolves a finding that now passes", async () => {
    const { company, connection } = await setupConnection();
    await query(
      `INSERT INTO findings (company_id, connection_id, test_key, resource_id, severity, title, status)
       VALUES ($1, $2, 'aws.iam.mfa_enforced', 'user-1', 'critical', 'MFA not enabled', 'open')`,
      [company.id, connection.id]
    );

    await runCollection({ connectionId: connection.id, companyId: company.id, triggerType: "manual" });

    const findingRows = await query(
      `SELECT * FROM findings WHERE company_id = $1 AND test_key = 'aws.iam.mfa_enforced' AND resource_id = 'user-1'`,
      [company.id]
    );
    expect(findingRows.rows[0].status).toBe("resolved");
  });

  test("works identically for a second, differently-shaped connector (azure), proving genericity", async () => {
    const company = await createCompany();
    const admin = await createUser(company.id, "ADMIN");
    await query(`INSERT INTO modules (module_id, company_id, name) VALUES ('M1', $1, 'Network Security') `, [company.id]);
    await query(`INSERT INTO questions (quest_id, company_id, module_id, iso_reference) VALUES ('Q1', $1, 'M1', 'A.8.2.3')`, [company.id]);
    const connResult = await query(
      `INSERT INTO integration_connections (company_id, integration_key, name) VALUES ($1, 'azure', 'Prod Azure') RETURNING *`,
      [company.id]
    );
    const connection = connResult.rows[0];
    await storeCredential({ connectionId: connection.id, companyId: company.id, authType: "oauth2", secret: { clientId: "c1", clientSecret: "shh" } });

    const run = await runCollection({ connectionId: connection.id, companyId: company.id, triggeredBy: admin.id, triggerType: "manual" });

    expect(run.status).toBe("partial_failure");
    expect(run.testsRun).toBe(2);
    expect(run.testsPassed).toBe(1);
    expect(run.testsFailed).toBe(1);

    // One vault item for the pass, one for the fail (finding PDF).
    const vaultRows = await query(`SELECT * FROM evidence_vault WHERE company_id = $1`, [company.id]);
    expect(vaultRows.rows.length).toBe(2);

    const findingRows = await query(`SELECT * FROM findings WHERE company_id = $1`, [company.id]);
    expect(findingRows.rows.length).toBe(1);
    expect(findingRows.rows[0].title).toBe("Network security groups do not expose management ports publicly");
    expect(findingRows.rows[0].test_key).toBe("azure.network.nsg_no_open_ingress");
  });

  test("works identically for a third, differently-shaped connector (github), proving genericity", async () => {
    const company = await createCompany();
    const admin = await createUser(company.id, "ADMIN");
    await query(`INSERT INTO modules (module_id, company_id, name) VALUES ('M1', $1, 'Change Management')`, [company.id]);
    await query(`INSERT INTO questions (quest_id, company_id, module_id, iso_reference) VALUES ('Q1', $1, 'M1', 'A.14.2.2')`, [company.id]);
    const connResult = await query(
      `INSERT INTO integration_connections (company_id, integration_key, name, config) VALUES ($1, 'github', 'Prod GitHub', $2) RETURNING *`,
      [company.id, JSON.stringify({ installationId: 42, org: "acme-corp" })]
    );
    const connection = connResult.rows[0];
    await storeCredential({ connectionId: connection.id, companyId: company.id, authType: "oauth2", secret: { appId: "1", privateKey: "pem" } });

    const run = await runCollection({ connectionId: connection.id, companyId: company.id, triggeredBy: admin.id, triggerType: "manual" });

    expect(run.status).toBe("partial_failure");
    expect(run.testsRun).toBe(2);
    expect(run.testsPassed).toBe(1);
    expect(run.testsFailed).toBe(1);

    // One vault item for the pass, one for the fail (finding PDF).
    const vaultRows = await query(`SELECT * FROM evidence_vault WHERE company_id = $1`, [company.id]);
    expect(vaultRows.rows.length).toBe(2);

    const findingRows = await query(`SELECT * FROM findings WHERE company_id = $1`, [company.id]);
    expect(findingRows.rows.length).toBe(1);
    expect(findingRows.rows[0].title).toBe("Default branch requires pull request review before merging");
    expect(findingRows.rows[0].test_key).toBe("github.repo.branch_protection_required_reviews");
  });

  test("works identically for a fourth, differently-shaped connector (acronis), proving genericity", async () => {
    const company = await createCompany();
    const admin = await createUser(company.id, "ADMIN");
    await query(`INSERT INTO modules (module_id, company_id, name) VALUES ('M1', $1, 'Backup')`, [company.id]);
    await query(`INSERT INTO questions (quest_id, company_id, module_id, iso_reference) VALUES ('Q1', $1, 'M1', 'A.12.3.1')`, [company.id]);
    const connResult = await query(
      `INSERT INTO integration_connections (company_id, integration_key, name, config) VALUES ($1, 'acronis', 'Prod Acronis', $2) RETURNING *`,
      [company.id, JSON.stringify({ datacenterUrl: "https://us5-cloud.acronis.com" })]
    );
    const connection = connResult.rows[0];
    await storeCredential({ connectionId: connection.id, companyId: company.id, authType: "oauth2", secret: { clientId: "c1", clientSecret: "shh" } });

    const run = await runCollection({ connectionId: connection.id, companyId: company.id, triggeredBy: admin.id, triggerType: "manual" });

    expect(run.status).toBe("partial_failure");
    expect(run.testsRun).toBe(2);
    expect(run.testsPassed).toBe(1);
    expect(run.testsFailed).toBe(1);

    const vaultRows = await query(`SELECT * FROM evidence_vault WHERE company_id = $1`, [company.id]);
    expect(vaultRows.rows.length).toBe(2);

    const findingRows = await query(`SELECT * FROM findings WHERE company_id = $1`, [company.id]);
    expect(findingRows.rows.length).toBe(1);
    expect(findingRows.rows[0].test_key).toBe("acronis.malware.no_open_detections");
    expect(findingRows.rows[0].title).toBe("An unresolved malware / ransomware alert is open");
  });

  test("works identically for a fifth, non-SDK / api_key-shaped connector (commvault), proving genericity holds beyond SDK-wrapped clients", async () => {
    const company = await createCompany();
    const admin = await createUser(company.id, "ADMIN");
    await query(`INSERT INTO modules (module_id, company_id, name) VALUES ('M1', $1, 'Backup Management')`, [company.id]);
    await query(`INSERT INTO questions (quest_id, company_id, module_id, iso_reference) VALUES ('Q1', $1, 'M1', 'A.12.3.1')`, [company.id]);
    const connResult = await query(
      `INSERT INTO integration_connections (company_id, integration_key, name, config) VALUES ($1, 'commvault', 'Prod Commvault', $2) RETURNING *`,
      [company.id, JSON.stringify({ webconsoleUrl: "https://commvault.example.com" })]
    );
    const connection = connResult.rows[0];
    await storeCredential({ connectionId: connection.id, companyId: company.id, authType: "api_key", secret: { accessToken: "tok-abc123" } });

    const run = await runCollection({ connectionId: connection.id, companyId: company.id, triggeredBy: admin.id, triggerType: "manual" });

    expect(run.status).toBe("partial_failure");
    expect(run.testsRun).toBe(2);
    expect(run.testsPassed).toBe(1);
    expect(run.testsFailed).toBe(1);

    const vaultRows = await query(`SELECT * FROM evidence_vault WHERE company_id = $1`, [company.id]);
    expect(vaultRows.rows.length).toBe(2);

    const findingRows = await query(`SELECT * FROM findings WHERE company_id = $1`, [company.id]);
    expect(findingRows.rows.length).toBe(1);
    expect(findingRows.rows[0].test_key).toBe("commvault.storage.worm_lock_enabled");
    expect(findingRows.rows[0].title).toBe("A storage policy copy is missing WORM / compliance lock");
  });

  test("works identically for a SOAP-shaped connector (carbonite), proving genericity holds beyond JSON/REST clients", async () => {
    const company = await createCompany();
    const admin = await createUser(company.id, "ADMIN");
    await query(`INSERT INTO modules (module_id, company_id, name) VALUES ('M1', $1, 'Backup Management')`, [company.id]);
    await query(`INSERT INTO questions (quest_id, company_id, module_id, iso_reference) VALUES ('Q1', $1, 'M1', 'A.12.3.1')`, [company.id]);
    const connResult = await query(
      `INSERT INTO integration_connections (company_id, integration_key, name, config) VALUES ($1, 'carbonite', 'Prod Carbonite', $2) RETURNING *`,
      [company.id, JSON.stringify({ dashboardHost: "dashboard.carbonite.com" })]
    );
    const connection = connResult.rows[0];
    await storeCredential({ connectionId: connection.id, companyId: company.id, authType: "api_key", secret: { email: "admin@acme.com", apiKey: "key-abc123" } });

    const run = await runCollection({ connectionId: connection.id, companyId: company.id, triggeredBy: admin.id, triggerType: "manual" });

    expect(run.status).toBe("partial_failure");
    expect(run.testsRun).toBe(2);
    expect(run.testsPassed).toBe(1);
    expect(run.testsFailed).toBe(1);

    const findingRows = await query(`SELECT * FROM findings WHERE company_id = $1`, [company.id]);
    expect(findingRows.rows.length).toBe(1);
    expect(findingRows.rows[0].test_key).toBe("carbonite.backup.device_coverage");
    expect(findingRows.rows[0].title).toBe("A device has silently lapsed out of protection");
  });

  test("works identically for a sixth connector (carbonite-server) whose credential resolution performs a live OAuth2 token exchange", async () => {
    const company = await createCompany();
    const admin = await createUser(company.id, "ADMIN");
    await query(`INSERT INTO modules (module_id, company_id, name) VALUES ('M1', $1, 'Backup Management')`, [company.id]);
    await query(`INSERT INTO questions (quest_id, company_id, module_id, iso_reference) VALUES ('Q1', $1, 'M1', 'A.12.3.1')`, [company.id]);
    const connResult = await query(
      `INSERT INTO integration_connections (company_id, integration_key, name, config) VALUES ($1, 'carbonite-server', 'Prod Carbonite Server', $2) RETURNING *`,
      [company.id, JSON.stringify({ apiDomain: "backup.example.com", keycloakRealm: "carbonite" })]
    );
    const connection = connResult.rows[0];
    await storeCredential({ connectionId: connection.id, companyId: company.id, authType: "oauth2", secret: { clientId: "prism-reader", clientSecret: "s3cr3t" } });

    const run = await runCollection({ connectionId: connection.id, companyId: company.id, triggeredBy: admin.id, triggerType: "manual" });

    expect(run.status).toBe("partial_failure");
    expect(run.testsRun).toBe(2);
    expect(run.testsPassed).toBe(1);
    expect(run.testsFailed).toBe(1);

    const vaultRows = await query(`SELECT * FROM evidence_vault WHERE company_id = $1`, [company.id]);
    expect(vaultRows.rows.length).toBe(2);

    const findingRows = await query(`SELECT * FROM findings WHERE company_id = $1`, [company.id]);
    expect(findingRows.rows.length).toBe(1);
    expect(findingRows.rows[0].test_key).toBe("carbonite-server.monitoring.agent_online");
    expect(findingRows.rows[0].title).toBe("A backup agent is offline / not checking in");
  });

  test("works identically for the Sophos multi-area OAuth2 connector", async () => {
    const company = await createCompany();
    const admin = await createUser(company.id, "ADMIN");
    await query(`INSERT INTO modules (module_id, company_id, name) VALUES ('M1', $1, 'Endpoint Security')`, [company.id]);
    await query(`INSERT INTO questions (quest_id, company_id, module_id, iso_reference) VALUES ('Q1', $1, 'M1', 'A.12.2.1')`, [company.id]);
    const connResult = await query(
      `INSERT INTO integration_connections (company_id, integration_key, name, config) VALUES ($1, 'sophos', 'Prod Sophos', '{}') RETURNING *`,
      [company.id]
    );
    const connection = connResult.rows[0];
    await storeCredential({ connectionId: connection.id, companyId: company.id, authType: "oauth2", secret: { clientId: "reader", clientSecret: "secret" } });

    const run = await runCollection({ connectionId: connection.id, companyId: company.id, triggeredBy: admin.id, triggerType: "manual" });

    expect(run.status).toBe("partial_failure");
    expect(run.testsRun).toBe(2);
    expect(run.testsPassed).toBe(1);
    expect(run.testsFailed).toBe(1);
    const findingRows = await query(`SELECT * FROM findings WHERE company_id = $1`, [company.id]);
    expect(findingRows.rows).toHaveLength(1);
    expect(findingRows.rows[0].test_key).toBe("sophos.common.no_unresolved_critical_alerts");
    expect(findingRows.rows[0].title).toBe("A critical Sophos Central alert is unresolved");
  });

  test("works identically for a sixth connector (akamai) whose credential resolution is an EdgeGrid api_key shape", async () => {
    const company = await createCompany();
    const admin = await createUser(company.id, "ADMIN");
    await query(`INSERT INTO modules (module_id, company_id, name) VALUES ('M1', $1, 'Network Security')`, [company.id]);
    await query(`INSERT INTO questions (quest_id, company_id, module_id, iso_reference) VALUES ('Q1', $1, 'M1', 'A.14.1.2')`, [company.id]);
    const connResult = await query(
      `INSERT INTO integration_connections (company_id, integration_key, name, config) VALUES ($1, 'akamai', 'Prod Akamai', $2) RETURNING *`,
      [company.id, JSON.stringify({ host: "akab-abc.luna.akamaiapis.net" })]
    );
    const connection = connResult.rows[0];
    await storeCredential({ connectionId: connection.id, companyId: company.id, authType: "api_key", secret: { clientToken: "akab-ct", clientSecret: "cs=", accessToken: "akab-at" } });

    const run = await runCollection({ connectionId: connection.id, companyId: company.id, triggeredBy: admin.id, triggerType: "manual" });

    expect(run.status).toBe("partial_failure");
    expect(run.testsRun).toBe(3);
    expect(run.testsPassed).toBe(1);
    expect(run.testsFailed).toBe(1);

    // evidence_test_results rows are persisted for this akamai connection with no
    // collectionRunner code change — a fail, a pass and a not_applicable row.
    const resultRows = await query(
      `SELECT r.test_key, r.status
         FROM evidence_test_results r
         JOIN evidence_collection_runs cr ON cr.id = r.run_id
         JOIN integration_connections ic ON ic.id = cr.connection_id
        WHERE ic.company_id = $1 AND ic.integration_key = 'akamai'`,
      [company.id]
    );
    expect(resultRows.rows.length).toBe(3);
    const allowed = ["pass", "fail", "warn", "error", "not_applicable"];
    expect(resultRows.rows.every(r => allowed.includes(r.status))).toBe(true);
    expect(resultRows.rows.some(r => r.status === "fail" && r.test_key === "akamai.cps.no_certs_near_expiry")).toBe(true);

    const vaultRows = await query(`SELECT * FROM evidence_vault WHERE company_id = $1`, [company.id]);
    expect(vaultRows.rows.length).toBe(2);

    const findingRows = await query(`SELECT * FROM findings WHERE company_id = $1`, [company.id]);
    expect(findingRows.rows.length).toBe(1);
    expect(findingRows.rows[0].test_key).toBe("akamai.cps.no_certs_near_expiry");
    expect(findingRows.rows[0].title).toBe("A production certificate expires within the warning window");
  });

  test("reverts a FINISHED assessment and notifies the reviewer when its linked automated check fails", async () => {
    const { company, connection } = await setupConnection();
    const currentMonth = new Date().toISOString().slice(0, 7);

    // aws.network.s3_public_access_blocked maps to ISO27001 A.8.2.3 (init.sql seed).
    await query(
      `INSERT INTO questions (quest_id, company_id, module_id, iso_reference) VALUES ('Q2', $1, 'M1', 'A.8.2.3')`,
      [company.id]
    );
    await query(
      `INSERT INTO assessments (month, module_id, quest_id, company_id, answer, review_status, score_eligible, reviewed_by, reviewed_at)
       VALUES ($1, 'M1', 'Q2', $2, 'IMPLEMENTED', 'FINISHED', TRUE, 'reviewer@acme.com', NOW())`,
      [currentMonth, company.id]
    );

    await runCollection({ connectionId: connection.id, companyId: company.id, triggerType: "manual" });

    const assessment = (await query(
      `SELECT * FROM assessments WHERE company_id = $1 AND quest_id = 'Q2'`,
      [company.id]
    )).rows[0];
    expect(assessment.review_status).toBe("Submitted");
    expect(assessment.score_eligible).toBe(true); // untouched — not what gates scoring
    expect(assessment.auto_reverted_at).not.toBeNull();
    expect(assessment.auto_reverted_reason).toContain("S3 buckets block public access");

    const auditRows = await query(
      `SELECT * FROM audit_logs WHERE company_id = $1 AND action = 'ASSESSMENT_AUTO_REVERTED'`,
      [company.id]
    );
    expect(auditRows.rows.length).toBe(1);
  });

  test("reverts an AUDITED assessment too, clearing the auditor sign-off", async () => {
    const { company, connection } = await setupConnection();
    const currentMonth = new Date().toISOString().slice(0, 7);

    await query(
      `INSERT INTO questions (quest_id, company_id, module_id, iso_reference) VALUES ('Q2', $1, 'M1', 'A.8.2.3')`,
      [company.id]
    );
    await query(
      `INSERT INTO assessments (month, module_id, quest_id, company_id, answer, review_status, score_eligible, reviewed_by, reviewed_at, audited_by, audited_at, auditor_notes)
       VALUES ($1, 'M1', 'Q2', $2, 'IMPLEMENTED', 'AUDITED', TRUE, 'reviewer@acme.com', NOW(), 'auditor@acme.com', NOW(), 'signed off')`,
      [currentMonth, company.id]
    );

    await runCollection({ connectionId: connection.id, companyId: company.id, triggerType: "manual" });

    const assessment = (await query(
      `SELECT * FROM assessments WHERE company_id = $1 AND quest_id = 'Q2'`,
      [company.id]
    )).rows[0];
    expect(assessment.review_status).toBe("Submitted");
    expect(assessment.audited_by).toBeNull();
    expect(assessment.audited_at).toBeNull();
    expect(assessment.auditor_notes).toBeNull();
    expect(assessment.auto_reverted_at).not.toBeNull();
  });

  test("does not re-revert while the finding stays continuously open across polls", async () => {
    const { company, connection } = await setupConnection();
    const currentMonth = new Date().toISOString().slice(0, 7);

    await query(
      `INSERT INTO questions (quest_id, company_id, module_id, iso_reference) VALUES ('Q2', $1, 'M1', 'A.8.2.3')`,
      [company.id]
    );
    await query(
      `INSERT INTO assessments (month, module_id, quest_id, company_id, answer, review_status, score_eligible, reviewed_by, reviewed_at)
       VALUES ($1, 'M1', 'Q2', $2, 'IMPLEMENTED', 'FINISHED', TRUE, 'reviewer@acme.com', NOW())`,
      [currentMonth, company.id]
    );

    await runCollection({ connectionId: connection.id, companyId: company.id, triggerType: "manual" });

    // Simulate a reviewer re-approving in between polls, to isolate the
    // "still open" idempotency check from the review_status re-filter.
    await query(`UPDATE assessments SET review_status = 'FINISHED' WHERE company_id = $1 AND quest_id = 'Q2'`, [company.id]);

    await runCollection({ connectionId: connection.id, companyId: company.id, triggerType: "manual" });

    const assessment = (await query(
      `SELECT * FROM assessments WHERE company_id = $1 AND quest_id = 'Q2'`,
      [company.id]
    )).rows[0];
    // Second consecutive failing poll must not touch a FINISHED row again.
    expect(assessment.review_status).toBe("FINISHED");

    const auditRows = await query(
      `SELECT * FROM audit_logs WHERE company_id = $1 AND action = 'ASSESSMENT_AUTO_REVERTED'`,
      [company.id]
    );
    expect(auditRows.rows.length).toBe(1);
  });

  test("reverts again when a resolved finding reopens on a later poll", async () => {
    const { company, connection } = await setupConnection();
    const aws = CONNECTOR_FIXTURES.aws;
    const currentMonth = new Date().toISOString().slice(0, 7);

    await query(
      `INSERT INTO questions (quest_id, company_id, module_id, iso_reference) VALUES ('Q2', $1, 'M1', 'A.8.2.3')`,
      [company.id]
    );
    await query(
      `INSERT INTO assessments (month, module_id, quest_id, company_id, answer, review_status, score_eligible, reviewed_by, reviewed_at)
       VALUES ($1, 'M1', 'Q2', $2, 'IMPLEMENTED', 'FINISHED', TRUE, 'reviewer@acme.com', NOW())`,
      [currentMonth, company.id]
    );

    // Poll 1: fails, reverts the assessment.
    await runCollection({ connectionId: connection.id, companyId: company.id, triggerType: "manual" });

    // Reviewer re-approves; the check then passes (finding resolves) — itself a change in
    // the finding, so the approval goes back for review too.
    await query(`UPDATE assessments SET review_status = 'FINISHED' WHERE company_id = $1 AND quest_id = 'Q2'`, [company.id]);
    aws.runTests.mockResolvedValueOnce([
      { testKey: "aws.iam.mfa_enforced", title: "IAM users have MFA enabled", severity: "critical", resourceId: "user-1", status: "pass", message: "MFA enabled", evidencePayload: { userName: "alice" } },
      { testKey: "aws.network.s3_public_access_blocked", title: "S3 buckets block public access", severity: "critical", resourceId: "bucket-1", status: "pass", message: "Public access blocked", evidencePayload: { bucket: "bucket-1" } },
    ]);
    await runCollection({ connectionId: connection.id, companyId: company.id, triggerType: "manual" });

    // Poll 3: fails again — the finding reopens (resolved -> open) and must revert again.
    await query(`UPDATE assessments SET review_status = 'FINISHED' WHERE company_id = $1 AND quest_id = 'Q2'`, [company.id]);
    await runCollection({ connectionId: connection.id, companyId: company.id, triggerType: "manual" });

    const assessment = (await query(
      `SELECT * FROM assessments WHERE company_id = $1 AND quest_id = 'Q2'`,
      [company.id]
    )).rows[0];
    expect(assessment.review_status).toBe("Submitted");

    const auditRows = await query(
      `SELECT * FROM audit_logs WHERE company_id = $1 AND action = 'ASSESSMENT_AUTO_REVERTED'`,
      [company.id]
    );
    expect(auditRows.rows.length).toBe(3);
  });

  const FAILING_S3 = (payload) => ([
    { testKey: "aws.iam.mfa_enforced", title: "IAM users have MFA enabled", severity: "critical", resourceId: "user-1", status: "pass", message: "MFA enabled", evidencePayload: { userName: "alice" } },
    { testKey: "aws.network.s3_public_access_blocked", title: "S3 buckets block public access", severity: "critical", resourceId: "bucket-1", status: "fail", message: "Public access not blocked", evidencePayload: payload },
  ]);
  const q2Status = async (companyId) => (await query(
    `SELECT review_status FROM assessments WHERE company_id = $1 AND quest_id = 'Q2' ORDER BY month`, [companyId]
  )).rows.map((r) => r.review_status);

  test("an open finding whose content changes sends the approval back for review", async () => {
    const { company, connection } = await setupConnection();
    const currentMonth = new Date().toISOString().slice(0, 7);
    await query(`INSERT INTO questions (quest_id, company_id, module_id, iso_reference) VALUES ('Q2', $1, 'M1', 'A.8.2.3')`, [company.id]);
    await query(
      `INSERT INTO assessments (month, module_id, quest_id, company_id, answer, review_status, score_eligible, reviewed_by, reviewed_at)
       VALUES ($1, 'M1', 'Q2', $2, 'IMPLEMENTED', 'FINISHED', TRUE, 'reviewer@acme.com', NOW())`,
      [currentMonth, company.id]
    );
    CONNECTOR_FIXTURES.aws.runTests.mockResolvedValueOnce(FAILING_S3({ bucket: "bucket-1", daysOpen: 2 }));
    await runCollection({ connectionId: connection.id, companyId: company.id, triggerType: "manual" });
    await query(`UPDATE assessments SET review_status = 'FINISHED' WHERE company_id = $1 AND quest_id = 'Q2'`, [company.id]);

    // Same finding, only a volatile counter moved: approval stands.
    CONNECTOR_FIXTURES.aws.runTests.mockResolvedValueOnce(FAILING_S3({ bucket: "bucket-1", daysOpen: 3 }));
    await runCollection({ connectionId: connection.id, companyId: company.id, triggerType: "manual" });
    CONNECTOR_FIXTURES.aws.runTests.mockResolvedValueOnce(FAILING_S3({ bucket: "bucket-1", daysOpen: 4 }));
    await runCollection({ connectionId: connection.id, companyId: company.id, triggerType: "manual" });
    expect(await q2Status(company.id)).toEqual(["FINISHED"]);

    // The finding itself changed (a different bucket is exposed): back to review.
    CONNECTOR_FIXTURES.aws.runTests.mockResolvedValueOnce(FAILING_S3({ bucket: "bucket-2", daysOpen: 4 }));
    await runCollection({ connectionId: connection.id, companyId: company.id, triggerType: "manual" });
    expect(await q2Status(company.id)).toEqual(["Submitted"]);
  });

  // User decision 2026-09-25: a number changing on a passing check IS a finding change,
  // unless it only measures time passing (ageDays, daysSince..., lastSeen, ...).
  test.each([
    ["backup retention dropping 90 -> 0", { retentionDays: 90 }, { retentionDays: 0 }, "Submitted"],
    ["a host count changing inside details", { details: { hosts: 100 } }, { details: { hosts: 101 } }, "Submitted"],
    ["a threshold changing", { details: { maxAgeDays: 90 } }, { details: { maxAgeDays: 365 } }, "Submitted"],
    ["only a key's age ticking", { details: { ageDays: 80 } }, { details: { ageDays: 84 } }, "FINISHED"],
    ["only hours-since-last-backup ticking", { details: { hoursSinceLastBackup: 3 } }, { details: { hoursSinceLastBackup: 5 } }, "FINISHED"],
  ])("passing check: %s", async (_label, before, after, expected) => {
    const { company, connection } = await setupConnection();
    const currentMonth = new Date().toISOString().slice(0, 7);
    await query(`INSERT INTO questions (quest_id, company_id, module_id, iso_reference) VALUES ('Q3', $1, 'M1', 'A.9.2.4')`, [company.id]);
    const pass = (payload) => [{ testKey: "aws.iam.access_key_age", title: "IAM access keys are rotated", severity: "medium", resourceId: "AKIA-1", status: "pass", message: "ok", evidencePayload: { keyId: "AKIA-1", ...payload } }];
    CONNECTOR_FIXTURES.aws.runTests.mockResolvedValueOnce(pass(before));
    await runCollection({ connectionId: connection.id, companyId: company.id, triggerType: "manual" });
    await query(
      `INSERT INTO assessments (month, module_id, quest_id, company_id, answer, review_status, score_eligible, reviewed_by, reviewed_at)
       VALUES ($1, 'M1', 'Q3', $2, 'IMPLEMENTED', 'FINISHED', TRUE, 'reviewer@acme.com', NOW())`,
      [currentMonth, company.id]
    );
    CONNECTOR_FIXTURES.aws.runTests.mockResolvedValueOnce(pass(after));
    await runCollection({ connectionId: connection.id, companyId: company.id, triggerType: "manual" });
    const row = (await query(`SELECT review_status FROM assessments WHERE company_id = $1 AND quest_id = 'Q3'`, [company.id])).rows[0];
    expect(row.review_status).toBe(expected);
  });

  test("F-26: a newer WIP draft does not shield an AUDITED assessment still in its audited period", async () => {
    const { company, connection } = await setupConnection();
    const now = new Date();
    const currentMonth = now.toISOString().slice(0, 7);
    const lastMonth = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 1, 1)).toISOString().slice(0, 7);
    await query(
      `INSERT INTO questions (quest_id, company_id, module_id, iso_reference, recurrence_interval) VALUES ('Q2', $1, 'M1', 'A.8.2.3', 'quarterly')`,
      [company.id]
    );
    await query(
      `INSERT INTO assessments (month, module_id, quest_id, company_id, answer, review_status, score_eligible, reviewed_by, reviewed_at, audited_by, audited_at, audit_period_end)
       VALUES ($1, 'M1', 'Q2', $3, 'IMPLEMENTED', 'AUDITED', TRUE, 'reviewer@acme.com', NOW(), 'auditor@acme.com', NOW(), CURRENT_DATE + 30),
              ($2, 'M1', 'Q2', $3, 'IMPLEMENTED', 'WIP', TRUE, NULL, NULL, NULL, NULL, NULL)`,
      [lastMonth, currentMonth, company.id]
    );
    await runCollection({ connectionId: connection.id, companyId: company.id, triggerType: "manual" });
    expect(await q2Status(company.id)).toEqual(["Submitted", "WIP"]);
    const audited = (await query(`SELECT audited_at, audit_period_end FROM assessments WHERE company_id = $1 AND month = $2`, [company.id, lastMonth])).rows[0];
    expect(audited.audited_at).toBeNull();
    expect(audited.audit_period_end).toBeNull();
  });

  test("an audit whose period has ended keeps its sign-off when the check later fails", async () => {
    const { company, connection } = await setupConnection();
    await query(`INSERT INTO questions (quest_id, company_id, module_id, iso_reference) VALUES ('Q2', $1, 'M1', 'A.8.2.3')`, [company.id]);
    await query(
      `INSERT INTO assessments (month, module_id, quest_id, company_id, answer, review_status, score_eligible, reviewed_by, reviewed_at, audited_by, audited_at, audit_period_end)
       VALUES ('2024-01', 'M1', 'Q2', $1, 'IMPLEMENTED', 'AUDITED', TRUE, 'reviewer@acme.com', '2024-01-20', 'auditor@acme.com', '2024-01-25', '2024-01-31')`,
      [company.id]
    );
    await runCollection({ connectionId: connection.id, companyId: company.id, triggerType: "manual" });
    expect(await q2Status(company.id)).toEqual(["AUDITED"]);
  });

  test("rejects with a 409 when a run for the same connection is already 'running'", async () => {
    const { company, admin, connection } = await setupConnection();

    // Simulate another in-flight run by inserting a 'running' row directly —
    // the partial unique index (evidence_collection_runs_running_uq) added in
    // Task 5 only allows one 'running' row per connection_id.
    await query(
      `INSERT INTO evidence_collection_runs (company_id, connection_id, trigger_type, status, triggered_by)
       VALUES ($1, $2, 'manual', 'running', $3)`,
      [company.id, connection.id, admin.id]
    );

    let caught;
    try {
      await runCollection({ connectionId: connection.id, companyId: company.id, triggeredBy: admin.id, triggerType: "manual" });
    } catch (err) {
      caught = err;
    }

    expect(caught).toBeInstanceOf(Error);
    expect(caught.status).toBe(409);
    expect(caught.message).toBe("A collection run is already in progress for this connection");

    // Only the pre-existing 'running' row should exist — the second attempt never inserted one.
    const runRows = await query(
      `SELECT * FROM evidence_collection_runs WHERE company_id = $1 AND connection_id = $2`,
      [company.id, connection.id]
    );
    expect(runRows.rows.length).toBe(1);
    expect(runRows.rows[0].status).toBe("running");
  });
});
