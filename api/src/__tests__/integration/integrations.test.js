import { describe, test, expect, vi, afterEach } from "vitest";
import request from "supertest";
import { createCompany, createUser } from "../setup/helpers.js";
import { query } from "../../db/index.js";
import { signGithubAppState, verifyGithubAppState } from "../../utils/githubAppState.js";
import { getActiveCredential, storeCredential } from "../../db/integrationCredentials.js";

const CONNECTOR_FIXTURES = {
  aws: {
    key: "aws",
    testConnection: vi.fn(async () => ({ ok: true, externalAccountId: "123456789012" })),
    runTests: vi.fn(async () => ([
      { testKey: "aws.iam.mfa_enforced", severity: "critical", resourceId: "user-1", status: "pass", message: "MFA enabled", evidencePayload: {} },
    ])),
  },
  github: {
    key: "github",
    testConnection: vi.fn(async () => ({ ok: true, externalAccountId: "42424242" })),
    runTests: vi.fn(async () => ([])),
  },
  purview: {
    key: "purview",
    testConnection: vi.fn(async () => ({ ok: true, externalAccountId: "my-purview-account" })),
    runTests: vi.fn(async () => ([
      { testKey: "purview.audit.unified_logging_enabled", severity: "critical", resourceId: "tenant", status: "pass", message: "Unified audit logging is enabled", evidencePayload: {} },
    ])),
  },
  acronis: {
    key: "acronis",
    testConnection: vi.fn(async () => ({ ok: true, externalAccountId: "TENANT-123" })),
    runTests: vi.fn(async () => ([
      { testKey: "acronis.backup.protection_enabled", severity: "high", resourceId: "m1", status: "pass", message: "All workloads report a Protected status", evidencePayload: {} },
    ])),
  },
  commvault: {
    key: "commvault",
    testConnection: vi.fn(async () => ({ ok: true, externalAccountId: "commvault.example.com" })),
    runTests: vi.fn(async () => ([
      { testKey: "commvault.backup.sla_compliance", severity: "critical", resourceId: "commcell", status: "pass", message: "All 10 monitored entities meet their backup SLA", evidencePayload: {} },
    ])),
  },
  "carbonite-server": {
    key: "carbonite-server",
    testConnection: vi.fn(async () => ({ ok: true, externalAccountId: "backup.example.com" })),
    runTests: vi.fn(async () => ([
      { testKey: "carbonite-server.backup.recent_successful_safeset", severity: "critical", resourceId: "SQL nightly", status: "fail", message: "Safeset \"SQL nightly\" — most recent run did not succeed (status: Failed)", evidencePayload: {} },
    ])),
  },
  carbonite: {
    key: "carbonite",
    testConnection: vi.fn(async () => ({ ok: true, externalAccountId: "dashboard.carbonite.com" })),
    runTests: vi.fn(async () => ([
      { testKey: "carbonite.backup.recent_successful_backup", severity: "critical", resourceId: "d1", status: "fail", message: "Device \"laptop-1\" has never reported a completed backup", evidencePayload: {} },
    ])),
  },
  sophos: {
    key: "sophos",
    testConnection: vi.fn(async () => ({ ok: true, externalAccountId: "tenant-sophos-1" })),
    runTests: vi.fn(async () => ([
      { testKey: "sophos.endpoint.protection_health", title: "All managed endpoints report good overall health", failTitle: "Some managed endpoints do not report good overall health", severity: "high", resourceId: "endpoint-1", status: "pass", message: "Endpoint health is good", evidencePayload: {} },
    ])),
  },
};

vi.mock("../../connectors/registry.js", () => ({
  getConnector: vi.fn((integrationKey) => CONNECTOR_FIXTURES[integrationKey]),
}));

// GET /github/install-callback resolves the org login via an App-level (JWT)
// Octokit lookup — mocked here so the suite never makes a real GitHub API call.
const getInstallation = vi.fn(async () => ({ data: { account: { login: "acme-corp" } } }));
vi.mock("@octokit/auth-app", () => ({
  createAppAuth: vi.fn(() => vi.fn(async () => ({ token: "fake-app-jwt" }))),
}));
vi.mock("@octokit/rest", () => ({
  Octokit: vi.fn(function () {
    this.rest = { apps: { getInstallation } };
  }),
}));

// GET /aws/setup-info calls real STS via the SDK's default credential chain —
// mocked here so the test suite never depends on (or accidentally hits) a real
// AWS account, regardless of what's in the host/CI environment.
const stsSend = vi.fn();
vi.mock("@aws-sdk/client-sts", () => ({
  STSClient: vi.fn(() => ({ send: stsSend })),
  GetCallerIdentityCommand: vi.fn(),
  AssumeRoleCommand: vi.fn(),
}));

const originalFetch = global.fetch;

const { default: app } = await import("../../app.js");

describe("GET /api/integrations/aws/setup-info", () => {
  test("returns the resolved principal ARN and the read-only permissions policy", async () => {
    stsSend.mockResolvedValueOnce({ Arn: "arn:aws:iam::999999999999:role/prism-backend" });
    const company = await createCompany({ domain: "setupinfo1.com" });
    const admin = await createUser(company.id, "ADMIN");

    const res = await request(app).get("/api/integrations/aws/setup-info").set("Authorization", `Bearer ${admin.token}`);

    expect(res.status).toBe(200);
    expect(res.body.principalArn).toBe("arn:aws:iam::999999999999:role/prism-backend");
    expect(res.body.principalError).toBeNull();
    expect(res.body.permissionsPolicy.Statement[0].Action).toContain("iam:ListUsers");
    expect(res.body.permissionsPolicy.Statement[0].Action).toContain("s3:GetBucketPublicAccessBlock");
  });

  test("returns a null principal with an explanatory error when STS is unreachable, but still returns the policy", async () => {
    stsSend.mockRejectedValueOnce(new Error("Could not load credentials from any providers"));
    const company = await createCompany({ domain: "setupinfo2.com" });
    const admin = await createUser(company.id, "ADMIN");

    const res = await request(app).get("/api/integrations/aws/setup-info").set("Authorization", `Bearer ${admin.token}`);

    expect(res.status).toBe(200);
    expect(res.body.principalArn).toBeNull();
    expect(res.body.principalError).toMatch(/no AWS credentials configured/i);
    expect(res.body.permissionsPolicy.Statement[0].Action).toContain("ec2:DescribeSecurityGroups");
  });

  test("is not accessible to CONTRIBUTOR", async () => {
    const company = await createCompany({ domain: "setupinfo3.com" });
    const contributor = await createUser(company.id, "CONTRIBUTOR");

    const res = await request(app).get("/api/integrations/aws/setup-info").set("Authorization", `Bearer ${contributor.token}`);
    expect(res.status).toBe(403);
  });
});

