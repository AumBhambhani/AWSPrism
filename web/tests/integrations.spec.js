import { test, expect } from "@playwright/test";
import { setAuth, addConsent } from "./helpers.js";

const CATALOG = [
  { id: 1, key: "aws", name: "Amazon Web Services", category: "cloud", authType: "iam_role", status: "active" },
];

const CONNECTIONS = [
  { id: 10, integrationKey: "aws", name: "Prod AWS", status: "connected", lastRunAt: "2026-08-17T10:00:00Z", lastRunStatus: "success" },
];

const SETUP_INFO = {
  principalArn: "arn:aws:iam::999999999999:role/prism-backend",
  principalError: null,
  permissionsPolicy: { Version: "2012-10-17", Statement: [{ Sid: "PrismReadOnlyEvidenceCollection", Effect: "Allow", Action: ["iam:ListUsers"], Resource: "*" }] },
};

const AZURE_SETUP_INFO = {
  roleDefinition: {
    properties: {
      roleName: "Prism Read-Only Evidence Collection",
      description: "Least-privilege read access for Prism's automated ISO 27001 evidence collection.",
      assignableScopes: ["/subscriptions/<subscription-id>"],
      permissions: [
        {
          actions: [
            "Microsoft.Storage/storageAccounts/read",
            "Microsoft.Network/networkSecurityGroups/read",
            "Microsoft.Insights/diagnosticSettings/read",
            "Microsoft.Security/pricings/read",
            "Microsoft.Resources/subscriptions/resourceGroups/read",
          ],
          notActions: [],
          dataActions: [],
          notDataActions: [],
        },
      ],
    },
  },
};

const GITHUB_SETUP_INFO = {
  manifest: {
    name: "Prism Evidence Collection - Acme Corp",
    url: "https://api.prism.example.com",
    redirect_url: "https://api.prism.example.com/api/integrations/github/manifest-callback",
    hook_attributes: { url: "https://api.prism.example.com", active: false },
    public: false,
    default_permissions: { organization_administration: "read", administration: "read", metadata: "read" },
  },
  state: "signed-state-token-abc123",
};

const ACRONIS_SETUP_INFO = {
  modules: [
    { module: "Resource management", note: "Protected-workload inventory." },
    { module: "Alert manager", note: "The alert stream." },
  ],
  steps: ["Create an API client in Settings → API clients.", "Assign it a Read-only administrator role."],
  roleHint: "Grant the API client a Read-only administrator role.",
  datacenterUrlHint: "The Cyber Protect Cloud data-center host you sign in to, e.g. https://us5-cloud.acronis.com",
};

const SOPHOS_SETUP_INFO = {
  steps: [
    "Open Global Settings > API Credentials.",
    "Assign a read-only tenant role.",
    "Copy the Client ID and Client Secret.",
    "Prism discovers the data region automatically.",
  ],
  roleHint: "Use a tenant-level service principal with read-only access.",
  scopeNote: "Unlicensed areas report not applicable.",
  areas: ["Endpoint", "DNS Protection"],
};

