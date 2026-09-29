/**
 * Tests for features added in the most recent session:
 *  - Accept-invite invitation info card
 *  - QuestionCard rejection reason banner
 *  - TopBar "Save Changes" vs "Submit for review" label
 *  - Dashboard filter active indicator
 *  - Self-assessment save progress button
 *  - Self-assessment browser back-button interception
 */
import { test, expect } from "@playwright/test";
import { setAuth, addConsent } from "./helpers.js";

// ─── Shared fixtures ───────────────────────────────────────────────────────────

const CURRENT_MONTH = `${new Date().getFullYear()}-${String(new Date().getMonth() + 1).padStart(2, "0")}`;

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

const MOCK_DASHBOARD = {
  overall: { total: 25, assessed: 18, finished: 10 },
  answerDistribution: [{ answer: "IMPLEMENTED", count: 10 }],
  moduleCompletion: [{ moduleId: "P", name: "Policies", total: 10, assessed: 8, finished: 5 }],
  evidenceCoverage: [],
  actionStatus: [],
  maturityDistribution: { l1: 2, l2: 3, l3: 5, l4: 0, l5: 0 },
  overdueQuestions: 0,
  notesMetrics: { withNotes: 5, withReviewerNotes: 2, withoutAnyNotes: 8 },
  requestMetrics: { open: 1, overdue: 0, completed: 2, byUser: [] },
  vaultMetrics: { totalVersions: 5, updatedThisMonth: 2, latestModifiedTitle: "Policy v1", latestModifiedAt: "2025-01-01T00:00:00Z" },
  scoreEligible: { count: 8, total: 15 },
};

// ─── Accept-invite info card ───────────────────────────────────────────────────

test.describe("Accept invite — invitation info card", () => {
  test("shows invitor, invitee email, role, and company when invitation is valid", async ({ page }) => {
    await addConsent(page);

    // Catch-all first (Playwright LIFO: last registered = highest priority)
    await page.route(url => url.pathname.startsWith("/api/"), r => r.fulfill({ json: [] }));
    await page.route("**/api/auth/invitation/valid-token", r => r.fulfill({
      json: {
        inviteeEmail: "newuser@acme.com",
        role: "LEAD",
        companyName: "Acme Corp",
        invitorEmail: "admin@acme.com",
        invitorName: "Alice Admin",
      },
    }));

    await page.goto("/accept-invite/valid-token");

    await expect(page.getByText("Acme Corp")).toBeVisible({ timeout: 10_000 });
    await expect(page.getByText("newuser@acme.com")).toBeVisible();
    await expect(page.getByText("Lead")).toBeVisible();
    await expect(page.getByText(/Alice Admin/)).toBeVisible();
    await expect(page.getByText("admin@acme.com")).toBeVisible();
  });

  test("form is still usable when invitation metadata fetch fails", async ({ page }) => {
    await addConsent(page);

    // Catch-all first (Playwright LIFO: last registered = highest priority)
    await page.route(url => url.pathname.startsWith("/api/"), r => r.fulfill({ json: [] }));
    await page.route("**/api/auth/invitation/**", r =>
      r.fulfill({ status: 404, json: { error: "Invitation not found" } })
    );

    await page.goto("/accept-invite/bad-token");

    // Error message shown but the password form is still rendered
    await expect(page.locator("h1", { hasText: "Accept Invitation" })).toBeVisible({ timeout: 10_000 });
    await expect(page.locator("#password")).toBeVisible();
  });
});

// ─── QuestionCard rejection banner ────────────────────────────────────────────

