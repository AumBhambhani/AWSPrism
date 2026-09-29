import { describe, test, expect, vi, beforeEach } from "vitest";
import { projectsTests } from "../connectors/zoho/tests/projects.js";
import { creatorTests } from "../connectors/zoho/tests/creator.js";
import { recruitTests } from "../connectors/zoho/tests/recruit.js";

const [externalUserTest, clientPortalTest, rolePermTest] = projectsTests;
const [appPermTest, publicFormTest, delugeTest] = creatorTests;
const [candidateAccessTest, retentionPolicyTest, jobVisibilityTest] = recruitTests;

function makeClients() {
  return {
    orgId: "60012345",
    projects: { get: vi.fn() },
    creator: { get: vi.fn() },
    recruit: { get: vi.fn() },
  };
}

beforeEach(() => vi.clearAllMocks());

// ── Projects ──────────────────────────────────────────────────────────────────

describe("zoho.projects.external_user_review", () => {
  test("returns pass when no external users have portal-wide access", async () => {
    const clients = makeClients();
    clients.projects.get.mockResolvedValueOnce({
      users: [{ id: "u1", email: "client@partner.com", access: "specific_projects" }],
    });
    const results = await externalUserTest.run(clients);
    expect(results[0].status).toBe("pass");
  });

  test("returns fail for client users with all_projects access", async () => {
    const clients = makeClients();
    clients.projects.get.mockResolvedValueOnce({
      users: [{ id: "u1", email: "client@partner.com", access: "all_projects" }],
    });
    const results = await externalUserTest.run(clients);
    expect(results[0].status).toBe("fail");
    expect(results[0].resourceId).toBe("u1");
  });

  test("returns pass when client user list is empty", async () => {
    const clients = makeClients();
    clients.projects.get.mockResolvedValueOnce({ users: [] });
    const results = await externalUserTest.run(clients);
    expect(results[0].status).toBe("pass");
  });
});

describe("zoho.projects.client_portal_access_restricted", () => {
  test("returns pass when no projects expose all-client portal", async () => {
    const clients = makeClients();
    clients.projects.get.mockResolvedValueOnce({
      projects: [{ id: "p1", name: "Project A", client_portal: "specific_clients" }],
    });
    const results = await clientPortalTest.run(clients);
    expect(results[0].status).toBe("pass");
  });

  test("returns fail for project with all_clients portal setting", async () => {
    const clients = makeClients();
    clients.projects.get.mockResolvedValueOnce({
      projects: [{ id: "p1", name: "Project A", client_portal: "all_clients" }],
    });
    const results = await clientPortalTest.run(clients);
    expect(results[0].status).toBe("fail");
    expect(results[0].resourceId).toBe("p1");
  });
});

describe("zoho.projects.role_based_permissions_enforced", () => {
  test("returns pass when projects have mixed roles", async () => {
    const clients = makeClients();
    clients.projects.get
      // projects list
      .mockResolvedValueOnce({ projects: [{ id: "p1", name: "Project A" }] })
      // users of project p1: one manager, one employee
      .mockResolvedValueOnce({ users: [{ role: "manager" }, { role: "employee" }] });
    const results = await rolePermTest.run(clients);
    expect(results[0].status).toBe("pass");
  });

  test("returns fail when all users in a project are managers", async () => {
    const clients = makeClients();
    clients.projects.get
      .mockResolvedValueOnce({ projects: [{ id: "p1", name: "Project A" }] })
      .mockResolvedValueOnce({ users: [{ role: "manager" }, { role: "manager" }] });
    const results = await rolePermTest.run(clients);
    expect(results[0].status).toBe("fail");
  });

  test("returns pass when project list is empty", async () => {
    const clients = makeClients();
    clients.projects.get.mockResolvedValueOnce({ projects: [] });
    const results = await rolePermTest.run(clients);
    expect(results[0].status).toBe("pass");
  });
});

// ── Creator ───────────────────────────────────────────────────────────────────

describe("zoho.creator.app_permission_review", () => {
  test("returns pass when all apps have <= 5 admin/developer users", async () => {
    const clients = makeClients();
    clients.creator.get.mockResolvedValueOnce({
      applications: [{ link_name: "app1", application_name: "MyApp", developerCount: 2, adminCount: 1 }],
    });
    const results = await appPermTest.run(clients);
    expect(results[0].status).toBe("pass");
  });

  test("returns fail for app with > 5 developer users", async () => {
    const clients = makeClients();
    clients.creator.get.mockResolvedValueOnce({
      applications: [{ link_name: "app1", application_name: "MyApp", developerCount: 8, adminCount: 1 }],
    });
    const results = await appPermTest.run(clients);
    expect(results[0].status).toBe("fail");
  });
});

