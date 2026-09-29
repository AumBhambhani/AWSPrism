// Shared test helpers — imported by all spec files.

export const CONSENT = JSON.stringify({
  action: "accepted_all",
  choices: { strictly_necessary: true, functional: true, analytics: true, marketing: true },
  version: "1.0",
  timestamp: 1000000000000,
});

/**
 * Add cookie consent to localStorage via initScript so the banner never
 * blocks the UI. Call before the first page.goto() in a test.
 */
export async function addConsent(page) {
  await page.addInitScript((consent) => {
    localStorage.setItem("cookie_consent", consent);
  }, CONSENT);
}

/**
 * Set up a mocked auth session + all ambient API routes that the app fires
 * on startup. Uses addInitScript so localStorage is populated before React
 * initialises on every subsequent navigation in the test.
 *
 * @param {import('@playwright/test').Page} page
 * @param {string} role  - "ADMIN" | "LEAD" | "CONTRIBUTOR" | "REVIEWER" | "AUDITOR" | "SUPERADMIN"
 * @param {object} opts
 * @param {boolean} [opts.onboardingCompleted=true]
 * @param {boolean} [opts.isVerified=true]
 */
export async function setAuth(page, role, { onboardingCompleted = true, isVerified = true } = {}) {
  const user = { id: 1, email: `${role.toLowerCase()}@test.com`, role, onboardingCompleted };
  const company = { id: 1, name: "Test Corp", isVerified };

  // Specific mocks first — Playwright uses first-match-wins ordering.
  await page.route("**/api/prefs/version", r => r.fulfill({ json: { version: "1.0" } }));
  await page.route("**/api/settings", r => r.fulfill({
    json: { logoUrl: null, primaryColor: null, aiEnabled: true },
  }));
  await page.route("**/api/auth/me", r => r.fulfill({ json: { user, company } }));
  await page.route("**/api/notifications*", r => r.fulfill({ json: [] }));
  // Catch-all for any other API calls (modules, questions, assessments, …)
  // Use a URL predicate to avoid matching source files like /src/api/client.js
  await page.route(url => url.pathname.startsWith("/api/"), r => r.fulfill({ json: [] }));

  await page.addInitScript(({ u, c, consent }) => {
    localStorage.setItem("token", "mock-token");
    localStorage.setItem("user", JSON.stringify(u));
    localStorage.setItem("company", JSON.stringify(c));
    localStorage.setItem("cookie_consent", consent);
  }, { u: user, c: company, consent: CONSENT });
}
