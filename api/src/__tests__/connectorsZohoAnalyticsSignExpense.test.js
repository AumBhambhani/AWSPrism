import { describe, test, expect, vi, beforeEach } from "vitest";
import { analyticsTests } from "../connectors/zoho/tests/analytics.js";
import { signTests } from "../connectors/zoho/tests/sign.js";
import { expenseTests } from "../connectors/zoho/tests/expense.js";

const [dataSharingTest, publicLinkTest, workspacePermTest] = analyticsTests;
const [auditTrailTest, templateAccessTest, retentionTest] = signTests;
const [approvalTest, receiptRetentionTest, cardMaskingTest] = expenseTests;

function makeClients() {
  return {
    orgId: "60012345",
    analytics: { get: vi.fn() },
    sign: { get: vi.fn() },
    expense: { get: vi.fn() },
  };
}

beforeEach(() => vi.clearAllMocks());

// ── Analytics ────────────────────────────────────────────────────────────────

describe("zoho.analytics.data_sharing_review", () => {
  test("returns pass when no workspaces are org-wide shared", async () => {
    const clients = makeClients();
    clients.analytics.get.mockResolvedValueOnce({
      data: { workspaces: [{ id: "w1", name: "Sales", shareType: "team" }] },
    });
    const results = await dataSharingTest.run(clients);
    expect(results[0].status).toBe("pass");
  });

  test("returns fail for each org_wide shared workspace", async () => {
    const clients = makeClients();
    clients.analytics.get.mockResolvedValueOnce({
      workspaces: [{ id: "w1", name: "Revenue", shareType: "org_wide" }],
    });
    const results = await dataSharingTest.run(clients);
    expect(results[0].status).toBe("fail");
    expect(results[0].resourceId).toBe("w1");
  });

  test("returns pass when workspace list is empty", async () => {
    const clients = makeClients();
    clients.analytics.get.mockResolvedValueOnce({ workspaces: [] });
    const results = await dataSharingTest.run(clients);
    expect(results[0].status).toBe("pass");
  });
});

describe("zoho.analytics.public_view_link_restricted", () => {
  test("returns pass when no workspaces have public links", async () => {
    const clients = makeClients();
    clients.analytics.get.mockResolvedValueOnce({ data: { workspaces: [{ id: "w1", name: "Sales", hasPublicLink: false }] } });
    const results = await publicLinkTest.run(clients);
    expect(results[0].status).toBe("pass");
  });

  test("returns fail for workspace with a public link", async () => {
    const clients = makeClients();
    clients.analytics.get.mockResolvedValueOnce({ workspaces: [{ id: "w1", name: "Revenue", hasPublicLink: true }] });
    const results = await publicLinkTest.run(clients);
    expect(results[0].status).toBe("fail");
    expect(results[0].resourceId).toBe("w1");
  });
});

describe("zoho.analytics.workspace_permission_review", () => {
  test("returns pass when all workspaces have <= 5 admins", async () => {
    const clients = makeClients();
    clients.analytics.get.mockResolvedValueOnce({ workspaces: [{ id: "w1", name: "Sales", adminCount: 3 }] });
    const results = await workspacePermTest.run(clients);
    expect(results[0].status).toBe("pass");
  });

  test("returns fail for workspace exceeding admin threshold", async () => {
    const clients = makeClients();
    clients.analytics.get.mockResolvedValueOnce({ workspaces: [{ id: "w1", name: "Data", adminCount: 8 }] });
    const results = await workspacePermTest.run(clients);
    expect(results[0].status).toBe("fail");
  });
});

// ── Sign ──────────────────────────────────────────────────────────────────────

describe("zoho.sign.audit_trail_enabled", () => {
  test("returns pass when includeAuditTrail is true", async () => {
    const clients = makeClients();
    clients.sign.get.mockResolvedValueOnce({ settings: { includeAuditTrail: true } });
    const results = await auditTrailTest.run(clients);
    expect(results[0].status).toBe("pass");
  });

  test("returns fail when audit trail is not configured", async () => {
    const clients = makeClients();
    clients.sign.get.mockResolvedValueOnce({ settings: {} });
    const results = await auditTrailTest.run(clients);
    expect(results[0].status).toBe("fail");
  });
});

