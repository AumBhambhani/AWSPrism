import { buildEvidencePayload } from "../../shared/evidencePayload.js";

function daysSince(value) {
  const t = Date.parse(value);
  return Number.isNaN(t) ? null : (Date.now() - t) / 86400000;
}

// Field-level audit history (sys_audit) must be enabled for the sensitive
// tables. Evidence = at least one sys_audit row exists for each table and the
// most recent one is within the last 12 months (a table with auditing switched
// on but no changes in a year is reported, not failed hard).
async function checkFieldAuditEnabled(clients) {
  const tables = clients.SENSITIVE_TABLES;
  const rows = [];
  let anyReadable = false;

  for (const table of tables) {
    let latest;
    try {
      latest = await clients.latestAudit(table);
    } catch {
      rows.push({
        resourceId: `audit:${table}`,
        status: "not_applicable",
        message: `sys_audit is not readable for "${table}" with the integration user's roles`,
        evidencePayload: buildEvidencePayload({ resourceType: "servicenow_audit", resourceId: `audit:${table}`, resourceName: `${table} audit`, region: null, details: {} }),
      });
      continue;
    }
    anyReadable = true;
    if (!latest) {
      rows.push({
        resourceId: `audit:${table}`,
        status: "fail",
        message: `No sys_audit history exists for "${table}" — field auditing appears to be disabled on this table`,
        evidencePayload: buildEvidencePayload({ resourceType: "servicenow_audit", resourceId: `audit:${table}`, resourceName: `${table} audit`, region: null, details: { auditRows: 0 } }),
      });
      continue;
    }
    const age = daysSince(latest.sys_created_on);
    rows.push({
      resourceId: `audit:${table}`,
      status: "pass",
      message:
        age != null
          ? `"${table}" field auditing is enabled — most recent audited change ${Math.round(age)} days ago`
          : `"${table}" field auditing is enabled — audit history present`,
      evidencePayload: buildEvidencePayload({
        resourceType: "servicenow_audit",
        resourceId: `audit:${table}`,
        resourceName: `${table} audit`,
        region: null,
        details: { lastAuditedChange: latest.sys_created_on, lastAuditedField: latest.fieldname, daysSince: age == null ? null : Math.round(age) },
      }),
    });
  }

  if (!anyReadable) {
    return [
      {
        resourceId: "sys_audit",
        status: "not_applicable",
        message: "sys_audit could not be read for any sensitive table with the integration user's current roles",
        evidencePayload: buildEvidencePayload({ resourceType: "servicenow_audit", resourceId: "sys_audit", resourceName: "Field audit history", region: null, details: { tables } }),
      },
    ];
  }
  return rows;
}

// User login activity must be logged and retrievable. Evidence = at least one
// user has a last_login_time within the recency window, showing the platform is
// still recording logins (a scheduled cleanup that purges login data prematurely
// would leave every last_login_time stale/empty).
async function checkLoginActivityLogged(clients) {
  const users = await clients.listUsers();
  const active = users.filter((u) => String(u.active ?? "").toLowerCase() === "true");
  const windowDays = clients.THRESHOLDS.LOGIN_ACTIVITY_DAYS;

  const withLogin = active.filter((u) => {
    const age = daysSince(u.last_login_time);
    return age != null;
  });
  const recent = withLogin.filter((u) => daysSince(u.last_login_time) <= windowDays);

  const payload = buildEvidencePayload({
    resourceType: "servicenow_login_activity",
    resourceId: "login-activity",
    resourceName: "User login activity",
    region: null,
    details: {
      activeUsers: active.length,
      usersWithLoginTimestamp: withLogin.length,
      usersLoggedInLast: `${windowDays}d`,
      recentLogins: recent.length,
    },
  });

  if (active.length === 0) {
    return [{ resourceId: "login-activity", status: "not_applicable", message: "No active users to evaluate for login activity", evidencePayload: payload }];
  }

  if (withLogin.length === 0) {
    return [
      {
        resourceId: "login-activity",
        status: "fail",
        message: "No active user has a recorded last-login timestamp — login activity may not be logged, or is being purged",
        evidencePayload: payload,
      },
    ];
  }

  return [
    {
      resourceId: "login-activity",
      status: recent.length > 0 ? "pass" : "fail",
      message:
        recent.length > 0
          ? `${recent.length} active user(s) have a last-login timestamp within ${windowDays} days — login activity is being recorded`
          : `Active users have last-login timestamps but none within ${windowDays} days — confirm login logging is not disabled`,
      evidencePayload: payload,
    },
  ];
}

export const auditTests = [
  {
    key: "servicenow.audit.field_audit_enabled",
    title: "Field-level audit history is enabled for sensitive tables",
    failTitle: "Field auditing is not enabled for a sensitive table",
    severityDefault: "medium",
    isoReferences: ["A.12.4.1"],
    dpdpaControlAreas: ["Logging & Monitoring"],
    run: (clients) => checkFieldAuditEnabled(clients),
  },
  {
    key: "servicenow.audit.login_activity_logged",
    title: "User login activity is logged and retrievable",
    failTitle: "User login activity could not be evidenced",
    severityDefault: "medium",
    isoReferences: ["A.12.4.1"],
    dpdpaControlAreas: ["Logging & Monitoring"],
    run: (clients) => checkLoginActivityLogged(clients),
  },
];
