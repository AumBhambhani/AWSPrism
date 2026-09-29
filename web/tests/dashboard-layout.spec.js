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
    { moduleId: "T", name: "Technology", total: 15, assessed: 10, finished: 5 },
  ],
  evidenceCoverage: [{ moduleId: "P", covered: 6, total: 10 }],
  actionStatus: [{ status: "OPEN", count: 3 }],
  maturityDistribution: { l1: 5, l2: 3, l3: 2, l4: 0, l5: 0 },
  overdueQuestions: 2,
  notesMetrics: { withNotes: 5, withReviewerNotes: 2, withoutAnyNotes: 8 },
  requestMetrics: { open: 1, overdue: 0, completed: 2, byUser: [] },
  vaultMetrics: { totalVersions: 5, updatedThisMonth: 2, latestModifiedTitle: "Policy v1", latestModifiedAt: "2025-01-01T00:00:00Z" },
  scoreEligible: { count: 8, total: 15 },
  automatedCoverage: { count: 3, total: 7 },
  recentlyReviewed: [],
  rejectedControls: [],
};

async function gotoDashboard(page) {
  await addConsent(page);
  await setAuth(page, "ADMIN");
  await page.route("**/api/dashboard*", (r) => r.fulfill({ json: MOCK_DASHBOARD }));
  await page.setViewportSize({ width: 1400, height: 900 });
  await page.goto("/dashboard");
  await expect(page.locator(".dash-canvas .dash-widget").first()).toBeVisible({ timeout: 10_000 });
  // let the ResizeObserver settle initial heights
  await page.waitForTimeout(400);
}

/** Read a widget's translate() offsets and pixel size. */
async function boxOf(page, index) {
  return page.locator(".dash-canvas .dash-widget").nth(index).evaluate((el) => {
    const cs = getComputedStyle(el);
    const m = new DOMMatrixReadOnly(cs.transform);
    return { x: m.m41, y: m.m42, w: el.offsetWidth, h: el.offsetHeight };
  });
}

async function pointerDrag(page, handle, dx, dy) {
  const b = await handle.boundingBox();
  const sx = b.x + b.width / 2;
  const sy = b.y + b.height / 2;
  await page.mouse.move(sx, sy);
  await page.mouse.down();
  // several incremental moves so pointermove handlers fire like a real drag
  for (let i = 1; i <= 6; i++) {
    await page.mouse.move(sx + (dx * i) / 6, sy + (dy * i) / 6);
    await page.waitForTimeout(20);
  }
  await page.mouse.up();
  await page.waitForTimeout(300);
}

test.describe("Dashboard header", () => {
  test("filters are collapsed into a single popover with an active-count badge", async ({ page }) => {
    await addConsent(page);
    await setAuth(page, "ADMIN");
    await page.route("**/api/dashboard*", (r) => r.fulfill({ json: MOCK_DASHBOARD }));
    await page.route("**/api/questions*", (r) =>
      r.fulfill({ json: [{ id: "q1", tags: "cloud,aws", defaultOwner: "Security" }] })
    );
    await page.setViewportSize({ width: 1400, height: 900 });
    await page.goto("/dashboard");
    await expect(page.locator(".dash-canvas .dash-widget").first()).toBeVisible({ timeout: 10_000 });

    // Only the month selector remains inline — the four filter <select>s are gone from the bar.
    await expect(page.locator(".dash-header-actions > .month-selector")).toHaveCount(1);

    const filtersBtn = page.getByRole("button", { name: /^⚑ Filters/ });
    await expect(filtersBtn).toHaveText("⚑ Filters");

    await filtersBtn.click();
    await expect(page.locator(".dash-filter-field")).toHaveCount(4); // status, priority, owner, tag

    await page.locator(".dash-filter-field", { hasText: "Priority" }).locator("select").selectOption("High");
    await expect(filtersBtn).toHaveText("⚑ Filters · 1");

    await page.getByRole("button", { name: "Clear all filters" }).click();
    await expect(filtersBtn).toHaveText("⚑ Filters");
  });
});