describe("zoho.sign.template_access_restricted", () => {
  test("returns pass when no templates are org-wide shared", async () => {
    const clients = makeClients();
    clients.sign.get.mockResolvedValueOnce({ templates: { list: [{ template_id: "t1", template_name: "NDA", sharedWith: "team" }] } });
    const results = await templateAccessTest.run(clients);
    expect(results[0].status).toBe("pass");
  });

  test("returns fail for org-wide shared template", async () => {
    const clients = makeClients();
    clients.sign.get.mockResolvedValueOnce({ templates: { list: [{ template_id: "t1", template_name: "NDA", sharedWith: "org" }] } });
    const results = await templateAccessTest.run(clients);
    expect(results[0].status).toBe("fail");
  });

  test("returns pass when template list is empty", async () => {
    const clients = makeClients();
    clients.sign.get.mockResolvedValueOnce({ templates: { list: [] } });
    const results = await templateAccessTest.run(clients);
    expect(results[0].status).toBe("pass");
  });
});

describe("zoho.sign.completed_document_retention", () => {
  test("returns pass when auto-delete is not enabled", async () => {
    const clients = makeClients();
    clients.sign.get.mockResolvedValueOnce({ settings: { autoDelete: false } });
    const results = await retentionTest.run(clients);
    expect(results[0].status).toBe("pass");
  });

  test("returns pass when auto-delete is on but retention is 7+ years", async () => {
    const clients = makeClients();
    clients.sign.get.mockResolvedValueOnce({ settings: { autoDelete: true, retentionDays: 3650 } });
    const results = await retentionTest.run(clients);
    expect(results[0].status).toBe("pass");
  });

  test("returns fail when auto-delete is on with short retention", async () => {
    const clients = makeClients();
    clients.sign.get.mockResolvedValueOnce({ settings: { autoDelete: true, retentionDays: 365 } });
    const results = await retentionTest.run(clients);
    expect(results[0].status).toBe("fail");
  });
});

// ── Expense ───────────────────────────────────────────────────────────────────

describe("zoho.expense.approval_policy_enforced", () => {
  test("returns pass when self-approval is blocked", async () => {
    const clients = makeClients();
    clients.expense.get.mockResolvedValueOnce({ approval_policy: { allowSelfApproval: false } });
    const results = await approvalTest.run(clients);
    expect(results[0].status).toBe("pass");
  });

  test("returns fail when allowSelfApproval is not explicitly false", async () => {
    const clients = makeClients();
    clients.expense.get.mockResolvedValueOnce({ approval_policy: {} });
    const results = await approvalTest.run(clients);
    expect(results[0].status).toBe("fail");
  });
});

describe("zoho.expense.receipt_data_retention", () => {
  test("returns pass when auto-delete is disabled", async () => {
    const clients = makeClients();
    clients.expense.get.mockResolvedValueOnce({ settings: { auto_delete_data: false } });
    const results = await receiptRetentionTest.run(clients);
    expect(results[0].status).toBe("pass");
  });

  test("returns fail when auto-delete is enabled with short retention", async () => {
    const clients = makeClients();
    clients.expense.get.mockResolvedValueOnce({ settings: { auto_delete_data: true, data_retention_days: 365 } });
    const results = await receiptRetentionTest.run(clients);
    expect(results[0].status).toBe("fail");
  });
});

describe("zoho.expense.card_data_masking", () => {
  test("returns pass when maskCardNumbers is true", async () => {
    const clients = makeClients();
    clients.expense.get.mockResolvedValueOnce({ settings: { maskCardNumbers: true } });
    const results = await cardMaskingTest.run(clients);
    expect(results[0].status).toBe("pass");
  });

  test("returns pass when show_full_card_number is false (alternate field)", async () => {
    const clients = makeClients();
    clients.expense.get.mockResolvedValueOnce({ settings: { show_full_card_number: false } });
    const results = await cardMaskingTest.run(clients);
    expect(results[0].status).toBe("pass");
  });

  test("returns fail when masking is not configured", async () => {
    const clients = makeClients();
    clients.expense.get.mockResolvedValueOnce({ settings: {} });
    const results = await cardMaskingTest.run(clients);
    expect(results[0].status).toBe("fail");
  });
});