describe("GET /api/integrations/azure/setup-info", () => {
  test("returns a static least-privilege role definition, no live Azure call needed", async () => {
    const company = await createCompany({ domain: "azuresetup1.com" });
    const admin = await createUser(company.id, "ADMIN");

    const res = await request(app).get("/api/integrations/azure/setup-info").set("Authorization", `Bearer ${admin.token}`);

    expect(res.status).toBe(200);
    expect(res.body.roleDefinition.properties.roleName).toBe("Prism Read-Only Evidence Collection");
    const actions = res.body.roleDefinition.properties.permissions[0].actions;
    expect(actions).toContain("Microsoft.Storage/storageAccounts/read");
    expect(actions).toContain("Microsoft.Network/networkSecurityGroups/read");
    expect(actions).toContain("Microsoft.Security/pricings/read");
    expect(actions).toContain("Microsoft.Insights/diagnosticSettings/read");
  });

  test("is not accessible to CONTRIBUTOR", async () => {
    const company = await createCompany({ domain: "azuresetup2.com" });
    const contributor = await createUser(company.id, "CONTRIBUTOR");

    const res = await request(app).get("/api/integrations/azure/setup-info").set("Authorization", `Bearer ${contributor.token}`);
    expect(res.status).toBe(403);
  });
});

describe("GET /api/integrations/sophos/setup-info", () => {
  test("returns tenant-only read-only setup guidance", async () => {
    const company = await createCompany({ domain: "sophossetup1.com" });
    const admin = await createUser(company.id, "ADMIN");
    const res = await request(app).get("/api/integrations/sophos/setup-info").set("Authorization", `Bearer ${admin.token}`);
    expect(res.status).toBe(200);
    expect(res.body.steps).toHaveLength(4);
    expect(res.body.roleHint).toMatch(/tenant-level/i);
    expect(res.body.areas).toContain("DNS Protection");
  });

  test("is not accessible to CONTRIBUTOR", async () => {
    const company = await createCompany({ domain: "sophossetup2.com" });
    const contributor = await createUser(company.id, "CONTRIBUTOR");
    const res = await request(app).get("/api/integrations/sophos/setup-info").set("Authorization", `Bearer ${contributor.token}`);
    expect(res.status).toBe(403);
  });
});

describe("GET /api/integrations/acronis/setup-info", () => {
  test("returns a static instructional walkthrough, no live Acronis call needed", async () => {
    const company = await createCompany({ domain: "acronissetup1.com" });
    const admin = await createUser(company.id, "ADMIN");

    const res = await request(app).get("/api/integrations/acronis/setup-info").set("Authorization", `Bearer ${admin.token}`);

    expect(res.status).toBe(200);
    expect(Array.isArray(res.body.steps)).toBe(true);
    expect(res.body.modules.map((m) => m.module)).toContain("Alert manager");
    expect(res.body.datacenterUrlHint).toMatch(/acronis\.com/);
  });

  test("is not accessible to CONTRIBUTOR", async () => {
    const company = await createCompany({ domain: "acronissetup2.com" });
    const contributor = await createUser(company.id, "CONTRIBUTOR");

    const res = await request(app).get("/api/integrations/acronis/setup-info").set("Authorization", `Bearer ${contributor.token}`);
    expect(res.status).toBe(403);
  });
});

describe("GET /api/integrations/commvault/setup-info", () => {
  test("returns the Custom-scope access token setup with its apiEndpoints allowlist, no live Commvault call needed", async () => {
    const company = await createCompany({ domain: "commvaultsetup1.com" });
    const admin = await createUser(company.id, "ADMIN");

    const res = await request(app).get("/api/integrations/commvault/setup-info").set("Authorization", `Bearer ${admin.token}`);

    expect(res.status).toBe(200);
    expect(res.body.accessTokenSetup.tokenType).toBe(3);
    expect(res.body.accessTokenSetup.apiEndpoints).toEqual(
      expect.arrayContaining(["/Alerts", "/dashboard", "/StoragePolicy", "/v2/StoragePolicy"])
    );
    expect(res.body.webconsoleUrlHint).toMatch(/WebConsole/i);
  });

  test("is not accessible to CONTRIBUTOR", async () => {
    const company = await createCompany({ domain: "commvaultsetup2.com" });
    const contributor = await createUser(company.id, "CONTRIBUTOR");

    const res = await request(app).get("/api/integrations/commvault/setup-info").set("Authorization", `Bearer ${contributor.token}`);
    expect(res.status).toBe(403);
  });
});

describe("GET /api/integrations/akamai/setup-info", () => {
  test("returns the static scope + steps payload for ADMIN/LEAD", async () => {
    const company = await createCompany({ domain: "akamaisetup1.com" });
    const admin = await createUser(company.id, "ADMIN");

    const res = await request(app).get("/api/integrations/akamai/setup-info").set("Authorization", `Bearer ${admin.token}`);

    expect(res.status).toBe(200);
    expect(Array.isArray(res.body.scopes)).toBe(true);
    expect(res.body.scopes.length).toBe(4);
    expect(res.body.hostHint).toMatch(/akamaiapis\.net/);
    expect(Array.isArray(res.body.steps)).toBe(true);
  });

  test("is denied for a REVIEWER", async () => {
    const company = await createCompany({ domain: "akamaisetup2.com" });
    const reviewer = await createUser(company.id, "REVIEWER");

    const res = await request(app).get("/api/integrations/akamai/setup-info").set("Authorization", `Bearer ${reviewer.token}`);
    expect(res.status).toBe(403);
  });
});

describe("GET /api/integrations/carbonite/setup-info", () => {
  test("returns the API-key walkthrough and the Dashboard Service operations, no live call needed", async () => {
    const company = await createCompany({ domain: "carbonitesetup1.com" });
    const admin = await createUser(company.id, "ADMIN");

    const res = await request(app).get("/api/integrations/carbonite/setup-info").set("Authorization", `Bearer ${admin.token}`);

    expect(res.status).toBe(200);
    expect(res.body.operations.map((o) => o.operation)).toEqual(
      expect.arrayContaining(["GetDeviceList", "GetDashboardDeviceInfo"])
    );
    expect(res.body.dashboardHostHint).toMatch(/dashboard/i);
    expect(res.body.betaNote).toMatch(/beta/i);
  });

  test("is not accessible to CONTRIBUTOR", async () => {
    const company = await createCompany({ domain: "carbonitesetup2.com" });
    const contributor = await createUser(company.id, "CONTRIBUTOR");

    const res = await request(app).get("/api/integrations/carbonite/setup-info").set("Authorization", `Bearer ${contributor.token}`);
    expect(res.status).toBe(403);
  });
});

describe("GET /api/integrations/carbonite-server/setup-info", () => {
  test("returns the Keycloak access-level walkthrough recommending Reseller, no live call needed", async () => {
    const company = await createCompany({ domain: "carboniteserversetup1.com" });
    const admin = await createUser(company.id, "ADMIN");

    const res = await request(app).get("/api/integrations/carbonite-server/setup-info").set("Authorization", `Bearer ${admin.token}`);

    expect(res.status).toBe(200);
    expect(res.body.recommendedAccessLevel).toBe("Reseller");
    expect(res.body.accessLevels.map((a) => a.level)).toEqual(expect.arrayContaining(["Admin", "Partner", "Reseller"]));
    expect(res.body.apiDomainHint).toMatch(/Swagger/i);
    expect(res.body.keycloakRealmHint).toMatch(/realm/i);
  });

  test("is not accessible to CONTRIBUTOR", async () => {
    const company = await createCompany({ domain: "carboniteserversetup2.com" });
    const contributor = await createUser(company.id, "CONTRIBUTOR");

    const res = await request(app).get("/api/integrations/carbonite-server/setup-info").set("Authorization", `Bearer ${contributor.token}`);
    expect(res.status).toBe(403);
  });
});

