import { test, expect } from "@playwright/test";
import { setAuth, addConsent } from "./helpers.js";

const CONNECTION = {
  id: 10, integrationKey: "aws", name: "Prod AWS", status: "connected",
  lastRunAt: "2026-08-17T10:00:00Z", lastRunStatus: "success",
};

const RUNS = [
  { id: 1, status: "success", triggerType: "manual", testsRun: 7, testsPassed: 7, testsFailed: 0, startedAt: "2026-08-17T10:00:00Z", finishedAt: "2026-08-17T10:01:00Z" },
  { id: 2, status: "partial_failure", triggerType: "manual", testsRun: 7, testsPassed: 5, testsFailed: 2, startedAt: "2026-08-16T10:00:00Z", finishedAt: "2026-08-16T10:01:00Z" },
];

const CATALOG = [
  { id: 1, key: "aws", name: "Amazon Web Services", category: "cloud", authType: "iam_role", status: "active" },
];

const AZURE_CONNECTION = {
  id: 15, integrationKey: "azure", name: "Prod Azure", status: "connected",
  lastRunAt: "2026-08-18T10:00:00Z", lastRunStatus: "success",
};

const AZURE_CATALOG_ENTRY = { id: 2, key: "azure", name: "Microsoft Azure", category: "cloud", authType: "oauth2", status: "active" };

