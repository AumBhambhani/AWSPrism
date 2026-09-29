import { Router } from "express";
import jwt from "jsonwebtoken";
import { query } from "../db/index.js";
import { asyncHandler } from "../utils/asyncHandler.js";
import { authenticate } from "../middleware/auth.js";
import { requireRole } from "../middleware/roles.js";

const router = Router();

// Microsoft SaaS Fulfillment API constants
const FULFILLMENT_API_BASE = "https://marketplaceapi.microsoft.com/api/saas";
const FULFILLMENT_API_VERSION = "2018-08-31";
// This is the fixed audience for the SaaS Fulfillment API — always this value
const MARKETPLACE_AUDIENCE = "20e940b3-4c77-4b0b-9a53-9e16a1b010a7";

// In-memory caches (per-process; resets on restart which is fine)
let _jwksCache = null;
let _jwksCacheAt = 0;
let _accessToken = null;
let _accessTokenExpiry = 0;

// ─── JWKS / token validation ──────────────────────────────────────────────

async function getJwks() {
  const now = Date.now();
  if (_jwksCache && now - _jwksCacheAt < 3600_000) return _jwksCache;

  const tenantId = process.env.AZURE_TENANT_ID || "common";
  const resp = await fetch(
    `https://login.microsoftonline.com/${tenantId}/discovery/v2.0/keys`
  );
  if (!resp.ok) throw new Error(`JWKS fetch failed: ${resp.status}`);
  const data = await resp.json();
  _jwksCache = data.keys;
  _jwksCacheAt = now;
  return _jwksCache;
}

async function validateWebhookToken(authHeader) {
  if (!authHeader?.startsWith("Bearer ")) {
    throw new Error("Missing or malformed Authorization header");
  }

  // Allow skipping in dev/test — set MARKETPLACE_SKIP_TOKEN_VALIDATION=true in .env
  const token = authHeader.slice(7);
  if (process.env.MARKETPLACE_SKIP_TOKEN_VALIDATION === "true") {
    return jwt.decode(token) || {};
  }

  const decoded = jwt.decode(token, { complete: true });
  if (!decoded) throw new Error("Malformed JWT");

  const keys = await getJwks();
  const key = keys.find((k) => k.kid === decoded.header.kid);
  if (!key) throw new Error(`No JWKS key for kid=${decoded.header.kid}`);

  // Build PEM from the first certificate in the chain
  const pem = `-----BEGIN CERTIFICATE-----\n${key.x5c[0]}\n-----END CERTIFICATE-----`;

  const verifyOpts = {
    audience: MARKETPLACE_AUDIENCE,
    algorithms: ["RS256"],
  };

  const tenantId = process.env.AZURE_TENANT_ID;
  if (tenantId) {
    verifyOpts.issuer = [
      `https://sts.windows.net/${tenantId}/`,
      `https://login.microsoftonline.com/${tenantId}/v2.0`,
    ];
  }

  return jwt.verify(token, pem, verifyOpts);
}

// ─── Fulfillment API helpers ───────────────────────────────────────────────

async function getAccessToken() {
  const now = Date.now();
  if (_accessToken && now < _accessTokenExpiry - 60_000) return _accessToken;

  const { AZURE_TENANT_ID, AZURE_MARKETPLACE_CLIENT_ID, AZURE_MARKETPLACE_CLIENT_SECRET } =
    process.env;

  if (!AZURE_TENANT_ID || !AZURE_MARKETPLACE_CLIENT_ID || !AZURE_MARKETPLACE_CLIENT_SECRET) {
    throw new Error(
      "Marketplace credentials not configured. Set AZURE_TENANT_ID, AZURE_MARKETPLACE_CLIENT_ID, AZURE_MARKETPLACE_CLIENT_SECRET."
    );
  }

  const body = new URLSearchParams({
    grant_type: "client_credentials",
    client_id: AZURE_MARKETPLACE_CLIENT_ID,
    client_secret: AZURE_MARKETPLACE_CLIENT_SECRET,
    scope: `${MARKETPLACE_AUDIENCE}/.default`,
  });

  const resp = await fetch(
    `https://login.microsoftonline.com/${AZURE_TENANT_ID}/oauth2/v2.0/token`,
    {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: body.toString(),
    }
  );

  if (!resp.ok) {
    const msg = await resp.text();
    throw new Error(`Token exchange failed (${resp.status}): ${msg}`);
  }

  const data = await resp.json();
  _accessToken = data.access_token;
  _accessTokenExpiry = now + data.expires_in * 1000;
  return _accessToken;
}