describe("GET /api/integrations/purview/setup-info", () => {
  test("returns the two Purview RBAC roles and the three O365 Management API permissions, no live call needed", async () => {
    const company = await createCompany({ domain: "purviewsetup1.com" });
    const admin = await createUser(company.id, "ADMIN");

    const res = await request(app).get("/api/integrations/purview/setup-info").set("Authorization", `Bearer ${admin.token}`);

    expect(res.status).toBe(200);
    // Asserted against structural shape, not a brittle deep-equal, so wording
    // tweaks to PURVIEW_REQUIRED_PERMISSIONS (routes/integrations.js) don't
    // break this test — per task-0-research.md finding #2's correction that
    // Purview needs TWO distinct RBAC roles (Data Reader + Data Source
    // Administrator), not one.
    const permissions = res.body.permissions;
    expect(permissions.purviewRbacRoles).toHaveLength(2);
    expect(permissions.purviewRbacRoles.map((r) => r.roleName)).toEqual(
      expect.arrayContaining(["Data Reader", "Data Source Administrator"])
    );
    expect(permissions.office365ManagementApiPermissions.permissions).toEqual(
      expect.arrayContaining(["ActivityFeed.Read", "ActivityFeed.ReadDlp", "ServiceHealth.Read"])
    );
  });

  test("is not accessible to CONTRIBUTOR", async () => {
    const company = await createCompany({ domain: "purviewsetup2.com" });
    const contributor = await createUser(company.id, "CONTRIBUTOR");

    const res = await request(app).get("/api/integrations/purview/setup-info").set("Authorization", `Bearer ${contributor.token}`);
    expect(res.status).toBe(403);
  });
});

describe("GET /api/integrations/:id/github/setup-info", () => {
  test("returns a manifest scoped to this connection and a signed state token", async () => {
    const company = await createCompany({ domain: "githubsetup1.com" });
    const admin = await createUser(company.id, "ADMIN");
    const connResult = await query(
      `INSERT INTO integration_connections (company_id, integration_key, name) VALUES ($1, 'github', 'Prod GitHub') RETURNING *`,
      [company.id]
    );
    const connectionId = connResult.rows[0].id;

    const res = await request(app).get(`/api/integrations/${connectionId}/github/setup-info`).set("Authorization", `Bearer ${admin.token}`);

    expect(res.status).toBe(200);
    expect(res.body.manifest.public).toBe(false);
    expect(res.body.manifest.default_permissions).toEqual({
      organization_administration: "read",
      administration: "read",
      metadata: "read",
    });
    expect(res.body.manifest.hook_attributes.active).toBe(false);
    expect(res.body.manifest.setup_url).toBe(`http://localhost:4000/api/integrations/github/install-callback`);
    expect(typeof res.body.state).toBe("string");

    const decoded = verifyGithubAppState(res.body.state);
    expect(decoded).toEqual({ connectionId, companyId: company.id });
  });

  test("404s for a connection belonging to a different company", async () => {
    const companyA = await createCompany({ domain: "githubsetup2.com" });
    const companyB = await createCompany({ domain: "githubsetup3.com" });
    const adminB = await createUser(companyB.id, "ADMIN");
    const connResult = await query(
      `INSERT INTO integration_connections (company_id, integration_key, name) VALUES ($1, 'github', 'Not yours') RETURNING *`,
      [companyA.id]
    );

    const res = await request(app).get(`/api/integrations/${connResult.rows[0].id}/github/setup-info`).set("Authorization", `Bearer ${adminB.token}`);
    expect(res.status).toBe(404);
  });

  test("is not accessible to CONTRIBUTOR", async () => {
    const company = await createCompany({ domain: "githubsetup4.com" });
    const contributor = await createUser(company.id, "CONTRIBUTOR");
    const connResult = await query(
      `INSERT INTO integration_connections (company_id, integration_key, name) VALUES ($1, 'github', 'X') RETURNING *`,
      [company.id]
    );

    const res = await request(app).get(`/api/integrations/${connResult.rows[0].id}/github/setup-info`).set("Authorization", `Bearer ${contributor.token}`);
    expect(res.status).toBe(403);
  });

  // This route mints the `state` token that is the sole authorization for
  // manifest-callback (which revokes and replaces credentials) and
  // install-callback (which repoints config and connects) — an otherwise
  // read-only AUDITOR must not be able to mint that capability.
  test("is not accessible to AUDITOR", async () => {
    const company = await createCompany({ domain: "githubsetup5.com" });
    const auditor = await createUser(company.id, "AUDITOR");
    // An active, non-expired profile so the 403 below comes from this route's
    // role check, not from auth.js's separate "no auditor profile" guard.
    await query(
      `INSERT INTO auditor_profiles (user_id, company_id, active) VALUES ($1, $2, TRUE)`,
      [auditor.id, company.id]
    );
    const connResult = await query(
      `INSERT INTO integration_connections (company_id, integration_key, name) VALUES ($1, 'github', 'X') RETURNING *`,
      [company.id]
    );

    const res = await request(app).get(`/api/integrations/${connResult.rows[0].id}/github/setup-info`).set("Authorization", `Bearer ${auditor.token}`);
    expect(res.status).toBe(403);
  });
});

describe("GET /api/integrations/github/manifest-callback", () => {
  afterEach(() => { global.fetch = originalFetch; });

  test("exchanges the manifest code, stores the App credential, and redirects with an install link", async () => {
    const company = await createCompany({ domain: "githubcallback1.com" });
    const connResult = await query(
      `INSERT INTO integration_connections (company_id, integration_key, name) VALUES ($1, 'github', 'Prod GitHub') RETURNING *`,
      [company.id]
    );
    const connectionId = connResult.rows[0].id;
    const state = signGithubAppState({ connectionId, companyId: company.id });

    global.fetch = vi.fn(async (url) => {
      expect(url).toBe("https://api.github.com/app-manifests/temp-code-123/conversions");
      return {
        ok: true,
        json: async () => ({ id: 987654, pem: "-----BEGIN RSA PRIVATE KEY-----\nfake\n-----END RSA PRIVATE KEY-----", client_id: "Iv1.abc", client_secret: "shh", webhook_secret: "wh", slug: "prism-acme", html_url: "https://github.com/apps/prism-acme" }),
      };
    });

    const res = await request(app).get(`/api/integrations/github/manifest-callback?code=temp-code-123&state=${encodeURIComponent(state)}`);

    expect(res.status).toBe(302);
    expect(res.headers.location).toContain(`/settings/integrations/${connectionId}`);
    expect(res.headers.location).toContain("githubInstallUrl=");
    expect(decodeURIComponent(res.headers.location)).toContain("https://github.com/apps/prism-acme/installations/new");

    const credential = await getActiveCredential(connectionId, company.id);
    expect(credential.authType).toBe("oauth2");
    expect(credential.secret.appId).toBe("987654");
    expect(credential.secret.privateKey).toContain("BEGIN RSA PRIVATE KEY");
  });

  test("redirects with an error and touches no data when the state token is invalid", async () => {
    const res = await request(app).get(`/api/integrations/github/manifest-callback?code=whatever&state=not-a-real-token`);
    expect(res.status).toBe(302);
    expect(res.headers.location).toContain("githubError=");
  });

  test("redirects with an error when GitHub's code exchange fails", async () => {
    const company = await createCompany({ domain: "githubcallback2.com" });
    const connResult = await query(
      `INSERT INTO integration_connections (company_id, integration_key, name) VALUES ($1, 'github', 'Prod GitHub') RETURNING *`,
      [company.id]
    );
    const connectionId = connResult.rows[0].id;
    const state = signGithubAppState({ connectionId, companyId: company.id });

    global.fetch = vi.fn(async () => ({ ok: false, status: 404 }));

    const res = await request(app).get(`/api/integrations/github/manifest-callback?code=expired-code&state=${encodeURIComponent(state)}`);
    expect(res.status).toBe(302);
    expect(res.headers.location).toContain(`/settings/integrations/${connectionId}`);
    expect(res.headers.location).toContain("githubError=");

    const credential = await getActiveCredential(connectionId, company.id);
    expect(credential).toBeNull();
  });
});

