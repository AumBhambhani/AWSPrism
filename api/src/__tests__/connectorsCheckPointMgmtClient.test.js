import { afterEach, describe, expect, test, vi } from "vitest";
import { checkPointMgmtClient } from "../connectors/check_point_mgmt/client.js";

afterEach(() => vi.restoreAllMocks());

describe("Check Point Management client", () => {
  test("opens a read-only session and sends X-chkp-sid on subsequent commands", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch")
      .mockResolvedValueOnce({ ok: true, status: 200, text: async () => JSON.stringify({ sid: "SID1", "api-server-version": "1.9" }) })
      .mockResolvedValueOnce({ ok: true, status: 200, text: async () => JSON.stringify({ packages: [{ name: "Standard" }] }) });
    const api = checkPointMgmtClient({ mgmtOrigin: "https://mgmt.example.com" });
    const session = await api.openSession({ apiKey: "k", domain: "Corp" });
    expect(session.sid).toBe("SID1");
    const loginBody = JSON.parse(fetchMock.mock.calls[0][1].body);
    expect(loginBody).toMatchObject({ "api-key": "k", "read-only": true, domain: "Corp" });
    await session.post("show-packages", {});
    expect(fetchMock.mock.calls[1][0]).toBe("https://mgmt.example.com/web_api/show-packages");
    expect(fetchMock.mock.calls[1][1].headers["X-chkp-sid"]).toBe("SID1");
  });

  test("throws a descriptive error including the command on a non-2xx response", async () => {
    vi.spyOn(globalThis, "fetch")
      .mockResolvedValueOnce({ ok: true, status: 200, text: async () => JSON.stringify({ sid: "SID1" }) })
      .mockResolvedValueOnce({ ok: false, status: 403, text: async () => JSON.stringify({ message: "no permissions", code: "generic_err_no_permissions" }) });
    const api = checkPointMgmtClient({ mgmtOrigin: "https://mgmt.example.com" });
    const session = await api.openSession({ apiKey: "k" });
    await expect(session.post("show-access-rulebase", {})).rejects.toThrow(/show-access-rulebase failed: HTTP 403/);
  });

  test("paginate walks limit/offset until `to` reaches `total`", async () => {
    vi.spyOn(globalThis, "fetch")
      .mockResolvedValueOnce({ ok: true, status: 200, text: async () => JSON.stringify({ sid: "S" }) })
      .mockResolvedValueOnce({ ok: true, status: 200, text: async () => JSON.stringify({ objects: [{ uid: "a" }], total: 2, to: 1 }) })
      .mockResolvedValueOnce({ ok: true, status: 200, text: async () => JSON.stringify({ objects: [{ uid: "b" }], total: 2, to: 2 }) });
    const api = checkPointMgmtClient({ mgmtOrigin: "https://mgmt.example.com" });
    const session = await api.openSession({ apiKey: "k" });
    await expect(session.paginate("show-hosts", {}, ["objects"])).resolves.toEqual([{ uid: "a" }, { uid: "b" }]);
  });
});