async function ackOperation(subscriptionId, operationId, status = "Success") {
  try {
    const token = await getAccessToken();
    const url = `${FULFILLMENT_API_BASE}/subscriptions/${encodeURIComponent(subscriptionId)}/operations/${encodeURIComponent(operationId)}?api-version=${FULFILLMENT_API_VERSION}`;
    const resp = await fetch(url, {
      method: "PATCH",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ status }),
    });
    if (!resp.ok) {
      console.error(`[marketplace] ACK ${status} failed (${resp.status}):`, await resp.text()); // nosemgrep
    } else {
      console.log(`[marketplace] ACK ${status} sent for op=${operationId}`);
    }
  } catch (err) {
    console.error("[marketplace] ACK error:", err.message);
  }
}

// Map a marketplace planId to PRISM's internal plan name (starter | custom)
function toPrismPlan(planId = "") {
  const p = planId.toLowerCase();
  if (p.includes("custom") || p.includes("enterprise") || p.includes("pro") || p.includes("growth")) return "custom";
  return "starter";
}

// ─── Webhook event processor ───────────────────────────────────────────────

async function processEvent(payload) {
  const {
    id: operationId,
    action,
    subscriptionId,
    planId,
    quantity,
    subscription,
  } = payload;

  console.log(`[marketplace] action=${action} sub=${subscriptionId} op=${operationId}`);

  switch (action) {
    case "Subscribed": {
      const sub = subscription || {};
      await query(
        `INSERT INTO marketplace_subscriptions
           (subscription_id, plan_id, quantity, status,
            purchaser_email, purchaser_tenant_id,
            beneficiary_email, beneficiary_tenant_id,
            offer_id, publisher_id,
            term_start_date, term_end_date,
            auto_renew, is_free_trial, updated_at)
         VALUES ($1,$2,$3,'Subscribed',$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,NOW())
         ON CONFLICT (subscription_id) DO UPDATE SET
           plan_id = EXCLUDED.plan_id,
           quantity = EXCLUDED.quantity,
           status = 'Subscribed',
           updated_at = NOW()`,
        [
          subscriptionId,
          planId || sub.planId || null,
          quantity || sub.quantity || 1,
          sub.purchaser?.emailId || null,
          sub.purchaser?.tenantId || null,
          sub.beneficiary?.emailId || null,
          sub.beneficiary?.tenantId || null,
          sub.offerId || null,
          sub.publisherId || null,
          sub.term?.startDate || null,
          sub.term?.endDate || null,
          sub.autoRenew ?? true,
          sub.isFreeTrial ?? false,
        ]
      );
      // Activate the linked company if one exists
      await query(
        `UPDATE companies SET billing_status = 'active', plan = $2, updated_at = NOW()
         WHERE id = (
           SELECT company_id FROM marketplace_subscriptions
           WHERE subscription_id = $1 AND company_id IS NOT NULL
         )`,
        [subscriptionId, toPrismPlan(planId)]
      );
      break;
    }

    case "Unsubscribed": {
      await query(
        "UPDATE marketplace_subscriptions SET status='Unsubscribed', updated_at=NOW() WHERE subscription_id=$1",
        [subscriptionId]
      );
      await query(
        `UPDATE companies SET billing_status='cancelled', updated_at=NOW()
         WHERE id=(SELECT company_id FROM marketplace_subscriptions WHERE subscription_id=$1 AND company_id IS NOT NULL)`,
        [subscriptionId]
      );
      break;
    }

    case "Suspend": {
      await query(
        "UPDATE marketplace_subscriptions SET status='Suspended', updated_at=NOW() WHERE subscription_id=$1",
        [subscriptionId]
      );
      await query(
        `UPDATE companies SET billing_status='suspended', updated_at=NOW()
         WHERE id=(SELECT company_id FROM marketplace_subscriptions WHERE subscription_id=$1 AND company_id IS NOT NULL)`,
        [subscriptionId]
      );
      break;
    }

    case "Reinstate": {
      await query(
        "UPDATE marketplace_subscriptions SET status='Subscribed', updated_at=NOW() WHERE subscription_id=$1",
        [subscriptionId]
      );
      await query(
        `UPDATE companies SET billing_status='active', updated_at=NOW()
         WHERE id=(SELECT company_id FROM marketplace_subscriptions WHERE subscription_id=$1 AND company_id IS NOT NULL)`,
        [subscriptionId]
      );
      break;
    }

    case "ChangePlan": {
      await query(
        "UPDATE marketplace_subscriptions SET plan_id=$2, updated_at=NOW() WHERE subscription_id=$1",
        [subscriptionId, planId || null]
      );
      await query(
        `UPDATE companies SET plan=$2, updated_at=NOW()
         WHERE id=(SELECT company_id FROM marketplace_subscriptions WHERE subscription_id=$1 AND company_id IS NOT NULL)`,
        [subscriptionId, toPrismPlan(planId)]
      );
      break;
    }

    case "ChangeQuantity": {
      await query(
        "UPDATE marketplace_subscriptions SET quantity=$2, updated_at=NOW() WHERE subscription_id=$1",
        [subscriptionId, quantity || 1]
      );
      break;
    }

    case "Renew": {
      const sub = subscription || {};
      await query(
        `UPDATE marketplace_subscriptions SET
           status='Subscribed', term_start_date=$2, term_end_date=$3, updated_at=NOW()
         WHERE subscription_id=$1`,
        [subscriptionId, sub.term?.startDate || null, sub.term?.endDate || null]
      );
      await query(
        `UPDATE companies SET billing_status='active', updated_at=NOW()
         WHERE id=(SELECT company_id FROM marketplace_subscriptions WHERE subscription_id=$1 AND company_id IS NOT NULL)`,
        [subscriptionId]
      );
      break;
    }

    case "Transfer": {
      await query(
        "UPDATE marketplace_subscriptions SET status='Subscribed', updated_at=NOW() WHERE subscription_id=$1",
        [subscriptionId]
      );
      break;
    }

    default:
      console.warn(`[marketplace] Unhandled action: ${action}`);
  }

  await ackOperation(subscriptionId, operationId, "Success");
}

