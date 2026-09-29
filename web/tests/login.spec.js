import { test, expect } from "@playwright/test";

// A valid session payload that the app accepts after login
const MOCK_SESSION = {
  token: "mock-jwt-token",
  user: { id: 1, email: "admin@test.com", role: "ADMIN", onboardingCompleted: true },
  company: { id: 1, name: "Test Corp", isVerified: true, plan: "custom", billingStatus: "active" },
};

const CONSENT = JSON.stringify({
  action: "accepted_all",
  choices: { strictly_necessary: true, functional: true, analytics: true, marketing: true },
  version: "1.0",
  timestamp: 1000000000000,
});

// Mock all ambient API calls the app fires on startup / page load
async function mockAmbient(page) {
  await page.route("**/api/prefs/version", r => r.fulfill({ json: { version: "1.0" } }));
  await page.route("**/api/settings", r => r.fulfill({
    json: { logoUrl: null, primaryColor: null, aiEnabled: true },
  }));
  await page.route("**/api/auth/me", r => r.fulfill({
    json: {
      user: { id: 1, email: "admin@test.com", role: "ADMIN", companyId: 1, onboardingCompleted: true },
      company: { id: 1, name: "Test Corp", isVerified: true },
    },
  }));
  // Catch-all for any other API calls the Tracker / Review page may fire
  await page.route(url => url.pathname.startsWith("/api/"), r => r.fulfill({ json: [] }));
}

test.describe("Login page", () => {
  test.beforeEach(async ({ page }) => {
    // Pre-dismiss the cookie consent banner on every navigation so it never blocks the UI.
    // Version "1.0" matches the mock responses so needsBanner stays false.
    await page.addInitScript((consent) => {
      localStorage.setItem("cookie_consent", consent);
    }, CONSENT);

    // Clear any leftover auth state from previous tests
    await page.goto("/");
    await page.evaluate(() => {
      localStorage.removeItem("token");
      localStorage.removeItem("user");
      localStorage.removeItem("company");
    });
  });

  test("valid credentials redirect to /tracker", async ({ page }) => {
    await mockAmbient(page);
    await page.route("**/api/auth/login", r => r.fulfill({ json: MOCK_SESSION }));

    await page.goto("/login");
    await page.fill("#email", "admin@test.com");
    await page.fill("#password", "Test@1234");
    await page.click("button[type=submit]");

    await expect(page).toHaveURL(/\/tracker/, { timeout: 10_000 });
  });

  test("wrong password shows inline error", async ({ page }) => {
    await page.route("**/api/prefs/version", r => r.fulfill({ json: { version: "1.0" } }));
    await page.route("**/api/auth/login", r =>
      r.fulfill({ status: 401, json: { error: "Invalid credentials" } })
    );

    await page.goto("/login");
    await page.fill("#email", "admin@test.com");
    await page.fill("#password", "wrong-password");
    await page.click("button[type=submit]");

    await expect(page.locator(".error-text")).toBeVisible();
    await expect(page).toHaveURL(/\/login/);
  });

  test("unauthenticated user is not shown authenticated content", async ({ page }) => {
    await page.route("**/api/prefs/version", r => r.fulfill({ json: { version: "1.0" } }));
    await page.goto("/login");

    // Submit button should be visible; no dashboard content
    await expect(page.locator("button[type=submit]")).toBeVisible();
    await expect(page.locator("text=Tracker")).not.toBeVisible();
  });
});
