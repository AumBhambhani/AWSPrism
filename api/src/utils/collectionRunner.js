import crypto from "crypto";
import { query, mapRow, mapRows } from "../db/index.js";
import { getActiveCredential } from "../db/integrationCredentials.js";
import { getConnector } from "../connectors/registry.js";
import { writeAuditLog } from "./auditLog.js";
import { renderFindingEvidencePdf } from "./findingEvidencePdf.js";
import { saveObject } from "./evidenceStorage.js";
import { sendEmail } from "./email.js";
import { buildEmailHtml } from "./emailTemplate.js";
import { resolveQuestionsForTestKey } from "./questionResolution.js";
import { auditPeriodEndSql } from "./auditCoverage.js";

function stableStringify(value) {
  if (Array.isArray(value)) {
    return "[" + value.map(stableStringify).join(",") + "]";
  }
  if (value !== null && typeof value === "object") {
    return (
      "{" +
      Object.keys(value)
        .sort()
        .map((k) => JSON.stringify(k) + ":" + stableStringify(value[k]))
        .join(",") +
      "}"
    );
  }
  return JSON.stringify(value);
}

function hashPayload(payload) {
  return crypto.createHash("sha256").update(stableStringify(payload || {})).digest("hex");
}

// What counts as expected drift between polls rather than a changed finding (user
// decision 2026-09-25: a number changing — e.g. backup retention 90 -> 0 — IS a
// finding change, unless the number just measures time passing):
//   - a date/timestamp string (anchored, so "2026-01-01 strict" is still compared);
//   - a number under a clock-driven key: ages and time-since counters ("ageDays",
//     "daysSinceReview", "lastSeen", "remainingDays", "uptime"...). Settings and
//     thresholds that merely mention time ("retentionDays", "maxAgeDays",
//     "thresholdHours", "lookbackDays") and every other number (counts, sizes, ports,
//     percentages) are compared exactly.
const TIMESTAMP_RE = /^\d{4}-\d{2}-\d{2}([T ]\d{2}:\d{2}(:\d{2}(\.\d+)?)?(Z|[+-]\d{2}:?\d{2})?)?$/;
const SETTING_KEY_RE = /^(max|min|threshold|critical|high|low|medium|required|stale|offline|lookback|expiration|expiry|retention|warn|warning|limit|window|target|policy|config)/i;
// Word-aware and case-sensitive (camelCase or snake_case): "ageDays", "key_age",
// "lastSeen", "oldestAgeDays", "remainingDays" — but not "agents", "agedBeyondWindow",
// "storage", "noncompliantPercentage", "lastBackupSizeBytes" or "remainingLicenses".
const TIME_UNIT = "(Days|Hours|Minutes|Seconds|Ms|Weeks|Months|_days|_hours|_minutes|_seconds|_ms|_weeks|_months)";
const CLOCK_KEY_PATTERNS = [
  /^(age|since|uptime|elapsed|seen)(?=[A-Z_]|$)/,
  new RegExp(`(Age|_age)${TIME_UNIT}?$`),
  /^(days|hours|minutes|seconds|weeks|months)(_?)(Since|Ago|Old|Open|Paused|Remaining|Left|Elapsed|Idle|Inactive|since|ago|old|open|paused|remaining|left|elapsed|idle|inactive)(?=[A-Z_]|$)/,
  /(Ago|_ago)$/,
  // Counters of time until/in something: "daysToExpiry", "overdueDays", "activeDays",
  // "inactiveDays", "spanDays" (closure review 7A: real connector keys).
  /^(days|hours|minutes|seconds|weeks|months)_?(To|Until|Till|to|until|till)(?=[A-Z_]|$)/,
  new RegExp(`^(overdue|active|inactive|idle|open|pending|span|paused|elapsed)${TIME_UNIT}$`),
  // "seen" as a time only: "lastSeen", "deviceLastSeenAt" — not a total like "artifactsSeen".
  /(Last|_last_)(Seen|seen)(At|_at)?$/,
  new RegExp(`^(last|oldest|newest)(?=[A-Z_]).*(Seen|At|Time|Date|Ago|Age|Login|SignIn|Sync|Run|Update|Updated|Change|Changed|Modified|Rotated|Backup|Scan|Checkin|CheckIn|Contact|Activity|Used|_at|_time|_date)${TIME_UNIT}?$`),
  new RegExp(`^(remaining|time_?since|timeSince)${TIME_UNIT}`),
  /(Uptime|_uptime|Elapsed|_elapsed)(?=[A-Z_]|$)/,
];
const isClockKey = (key) => typeof key === "string" && !SETTING_KEY_RE.test(key) && CLOCK_KEY_PATTERNS.some((re) => re.test(key));

