import { query } from "../db/index.js";

/**
 * Write one row to audit_logs. Never throws — failures are swallowed so they
 * never break the primary request path.
 */
export async function writeAuditLog({ userId, companyId, email, action, resource, detail, ip }) {
  try {
    await query(
      `INSERT INTO audit_logs (user_id, company_id, email, action, resource, detail, ip)
       VALUES ($1, $2, $3, $4, $5, $6, $7)`,
      [
        userId   ?? null,
        companyId,
        email    ?? null,
        action,
        resource ?? null,
        detail   ? JSON.stringify(detail) : null,
        ip       ?? null
      ]
    );
  } catch (e) {
    console.error("[audit_log] write failed:", e.message);
  }
}