describe("GET /api/integrations/github/install-callback", () => {
  afterEach(() => { global.fetch = originalFetch; });

  test("resolves the org from the installation, stores config, and connects", async () => {
    const company = await createCompany({ domain: "githubinstall1.com" });
    const connResult = await query(
      `INSERT INTO integration_connections (company_id, integration_key, name) VALUES ($1, 'github', 'Prod GitHub') RETURNING *`,
      [company.id]
    );
    const connectionId = connResult.rows[0].id;
    const state = signGithubAppState({ connectionId, companyId: company.id });
    await storeCredential({ connectionId, companyId: company.id, authType: "oauth2", secret: { appId: "987654", privateKey: "fake-pem" } });

    CONNECTOR_FIXTURES.github.testConnection.mockResolvedValueOnce({ ok: true, externalAccountId: "42424242" });

    const res = await request(app).get(`/api/integrations/github/install-callback?installation_id=555&state=${encodeURIComponent(state)}`);

    expect(res.status).toBe(302);
    expect(res.headers.location).toBe(`http://localhost:5173/settings/integrations/${connectionId}`);

    const updated = await query(`SELECT * FROM integration_connections WHERE id = $1`, [connectionId]);
    expect(updated.rows[0].status).toBe("connected");
    expect(updated.rows[0].config).toEqual({ installationId: 555, org: "acme-corp" });
    expect(updated.rows[0].external_account_id).toBe("42424242");
  });

  test("redirects with an error and does not connect when the state token is invalid", async () => {
    const res = await request(app).get(`/api/integrations/github/install-callback?installation_id=555&state=garbage`);
    expect(res.status).toBe(302);
    expect(res.headers.location).toContain("githubError=");
  });

  test("marks the connection as error when testConnection fails after install", async () => {
    const company = await createCompany({ domain: "githubinstall2.com" });
    const connResult = await query(
      `INSERT INTO integration_connections (company_id, integration_key, name) VALUES ($1, 'github', 'Prod GitHub') RETURNING *`,
      [company.id]
    );
    const connectionId = connResult.rows[0].id;
    const state = signGithubAppState({ connectionId, companyId: company.id });
    await storeCredential({ connectionId, companyId: company.id, authType: "oauth2", secret: { appId: "987654", privateKey: "fake-pem" } });

    CONNECTOR_FIXTURES.github.testConnection.mockRejectedValueOnce(new Error("installation has no repositories"));

    const res = await request(app).get(`/api/integrations/github/install-callback?installation_id=555&state=${encodeURIComponent(state)}`);
    expect(res.status).toBe(302);
    expect(res.headers.location).toContain("githubError=installation%20has%20no%20repositories");

    const updated = await query(`SELECT status FROM integration_connections WHERE id = $1`, [connectionId]);
    expect(updated.rows[0].status).toBe("error");
  });
});

describe("GET /api/integrations/catalog", () => {
  test("lists available connector types", async () => {
    const company = await createCompany({ domain: "catalog1.com" });
    const admin = await createUser(company.id, "ADMIN");

    const res = await request(app).get("/api/integrations/catalog").set("Authorization", `Bearer ${admin.token}`);

    expect(res.status).toBe(200);
    expect(res.body.length).toBeGreaterThanOrEqual(1);
    const aws = res.body.find(c => c.key === "aws");
    expect(aws).toBeDefined();
    expect(aws.authType).toBe("iam_role");
    expect(aws.status).toBe("active");

    const purview = res.body.find(c => c.key === "purview");
    expect(purview).toBeDefined();
    expect(purview.authType).toBe("oauth2");
    expect(purview.status).toBe("active");

    // 'purview_compliance' is seeded with status 'coming_soon' — the route's
    // `WHERE status != 'coming_soon'` filter (routes/integrations.js) must
    // exclude it from the catalog entirely.
    expect(res.body.find(c => c.key === "purview_compliance")).toBeUndefined();
  });

  test("is readable by LEAD but not by CONTRIBUTOR", async () => {
    const company = await createCompany({ domain: "catalog2.com" });
    const lead = await createUser(company.id, "LEAD");
    const contributor = await createUser(company.id, "CONTRIBUTOR");

    const leadRes = await request(app).get("/api/integrations/catalog").set("Authorization", `Bearer ${lead.token}`);
    expect(leadRes.status).toBe(200);

    const contributorRes = await request(app).get("/api/integrations/catalog").set("Authorization", `Bearer ${contributor.token}`);
    expect(contributorRes.status).toBe(403);
  });
});

describe("POST /api/integrations", () => {
  test("ADMIN can create a pending connection", async () => {
    const company = await createCompany();
    const admin = await createUser(company.id, "ADMIN");

    const res = await request(app)
      .post("/api/integrations")
      .set("Authorization", `Bearer ${admin.token}`)
      .send({ integrationKey: "aws", name: "Prod AWS", config: { roleArn: "arn:aws:iam::123:role/PrismReadOnly", region: "us-east-1" } });

    expect(res.status).toBe(201);
    expect(res.body.status).toBe("pending");
  });

  test("REVIEWER is forbidden", async () => {
    const company = await createCompany();
    const reviewer = await createUser(company.id, "REVIEWER");
    const res = await request(app)
      .post("/api/integrations")
      .set("Authorization", `Bearer ${reviewer.token}`)
      .send({ integrationKey: "aws", name: "Prod AWS" });
    expect(res.status).toBe(403);
  });
});

