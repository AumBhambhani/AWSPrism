import { describe, test, expect, vi, beforeEach, afterEach } from "vitest";
import { directoryTests } from "../connectors/zoho/tests/directory.js";

const [mfaTest, ssoTest, inactiveTest] = directoryTests;

function makeClients(overrides = {}) {
  return {
    orgId: "60012345",
    directory: {
      get: vi.fn(),
    },
    ...overrides,
  };
}

beforeEach(() => vi.clearAllMocks());

describe("zoho.directory.mfa_enforced", () => {
  test("returns pass when mfa_enabled is true", async () => {
    const clients = makeClients();
    clients.directory.get.mockResolvedValueOnce({ mfa_enabled: true });
    const results = await mfaTest.run(clients);
    expect(results).toHaveLength(1);
    expect(results[0].status).toBe("pass");
    expect(results[0].resourceId).toBe("60012345");
  });

  test("returns pass when mfa_required is true (alternate field name)", async () => {
    const clients = makeClients();
    clients.directory.get.mockResolvedValueOnce({ mfa_required: true });
    const results = await mfaTest.run(clients);
    expect(results[0].status).toBe("pass");
  });

  test("returns fail when neither mfa flag is set", async () => {
    const clients = makeClients();
    clients.directory.get.mockResolvedValueOnce({ mfa_enabled: false, mfa_required: false });
    const results = await mfaTest.run(clients);
    expect(results[0].status).toBe("fail");
  });
});

describe("zoho.directory.sso_enforced", () => {
  test("returns pass when both sso_enabled and sso_required are true", async () => {
    const clients = makeClients();
    clients.directory.get.mockResolvedValueOnce({ sso_enabled: true, sso_required: true });
    const results = await ssoTest.run(clients);
    expect(results[0].status).toBe("pass");
  });

  test("returns fail when sso_enabled is true but sso_required is false", async () => {
    const clients = makeClients();
    clients.directory.get.mockResolvedValueOnce({ sso_enabled: true, sso_required: false });
    const results = await ssoTest.run(clients);
    expect(results[0].status).toBe("fail");
  });

  test("returns fail when sso_enabled is false", async () => {
    const clients = makeClients();
    clients.directory.get.mockResolvedValueOnce({ sso_enabled: false, sso_required: true });
    const results = await ssoTest.run(clients);
    expect(results[0].status).toBe("fail");
  });
});

describe("zoho.directory.inactive_user_review", () => {
  const STALE_LOGIN = new Date(Date.now() - 91 * 24 * 60 * 60 * 1000).toISOString();
  const RECENT_LOGIN = new Date(Date.now() - 10 * 24 * 60 * 60 * 1000).toISOString();

  test("returns fail for each user inactive 90+ days", async () => {
    const clients = makeClients();
    clients.directory.get.mockResolvedValueOnce({
      users: [
        { user_id: "u1", email: "alice@example.com", last_login_time: STALE_LOGIN, status: "active" },
        { user_id: "u2", email: "bob@example.com", last_login_time: RECENT_LOGIN, status: "active" },
      ],
    });
    const results = await inactiveTest.run(clients);
    expect(results).toHaveLength(1);
    expect(results[0].status).toBe("fail");
    expect(results[0].resourceId).toBe("u1");
  });

  test("returns a single pass when no users are inactive", async () => {
    const clients = makeClients();
    clients.directory.get.mockResolvedValueOnce({
      users: [{ user_id: "u1", email: "alice@example.com", last_login_time: RECENT_LOGIN, status: "active" }],
    });
    const results = await inactiveTest.run(clients);
    expect(results).toHaveLength(1);
    expect(results[0].status).toBe("pass");
    expect(results[0].resourceId).toBe("60012345");
  });

  test("returns pass when user list is empty", async () => {
    const clients = makeClients();
    clients.directory.get.mockResolvedValueOnce({ users: [] });
    const results = await inactiveTest.run(clients);
    expect(results[0].status).toBe("pass");
  });
});
