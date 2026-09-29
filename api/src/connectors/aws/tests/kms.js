import { ListKeysCommand, DescribeKeyCommand, GetKeyRotationStatusCommand, GetKeyPolicyCommand } from "@aws-sdk/client-kms";

async function listCustomerManagedKeys(kms) {
  const { Keys } = await kms.send(new ListKeysCommand({}));
  const keys = [];
  for (const key of Keys || []) {
    const { KeyMetadata } = await kms.send(new DescribeKeyCommand({ KeyId: key.KeyId }));
    if (KeyMetadata.KeyManager === "CUSTOMER") keys.push(KeyMetadata);
  }
  return keys;
}

function hasWildcardPrincipal(statement) {
  if (statement.Effect !== "Allow") return false;
  const principal = statement.Principal;
  if (principal === "*") return true;
  if (principal && typeof principal === "object") {
    const values = [].concat(principal.AWS ?? []);
    return values.includes("*");
  }
  return false;
}

export async function checkKmsKeyRotationEnabled(kms) {
  const keys = await listCustomerManagedKeys(kms);
  if (keys.length === 0) {
    return [{ resourceId: "account", status: "not_applicable", message: "No customer-managed KMS keys found", evidencePayload: {} }];
  }
  const results = [];
  for (const key of keys) {
    const { KeyRotationEnabled } = await kms.send(new GetKeyRotationStatusCommand({ KeyId: key.KeyId }));
    const pass = Boolean(KeyRotationEnabled);
    results.push({
      resourceId: key.Arn || key.KeyId,
      status: pass ? "pass" : "fail",
      message: pass
        ? `${key.KeyId} has automatic key rotation enabled`
        : `${key.KeyId} does not have automatic key rotation enabled`,
      evidencePayload: { keyId: key.KeyId, keyRotationEnabled: Boolean(KeyRotationEnabled) },
    });
  }
  return results;
}

export async function checkKmsNoWildcardKeyPolicy(kms) {
  const keys = await listCustomerManagedKeys(kms);
  if (keys.length === 0) {
    return [{ resourceId: "account", status: "not_applicable", message: "No customer-managed KMS keys found", evidencePayload: {} }];
  }
  const results = [];
  for (const key of keys) {
    const { Policy } = await kms.send(new GetKeyPolicyCommand({ KeyId: key.KeyId, PolicyName: "default" }));
    const policyDoc = JSON.parse(Policy);
    const wildcardStatements = (policyDoc.Statement || []).filter(hasWildcardPrincipal);
    const pass = wildcardStatements.length === 0;
    results.push({
      resourceId: key.Arn || key.KeyId,
      status: pass ? "pass" : "fail",
      message: pass
        ? `${key.KeyId}'s key policy does not grant a wildcard principal`
        : `${key.KeyId}'s key policy grants access to a wildcard principal ("*")`,
      evidencePayload: { keyId: key.KeyId, wildcardStatementCount: wildcardStatements.length },
    });
  }
  return results;
}

export const kmsTests = [
  { key: "aws.kms.key_rotation_enabled", title: "Customer-managed KMS keys have rotation enabled", failTitle: "Customer-managed KMS key does not have rotation enabled", severityDefault: "high", isoReferences: ["A.10.1.2"], dpdpaControlAreas: ["Encryption"], run: (clients) => checkKmsKeyRotationEnabled(clients.kms) },
  { key: "aws.kms.no_wildcard_key_policy", title: "KMS key policies do not grant a wildcard principal", failTitle: "KMS key policy grants access to a wildcard principal", severityDefault: "critical", isoReferences: ["A.9.1.2"], run: (clients) => checkKmsNoWildcardKeyPolicy(clients.kms) },
];