describe("POST /api/integrations/:id/credentials", () => {
  test("stores a credential and marks the connection connected", async () => {
    const company = await createCompany();
    const admin = await createUser(company.id, "ADMIN");
    const conn = await query(
      `INSERT INTO integration_connections (company_id, integration_key, name, config) VALUES ($1, 'aws', 'Prod AWS', $2) RETURNING *`,
      [company.id, JSON.stringify({ roleArn: "arn:aws:iam::123:role/PrismReadOnly" })]
    );

    const res = await request(app)
      .post(`/api/integrations/${conn.rows[0].id}/credentials`)
      .set("Authorization", `Bearer ${admin.token}`)
      .send({ authType: "iam_role", secret: { externalId: "ext-1" } });

    expect(res.status).toBe(200);
    expect(res.body.status).toBe("connected");
    expect(res.body.externalAccountId).toBe("123456789012");

    const credRows = await query(`SELECT ciphertext FROM integration_credentials WHERE connection_id = $1`, [conn.rows[0].id]);
    expect(credRows.rows[0].ciphertext).not.toContain("ext-1");
  });

  test("rotating credentials revokes the previously stored one", async () => {
    const company = await createCompany();
    const admin = await createUser(company.id, "ADMIN");
    const conn = await query(
      `INSERT INTO integration_connections (company_id, integration_key, name, config) VALUES ($1, 'aws', 'Prod AWS', $2) RETURNING *`,
      [company.id, JSON.stringify({ roleArn: "arn:aws:iam::123:role/PrismReadOnly" })]
    );

    await request(app)
      .post(`/api/integrations/${conn.rows[0].id}/credentials`)
      .set("Authorization", `Bearer ${admin.token}`)
      .send({ authType: "iam_role", secret: { externalId: "ext-1" } });

    const res = await request(app)
      .post(`/api/integrations/${conn.rows[0].id}/credentials`)
      .set("Authorization", `Bearer ${admin.token}`)
      .send({ authType: "iam_role", secret: { externalId: "ext-2" } });

    expect(res.status).toBe(200);

    const credRows = await query(
      `SELECT ciphertext, revoked_at FROM integration_credentials WHERE connection_id = $1 ORDER BY created_at ASC`,
      [conn.rows[0].id]
    );
    expect(credRows.rows.length).toBe(2);
    expect(credRows.rows[0].revoked_at).not.toBeNull();
    expect(credRows.rows[0].ciphertext).toBeNull();
    expect(credRows.rows[1].revoked_at).toBeNull();
    expect(credRows.rows[1].ciphertext).not.toBeNull();
  });
});