test.describe("Integrations settings", () => {
  test.beforeEach(async ({ page }) => {
    await addConsent(page);
    await page.goto("/");
    await page.evaluate(() => {
      localStorage.removeItem("token");
      localStorage.removeItem("user");
      localStorage.removeItem("company");
    });
  });

  test("lists the AWS catalog entry and an existing connection", async ({ page }) => {
    await setAuth(page, "ADMIN");
    await page.route("**/api/integrations/catalog", r => r.fulfill({ json: CATALOG }));
    await page.route("**/api/integrations", r => r.fulfill({ json: CONNECTIONS }));

    await page.goto("/settings/integrations");

    await expect(page.getByTitle("Amazon Web Services")).toBeVisible({ timeout: 10_000 });
    await expect(page.getByText("Prod AWS")).toBeVisible();
    await expect(page.getByText("connected")).toBeVisible();
  });

  test("failed connections show a Delete button that removes them from the list", async ({ page }) => {
    await setAuth(page, "ADMIN");
    await page.route("**/api/integrations/catalog", r => r.fulfill({ json: CATALOG }));

    let deleted = false;
    await page.route("**/api/integrations", r => {
      const failedConn = { id: 11, integrationKey: "aws", name: "Broken AWS", status: "error", lastRunAt: null, lastRunStatus: null };
      return r.fulfill({ json: deleted ? CONNECTIONS : [...CONNECTIONS, failedConn] });
    });
    await page.route("**/api/integrations/11", r => {
      if (r.request().method() === "DELETE") { deleted = true; return r.fulfill({ status: 204 }); }
      return r.fulfill({ json: {} });
    });

    await page.goto("/settings/integrations");
    await expect(page.getByText("Broken AWS")).toBeVisible({ timeout: 10_000 });

    // A connected connection must not get a Delete button.
    const connectedRow = page.locator(".admin-row", { has: page.getByText("Prod AWS") });
    await expect(connectedRow.getByRole("button", { name: "Delete" })).toHaveCount(0);

    page.once("dialog", d => d.accept());
    const failedRow = page.locator(".admin-row", { has: page.getByText("Broken AWS") });
    const [delReq] = await Promise.all([
      page.waitForRequest(req => req.url().includes("/api/integrations/11") && req.method() === "DELETE"),
      failedRow.getByRole("button", { name: "Delete" }).click(),
    ]);
    expect(delReq.method()).toBe("DELETE");

    await expect(page.getByText("Broken AWS")).toHaveCount(0);
  });

  test("shows the Azure catalog entry with its own icon", async ({ page }) => {
    await setAuth(page, "ADMIN");
    await page.route("**/api/integrations/catalog", r => r.fulfill({
      json: [...CATALOG, { id: 2, key: "azure", name: "Microsoft Azure", category: "cloud", authType: "oauth2", status: "active" }],
    }));
    await page.route("**/api/integrations", r => r.fulfill({ json: CONNECTIONS }));

    await page.goto("/settings/integrations");

    await expect(page.getByTitle("Amazon Web Services")).toBeVisible({ timeout: 10_000 });
    await expect(page.locator('[title="Microsoft Azure"] svg')).toBeVisible();
  });

  test("shows the GitHub catalog entry with its own icon", async ({ page }) => {
    await setAuth(page, "ADMIN");
    await page.route("**/api/integrations/catalog", r => r.fulfill({
      json: [...CATALOG, { id: 3, key: "github", name: "GitHub", category: "devops", authType: "oauth2", status: "active" }],
    }));
    await page.route("**/api/integrations", r => r.fulfill({ json: CONNECTIONS }));

    await page.goto("/settings/integrations");

    await expect(page.getByTitle("Amazon Web Services")).toBeVisible({ timeout: 10_000 });
    await expect(page.locator('[title="GitHub"] svg')).toBeVisible();
  });

  test("Access Keys toggle is reachable and submits the correct payload", async ({ page }) => {
    await setAuth(page, "ADMIN");
    await page.route("**/api/integrations/catalog", r => r.fulfill({ json: CATALOG }));
    await page.route("**/api/integrations/aws/setup-info", r => r.fulfill({ json: SETUP_INFO }));

    let created = false;
    await page.route("**/api/integrations", r => {
      if (r.request().method() === "POST") {
        created = true;
        return r.fulfill({ status: 201, json: { id: 13, integrationKey: "aws", name: "Key-based AWS", status: "pending" } });
      }
      return r.fulfill({ json: created ? [{ id: 13, integrationKey: "aws", name: "Key-based AWS", status: "connected" }] : [] });
    });
    await page.route("**/api/integrations/13/credentials", r =>
      r.fulfill({ json: { id: 13, integrationKey: "aws", name: "Key-based AWS", status: "connected" } })
    );

    await page.goto("/settings/integrations");
    await page.getByTitle("Amazon Web Services").click();

    await page.getByRole("button", { name: "Access Keys" }).click();

    await page.getByLabel("Connection name").fill("Key-based AWS");
    await page.getByLabel("Access key ID").fill("AKIAEXAMPLE");
    await page.getByLabel("Secret access key").fill("shh-its-a-secret");

    const [credReq] = await Promise.all([
      page.waitForRequest(req => req.url().includes("/api/integrations/13/credentials") && req.method() === "POST"),
      page.getByRole("button", { name: "Connect" }).click(),
    ]);
    const body = credReq.postDataJSON();
    expect(body.authType).toBe("access_key");
    expect(body.secret.accessKeyId).toBe("AKIAEXAMPLE");
    expect(body.secret.secretAccessKey).toBe("shh-its-a-secret");
    expect(body.secret.sessionToken).toBeUndefined();

    await expect(page.getByText(/connected/i)).toBeVisible({ timeout: 10_000 });
  });

  test("clicking the Azure card shows the real role-definition JSON and Tenant/Subscription ID fields", async ({ page }) => {
    await setAuth(page, "ADMIN");
    await page.route("**/api/integrations/catalog", r => r.fulfill({
      json: [...CATALOG, { id: 2, key: "azure", name: "Microsoft Azure", category: "cloud", authType: "oauth2", status: "active" }],
    }));
    await page.route("**/api/integrations/azure/setup-info", r => r.fulfill({ json: AZURE_SETUP_INFO }));

    await page.goto("/settings/integrations");
    await page.getByTitle("Microsoft Azure").click();

    await expect(page.getByText('"Microsoft.Storage/storageAccounts/read"')).toBeVisible({ timeout: 10_000 });
    await expect(page.getByLabel("Tenant ID")).toBeVisible();
    await expect(page.getByLabel("Subscription ID")).toBeVisible();
    await expect(page.getByLabel("Client ID")).toBeVisible();
    await expect(page.getByLabel("Client secret")).toBeVisible();

    // The Region field is AWS-specific and must not render for Azure.
    await expect(page.getByLabel("Region")).toHaveCount(0);
  });

  test("submitting the Azure form sends the exact config/secret shape the backend expects", async ({ page }) => {
    await setAuth(page, "ADMIN");
    await page.route("**/api/integrations/catalog", r => r.fulfill({
      json: [...CATALOG, { id: 2, key: "azure", name: "Microsoft Azure", category: "cloud", authType: "oauth2", status: "active" }],
    }));
    await page.route("**/api/integrations/azure/setup-info", r => r.fulfill({ json: AZURE_SETUP_INFO }));

    let created = false;
    await page.route("**/api/integrations", r => {
      if (r.request().method() === "POST") {
        created = true;
        return r.fulfill({ status: 201, json: { id: 20, integrationKey: "azure", name: "Prod Azure", status: "pending" } });
      }
      return r.fulfill({ json: created ? [{ id: 20, integrationKey: "azure", name: "Prod Azure", status: "connected" }] : [] });
    });
    await page.route("**/api/integrations/20/credentials", r =>
      r.fulfill({ json: { id: 20, integrationKey: "azure", name: "Prod Azure", status: "connected" } })
    );

    await page.goto("/settings/integrations");
    await page.getByTitle("Microsoft Azure").click();

    await page.getByLabel("Connection name").fill("Prod Azure");
    await page.getByLabel("Tenant ID").fill("11111111-1111-1111-1111-111111111111");
    await page.getByLabel("Subscription ID").fill("22222222-2222-2222-2222-222222222222");
    await page.getByLabel("Client ID").fill("33333333-3333-3333-3333-333333333333");
    await page.getByLabel("Client secret").fill("shh-azure-secret");

    const [createReq] = await Promise.all([
      page.waitForRequest(req => req.url().includes("/api/integrations") && req.method() === "POST" && !req.url().includes("/credentials")),
      page.getByRole("button", { name: "Connect" }).click(),
    ]);
    const createBody = createReq.postDataJSON();
    expect(createBody.integrationKey).toBe("azure");
    expect(createBody.config).toEqual({ tenantId: "11111111-1111-1111-1111-111111111111", subscriptionId: "22222222-2222-2222-2222-222222222222" });
    expect(createBody.config.region).toBeUndefined();

    await expect(page.getByText(/connected/i)).toBeVisible({ timeout: 10_000 });
  });

  test("clicking the Acronis card shows the data-center URL field and shared OAuth fields, not Azure's", async ({ page }) => {
    await setAuth(page, "ADMIN");
    await page.route("**/api/integrations/catalog", r => r.fulfill({
      json: [...CATALOG, { id: 3, key: "acronis", name: "Acronis Cyber Protect Cloud", category: "backup", authType: "oauth2", status: "beta" }],
    }));
    await page.route("**/api/integrations/acronis/setup-info", r => r.fulfill({ json: ACRONIS_SETUP_INFO }));

    await page.goto("/settings/integrations");
    await page.getByTitle("Acronis Cyber Protect Cloud").click();

    await expect(page.getByLabel("Data center URL")).toBeVisible({ timeout: 10_000 });
    await expect(page.getByLabel("Client ID")).toBeVisible();
    await expect(page.getByLabel("Client secret")).toBeVisible();

    // Provider-keyed branching: Azure's fields and the AWS Region field must not render for Acronis.
    await expect(page.getByLabel("Tenant ID")).toHaveCount(0);
    await expect(page.getByLabel("Subscription ID")).toHaveCount(0);
    await expect(page.getByLabel("Region")).toHaveCount(0);
  });

  test("submitting the Acronis form sends config: { datacenterUrl } and the shared oauth2 secret", async ({ page }) => {
    await setAuth(page, "ADMIN");
    await page.route("**/api/integrations/catalog", r => r.fulfill({
      json: [...CATALOG, { id: 3, key: "acronis", name: "Acronis Cyber Protect Cloud", category: "backup", authType: "oauth2", status: "beta" }],
    }));
    await page.route("**/api/integrations/acronis/setup-info", r => r.fulfill({ json: ACRONIS_SETUP_INFO }));

    let created = false;
    await page.route("**/api/integrations", r => {
      if (r.request().method() === "POST") {
        created = true;
        return r.fulfill({ status: 201, json: { id: 21, integrationKey: "acronis", name: "Prod Acronis", status: "pending" } });
      }
      return r.fulfill({ json: created ? [{ id: 21, integrationKey: "acronis", name: "Prod Acronis", status: "connected" }] : [] });
    });
    await page.route("**/api/integrations/21/credentials", r =>
      r.fulfill({ json: { id: 21, integrationKey: "acronis", name: "Prod Acronis", status: "connected" } })
    );

    await page.goto("/settings/integrations");
    await page.getByTitle("Acronis Cyber Protect Cloud").click();

    await page.getByLabel("Connection name").fill("Prod Acronis");
    await page.getByLabel("Data center URL").fill("https://us5-cloud.acronis.com");
    await page.getByLabel("Client ID").fill("client-abc");
    await page.getByLabel("Client secret").fill("shh-acronis-secret");

    const [createReq, credsReq] = await Promise.all([
      page.waitForRequest(req => req.url().includes("/api/integrations") && req.method() === "POST" && !req.url().includes("/credentials")),
      page.waitForRequest(req => req.url().includes("/api/integrations/21/credentials") && req.method() === "POST"),
      page.getByRole("button", { name: "Connect" }).click(),
    ]);
    expect(createReq.postDataJSON().integrationKey).toBe("acronis");
    expect(createReq.postDataJSON().config).toEqual({ datacenterUrl: "https://us5-cloud.acronis.com" });
    expect(credsReq.postDataJSON()).toEqual({ authType: "oauth2", secret: { clientId: "client-abc", clientSecret: "shh-acronis-secret" } });

    await expect(page.getByText(/connected/i)).toBeVisible({ timeout: 10_000 });
  });

  test("Sophos walkthrough submits empty config and tenant OAuth2 credentials", async ({ page }) => {
    await setAuth(page, "ADMIN");
    await page.route("**/api/integrations/catalog", route => route.fulfill({
      json: [...CATALOG, { id: 22, key: "sophos", name: "Sophos Central", category: "endpoint_security", authType: "oauth2", status: "beta" }],
    }));
    await page.route("**/api/integrations/sophos/setup-info", route => route.fulfill({ json: SOPHOS_SETUP_INFO }));
    let created = false;
    await page.route("**/api/integrations", route => {
      if (route.request().method() === "POST") {
        created = true;
        return route.fulfill({ status: 201, json: { id: 22, integrationKey: "sophos", name: "Prod Sophos", status: "pending" } });
      }
      return route.fulfill({ json: created ? [{ id: 22, integrationKey: "sophos", name: "Prod Sophos", status: "connected" }] : [] });
    });
    await page.route("**/api/integrations/22/credentials", route => route.fulfill({ json: { id: 22, integrationKey: "sophos", name: "Prod Sophos", status: "connected" } }));

    await page.goto("/settings/integrations");
    await page.getByTitle("Sophos Central").click();
    await expect(page.getByText(/tenant-level service principal/i)).toBeVisible({ timeout: 10_000 });
    await expect(page.getByLabel("Region")).toHaveCount(0);
    await page.getByLabel("Connection name").fill("Prod Sophos");
    await page.getByLabel("Client ID").fill("sophos-client");
    await page.getByLabel("Client secret").fill("sophos-secret");

    const [createRequest, credentialsRequest] = await Promise.all([
      page.waitForRequest(request => request.url().endsWith("/api/integrations") && request.method() === "POST"),
      page.waitForRequest(request => request.url().includes("/api/integrations/22/credentials") && request.method() === "POST"),
      page.getByRole("button", { name: "Connect" }).click(),
    ]);
    expect(createRequest.postDataJSON()).toMatchObject({ integrationKey: "sophos", config: {} });
    expect(credentialsRequest.postDataJSON()).toEqual({ authType: "oauth2", secret: { clientId: "sophos-client", clientSecret: "sophos-secret" } });
  });

  test("submitting the Commvault form sends config: { webconsoleUrl } and an api_key secret: { accessToken }", async ({ page }) => {
    await setAuth(page, "ADMIN");
    await page.route("**/api/integrations/catalog", r => r.fulfill({
      json: [...CATALOG, { id: 4, key: "commvault", name: "Commvault", category: "backup", authType: "api_key", status: "beta" }],
    }));
    await page.route("**/api/integrations/commvault/setup-info", r => r.fulfill({
      json: {
        accessTokenSetup: { tokenType: 3, apiEndpoints: ["/Alerts", "/dashboard", "/StoragePolicy", "/v2/StoragePolicy"] },
        steps: ["Open Command Center → Access Tokens → Add.", "Set scope to Custom and add the endpoints below."],
        webconsoleUrlHint: "The CommCell WebConsole base URL you sign in to.",
      },
    }));

    let created = false;
    await page.route("**/api/integrations", r => {
      if (r.request().method() === "POST") {
        created = true;
        return r.fulfill({ status: 201, json: { id: 41, integrationKey: "commvault", name: "Prod Commvault", status: "pending" } });
      }
      return r.fulfill({ json: created ? [{ id: 41, integrationKey: "commvault", name: "Prod Commvault", status: "connected" }] : [] });
    });
    await page.route("**/api/integrations/41/credentials", r =>
      r.fulfill({ json: { id: 41, integrationKey: "commvault", name: "Prod Commvault", status: "connected" } })
    );

    await page.goto("/settings/integrations");
    await page.getByTitle("Commvault").click();

    await page.getByLabel("Connection name").fill("Prod Commvault");
    await page.getByLabel("WebConsole base URL").fill("https://commvault.example.com");
    await page.getByLabel("Custom-scope access token").fill("tok-abc123");

    // Provider-keyed branching: Privy's generic "API key" field and the AWS Region field must not render for Commvault.
    await expect(page.getByLabel("API key")).toHaveCount(0);
    await expect(page.getByLabel("Region")).toHaveCount(0);

    const [createReq, credsReq] = await Promise.all([
      page.waitForRequest(req => req.url().includes("/api/integrations") && req.method() === "POST" && !req.url().includes("/credentials")),
      page.waitForRequest(req => req.url().includes("/api/integrations/41/credentials") && req.method() === "POST"),
      page.getByRole("button", { name: "Connect" }).click(),
    ]);
    expect(createReq.postDataJSON().integrationKey).toBe("commvault");
    expect(createReq.postDataJSON().config).toEqual({ webconsoleUrl: "https://commvault.example.com" });
    expect(credsReq.postDataJSON()).toEqual({ authType: "api_key", secret: { accessToken: "tok-abc123" } });

    await expect(page.getByText(/connected/i)).toBeVisible({ timeout: 10_000 });
  });

  test("Akamai walkthrough renders the four READ-ONLY scopes and submits config: { host } with an EdgeGrid api_key secret", async ({ page }) => {
    await setAuth(page, "ADMIN");
    await page.route("**/api/integrations/catalog", r => r.fulfill({
      json: [...CATALOG, { id: 5, key: "akamai", name: "Akamai", category: "network_security", authType: "api_key", status: "beta" }],
    }));
    await page.route("**/api/integrations/akamai/setup-info", r => r.fulfill({
      json: {
        scopes: [
          "Application Security — READ-ONLY (WAF, rate, attack groups, SIEM settings)",
          "Property Manager (PAPI) — READ-ONLY (properties, versions, activations, rule trees)",
          "Certificate Provisioning System — READ-ONLY (enrollments, deployments, changes)",
          "API Definitions — READ-ONLY (registered endpoints and resources)",
        ],
        controlCenterPath: "Control Center → Identity & Access → API clients → Create API client (read-only)",
        hostHint: 'The "host" line from the API client .edgerc block, e.g. akab-xxxx.luna.akamaiapis.net.',
        steps: ["In Control Center open Identity & Access → API clients and click Create API client.", "Grant the four READ-ONLY scopes below."],
      },
    }));

    let created = false;
    await page.route("**/api/integrations", r => {
      if (r.request().method() === "POST") {
        created = true;
        return r.fulfill({ status: 201, json: { id: 55, integrationKey: "akamai", name: "Prod Akamai", status: "pending" } });
      }
      return r.fulfill({ json: created ? [{ id: 55, integrationKey: "akamai", name: "Prod Akamai", status: "connected" }] : [] });
    });
    await page.route("**/api/integrations/55/credentials", r =>
      r.fulfill({ json: { id: 55, integrationKey: "akamai", name: "Prod Akamai", status: "connected" } })
    );

    await page.goto("/settings/integrations");
    await page.getByTitle("Akamai").click();

    await expect(page.getByText("Grant these READ-ONLY scopes")).toBeVisible({ timeout: 10_000 });
    await expect(page.getByText("Application Security — READ-ONLY (WAF, rate, attack groups, SIEM settings)")).toBeVisible();
    await expect(page.getByText("Property Manager (PAPI) — READ-ONLY (properties, versions, activations, rule trees)")).toBeVisible();
    await expect(page.getByText("Certificate Provisioning System — READ-ONLY (enrollments, deployments, changes)")).toBeVisible();
    await expect(page.getByText("API Definitions — READ-ONLY (registered endpoints and resources)")).toBeVisible();

    await page.getByLabel("Connection name").fill("Prod Akamai");
    await page.getByLabel("API host").fill("akab-abc.luna.akamaiapis.net");
    await page.getByLabel("Client token").fill("akab-ct");
    await page.getByLabel("Client secret").fill("cs=");
    await page.getByLabel("Access token").fill("akab-at");
    await page.getByLabel(/Account switch key/).fill("1-ABCDEF:1-ABCDE");

    // Provider-keyed branching: the generic AWS Region field and Privy's "API key" field must not render for Akamai.
    await expect(page.getByLabel("Region", { exact: true })).toHaveCount(0);
    await expect(page.getByLabel("API key")).toHaveCount(0);

    const [createReq, credsReq] = await Promise.all([
      page.waitForRequest(req => req.url().includes("/api/integrations") && req.method() === "POST" && !req.url().includes("/credentials")),
      page.waitForRequest(req => req.url().includes("/api/integrations/55/credentials") && req.method() === "POST"),
      page.getByRole("button", { name: "Connect" }).click(),
    ]);
    expect(createReq.postDataJSON().integrationKey).toBe("akamai");
    expect(createReq.postDataJSON().config.host).toBe("akab-abc.luna.akamaiapis.net");
    expect(createReq.postDataJSON().config.accountSwitchKey).toBe("1-ABCDEF:1-ABCDE");
    const credsBody = credsReq.postDataJSON();
    expect(credsBody.authType).toBe("api_key");
    expect(credsBody.secret.clientToken).toBe("akab-ct");
    expect(credsBody.secret.accessToken).toBe("akab-at");
    expect(credsBody.secret.clientSecret).toBe("cs=");

    await expect(page.getByText(/connected/i)).toBeVisible({ timeout: 10_000 });
  });

  test("Check Point Infinity walkthrough sends config: { region, gatewayUrl } and an api_key secret: { clientId, accessKey }", async ({ page }) => {
    await setAuth(page, "ADMIN");
    await page.route("**/api/integrations/catalog", r => r.fulfill({
      json: [...CATALOG, { id: 60, key: "check_point", name: "Check Point Infinity", category: "endpoint_security", authType: "api_key", status: "beta" }],
    }));
    await page.route("**/api/integrations/check_point/setup-info", r => r.fulfill({
      json: {
        regions: [{ value: "eu", label: "EU (cloudinfra-gw.portal.checkpoint.com)" }, { value: "us", label: "US (cloudinfra-gw-us.portal.checkpoint.com)" }],
        services: [{ service: "events", label: "Logs / Events", note: "Event feed." }],
        steps: ["Create an Infinity Portal API key.", "Paste the pair below."],
        scopeNote: "Only the services you provide a key for are collected.",
      },
    }));
    let created = false;
    await page.route("**/api/integrations", r => {
      if (r.request().method() === "POST") {
        created = true;
        return r.fulfill({ status: 201, json: { id: 60, integrationKey: "check_point", name: "Prod CP", status: "pending" } });
      }
      return r.fulfill({ json: created ? [{ id: 60, integrationKey: "check_point", name: "Prod CP", status: "connected" }] : [] });
    });
    await page.route("**/api/integrations/60/credentials", r =>
      r.fulfill({ json: { id: 60, integrationKey: "check_point", name: "Prod CP", status: "connected" } })
    );

    await page.goto("/settings/integrations");
    await page.getByTitle("Check Point Infinity").click();

    await page.getByLabel("Connection name").fill("Prod CP");
    await page.getByLabel("Infinity Portal region").selectOption("us");
    await page.getByLabel("Client ID").fill("cp-client");
    await page.getByLabel("Secret Key").fill("cp-secret");

    // Provider-keyed branching: the generic AWS Region text field and Privy's "API key" field must not render.
    await expect(page.getByLabel("Region", { exact: true })).toHaveCount(0);
    await expect(page.getByLabel("API key")).toHaveCount(0);

    const [createReq, credsReq] = await Promise.all([
      page.waitForRequest(req => req.url().includes("/api/integrations") && req.method() === "POST" && !req.url().includes("/credentials")),
      page.waitForRequest(req => req.url().includes("/api/integrations/60/credentials") && req.method() === "POST"),
      page.getByRole("button", { name: "Connect" }).click(),
    ]);
    expect(createReq.postDataJSON().integrationKey).toBe("check_point");
    expect(createReq.postDataJSON().config).toEqual({ region: "us", gatewayUrl: "https://cloudinfra-gw-us.portal.checkpoint.com" });
    expect(credsReq.postDataJSON()).toEqual({ authType: "api_key", secret: { clientId: "cp-client", accessKey: "cp-secret" } });

    await expect(page.getByText(/connected/i)).toBeVisible({ timeout: 10_000 });
  });

  test("clicking the GitHub card creates a pending connection and shows the Create GitHub App button", async ({ page }) => {
    await setAuth(page, "ADMIN");
    await page.route("**/api/integrations/catalog", r => r.fulfill({
      json: [...CATALOG, { id: 3, key: "github", name: "GitHub", category: "devops", authType: "oauth2", status: "active" }],
    }));

    let created = false;
    await page.route("**/api/integrations", r => {
      if (r.request().method() === "POST") {
        created = true;
        return r.fulfill({ status: 201, json: { id: 30, integrationKey: "github", name: "Prod GitHub", status: "pending" } });
      }
      return r.fulfill({ json: created ? [{ id: 30, integrationKey: "github", name: "Prod GitHub", status: "pending" }] : [] });
    });
    await page.route("**/api/integrations/30/github/setup-info", r => r.fulfill({ json: GITHUB_SETUP_INFO }));

    await page.goto("/settings/integrations");
    await page.getByTitle("GitHub").click();

    await page.getByLabel("Connection name").fill("Prod GitHub");

    const [createReq] = await Promise.all([
      page.waitForRequest(req => req.url().includes("/api/integrations") && req.method() === "POST" && !req.url().includes("/credentials")),
      page.getByRole("button", { name: "Start GitHub setup" }).click(),
    ]);
    expect(createReq.postDataJSON()).toEqual({ integrationKey: "github", name: "Prod GitHub", config: {} });

    const createButton = page.getByRole("button", { name: "Create GitHub App on GitHub" });
    await expect(createButton).toBeVisible({ timeout: 10_000 });

    const form = page.locator("form", { has: createButton });
    await expect(form).toHaveAttribute("action", "https://github.com/settings/apps/new?state=signed-state-token-abc123");
    await expect(form).toHaveAttribute("method", "post");
    const manifestValue = await form.locator('input[name="manifest"]').getAttribute("value");
    expect(JSON.parse(manifestValue)).toEqual(GITHUB_SETUP_INFO.manifest);

    // No AWS/Azure-shaped fields should render for GitHub.
    await expect(page.getByLabel("Region")).toHaveCount(0);
    await expect(page.getByLabel("Client ID")).toHaveCount(0);
  });

  test("closing the wizard after Start GitHub setup refreshes the list so the new pending connection appears", async ({ page }) => {
    await setAuth(page, "ADMIN");
    await page.route("**/api/integrations/catalog", r => r.fulfill({
      json: [...CATALOG, { id: 3, key: "github", name: "GitHub", category: "devops", authType: "oauth2", status: "active" }],
    }));

    let created = false;
    let listFetchCount = 0;
    await page.route("**/api/integrations", r => {
      if (r.request().method() === "POST") {
        created = true;
        return r.fulfill({ status: 201, json: { id: 30, integrationKey: "github", name: "Prod GitHub", status: "pending" } });
      }
      listFetchCount += 1;
      return r.fulfill({ json: created ? [{ id: 30, integrationKey: "github", name: "Prod GitHub", status: "pending" }] : [] });
    });
    await page.route("**/api/integrations/30/github/setup-info", r => r.fulfill({ json: GITHUB_SETUP_INFO }));

    await page.goto("/settings/integrations");
    await expect(page.getByText("No connections yet")).toBeVisible({ timeout: 10_000 });
    const initialListFetchCount = listFetchCount;

    await page.getByTitle("GitHub").click();
    await page.getByLabel("Connection name").fill("Prod GitHub");

    const [createReq] = await Promise.all([
      page.waitForRequest(req => req.url().includes("/api/integrations") && req.method() === "POST" && !req.url().includes("/credentials")),
      page.getByRole("button", { name: "Start GitHub setup" }).click(),
    ]);
    expect(createReq).toBeTruthy();

    const closeButton = page.getByRole("button", { name: "Close" });
    await expect(closeButton).toBeVisible({ timeout: 10_000 });

    const [listReq] = await Promise.all([
      page.waitForRequest(req => req.url().endsWith("/api/integrations") && req.method() === "GET"),
      closeButton.click(),
    ]);
    expect(listReq).toBeTruthy();
    expect(listFetchCount).toBeGreaterThan(initialListFetchCount);

    // The wizard closed and the pending connection now shows in the table
    // without a manual page refresh.
    await expect(page.getByText("Connect GitHub")).toHaveCount(0);
    await expect(page.getByText("Prod GitHub")).toBeVisible({ timeout: 10_000 });
    await expect(page.getByText("pending")).toBeVisible();
  });

  test("clicking the AWS card opens the wizard, shows the real trust policy, and creates a connection", async ({ page }) => {
    await setAuth(page, "ADMIN");
    await page.route("**/api/integrations/catalog", r => r.fulfill({ json: CATALOG }));
    await page.route("**/api/integrations/aws/setup-info", r => r.fulfill({ json: SETUP_INFO }));

    // The page reloads the connection list (GET /api/integrations) right after
    // creating one, so the mock must reflect that a connection now exists —
    // a static empty-array response would make the final assertion below fail.
    let created = false;
    await page.route("**/api/integrations", r => {
      if (r.request().method() === "POST") {
        created = true;
        return r.fulfill({ status: 201, json: { id: 11, integrationKey: "aws", name: "New AWS", status: "pending" } });
      }
      return r.fulfill({ json: created ? [{ id: 11, integrationKey: "aws", name: "New AWS", status: "connected" }] : [] });
    });
    await page.route("**/api/integrations/11/credentials", r =>
      r.fulfill({ json: { id: 11, integrationKey: "aws", name: "New AWS", status: "connected" } })
    );

    await page.goto("/settings/integrations");
    await page.getByTitle("Amazon Web Services").click();

    // The trust policy should embed the *real* principal ARN from setup-info,
    // not a placeholder — this is the whole point of fetching it.
    await expect(page.getByText(SETUP_INFO.principalArn)).toBeVisible({ timeout: 10_000 });
    await expect(page.getByText('"iam:ListUsers"')).toBeVisible();

    await page.getByLabel("Connection name").fill("New AWS");
    await page.getByLabel(/Role ARN/).fill("arn:aws:iam::123456789012:role/prism-readonly");

    const [createReq] = await Promise.all([
      page.waitForRequest(req => req.url().includes("/api/integrations") && req.method() === "POST"),
      page.getByRole("button", { name: "Connect" }).click(),
    ]);
    expect(createReq.postDataJSON().name).toBe("New AWS");

    await expect(page.getByText(/connected/i)).toBeVisible({ timeout: 10_000 });
  });

  test("retrying after a failed credentials step does not create a duplicate connection", async ({ page }) => {
    await setAuth(page, "ADMIN");
    await page.route("**/api/integrations/catalog", r => r.fulfill({ json: CATALOG }));
    await page.route("**/api/integrations/aws/setup-info", r => r.fulfill({ json: SETUP_INFO }));

    let createCount = 0;
    let created = false;
    await page.route("**/api/integrations", r => {
      if (r.request().method() === "POST") {
        createCount += 1;
        created = true;
        return r.fulfill({ status: 201, json: { id: 12, integrationKey: "aws", name: "Retry AWS", status: "pending" } });
      }
      return r.fulfill({ json: created ? [{ id: 12, integrationKey: "aws", name: "Retry AWS", status: "connected" }] : [] });
    });

    // First credentials attempt fails (e.g. a bad role ARN); the second, identical
    // retry succeeds. Only the credentials call should differ between attempts —
    // the connection-create call must not fire again.
    let credentialsAttempts = 0;
    await page.route("**/api/integrations/12/credentials", r => {
      credentialsAttempts += 1;
      if (credentialsAttempts === 1) {
        return r.fulfill({ status: 400, json: { error: "Unable to assume role" } });
      }
      return r.fulfill({ json: { id: 12, integrationKey: "aws", name: "Retry AWS", status: "connected" } });
    });

    await page.goto("/settings/integrations");
    await page.getByTitle("Amazon Web Services").click();

    await page.getByLabel("Connection name").fill("Retry AWS");
    await page.getByLabel(/Role ARN/).fill("arn:aws:iam::123456789012:role/prism-readonly");

    // First attempt — credentials step fails, wizard stays open with an error.
    await page.getByRole("button", { name: "Connect" }).click();
    await expect(page.getByText("Unable to assume role")).toBeVisible({ timeout: 10_000 });

    // Retry with the same form state — should reuse the already-created connection.
    const [createReq] = await Promise.all([
      page.waitForRequest(req => req.url().includes("/api/integrations/12/credentials")),
      page.getByRole("button", { name: "Connect" }).click(),
    ]);
    expect(createReq).toBeTruthy();

    await expect(page.getByText(/connected/i)).toBeVisible({ timeout: 10_000 });
    expect(createCount).toBe(1);
  });

  test("shows a githubError banner when redirected back to the list page from GitHub with an error", async ({ page }) => {
    await setAuth(page, "ADMIN");
    await page.route("**/api/integrations/catalog", r => r.fulfill({ json: CATALOG }));
    await page.route("**/api/integrations", r => r.fulfill({ json: CONNECTIONS }));

    await page.goto("/settings/integrations?githubError=" + encodeURIComponent("Invalid or expired state token"));

    await expect(page.getByText("Invalid or expired state token")).toBeVisible({ timeout: 10_000 });
    await expect(page).not.toHaveURL(/githubError/);
  });

  test("non-admin/lead roles cannot reach the page", async ({ page }) => {
    await setAuth(page, "CONTRIBUTOR");
    await page.goto("/settings/integrations");
    await expect(page).not.toHaveURL(/\/settings\/integrations/);
  });

  test("AUDITOR can view the connection list read-only but cannot open the connect wizard", async ({ page }) => {
    await setAuth(page, "AUDITOR");
    await page.route("**/api/integrations/catalog", r => r.fulfill({ json: CATALOG }));
    await page.route("**/api/integrations", r => r.fulfill({ json: CONNECTIONS }));

    await page.goto("/settings/integrations");

    await expect(page).toHaveURL(/\/settings\/integrations/);
    await expect(page.getByTitle("Amazon Web Services")).toBeVisible({ timeout: 10_000 });
    await expect(page.getByText("Prod AWS")).toBeVisible();

    await page.getByTitle("Amazon Web Services").click();
    await expect(page.getByText("Connect Amazon Web Services")).toHaveCount(0);
  });

  test("cadence dropdown and auto-collect toggle round-trip through the schedule PATCH", async ({ page }) => {
    await setAuth(page, "ADMIN");
    await page.route("**/api/integrations/catalog", r => r.fulfill({ json: CATALOG }));

    let current = {
      id: 10, integrationKey: "aws", name: "Prod AWS", status: "connected",
      lastRunAt: "2026-08-17T10:00:00Z", lastRunStatus: "success",
      collectionFrequencyHours: 24, autoCollectEnabled: true,
    };

    await page.route("**/api/integrations", r => {
      if (r.request().method() === "GET") return r.fulfill({ json: [current] });
      return r.fulfill({ json: {} });
    });
    await page.route("**/api/integrations/10/schedule", r => {
      const body = r.request().postDataJSON();
      current = { ...current, ...body };
      return r.fulfill({ json: current });
    });

    await page.goto("/settings/integrations");
    await expect(page.getByText("Prod AWS")).toBeVisible({ timeout: 10_000 });

    const cadenceSelect = page.getByLabel("Collection cadence");
    await expect(cadenceSelect).toHaveValue("24");

    const [patchReq1] = await Promise.all([
      page.waitForRequest(req => req.url().includes("/api/integrations/10/schedule") && req.method() === "PATCH"),
      cadenceSelect.selectOption("72"),
    ]);
    expect(patchReq1.postDataJSON()).toEqual({ collectionFrequencyHours: 72, autoCollectEnabled: true });
    await expect(cadenceSelect).toHaveValue("72");

    const autoToggle = page.getByLabel("Auto-collect enabled");
    await expect(autoToggle).toBeChecked();

    // Plain click rather than uncheck(): the checkbox is a controlled input
    // bound to the connection's server-confirmed state, so it doesn't flip
    // until the PATCH resolves — uncheck()'s built-in post-click state
    // check would race that round-trip.
    const [patchReq2] = await Promise.all([
      page.waitForRequest(req => req.url().includes("/api/integrations/10/schedule") && req.method() === "PATCH"),
      autoToggle.click(),
    ]);
    expect(patchReq2.postDataJSON()).toEqual({ collectionFrequencyHours: 72, autoCollectEnabled: false });
    await expect(autoToggle).not.toBeChecked();

    // Interacting with the controls must not trigger the row's
    // navigate-to-detail-page click handler.
    await expect(page).toHaveURL(/\/settings\/integrations$/);
  });
});
