import { ListSecretsCommand } from "@aws-sdk/client-secrets-manager";

async function listAllSecrets(secretsManager) {
  let secrets = [];
  let nextToken;
  do {
    const resp = await secretsManager.send(new ListSecretsCommand(nextToken ? { NextToken: nextToken } : {}));
    secrets = secrets.concat(resp.SecretList || []);
    nextToken = resp.NextToken;
  } while (nextToken);
  return secrets;
}

export async function checkSecretsManagerRotationEnabled(secretsManager) {
  const secrets = await listAllSecrets(secretsManager);
  if (secrets.length === 0) {
    return [{ resourceId: "account", status: "not_applicable", message: "No Secrets Manager secrets found", evidencePayload: {} }];
  }
  return secrets.map((secret) => {
    const pass = Boolean(secret.RotationEnabled);
    return {
      resourceId: secret.ARN || secret.Name,
      status: pass ? "pass" : "fail",
      message: pass
        ? `${secret.Name} has automatic rotation enabled`
        : `${secret.Name} does not have automatic rotation enabled`,
      evidencePayload: { name: secret.Name, rotationEnabled: Boolean(secret.RotationEnabled) },
    };
  });
}

export async function checkSecretsManagerEncryptedWithCMK(secretsManager) {
  const secrets = await listAllSecrets(secretsManager);
  if (secrets.length === 0) {
    return [{ resourceId: "account", status: "not_applicable", message: "No Secrets Manager secrets found", evidencePayload: {} }];
  }
  return secrets.map((secret) => {
    // Secrets using the default AWS-managed key have no KmsKeyId or the alias aws/secretsmanager
    const kmsKeyId = secret.KmsKeyId || "";
    const pass = kmsKeyId.length > 0 && !kmsKeyId.includes("aws/secretsmanager");
    return {
      resourceId: secret.ARN || secret.Name,
      status: pass ? "pass" : "fail",
      message: pass
        ? `${secret.Name} is encrypted with a customer-managed KMS key`
        : `${secret.Name} is not encrypted with a customer-managed KMS key`,
      evidencePayload: { name: secret.Name, kmsKeyId: kmsKeyId || null },
    };
  });
}

export async function checkSecretsManagerNoStaleSecrets(secretsManager) {
  const secrets = await listAllSecrets(secretsManager);
  const rotatingSecrets = secrets.filter((s) => s.RotationEnabled);
  if (rotatingSecrets.length === 0) {
    return [{ resourceId: "account", status: "not_applicable", message: "No secrets with rotation enabled found", evidencePayload: {} }];
  }
  return rotatingSecrets.map((secret) => {
    const intervalDays = secret.RotationRules?.AutomaticallyAfterDays;
    const lastRotated = secret.LastRotatedDate ? new Date(secret.LastRotatedDate) : null;
    const daysSinceRotation = lastRotated ? Math.floor((Date.now() - lastRotated.getTime()) / 86400000) : null;
    const pass = lastRotated !== null && intervalDays !== undefined && daysSinceRotation <= intervalDays;
    return {
      resourceId: secret.ARN || secret.Name,
      status: pass ? "pass" : "fail",
      message: pass
        ? `${secret.Name} was last rotated ${daysSinceRotation} day(s) ago (interval: ${intervalDays} days)`
        : `${secret.Name} rotation is stalled — last rotated ${daysSinceRotation ?? "never"} day(s) ago (interval: ${intervalDays ?? "unknown"} days)`,
      evidencePayload: { name: secret.Name, lastRotatedDate: secret.LastRotatedDate ?? null, automaticallyAfterDays: intervalDays ?? null, daysSinceRotation },
    };
  });
}

export const secretsManagerTests = [
  { key: "aws.secretsmanager.rotation_enabled", title: "Secrets Manager secrets have automatic rotation enabled", failTitle: "Secrets Manager secret does not have automatic rotation enabled", severityDefault: "high", isoReferences: ["A.9.2.4"], run: (clients) => checkSecretsManagerRotationEnabled(clients.secretsManager) },
  { key: "aws.secretsmanager.encrypted_with_cmk", title: "Secrets Manager secrets are encrypted with a customer-managed key", failTitle: "Secrets Manager secret is not encrypted with a customer-managed key", severityDefault: "medium", isoReferences: ["A.10.1.2"], run: (clients) => checkSecretsManagerEncryptedWithCMK(clients.secretsManager) },
  { key: "aws.secretsmanager.no_stale_secrets", title: "Secrets Manager secrets are rotated within policy", failTitle: "Secrets Manager secret rotation is stalled beyond policy", severityDefault: "medium", isoReferences: ["A.9.2.4"], run: (clients) => checkSecretsManagerNoStaleSecrets(clients.secretsManager) },
];