describe("POST /api/integrations/:id/run", () => {
  test("runs a collection and returns a summary", async () => {
    const company = await createCompany();
    const admin = await createUser(company.id, "ADMIN");
    const conn = await query(
      `INSERT INTO integration_connections (company_id, integration_key, name) VALUES ($1, 'aws', 'Prod AWS') RETURNING *`,
      [company.id]
    );
    await request(app)
      .post(`/api/integrations/${conn.rows[0].id}/credentials`)
      .set("Authorization", `Bearer ${admin.token}`)
      .send({ authType: "iam_role", secret: { externalId: "ext-1" } });

    const res = await request(app)
      .post(`/api/integrations/${conn.rows[0].id}/run`)
      .set("Authorization", `Bearer ${admin.token}`);

    expect(res.status).toBe(200);
    expect(res.body.testsPassed).toBe(1);
  });

  // Full create -> credentials -> run flow for Purview specifically, since
  // it's a new oauth2-authType connector (config shaped as
  // { tenantId, purviewAccountName } rather than AWS's iam_role config) —
  // confirms it flows through the same connector-agnostic pipe as aws/github
  // with no new logic required.
  test("Purview: connects via oauth2 credentials and runs a collection", async () => {
    const company = await createCompany({ domain: "purviewrun1.com" });
    const admin = await createUser(company.id, "ADMIN");
    const conn = await query(
      `INSERT INTO integration_connections (company_id, integration_key, name, config) VALUES ($1, 'purview', 'Prod Purview', $2) RETURNING *`,
      [company.id, JSON.stringify({ tenantId: "tenant-abc", purviewAccountName: "my-purview-account" })]
    );

    const credsRes = await request(app)
      .post(`/api/integrations/${conn.rows[0].id}/credentials`)
      .set("Authorization", `Bearer ${admin.token}`)
      .send({ authType: "oauth2", secret: { clientId: "client-abc", clientSecret: "shh" } });

    expect(credsRes.status).toBe(200);
    expect(credsRes.body.status).toBe("connected");
    expect(credsRes.body.externalAccountId).toBe("my-purview-account");

    const runRes = await request(app)
      .post(`/api/integrations/${conn.rows[0].id}/run`)
      .set("Authorization", `Bearer ${admin.token}`);

    expect(runRes.status).toBe(200);
    expect(runRes.body.testsPassed).toBe(1);
    expect(runRes.body.testsFailed).toBe(0);
  });

  // Full create -> credentials -> run flow for Acronis: a second oauth2-authType
  // connector coexisting with Azure, config shaped as { datacenterUrl }. Confirms
  // it flows through the same connector-agnostic pipe with no new logic.
  test("Acronis: connects via oauth2 credentials and runs a collection", async () => {
    const company = await createCompany({ domain: "acronisrun1.com" });
    const admin = await createUser(company.id, "ADMIN");
    const conn = await query(
      `INSERT INTO integration_connections (company_id, integration_key, name, config) VALUES ($1, 'acronis', 'Prod Acronis', $2) RETURNING *`,
      [company.id, JSON.stringify({ datacenterUrl: "https://us5-cloud.acronis.com" })]
    );

    const credsRes = await request(app)
      .post(`/api/integrations/${conn.rows[0].id}/credentials`)
      .set("Authorization", `Bearer ${admin.token}`)
      .send({ authType: "oauth2", secret: { clientId: "client-abc", clientSecret: "shh" } });

    expect(credsRes.status).toBe(200);
    expect(credsRes.body.status).toBe("connected");
    expect(credsRes.body.externalAccountId).toBe("TENANT-123");

    const runRes = await request(app)
      .post(`/api/integrations/${conn.rows[0].id}/run`)
      .set("Authorization", `Bearer ${admin.token}`);

    expect(runRes.status).toBe(200);
    expect(runRes.body.testsPassed).toBe(1);
    expect(runRes.body.testsFailed).toBe(0);
  });

  test("Sophos: connects with tenant OAuth2 credentials and runs a collection", async () => {
    const company = await createCompany({ domain: "sophosrun1.com" });
    const admin = await createUser(company.id, "ADMIN");
    const conn = await query(
      `INSERT INTO integration_connections (company_id, integration_key, name, config) VALUES ($1, 'sophos', 'Prod Sophos', '{}') RETURNING *`,
      [company.id]
    );

    const credsRes = await request(app)
      .post(`/api/integrations/${conn.rows[0].id}/credentials`)
      .set("Authorization", `Bearer ${admin.token}`)
      .send({ authType: "oauth2", secret: { clientId: "client-abc", clientSecret: "shh" } });

    expect(credsRes.status).toBe(200);
    expect(credsRes.body.status).toBe("connected");
    expect(credsRes.body.externalAccountId).toBe("tenant-sophos-1");

    const runRes = await request(app)
      .post(`/api/integrations/${conn.rows[0].id}/run`)
      .set("Authorization", `Bearer ${admin.token}`);

    expect(runRes.status).toBe(200);
    expect(runRes.body.testsPassed).toBe(1);
    expect(runRes.body.testsFailed).toBe(0);
  });

  // Full create -> credentials -> run flow for Commvault: the first api_key-authType
  // connector whose config carries a URL ({ webconsoleUrl }) and whose secret is an
  // opaque access token ({ accessToken }). Confirms it flows through the same
  // connector-agnostic pipe with no new logic.
  test("Commvault: connects via api_key credentials and runs a collection", async () => {
    const company = await createCompany({ domain: "commvaultrun1.com" });
    const admin = await createUser(company.id, "ADMIN");
    const conn = await query(
      `INSERT INTO integration_connections (company_id, integration_key, name, config) VALUES ($1, 'commvault', 'Prod Commvault', $2) RETURNING *`,
      [company.id, JSON.stringify({ webconsoleUrl: "https://commvault.example.com" })]
    );

    const credsRes = await request(app)
      .post(`/api/integrations/${conn.rows[0].id}/credentials`)
      .set("Authorization", `Bearer ${admin.token}`)
      .send({ authType: "api_key", secret: { accessToken: "tok-abc123" } });

    expect(credsRes.status).toBe(200);
    expect(credsRes.body.status).toBe("connected");
    expect(credsRes.body.externalAccountId).toBe("commvault.example.com");

    const runRes = await request(app)
      .post(`/api/integrations/${conn.rows[0].id}/run`)
      .set("Authorization", `Bearer ${admin.token}`);

    expect(runRes.status).toBe(200);
    expect(runRes.body.testsPassed).toBe(1);
    expect(runRes.body.testsFailed).toBe(0);
  });

  // Full create -> credentials -> run flow for Carbonite Core Endpoint Backup:
  // an api_key connector whose config is { dashboardHost } and whose secret is
  // { email, apiKey } (two-field). Confirms the connector-agnostic pipe handles
  // a SOAP-backed connector with no new logic.
  test("Carbonite Core Endpoint Backup: connects via api_key credentials and runs a collection", async () => {
    const company = await createCompany({ domain: "carboniterun1.com" });
    const admin = await createUser(company.id, "ADMIN");
    const conn = await query(
      `INSERT INTO integration_connections (company_id, integration_key, name, config) VALUES ($1, 'carbonite', 'Prod Carbonite', $2) RETURNING *`,
      [company.id, JSON.stringify({ dashboardHost: "dashboard.carbonite.com" })]
    );

    const credsRes = await request(app)
      .post(`/api/integrations/${conn.rows[0].id}/credentials`)
      .set("Authorization", `Bearer ${admin.token}`)
      .send({ authType: "api_key", secret: { email: "admin@acme.com", apiKey: "key-abc123" } });

    expect(credsRes.status).toBe(200);
    expect(credsRes.body.status).toBe("connected");
    expect(credsRes.body.externalAccountId).toBe("dashboard.carbonite.com");

    const runRes = await request(app)
      .post(`/api/integrations/${conn.rows[0].id}/run`)
      .set("Authorization", `Bearer ${admin.token}`);

    expect(runRes.status).toBe(200);
    expect(runRes.body.testsPassed).toBe(0);
    expect(runRes.body.testsFailed).toBe(1);
  });

  // Full create -> credentials -> run flow for Carbonite Server Backup: an
  // oauth2-authType connector whose config carries { apiDomain, keycloakRealm }
  // and whose secret is a Keycloak client pair ({ clientId, clientSecret }) —
  // a third distinct oauth2 config shape (after Azure's and Acronis's). Confirms
  // it flows through the same connector-agnostic pipe with no new logic.
  test("Carbonite Server Backup: connects via oauth2 credentials and runs a collection", async () => {
    const company = await createCompany({ domain: "carboniteserverrun1.com" });
    const admin = await createUser(company.id, "ADMIN");
    const conn = await query(
      `INSERT INTO integration_connections (company_id, integration_key, name, config) VALUES ($1, 'carbonite-server', 'Prod Carbonite Server', $2) RETURNING *`,
      [company.id, JSON.stringify({ apiDomain: "backup.example.com", keycloakRealm: "carbonite" })]
    );

    const credsRes = await request(app)
      .post(`/api/integrations/${conn.rows[0].id}/credentials`)
      .set("Authorization", `Bearer ${admin.token}`)
      .send({ authType: "oauth2", secret: { clientId: "prism-reader", clientSecret: "s3cr3t" } });

    expect(credsRes.status).toBe(200);
    expect(credsRes.body.status).toBe("connected");
    expect(credsRes.body.externalAccountId).toBe("backup.example.com");

    const runRes = await request(app)
      .post(`/api/integrations/${conn.rows[0].id}/run`)
      .set("Authorization", `Bearer ${admin.token}`);

    expect(runRes.status).toBe(200);
    expect(runRes.body.testsPassed).toBe(0);
    expect(runRes.body.testsFailed).toBe(1);
  });

  // runCollection() (utils/collectionRunner.js) throws an Error with .status = 409
  // when a run is already in progress for the connection (enforced by the
  // evidence_collection_runs_running_uq partial unique index in init.sql). The
  // route's catch must forward that .status rather than flattening every
  // failure to 400, so API clients can tell "already running" apart from a
  // generic bad request.
  test("returns 409 (not 400) when a collection is already running for the connection", async () => {
    const company = await createCompany({ domain: "runconflict1.com" });
    const admin = await createUser(company.id, "ADMIN");
    const conn = await query(
      `INSERT INTO integration_connections (company_id, integration_key, name) VALUES ($1, 'aws', 'Prod AWS') RETURNING *`,
      [company.id]
    );
    await request(app)
      .post(`/api/integrations/${conn.rows[0].id}/credentials`)
      .set("Authorization", `Bearer ${admin.token}`)
      .send({ authType: "iam_role", secret: { externalId: "ext-1" } });

    // Seed an in-progress run directly so the unique partial index rejects the
    // route's own INSERT with a 23505, which runCollection() turns into the
    // 409 error.
    await query(
      `INSERT INTO evidence_collection_runs (company_id, connection_id, trigger_type, status) VALUES ($1, $2, 'manual', 'running')`,
      [company.id, conn.rows[0].id]
    );

    const res = await request(app)
      .post(`/api/integrations/${conn.rows[0].id}/run`)
      .set("Authorization", `Bearer ${admin.token}`);

    expect(res.status).toBe(409);
    expect(res.body.error).toMatch(/already in progress/i);
  });

  // A plain Error (no .status set) — e.g. no active credential — must still
  // fall back to 400, confirming the err.status forwarding fix didn't change
  // the default for ordinary failures.
  test("still returns 400 for a run failure with no .status (no active credential)", async () => {
    const company = await createCompany({ domain: "runconflict2.com" });
    const admin = await createUser(company.id, "ADMIN");
    const conn = await query(
      `INSERT INTO integration_connections (company_id, integration_key, name) VALUES ($1, 'aws', 'Prod AWS') RETURNING *`,
      [company.id]
    );

    const res = await request(app)
      .post(`/api/integrations/${conn.rows[0].id}/run`)
      .set("Authorization", `Bearer ${admin.token}`);

    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/no active credential/i);
  });
});

describe("GET /api/integrations", () => {
  test("excludes revoked connections from the list", async () => {
    const company = await createCompany({ domain: "listexcl.com" });
    const admin = await createUser(company.id, "ADMIN");
    await query(
      `INSERT INTO integration_connections (company_id, integration_key, name, status) VALUES ($1, 'aws', 'Active AWS', 'connected')`,
      [company.id]
    );
    await query(
      `INSERT INTO integration_connections (company_id, integration_key, name, status) VALUES ($1, 'aws', 'Old AWS', 'revoked')`,
      [company.id]
    );

    const res = await request(app)
      .get("/api/integrations")
      .set("Authorization", `Bearer ${admin.token}`);

    expect(res.status).toBe(200);
    expect(res.body.length).toBe(1);
    expect(res.body[0].name).toBe("Active AWS");
  });
});