function isVolatileValue(value, key) {
  if (typeof value === "string" && TIMESTAMP_RE.test(value)) return true;
  if (typeof value === "number") return isClockKey(key);
  return false;
}

// Whether a re-collected evidence payload differs from the previous one in a way worth
// bouncing a previously-approved assessment back to the reviewer over ("the finding
// changed"). Compared recursively — connectors nest their data under `details` — so a
// structural change (a field or list entry appearing/disappearing) or a non-volatile
// leaf changing counts at any depth; only the drift above is ignored, since that would
// otherwise re-flag a still-compliant control every poll.
function isSignificantEvidenceChange(oldPayload, newPayload) {
  const oldObj = oldPayload && typeof oldPayload === "object" ? oldPayload : {};
  const newObj = newPayload && typeof newPayload === "object" ? newPayload : {};
  return differsSignificantly(oldObj, newObj, null);
}

function differsSignificantly(a, b, key) {
  if (isVolatileValue(a, key) && isVolatileValue(b, key)) return false;
  if (Array.isArray(a) || Array.isArray(b)) {
    if (!Array.isArray(a) || !Array.isArray(b) || a.length !== b.length) return true;
    return a.some((v, i) => differsSignificantly(v, b[i], null));
  }
  if (a !== null && b !== null && typeof a === "object" && typeof b === "object") {
    const keys = new Set([...Object.keys(a), ...Object.keys(b)]);
    for (const k of keys) {
      if (!(k in a) || !(k in b)) return true;
      if (differsSignificantly(a[k], b[k], k)) return true;
    }
    return false;
  }
  return a !== b;
}

export const __testing = { isSignificantEvidenceChange, isClockKey };

// Shared helper: links a vault item to every question the given testKey maps to.
// The test_key -> quest_id resolution itself lives in questionResolution.js (shared
// with the findings routes, which surface the same linkage on findings/remediation actions).
async function linkVaultToQuestions({ companyId, testKey, vaultId }) {
  const questIds = await resolveQuestionsForTestKey({ companyId, testKey });
  for (const questId of questIds) {
    await query(
      `INSERT INTO question_evidence (company_id, quest_id, vault_id, linked_by)
       VALUES ($1, $2, $3, 'automated')
       ON CONFLICT (company_id, quest_id, vault_id) DO NOTHING`,
      [companyId, questId, vaultId]
    );
  }
}

// Appends an evidence_versions row (auto-incrementing version_number) recording this
// collection's snapshot. Every re-collection that changed the payload becomes a version
// of the SAME vault item rather than a brand-new evidence document.
async function appendEvidenceVersion({ vaultId, result, file = null }) {
  const maxResult = await query(
    `SELECT COALESCE(MAX(version_number), 0) AS max_ver FROM evidence_versions WHERE evidence_id = $1`,
    [vaultId]
  );
  const nextVer = parseInt(maxResult.rows[0].max_ver, 10) + 1;
  await query(
    `INSERT INTO evidence_versions (evidence_id, version_number, file_name, file_type, file_size, storage_path, uploaded_by, version_notes)
     VALUES ($1, $2, $3, $4, $5, $6, 'automated', $7)
     ON CONFLICT (evidence_id, version_number) DO NOTHING`,
    [vaultId, nextVer, file?.fileName ?? null, file?.fileType ?? null, file?.fileSize ?? null, file?.storageRef ?? null, result.message]
  );
  return nextVer;
}

