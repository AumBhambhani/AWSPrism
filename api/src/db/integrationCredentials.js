import { query, mapRow } from "./index.js";
import { encryptSecret, decryptSecret } from "../utils/credentialCrypto.js";

export async function storeCredential({ connectionId, companyId, authType, secret }) {
  const encrypted = encryptSecret(JSON.stringify(secret));
  const result = await query(
    `INSERT INTO integration_credentials (connection_id, company_id, auth_type, ciphertext, iv, auth_tag, key_id)
     VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING *`,
    [connectionId, companyId, authType, encrypted.ciphertext, encrypted.iv, encrypted.authTag, encrypted.keyId]
  );
  return mapRow(result);
}

export async function getActiveCredential(connectionId, companyId) {
  const result = await query(
    `SELECT * FROM integration_credentials
     WHERE connection_id = $1 AND company_id = $2 AND revoked_at IS NULL
     ORDER BY created_at DESC LIMIT 1`,
    [connectionId, companyId]
  );
  const row = mapRow(result);
  if (!row || !row.ciphertext) return null;
  const secret = JSON.parse(decryptSecret({ ciphertext: row.ciphertext, iv: row.iv, authTag: row.authTag }));
  return { authType: row.authType, secret };
}

export async function revokeCredentials(connectionId, companyId) {
  await query(
    `UPDATE integration_credentials
     SET ciphertext = NULL, iv = NULL, auth_tag = NULL, revoked_at = NOW()
     WHERE connection_id = $1 AND company_id = $2 AND revoked_at IS NULL`,
    [connectionId, companyId]
  );
}
