const RECENCY_THRESHOLD_DAYS = 30;

async function latestActivity(reports, customerId, applicationName) {
  const { data } = await reports.activities.list({
    userKey: "all",
    applicationName,
    customerId,
    maxResults: 1,
  });
  return (data.items || [])[0] || null;
}

function daysSince(isoTimestamp) {
  return (Date.now() - new Date(isoTimestamp).getTime()) / (1000 * 60 * 60 * 24);
}

export async function checkAuditLogRetentionConfigured(reports, customerId) {
  const [latestAdmin, latestLogin] = await Promise.all([
    latestActivity(reports, customerId, "admin"),
    latestActivity(reports, customerId, "login"),
  ]);

  return [{ applicationName: "admin", activity: latestAdmin }, { applicationName: "login", activity: latestLogin }].map(({ applicationName, activity }) => {
    const timestamp = activity?.id?.time;
    const ageDays = timestamp ? daysSince(timestamp) : null;
    const flowing = timestamp && ageDays <= RECENCY_THRESHOLD_DAYS;
    return {
      resourceId: `reports.${applicationName}`,
      status: flowing ? "pass" : "fail",
      message: flowing
        ? `${applicationName} activity logs have events within the last ${RECENCY_THRESHOLD_DAYS} days (most recent: ${timestamp})`
        : timestamp
          ? `${applicationName} activity logs have no events within the last ${RECENCY_THRESHOLD_DAYS} days (most recent: ${timestamp})`
          : `${applicationName} activity logs returned no events at all`,
      evidencePayload: { applicationName, mostRecentEventTime: timestamp || null },
    };
  });
}

export const auditTests = [
  {
    key: "google_workspace.audit.log_retention_configured",
    title: "Admin and login audit logs are retained and actively flowing",
    failTitle: "Admin or login audit log has no recent activity",
    severityDefault: "high",
    isoReferences: ["A.12.4.1"],
    dpdpaControlAreas: ["Logging & Monitoring"],
    run: (clients) => checkAuditLogRetentionConfigured(clients.reports, clients.customerId),
  },
];
