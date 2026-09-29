import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, test, vi } from "vitest";
import request from "supertest";
import app from "../../app.js";
import { query } from "../../db/index.js";
import { createCompany, createUser } from "../setup/helpers.js";

const originalMarketplaceEnv = {
  tenantId: process.env.AZURE_TENANT_ID,
  clientId: process.env.AZURE_MARKETPLACE_CLIENT_ID,
  clientSecret: process.env.AZURE_MARKETPLACE_CLIENT_SECRET,
};

let microsoftActivationSucceeds;
let fetchMock;

function response({ ok, status, json = {}, text = "" }) {
  return {
    ok,
    status,
    json: vi.fn().mockResolvedValue(json),
    text: vi.fn().mockResolvedValue(text),
  };
}

function activationCalls() {
  return fetchMock.mock.calls.filter(([url]) => String(url).includes("marketplaceapi.microsoft.com") && String(url).includes("/activate"));
}

async function tenantPair() {
  const companyA = await createCompany({
    name: "Tenant A",
    domain: `marketplace-a-${Date.now()}-${Math.random()}.test`,
    adminEmail: `marketplace-a-${Date.now()}-${Math.random()}@test.local`,
  });
  const companyB = await createCompany({
    name: "Tenant B",
    domain: `marketplace-b-${Date.now()}-${Math.random()}.test`,
    adminEmail: `marketplace-b-${Date.now()}-${Math.random()}@test.local`,
  });
  const adminA = await createUser(companyA.id, "ADMIN");
  const reviewerA = await createUser(companyA.id, "REVIEWER");
  return { companyA, companyB, adminA, reviewerA };
}

async function seedSubscription(companyId, overrides = {}) {
  const result = await query(
    `INSERT INTO marketplace_subscriptions
       (subscription_id, company_id, plan_id, quantity, status)
     VALUES ($1, $2, $3, $4, $5)
     RETURNING *`,
    [
      overrides.subscriptionId || `victim-sub-${Date.now()}-${Math.random()}`,
      companyId,
      overrides.planId || "starter-monthly",
      overrides.quantity || 3,
      overrides.status || "Subscribed",
    ]
  );
  return result.rows[0];
}

beforeAll(() => {
  process.env.AZURE_TENANT_ID = "marketplace-test-tenant";
  process.env.AZURE_MARKETPLACE_CLIENT_ID = "marketplace-test-client";
  process.env.AZURE_MARKETPLACE_CLIENT_SECRET = "marketplace-test-secret";
});