describe("zoho.creator.public_form_data_exposure", () => {
  test("returns pass when no apps have public forms", async () => {
    const clients = makeClients();
    clients.creator.get.mockResolvedValueOnce({
      applications: [{ link_name: "app1", application_name: "MyApp", hasPublicForms: false }],
    });
    const results = await publicFormTest.run(clients);
    expect(results[0].status).toBe("pass");
  });

  test("returns fail for app with public forms", async () => {
    const clients = makeClients();
    clients.creator.get.mockResolvedValueOnce({
      applications: [{ link_name: "app1", application_name: "MyApp", hasPublicForms: true }],
    });
    const results = await publicFormTest.run(clients);
    expect(results[0].status).toBe("fail");
  });
});

describe("zoho.creator.deluge_script_access_review", () => {
  test("returns pass when developer count per app is <= 5", async () => {
    const clients = makeClients();
    clients.creator.get.mockResolvedValueOnce({
      applications: [{ link_name: "app1", application_name: "MyApp", developerCount: 3 }],
    });
    const results = await delugeTest.run(clients);
    expect(results[0].status).toBe("pass");
  });

  test("returns fail when developer count exceeds 5", async () => {
    const clients = makeClients();
    clients.creator.get.mockResolvedValueOnce({
      applications: [{ link_name: "app1", application_name: "MyApp", developerCount: 10 }],
    });
    const results = await delugeTest.run(clients);
    expect(results[0].status).toBe("fail");
  });
});

// ── Recruit ───────────────────────────────────────────────────────────────────

describe("zoho.recruit.candidate_data_access_review", () => {
  test("returns pass when no Public_ReadWrite sharing rules exist for Candidates", async () => {
    const clients = makeClients();
    clients.recruit.get.mockResolvedValueOnce({
      data: [{ id: "r1", module: "Candidates", access: "Private" }],
    });
    const results = await candidateAccessTest.run(clients);
    expect(results[0].status).toBe("pass");
  });

  test("returns fail for a Public_ReadWrite candidate sharing rule", async () => {
    const clients = makeClients();
    clients.recruit.get.mockResolvedValueOnce({
      data: [{ id: "r1", module: "Candidates", access: "Public_ReadWrite" }],
    });
    const results = await candidateAccessTest.run(clients);
    expect(results[0].status).toBe("fail");
    expect(results[0].resourceId).toBe("r1");
  });

  test("returns pass when sharing rules list is empty", async () => {
    const clients = makeClients();
    clients.recruit.get.mockResolvedValueOnce({ data: [] });
    const results = await candidateAccessTest.run(clients);
    expect(results[0].status).toBe("pass");
  });
});

describe("zoho.recruit.data_retention_policy_configured", () => {
  test("returns pass when data_retention_enabled is true", async () => {
    const clients = makeClients();
    clients.recruit.get.mockResolvedValueOnce({ settings: { data_retention_enabled: true } });
    const results = await retentionPolicyTest.run(clients);
    expect(results[0].status).toBe("pass");
  });

  test("returns fail when no retention policy is configured", async () => {
    const clients = makeClients();
    clients.recruit.get.mockResolvedValueOnce({ settings: {} });
    const results = await retentionPolicyTest.run(clients);
    expect(results[0].status).toBe("fail");
  });
});

describe("zoho.recruit.job_posting_visibility_review", () => {
  test("returns pass when no job openings have mismatched visibility", async () => {
    const clients = makeClients();
    clients.recruit.get.mockResolvedValueOnce({
      data: [{ id: "j1", Job_Opening_Name: "SWE", Job_Status: "Open", Publish_Status: "Internal" }],
    });
    const results = await jobVisibilityTest.run(clients);
    expect(results[0].status).toBe("pass");
  });

  test("returns fail when an in-review posting is published externally", async () => {
    const clients = makeClients();
    clients.recruit.get.mockResolvedValueOnce({
      data: [{ id: "j1", Job_Opening_Name: "SWE", Job_Status: "In-review", Publish_Status: "External" }],
    });
    const results = await jobVisibilityTest.run(clients);
    expect(results[0].status).toBe("fail");
    expect(results[0].resourceId).toBe("j1");
  });

  test("returns pass when the job openings list is empty", async () => {
    const clients = makeClients();
    clients.recruit.get.mockResolvedValueOnce({ data: [] });
    const results = await jobVisibilityTest.run(clients);
    expect(results[0].status).toBe("pass");
  });
});
