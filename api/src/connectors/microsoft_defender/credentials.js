import { resolveMicrosoftGraphCredentials } from "../shared/microsoftGraphAuth.js";

export function resolveDefenderCredentials({ authType, config, secret }) {
  if (authType !== "oauth2") throw new Error(`Unsupported Microsoft Defender auth type: ${authType}`);
  // Token audience: https://api.securitycenter.microsoft.com (v1 endpoint)
  // Request base URL: https://api.security.microsoft.com (unified endpoint)
  // These are DIFFERENT strings — the token resource and the API host must not be assumed to match.
  return resolveMicrosoftGraphCredentials({
    config,
    secret,
    resource: "https://api.securitycenter.microsoft.com",
  });
}

// The Defender for Endpoint API base URL is the unified endpoint.
// Do not confuse this with the token audience above.
export const DEFENDER_BASE_URL = "https://api.security.microsoft.com";
