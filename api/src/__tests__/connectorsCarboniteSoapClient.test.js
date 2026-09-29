import { describe, test, expect, vi } from "vitest";

const { buildSoapEnvelope, parseSoapResponse, callDashboardService } = await import(
  "../connectors/carbonite/soapClient.js"
);

const CC = { ContextIdentity: "admin@acme.com", AuthenticationToken: "key-123", TokenType: "ApiKey" };

describe("buildSoapEnvelope", () => {
  test("wraps the operation, the callingContext, and params in a SOAP 1.1 body", () => {
    const xml = buildSoapEnvelope({
      operation: "GetDeviceList",
      callingContext: CC,
      params: { Filter: "acme" },
    });
    expect(xml).toContain('<soap:Envelope xmlns:soap="http://schemas.xmlsoap.org/soap/envelope/">');
    expect(xml).toContain('<GetDeviceList xmlns="http://tempuri.org/">');
    expect(xml).toContain("<callingContext><ContextIdentity>admin@acme.com</ContextIdentity>");
    expect(xml).toContain("<AuthenticationToken>key-123</AuthenticationToken>");
    expect(xml).toContain("<Filter>acme</Filter>");
  });

  test("serialises arrays as repeated elements and escapes XML metacharacters", () => {
    const xml = buildSoapEnvelope({
      operation: "GetDashboardDeviceInfo",
      callingContext: CC,
      params: { WhichField: "EntityIds", FieldData: { string: ["a&b", "c<d"] } },
    });
    expect(xml).toContain("<FieldData><string>a&amp;b</string><string>c&lt;d</string></FieldData>");
  });

  test("skips null / undefined params", () => {
    const xml = buildSoapEnvelope({ operation: "GetDeviceList", callingContext: CC, params: { Filter: null, RestrictingEntityId: undefined } });
    expect(xml).not.toContain("<Filter>");
    expect(xml).not.toContain("<RestrictingEntityId>");
  });
});

describe("parseSoapResponse", () => {
  const wrap = (inner) =>
    `<s:Envelope xmlns:s="http://schemas.xmlsoap.org/soap/envelope/"><s:Body>${inner}</s:Body></s:Envelope>`;

  test("returns the <Op>Result subtree, collapsing repeated siblings to arrays", () => {
    const xml = wrap(`
      <GetDeviceListResponse xmlns="http://tempuri.org/">
        <GetDeviceListResult>
          <Status>Completed</Status>
          <OverallStatus>Success</OverallStatus>
          <DeviceList>
            <DeviceInfo><DeviceId>d1</DeviceId><State>Active</State></DeviceInfo>
            <DeviceInfo><DeviceId>d2</DeviceId><State>Suspended</State></DeviceInfo>
          </DeviceList>
        </GetDeviceListResult>
      </GetDeviceListResponse>`);
    const result = parseSoapResponse(xml, "GetDeviceList");
    expect(result.Status).toBe("Completed");
    expect(Array.isArray(result.DeviceList.DeviceInfo)).toBe(true);
    expect(result.DeviceList.DeviceInfo.map((d) => d.DeviceId)).toEqual(["d1", "d2"]);
  });

  test("keeps a single row as an object (not an array)", () => {
    const xml = wrap(`
      <GetDeviceListResponse xmlns="http://tempuri.org/">
        <GetDeviceListResult><Status>Completed</Status>
          <DeviceList><DeviceInfo><DeviceId>only</DeviceId></DeviceInfo></DeviceList>
        </GetDeviceListResult>
      </GetDeviceListResponse>`);
    const result = parseSoapResponse(xml, "GetDeviceList");
    expect(result.DeviceList.DeviceInfo.DeviceId).toBe("only");
  });

  test("throws a credentials error on Status: InvalidCredentials", () => {
    const xml = wrap(`<GetDeviceListResponse xmlns="http://tempuri.org/"><GetDeviceListResult><Status>InvalidCredentials</Status></GetDeviceListResult></GetDeviceListResponse>`);
    expect(() => parseSoapResponse(xml, "GetDeviceList")).toThrow(/rejected the credentials/i);
  });

  test("throws on any non-Completed Status", () => {
    const xml = wrap(`<GetDeviceListResponse xmlns="http://tempuri.org/"><GetDeviceListResult><Status>ServerUnableToProcessRequest</Status></GetDeviceListResult></GetDeviceListResponse>`);
    expect(() => parseSoapResponse(xml, "GetDeviceList")).toThrow(/did not complete/i);
  });

  test("throws with the fault reason on a SOAP Fault", () => {
    const xml = wrap(`<s:Fault><faultstring>Object reference not set</faultstring></s:Fault>`);
    expect(() => parseSoapResponse(xml, "GetDeviceList")).toThrow(/SOAP fault: Object reference not set/);
  });

  test("throws a shape error when the result element is absent", () => {
    const xml = wrap(`<SomethingElse xmlns="http://tempuri.org/"><Foo>1</Foo></SomethingElse>`);
    expect(() => parseSoapResponse(xml, "GetDeviceList")).toThrow(/did not contain a <GetDeviceListResult>/);
  });
});

describe("callDashboardService", () => {
  test("POSTs the envelope with a quoted SOAPAction and returns the parsed result", async () => {
    const fetchImpl = vi.fn(async () => ({
      ok: true,
      status: 200,
      text: async () =>
        `<s:Envelope xmlns:s="http://schemas.xmlsoap.org/soap/envelope/"><s:Body>` +
        `<GetDeviceListResponse xmlns="http://tempuri.org/"><GetDeviceListResult><Status>Completed</Status>` +
        `<DeviceList><DeviceInfo><DeviceId>d1</DeviceId></DeviceInfo></DeviceList></GetDeviceListResult></GetDeviceListResponse>` +
        `</s:Body></s:Envelope>`,
    }));
    const result = await callDashboardService({
      endpoint: "https://dash.example.com/Dashboard/DashboardService.v.1.0.svc",
      operation: "GetDeviceList",
      callingContext: CC,
      fetchImpl,
    });
    expect(result.DeviceList.DeviceInfo.DeviceId).toBe("d1");
    const [, opts] = fetchImpl.mock.calls[0];
    expect(opts.method).toBe("POST");
    expect(opts.headers.SOAPAction).toBe('"http://tempuri.org/IDashboardService/GetDeviceList"');
    expect(opts.headers["Content-Type"]).toMatch(/text\/xml/);
  });

  test("surfaces a SOAP fault delivered with HTTP 500", async () => {
    const fetchImpl = vi.fn(async () => ({
      ok: false,
      status: 500,
      text: async () =>
        `<s:Envelope xmlns:s="http://schemas.xmlsoap.org/soap/envelope/"><s:Body><s:Fault><faultstring>bad input</faultstring></s:Fault></s:Body></s:Envelope>`,
    }));
    await expect(
      callDashboardService({ endpoint: "https://x/y", operation: "GetDeviceList", callingContext: CC, fetchImpl })
    ).rejects.toThrow(/SOAP fault: bad input/);
  });

  test("throws a bare HTTP error when the body is empty", async () => {
    const fetchImpl = vi.fn(async () => ({ ok: false, status: 502, text: async () => "" }));
    await expect(
      callDashboardService({ endpoint: "https://x/y", operation: "GetDeviceList", callingContext: CC, fetchImpl })
    ).rejects.toThrow(/HTTP 502/);
  });
});
