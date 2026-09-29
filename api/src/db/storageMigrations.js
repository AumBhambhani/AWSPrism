import { query, mapRow } from "./index.js";
import { encryptSecret, decryptSecret } from "../utils/credentialCrypto.js";

// One row per company while an evidence-storage backend switch is being migrated.
// Persists the *source* backend descriptor and its encrypted credential so
// storageMigration.js can rebuild the "from" side after an API restart without
// asking the admin to re-enter the previous credentials.

export async function upsertStorageMigration({ companyId, fromBackend, fromConfig, fromAuthType, fromSecret }) {
  const enc = fromSecret ? encryptSecret(JSON.stringify(fromSecret)) : null;
  const result = await query(
    `INSERT INTO storage_migrations (company_id, from_backend, from_config, from_auth_type, ciphertext, iv, auth_tag, key_id, created_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, NOW())
     ON CONFLICT (company_id) DO UPDATE SET
       from_backend = EXCLUDED.from_backend,
       from_config = EXCLUDED.from_config,
       from_auth_type = EXCLUDED.from_auth_type,
       ciphertext = EXCLUDED.ciphertext,
       iv = EXCLUDED.iv,
       auth_tag = EXCLUDED.auth_tag,
       key_id = EXCLUDED.key_id,
       created_at = NOW()
     RETURNING *`,
    [
      companyId,
      fromBackend,
      fromConfig ? JSON.stringify(fromConfig) : null,
      fromAuthType || null,
      enc?.ciphertext || null,
      enc?.iv || null,
      enc?.authTag || null,
      enc?.keyId || null,
    ]
  );
  return mapRow(result);
}

export async function getStorageMigration(companyId) {
  const result = await query("SELECT * FROM storage_migrations WHERE company_id = $1", [companyId]);
  const row = mapRow(result);
  if (!row) return null;
  const fromSecret = row.ciphertext
    ? JSON.parse(decryptSecret({ ciphertext: row.ciphertext, iv: row.iv, authTag: row.authTag }))
    : null;
  return {
    fromBackend: row.fromBackend,
    fromConfig: row.fromConfig || {},
    fromAuthType: row.fromAuthType || null,
    fromSecret,
  };
}

export async function deleteStorageMigration(companyId) {
  await query("DELETE FROM storage_migrations WHERE company_id = $1", [companyId]);
}
