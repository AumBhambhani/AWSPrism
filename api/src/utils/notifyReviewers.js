import { query } from "../db/index.js";

/**
 * Insert a notification for every user in the company holding one of `roles`
 * (default ADMIN/LEAD — the reviewer pool). Fire-and-forget — errors are logged
 * but never thrown.
 */
export async function notifyReviewers(companyId, { title, body, entityType, entityId, roles } = {}) {
  try {
    const targetRoles = Array.isArray(roles) && roles.length > 0 ? roles : ["ADMIN", "LEAD"];
    const users = await query(
      `SELECT id FROM users WHERE company_id = $1 AND role = ANY($2)`,
      [companyId, targetRoles]
    );
    if (users.rows.length === 0) return;

    const values = [];
    const placeholders = users.rows.map((u, i) => {
      const base = i * 6;
      values.push(companyId, u.id, title, body || null, entityType || null, entityId || null);
      return `($${base + 1}, $${base + 2}, $${base + 3}, $${base + 4}, $${base + 5}, $${base + 6})`;
    });

    await query(
      `INSERT INTO notifications (company_id, user_id, title, body, entity_type, entity_id)
       VALUES ${placeholders.join(", ")}`,
      values
    );
  } catch (err) {
    console.error("[notify] failed to insert notifications:", err.message);
  }
}