test.describe("Dashboard customize / drag / resize", () => {
  test("enters edit mode and shows drag + resize affordances", async ({ page }) => {
    await gotoDashboard(page);

    await expect(page.locator(".dash-canvas-edit")).toHaveCount(0);
    await page.getByRole("button", { name: /Customize/ }).click();

    await expect(page.locator(".dash-canvas-edit")).toBeVisible();
    await expect(page.locator(".dash-grip").first()).toBeVisible();
    expect(await page.locator(".dash-rz-se").count()).toBeGreaterThanOrEqual(10);
    expect(await page.locator(".dash-grip").count()).toBe(await page.locator(".dash-canvas .dash-widget").count());
    await expect(page.getByRole("button", { name: /Done/ })).toBeVisible();
  });

  test("dragging a widget by its grip moves it and persists", async ({ page }) => {
    await gotoDashboard(page);
    await page.getByRole("button", { name: /Customize/ }).click();

    const before = await boxOf(page, 0);
    await pointerDrag(page, page.locator(".dash-widget").nth(0).locator(".dash-grip"), 320, 260);
    const after = await boxOf(page, 0);

    expect(Math.abs(after.x - before.x) + Math.abs(after.y - before.y)).toBeGreaterThan(40);

    const saved = await page.evaluate(() => JSON.parse(localStorage.getItem("prism-widget-layout") || "{}"));
    expect(Object.keys(saved).length).toBeGreaterThan(0);
    expect(saved["maturity-dist"]).toMatchObject({ x: expect.any(Number), y: expect.any(Number), w: expect.any(Number), h: expect.any(Number) });
  });

  test("horizontal resize changes width; vertical resize changes height", async ({ page }) => {
    await gotoDashboard(page);
    await page.getByRole("button", { name: /Customize/ }).click();

    const w0 = await boxOf(page, 0);

    // widen via the east edge handle
    await pointerDrag(page, page.locator(".dash-widget").nth(0).locator(".dash-rz-e"), 220, 0);
    const w1 = await boxOf(page, 0);
    expect(w1.w).toBeGreaterThan(w0.w + 30);
    expect(Math.abs(w1.h - w0.h)).toBeLessThan(24); // height essentially unchanged

    // grow via the south edge handle
    await pointerDrag(page, page.locator(".dash-widget").nth(0).locator(".dash-rz-s"), 0, 180);
    const w2 = await boxOf(page, 0);
    expect(w2.h).toBeGreaterThan(w1.h + 30);
    expect(Math.abs(w2.w - w1.w)).toBeLessThan(24); // width essentially unchanged

    const saved = await page.evaluate(() => JSON.parse(localStorage.getItem("prism-widget-layout") || "{}"));
    expect(saved["maturity-dist"].w).toBeGreaterThanOrEqual(2);
    expect(saved["maturity-dist"].h).toBeGreaterThan(6);
  });

  test("layout survives a reload and Reset Layout clears it", async ({ page }) => {
    await gotoDashboard(page);
    await page.getByRole("button", { name: /Customize/ }).click();
    await pointerDrag(page, page.locator(".dash-widget").nth(0).locator(".dash-rz-se"), 160, 140);

    const saved1 = await page.evaluate(() => localStorage.getItem("prism-widget-layout"));
    expect(saved1).toBeTruthy();

    await page.reload();
    await expect(page.locator(".dash-canvas .dash-widget").first()).toBeVisible({ timeout: 10_000 });
    const saved2 = await page.evaluate(() => localStorage.getItem("prism-widget-layout"));
    expect(saved2).toBe(saved1);

    // Reset via the ⋮ overflow menu
    await page.locator("button[title='More']").click();
    await page.getByRole("button", { name: /Reset Layout/ }).click();
    const saved3 = await page.evaluate(() => localStorage.getItem("prism-widget-layout"));
    expect(saved3).toBeNull();
  });

  test("no drag/resize handles outside edit mode; content stays interactive", async ({ page }) => {
    await gotoDashboard(page);
    await expect(page.locator(".dash-grip")).toHaveCount(0);
    await expect(page.locator(".dash-rz-se")).toHaveCount(0);
  });

  test("no widget has an internal scrollbar", async ({ page }) => {
    await gotoDashboard(page);
    const over = await page.$$eval(".dash-canvas .dash-widget .dash-card-scroll", (els) =>
      els.map((el) => el.scrollHeight - el.clientHeight)
    );
    expect(Math.max(...over)).toBeLessThanOrEqual(3);
  });

  test("resizing smaller never clips content (no scroll, honours content floor)", async ({ page }) => {
    await gotoDashboard(page);
    await page.getByRole("button", { name: /Customize/ }).click();
    await page.waitForTimeout(150);
    const w = page.locator(".dash-widget").nth(1);
    const contentH = await w.evaluate((el) => el.querySelector(".dash-card-measure").offsetHeight);
    // drag the SE handle up-and-left hard
    await pointerDrag(page, w.locator(".dash-rz-se"), -140, -260);
    const after = await w.evaluate((el) => el.offsetHeight);
    expect(after).toBeGreaterThanOrEqual(contentH - 4);
    const overNow = await w.locator(".dash-card-scroll").evaluate((el) => el.scrollHeight - el.clientHeight);
    expect(overNow).toBeLessThanOrEqual(3);
  });
});
