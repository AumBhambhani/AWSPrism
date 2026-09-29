async function hasDiagnosticSettings(monitor, resourceId) {
  const { value } = await monitor.diagnosticSettings.list(resourceId);
  return (value || []).length > 0;
}

async function collect(iterable) {
  const items = [];
  for await (const item of iterable) items.push(item);
  return items;
}

export async function checkDiagnosticSettingsCoverKeyResources({ monitor, sql, keyVault, network }) {
  const results = [];

  const servers = await collect(sql.servers.list());
  for (const server of servers) {
    const has = await hasDiagnosticSettings(monitor, server.id);
    results.push({
      resourceId: server.id,
      status: has ? "pass" : "fail",
      message: has ? `${server.name} has diagnostic settings configured` : `${server.name} has no diagnostic settings configured`,
      evidencePayload: { resourceType: "sqlServer", name: server.name },
    });
  }

  const vaults = await collect(keyVault.vaults.list());
  for (const vault of vaults) {
    const has = await hasDiagnosticSettings(monitor, vault.id);
    results.push({
      resourceId: vault.id,
      status: has ? "pass" : "fail",
      message: has ? `${vault.name} has diagnostic settings configured` : `${vault.name} has no diagnostic settings configured`,
      evidencePayload: { resourceType: "keyVault", name: vault.name },
    });
  }

  const nsgs = await collect(network.networkSecurityGroups.listAll());
  for (const nsg of nsgs) {
    const has = await hasDiagnosticSettings(monitor, nsg.id);
    results.push({
      resourceId: nsg.id,
      status: has ? "pass" : "fail",
      message: has ? `${nsg.name} has diagnostic settings configured` : `${nsg.name} has no diagnostic settings configured`,
      evidencePayload: { resourceType: "nsg", name: nsg.name },
    });
  }

  if (results.length === 0) {
    results.push({ resourceId: "subscription", status: "not_applicable", message: "No SQL servers, Key Vaults, or network security groups found", evidencePayload: {} });
  }
  return results;
}

export const monitorTests = [
  { key: "azure.monitor.diagnostic_settings_cover_key_resources", title: "Diagnostic settings are configured for key resource types", failTitle: "Key resource has no diagnostic settings configured", severityDefault: "medium", isoReferences: ["A.12.4.1"], dpdpaControlAreas: ["Logging & Monitoring"], run: (clients) => checkDiagnosticSettingsCoverKeyResources(clients) },
];
