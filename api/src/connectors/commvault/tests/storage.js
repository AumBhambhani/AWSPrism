import { buildEvidencePayload } from "../../shared/evidencePayload.js";

// UNCONFIRMED (see the connector's credentials.js header): the storage-*policy*
// list endpoint's exact path / envelope was not confirmed. Research surfaced a
// related-but-distinct confirmed endpoint, GET /API/v1/StoragePools, returning a
// { poolName: poolId } dictionary (not an array) — strong evidence Commvault's
// REST conventions are inconsistent across resource types, so this endpoint's
// shape must be verified independently, not inferred from the pools endpoint.
const STORAGE_POLICY_LIST_ENDPOINT = "/StoragePolicy"; // TODO CONFIRM

// UNCONFIRMED envelope key for the array of copies — "copies" / "storagePolicyCopy"
// are both plausible; the helper below accepts either.
const storagePolicyDetailEndpoint = (id) => `/v2/StoragePolicy/${id}?propertyLevel=10`; // TODO CONFIRM

// CONFIRMED: copyFlags.wormCopy (1 = enabled), per cvpysdk's
// StoragePoolCopy.is_compliance_lock_enabled, which reads exactly this field.
// (The enclosing envelope differs for storage *pools* vs storage *policies* —
// the field name itself is what is confirmed, and is the same concept.)
function isWormLockEnabled(copy) {
  return copy?.copyFlags?.wormCopy === 1 || copy?.copyFlags?.wormCopy === true;
}

// UNCONFIRMED: no field for "is encryption enabled on this copy" was found in
// indexed cvpysdk docs (the only encryption-adjacent field,
// copyFlags.preserveEncryptionModeAsInSource, is an aux-copy mode-preservation
// flag, not this). These are the most plausible candidate field names pending
// live confirmation; narrow this list to the one real field once confirmed.
function findEncryptionFlag(copy) {
  const candidates = [
    copy?.copyFlags?.encryptData,
    copy?.copyFlags?.encryptionFlag,
    copy?.dataEncryption?.encryptData,
    copy?.encryptionFlag,
    copy?.encryptData,
  ];
  return candidates.find((value) => value !== undefined);
}

function copyResourceId(policyName, copy) {
  return `${policyName}/${copy?.copyName || copy?.copyId || "copy"}`;
}

// Walks every storage policy and returns a flat [{ policyName, copy }] list.
async function getStoragePolicyCopies(commvault) {
  const list = await commvault.request(STORAGE_POLICY_LIST_ENDPOINT);
  const policies = list?.policies || list?.storagePolicy || [];
  const allCopies = [];
  for (const policy of policies) {
    const policyId = policy.storagePolicyId ?? policy.storagePolicyId ?? policy.id;
    const policyName = policy.storagePolicyName || policy.name || String(policyId);
    const detail = await commvault.request(storagePolicyDetailEndpoint(policyId));
    const copies = detail?.storagePolicyCopy || detail?.copies || detail?.copy || [];
    for (const copy of copies) {
      allCopies.push({ policyName, copy });
    }
  }
  return allCopies;
}

function noCopiesRow(check) {
  return [
    {
      resourceId: "commcell",
      status: "not_applicable",
      message: `No storage policy copies were found in the CommCell to evaluate for ${check}`,
      evidencePayload: buildEvidencePayload({
        resourceType: "commvault_storage_policy_copy",
        resourceId: "commcell",
        resourceName: "Storage policy copies",
        region: null,
        details: { copies: 0 },
      }),
    },
  ];
}

async function checkWormLockEnabled(commvault) {
  const copies = await getStoragePolicyCopies(commvault);
  if (copies.length === 0) return noCopiesRow("WORM / compliance lock");

  return copies.map(({ policyName, copy }) => {
    const enabled = isWormLockEnabled(copy);
    const resourceId = copyResourceId(policyName, copy);
    return {
      resourceId,
      status: enabled ? "pass" : "fail",
      message: enabled
        ? `${resourceId} has WORM / compliance lock enabled`
        : `${resourceId} does not have WORM / compliance lock enabled`,
      evidencePayload: buildEvidencePayload({
        resourceType: "commvault_storage_policy_copy",
        resourceId,
        resourceName: copy?.copyName || resourceId,
        region: null,
        details: { policyName, copyName: copy?.copyName ?? null, wormCopy: copy?.copyFlags?.wormCopy ?? null },
      }),
    };
  });
}

async function checkEncryptionEnabled(commvault) {
  const copies = await getStoragePolicyCopies(commvault);
  if (copies.length === 0) return noCopiesRow("encryption at rest");

  return copies.map(({ policyName, copy }) => {
    const resourceId = copyResourceId(policyName, copy);
    const flag = findEncryptionFlag(copy);

    if (flag === undefined) {
      return {
        resourceId,
        status: "error",
        message:
          `Could not determine encryption status for ${resourceId} — no known encryption field was ` +
          `present on this CommCell's storage policy copy response. The field mapping needs live ` +
          `confirmation against the CommCell's Swagger UI before this check can be trusted.`,
        evidencePayload: buildEvidencePayload({
          resourceType: "commvault_storage_policy_copy",
          resourceId,
          resourceName: copy?.copyName || resourceId,
          region: null,
          details: { policyName, copyName: copy?.copyName ?? null, copyFlags: copy?.copyFlags || {} },
        }),
      };
    }

    const enabled = flag === 1 || flag === true;
    return {
      resourceId,
      status: enabled ? "pass" : "fail",
      message: enabled
        ? `${resourceId} has encryption enabled`
        : `${resourceId} does not have encryption enabled`,
      evidencePayload: buildEvidencePayload({
        resourceType: "commvault_storage_policy_copy",
        resourceId,
        resourceName: copy?.copyName || resourceId,
        region: null,
        details: { policyName, copyName: copy?.copyName ?? null, encryptionFlag: flag },
      }),
    };
  });
}

export const storageTests = [
  {
    key: "commvault.storage.worm_lock_enabled",
    title: "Storage policy copies have WORM / compliance lock enabled",
    failTitle: "A storage policy copy is missing WORM / compliance lock",
    severityDefault: "high",
    isoReferences: ["A.18.1.3"],
    dpdpaControlAreas: ["Retention Schedule"],
    run: (clients) => checkWormLockEnabled(clients.commvault),
  },
  {
    key: "commvault.storage.encryption_enabled",
    title: "Storage policy copies have encryption enabled",
    failTitle: "A storage policy copy does not have encryption enabled",
    severityDefault: "high",
    isoReferences: ["A.10.1.2"],
    dpdpaControlAreas: ["Encryption"],
    run: (clients) => checkEncryptionEnabled(clients.commvault),
  },
];

export { checkWormLockEnabled, checkEncryptionEnabled };
