import { test, expect } from "@playwright/test";
import { setAuth, addConsent } from "./helpers.js";

const FINDINGS = [
  { id: 1, testKey: "aws.network.s3_public_access_blocked", title: "S3 buckets block public access", severity: "critical", status: "open", description: "bucket-1 does not block public access", resourceId: "bucket-1", linkedActionId: null },
  { id: 2, testKey: "aws.iam.password_policy", title: "Account password policy meets minimum strength", severity: "high", status: "acknowledged", description: "Password policy too weak", resourceId: "account", linkedActionId: null },
];

test.describe("Findings inbox", () => {
  test.beforeEach(async ({ page }) => {
    await addConsent(page);
    await page.goto("/");
    await page.evaluate(() => {
      localStorage.removeItem("token");
      localStorage.removeItem("user");
      localStorage.removeItem("company");
    });
  });

  test("lists findings with severity and status", async ({ page }) => {
    await setAuth(page, "ADMIN");
    await page.route("**/api/findings*", r => r.fulfill({ json: FINDINGS }));

    await page.goto("/findings");

    await expect(page.getByText("S3 buckets block public access")).toBeVisible({ timeout: 10_000 });
    await expect(page.getByText("Account password policy meets minimum strength")).toBeVisible();
  });

  test("acknowledging a finding calls PUT with the new status", async ({ page }) => {
    await setAuth(page, "ADMIN");
    await page.route("**/api/findings*", r => {
      if (r.request().method() === "PUT") return r.fulfill({ json: { ...FINDINGS[0], status: "acknowledged" } });
      return r.fulfill({ json: FINDINGS });
    });

    await page.goto("/findings");
    await expect(page.getByText("S3 buckets block public access")).toBeVisible({ timeout: 10_000 });

    const [putReq] = await Promise.all([
      page.waitForRequest(req => req.url().includes("/api/findings/1") && req.method() === "PUT"),
      page.getByRole("button", { name: "Acknowledge" }).first().click(),
    ]);
    expect(putReq.postDataJSON().status).toBe("acknowledged");
  });

  test("promoting a finding calls POST /promote", async ({ page }) => {
    await setAuth(page, "ADMIN");
    await page.route("**/api/findings", r => r.fulfill({ json: FINDINGS }));
    await page.route("**/api/findings/1/promote", r => r.fulfill({ status: 201, json: { id: 99, findingId: 1 } }));

    await page.goto("/findings");
    await expect(page.getByText("S3 buckets block public access")).toBeVisible({ timeout: 10_000 });

    const [promoteReq] = await Promise.all([
      page.waitForRequest(req => req.url().includes("/api/findings/1/promote")),
      page.getByRole("button", { name: "Create Remediation Action" }).first().click(),
    ]);
    expect(promoteReq.method()).toBe("POST");

    // Clicking "Create Remediation Action" has no other visible effect (the
    // button itself only disappears once linkedActionId comes back set) —
    // this confirmation is the only feedback the user gets that it worked.
    await expect(page.getByText("Remediation action created.")).toBeVisible({ timeout: 5_000 });
  });
});
