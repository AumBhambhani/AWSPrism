import { Octokit } from "@octokit/rest";
import { createAppAuth } from "@octokit/auth-app";

export async function resolveGithubCredentials({ authType, config, secret }) {
  if (authType === "oauth2") {
    if (!config.installationId) throw new Error("GitHub connection is missing config.installationId");
    if (!secret.appId) throw new Error("GitHub connection is missing secret.appId");
    if (!secret.privateKey) throw new Error("GitHub connection is missing secret.privateKey");
    return new Octokit({
      authStrategy: createAppAuth,
      auth: {
        appId: secret.appId,
        privateKey: secret.privateKey,
        installationId: config.installationId,
      },
    });
  }

  throw new Error(`Unsupported GitHub auth type: ${authType}`);
}