describe("DELETE /api/integrations/:id", () => {
  test("hard-deletes a connection stuck in error status, cascading its credential", async () => {
    const company = await createCompany();
    const admin = await createUser(company.id, "ADMIN");
    // Seeded directly as 'error' — this file's registry mock makes
    // testConnection always succeed, so the only reliable way to exercise
    // the error-status branch is to set the status directly, same as the
    // 'connected' case below.
    const conn = await query(
      `INSERT INTO integration_connections (company_id, integration_key, name, status) VALUES ($1, 'aws', 'Prod AWS', 'error') RETURNING *`,
      [company.id]
    );
    await query(
      `INSERT INTO integration_credentials (connection_id, company_id, auth_type, ciphertext, iv, auth_tag) VALUES ($1, $2, 'iam_role', 'ct', 'iv', 'tag')`,
      [conn.rows[0].id, company.id]
    );

    const res = await request(app)
      .delete(`/api/integrations/${conn.rows[0].id}`)
      .set("Authorization", `Bearer ${admin.token}`);
    expect(res.status).toBe(204);

    const connRows = await query(`SELECT id FROM integration_connections WHERE id = $1`, [conn.rows[0].id]);
    expect(connRows.rowCount).toBe(0);
    const credRows = await query(`SELECT id FROM integration_credentials WHERE connection_id = $1`, [conn.rows[0].id]);
    expect(credRows.rowCount).toBe(0);
  });

  test("soft-revokes a connected connection and crypto-shreds its credential, keeping the row", async () => {
    const company = await createCompany({ domain: "revokeconnected.com" });
    const admin = await createUser(company.id, "ADMIN");
    const conn = await query(
      `INSERT INTO integration_connections (company_id, integration_key, name, status) VALUES ($1, 'aws', 'Prod AWS', 'connected') RETURNING *`,
      [company.id]
    );
    await query(
      `INSERT INTO integration_credentials (connection_id, company_id, auth_type, ciphertext, iv, auth_tag) VALUES ($1, $2, 'iam_role', 'ct', 'iv', 'tag')`,
      [conn.rows[0].id, company.id]
    );

    const res = await request(app)
      .delete(`/api/integrations/${conn.rows[0].id}`)
      .set("Authorization", `Bearer ${admin.token}`);
    expect(res.status).toBe(204);

    const connRows = await query(`SELECT status FROM integration_connections WHERE id = $1`, [conn.rows[0].id]);
    expect(connRows.rows[0].status).toBe("revoked");
    const credRows = await query(`SELECT ciphertext FROM integration_credentials WHERE connection_id = $1`, [conn.rows[0].id]);
    expect(credRows.rows[0].ciphertext).toBeNull();
  });

  test("company B cannot revoke company A's connection", async () => {
    const companyA = await createCompany({ domain: "a.com" });
    const companyB = await createCompany({ domain: "b.com" });
    const adminB = await createUser(companyB.id, "ADMIN");
    const conn = await query(
      `INSERT INTO integration_connections (company_id, integration_key, name) VALUES ($1, 'aws', 'Prod AWS') RETURNING *`,
      [companyA.id]
    );

    const res = await request(app)
      .delete(`/api/integrations/${conn.rows[0].id}`)
      .set("Authorization", `Bearer ${adminB.token}`);
    expect(res.status).toBe(404);
  });
});

describe("GET /api/integrations/:id", () => {
  test("reflects the connection's actual stored auth_type, not the catalog default", async () => {
    const company = await createCompany({ domain: "connauth1.com" });
    const admin = await createUser(company.id, "ADMIN");
    const conn = await query(
      `INSERT INTO integration_connections (company_id, integration_key, name) VALUES ($1, 'aws', 'Prod AWS') RETURNING *`,
      [company.id]
    );

    await request(app)
      .post(`/api/integrations/${conn.rows[0].id}/credentials`)
      .set("Authorization", `Bearer ${admin.token}`)
      .send({ authType: "access_key", secret: { accessKeyId: "AKIA123", secretAccessKey: "shh" } });

    const res = await request(app)
      .get(`/api/integrations/${conn.rows[0].id}`)
      .set("Authorization", `Bearer ${admin.token}`);

    expect(res.status).toBe(200);
    expect(res.body.authType).toBe("access_key");
  });

  test("reflects the new auth_type after rotating to a different one", async () => {
    const company = await createCompany({ domain: "connauth2.com" });
    const admin = await createUser(company.id, "ADMIN");
    const conn = await query(
      `INSERT INTO integration_connections (company_id, integration_key, name) VALUES ($1, 'aws', 'Prod AWS') RETURNING *`,
      [company.id]
    );

    await request(app)
      .post(`/api/integrations/${conn.rows[0].id}/credentials`)
      .set("Authorization", `Bearer ${admin.token}`)
      .send({ authType: "iam_role", secret: { externalId: "ext-1" } });
    await request(app)
      .post(`/api/integrations/${conn.rows[0].id}/credentials`)
      .set("Authorization", `Bearer ${admin.token}`)
      .send({ authType: "access_key", secret: { accessKeyId: "AKIA123", secretAccessKey: "shh" } });

    const res = await request(app)
      .get(`/api/integrations/${conn.rows[0].id}`)
      .set("Authorization", `Bearer ${admin.token}`);

    expect(res.status).toBe(200);
    expect(res.body.authType).toBe("access_key");
  });

  test("returns a null auth_type when no credential has been stored yet", async () => {
    const company = await createCompany({ domain: "connauth3.com" });
    const admin = await createUser(company.id, "ADMIN");
    const conn = await query(
      `INSERT INTO integration_connections (company_id, integration_key, name) VALUES ($1, 'aws', 'Prod AWS') RETURNING *`,
      [company.id]
    );

    const res = await request(app)
      .get(`/api/integrations/${conn.rows[0].id}`)
      .set("Authorization", `Bearer ${admin.token}`);

    expect(res.status).toBe(200);
    expect(res.body.authType).toBeNull();
  });
});

