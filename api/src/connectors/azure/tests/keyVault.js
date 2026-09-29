function resourceGroupFromId(id) {
  return id.match(/resourceGroups\/([^/]+)\//i)?.[1];
}

async function listVaults(keyVault) {
  const vaults = [];
  for await (const vault of keyVault.vaults.list()) vaults.push(vault);
  return vaults;
}

export async function checkPurgeProtectionEnabled(keyVault) {
  const vaults = await listVaults(keyVault);
  if (vaults.length === 0) {
    return [{ resourceId: "subscription", status: "not_applicable", message: "No Key Vaults found", evidencePayload: {} }];
  }
  const results = [];
  for (const vault of vaults) {
    const full = await keyVault.vaults.get(resourceGroupFromId(vault.id), vault.name);
    const enabled = full.properties?.enablePurgeProtection === true;
    results.push({
      resourceId: vault.id,
      status: enabled ? "pass" : "fail",
      message: enabled ? `${vault.name} has purge protection enabled` : `${vault.name} does not have purge protection enabled`,
      evidencePayload: { vaultName: vault.name, enablePurgeProtection: full.properties?.enablePurgeProtection ?? null },
    });
  }
  return results;
}

export async function checkRbacAuthorizationEnabled(keyVault) {
  const vaults = await listVaults(keyVault);
  if (vaults.length === 0) {
    return [{ resourceId: "subscription", status: "not_applicable", message: "No Key Vaults found", evidencePayload: {} }];
  }
  const results = [];
  for (const vault of vaults) {
    const full = await keyVault.vaults.get(resourceGroupFromId(vault.id), vault.name);
    const enabled = full.properties?.enableRbacAuthorization === true;
    results.push({
      resourceId: vault.id,
      status: enabled ? "pass" : "fail",
      message: enabled
        ? `${vault.name} uses Azure RBAC for authorization`
        : `${vault.name} uses legacy vault access policies instead of Azure RBAC`,
      evidencePayload: { vaultName: vault.name, enableRbacAuthorization: full.properties?.enableRbacAuthorization ?? null },
    });
  }
  return results;
}

export const keyVaultTests = [
  { key: "azure.keyvault.purge_protection_enabled", title: "Key Vaults have purge protection enabled", failTitle: "Key Vault does not have purge protection enabled", severityDefault: "high", isoReferences: ["A.8.2.3"], run: (clients) => checkPurgeProtectionEnabled(clients.keyVault) },
  { key: "azure.keyvault.rbac_authorization_enabled", title: "Key Vaults use Azure RBAC instead of legacy access policies", failTitle: "Key Vault uses legacy access policies instead of Azure RBAC", severityDefault: "medium", isoReferences: ["A.9.1.2"], run: (clients) => checkRbacAuthorizationEnabled(clients.keyVault) },
];