test.describe("QuestionCard — rejection reason banner", () => {
  test("rejection banner is visible when assessment has auditor notes and is WIP", async ({ page }) => {
    await setAuth(page, "CONTRIBUTOR");

    const REJECTED_ASSESSMENT = {
      id: 1,
      questId: "P1.1",
      month: CURRENT_MONTH,
      answer: "IMPLEMENTED",
      reviewStatus: "WIP",
      currentLevel: 3,
      auditorNotes: "Evidence is outdated, please resubmit with a 2024 document.",
      auditedBy: "auditor@acme.com",
      auditedAt: "2025-06-01T10:00:00Z",
    };

    await page.route("**/api/questions*", r => r.fulfill({ json: [MOCK_QUESTION] }));
    await page.route("**/api/assessments*", r => r.fulfill({ json: [REJECTED_ASSESSMENT] }));
    await page.route("**/api/modules*", r => r.fulfill({ json: [] }));

    await page.goto("/tracker");
    await expect(page.locator(".quest-card")).toBeVisible({ timeout: 10_000 });

    // The rejection banner should be visible
    await expect(page.getByText(/Rejected by auditor@acme.com/)).toBeVisible({ timeout: 5_000 });
    await expect(page.getByText(/Evidence is outdated/)).toBeVisible();
    await expect(page.getByText(/auditor@acme.com/)).toBeVisible();
  });

  test("no rejection banner when assessment is approved (FINISHED)", async ({ page }) => {
    await setAuth(page, "CONTRIBUTOR");

    const APPROVED_ASSESSMENT = {
      id: 2,
      questId: "P1.1",
      answer: "IMPLEMENTED",
      reviewStatus: "FINISHED",
      currentLevel: 3,
      auditorNotes: "All good.",
      auditedBy: "auditor@acme.com",
    };

    await page.route("**/api/questions*", r => r.fulfill({ json: [MOCK_QUESTION] }));
    await page.route("**/api/assessments*", r => r.fulfill({ json: [APPROVED_ASSESSMENT] }));
    await page.route("**/api/modules*", r => r.fulfill({ json: [] }));

    await page.goto("/tracker");
    await expect(page.locator(".quest-card")).toBeVisible({ timeout: 10_000 });

    await expect(page.getByText(/Rejected by/)).not.toBeVisible();
  });
});

// ─── TopBar: Save Changes vs Submit for review ─────────────────────────────────

test.describe("TopBar — primary action label", () => {
  test("shows 'Submit for review' when no answer is selected", async ({ page }) => {
    await setAuth(page, "ADMIN");
    await page.route("**/api/questions*", r => r.fulfill({ json: [MOCK_QUESTION] }));
    await page.route("**/api/assessments*", r => r.fulfill({ json: [] }));
    await page.route("**/api/modules*", r => r.fulfill({ json: [] }));

    await page.goto("/tracker");
    await expect(page.locator(".quest-card")).toBeVisible({ timeout: 10_000 });

    await expect(page.getByRole("button", { name: "Submit for review" })).toBeVisible();
  });

  test("shows 'Submit for review' when IMPLEMENTED is selected", async ({ page }) => {
    await setAuth(page, "ADMIN");
    await page.route("**/api/questions*", r => r.fulfill({ json: [MOCK_QUESTION] }));
    await page.route("**/api/assessments*", r => r.fulfill({ json: [] }));
    await page.route("**/api/modules*", r => r.fulfill({ json: [] }));

    await page.goto("/tracker");
    await expect(page.locator(".quest-card")).toBeVisible({ timeout: 10_000 });

    await page.getByRole("button", { name: "Implemented", exact: true }).click();
    await expect(page.getByRole("button", { name: "Submit for review" })).toBeVisible();
    await expect(page.getByRole("button", { name: "Save Changes" })).not.toBeVisible();
  });

  test("shows 'Save Changes' when NOT_IMPLEMENTED is selected", async ({ page }) => {
    await setAuth(page, "ADMIN");
    await page.route("**/api/questions*", r => r.fulfill({ json: [MOCK_QUESTION] }));
    await page.route("**/api/assessments*", r => r.fulfill({ json: [] }));
    await page.route("**/api/modules*", r => r.fulfill({ json: [] }));

    await page.goto("/tracker");
    await expect(page.locator(".quest-card")).toBeVisible({ timeout: 10_000 });

    await page.locator(".answer-btn", { hasText: "Not Implemented" }).click();
    await expect(page.getByRole("button", { name: "Save Changes" })).toBeVisible();
    await expect(page.getByRole("button", { name: "Submit for review" })).not.toBeVisible();
  });

  test("shows 'Save Changes' when PLANNED is selected", async ({ page }) => {
    await setAuth(page, "ADMIN");
    await page.route("**/api/questions*", r => r.fulfill({ json: [MOCK_QUESTION] }));
    await page.route("**/api/assessments*", r => r.fulfill({ json: [] }));
    await page.route("**/api/modules*", r => r.fulfill({ json: [] }));

    await page.goto("/tracker");
    await expect(page.locator(".quest-card")).toBeVisible({ timeout: 10_000 });

    await page.locator(".answer-btn", { hasText: "Planned" }).click();
    await expect(page.getByRole("button", { name: "Save Changes" })).toBeVisible();
  });

  test("label switches back to 'Submit for review' when answer changes to IMPLEMENTED", async ({ page }) => {
    await setAuth(page, "ADMIN");
    await page.route("**/api/questions*", r => r.fulfill({ json: [MOCK_QUESTION] }));
    await page.route("**/api/assessments*", r => r.fulfill({ json: [] }));
    await page.route("**/api/modules*", r => r.fulfill({ json: [] }));

    await page.goto("/tracker");
    await expect(page.locator(".quest-card")).toBeVisible({ timeout: 10_000 });

    await page.locator(".answer-btn", { hasText: "Not Implemented" }).click();
    await expect(page.getByRole("button", { name: "Save Changes" })).toBeVisible();

    await page.getByRole("button", { name: "Implemented", exact: true }).click();
    await expect(page.getByRole("button", { name: "Submit for review" })).toBeVisible();
    await expect(page.getByRole("button", { name: "Save Changes" })).not.toBeVisible();
  });
});

