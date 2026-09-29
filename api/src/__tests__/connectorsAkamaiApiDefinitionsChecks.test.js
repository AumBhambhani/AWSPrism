import { describe, test, expect, vi } from "vitest";
import {
  checkApiDiscoveryEnabled,
  checkNoUnregisteredEndpoints,
  checkEndpointConstraintsEnforced,
} from "../connectors/akamai/tests/apiDefinitions.js";

function fakeAkamai({ endpoints = [], byPath = {} } = {}) {
  return {
    getPaged: async () => endpoints,
    get: vi.fn(async (path) => byPath[path] ?? {}),
    listSecurityConfigs: async () => byPath.__configs ?? [],
    resolveActiveConfig: async (id) => byPath.__active?.[id] ?? { productionVersion: null },
    listSecurityPolicies: async () => byPath.__policies ?? [],
    describeAkamaiError: (e) => e.message,
  };
}

describe("checkApiDiscoveryEnabled", () => {
  test("passes when the endpoint inventory is non-empty", async () => {
    const akamai = fakeAkamai({ endpoints: [{ apiEndPointId: 1, apiEndPointName: "orders" }] });
    const results = await checkApiDiscoveryEnabled({ akamai });
    expect(results[0].status).toBe("pass");
    expect(results[0].evidencePayload.registeredEndpointCount).toBe(1);
  });

  test("warns when there are no registered endpoints at all", async () => {
    const akamai = fakeAkamai({ endpoints: [] });
    const results = await checkApiDiscoveryEnabled({ akamai });
    expect(results[0].status).toBe("warn");
  });
});

describe("checkNoUnregisteredEndpoints", () => {
  test("fails when discovery surfaces a path that is not registered", async () => {
    const akamai = fakeAkamai({
      endpoints: [{ apiEndPointId: 1, basePath: "/v1", apiEndPointName: "orders" }],
      byPath: {
        __configs: [{ id: 9, name: "main" }],
        __active: { 9: { productionVersion: 3 } },
        __policies: [{ policyId: "p1" }],
        "/appsec/v1/configs/9/versions/3/security-policies/p1/api-endpoints": { apiEndpoints: [{ id: 1, basePath: "/v1" }] },
        "/appsec/v1/api-discovery": { apis: [{ basePath: "/v1" }, { basePath: "/internal" }] },
      },
    });
    const results = await checkNoUnregisteredEndpoints({ akamai });
    expect(results[0].status).toBe("fail");
    expect(results[0].evidencePayload.unregisteredBasePaths).toContain("/internal");
  });

  test("returns not_applicable when registered endpoints exist but discovery yields no list", async () => {
    const akamai = fakeAkamai({
      endpoints: [{ apiEndPointId: 1, basePath: "/v1", apiEndPointName: "orders" }],
      byPath: {
        __configs: [{ id: 9, name: "main" }],
        __active: { 9: { productionVersion: 3 } },
        __policies: [{ policyId: "p1" }],
        "/appsec/v1/configs/9/versions/3/security-policies/p1/api-endpoints": { apiEndpoints: [{ id: 1, basePath: "/v1" }] },
        "/appsec/v1/api-discovery": {},
      },
    });
    const results = await checkNoUnregisteredEndpoints({ akamai });
    expect(results[0].status).toBe("not_applicable");
    expect(results[0].status).not.toBe("pass");
  });
});

describe("checkEndpointConstraintsEnforced", () => {
  test("fails an endpoint whose version has no request constraints enabled", async () => {
    const akamai = fakeAkamai({
      endpoints: [{ apiEndPointId: 1, apiEndPointName: "orders", stagingVersion: { versionNumber: 2 }, productionVersion: { versionNumber: 2 } }],
      byPath: {
        "/api-definitions/v2/endpoints/1/versions/2/resources": { apiResources: [{ apiResourceName: "GET /orders" }] },
        "/api-definitions/v2/endpoints/1/versions/2": { securityScheme: null, requestConstraintsEnabled: false, akamaiSecurityRestrictions: {} },
      },
    });
    const results = await checkEndpointConstraintsEnforced({ akamai });
    expect(results[0].status).toBe("fail");
  });

  test("passes an endpoint with request constraints enabled", async () => {
    const akamai = fakeAkamai({
      endpoints: [{ apiEndPointId: 1, apiEndPointName: "orders", productionVersion: { versionNumber: 2 } }],
      byPath: {
        "/api-definitions/v2/endpoints/1/versions/2": { requestConstraintsEnabled: true },
      },
    });
    const results = await checkEndpointConstraintsEnforced({ akamai });
    expect(results[0].status).toBe("pass");
  });
});
