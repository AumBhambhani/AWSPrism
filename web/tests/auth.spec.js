import { test, expect } from "@playwright/test";
import { CONSENT, setAuth, addConsent } from "./helpers.js";

const REG_RESPONSE = {
  token: "mock-token",
  user: { id: 1, email: "admin@acme.com", role: "ADMIN", onboardingCompleted: false },
  company: { id: 1, name: "Acme Corp", isVerified: false },
};

test.describe("Auth workflows", () => {
  test.beforeEach(async ({ page }) => {
    await addConsent(page);
    await page.goto("/");
    await page.evaluate(() => {
      localStorage.removeItem("token");
      localStorage.removeItem("user");
      localStorage.removeItem("company");
    });
  });

  test("Register new company → redirected to /self-assess when unverified", async ({ page }) => {
    // Catch-all must be registered FIRST (Playwright LIFO: last registered = highest priority)
    await page.route(url => url.pathname.startsWith("/api/"), r => r.fulfill({ json: [] }));
    await page.route("**/api/auth/register", r => r.fulfill({ status: 201, json: REG_RESPONSE }));

    await page.goto("/register");
    await page.fill("#companyName", "Acme Corp");
    await page.selectOption("#industry", "Technology");
    await page.selectOption("#companySize", "1–10 employees");
    await page.fill("#fullName", "John Smith");
    await page.fill("#adminEmail", "admin@acme.com");
    await page.fill("#department", "Engineering");
    await page.fill("#jobTitle", "CISO");
    await page.fill("#password", "Test@1234!");
    await page.fill("#confirmPassword", "Test@1234!");
    await page.click("button[type=submit]");

    await expect(page).toHaveURL(/\/self-assess/, { timeout: 10_000 });
    await expect(page.getByText("Pending Verification")).toBeVisible();
  });

  test("Self-assessment: welcome → departments → questions → results", async ({ page }) => {
    await setAuth(page, "ADMIN", { isVerified: false });
    await page.goto("/self-assess");

    // Step 1: welcome screen
    await expect(page.getByRole("heading", { name: "Compliance Self-Assessment" })).toBeVisible({ timeout: 10_000 });
    await page.getByRole("button", { name: /Start Assessment/ }).click();

    // Step 2: department selection — click "IT & Security"
    await expect(page.getByText("Select Departments")).toBeVisible({ timeout: 10_000 });
    await page.getByRole("button", { name: /IT & Security/ }).click();
    await page.getByRole("button", { name: /Start Questions/ }).click();

    // Step 3: questions — answer the first question with "Yes"
    await expect(page.getByRole("button", { name: "Yes" }).first()).toBeVisible({ timeout: 10_000 });
    await page.getByRole("button", { name: "Yes" }).first().click();

    // Single department selected → "View Results →" button
    await page.getByRole("button", { name: /View Results/ }).click();

    // Step 4: results
    await expect(page.getByText("Your Compliance Assessment")).toBeVisible({ timeout: 10_000 });
  });

  test("Logout shows confirmation modal then clears session", async ({ page }) => {
    await setAuth(page, "ADMIN");
    await page.route("**/api/questions*", r => r.fulfill({ json: [] }));
    await page.route("**/api/assessments*", r => r.fulfill({ json: [] }));
    await page.goto("/tracker");

    // Logout lives inside the TopBar's "⋮" overflow menu.
    await page.getByRole("button", { name: "⋮" }).click();
    await expect(page.getByRole("button", { name: "Logout" })).toBeVisible({ timeout: 10_000 });
    await page.getByRole("button", { name: "Logout" }).click();

    // Confirmation modal should appear — not immediately logged out
    await expect(page.getByText("Sign out?")).toBeVisible({ timeout: 3_000 });
    await expect(page).toHaveURL(/\/tracker/);

    // Confirm sign-out in the modal
    await page.getByRole("button", { name: "Sign out" }).click();

    await expect(page).toHaveURL("/", { timeout: 10_000 });
    const token = await page.evaluate(() => localStorage.getItem("token"));
    expect(token).toBeNull();
  });

  test("Logout modal cancel keeps session active", async ({ page }) => {
    await setAuth(page, "ADMIN");
    await page.route("**/api/questions*", r => r.fulfill({ json: [] }));
    await page.route("**/api/assessments*", r => r.fulfill({ json: [] }));
    await page.goto("/tracker");

    // Logout lives inside the TopBar's "⋮" overflow menu.
    await page.getByRole("button", { name: "⋮" }).click();
    await expect(page.getByRole("button", { name: "Logout" })).toBeVisible({ timeout: 10_000 });
    await page.getByRole("button", { name: "Logout" }).click();

    await expect(page.getByText("Sign out?")).toBeVisible({ timeout: 3_000 });
    await page.getByRole("button", { name: "Cancel" }).click();

    // Modal dismissed — still on tracker, token still present
    await expect(page.getByText("Sign out?")).not.toBeVisible();
    await expect(page).toHaveURL(/\/tracker/);
    const token = await page.evaluate(() => localStorage.getItem("token"));
    expect(token).toBe("mock-token");
  });
});
