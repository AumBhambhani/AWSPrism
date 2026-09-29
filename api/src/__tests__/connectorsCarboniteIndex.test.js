import { describe, test, expect, vi, beforeEach } from "vitest";

const { testConnection, runTests, tests, describeCarboniteError } = await import(
  "../connectors/carbonite/index.js"
);

const BASE = {
  authType: "api_key",
  config: { dashboardHost: "dashboard.carbonite.com" },
  secret: { email: "admin@acme.com", apiKey: "key-abc123" },
};

const hoursAgo = (h) => new Date(Date.now() - h * 3_600_000).toISOString();

const env = (bodyInner) =>
  `<s:Envelope xmlns:s="http://schemas.xmlsoap.org/soap/envelope/"><s:Body>${bodyInner}</s:Body></s:Envelope>`;

const deviceListXml = (devices) =>
  env(
    `<GetDeviceListResponse xmlns="http://tempuri.org/"><GetDeviceListResult><Status>Completed</Status><DeviceList>` +
      devices.map((d) => `<DeviceInfo><DeviceId>${d.id}</DeviceId><DeviceName>${d.name}</DeviceName><State>${d.state}</State></DeviceInfo>`).join("") +
      `</DeviceList></GetDeviceListResult></GetDeviceListResponse>`
  );

const deviceInfoXml = (infos) =>
  env(
    `<GetDashboardDeviceInfoResponse xmlns="http://tempuri.org/"><GetDashboardDeviceInfoResult><Status>Completed</Status>` +
      infos.map((d) => `<DeviceInfo><DeviceId>${d.id}</DeviceId><LastCompleteBackupUtc>${d.last}</LastCompleteBackupUtc></DeviceInfo>`).join("") +
      `</GetDashboardDeviceInfoResult></GetDashboardDeviceInfoResponse>`
  );

function stubSoap(handler) {
  vi.stubGlobal("fetch", vi.fn(async (url, opts) => {
    const op = String(opts.body).match(/<(\w+) xmlns="http:\/\/tempuri\.org\/">/)?.[1];
    return handler(op);
  }));
}

const ok = (xml) => ({ ok: true, status: 200, text: async () => xml });
const httpErr = (status, xml = "") => ({ ok: false, status, text: async () => xml });

const HEALTHY = (op) => {
  if (op === "GetDeviceList") return ok(deviceListXml([{ id: "d1", name: "laptop-1", state: "Active" }]));
  if (op === "GetDashboardDeviceInfo") return ok(deviceInfoXml([{ id: "d1", last: hoursAgo(3) }]));
  throw new Error(`unexpected op ${op}`);
};

beforeEach(() => vi.unstubAllGlobals());

describe("tests array", () => {
  test("exports exactly 2 checks, both in the backup area", () => {
    expect(tests).toHaveLength(2);
    expect(tests.map((t) => t.key).sort()).toEqual([
      "carbonite.backup.device_coverage",
      "carbonite.backup.recent_successful_backup",
    ]);
  });

  test("every check has key, title, failTitle, severityDefault, isoReferences, dpdpaControlAreas, run", () => {
    for (const t of tests) {
      expect(t.key.startsWith("carbonite.")).toBe(true);
      expect(t.failTitle).not.toBe(t.title);
      expect(["critical", "high", "medium", "low"]).toContain(t.severityDefault);
      expect(Array.isArray(t.isoReferences) && t.isoReferences.length).toBeTruthy();
      expect(Array.isArray(t.dpdpaControlAreas) && t.dpdpaControlAreas.length).toBeTruthy();
      expect(typeof t.run).toBe("function");
    }
  });
});

describe("testConnection", () => {
  test("probes GetDeviceList and returns the dashboard host as externalAccountId", async () => {
    stubSoap(HEALTHY);
    expect(await testConnection(BASE)).toEqual({ ok: true, externalAccountId: "dashboard.carbonite.com" });
  });

  test("maps a SOAP InvalidCredentials to API-key guidance", async () => {
    stubSoap(() => ok(env(`<GetDeviceListResponse xmlns="http://tempuri.org/"><GetDeviceListResult><Status>InvalidCredentials</Status></GetDeviceListResult></GetDeviceListResponse>`)));
    await expect(testConnection(BASE)).rejects.toThrow(/Regenerate a read-only-scoped API key/);
  });

  test("maps a bare HTTP 500 with no body to a beta wire-format hint", async () => {
    stubSoap(() => httpErr(500, ""));
    await expect(testConnection(BASE)).rejects.toThrow(/HTTP 500/);
  });
});

describe("runTests — healthy tenant", () => {
  test("produces a row for every check, none error, title/failTitle/severity propagate", async () => {
    stubSoap(HEALTHY);
    const results = await runTests(BASE);
    const seen = new Set(results.map((r) => r.testKey));
    for (const t of tests) expect(seen.has(t.key)).toBe(true);
    for (const r of results) {
      expect(r.status).not.toBe("error");
      const def = tests.find((t) => t.key === r.testKey);
      expect(r.title).toBe(def.title);
      expect(r.failTitle).toBe(def.failTitle);
      expect(r.severity).toBe(def.severityDefault);
    }
  });
});

describe("runTests — findings", () => {
  test("flags a stale backup and a suspended device", async () => {
    stubSoap((op) => {
      if (op === "GetDeviceList") return ok(deviceListXml([{ id: "d1", name: "laptop-1", state: "Suspended" }]));
      if (op === "GetDashboardDeviceInfo") return ok(deviceInfoXml([{ id: "d1", last: hoursAgo(300) }]));
      throw new Error(op);
    });
    const results = await runTests(BASE);
    expect(results.find((r) => r.testKey === "carbonite.backup.recent_successful_backup").status).toBe("fail");
    expect(results.find((r) => r.testKey === "carbonite.backup.device_coverage").status).toBe("fail");
  });

  test("an unrecognised device state produces an 'error' row (not a guessed pass/fail)", async () => {
    stubSoap((op) => {
      if (op === "GetDeviceList") return ok(deviceListXml([{ id: "d1", name: "laptop-1", state: "Quiesced" }]));
      if (op === "GetDashboardDeviceInfo") return ok(deviceInfoXml([{ id: "d1", last: hoursAgo(2) }]));
      throw new Error(op);
    });
    const results = await runTests(BASE);
    expect(results.find((r) => r.testKey === "carbonite.backup.device_coverage").status).toBe("error");
    expect(results.find((r) => r.testKey === "carbonite.backup.recent_successful_backup").status).toBe("pass");
  });
});

describe("runTests — error isolation", () => {
  test("a SOAP fault on one check records that check as error, not the run", async () => {
    let calls = 0;
    stubSoap(() => {
      calls += 1;
      // First check's GetDeviceList succeeds; second check's GetDeviceList faults.
      if (calls <= 2) return HEALTHY(calls === 1 ? "GetDeviceList" : "GetDashboardDeviceInfo");
      return ok(env(`<s:Fault><faultstring>boom</faultstring></s:Fault>`));
    });
    const results = await runTests(BASE);
    expect(results.find((r) => r.testKey === "carbonite.backup.recent_successful_backup").status).toBe("pass");
    expect(results.find((r) => r.testKey === "carbonite.backup.device_coverage").status).toBe("error");
  });
});

describe("describeCarboniteError", () => {
  test("429 → rate-limit guidance", () => {
    expect(describeCarboniteError(new Error("failed: 429"))).toMatch(/rate limit/i);
  });
  test("generic → dashboard host hint", () => {
    expect(describeCarboniteError(new Error("failed: 502"))).toMatch(/config\.dashboardHost/);
  });
});
