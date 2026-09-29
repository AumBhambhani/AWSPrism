import { ClientSecretCredential } from "@azure/identity";

export async function resolveAzureCredentials({ authType, config, secret }) {
  if (authType === "oauth2") {
    if (!config.tenantId) throw new Error("Azure connection is missing config.tenantId");
    if (!config.subscriptionId) throw new Error("Azure connection is missing config.subscriptionId");
    return new ClientSecretCredential(config.tenantId, secret.clientId, secret.clientSecret);
  }

  throw new Error(`Unsupported Azure auth type: ${authType}`);
}
