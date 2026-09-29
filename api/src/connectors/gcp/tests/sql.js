import { paginate } from "./pagination.js";

const ACCEPTABLE_SSL_MODES = ["ENCRYPTED_ONLY", "TRUSTED_CLIENT_CERTIFICATE_REQUIRED"];

async function listInstances(sqladmin, projectId) {
  return paginate((params) => sqladmin.instances.list(params), { project: projectId }, "items");
}

export async function checkSqlSslEnforced(sqladmin, projectId) {
  const instances = await listInstances(sqladmin, projectId);
  if (instances.length === 0) {
    return [{ resourceId: projectId, status: "not_applicable", message: "No Cloud SQL instances found", evidencePayload: {} }];
  }
  return instances.map((instance) => {
    const ipConfig = instance.settings?.ipConfiguration || {};
    // requireSsl is the legacy (MySQL/SQL Server) flag; sslMode is the newer
    // Postgres flag and takes priority over requireSsl when both are set.
    const enforced = ipConfig.sslMode ? ACCEPTABLE_SSL_MODES.includes(ipConfig.sslMode) : Boolean(ipConfig.requireSsl);
    return {
      resourceId: instance.name,
      status: enforced ? "pass" : "fail",
      message: enforced ? `${instance.name} requires SSL/TLS for connections` : `${instance.name} does not require SSL/TLS for connections`,
      evidencePayload: { instance: instance.name, requireSsl: Boolean(ipConfig.requireSsl), sslMode: ipConfig.sslMode || null },
    };
  });
}

export async function checkSqlPublicAccessDisabled(sqladmin, projectId) {
  const instances = await listInstances(sqladmin, projectId);
  if (instances.length === 0) {
    return [{ resourceId: projectId, status: "not_applicable", message: "No Cloud SQL instances found", evidencePayload: {} }];
  }
  return instances.map((instance) => {
    const networks = instance.settings?.ipConfiguration?.authorizedNetworks || [];
    const openNetwork = networks.find((n) => n.value === "0.0.0.0/0");
    return {
      resourceId: instance.name,
      status: openNetwork ? "fail" : "pass",
      message: openNetwork
        ? `${instance.name} authorizes connections from 0.0.0.0/0 (any address)`
        : `${instance.name} does not authorize connections from any address (0.0.0.0/0)`,
      evidencePayload: { instance: instance.name, authorizedNetworks: networks.map((n) => n.value) },
    };
  });
}

export const sqlTests = [
  {
    key: "gcp.sql.ssl_enforced",
    title: "Cloud SQL instances require SSL/TLS for connections",
    failTitle: "Cloud SQL instance does not require SSL/TLS for connections",
    severityDefault: "critical",
    isoReferences: ["A.8.2.3"],
    dpdpaControlAreas: ["Encryption"],
    run: (clients) => checkSqlSslEnforced(clients.sqladmin, clients.projectId),
  },
  {
    key: "gcp.sql.public_access_disabled",
    title: "Cloud SQL instances do not authorize connections from any address",
    failTitle: "Cloud SQL instance authorizes connections from 0.0.0.0/0",
    severityDefault: "critical",
    isoReferences: ["A.13.1.1"],
    dpdpaControlAreas: ["Access Control & Least Privilege"],
    run: (clients) => checkSqlPublicAccessDisabled(clients.sqladmin, clients.projectId),
  },
];
