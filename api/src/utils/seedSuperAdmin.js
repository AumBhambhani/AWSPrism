import bcrypt from "bcryptjs";
import { query } from "../db/index.js";

export async function seedSuperAdmin() {
  const email = process.env.SUPERADMIN_EMAIL;
  const password = process.env.SUPERADMIN_PASSWORD;

  if (!email || !password) {
    console.log("  [seed] SUPERADMIN_EMAIL or SUPERADMIN_PASSWORD not set — skipping super admin seed");
    return;
  }

  try {
    const existing = await query(
      "SELECT id, password_hash FROM super_admins WHERE email = $1",
      [email.trim().toLowerCase()]
    );

    if (existing.rows.length > 0) {
      // Verify password matches — update if env password changed
      const matches = await bcrypt.compare(password, existing.rows[0].password_hash);
      if (!matches) {
        const newHash = await bcrypt.hash(password, 10);
        await query(
          // F-21: sessions issued under the old password stop working.
          "UPDATE super_admins SET password_hash = $1, token_version = token_version + 1, updated_at = NOW() WHERE email = $2",
          [newHash, email.trim().toLowerCase()]
        );
        console.log(`  [seed] Super admin password updated for: ${email}`);
      }
      return;
    }

    const passwordHash = await bcrypt.hash(password, 10);
    await query(
      "INSERT INTO super_admins (email, password_hash) VALUES ($1, $2) ON CONFLICT (email) DO NOTHING",
      [email.trim().toLowerCase(), passwordHash]
    );

    console.log(`  [seed] Super admin created: ${email}`);
  } catch (err) {
    console.error("  [seed] Failed to seed super admin:", err.message);
  }
}