async function upsertEvidenceForPass({ companyId, result, existingVaultId = null }) {
  // Re-collection of a resource we already have evidence for: keep the one vault item
  // and record the new snapshot in its version history.
  if (existingVaultId) {
    const updated = await query(
      `UPDATE evidence_vault SET description = $1, updated_at = NOW()
       WHERE id = $2 AND company_id = $3 RETURNING id`,
      [result.message, existingVaultId, companyId]
    );
    if (updated.rows.length > 0) {
      await appendEvidenceVersion({ vaultId: existingVaultId, result });
      await linkVaultToQuestions({ companyId, testKey: result.testKey, vaultId: existingVaultId });
      return existingVaultId;
    }
    // Pointer was dangling (vault row deleted) — fall through and create a fresh item.
  }

  const vaultResult = await query(
    `INSERT INTO evidence_vault (company_id, title, description, uploaded_by)
     VALUES ($1, $2, $3, 'automated') RETURNING *`,
    [companyId, `${result.testKey} — ${result.resourceId}`, result.message]
  );
  const vault = mapRow(vaultResult);
  await appendEvidenceVersion({ vaultId: vault.id, result });
  await linkVaultToQuestions({ companyId, testKey: result.testKey, vaultId: vault.id });
  return vault.id;
}

// Generates a real pdfkit PDF, writes it to storage, and either appends it as a new
// version of the finding's existing evidence item or (first time) creates the vault row.
// Auto-links it to all matching questions.
async function generateFindingEvidenceVaultItem({ companyId, connectionId, result, existingFinding }) {
  const [mappingRows, connRow, testRow] = await Promise.all([
    query(`SELECT framework, iso_reference FROM test_control_mappings WHERE test_key = $1`, [result.testKey]),
    query(`SELECT name, integration_key FROM integration_connections WHERE id = $1`, [connectionId]),
    query(`SELECT description, remediation_guidance FROM automated_tests WHERE test_key = $1`, [result.testKey]),
  ]);
  const conn = mapRow(connRow);
  const testMeta = mapRow(testRow);

  const pdfBuffer = await renderFindingEvidencePdf({
    title: result.failTitle || result.title || result.testKey,
    testKey: result.testKey,
    resourceId: result.resourceId,
    severity: result.severity,
    message: result.message,
    evidencePayload: result.evidencePayload,
    isoReferences: mappingRows.rows.map(r => r.iso_reference),
    controlMappings: mappingRows.rows.map(r => ({ framework: r.framework, isoReference: r.iso_reference })),
    testDescription: testMeta?.description ?? null,
    remediationGuidance: testMeta?.remediationGuidance ?? null,
    connectionName: conn?.name,
    integrationKey: conn?.integrationKey,
    companyId,
    connectionId,
    // A re-detected finding keeps its original detection date and lifecycle
    // state; a brand-new one is Open as of now.
    status: existingFinding?.status || "open",
    firstDetectedAt: existingFinding?.firstDetectedAt ?? null,
    linkedActionId: existingFinding?.linkedActionId ?? null,
  });

  const fileName = `${Date.now()}-${Math.round(Math.random() * 1e9)}.pdf`;
  const storageRef = await saveObject(companyId, {
    buffer: pdfBuffer,
    originalName: fileName,
    scope: "vault",
    contentType: "application/pdf",
  });
  const file = { fileName, fileType: "application/pdf", fileSize: pdfBuffer.length, storageRef };

  const existingVaultId = existingFinding?.evidenceVaultId || null;
  if (existingVaultId) {
    const updated = await query(
      `UPDATE evidence_vault
         SET description = $1, file_name = $2, file_type = 'application/pdf', file_size = $3, storage_path = $4, updated_at = NOW()
       WHERE id = $5 AND company_id = $6 RETURNING id`,
      [result.message, fileName, pdfBuffer.length, storageRef, existingVaultId, companyId]
    );
    if (updated.rows.length > 0) {
      await appendEvidenceVersion({ vaultId: existingVaultId, result, file });
      await linkVaultToQuestions({ companyId, testKey: result.testKey, vaultId: existingVaultId });
      return existingVaultId;
    }
    // Pointer was dangling — fall through and create a fresh item.
  }

  const vaultResult = await query(
    `INSERT INTO evidence_vault (company_id, title, description, file_name, file_type, file_size, storage_path, uploaded_by)
     VALUES ($1, $2, $3, $4, 'application/pdf', $5, $6, 'automated') RETURNING *`,
    [companyId, `${result.testKey} — ${result.resourceId}`, result.message, fileName, pdfBuffer.length, storageRef]
  );
  const vault = mapRow(vaultResult);
  await appendEvidenceVersion({ vaultId: vault.id, result, file });
  await linkVaultToQuestions({ companyId, testKey: result.testKey, vaultId: vault.id });
  return vault.id;
}