test.describe("Connection detail", () => {
  test.beforeEach(async ({ page }) => {
    await addConsent(page);
    await page.goto("/");
    await page.evaluate(() => {
      localStorage.removeItem("token");
      localStorage.removeItem("user");
      localStorage.removeItem("company");
    });
  });

  test("shows status, last run, and collection history", async ({ page }) => {
    await setAuth(page, "ADMIN");
    await page.route("**/api/integrations/catalog", r => r.fulfill({ json: CATALOG }));
    await page.route("**/api/integrations/10", r => r.fulfill({ json: CONNECTION }));
    await page.route("**/api/integrations/10/runs*", r => r.fulfill({ json: RUNS }));

    await page.goto("/settings/integrations/10");

    await expect(page.getByText("Prod AWS")).toBeVisible({ timeout: 10_000 });
    await expect(page.getByText("connected")).toBeVisible();
    await expect(page.getByText("partial_failure")).toBeVisible();
  });

  test("Run Now triggers a collection run", async ({ page }) => {
    await setAuth(page, "ADMIN");
    await page.route("**/api/integrations/catalog", r => r.fulfill({ json: CATALOG }));
    await page.route("**/api/integrations/10", r => r.fulfill({ json: CONNECTION }));
    await page.route("**/api/integrations/10/runs*", r => r.fulfill({ json: RUNS }));
    await page.route("**/api/integrations/10/run", r => r.fulfill({ json: { id: 3, status: "success", testsRun: 7, testsPassed: 7, testsFailed: 0 } }));

    await page.goto("/settings/integrations/10");
    await expect(page.getByText("Prod AWS")).toBeVisible({ timeout: 10_000 });

    const [runReq] = await Promise.all([
      page.waitForRequest(req => req.url().includes("/api/integrations/10/run") && req.method() === "POST"),
      page.getByRole("button", { name: "Run Now" }).click(),
    ]);
    expect(runReq.method()).toBe("POST");
  });

  test("Revoke prompts confirmation and calls DELETE", async ({ page }) => {
    await setAuth(page, "ADMIN");
    await page.route("**/api/integrations/catalog", r => r.fulfill({ json: CATALOG }));
    await page.route("**/api/integrations/10", r => r.fulfill({ json: CONNECTION }));
    await page.route("**/api/integrations/10/runs*", r => r.fulfill({ json: [] }));

    await page.goto("/settings/integrations/10");
    await expect(page.getByText("Prod AWS")).toBeVisible({ timeout: 10_000 });

    page.once("dialog", d => d.accept());
    const [delReq] = await Promise.all([
      page.waitForRequest(req => req.url().includes("/api/integrations/10") && req.method() === "DELETE"),
      page.getByRole("button", { name: "Revoke" }).click(),
    ]);
    expect(delReq.method()).toBe("DELETE");
  });

  test("a failed connection shows Delete instead of Revoke, with a delete-specific confirmation", async ({ page }) => {
    await setAuth(page, "ADMIN");
    await page.route("**/api/integrations/catalog", r => r.fulfill({ json: CATALOG }));
    await page.route("**/api/integrations/10", r => r.fulfill({ json: { ...CONNECTION, status: "error" } }));
    await page.route("**/api/integrations/10/runs*", r => r.fulfill({ json: [] }));

    await page.goto("/settings/integrations/10");
    await expect(page.getByText("Prod AWS")).toBeVisible({ timeout: 10_000 });

    await expect(page.getByRole("button", { name: "Revoke", exact: true })).toHaveCount(0);

    let dialogMessage = "";
    page.once("dialog", d => { dialogMessage = d.message(); d.accept(); });
    const [delReq] = await Promise.all([
      page.waitForRequest(req => req.url().includes("/api/integrations/10") && req.method() === "DELETE"),
      page.getByRole("button", { name: "Delete" }).click(),
    ]);
    expect(delReq.method()).toBe("DELETE");
    expect(dialogMessage).toContain("permanently removed");
  });

  test("shows findings scoped to this connection", async ({ page }) => {
    await setAuth(page, "ADMIN");
    await page.route("**/api/integrations/catalog", r => r.fulfill({ json: CATALOG }));
    await page.route("**/api/integrations/10", r => r.fulfill({ json: CONNECTION }));
    await page.route("**/api/integrations/10/runs*", r => r.fulfill({ json: [] }));
    await page.route("**/api/findings*", r => {
      expect(r.request().url()).toContain("connectionId=10");
      return r.fulfill({
        json: [{ id: 1, title: "S3 buckets block public access", severity: "critical", status: "open", resourceId: "bucket-1" }],
      });
    });

    await page.goto("/settings/integrations/10");
    await expect(page.getByText("Prod AWS")).toBeVisible({ timeout: 10_000 });

    await expect(page.getByText("S3 buckets block public access")).toBeVisible({ timeout: 5_000 });
    await expect(page.getByText("bucket-1")).toBeVisible();
  });

  test("Rotate modal defaults to the connection's actual auth type, not the provider's catalog default", async ({ page }) => {
    await setAuth(page, "ADMIN");
    await page.route("**/api/integrations/catalog", r => r.fulfill({ json: CATALOG }));
    await page.route("**/api/integrations/10", r => r.fulfill({ json: { ...CONNECTION, authType: "access_key" } }));
    await page.route("**/api/integrations/10/runs*", r => r.fulfill({ json: [] }));

    await page.goto("/settings/integrations/10");
    await expect(page.getByText("Prod AWS")).toBeVisible({ timeout: 10_000 });

    await page.getByRole("button", { name: "Rotate credentials" }).click();

    await expect(page.getByLabel("Access key ID")).toBeVisible();
    await expect(page.getByLabel("External ID")).toHaveCount(0);
  });

  test("Rotate credentials Access Keys toggle is reachable and submits the correct payload", async ({ page }) => {
    await setAuth(page, "ADMIN");
    await page.route("**/api/integrations/catalog", r => r.fulfill({ json: CATALOG }));
    await page.route("**/api/integrations/10", r => r.fulfill({ json: CONNECTION }));
    await page.route("**/api/integrations/10/runs*", r => r.fulfill({ json: [] }));
    await page.route("**/api/integrations/10/credentials", r =>
      r.fulfill({ json: { ...CONNECTION, status: "connected" } })
    );

    await page.goto("/settings/integrations/10");
    await expect(page.getByText("Prod AWS")).toBeVisible({ timeout: 10_000 });

    await page.getByRole("button", { name: "Rotate credentials" }).click();
    await page.getByRole("button", { name: "Access Keys" }).click();

    await page.getByLabel("Access key ID").fill("AKIAROTATED");
    await page.getByLabel("Secret access key").fill("new-secret");

    const [credReq] = await Promise.all([
      page.waitForRequest(req => req.url().includes("/api/integrations/10/credentials") && req.method() === "POST"),
      page.getByRole("button", { name: "Rotate", exact: true }).click(),
    ]);
    const body = credReq.postDataJSON();
    expect(body.authType).toBe("access_key");
    expect(body.secret.accessKeyId).toBe("AKIAROTATED");
    expect(body.secret.secretAccessKey).toBe("new-secret");
  });

  test("Rotate credentials on an Azure connection submits Client ID/Client Secret only", async ({ page }) => {
    await setAuth(page, "ADMIN");
    await page.route("**/api/integrations/catalog", r => r.fulfill({ json: [...CATALOG, AZURE_CATALOG_ENTRY] }));
    await page.route("**/api/integrations/15", r => r.fulfill({ json: AZURE_CONNECTION }));
    await page.route("**/api/integrations/15/runs*", r => r.fulfill({ json: [] }));
    await page.route("**/api/integrations/15/credentials", r =>
      r.fulfill({ json: { ...AZURE_CONNECTION, status: "connected" } })
    );

    await page.goto("/settings/integrations/15");
    await expect(page.getByText("Prod Azure")).toBeVisible({ timeout: 10_000 });

    await page.getByRole("button", { name: "Rotate credentials" }).click();

    // No AWS auth-type toggle should appear for a non-AWS provider.
    await expect(page.getByRole("button", { name: "Access Keys" })).toHaveCount(0);

    await page.getByLabel("Client ID").fill("44444444-4444-4444-4444-444444444444");
    await page.getByLabel("Client secret").fill("new-azure-secret");

    const [credReq] = await Promise.all([
      page.waitForRequest(req => req.url().includes("/api/integrations/15/credentials") && req.method() === "POST"),
      page.getByRole("button", { name: "Rotate", exact: true }).click(),
    ]);
    const body = credReq.postDataJSON();
    expect(body.authType).toBe("oauth2");
    expect(body.secret).toEqual({ clientId: "44444444-4444-4444-4444-444444444444", clientSecret: "new-azure-secret" });
  });

  test("Rotate credentials on a GitHub connection shows Reconnect via GitHub instead of a form", async ({ page }) => {
    await setAuth(page, "ADMIN");
    const GITHUB_CATALOG_ENTRY = { id: 3, key: "github", name: "GitHub", category: "devops", authType: "oauth2", status: "active" };
    const GITHUB_CONNECTION = { id: 31, integrationKey: "github", name: "Prod GitHub", status: "connected", lastRunAt: null, lastRunStatus: null };
    await page.route("**/api/integrations/catalog", r => r.fulfill({ json: [...CATALOG, GITHUB_CATALOG_ENTRY] }));
    await page.route("**/api/integrations/31", r => r.fulfill({ json: GITHUB_CONNECTION }));
    await page.route("**/api/integrations/31/runs*", r => r.fulfill({ json: [] }));
    await page.route("**/api/integrations/31/github/setup-info", r => r.fulfill({
      json: { manifest: { name: "Prism Evidence Collection - Acme Corp" }, state: "reconnect-state-xyz" },
    }));

    await page.goto("/settings/integrations/31");
    await expect(page.getByText("Prod GitHub")).toBeVisible({ timeout: 10_000 });

    await page.getByRole("button", { name: "Rotate credentials" }).click();

    // No form fields, no auth-type toggle — just the manifest-flow button.
    await expect(page.getByRole("button", { name: "Rotate", exact: true })).toHaveCount(0);
    await expect(page.getByLabel("Client ID")).toHaveCount(0);
    await expect(page.getByRole("button", { name: "Access Keys" })).toHaveCount(0);

    const reconnectButton = page.getByRole("button", { name: "Create GitHub App on GitHub" });
    await expect(reconnectButton).toBeVisible({ timeout: 10_000 });
    const form = page.locator("form", { has: reconnectButton });
    await expect(form).toHaveAttribute("action", "https://github.com/settings/apps/new?state=reconnect-state-xyz");
  });

  test("shows an Install the App prompt when redirected back from GitHub with an install URL", async ({ page }) => {
    await setAuth(page, "ADMIN");
    const GITHUB_CATALOG_ENTRY = { id: 3, key: "github", name: "GitHub", category: "devops", authType: "oauth2", status: "active" };
    const GITHUB_CONNECTION = { id: 30, integrationKey: "github", name: "Prod GitHub", status: "pending", lastRunAt: null, lastRunStatus: null };
    await page.route("**/api/integrations/catalog", r => r.fulfill({ json: [...CATALOG, GITHUB_CATALOG_ENTRY] }));
    await page.route("**/api/integrations/30", r => r.fulfill({ json: GITHUB_CONNECTION }));
    await page.route("**/api/integrations/30/runs*", r => r.fulfill({ json: [] }));

    await page.goto("/settings/integrations/30?githubInstallUrl=" + encodeURIComponent("https://github.com/apps/prism-acme/installations/new?state=abc123"));

    await expect(page.getByText("Prod GitHub")).toBeVisible({ timeout: 10_000 });
    const installLink = page.getByRole("link", { name: "Install the App" });
    await expect(installLink).toBeVisible();
    await expect(installLink).toHaveAttribute("href", "https://github.com/apps/prism-acme/installations/new?state=abc123");

    // The query param must not survive a client-side navigation replay.
    await expect(page).not.toHaveURL(/githubInstallUrl/);
  });

  test("rejects a githubInstallUrl whose origin is not github.com and shows no Install the App link", async ({ page }) => {
    await setAuth(page, "ADMIN");
    const GITHUB_CATALOG_ENTRY = { id: 3, key: "github", name: "GitHub", category: "devops", authType: "oauth2", status: "active" };
    const GITHUB_CONNECTION = { id: 30, integrationKey: "github", name: "Prod GitHub", status: "pending", lastRunAt: null, lastRunStatus: null };
    await page.route("**/api/integrations/catalog", r => r.fulfill({ json: [...CATALOG, GITHUB_CATALOG_ENTRY] }));
    await page.route("**/api/integrations/30", r => r.fulfill({ json: GITHUB_CONNECTION }));
    await page.route("**/api/integrations/30/runs*", r => r.fulfill({ json: [] }));

    await page.goto("/settings/integrations/30?githubInstallUrl=" + encodeURIComponent("https://evil.example/gh"));

    await expect(page.getByText("Prod GitHub")).toBeVisible({ timeout: 10_000 });
    await expect(page.getByRole("link", { name: "Install the App" })).toHaveCount(0);
    await expect(page.getByText("evil.example")).toHaveCount(0);

    // The query param must not survive a client-side navigation replay.
    await expect(page).not.toHaveURL(/githubInstallUrl/);
  });

  test("shows a githubError banner when redirected back from GitHub with an error", async ({ page }) => {
    await setAuth(page, "ADMIN");
    const GITHUB_CATALOG_ENTRY = { id: 3, key: "github", name: "GitHub", category: "devops", authType: "oauth2", status: "active" };
    const GITHUB_CONNECTION = { id: 30, integrationKey: "github", name: "Prod GitHub", status: "error", lastRunAt: null, lastRunStatus: null };
    await page.route("**/api/integrations/catalog", r => r.fulfill({ json: [...CATALOG, GITHUB_CATALOG_ENTRY] }));
    await page.route("**/api/integrations/30", r => r.fulfill({ json: GITHUB_CONNECTION }));
    await page.route("**/api/integrations/30/runs*", r => r.fulfill({ json: [] }));

    await page.goto("/settings/integrations/30?githubError=" + encodeURIComponent("GitHub returned 404 exchanging the manifest code"));

    await expect(page.getByText("GitHub returned 404 exchanging the manifest code")).toBeVisible({ timeout: 10_000 });
    await expect(page).not.toHaveURL(/githubError/);
  });

  test("AUDITOR can view connection detail but not Run Now/Rotate/Revoke", async ({ page }) => {
    await setAuth(page, "AUDITOR");
    await page.route("**/api/integrations/catalog", r => r.fulfill({ json: CATALOG }));
    await page.route("**/api/integrations/10", r => r.fulfill({ json: CONNECTION }));
    await page.route("**/api/integrations/10/runs*", r => r.fulfill({ json: RUNS }));

    await page.goto("/settings/integrations/10");

    await expect(page.getByText("Prod AWS")).toBeVisible({ timeout: 10_000 });
    await expect(page.getByText("connected")).toBeVisible();
    await expect(page.getByText("partial_failure")).toBeVisible();

    await expect(page.getByRole("button", { name: "Run Now" })).toHaveCount(0);
    await expect(page.getByRole("button", { name: "Rotate credentials" })).toHaveCount(0);
    await expect(page.getByRole("button", { name: "Revoke" })).toHaveCount(0);
  });
});