describe("PATCH /api/integrations/:id/schedule", () => {
  test("updates the collection frequency and auto-collect flag, returning the updated connection", async () => {
    const company = await createCompany({ domain: "schedule1.com" });
    const admin = await createUser(company.id, "ADMIN");
    const conn = await query(
      `INSERT INTO integration_connections (company_id, integration_key, name) VALUES ($1, 'aws', 'Prod AWS') RETURNING *`,
      [company.id]
    );

    const res = await request(app)
      .patch(`/api/integrations/${conn.rows[0].id}/schedule`)
      .set("Authorization", `Bearer ${admin.token}`)
      .send({ collectionFrequencyHours: 12, autoCollectEnabled: false });

    expect(res.status).toBe(200);
    expect(res.body.collectionFrequencyHours).toBe(12);
    expect(res.body.autoCollectEnabled).toBe(false);

    const updated = await query(`SELECT collection_frequency_hours, auto_collect_enabled FROM integration_connections WHERE id = $1`, [conn.rows[0].id]);
    expect(updated.rows[0].collection_frequency_hours).toBe(12);
    expect(updated.rows[0].auto_collect_enabled).toBe(false);
  });

  // The audit trail is itself a customer-facing feature of this compliance
  // product, so a cadence/auto-collect change must not happen silently — same
  // discipline as CONNECTION_CREATED/CREDENTIAL_STORED/CONNECTION_DELETED
  // elsewhere in this file.
  test("writes a CONNECTION_SCHEDULE_UPDATED audit log entry", async () => {
    const company = await createCompany({ domain: "scheduleaudit1.com" });
    const admin = await createUser(company.id, "ADMIN");
    const conn = await query(
      `INSERT INTO integration_connections (company_id, integration_key, name) VALUES ($1, 'aws', 'Prod AWS') RETURNING *`,
      [company.id]
    );

    const res = await request(app)
      .patch(`/api/integrations/${conn.rows[0].id}/schedule`)
      .set("Authorization", `Bearer ${admin.token}`)
      .send({ collectionFrequencyHours: 6, autoCollectEnabled: true });

    expect(res.status).toBe(200);

    const logs = await query(
      `SELECT * FROM audit_logs WHERE company_id = $1 AND action = 'CONNECTION_SCHEDULE_UPDATED'`,
      [company.id]
    );
    expect(logs.rows.length).toBe(1);
    expect(logs.rows[0].user_id).toBe(admin.id);
    expect(logs.rows[0].resource).toBe("integration_connections");
    expect(logs.rows[0].detail).toEqual({ connectionId: conn.rows[0].id, collectionFrequencyHours: 6, autoCollectEnabled: true });
  });

  test.each([
    ["zero", 0],
    ["negative", -5],
    ["non-integer", 3.5],
    ["non-numeric", "daily"],
    ["missing", undefined],
  ])("rejects a %s collectionFrequencyHours with 400", async (_label, value) => {
    const company = await createCompany({ domain: `schedulebad-${_label}.com` });
    const admin = await createUser(company.id, "ADMIN");
    const conn = await query(
      `INSERT INTO integration_connections (company_id, integration_key, name) VALUES ($1, 'aws', 'Prod AWS') RETURNING *`,
      [company.id]
    );

    const res = await request(app)
      .patch(`/api/integrations/${conn.rows[0].id}/schedule`)
      .set("Authorization", `Bearer ${admin.token}`)
      .send({ collectionFrequencyHours: value, autoCollectEnabled: true });

    expect(res.status).toBe(400);
  });

  test("404s for a connection belonging to a different company", async () => {
    const companyA = await createCompany({ domain: "schedulea.com" });
    const companyB = await createCompany({ domain: "scheduleb.com" });
    const adminB = await createUser(companyB.id, "ADMIN");
    const conn = await query(
      `INSERT INTO integration_connections (company_id, integration_key, name) VALUES ($1, 'aws', 'Not yours') RETURNING *`,
      [companyA.id]
    );

    const res = await request(app)
      .patch(`/api/integrations/${conn.rows[0].id}/schedule`)
      .set("Authorization", `Bearer ${adminB.token}`)
      .send({ collectionFrequencyHours: 6, autoCollectEnabled: true });

    expect(res.status).toBe(404);
  });

  test("is not accessible to CONTRIBUTOR", async () => {
    const company = await createCompany({ domain: "schedulec.com" });
    const contributor = await createUser(company.id, "CONTRIBUTOR");
    const conn = await query(
      `INSERT INTO integration_connections (company_id, integration_key, name) VALUES ($1, 'aws', 'Prod AWS') RETURNING *`,
      [company.id]
    );

    const res = await request(app)
      .patch(`/api/integrations/${conn.rows[0].id}/schedule`)
      .set("Authorization", `Bearer ${contributor.token}`)
      .send({ collectionFrequencyHours: 6, autoCollectEnabled: true });

    expect(res.status).toBe(403);
  });
});

describe("GET /api/integrations/:id/runs", () => {
  test("lists collection runs for a connection, newest first", async () => {
    const company = await createCompany({ domain: "runs1.com" });
    const admin = await createUser(company.id, "ADMIN");
    const connRes = await query(
      `INSERT INTO integration_connections (company_id, integration_key, name) VALUES ($1, 'aws', 'Prod AWS') RETURNING *`,
      [company.id]
    );
    const connectionId = connRes.rows[0].id;
    await query(
      `INSERT INTO evidence_collection_runs (company_id, connection_id, trigger_type, status, tests_run, tests_passed, tests_failed, started_at, finished_at)
       VALUES ($1, $2, 'manual', 'success', 7, 7, 0, NOW() - interval '2 hours', NOW() - interval '1 hour 55 minutes')`,
      [company.id, connectionId]
    );
    await query(
      `INSERT INTO evidence_collection_runs (company_id, connection_id, trigger_type, status, tests_run, tests_passed, tests_failed, started_at, finished_at)
       VALUES ($1, $2, 'manual', 'partial_failure', 7, 5, 2, NOW() - interval '1 hour', NOW() - interval '55 minutes')`,
      [company.id, connectionId]
    );

    const res = await request(app).get(`/api/integrations/${connectionId}/runs`).set("Authorization", `Bearer ${admin.token}`);

    expect(res.status).toBe(200);
    expect(res.body.length).toBe(2);
    expect(res.body[0].status).toBe("partial_failure");
    expect(res.body[1].status).toBe("success");
  });

  test("returns 404 for a connection belonging to a different company", async () => {
    const companyA = await createCompany({ domain: "runs2a.com" });
    const companyB = await createCompany({ domain: "runs2b.com" });
    const connRes = await query(
      `INSERT INTO integration_connections (company_id, integration_key, name) VALUES ($1, 'aws', 'Prod AWS') RETURNING *`,
      [companyA.id]
    );
    const adminB = await createUser(companyB.id, "ADMIN");

    const res = await request(app).get(`/api/integrations/${connRes.rows[0].id}/runs`).set("Authorization", `Bearer ${adminB.token}`);
    expect(res.status).toBe(404);
  });

  test("respects a limit query param", async () => {
    const company = await createCompany({ domain: "runs3.com" });
    const admin = await createUser(company.id, "ADMIN");
    const connRes = await query(
      `INSERT INTO integration_connections (company_id, integration_key, name) VALUES ($1, 'aws', 'Prod AWS') RETURNING *`,
      [company.id]
    );
    const connectionId = connRes.rows[0].id;
    for (let i = 0; i < 3; i++) {
      await query(
        `INSERT INTO evidence_collection_runs (company_id, connection_id, trigger_type, status, tests_run, tests_passed, tests_failed, started_at)
         VALUES ($1, $2, 'manual', 'success', 7, 7, 0, NOW() - ($3 || ' minutes')::interval)`,
        [company.id, connectionId, String(i)]
      );
    }

    const res = await request(app).get(`/api/integrations/${connectionId}/runs?limit=2`).set("Authorization", `Bearer ${admin.token}`);
    expect(res.status).toBe(200);
    expect(res.body.length).toBe(2);
  });
});
