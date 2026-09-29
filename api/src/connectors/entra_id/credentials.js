import { resolveMicrosoftGraphCredentials } from "../shared/microsoftGraphAuth.js";

export function resolveEntraIdCredentials({ authType, config, secret }) {
  if (authType !== "oauth2") throw new Error(`Unsupported Entra ID auth type: ${authType}`);
  return resolveMicrosoftGraphCredentials({
    config,
    secret,
    resource: "https://graph.microsoft.com",
  });
}
