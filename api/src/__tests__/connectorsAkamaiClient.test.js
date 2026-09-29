import { describe, test, expect, vi, afterEach } from "vitest";
import { akamaiClient } from "../connectors/akamai/client.js";

function fakeCreds(overrides = {}) {
  return { host: "akab-abc.luna.akamaiapis.net", accountSwitchKey: null, sign: () => "EG1-HMAC-SHA256 test", ...overrides };
}

afterEach(() => vi.unstubAllGlobals());

describe("akamaiClient.get", () => {
  test("signs the request, targets https://{host}{path}, and returns parsed JSON", async () => {
    const fetchMock = vi.fn(async () => ({ ok: true, status: 200, json: async () => ({ hi: 1 }), headers: new Headers() }));
    vi.stubGlobal("fetch", fetchMock);
    const c = akamaiClient(fakeCreds());
    const body = await c.get("/papi/v1/contracts");
    expect(body).toEqual({ hi: 1 });
    const [url, opts] = fetchMock.mock.calls[0];
    expect(url).toBe("https://akab-abc.luna.akamaiapis.net/papi/v1/contracts");
    expect(opts.headers.Authorization).toBe("EG1-HMAC-SHA256 test");
  });

  test("appends accountSwitchKey when present", async () => {
    const fetchMock = vi.fn(async () => ({ ok: true, status: 200, json: async () => ({}), headers: new Headers() }));
    vi.stubGlobal("fetch", fetchMock);
    const c = akamaiClient(fakeCreds({ accountSwitchKey: "1-ABC:1-DEF" }));
    await c.get("/appsec/v1/configs");
    expect(fetchMock.mock.calls[0][0]).toBe("https://akab-abc.luna.akamaiapis.net/appsec/v1/configs?accountSwitchKey=1-ABC%3A1-DEF");
  });

  test("sends a CPS versioned Accept header when asked", async () => {
    const fetchMock = vi.fn(async () => ({ ok: true, status: 200, json: async () => ({}), headers: new Headers() }));
    vi.stubGlobal("fetch", fetchMock);
    const c = akamaiClient(fakeCreds());
    await c.get("/cps/v2/enrollments?contractId=C-1", { accept: "application/vnd.akamai.cps.enrollments.v11+json" });
    expect(fetchMock.mock.calls[0][1].headers.Accept).toBe("application/vnd.akamai.cps.enrollments.v11+json");
  });

  test("retries once on 429 honouring Retry-After, then succeeds", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce({ ok: false, status: 429, text: async () => "slow down", headers: new Headers({ "Retry-After": "0" }) })
      .mockResolvedValueOnce({ ok: true, status: 200, json: async () => ({ ok: true }), headers: new Headers() });
    vi.stubGlobal("fetch", fetchMock);
    const c = akamaiClient(fakeCreds());
    await expect(c.get("/appsec/v1/configs")).resolves.toEqual({ ok: true });
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  test("describeAkamaiError maps 401 to a signing/clock hint and 403 to a scope hint", async () => {
    const c = akamaiClient(fakeCreds());
    expect(c.describeAkamaiError(new Error("Akamai GET /x failed: 401 unauthorized"))).toMatch(/signing|clock|host/i);
    expect(c.describeAkamaiError(new Error("Akamai GET /x failed: 403 forbidden"))).toMatch(/scope|permission/i);
  });
});

describe("akamaiClient discovery helpers", () => {
  test("resolveActiveConfig picks the production-active version, falling back to latest", async () => {
    const responses = {
      "/appsec/v1/configs/5/versions": { versionList: [{ version: 7 }, { version: 8 }] },
      "/appsec/v1/configs/5/activations": {
        activationHistory: [
          { network: "STAGING", status: "ACTIVATED", version: 8 },
          { network: "PRODUCTION", status: "ACTIVATED", version: 7 },
        ],
      },
    };
    const fetchMock = vi.fn(async (url) => {
      const path = new URL(url).pathname;
      return { ok: true, status: 200, json: async () => responses[path] ?? {}, headers: new Headers() };
    });
    vi.stubGlobal("fetch", fetchMock);
    const c = akamaiClient(fakeCreds());
    const active = await c.resolveActiveConfig(5);
    expect(active).toEqual({ configId: 5, productionVersion: 7, latestVersion: 8 });
  });
});