// Every approved (FINISHED/AUDITED) assessment linked — via question_evidence — to the
// given vault item that is still in effect today: this month's (or a later month's), one carried forward by
// the control's recurrence (same window as the dashboard's `eff` CTE, dashboard.js), or
// an audit whose audited period hasn't ended. Drafts are ignored, so a newer WIP draft
// can't shield an approval from being sent back (F-26). Approvals of periods that have
// ended keep their sign-off; the evidence they saw stays in the item's version history.
async function findApprovedAssessmentsForVaultItem({ companyId, vaultId }) {
  const currentMonth = new Date().toISOString().slice(0, 7);
  const result = await query(
    `SELECT a.*
     FROM assessments a
     JOIN question_evidence qe ON qe.company_id = a.company_id AND qe.quest_id = a.quest_id AND qe.vault_id = $3
     LEFT JOIN LATERAL (
       SELECT recurrence_interval, next_due_date FROM questions
       WHERE quest_id = a.quest_id AND (company_id = a.company_id OR company_id IS NULL)
       ORDER BY company_id ASC NULLS LAST, id ASC LIMIT 1
     ) q ON TRUE
     WHERE a.company_id = $1
       AND a.review_status IN ('FINISHED', 'AUDITED') AND a.archived_at IS NULL
       AND a.month IS NOT NULL
       AND (
         a.month >= $2
         OR (
           COALESCE(LOWER(NULLIF(q.recurrence_interval, '')), 'none') <> 'none'
           AND COALESCE(
                 q.next_due_date,
                 COALESCE(a.reviewed_at, a.updated_at, a.created_at, (a.month || '-01')::timestamptz)
                   + CASE LOWER(COALESCE(NULLIF(q.recurrence_interval, ''), 'monthly'))
                       WHEN 'weekly'      THEN INTERVAL '7 days'
                       WHEN 'fortnightly' THEN INTERVAL '14 days'
                       WHEN 'quarterly'   THEN INTERVAL '3 months'
                       WHEN 'semi-annual' THEN INTERVAL '6 months'
                       WHEN 'annual'      THEN INTERVAL '1 year'
                       ELSE INTERVAL '1 month'
                     END
           ) >= ($2 || '-01')::timestamptz
         )
         OR (a.review_status = 'AUDITED' AND COALESCE(a.audit_period_end, ${auditPeriodEndSql("a")}) >= CURRENT_DATE)
       )
     ORDER BY a.quest_id, a.month DESC, a.id DESC`,
    [companyId, currentMonth, vaultId]
  );
  return mapRows(result);
}