beforeEach(async () => {
  await query("DELETE FROM marketplace_subscriptions");
  microsoftActivationSucceeds = true;
  fetchMock = vi.fn(async (url) => {
    const target = String(url);
    if (target.includes("login.microsoftonline.com") && target.includes("/oauth2/v2.0/token")) {
      return response({
        ok: true,
        status: 200,
        json: { access_token: "mock-publisher-token", expires_in: 3600 },
      });
    }
    if (target.includes("marketplaceapi.microsoft.com") && target.includes("/activate")) {
      return microsoftActivationSucceeds
        ? response({ ok: true, status: 200 })
        : response({ ok: false, status: 409, text: "activation rejected" });
    }
    throw new Error(`Unexpected external request: ${target}`);
  });
  vi.stubGlobal("fetch", fetchMock);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

afterAll(() => {
  const restore = (key, value) => {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  };
  restore("AZURE_TENANT_ID", originalMarketplaceEnv.tenantId);
  restore("AZURE_MARKETPLACE_CLIENT_ID", originalMarketplaceEnv.clientId);
  restore("AZURE_MARKETPLACE_CLIENT_SECRET", originalMarketplaceEnv.clientSecret);
});

describe("F-03 marketplace activation authorization", () => {
  test("Tenant A cannot activate an existing subscription for Tenant B by supplying Tenant B's companyId", async () => {
    const { companyB, adminA } = await tenantPair();
    const victim = await seedSubscription(companyB.id);
    await query("UPDATE companies SET billing_status='pending', plan='starter' WHERE id=$1", [companyB.id]);

    const result = await request(app)
      .post("/api/marketplace/activate")
      .set("Authorization", `Bearer ${adminA.token}`)
      .send({
        subscriptionId: victim.subscription_id,
        companyId: companyB.id,
        planId: "enterprise-annual",
        quantity: 99,
      });

    expect.soft(result.status).toBe(404);
    const stored = await query("SELECT company_id, plan_id, quantity, status FROM marketplace_subscriptions WHERE subscription_id=$1", [victim.subscription_id]);
    expect.soft(stored.rows[0]).toMatchObject({
      company_id: companyB.id,
      plan_id: victim.plan_id,
      quantity: victim.quantity,
      status: victim.status,
    });
    const company = await query("SELECT billing_status, plan FROM companies WHERE id=$1", [companyB.id]);
    expect(company.rows[0]).toMatchObject({ billing_status: "pending", plan: "starter" });
  });

  test("a client-supplied companyId cannot override the authenticated tenant for a new subscription", async () => {
    const { companyA, companyB, adminA } = await tenantPair();
    const subscriptionId = `new-sub-${Date.now()}-${Math.random()}`;

    const result = await request(app)
      .post("/api/marketplace/activate")
      .set("Authorization", `Bearer ${adminA.token}`)
      .send({ subscriptionId, companyId: companyB.id, planId: "pro-monthly", quantity: 5 });

    expect.soft(result.status).toBe(200);
    const stored = await query("SELECT company_id FROM marketplace_subscriptions WHERE subscription_id=$1", [subscriptionId]);
    expect(stored.rows[0]?.company_id).toBe(companyA.id);
  });

  test("a REVIEWER cannot perform marketplace activation", async () => {
    const { companyA, reviewerA } = await tenantPair();
    const subscriptionId = `reviewer-sub-${Date.now()}-${Math.random()}`;

    const result = await request(app)
      .post("/api/marketplace/activate")
      .set("Authorization", `Bearer ${reviewerA.token}`)
      .send({ subscriptionId, companyId: companyA.id, planId: "pro-monthly", quantity: 2 });

    expect.soft(result.status).toBe(403);
    const stored = await query("SELECT id FROM marketplace_subscriptions WHERE subscription_id=$1", [subscriptionId]);
    expect.soft(stored.rows).toHaveLength(0);
    expect(activationCalls()).toHaveLength(0);
  });

  test("a legitimate tenant ADMIN activation succeeds for its own company", async () => {
    const { companyA, adminA } = await tenantPair();
    const subscriptionId = `legitimate-sub-${Date.now()}-${Math.random()}`;
    await query("UPDATE companies SET billing_status='pending', plan='starter' WHERE id=$1", [companyA.id]);

    const result = await request(app)
      .post("/api/marketplace/activate")
      .set("Authorization", `Bearer ${adminA.token}`)
      .send({ subscriptionId, companyId: companyA.id, planId: "pro-monthly", quantity: 4 });

    expect.soft(result.status).toBe(200);
    expect.soft(result.body).toEqual({ success: true });
    const stored = await query("SELECT company_id, plan_id, quantity, status FROM marketplace_subscriptions WHERE subscription_id=$1", [subscriptionId]);
    expect.soft(stored.rows[0]).toMatchObject({
      company_id: companyA.id,
      plan_id: "pro-monthly",
      quantity: 4,
      status: "Subscribed",
    });
    const company = await query("SELECT billing_status, plan FROM companies WHERE id=$1", [companyA.id]);
    expect.soft(company.rows[0]).toMatchObject({ billing_status: "active", plan: "custom" });
    expect(activationCalls()).toHaveLength(1);
  });

  test("authorization failure leaves local subscription and company state unchanged", async () => {
    const { companyB, reviewerA } = await tenantPair();
    const victim = await seedSubscription(companyB.id, { planId: "starter-monthly", quantity: 7, status: "Suspended" });
    await query("UPDATE companies SET billing_status='suspended', plan='starter' WHERE id=$1", [companyB.id]);

    const result = await request(app)
      .post("/api/marketplace/activate")
      .set("Authorization", `Bearer ${reviewerA.token}`)
      .send({
        subscriptionId: victim.subscription_id,
        companyId: companyB.id,
        planId: "enterprise-annual",
        quantity: 100,
      });

    expect.soft(result.status).toBe(403);
    const stored = await query("SELECT company_id, plan_id, quantity, status FROM marketplace_subscriptions WHERE subscription_id=$1", [victim.subscription_id]);
    expect.soft(stored.rows[0]).toMatchObject({
      company_id: companyB.id,
      plan_id: "starter-monthly",
      quantity: 7,
      status: "Suspended",
    });
    const company = await query("SELECT billing_status, plan FROM companies WHERE id=$1", [companyB.id]);
    expect(company.rows[0]).toMatchObject({ billing_status: "suspended", plan: "starter" });
  });

  test("Tenant A cannot overwrite Tenant B's existing subscription by omitting companyId", async () => {
    const { companyB, adminA } = await tenantPair();
    const victim = await seedSubscription(companyB.id, { planId: "starter-monthly", quantity: 6, status: "Subscribed" });

    const result = await request(app)
      .post("/api/marketplace/activate")
      .set("Authorization", `Bearer ${adminA.token}`)
      .send({ subscriptionId: victim.subscription_id, planId: "enterprise-annual", quantity: 42 });

    expect.soft(result.status).toBe(404);
    const stored = await query("SELECT company_id, plan_id, quantity, status FROM marketplace_subscriptions WHERE subscription_id=$1", [victim.subscription_id]);
    expect(stored.rows[0]).toMatchObject({
      company_id: companyB.id,
      plan_id: "starter-monthly",
      quantity: 6,
      status: "Subscribed",
    });
  });

  test("a rejected Microsoft activation does not leave a local subscription mutation behind", async () => {
    const { companyA, adminA } = await tenantPair();
    const subscriptionId = `rejected-sub-${Date.now()}-${Math.random()}`;
    microsoftActivationSucceeds = false;

    const result = await request(app)
      .post("/api/marketplace/activate")
      .set("Authorization", `Bearer ${adminA.token}`)
      .send({ subscriptionId, companyId: companyA.id, planId: "pro-monthly", quantity: 2 });

    expect.soft(result.status).toBe(409);
    const stored = await query("SELECT id FROM marketplace_subscriptions WHERE subscription_id=$1", [subscriptionId]);
    expect(stored.rows).toHaveLength(0);
  });
});
