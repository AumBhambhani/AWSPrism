import { describe, test, expect, vi, beforeEach } from "vitest";

const { resolveCarboniteCredentials, resolveDashboardHost } = await import(
  "../connectors/carbonite/credentials.js"
);

const VALID_CONFIG = { dashboardHost: "dashboard.carbonite.com" };
const VALID_SECRET = { email: "admin@acme.com", apiKey: "key-abc123" };

beforeEach(() => vi.unstubAllGlobals());

describe("resolveDashboardHost", () => {
  test.each([
    ["https://dashboard.carbonite.com", "dashboard.carbonite.com"],
    ["dashboard.carbonite.com", "dashboard.carbonite.com"],
    ["https://dashboard.carbonite.com/", "dashboard.carbonite.com"],
    ["https://dashboard.carbonite.com/Dashboard/DashboardService.v.1.0.svc", "dashboard.carbonite.com"],
    ["  HTTPS://Dashboard.Carbonite.COM:443  ", "dashboard.carbonite.com"],
  ])("normalises %s -> %s", (input, expected) => {
    expect(resolveDashboardHost({ dashboardHost: input })).toBe(expected);
  });

  test("throws for an empty value", () => {
    expect(() => resolveDashboardHost({})).toThrow(/missing config\.dashboardHost/);
  });

  test("throws for a non-hostname string", () => {
    expect(() => resolveDashboardHost({ dashboardHost: "not a host" })).toThrow(/invalid config\.dashboardHost/);
  });
});

describe("resolveCarboniteCredentials", () => {
  test("throws for an unsupported auth type", async () => {
    await expect(
      resolveCarboniteCredentials({ authType: "oauth2", config: VALID_CONFIG, secret: VALID_SECRET })
    ).rejects.toThrow("Unsupported Carbonite auth type: oauth2");
  });

  test("throws when config.dashboardHost is missing", async () => {
    await expect(
      resolveCarboniteCredentials({ authType: "api_key", config: {}, secret: VALID_SECRET })
    ).rejects.toThrow(/config\.dashboardHost/);
  });

  test("throws when secret.email or secret.apiKey is missing/blank", async () => {
    await expect(
      resolveCarboniteCredentials({ authType: "api_key", config: VALID_CONFIG, secret: { apiKey: "k" } })
    ).rejects.toThrow(/secret\.email/);
    await expect(
      resolveCarboniteCredentials({ authType: "api_key", config: VALID_CONFIG, secret: { email: "a@b.com", apiKey: "  " } })
    ).rejects.toThrow(/secret\.apiKey/);
  });

  test("builds the .svc endpoint and a CallingContext from the trimmed secret", async () => {
    const creds = await resolveCarboniteCredentials({
      authType: "api_key",
      config: { dashboardHost: "https://dash.example.com/x" },
      secret: { email: "  admin@acme.com  ", apiKey: "  key-abc123  " },
    });
    expect(creds.endpoint).toBe("https://dash.example.com/Dashboard/DashboardService.v.1.0.svc");
    expect(creds.host).toBe("dash.example.com");
    expect(creds.callingContext).toEqual({
      ContextIdentity: "admin@acme.com",
      AuthenticationToken: "key-abc123",
      TokenType: "ApiKey",
    });
    expect(typeof creds.call).toBe("function");
  });

  test("call() posts a SOAP envelope carrying the CallingContext and returns the parsed result", async () => {
    vi.stubGlobal("fetch", vi.fn(async (url, opts) => {
      expect(url).toBe("https://dashboard.carbonite.com/Dashboard/DashboardService.v.1.0.svc");
      expect(String(opts.body)).toContain("<AuthenticationToken>key-abc123</AuthenticationToken>");
      return {
        ok: true,
        status: 200,
        text: async () =>
          `<s:Envelope xmlns:s="http://schemas.xmlsoap.org/soap/envelope/"><s:Body>` +
          `<GetDeviceListResponse xmlns="http://tempuri.org/"><GetDeviceListResult><Status>Completed</Status>` +
          `<DeviceList><DeviceInfo><DeviceId>d1</DeviceId></DeviceInfo></DeviceList></GetDeviceListResult></GetDeviceListResponse>` +
          `</s:Body></s:Envelope>`,
      };
    }));
    const creds = await resolveCarboniteCredentials({ authType: "api_key", config: VALID_CONFIG, secret: VALID_SECRET });
    const result = await creds.call("GetDeviceList", {});
    expect(result.DeviceList.DeviceInfo.DeviceId).toBe("d1");
  });

  test("call() propagates a credentials rejection from the SOAP layer", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => ({
      ok: true,
      status: 200,
      text: async () =>
        `<s:Envelope xmlns:s="http://schemas.xmlsoap.org/soap/envelope/"><s:Body>` +
        `<GetDeviceListResponse xmlns="http://tempuri.org/"><GetDeviceListResult><Status>InvalidCredentials</Status></GetDeviceListResult></GetDeviceListResponse>` +
        `</s:Body></s:Envelope>`,
    })));
    const creds = await resolveCarboniteCredentials({ authType: "api_key", config: VALID_CONFIG, secret: VALID_SECRET });
    await expect(creds.call("GetDeviceList", {})).rejects.toThrow(/rejected the credentials/i);
  });
});