// Shared core: revert every currently-approved assessment linked to vaultId back to the
// reviewer queue, with an audit log entry and an email to whoever signed off. Used both
// when a check fails re-collection and when a still-passing check's evidence content
// changed — in both cases, whatever a reviewer/auditor approved is no longer what's on
// file, so their prior sign-off should not keep silently carrying forward.
async function revertApprovedAssessmentsForVaultItem({ companyId, vaultId, reason, checkTitle, testKey, resourceId, emailHeading, emailBody, subjectPrefix }) {
  if (!vaultId) return;
  const assessments = await findApprovedAssessmentsForVaultItem({ companyId, vaultId });
  if (assessments.length === 0) return;

  for (const assessment of assessments) {
    const wasAudited = assessment.reviewStatus === "AUDITED";
    await query(
      `UPDATE assessments
       SET review_status = 'Submitted', audited_by = NULL, audited_at = NULL, auditor_notes = NULL, audit_period_end = NULL,
           auto_reverted_at = NOW(), auto_reverted_reason = $1, updated_at = NOW()
       WHERE id = $2 AND company_id = $3 AND review_status IN ('FINISHED', 'AUDITED')`,
      [reason, assessment.id, companyId]
    );

    await writeAuditLog({
      companyId,
      action: "ASSESSMENT_AUTO_REVERTED",
      resource: "assessments",
      detail: { assessmentId: assessment.id, questId: assessment.questId, testKey, resourceId, reason },
    });

    const webUrl = (process.env.WEB_URL || "https://prismgrc.co").replace(/\/$/, "");
    const recipients = [assessment.reviewedBy, wasAudited ? assessment.auditedBy : null].filter(Boolean);
    for (const recipient of [...new Set(recipients)]) {
      try {
        const html = buildEmailHtml({
          heading: emailHeading,
          preheader: `${assessment.questId} was reverted for review`,
          body: emailBody,
          details: [
            { label: "Question", value: `${assessment.questId}${assessment.controlArea ? ` — ${assessment.controlArea}` : ""}` },
            { label: "Check", value: checkTitle },
            { label: "Reason", value: reason },
          ],
          cta: { text: "Review in PRISM", url: webUrl },
        });
        await sendEmail({ to: recipient, subject: `${subjectPrefix}: ${assessment.questId}`, text: reason, html });
      } catch (emailErr) {
        console.error(`[collectionRunner] failed to send drift-revert email for assessment ${assessment.id}:`, emailErr.message); // nosemgrep
      }
    }
  }
}

// Reopening a finding (a brand-new failure, or a previously-resolved one failing again)
// means evidence a reviewer/auditor already approved is no longer accurate. Revert the
// affected assessment(s) back to the reviewer queue and notify whoever signed off.
async function revertAssessmentsForEvidenceFailure({ companyId, connectionName, result, vaultId }) {
  const checkTitle = result.failTitle || result.title || result.testKey;
  const reason = `Automated check "${checkTitle}" on ${result.resourceId}` +
    `${connectionName ? ` (connection: ${connectionName})` : ""} failed re-collection on ` +
    `${new Date().toISOString().slice(0, 10)}, invalidating previously approved evidence.`;

  await revertApprovedAssessmentsForVaultItem({
    companyId,
    vaultId,
    reason,
    checkTitle,
    testKey: result.testKey,
    resourceId: result.resourceId,
    emailHeading: "Approved Evidence Failed Re-Verification",
    emailBody: "A control you previously approved is no longer verified as compliant. The underlying automated check failed on re-collection, so the assessment has been sent back for review.",
    subjectPrefix: "Action needed: reverted after evidence failure",
  });
}

// The check still passes, but the evidence content itself changed (a different exact
// match than what's currently in the vault) since a reviewer/auditor last approved it.
// Compliant today isn't the same claim as "the reviewer saw and approved this" — flag it
// back for re-confirmation rather than silently carrying the old sign-off forward onto
// evidence that was never actually reviewed.
async function flagAssessmentsForChangedEvidence({ companyId, connectionName, result, vaultId }) {
  const checkTitle = result.title || result.testKey;
  const reason = `Automated check "${checkTitle}" on ${result.resourceId}` +
    `${connectionName ? ` (connection: ${connectionName})` : ""} re-collected different evidence on ` +
    `${new Date().toISOString().slice(0, 10)} (still compliant) — the previously approved evidence is no longer what's on file.`;

  await revertApprovedAssessmentsForVaultItem({
    companyId,
    vaultId,
    reason,
    checkTitle,
    testKey: result.testKey,
    resourceId: result.resourceId,
    emailHeading: "Approved Evidence Changed on Re-Collection",
    emailBody: "A control you previously approved still passes its automated check, but the underlying evidence has changed since your approval. Please re-confirm the new evidence before it counts as reviewed again.",
    subjectPrefix: "Action needed: evidence changed since approval",
  });
}

