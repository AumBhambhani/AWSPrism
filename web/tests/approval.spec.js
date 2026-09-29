import { test, expect } from "@playwright/test";
import { setAuth, addConsent } from "./helpers.js";

const SUBMITTED = {
  id: 5,
  questId: "P1.1",
  answer: "IMPLEMENTED",
  reviewStatus: "Submitted",
  month: "2025-01",
  currentLevel: 3,
  submittedBy: "contrib@test.com",
  comments: "Looks good",
};

const QUESTION_FOR_REVIEW = {
  questId: "P1.1",
  moduleId: "P",
  moduleName: "Policies",
  controlArea: "Information Security Policy",
  baselineQuestion: "Do you have a written information security policy?",
  priority: "High",
};

test.describe("Approval workflows", () => {
  test.beforeEach(async ({ page }) => {
    await addConsent(page);
    await page.goto("/");
    await page.evaluate(() => {
      localStorage.removeItem("token");
      localStorage.removeItem("user");
      localStorage.removeItem("company");
    });
  });

  test("Review page loads submitted assessments for LEAD", async ({ page }) => {
    await setAuth(page, "LEAD");
    await page.route("**/api/questions*", r => r.fulfill({ json: [QUESTION_FOR_REVIEW] }));
    await page.route("**/api/assessments*", async (r) => {
      if (r.request().method() === "PUT") {
        await r.fulfill({ json: { ...SUBMITTED, reviewStatus: "FINISHED" } });
      } else {
        await r.fulfill({ json: [SUBMITTED] });
      }
    });
    await page.route("**/api/evidence*", r => r.fulfill({ json: [] }));

    await page.goto("/review");

    await expect(page.locator(".review-title")).toHaveText("Review workspace", { timeout: 15_000 });
    await expect(page.getByText("Submitted assessments (1)")).toBeVisible({ timeout: 10_000 });
    await expect(page.getByRole("button", { name: "✓ Approve" })).toBeVisible({ timeout: 5_000 });
  });

  test("LEAD approves assessment → confirmation modal → assessment removed from list", async ({ page }) => {
    await setAuth(page, "LEAD");
    await page.route("**/api/questions*", r => r.fulfill({ json: [QUESTION_FOR_REVIEW] }));

    let approved = false;
    // Use URL predicate to match both /api/assessments (GET) and /api/assessments/:id (PUT)
    await page.route(url => url.pathname.startsWith("/api/assessments"), async (r) => {
      if (r.request().method() === "PUT") {
        approved = true;
        await r.fulfill({ json: { ...SUBMITTED, reviewStatus: "FINISHED", reviewedBy: "lead@test.com" } });
      } else {
        // Return submitted list until the PUT fires; empty list afterwards.
        // Using a boolean (not a counter) so React StrictMode's double effect-invoke
        // doesn't accidentally flip the state before the user clicks Approve.
        await r.fulfill({ json: approved ? [] : [SUBMITTED] });
      }
    });
    await page.route("**/api/evidence*", r => r.fulfill({ json: [] }));

    await page.goto("/review");
    await expect(page.getByRole("button", { name: "✓ Approve" })).toBeVisible({ timeout: 15_000 });

    // Click Approve → confirmation modal opens
    await page.getByRole("button", { name: "✓ Approve" }).click();
    await expect(page.getByText("Approve assessment")).toBeVisible({ timeout: 3_000 });

    // Confirm approval
    await page.getByRole("button", { name: "✓ Confirm Approval" }).click();

    // Modal closes and the list refreshes to empty
    await expect(page.getByText("Approve assessment")).not.toBeVisible({ timeout: 5_000 });
    await expect(page.getByText(/No assessments awaiting review/)).toBeVisible({ timeout: 5_000 });
  });

  test("LEAD rejects assessment → sends back for rework", async ({ page }) => {
    await setAuth(page, "LEAD");
    await page.route("**/api/questions*", r => r.fulfill({ json: [QUESTION_FOR_REVIEW] }));
    await page.route("**/api/assessments*", async (r) => {
      if (r.request().method() === "PUT") {
        await r.fulfill({ json: { ...SUBMITTED, reviewStatus: "WIP" } });
      } else {
        await r.fulfill({ json: [SUBMITTED] });
      }
    });
    await page.route("**/api/evidence*", r => r.fulfill({ json: [] }));

    await page.goto("/review");
    await expect(page.getByRole("button", { name: "✗ Reject" })).toBeVisible({ timeout: 15_000 });

    // Click Reject → confirmation modal opens
    await page.getByRole("button", { name: "✗ Reject" }).click();
    await expect(page.getByText("Reject assessment")).toBeVisible({ timeout: 3_000 });

    // Confirm rejection
    await page.getByRole("button", { name: "✗ Confirm Rejection" }).click();

    // Modal closes
    await expect(page.getByText("Reject assessment")).not.toBeVisible({ timeout: 5_000 });
  });
});
