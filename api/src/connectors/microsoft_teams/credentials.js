import { resolveMicrosoftGraphCredentials } from "../shared/microsoftGraphAuth.js";

export function resolveTeamsCredentials({ authType, config, secret }) {
  if (authType !== "oauth2") throw new Error(`Unsupported Microsoft Teams auth type: ${authType}`);
  // Both Graph v1.0 core resources and beta TCM resources share the same Graph token audience.
  return resolveMicrosoftGraphCredentials({ config, secret, resource: "https://graph.microsoft.com" });
}