// A previously failing check now passes: the finding the approval was based on is gone.
async function flagAssessmentsForResolvedFinding({ companyId, connectionName, result, vaultId }) {
  const checkTitle = result.title || result.testKey;
  const reason = `Automated check "${checkTitle}" on ${result.resourceId}` +
    `${connectionName ? ` (connection: ${connectionName})` : ""} passed on ` +
    `${new Date().toISOString().slice(0, 10)}, resolving the finding the approval was based on.`;
  await revertApprovedAssessmentsForVaultItem({
    companyId, vaultId, reason, checkTitle, testKey: result.testKey, resourceId: result.resourceId,
    emailHeading: "Automated Finding Resolved",
    emailBody: "An automated finding linked to a control you approved has been resolved, so the evidence behind your approval changed. The assessment has been sent back for review.",
    subjectPrefix: "Review needed: finding resolved since approval",
  });
}

async function upsertFinding({ companyId, connectionId, connectionName, result, sourceResultId }) {
  const payloadHash = hashPayload(result.evidencePayload);
  const existing = await query(
    `SELECT evidence_vault_id, payload_hash, status, first_detected_at, linked_action_id, source_result_id
       FROM findings WHERE company_id = $1 AND connection_id = $2 AND test_key = $3 AND resource_id = $4`,
    [companyId, connectionId, result.testKey, result.resourceId]
  );
  const existingFinding = mapRow(existing);
  const wasAlreadyOpen = existingFinding?.status === "open";

  // Only generate a new PDF if evidence is new or has changed (dedup by payload hash)
  let vaultId = existingFinding?.evidenceVaultId || null;
  if (!existingFinding || !existingFinding.evidenceVaultId || existingFinding.payloadHash !== payloadHash) {
    vaultId = await generateFindingEvidenceVaultItem({ companyId, connectionId, result, existingFinding });
  }

  await query(
    `INSERT INTO findings (company_id, connection_id, test_key, resource_id, severity, title, description, source_result_id, evidence_vault_id, payload_hash, last_detected_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, NOW())
     ON CONFLICT (company_id, connection_id, test_key, resource_id)
     DO UPDATE SET
       status = CASE WHEN findings.status = 'resolved' THEN 'open' ELSE findings.status END,
       last_detected_at = NOW(),
       source_result_id = EXCLUDED.source_result_id,
       title = EXCLUDED.title,
       description = EXCLUDED.description,
       evidence_vault_id = EXCLUDED.evidence_vault_id,
       payload_hash = EXCLUDED.payload_hash`,
    [companyId, connectionId, result.testKey, result.resourceId, result.severity, result.failTitle || result.title || result.testKey, result.message, sourceResultId, vaultId, payloadHash]
  );

  // A brand-new failure, or a previously-resolved finding reopening, means evidence
  // that had been passing (and possibly already reviewed/audited) no longer is. This
  // check is naturally idempotent: while a finding stays continuously open across
  // later polls, wasAlreadyOpen is true and this does not refire.
  if (!wasAlreadyOpen) {
    await revertAssessmentsForEvidenceFailure({ companyId, connectionName, result, vaultId });
  } else if (existingFinding.payloadHash !== payloadHash) {
    // Still failing, but the finding itself changed (e.g. a different set of offending
    // resources): whatever was approved on the old finding needs another look.
    const oldPayload = existingFinding.sourceResultId
      ? (await query("SELECT evidence_payload FROM evidence_test_results WHERE id = $1", [existingFinding.sourceResultId])).rows[0]?.evidence_payload ?? null
      : null;
    if (isSignificantEvidenceChange(oldPayload, result.evidencePayload)) {
      await flagAssessmentsForChangedFinding({ companyId, connectionName, result, vaultId });
    }
  }
}