// ─── Routes ────────────────────────────────────────────────────────────────

// POST /api/marketplace/webhook
// Called by Microsoft for every subscription lifecycle event.
// Must return 200 quickly; processing runs asynchronously after the response.
router.post(
  "/webhook",
  asyncHandler(async (req, res) => {
    // Validate Microsoft's JWT before doing anything
    try {
      await validateWebhookToken(req.headers.authorization);
    } catch (err) {
      console.error("[marketplace] Token validation failed:", err.message);
      return res.status(401).json({ error: "Unauthorized" });
    }

    // Respond 200 immediately so Microsoft doesn't retry
    res.status(200).json({ received: true });

    // Process asynchronously — errors are caught and logged, never crash the server
    processEvent(req.body).catch((err) => {
      console.error("[marketplace] Event processing failed:", err.message);
      // Attempt to NACK the operation if we know the IDs
      const { id: operationId, subscriptionId } = req.body || {};
      if (subscriptionId && operationId) {
        ackOperation(subscriptionId, operationId, "Failure").catch(() => {});
      }
    });
  })
);

// POST /api/marketplace/resolve
// Called by the landing page with the marketplace purchase token.
// Returns subscription details (plan, purchaser, offer) so the UI can
// show a confirmation screen before activating.
router.post(
  "/resolve",
  asyncHandler(async (req, res) => {
    const { token } = req.body;
    if (!token) return res.status(400).json({ error: "token is required" });

    const accessToken = await getAccessToken();
    const resp = await fetch(
      `${FULFILLMENT_API_BASE}/subscriptions/resolve?api-version=${FULFILLMENT_API_VERSION}`,
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${accessToken}`,
          "Content-Type": "application/json",
          "x-ms-marketplace-token": token,
        },
      }
    );

    if (!resp.ok) {
      const body = await resp.text();
      console.error("[marketplace] Resolve failed:", body);
      return res.status(resp.status).json({ error: "Failed to resolve marketplace token" });
    }

    res.json(await resp.json());
  })
);

// POST /api/marketplace/activate
// Called after the customer completes onboarding on the landing page.
// Links the subscription to a PRISM company and calls the Fulfillment Activate API.
router.post(
  "/activate",
  authenticate,
  requireRole(["ADMIN"]),
  asyncHandler(async (req, res) => {
    const rawSubscriptionId = req.body.subscriptionId;
    const rawPlanId = req.body.planId;
    const quantity = req.body.quantity ?? 1;
    const companyId = req.user.companyId;

    if (typeof rawSubscriptionId !== "string" || !rawSubscriptionId.trim()) {
      return res.status(400).json({ error: "subscriptionId is required" });
    }
    if (typeof rawPlanId !== "string" || !rawPlanId.trim()) {
      return res.status(400).json({ error: "planId is required" });
    }
    if (!Number.isInteger(quantity) || quantity < 1 || quantity > 2147483647) {
      return res.status(400).json({ error: "quantity must be a positive integer" });
    }

    const subscriptionId = rawSubscriptionId.trim();
    const planId = rawPlanId.trim();

    // An unlinked subscription may be claimed during legitimate onboarding.
    // Once linked, only an administrator from that company may activate it.
    const existing = await query(
      "SELECT company_id FROM marketplace_subscriptions WHERE subscription_id=$1",
      [subscriptionId]
    );
    const ownerCompanyId = existing.rows[0]?.company_id;
    if (ownerCompanyId != null && Number(ownerCompanyId) !== Number(companyId)) {
      return res.status(404).json({ error: "Subscription not found" });
    }

    // Tell Microsoft the subscription is active
    const accessToken = await getAccessToken();
    const resp = await fetch(
      `${FULFILLMENT_API_BASE}/subscriptions/${encodeURIComponent(subscriptionId)}/activate?api-version=${FULFILLMENT_API_VERSION}`,
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${accessToken}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ planId, quantity }),
      }
    );

    if (!resp.ok) {
      const body = await resp.text();
      console.error("[marketplace] Activate failed:", body);
      return res.status(resp.status).json({ error: "Failed to activate subscription" });
    }

    // Persist authoritative local state only after Microsoft accepts activation.
    // The conflict predicate prevents a concurrent request from rebinding a
    // subscription that another company linked after the ownership check above.
    const activated = await query(
      `INSERT INTO marketplace_subscriptions
         (subscription_id, plan_id, quantity, status, company_id, updated_at)
       VALUES ($1,$2,$3,'Subscribed',$4,NOW())
       ON CONFLICT (subscription_id) DO UPDATE SET
         plan_id    = EXCLUDED.plan_id,
         quantity   = EXCLUDED.quantity,
         status     = 'Subscribed',
         company_id = EXCLUDED.company_id,
         updated_at = NOW()
       WHERE marketplace_subscriptions.company_id IS NULL
          OR marketplace_subscriptions.company_id = EXCLUDED.company_id
       RETURNING id`,
      [subscriptionId, planId, quantity, companyId]
    );
    if (activated.rows.length === 0) {
      return res.status(409).json({ error: "Subscription ownership changed during activation" });
    }

    await query(
      "UPDATE companies SET billing_status='active', plan=$1, updated_at=NOW() WHERE id=$2",
      [toPrismPlan(planId), companyId]
    );

    res.json({ success: true });
  })
);

// GET /api/marketplace/subscription/:subscriptionId
// Internal lookup — returns the subscription record linked to a company.
router.get(
  "/subscription/:subscriptionId",
  authenticate,
  asyncHandler(async (req, res, next) => {
    const result = await query(
      `SELECT id, subscription_id, company_id, plan_id, quantity, status,
              purchaser_email, purchaser_tenant_id,
              beneficiary_email, beneficiary_tenant_id,
              offer_id, publisher_id,
              term_start_date, term_end_date,
              auto_renew, is_free_trial, created_at, updated_at
       FROM marketplace_subscriptions
       WHERE subscription_id=$1 AND company_id=$2`,
      [req.params.subscriptionId, req.user.companyId]
    );
    if (!result.rows.length) return res.status(404).json({ error: "Not found" });
    res.locals.marketplaceSubscription = result.rows[0];
    next();
  }),
  requireRole(["ADMIN"]),
  (req, res) => res.json(res.locals.marketplaceSubscription)
);

export default router;
