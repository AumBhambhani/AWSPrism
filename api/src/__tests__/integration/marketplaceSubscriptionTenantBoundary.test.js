import { describe, expect, test } from "vitest";
import request from "supertest";
import app from "../../app.js";
import { query } from "../../db/index.js";
import { createCompany, createUser } from "../setup/helpers.js";

const VICTIM_SUBSCRIPTION_ID = "known-victim-subscription";

async function createTenant(label) {
  const suffix = `${Date.now()}-${Math.random().toString(16).slice(2)}`;
  return createCompany({
    name: `Marketplace ${label}`,
    domain: `marketplace-${label.toLowerCase()}-${suffix}.test`,
    adminEmail: `admin-${label.toLowerCase()}-${suffix}@test.local`,
  });
}

async function createTenantUser(companyId, role) {
  const suffix = `${Date.now()}-${Math.random().toString(16).slice(2)}`;
  const user = await createUser(companyId, role, {
    email: `${role.toLowerCase()}-${suffix}@test.local`,
  });

  if (role === "AUDITOR") {
    await query(
      `INSERT INTO auditor_profiles
         (user_id, company_id, start_date, expiry_date, active)
       VALUES ($1, $2, CURRENT_DATE - INTERVAL '1 day', CURRENT_DATE + INTERVAL '30 days', TRUE)`,
      [user.id, companyId]
    );
  }

  return user;
}

async function seedSubscription(companyId, subscriptionId, overrides = {}) {
  const result = await query(
    `INSERT INTO marketplace_subscriptions
       (subscription_id, company_id, plan_id, quantity, status,
        purchaser_email, purchaser_tenant_id,
        beneficiary_email, beneficiary_tenant_id,
        offer_id, publisher_id,
        term_start_date, term_end_date,
        auto_renew, is_free_trial)
     VALUES
       ($1, $2, $3, $4, $5,
        $6, $7, $8, $9, $10, $11,
        $12, $13, $14, $15)
     RETURNING *`,
    [
      subscriptionId,
      companyId,
      overrides.planId ?? "victim-enterprise-plan",
      overrides.quantity ?? 37,
      overrides.status ?? "Subscribed",
      overrides.purchaserEmail ?? "victim-purchaser@victim.example",
      overrides.purchaserTenantId ?? "victim-purchaser-tenant-id",
      overrides.beneficiaryEmail ?? "victim-beneficiary@victim.example",
      overrides.beneficiaryTenantId ?? "victim-beneficiary-tenant-id",
      overrides.offerId ?? "victim-private-offer-id",
      overrides.publisherId ?? "victim-publisher-id",
      overrides.termStartDate ?? "2026-01-01T00:00:00.000Z",
      overrides.termEndDate ?? "2027-01-01T00:00:00.000Z",
      overrides.autoRenew ?? false,
      overrides.isFreeTrial ?? true,
    ]
  );
  return result.rows[0];
}

function getSubscription(subscriptionId, token) {
  const req = request(app).get(`/api/marketplace/subscription/${subscriptionId}`);
  return token ? req.set("Authorization", `Bearer ${token}`) : req;
}