// An open finding's content changed between polls while the check keeps failing.
async function flagAssessmentsForChangedFinding({ companyId, connectionName, result, vaultId }) {
  const checkTitle = result.failTitle || result.title || result.testKey;
  const reason = `Automated check "${checkTitle}" on ${result.resourceId}` +
    `${connectionName ? ` (connection: ${connectionName})` : ""} reported a changed finding on ` +
    `${new Date().toISOString().slice(0, 10)} — the approval was given on a different finding.`;
  await revertApprovedAssessmentsForVaultItem({
    companyId, vaultId, reason, checkTitle, testKey: result.testKey, resourceId: result.resourceId,
    emailHeading: "Automated Finding Changed",
    emailBody: "An automated check linked to a control you approved is still failing, but what it found has changed since your approval, so the assessment has been sent back for review.",
    subjectPrefix: "Action needed: finding changed since approval",
  });
}


export async function runCollection({ connectionId, companyId, triggeredBy, triggerType = "manual" }) {
  const connectionResult = await query(
    `SELECT * FROM integration_connections WHERE id = $1 AND company_id = $2`,
    [connectionId, companyId]
  );
  const connection = mapRow(connectionResult);
  if (!connection) throw new Error("Connection not found");

  const credential = await getActiveCredential(connectionId, companyId);
  if (!credential) throw new Error("No active credential for this connection");

  let runResult;
  try {
    runResult = await query(
      `INSERT INTO evidence_collection_runs (company_id, connection_id, trigger_type, status, triggered_by)
       VALUES ($1, $2, $3, 'running', $4) RETURNING *`,
      [companyId, connectionId, triggerType, triggeredBy || null]
    );
  } catch (err) {
    if (err.code === "23505") {
      throw Object.assign(new Error("A collection run is already in progress for this connection"), { status: 409 });
    }
    throw err;
  }
  const run = mapRow(runResult);

  let results = [];
  let runFailed = false;
  let errorMessage = null;
  let passed = 0;
  let failed = 0;
  let processedResults = 0;

  // Everything from connector resolution through per-result persistence is one
  // error boundary: any failure here (unknown integration, connector throwing,
  // or a DB write failing mid-loop) must still finalize the run as 'failed'
  // with a captured error_message rather than leaving it stuck in 'running'.
  try {
    const connector = getConnector(connection.integrationKey);
    results = await connector.runTests({ authType: credential.authType, config: connection.config, secret: credential.secret });

    for (const result of results) {
      const resultRow = await query(
        `INSERT INTO evidence_test_results (run_id, company_id, test_key, resource_id, status, severity, message, evidence_payload)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8) RETURNING *`,
        [run.id, companyId, result.testKey, result.resourceId, result.status, result.severity, result.message, JSON.stringify(result.evidencePayload || {})]
      );
      const savedResult = mapRow(resultRow);

      if (result.status === "pass") {
        passed++;
        const payloadHash = hashPayload(result.evidencePayload);
        const existing = await query(
          `SELECT * FROM automated_evidence_items WHERE company_id = $1 AND connection_id = $2 AND test_key = $3 AND resource_id = $4`,
          [companyId, connectionId, result.testKey, result.resourceId]
        );
        const existingItem = mapRow(existing);
        const evidenceChanged = !existingItem || existingItem.payloadHash !== payloadHash;
        let vaultId = existingItem?.evidenceVaultId;
        if (evidenceChanged) {
          vaultId = await upsertEvidenceForPass({ companyId, result, existingVaultId: existingItem?.evidenceVaultId });
        }
        const nextDueAt = new Date(Date.now() + (connection.collectionFrequencyHours || 24) * 60 * 60 * 1000);
        await query(
          `INSERT INTO automated_evidence_items (company_id, connection_id, evidence_vault_id, test_key, resource_id, latest_result_id, payload_hash, status, last_collected_at, next_collection_due_at)
           VALUES ($1, $2, $3, $4, $5, $6, $7, 'fresh', NOW(), $8)
           ON CONFLICT (company_id, connection_id, test_key, resource_id)
           DO UPDATE SET evidence_vault_id = EXCLUDED.evidence_vault_id, latest_result_id = EXCLUDED.latest_result_id,
             payload_hash = EXCLUDED.payload_hash, status = 'fresh', last_collected_at = NOW(),
             next_collection_due_at = EXCLUDED.next_collection_due_at`,
          [companyId, connectionId, vaultId, result.testKey, result.resourceId, savedResult.id, payloadHash, nextDueAt]
        );
        const resolved = await query(
          `UPDATE findings SET status = 'resolved', resolved_at = NOW()
           WHERE company_id = $1 AND connection_id = $2 AND test_key = $3 AND resource_id = $4 AND status = 'open'
           RETURNING evidence_vault_id`,
          [companyId, connectionId, result.testKey, result.resourceId]
        );
        // The finding went away — a change in what the control was approved on.
        for (const row of resolved.rows) {
          await flagAssessmentsForResolvedFinding({ companyId, connectionName: connection.name, result, vaultId: row.evidence_vault_id || vaultId });
        }
        // The check still passes, but if the evidence content differs from what was
        // already in the vault in a way that's actually compliance-relevant (not just
        // a day-counter or timestamp ticking forward — see isSignificantEvidenceChange)
        // — and something was already there to compare against, i.e. not the very
        // first-ever collection — a reviewer/auditor may have approved the OLD
        // evidence specifically. Flag it for re-confirmation rather than silently
        // keeping that approval.
        if (evidenceChanged && existingItem) {
          let oldPayload = null;
          if (existingItem.latestResultId) {
            const oldResultRow = await query(`SELECT evidence_payload FROM evidence_test_results WHERE id = $1`, [existingItem.latestResultId]);
            oldPayload = oldResultRow.rows[0]?.evidence_payload ?? null;
          }
          if (isSignificantEvidenceChange(oldPayload, result.evidencePayload)) {
            await flagAssessmentsForChangedEvidence({ companyId, connectionName: connection.name, result, vaultId });
          }
        }
      } else if (result.status === "fail") {
        failed++;
        await upsertFinding({ companyId, connectionId, connectionName: connection.name, result, sourceResultId: savedResult.id });
      }

      processedResults++;
    }
  } catch (err) {
    runFailed = true;
    errorMessage = err.message;
  }

  const testsRun = processedResults;
  const finalStatus = runFailed ? "failed" : (failed > 0 ? "partial_failure" : "success");

  const finalRunResult = await query(
    `UPDATE evidence_collection_runs
     SET status = $1, tests_run = $2, tests_passed = $3, tests_failed = $4, error_message = $5, finished_at = NOW()
     WHERE id = $6 AND company_id = $7
     RETURNING *`,
    [finalStatus, testsRun, passed, failed, errorMessage, run.id, companyId]
  );
  const finalRun = mapRow(finalRunResult);

  await query(
    `UPDATE integration_connections SET last_run_at = NOW(), last_run_status = $1, status = $2, updated_at = NOW() WHERE id = $3 AND company_id = $4`,
    [finalStatus, finalStatus === "failed" ? "error" : "connected", connectionId, companyId]
  );

  await writeAuditLog({
    userId: triggeredBy,
    companyId,
    action: "COLLECTION_RUN_COMPLETED",
    resource: "evidence_collection_runs",
    detail: { runId: run.id, connectionId, status: finalStatus, testsRun, testsPassed: passed, testsFailed: failed },
  });

  return { ...finalRun, testsRun, testsPassed: passed, testsFailed: failed };
}
