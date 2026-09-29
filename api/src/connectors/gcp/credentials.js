import { google } from "googleapis";

// A single broad read-only scope, not a list of narrow per-API scopes like
// google_workspace/credentials.js — GCP's project-level APIs (Compute, Cloud
// SQL, KMS, Storage, IAM, Resource Manager, Logging) don't uniformly offer
// read-only scope variants (Cloud SQL Admin API in particular only exposes
// the single, broader `sqlservice.admin` scope), so Google documents
// `cloud-platform.read-only` specifically for exactly this "read across
// every GCP service with one grant" case. No impersonation/`subject` is
// used here (unlike google_workspace) — this connector authenticates as the
// service account itself, which is granted IAM roles directly on the
// project rather than delegated a Workspace admin's identity.
const SCOPES = ["https://www.googleapis.com/auth/cloud-platform.read-only"];

export async function resolveGcpCredentials({ authType, config, secret }) {
  if (authType !== "oauth2") throw new Error(`Unsupported GCP auth type: ${authType}`);
  if (!config.projectId) throw new Error("GCP connection is missing config.projectId");
  if (!secret.clientEmail) throw new Error("GCP connection is missing secret.clientEmail");
  if (!secret.privateKey) throw new Error("GCP connection is missing secret.privateKey");

  const auth = new google.auth.JWT({
    email: secret.clientEmail,
    key: secret.privateKey,
    scopes: SCOPES,
  });
  // Forces the first token mint — throws if the private key is malformed or
  // the service account no longer exists/is disabled.
  await auth.authorize();

  return {
    compute: google.compute({ version: "v1", auth }),
    sqladmin: google.sqladmin({ version: "v1", auth }),
    storage: google.storage({ version: "v1", auth }),
    cloudkms: google.cloudkms({ version: "v1", auth }),
    iam: google.iam({ version: "v1", auth }),
    cloudresourcemanager: google.cloudresourcemanager({ version: "v3", auth }),
    projectId: config.projectId,
  };
}