// ─── Dashboard — filter active indicator ──────────────────────────────────────

test.describe("Dashboard — compliance filter indicator", () => {
  // Dashboard derives its "framework"/tag filter options from GET /api/questions
  // (comma-separated `tags` field), not from the dashboard payload itself. The
  // tag <select> only renders at all once availableTags is non-empty, and sits
  // after Month/Status/Priority (and Owner, if any owners exist) in the DOM —
  // with no owners in these questions, it's the 4th .month-selector (index 3).
  const TAGGED_QUESTIONS = [
    { id: "P1.1", questId: "P1.1", moduleId: "P", area: "Policies", text: "Q1", priority: "High", tags: "ISO27001,GDPR", isOverdue: false },
  ];

  test("filter banner appears when a tag filter is picked in the Filters popover", async ({ page }) => {
    await setAuth(page, "ADMIN");
    await page.route("**/api/dashboard*", r => r.fulfill({ json: MOCK_DASHBOARD }));
    await page.route("**/api/questions*", r => r.fulfill({ json: TAGGED_QUESTIONS }));

    await page.goto("/dashboard");
    await expect(page.locator(".dash-card").first()).toBeVisible({ timeout: 10_000 });

    await page.getByRole("button", { name: /^⚑ Filters/ }).click();
    const [request] = await Promise.all([
      page.waitForRequest(req => req.url().includes("tag=ISO27001")),
      page.locator(".dash-filter-field", { hasText: "Tag" }).locator("select").selectOption("ISO27001"),
    ]);

    // Filter banner should appear. Scope to the banner's <strong> tag —
    // a bare text match also hits the still-in-DOM <option value="ISO27001">.
    await expect(page.getByText("Filtered:")).toBeVisible({ timeout: 5_000 });
    await expect(page.locator("strong", { hasText: "ISO27001" })).toBeVisible();
    expect(request.url()).toContain("tag=ISO27001");
  });

  test("clear all filters removes the banner", async ({ page }) => {
    await setAuth(page, "ADMIN");
    await page.route("**/api/dashboard*", r => r.fulfill({ json: MOCK_DASHBOARD }));
    await page.route("**/api/questions*", r => r.fulfill({ json: TAGGED_QUESTIONS }));

    await page.goto("/dashboard");
    await expect(page.locator(".dash-card").first()).toBeVisible({ timeout: 10_000 });

    await page.getByRole("button", { name: /^⚑ Filters/ }).click();
    await page.locator(".dash-filter-field", { hasText: "Tag" }).locator("select").selectOption("GDPR");
    await expect(page.getByText("Filtered:")).toBeVisible({ timeout: 5_000 });

    await page.getByRole("button", { name: "Clear all filters" }).click();
    await expect(page.getByText("Filtered:")).not.toBeVisible({ timeout: 3_000 });
  });
});