describe("F-04 marketplace subscription tenant boundary", () => {
  test.each(["ADMIN", "LEAD", "CONTRIBUTOR", "REVIEWER", "AUDITOR"])(
    "Tenant A %s cannot retrieve Tenant B's subscription by a known subscription ID",
    async (role) => {
      const attackerCompany = await createTenant(`Attacker ${role}`);
      const victimCompany = await createTenant(`Victim ${role}`);
      const attacker = await createTenantUser(attackerCompany.id, role);
      await seedSubscription(victimCompany.id, VICTIM_SUBSCRIPTION_ID);

      const result = await getSubscription(VICTIM_SUBSCRIPTION_ID, attacker.token);

      expect.soft(result.status).toBe(404);
      expect.soft(result.body).not.toHaveProperty("id");
      expect.soft(result.body).not.toHaveProperty("company_id");
      expect.soft(result.body).not.toHaveProperty("subscription_id");
      expect.soft(result.body).not.toHaveProperty("purchaser_email");
      expect.soft(result.body).not.toHaveProperty("purchaser_tenant_id");
      expect.soft(result.body).not.toHaveProperty("beneficiary_email");
      expect.soft(result.body).not.toHaveProperty("beneficiary_tenant_id");
      expect.soft(result.body).not.toHaveProperty("plan_id");
      expect.soft(result.body).not.toHaveProperty("quantity");
      expect.soft(result.body).not.toHaveProperty("status");
      expect.soft(result.body).not.toHaveProperty("offer_id");
      expect.soft(result.body).not.toHaveProperty("publisher_id");
      expect.soft(result.body).not.toHaveProperty("term_start_date");
      expect.soft(result.body).not.toHaveProperty("term_end_date");
      expect.soft(result.body).not.toHaveProperty("auto_renew");
      expect.soft(result.body).not.toHaveProperty("is_free_trial");
      expect.soft(result.body).not.toHaveProperty("created_at");
      expect(result.body).not.toHaveProperty("updated_at");
    }
  );

  test("Tenant A can retrieve its own known subscription", async () => {
    const company = await createTenant("Own");
    const admin = await createTenantUser(company.id, "ADMIN");
    const own = await seedSubscription(company.id, "tenant-a-own-subscription", {
      purchaserEmail: "tenant-a-purchaser@tenant-a.example",
      beneficiaryEmail: "tenant-a-beneficiary@tenant-a.example",
    });

    const result = await getSubscription(own.subscription_id, admin.token);

    expect.soft(result.status).toBe(200);
    expect(result.body).toMatchObject({
      id: own.id,
      company_id: company.id,
      subscription_id: own.subscription_id,
      purchaser_email: "tenant-a-purchaser@tenant-a.example",
      beneficiary_email: "tenant-a-beneficiary@tenant-a.example",
      plan_id: own.plan_id,
      quantity: own.quantity,
      status: own.status,
    });
  });

  test.each(["LEAD", "CONTRIBUTOR", "REVIEWER", "AUDITOR"])(
    "a %s cannot retrieve marketplace subscription details, including for its own company",
    async (role) => {
      const company = await createTenant(`Role ${role}`);
      const user = await createTenantUser(company.id, role);
      const own = await seedSubscription(company.id, `role-${role.toLowerCase()}-subscription`);

      const result = await getSubscription(own.subscription_id, user.token);

      expect.soft(result.status).toBe(403);
      expect.soft(result.body).toEqual({ error: "Forbidden" });
      expect.soft(result.body).not.toHaveProperty("purchaser_email");
      expect.soft(result.body).not.toHaveProperty("beneficiary_email");
      expect(result.body).not.toHaveProperty("company_id");
    }
  );

  test("an unknown subscription ID returns 404", async () => {
    const company = await createTenant("Unknown");
    const admin = await createTenantUser(company.id, "ADMIN");

    const result = await getSubscription("unknown-marketplace-subscription", admin.token);

    expect.soft(result.status).toBe(404);
    expect(result.body).toEqual({ error: "Not found" });
  });

  test("an unauthenticated request is rejected", async () => {
    const victimCompany = await createTenant("Unauthenticated Victim");
    await seedSubscription(victimCompany.id, VICTIM_SUBSCRIPTION_ID);

    const result = await getSubscription(VICTIM_SUBSCRIPTION_ID);

    expect.soft(result.status).toBe(401);
    expect(result.body).toEqual({ error: "Unauthorized" });
  });

  test("a suspended tenant account is rejected before subscription lookup", async () => {
    const company = await createTenant("Suspended");
    const admin = await createTenantUser(company.id, "ADMIN");
    const own = await seedSubscription(company.id, "suspended-tenant-subscription");
    await query("UPDATE companies SET status='suspended' WHERE id=$1", [company.id]);

    const result = await getSubscription(own.subscription_id, admin.token);

    expect.soft(result.status).toBe(403);
    expect(result.body.code).toBe("COMPANY_SUSPENDED");
  });

  test("an expired tenant subscription is rejected before marketplace lookup", async () => {
    const company = await createTenant("Expired Billing");
    const admin = await createTenantUser(company.id, "ADMIN");
    const own = await seedSubscription(company.id, "expired-billing-subscription");
    await query("UPDATE companies SET billing_status='expired' WHERE id=$1", [company.id]);

    const result = await getSubscription(own.subscription_id, admin.token);

    expect.soft(result.status).toBe(403);
    expect(result.body.code).toBe("SUBSCRIPTION_EXPIRED");
  });

  test("an expired auditor account is rejected before subscription lookup", async () => {
    const company = await createTenant("Expired Auditor");
    const auditor = await createTenantUser(company.id, "AUDITOR");
    const own = await seedSubscription(company.id, "expired-auditor-subscription");
    await query(
      "UPDATE auditor_profiles SET expiry_date=CURRENT_DATE - INTERVAL '1 day', active=TRUE WHERE user_id=$1",
      [auditor.id]
    );

    const result = await getSubscription(own.subscription_id, auditor.token);

    expect.soft(result.status).toBe(403);
    expect.soft(result.body).toEqual({ error: "Auditor access has expired" });
    const profile = await query("SELECT active FROM auditor_profiles WHERE user_id=$1", [auditor.id]);
    expect(profile.rows[0].active).toBe(false);
  });
});
