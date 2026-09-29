import { test, expect } from "@playwright/test";
import { setAuth, addConsent } from "./helpers.js";

const VAULT_ITEM = {
  id: 1,
  title: "Security Policy v1",
  fileName: "policy.pdf",
  fileType: "application/pdf",
  fileSize: 12000,
  uploadedBy: "admin@test.com",
  createdAt: "2025-01-01T00:00:00Z",
  linkedCount: 0,
  locked: false,
  description: "",
};

const MOCK_REQUEST = {
  id: 1,
  title: "Upload Q3 pen test report",
  status: "Open",
  priority: "High",
  assigneeName: null,
  dueDate: "2025-12-01",
  questionId: null,
  createdAt: "2025-01-01T00:00:00Z",
  createdByName: "admin@test.com",
};

test.describe("Evidence workflows", () => {
  test.beforeEach(async ({ page }) => {
    await addConsent(page);
    await page.goto("/");
    await page.evaluate(() => {
      localStorage.removeItem("token");
      localStorage.removeItem("user");
      localStorage.removeItem("company");
    });
  });

  test("Upload file to vault → item appears in list", async ({ page }) => {
    await setAuth(page, "ADMIN");
    // Route handler differentiates GET (initial list) from POST (upload)
    await page.route("**/api/vault", async (r) => {
      if (r.request().method() === "POST") {
        await r.fulfill({ json: VAULT_ITEM });
      } else {
        await r.fulfill({ json: [] });
      }
    });

    await page.goto("/vault");
    await expect(page.getByText("Evidence Vault")).toBeVisible({ timeout: 10_000 });

    // Open upload modal
    await page.getByRole("button", { name: /Upload Evidence/ }).click();
    await expect(page.getByText("Upload to Evidence Vault")).toBeVisible({ timeout: 5_000 });

    // Fill title
    await page.locator(".module-modal input[type=text]").fill("Security Policy v1");

    // Attach a file to the hidden file input
    await page.locator(".module-modal input[type=file]").setInputFiles({
      name: "policy.pdf",
      mimeType: "application/pdf",
      buffer: Buffer.from("test-content"),
    });

    // Submit upload
    await page.getByRole("button", { name: "Upload to Vault" }).click();

    // Modal closes and item appears in vault list
    await expect(page.getByText("Upload to Evidence Vault")).not.toBeVisible({ timeout: 5_000 });
    await expect(page.getByText("Security Policy v1")).toBeVisible({ timeout: 5_000 });
  });

  test("Create evidence request → request appears in list", async ({ page }) => {
    await setAuth(page, "LEAD");
    // Route handler differentiates GET from POST for /api/requests*
    await page.route("**/api/requests*", async (r) => {
      if (r.request().method() === "POST") {
        await r.fulfill({ status: 201, json: MOCK_REQUEST });
      } else {
        await r.fulfill({ json: [] });
      }
    });

    await page.goto("/requests");
    await expect(page.getByText("Evidence Requests", { exact: true })).toBeVisible({ timeout: 10_000 });

    // Open create modal
    await page.getByRole("button", { name: /New Request/ }).click();
    await expect(page.getByText("New Evidence Request")).toBeVisible({ timeout: 5_000 });

    // Fill title in the modal
    await page.locator(".module-modal input[type=text]").first().fill("Upload Q3 pen test report");

    // Submit
    await page.getByRole("button", { name: "Create Request" }).click();

    // Item appears in the list (state update is immediate — no GET refetch)
    await expect(page.getByText("Upload Q3 pen test report").first()).toBeVisible({ timeout: 5_000 });
  });

  test("Automated tab filters vault items by source=automated", async ({ page }) => {
    await setAuth(page, "ADMIN");
    await page.route("**/api/vault?source=automated", r => r.fulfill({
      json: [{ id: 5, title: "aws.iam.mfa_enforced — account", description: "MFA enforced", uploadedBy: "automated", uploadedAt: "2026-08-17T00:00:00Z", linkedCount: 1, freshnessStatus: "fresh", testKey: "aws.iam.mfa_enforced" }]
    }));
    await page.route("**/api/vault", r => r.fulfill({ json: [] }));

    await page.goto("/vault");
    await expect(page.getByText("Evidence Vault")).toBeVisible({ timeout: 10_000 });

    await page.getByRole("button", { name: /Automated/ }).click();
    await expect(page.getByText("aws.iam.mfa_enforced — account")).toBeVisible({ timeout: 10_000 });
  });

  test("switching tabs while a search debounce is pending does not revert to stale results", async ({ page }) => {
    await setAuth(page, "ADMIN");
    // Correct request: search + source=automated together (fired both immediately on tab
    // switch, and again — redundantly but correctly — when the debounce timer elapses).
    await page.route("**/api/vault?search=policy&source=automated", r => r.fulfill({
      json: [{ id: 9, title: "Automated Match", uploadedBy: "automated", uploadedAt: "2026-08-17T00:00:00Z", linkedCount: 0, freshnessStatus: "fresh" }]
    }));
    // Stale request shape: search only, no source — this is what a leftover debounce timer
    // from *before* the tab switch would fire if it weren't cleared when `source` changes.
    await page.route("**/api/vault?search=policy", r => r.fulfill({
      json: [{ id: 10, title: "Stale All Match", uploadedBy: "admin@test.com", uploadedAt: "2026-08-17T00:00:00Z", linkedCount: 0 }]
    }));
    await page.route("**/api/vault", r => r.fulfill({ json: [] }));

    await page.goto("/vault");
    await expect(page.getByText("Evidence Vault")).toBeVisible({ timeout: 10_000 });

    // Type into search, then immediately switch tabs — before the 350ms debounce elapses.
    await page.getByPlaceholder("Search by title or description…").fill("policy");
    await page.getByRole("button", { name: /Automated/ }).click();

    // Wait past the debounce window, then assert the automated result won and the stale
    // all-evidence result never overwrote it.
    await expect(page.getByText("Automated Match")).toBeVisible({ timeout: 10_000 });
    await page.waitForTimeout(500);
    await expect(page.getByText("Automated Match")).toBeVisible();
    await expect(page.getByText("Stale All Match")).not.toBeVisible();
  });

  test("scrolling follows the hovered vault region when the info panel is open", async ({ page }) => {
    await setAuth(page, "ADMIN");

    const vaultItems = Array.from({ length: 18 }, (_, index) => ({
      ...VAULT_ITEM,
      id: index + 1,
      title: `Vault document ${index + 1}`,
    }));
    const linkedQuestions = Array.from({ length: 30 }, (_, index) => ({
      questId: `CTRL-${index + 1}`,
      controlArea: "Access control",
      recurrenceInterval: "monthly",
      isReviewed: false,
    }));

    await page.route("**/api/vault/1", r => r.fulfill({
      json: { ...vaultItems[0], linkedQuestions },
    }));
    await page.route("**/api/vault", r => r.fulfill({ json: vaultItems }));

    await page.goto("/vault");
    await page.getByText("Vault document 1", { exact: true }).click();

    const panel = page.locator(".vault-detail-panel");
    await expect(panel).toBeVisible();
    await expect.poll(() => panel.evaluate(el => ({
      overflowY: getComputedStyle(el).overflowY,
      hasOverflow: el.scrollHeight > el.clientHeight,
    }))).toEqual({ overflowY: "auto", hasOverflow: true });

    await panel.hover();
    const pageScrollBeforePanelWheel = await page.evaluate(() => window.scrollY);
    await page.mouse.wheel(0, 500);
    await expect.poll(() => panel.evaluate(el => el.scrollTop)).toBeGreaterThan(0);
    expect(await page.evaluate(() => window.scrollY)).toBe(pageScrollBeforePanelWheel);

    await panel.evaluate(el => { el.scrollTop = 0; });
    await page.evaluate(() => window.scrollTo(0, 0));
    await page.getByText("Vault document 1", { exact: true }).first().hover();
    const pageScrollBeforeDocumentWheel = await page.evaluate(() => window.scrollY);
    await page.mouse.wheel(0, 500);
    await expect.poll(() => page.evaluate(() => window.scrollY)).toBeGreaterThan(pageScrollBeforeDocumentWheel);
    expect(await panel.evaluate(el => el.scrollTop)).toBe(0);
  });
});
