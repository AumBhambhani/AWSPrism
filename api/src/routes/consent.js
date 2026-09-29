import { Router } from "express";
import { activeSessionUserId } from "../middleware/auth.js";
import { query } from "../db/index.js";

const router = Router();

const CONSENT_VERSION = "1.0";

// GET /api/consent/version — returns current consent policy version
router.get("/version", (req, res) => {
  res.json({ version: CONSENT_VERSION });
});

// Alias that won't be caught by ad-blocker filter lists (EasyPrivacy, Brave Shields)
router.get("/pv", (req, res) => {
  res.json({ version: CONSENT_VERSION });
});

// POST /api/consent — log cookie consent decision (no auth required)
router.post("/", async (req, res) => {
  const { action, language, consent_version, choices } = req.body;

  const validActions = ["accepted_all", "rejected_all", "custom", "withdrawn"];
  if (!validActions.includes(action)) {
    return res.status(400).json({ error: "Invalid action" });
  }

  // Optionally extract user ID if token is present
  // An invalid, revoked or non-login token just logs the decision anonymously.
  const userId = await activeSessionUserId(req.headers.authorization).catch(() => null);

  const ip = req.ip || req.connection?.remoteAddress || "unknown";

  try {
    await query(
      `INSERT INTO consent_logs (user_id, ip_address, language, consent_version, choices, action)
       VALUES ($1, $2, $3, $4, $5, $6)`,
      [
        userId,
        ip,
        (language || "en").slice(0, 10),
        (consent_version || "1.0").slice(0, 20),
        JSON.stringify(choices || {}),
        action,
      ]
    );
  } catch (err) {
    console.warn("Consent log failed:", err.message);
  }

  res.json({ success: true });
});

// PATCH /api/consent/link — link anonymous consent log to authenticated user
router.patch("/link", async (req, res) => {
  const userId = await activeSessionUserId(req.headers.authorization).catch(() => null);
  if (!userId) return res.status(401).json({ error: "Unauthorized" });

  const ip = req.ip || req.connection?.remoteAddress || "unknown";

  try {
    await query(
      `UPDATE consent_logs SET user_id = $1
       WHERE id = (
         SELECT id FROM consent_logs
         WHERE user_id IS NULL AND ip_address = $2
         ORDER BY created_at DESC LIMIT 1
       )`,
      [userId, ip]
    );
  } catch (err) {
    console.warn("Consent link failed:", err.message);
  }

  res.json({ success: true });
});

export default router;
