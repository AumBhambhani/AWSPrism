// Admin Activity audit logs are always on and can't be configured off, so
// they're not a meaningful compliance signal. Data Access logs (DATA_READ /
// DATA_WRITE) are opt-in, incur logging cost, and are commonly left
// disabled — evidencing them here is the actual point of this check.
export async function checkDataAccessAuditLogsEnabled(cloudresourcemanager, projectId) {
  const { data } = await cloudresourcemanager.projects.getIamPolicy({
    resource: `projects/${projectId}`,
    requestBody: {},
  });
  const auditConfigs = data.auditConfigs || [];
  const allServicesConfig = auditConfigs.find((c) => c.service === "allServices");
  const logTypes = new Set((allServicesConfig?.auditLogConfigs || []).map((c) => c.logType));
  const hasDataRead = logTypes.has("DATA_READ");
  const hasDataWrite = logTypes.has("DATA_WRITE");
  const pass = hasDataRead && hasDataWrite;

  return [{
    resourceId: projectId,
    status: pass ? "pass" : "fail",
    message: pass
      ? `Data Access audit logs (DATA_READ and DATA_WRITE) are enabled for all services on project ${projectId}`
      : `Data Access audit logs are not fully enabled for all services on project ${projectId} (DATA_READ: ${hasDataRead}, DATA_WRITE: ${hasDataWrite})`,
    evidencePayload: { projectId, hasDataRead, hasDataWrite, configuredServices: auditConfigs.map((c) => c.service) },
  }];
}

export const loggingTests = [
  {
    key: "gcp.logging.data_access_audit_logs_enabled",
    title: "Data Access audit logs are enabled for all services",
    failTitle: "Data Access audit logs are not fully enabled for all services",
    severityDefault: "high",
    isoReferences: ["A.12.4.1"],
    dpdpaControlAreas: ["Logging & Monitoring"],
    run: (clients) => checkDataAccessAuditLogsEnabled(clients.cloudresourcemanager, clients.projectId),
  },
];
