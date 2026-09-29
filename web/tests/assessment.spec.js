import { test, expect } from "@playwright/test";
import { setAuth, addConsent } from "./helpers.js";

const MOCK_QUESTION = {
  questId: "P1.1",
  moduleId: "P",
  moduleName: "Policies",
  controlArea: "Information Security Policy",
  baselineQuestion: "Do you have a written information security policy?",
  level3YesCriteria: "Policy approved by management",
  requiredEvidence: "Copy of security policy document",
  priority: "High",
  isoReference: "A.5.1",
  defaultOwner: "CISO",
  latestAnswer: null,
  dueDate: null,
  isOverdue: false,
  tags: "",
};

test.describe("Assessment / Tracker workflows", () => {
  test.beforeEach(async ({ page }) => {
    await addConsent(page);
    await page.goto("/");
    await page.evaluate(() => {
      localStorage.removeItem("token");
      localStorage.removeItem("user");
      localStorage.removeItem("company");
    });
  });

  test("Tracker page loads questions and renders a question card", async ({ page }) => {
    await setAuth(page, "ADMIN");
    await page.route("**/api/questions*", r => r.fulfill({ json: [MOCK_QUESTION] }));
    await page.route("**/api/assessments*", r => r.fulfill({ json: [] }));
    await page.route("**/api/modules*", r => r.fulfill({ json: [] }));

    await page.goto("/tracker");

    // Wait for loading to finish
    await expect(page.locator(".quest-card")).toBeVisible({ timeout: 10_000 });
    await expect(page.locator(".quest-title")).toHaveText("Information Security Policy");
  });

  test("Save draft — select answer then save draft shows success toast", async ({ page }) => {
    await setAuth(page, "ADMIN");
    await page.route("**/api/questions*", r => r.fulfill({ json: [MOCK_QUESTION] }));
    await page.route("**/api/assessments*", r => r.fulfill({ json: [] }));
    await page.route("**/api/modules*", r => r.fulfill({ json: [] }));

    await page.goto("/tracker");
    await expect(page.locator(".quest-card")).toBeVisible({ timeout: 10_000 });

    // Select "Not Implemented" answer
    await page.locator(".answer-btn", { hasText: "Not Implemented" }).click();

    // Click "Save draft" in the TopBar
    await page.getByRole("button", { name: "Save draft" }).click();

    // Toast should show success message
    await expect(page.locator(".toast.show")).toBeVisible({ timeout: 5_000 });
    await expect(page.locator(".toast.show")).toContainText("Draft saved locally");
  });

  test("Submit for review without answer shows validation toast", async ({ page }) => {
    await setAuth(page, "ADMIN");
    await page.route("**/api/questions*", r => r.fulfill({ json: [MOCK_QUESTION] }));
    await page.route("**/api/assessments*", r => r.fulfill({ json: [] }));
    await page.route("**/api/modules*", r => r.fulfill({ json: [] }));

    await page.goto("/tracker");
    await expect(page.locator(".quest-card")).toBeVisible({ timeout: 10_000 });

    // Click "Submit for review" without selecting any answer
    await page.getByRole("button", { name: "Submit for review" }).click();

    // Validation toast should appear
    await expect(page.locator(".toast.show")).toBeVisible({ timeout: 5_000 });
    await expect(page.locator(".toast.show")).toContainText("Please select an answer first");

    // Still on tracker — no redirect
    await expect(page).toHaveURL(/\/tracker/);
  });
});
