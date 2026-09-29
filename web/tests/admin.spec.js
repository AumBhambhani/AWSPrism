import { test, expect } from "@playwright/test";
import { setAuth, addConsent } from "./helpers.js";

const EXISTING_USER = {
  id: 2,
  email: "contrib@test.com",
  role: "CONTRIBUTOR",
  full_name: "Test Contrib",
};

// invitation.token is used by AdminPanel to build the invite link URL
const INVITE_RESP = {
  invitation: { id: 10, email: "new@test.com", role: "LEAD", token: "abc123token" },
};

const COMPANY_ROW = {
  id: 2,
  name: "Acme Corp",
  domain: "acme",
  adminEmail: "admin@acme.com",
  status: "pending",
  isVerified: false,
  aiEnabled: true,
  plan: "starter",
  billingStatus: "trial",
};

test.describe("Admin workflows", () => {
  test.beforeEach(async ({ page }) => {
    await addConsent(page);
    await page.goto("/");
    await page.evaluate(() => {
      localStorage.removeItem("token");
      localStorage.removeItem("user");
      localStorage.removeItem("company");
    });
  });

  test("Invite member → invite link displayed", async ({ page }) => {
    await setAuth(page, "ADMIN");
    // Override catch-all for /api/users routes after setAuth (LIFO priority)
    await page.route("**/api/users/invite", r => {
      if (r.request().method() === "POST") {
        r.fulfill({ json: INVITE_RESP });
      } else {
        r.fulfill({ json: [] });
      }
    });
    await page.route("**/api/users/invitations", r => r.fulfill({ json: [] }));
    await page.route("**/api/users", r => r.fulfill({ json: [] }));

    await page.goto("/admin");

    // AdminPanel makes 6 parallel API calls before showing content
    await expect(page.locator("p:has-text('Loading admin data')")).not.toBeVisible({ timeout: 15_000 });

    // Default section is "invite" — form is already visible
    await expect(page.locator("#inviteEmail")).toBeVisible({ timeout: 5_000 });
    await page.fill("#inviteEmail", "new@test.com");
    await page.selectOption("#inviteRole", "LEAD");
    await page.click("button.btn-primary:has-text('Create invite')");

    // Invite link input should appear after success
    await expect(page.locator(".invite-link input[type=text]")).toBeVisible({ timeout: 5_000 });
    const linkValue = await page.locator(".invite-link input[type=text]").inputValue();
    expect(linkValue).toContain("accept-invite");
  });

  test("Assign role to team member", async ({ page }) => {
    await setAuth(page, "ADMIN");
    await page.route("**/api/users/invitations", r => r.fulfill({ json: [] }));
    await page.route("**/api/users", r => r.fulfill({ json: [EXISTING_USER] }));
    await page.route("**/api/users/2", r =>
      r.fulfill({ json: { ...EXISTING_USER, role: "LEAD" } })
    );

    await page.goto("/admin");

    // AdminPanel makes 6 parallel API calls before showing content
    await expect(page.locator("p:has-text('Loading admin data')")).not.toBeVisible({ timeout: 15_000 });

    // Switch to Team section
    await page.getByRole("button", { name: "Team" }).click();

    // Find role select in contrib@test.com row and change it
    const userRow = page.locator(".admin-row", { has: page.getByText("contrib@test.com") });
    await expect(userRow).toBeVisible({ timeout: 5_000 });
    await userRow.locator("select").selectOption("LEAD");

    // After PUT /api/users/2, component re-renders with updated role
    await expect(userRow.locator("select")).toHaveValue("LEAD", { timeout: 5_000 });
  });

  test("SuperAdmin approves pending company", async ({ page }) => {
    await setAuth(page, "SUPERADMIN");
    await page.route("**/api/superadmin/companies", r => r.fulfill({ json: [COMPANY_ROW] }));
    await page.route("**/api/superadmin/companies/2/status", r => r.fulfill({ json: { ...COMPANY_ROW, status: "approved", isVerified: true } }));

    await page.goto("/superadmin");

    // SuperAdminDashboard fetches companies before rendering the table
    await expect(page.locator("p:has-text('Loading companies')")).not.toBeVisible({ timeout: 15_000 });
    await expect(page.getByText("Acme Corp")).toBeVisible({ timeout: 5_000 });

    // Status change is optimistic — UI updates immediately on click
    const companyRow = page.locator("[style*='cursor']", { has: page.getByText("Acme Corp") });
    await page.getByRole("button", { name: "Approve", exact: true }).first().click();

    // After optimistic update, Approve button disappears (only shown when status !== "approved").
    // "Approve" is `exact: true` here too — otherwise it substring-matches "Unapprove", which
    // appears once the company becomes verified.
    await expect(page.getByRole("button", { name: "Approve", exact: true })).not.toBeVisible({ timeout: 5_000 });
  });
});
