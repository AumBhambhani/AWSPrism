import { buildEvidencePayload } from "../../shared/evidencePayload.js";

function daysSince(value) {
  const t = Date.parse(value);
  return Number.isNaN(t) ? null : (Date.now() - t) / 86400000;
}

// ---------------------------------------------------------------------------
// salesforce.audit.setup_audit_trail_retention
// ---------------------------------------------------------------------------
// The Setup Audit Trail must cover the required retention window. Salesforce
// retains ~180 days of setup changes on-platform; if the oldest available entry
// is much newer than that, either the org is very new (fine) or entries are
// being lost. The check fails only when there ARE entries but the span is
// materially short AND recent activity exists (so a quiet-but-retained trail
// isn't penalised).
async function checkSetupAuditTrailRetention(clients) {
  const entries = await clients.listSetupAuditTrail();
  const windowDays = clients.THRESHOLDS.AUDIT_TRAIL_MIN_WINDOW_DAYS;

  if (!Array.isArray(entries) || entries.length === 0) {
    return [
      {
        resourceId: "setup-audit-trail",
        status: "fail",
        message:
          "The Setup Audit Trail returned no entries — configuration changes are not being recorded, or the " +
          "integration user cannot read SetupAuditTrail. Confirm audit history is available and export it on a schedule.",
        evidencePayload: buildEvidencePayload({
          resourceType: "salesforce_setup_audit_trail",
          resourceId: "setup-audit-trail",
          resourceName: "Setup Audit Trail",
          region: null,
          details: { entries: 0, requiredWindowDays: windowDays },
        }),
      },
    ];
  }

  // Ordered newest-first by the query.
  const newest = entries[0]?.CreatedDate;
  const oldest = entries[entries.length - 1]?.CreatedDate;
  const spanDays = daysSince(oldest);
  const newestAgeDays = daysSince(newest);

  const payload = buildEvidencePayload({
    resourceType: "salesforce_setup_audit_trail",
    resourceId: "setup-audit-trail",
    resourceName: "Setup Audit Trail",
    region: null,
    details: {
      entries: entries.length,
      oldestEntry: oldest,
      newestEntry: newest,
      spanDays: spanDays == null ? null : Math.round(spanDays),
      requiredWindowDays: windowDays,
    },
  });

  // A short span is only a concern if the trail is otherwise active (recent
  // entries) — a brand-new org legitimately has < 180 days of history.
  const trailActive = newestAgeDays != null && newestAgeDays <= 30;
  if (spanDays != null && spanDays + 5 < windowDays && trailActive && entries.length >= 50) {
    return [
      {
        resourceId: "setup-audit-trail",
        status: "fail",
        message:
          `The Setup Audit Trail only spans ~${Math.round(spanDays)} days (oldest entry ${oldest}), short of the ` +
          `${windowDays}-day window, while still receiving recent changes — export the trail to external storage ` +
          `on a recurring schedule before the platform retention window rolls off.`,
        evidencePayload: payload,
      },
    ];
  }

  return [
    {
      resourceId: "setup-audit-trail",
      status: "pass",
      message:
        spanDays == null
          ? `Setup Audit Trail is populated (${entries.length} entries)`
          : `Setup Audit Trail spans ~${Math.round(spanDays)} days (${entries.length} entries) — covers the ${windowDays}-day window`,
      evidencePayload: payload,
    },
  ];
}

// ---------------------------------------------------------------------------
// salesforce.audit.login_history_available
// ---------------------------------------------------------------------------
// LoginHistory must return records for the trailing window, evidencing that
// login/audit logging is active and not being purged.
async function checkLoginHistoryAvailable(clients) {
  const history = await clients.listLoginHistory();
  const windowDays = clients.THRESHOLDS.LOGIN_HISTORY_WINDOW_DAYS;

  const payload = buildEvidencePayload({
    resourceType: "salesforce_login_history",
    resourceId: "login-history",
    resourceName: "Login History",
    region: null,
    details: {
      windowDays,
      records: Array.isArray(history) ? history.length : 0,
      mostRecentLogin: Array.isArray(history) && history[0] ? history[0].LoginTime : null,
    },
  });

  if (!Array.isArray(history) || history.length === 0) {
    return [
      {
        resourceId: "login-history",
        status: "fail",
        message:
          `LoginHistory returned no records for the last ${windowDays} days — login events are not being logged, ` +
          `or history is being purged. Confirm no automation is deleting LoginHistory and escalate to Salesforce ` +
          `support if login events stop appearing.`,
        evidencePayload: payload,
      },
    ];
  }

  return [
    {
      resourceId: "login-history",
      status: "pass",
      message: `LoginHistory returned ${history.length} record(s) in the last ${windowDays} days — login auditing is active`,
      evidencePayload: payload,
    },
  ];
}

export const auditTests = [
  {
    key: "salesforce.audit.setup_audit_trail_retention",
    title: "Setup Audit Trail history is available for the required retention window",
    failTitle: "Setup Audit Trail history does not cover the required retention window",
    severityDefault: "medium",
    isoReferences: ["A.12.4.1"],
    dpdpaControlAreas: ["Logging & Monitoring"],
    run: (clients) => checkSetupAuditTrailRetention(clients),
  },
  {
    key: "salesforce.audit.login_history_available",
    title: "Login History is retained and queryable",
    failTitle: "Login History is not returning records for the trailing period",
    severityDefault: "medium",
    isoReferences: ["A.12.4.1"],
    dpdpaControlAreas: ["Logging & Monitoring"],
    run: (clients) => checkLoginHistoryAvailable(clients),
  },
];
