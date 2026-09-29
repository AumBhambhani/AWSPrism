import { paginate } from "./pagination.js";

async function listAllCryptoKeys(cloudkms, projectId) {
  const locations = await paginate(
    (params) => cloudkms.projects.locations.list(params),
    { name: `projects/${projectId}` },
    "locations"
  );

  const keys = [];
  for (const location of locations) {
    const keyRings = await paginate(
      (params) => cloudkms.projects.locations.keyRings.list(params),
      { parent: location.name },
      "keyRings"
    );
    for (const keyRing of keyRings) {
      const cryptoKeys = await paginate(
        (params) => cloudkms.projects.locations.keyRings.cryptoKeys.list(params),
        { parent: keyRing.name },
        "cryptoKeys"
      );
      keys.push(...cryptoKeys);
    }
  }
  return keys;
}

export async function checkKeyRotationEnabled(cloudkms, projectId) {
  const keys = await listAllCryptoKeys(cloudkms, projectId);
  // Only symmetric ENCRYPT_DECRYPT keys support automatic rotation — signing
  // and asymmetric-encryption keys structurally have no rotationPeriod field.
  const rotatable = keys.filter((k) => k.purpose === "ENCRYPT_DECRYPT");
  if (rotatable.length === 0) {
    return [{ resourceId: projectId, status: "not_applicable", message: "No symmetric encryption Cloud KMS keys found", evidencePayload: {} }];
  }
  return rotatable.map((key) => {
    const rotationEnabled = Boolean(key.rotationPeriod);
    return {
      resourceId: key.name,
      status: rotationEnabled ? "pass" : "fail",
      message: rotationEnabled ? `${key.name} has automatic rotation configured (${key.rotationPeriod})` : `${key.name} has no automatic rotation configured`,
      evidencePayload: { key: key.name, rotationPeriod: key.rotationPeriod || null },
    };
  });
}

export const kmsTests = [
  {
    key: "gcp.kms.key_rotation_enabled",
    title: "Cloud KMS symmetric keys have automatic rotation enabled",
    failTitle: "Cloud KMS symmetric key has no automatic rotation configured",
    severityDefault: "medium",
    isoReferences: ["A.10.1.2"],
    dpdpaControlAreas: ["Encryption"],
    run: (clients) => checkKeyRotationEnabled(clients.cloudkms, clients.projectId),
  },
];
