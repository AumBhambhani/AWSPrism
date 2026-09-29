import { test, expect } from "@playwright/test";

const CONSENT = JSON.stringify({
  action: "accepted_all",
  choices: { strictly_necessary: true, functional: true, analytics: true, marketing: true },
  version: "1.0",
  timestamp: 1000000000000,
});

// Sets route mocks and pre-loads auth into localStorage via addInitScript so
// React reads the correct role before its first render (avoids race with page.evaluate).
async function setAuth(page, role, { onboardingCompleted = true, isVerified = true } = {}) {
  const user = { id: 1, email: `${role.toLowerCase()}@test.com`, role, onboardingCompleted };
  const company = { id: 1, name: "Test Corp", isVerified };

  // Specific mocks first (first-match wins in Playwright)
  await page.route("**/api/prefs/version", r => r.fulfill({ json: { version: "1.0" } }));
  await page.route("**/api/settings", r => r.fulfill({
    json: { logoUrl: null, primaryColor: null, aiEnabled: true },
  }));
  await page.route("**/api/auth/me", r => r.fulfill({ json: { user, company } }));
  await page.route(url => url.pathname.startsWith("/api/"), r => r.fulfill({ json: [] }));

  // addInitScript runs before React initializes on every subsequent navigation
  await page.addInitScript(({ u, c, consent }) => {
    localStorage.setItem("token", "mock-token");
    localStorage.setItem("user", JSON.stringify(u));
    localStorage.setItem("company", JSON.stringify(c));
    localStorage.setItem("cookie_consent", consent);
  }, { u: user, c: company, consent: CONSENT });
}

test.describe("Route guards", () => {
  test.beforeEach(async ({ page }) => {
    // Pre-dismiss the cookie consent banner on every navigation so it never blocks the UI
    await page.addInitScript((consent) => {
      localStorage.setItem("cookie_consent", consent);
    }, CONSENT);
    await page.goto("/");
    await page.evaluate(() => {
      localStorage.clear();
    });
  });

  test("unauthenticated access to /tracker redirects to /", async ({ page }) => {
    await page.route("**/api/prefs/version", r => r.fulfill({ json: { version: "1.0" } }));
    await page.goto("/tracker");
    await expect(page).toHaveURL("/", { timeout: 5_000 });
  });

  test("unauthenticated access to /vault redirects to /login", async ({ page }) => {
    await page.route("**/api/prefs/version", r => r.fulfill({ json: { version: "1.0" } }));
    await page.goto("/vault");
    await expect(page).toHaveURL("/login", { timeout: 5_000 });
  });

  test("REVIEWER role at /tracker is redirected to /review", async ({ page }) => {
    await setAuth(page, "REVIEWER");
    await page.goto("/tracker");
    await expect(page).toHaveURL(/\/review/, { timeout: 15_000 });
  });

  test("AUDITOR role at /tracker is redirected to /dashboard", async ({ page }) => {
    await setAuth(page, "AUDITOR");
    await page.goto("/tracker");
    await expect(page).toHaveURL(/\/dashboard/, { timeout: 15_000 });
  });

  test("SUPERADMIN at /tracker is redirected to /superadmin", async ({ page }) => {
    await setAuth(page, "SUPERADMIN");
    await page.goto("/tracker");
    await expect(page).toHaveURL(/\/superadmin/, { timeout: 15_000 });
  });

  test("unverified ADMIN at /tracker is redirected to /self-assess", async ({ page }) => {
    await setAuth(page, "ADMIN", { isVerified: false, onboardingCompleted: true });
    await page.goto("/tracker");
    await expect(page).toHaveURL(/\/self-assess/, { timeout: 15_000 });
  });

  test("ADMIN with completed onboarding reaches /tracker", async ({ page }) => {
    await setAuth(page, "ADMIN");
    await page.goto("/tracker");
    await expect(page).toHaveURL(/\/tracker/, { timeout: 10_000 });
  });
});
