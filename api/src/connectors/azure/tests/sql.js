function resourceGroupFromId(id) {
  return id.match(/resourceGroups\/([^/]+)\//i)?.[1];
}

async function listServers(sql) {
  const servers = [];
  for await (const server of sql.servers.list()) servers.push(server);
  return servers;
}

export async function checkTransparentDataEncryptionEnabled(sql) {
  const servers = await listServers(sql);
  if (servers.length === 0) {
    return [{ resourceId: "subscription", status: "not_applicable", message: "No Azure SQL servers found", evidencePayload: {} }];
  }
  const results = [];
  for (const server of servers) {
    const rg = resourceGroupFromId(server.id);
    for await (const db of sql.databases.listByServer(rg, server.name)) {
      // "master" is a built-in system database present on every logical server;
      // its TDE state isn't independently configurable the way a user database's is.
      if (db.name === "master") continue;
      let enabled = false;
      for await (const tde of sql.transparentDataEncryptions.listByDatabase(rg, server.name, db.name)) {
        if (tde.state === "Enabled") enabled = true;
      }
      results.push({
        resourceId: db.id,
        status: enabled ? "pass" : "fail",
        message: enabled
          ? `${server.name}/${db.name} has transparent data encryption enabled`
          : `${server.name}/${db.name} does not have transparent data encryption enabled`,
        evidencePayload: { server: server.name, database: db.name },
      });
    }
  }
  if (results.length === 0) {
    results.push({ resourceId: "subscription", status: "not_applicable", message: "No Azure SQL databases found", evidencePayload: {} });
  }
  return results;
}

export async function checkPublicNetworkAccessDisabled(sql) {
  const servers = await listServers(sql);
  if (servers.length === 0) {
    return [{ resourceId: "subscription", status: "not_applicable", message: "No Azure SQL servers found", evidencePayload: {} }];
  }
  const results = [];
  for (const server of servers) {
    if (server.publicNetworkAccess === "Disabled") {
      results.push({
        resourceId: server.id,
        status: "pass",
        message: `${server.name} disables public network access`,
        evidencePayload: { server: server.name, publicNetworkAccess: server.publicNetworkAccess },
      });
      continue;
    }
    const rg = resourceGroupFromId(server.id);
    const openRules = [];
    for await (const rule of sql.firewallRules.listByServer(rg, server.name)) {
      if (rule.startIpAddress === "0.0.0.0" && rule.endIpAddress === "255.255.255.255") openRules.push(rule.name);
    }
    const pass = openRules.length === 0;
    results.push({
      resourceId: server.id,
      status: pass ? "pass" : "fail",
      message: pass
        ? `${server.name} has no fully-open firewall rule`
        : `${server.name} allows public network access with a firewall rule open to all IPs (${openRules.join(", ")})`,
      evidencePayload: { server: server.name, publicNetworkAccess: server.publicNetworkAccess ?? null, openFirewallRules: openRules },
    });
  }
  return results;
}

export async function checkAuditingEnabled(sql) {
  const servers = await listServers(sql);
  if (servers.length === 0) {
    return [{ resourceId: "subscription", status: "not_applicable", message: "No Azure SQL servers found", evidencePayload: {} }];
  }
  const results = [];
  for (const server of servers) {
    const rg = resourceGroupFromId(server.id);
    const policy = await sql.serverBlobAuditingPolicies.get(rg, server.name);
    const enabled = policy?.state === "Enabled";
    results.push({
      resourceId: server.id,
      status: enabled ? "pass" : "fail",
      message: enabled ? `${server.name} has auditing enabled` : `${server.name} does not have auditing enabled`,
      evidencePayload: { server: server.name, state: policy?.state ?? null, retentionDays: policy?.retentionDays ?? null },
    });
  }
  return results;
}

export const sqlTests = [
  { key: "azure.sql.transparent_data_encryption_enabled", title: "SQL databases have transparent data encryption enabled", failTitle: "SQL database does not have transparent data encryption enabled", severityDefault: "critical", isoReferences: ["A.8.2.3"], dpdpaControlAreas: ["Encryption"], run: (clients) => checkTransparentDataEncryptionEnabled(clients.sql) },
  { key: "azure.sql.public_network_access_disabled", title: "SQL servers do not allow public network access", failTitle: "SQL server allows public network access", severityDefault: "critical", isoReferences: ["A.13.1.1"], dpdpaControlAreas: ["Access Control & Least Privilege"], run: (clients) => checkPublicNetworkAccessDisabled(clients.sql) },
  { key: "azure.sql.auditing_enabled", title: "SQL server auditing is enabled", failTitle: "SQL server does not have auditing enabled", severityDefault: "high", isoReferences: ["A.12.4.1"], dpdpaControlAreas: ["Logging & Monitoring"], run: (clients) => checkAuditingEnabled(clients.sql) },
];
