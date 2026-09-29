import { test, expect } from "@playwright/test";
import { setAuth, addConsent } from "./helpers.js";

const MOCK_DASHBOARD = {
  overall: { total: 25, assessed: 18, finished: 10 },
  answerDistribution: [
    { answer: "IMPLEMENTED", count: 10 },
    { answer: "NOT_IMPLEMENTED", count: 5 },
  ],
  moduleCompletion: [
    { moduleId: "P", name: "Policies", total: 10, assessed: 8, finished: 5 },
  ],
  evidenceCoverage: [],
  actionStatus: [{ status: "OPEN", count: 3 }],
  maturityDistribution: { l1: 5, l2: 3, l3: 2, l4: 0, l5: 0 },
  overdueQuestions: 2,
  notesMetrics: { withNotes: 5, withReviewerNotes: 2, withoutAnyNotes: 8 },
  requestMetrics: { open: 1, overdue: 0, completed: 2, byUser: [] },
  vaultMetrics: {
    totalVersions: 5,
    updatedThisMonth: 2,
    latestModifiedTitle: "Policy v1",
    latestModifiedAt: "2025-01-01T00:00:00Z",
  },
  scoreEligible: { count: 8, total: 15 },
  automatedCoverage: { count: 3, total: 7 },
};

test.describe("Dashboard workflows", () => {
  test.beforeEach(async ({ page }) => {
    await addConsent(page);
    await page.goto("/");
    await page.evaluate(() => {
      localStorage.removeItem("token");
      localStorage.removeItem("user");
      localStorage.removeItem("company");
    });
  });

  test("Dashboard loads and shows the audit-standing hero", async ({ page }) => {
    await setAuth(page, "ADMIN");
    await page.route("**/api/dashboard*", r => r.fulfill({ json: MOCK_DASHBOARD }));

    await page.goto("/dashboard");

    // Wait for loading to finish
    await expect(page.locator("p:has-text('Loading dashboard')")).not.toBeVisible({ timeout: 10_000 });
    await expect(page.locator(".dash-standing")).toBeVisible({ timeout: 5_000 });

    // 10 of 25 signed off -> 40%
    await expect(page.locator(".dash-standing-num")).toHaveText(/40%/);
    await expect(page.locator(".dash-standing-sentence")).toContainText("18 of 25");
    await expect(page.locator(".dash-standing-sentence")).toContainText("10 signed off");
  });

  test("Month selector fires a new dashboard request with updated month param", async ({ page }) => {
    await setAuth(page, "ADMIN");
    await page.route("**/api/dashboard*", r => r.fulfill({ json: MOCK_DASHBOARD }));

    await page.goto("/dashboard");

    // Wait for initial load to complete
    await expect(page.locator(".dash-card").first()).toBeVisible({ timeout: 10_000 });

    // Select an old month and intercept the resulting API call
    const [request] = await Promise.all([
      page.waitForRequest(req => req.url().includes("/api/dashboard")),
      page.locator("select.month-selector").first().selectOption("2023-01"),
    ]);

    expect(request.url()).toContain("month=2023-01");
  });

  test("Dashboard navigation: Tracker button goes to /tracker", async ({ page }) => {
    await setAuth(page, "ADMIN");
    await page.route("**/api/dashboard*", r => r.fulfill({ json: MOCK_DASHBOARD }));
    await page.route("**/api/questions*", r => r.fulfill({ json: [] }));
    await page.route("**/api/assessments*", r => r.fulfill({ json: [] }));
    await page.route("**/api/modules*", r => r.fulfill({ json: [] }));

    await page.goto("/dashboard");

    // Wait for page to load before clicking
    await expect(page.locator(".dash-card").first()).toBeVisible({ timeout: 10_000 });
    await page.getByRole("button", { name: "Tracker" }).click();

    await expect(page).toHaveURL(/\/tracker/, { timeout: 5_000 });
  });

  test("Dashboard shows the automated coverage widget", async ({ page }) => {
    await setAuth(page, "ADMIN");
    await page.route("**/api/dashboard*", r => r.fulfill({ json: MOCK_DASHBOARD }));

    await page.goto("/dashboard");

    await expect(page.locator(".dash-card").first()).toBeVisible({ timeout: 10_000 });
    await expect(page.getByText("Automated coverage")).toBeVisible();
    await expect(page.locator(".dash-figure-val").filter({ hasText: "3" })).toBeVisible();
  });
});
