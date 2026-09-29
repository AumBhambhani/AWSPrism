import { describe, test, expect, vi, beforeEach } from "vitest";
import { workdriveTests } from "../connectors/zoho/tests/workdrive.js";
import { mailTests } from "../connectors/zoho/tests/mail.js";

const [extSharingTest, linkPasswordTest, activityLogTest] = workdriveTests;
const [forwardingTest, mailTfaTest, spamFilterTest] = mailTests;

function makeClients(products = {}) {
  return {
    orgId: "60012345",
    workdrive: { get: vi.fn() },
    mail: { get: vi.fn() },
    ...products,
  };
}

beforeEach(() => vi.clearAllMocks());

// ── WorkDrive ────────────────────────────────────────────────────────────────

describe("zoho.workdrive.external_sharing_restricted", () => {
  test("returns pass when allow_external_sharing is false", async () => {
    const clients = makeClients();
    clients.workdrive.get.mockResolvedValueOnce({ data: { attributes: { allow_external_sharing: false } } });
    const results = await extSharingTest.run(clients);
    expect(results[0].status).toBe("pass");
  });

  test("returns pass when external_sharing_requires_approval is true", async () => {
    const clients = makeClients();
    clients.workdrive.get.mockResolvedValueOnce({ attributes: { external_sharing_requires_approval: true } });
    const results = await extSharingTest.run(clients);
    expect(results[0].status).toBe("pass");
  });

  test("returns fail when external sharing is unrestricted", async () => {
    const clients = makeClients();
    clients.workdrive.get.mockResolvedValueOnce({ attributes: { allow_external_sharing: true } });
    const results = await extSharingTest.run(clients);
    expect(results[0].status).toBe("fail");
  });
});

describe("zoho.workdrive.link_sharing_password_protected", () => {
  test("returns pass when both password and expiry are required", async () => {
    const clients = makeClients();
    clients.workdrive.get.mockResolvedValueOnce({
      data: { attributes: { require_link_password: true, require_link_expiry: true } },
    });
    const results = await linkPasswordTest.run(clients);
    expect(results[0].status).toBe("pass");
  });

  test("returns fail when password is required but expiry is not", async () => {
    const clients = makeClients();
    clients.workdrive.get.mockResolvedValueOnce({
      data: { attributes: { require_link_password: true, require_link_expiry: false } },
    });
    const results = await linkPasswordTest.run(clients);
    expect(results[0].status).toBe("fail");
  });

  test("returns fail when neither is required", async () => {
    const clients = makeClients();
    clients.workdrive.get.mockResolvedValueOnce({ data: { attributes: {} } });
    const results = await linkPasswordTest.run(clients);
    expect(results[0].status).toBe("fail");
  });
});

describe("zoho.workdrive.admin_activity_log_enabled", () => {
  test("returns pass when status is enabled", async () => {
    const clients = makeClients();
    clients.workdrive.get.mockResolvedValueOnce({ data: { attributes: { status: "enabled" } } });
    const results = await activityLogTest.run(clients);
    expect(results[0].status).toBe("pass");
  });

  test("returns fail when status is not enabled", async () => {
    const clients = makeClients();
    clients.workdrive.get.mockResolvedValueOnce({ data: { attributes: { status: "disabled" } } });
    const results = await activityLogTest.run(clients);
    expect(results[0].status).toBe("fail");
  });
});

// ── Mail ─────────────────────────────────────────────────────────────────────

describe("zoho.mail.forwarding_restricted", () => {
  test("returns pass when blockExternalForwarding is true", async () => {
    const clients = makeClients();
    clients.mail.get.mockResolvedValueOnce({ data: { policySettings: { blockExternalForwarding: true } } });
    const results = await forwardingTest.run(clients);
    expect(results[0].status).toBe("pass");
  });

  test("returns pass when block_auto_forward is true (alternate field)", async () => {
    const clients = makeClients();
    clients.mail.get.mockResolvedValueOnce({ block_auto_forward: true });
    const results = await forwardingTest.run(clients);
    expect(results[0].status).toBe("pass");
  });

  test("returns fail when no restriction signals are present", async () => {
    const clients = makeClients();
    clients.mail.get.mockResolvedValueOnce({ data: { policySettings: {} } });
    const results = await forwardingTest.run(clients);
    expect(results[0].status).toBe("fail");
  });
});

describe("zoho.mail.two_factor_auth_enforced", () => {
  test("returns pass when isTFAEnforced is true", async () => {
    const clients = makeClients();
    clients.mail.get.mockResolvedValueOnce({ data: { isTFAEnforced: true } });
    const results = await mailTfaTest.run(clients);
    expect(results[0].status).toBe("pass");
  });

  test("returns fail when TFA is not enforced", async () => {
    const clients = makeClients();
    clients.mail.get.mockResolvedValueOnce({ data: { isTFAEnforced: false } });
    const results = await mailTfaTest.run(clients);
    expect(results[0].status).toBe("fail");
  });
});

describe("zoho.mail.spam_phishing_filters_enabled", () => {
  test("returns pass when both spam and phishing filters are enabled", async () => {
    const clients = makeClients();
    clients.mail.get.mockResolvedValueOnce({ data: { spamFilterEnabled: true, phishingFilterEnabled: true } });
    const results = await spamFilterTest.run(clients);
    expect(results[0].status).toBe("pass");
  });

  test("returns fail when only spam filter is enabled", async () => {
    const clients = makeClients();
    clients.mail.get.mockResolvedValueOnce({ data: { spamFilterEnabled: true, phishingFilterEnabled: false } });
    const results = await spamFilterTest.run(clients);
    expect(results[0].status).toBe("fail");
  });

  test("returns fail when both are disabled", async () => {
    const clients = makeClients();
    clients.mail.get.mockResolvedValueOnce({ data: {} });
    const results = await spamFilterTest.run(clients);
    expect(results[0].status).toBe("fail");
  });
});
