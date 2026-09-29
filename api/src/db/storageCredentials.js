import { query, mapRow } from "./index.js";
import { encryptSecret, decryptSecret } from "../utils/credentialCrypto.js";

// Per-company evidence-storage credentials (BYO S3 / Azure Blob). One row per
// company; the whole secret object is AES-256-GCM encrypted into a single
// ciphertext, mirroring db/integrationCredentials.js.

export async function storeStorageCredential({ companyId, authType, secret }) {
  const encrypted = encryptSecret(JSON.stringify(secret));
  const result = await query(
    `INSERT INTO company_storage_credentials (company_id, auth_type, ciphertext, iv, auth_tag, key_id, updated_at)
     VALUES ($1, $2, $3, $4, $5, $6, NOW())
     ON CONFLICT (company_id) DO UPDATE SET
       auth_type = EXCLUDED.auth_type,
       ciphertext = EXCLUDED.ciphertext,
       iv = EXCLUDED.iv,
       auth_tag = EXCLUDED.auth_tag,
       key_id = EXCLUDED.key_id,
       updated_at = NOW()
     RETURNING *`,
    [companyId, authType, encrypted.ciphertext, encrypted.iv, encrypted.authTag, encrypted.keyId]
  );
  return mapRow(result);
}

export async function getStorageCredential(companyId) {
  const result = await query(
    "SELECT * FROM company_storage_credentials WHERE company_id = $1",
    [companyId]
  );
  const row = mapRow(result);
  if (!row || !row.ciphertext) return null;
  const secret = JSON.parse(decryptSecret({ ciphertext: row.ciphertext, iv: row.iv, authTag: row.authTag }));
  return { authType: row.authType, secret };
}

export async function deleteStorageCredential(companyId) {
  await query("DELETE FROM company_storage_credentials WHERE company_id = $1", [companyId]);
}
