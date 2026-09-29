import { resolveMicrosoftGraphCredentials } from "../shared/microsoftGraphAuth.js";

export function resolveM365Credentials({ authType, config, secret }) {
  if (authType !== "oauth2") throw new Error(`Unsupported Microsoft 365 auth type: ${authType}`);
  // Returns two token getters: one for Graph (SharePoint/Intune), one for Exchange Online Admin API.
  const graph = resolveMicrosoftGraphCredentials({ config, secret, resource: "https://graph.microsoft.com" });
  const exchange = resolveMicrosoftGraphCredentials({ config, secret, resource: "https://outlook.office365.com" });
  return {
    getGraphToken: graph.getToken,
    getExchangeToken: exchange.getToken,
    tenantId: graph.tenantId,
  };
}