// ─── Self-assessment — save progress & back button ────────────────────────────

test.describe("Self-assessment — save progress and back button", () => {
  test.beforeEach(async ({ page }) => {
    await addConsent(page);
  });

  test("Save Progress button appears during questions step and shows feedback", async ({ page }) => {
    await page.route(url => url.pathname.startsWith("/api/"), r => r.fulfill({ json: [] }));
    await page.addInitScript(({ consent }) => {
      localStorage.setItem("cookie_consent", consent);
      localStorage.setItem("token", "mock-token");
      localStorage.setItem("user", JSON.stringify({
        id: 1, email: "admin@acme.com", role: "ADMIN", onboardingCompleted: true,
      }));
      localStorage.setItem("company", JSON.stringify({ id: 1, name: "Acme", isVerified: false }));
    }, { consent: JSON.stringify({ action: "accepted_all", choices: { strictly_necessary: true, functional: true, analytics: true, marketing: true }, version: "1.0", timestamp: 1000000000000 }) });

    await page.goto("/self-assess");
    await expect(page.getByRole("button", { name: /Start Assessment/ })).toBeVisible({ timeout: 10_000 });
    await page.getByRole("button", { name: /Start Assessment/ }).click();

    // On dept selection step — Save Progress not shown
    await expect(page.getByText("Select Departments")).toBeVisible({ timeout: 5_000 });
    await page.getByRole("button", { name: /IT/ }).first().click();
    await page.getByRole("button", { name: /Start Questions/ }).click();

    // On questions step — Save Progress button should be visible
    await expect(page.getByRole("button", { name: "Save Progress" })).toBeVisible({ timeout: 5_000 });
    await page.getByRole("button", { name: "Save Progress" }).click();

    // Button temporarily shows "✓ Saved"
    await expect(page.getByRole("button", { name: /✓ Saved/ })).toBeVisible({ timeout: 2_000 });
  });

  test("browser back during dept selection navigates to welcome, not out of app", async ({ page }) => {
    await page.route(url => url.pathname.startsWith("/api/"), r => r.fulfill({ json: [] }));
    await page.addInitScript(({ consent }) => {
      localStorage.setItem("cookie_consent", consent);
      localStorage.setItem("token", "mock-token");
      localStorage.setItem("user", JSON.stringify({
        id: 1, email: "admin@acme.com", role: "ADMIN", onboardingCompleted: true,
      }));
      localStorage.setItem("company", JSON.stringify({ id: 1, name: "Acme", isVerified: false }));
    }, { consent: JSON.stringify({ action: "accepted_all", choices: { strictly_necessary: true, functional: true, analytics: true, marketing: true }, version: "1.0", timestamp: 1000000000000 }) });

    await page.goto("/self-assess");
    await page.getByRole("button", { name: /Start Assessment/ }).click();

    // Now on dept selection step
    await expect(page.getByText("Select Departments")).toBeVisible({ timeout: 5_000 });

    // Press browser back
    await page.goBack();

    // Should return to welcome step, NOT leave /self-assess
    await expect(page.getByRole("button", { name: /Start Assessment/ })).toBeVisible({ timeout: 5_000 });
    await expect(page).toHaveURL(/\/self-assess/);
  });
});
