import { describe, expect, test } from "vitest";
import {
  normaliseApiVersion,
  normaliseDeployment,
  normaliseMgmtOrigin,
  resolveCheckPointMgmtCredentials,
} from "../connectors/check_point_mgmt/credentials.js";

describe("Check Point Management credentials", () => {
  test("normalises the management URL to an origin, keeping a tenant path but dropping /web_api", () => {
    expect(normaliseMgmtOrigin("mgmt.example.com")).toBe("https://mgmt.example.com");
    expect(normaliseMgmtOrigin("https://mgmt.example.com/web_api/")).toBe("https://mgmt.example.com");
    expect(normaliseMgmtOrigin("https://maas.checkpoint.com/abc-123/web_api")).toBe("https://maas.checkpoint.com/abc-123");
    expect(() => normaliseMgmtOrigin("http://mgmt.example.com")).toThrow(/https/i);
    expect(() => normaliseMgmtOrigin("")).toThrow(/mgmtUrl/);
  });

  test("validates deployment and api version", () => {
    expect(normaliseDeployment()).toBe("self_managed");
    expect(normaliseDeployment("smart1_cloud")).toBe("smart1_cloud");
    expect(() => normaliseDeployment("onprem")).toThrow(/deployment/);
    expect(normaliseApiVersion("1.1")).toBe("v1.1");
    expect(normaliseApiVersion("")).toBe("");
    expect(() => normaliseApiVersion("latest")).toThrow(/apiVersion/);
  });

  test("requires an api_key auth type and a secret.apiKey", async () => {
    await expect(resolveCheckPointMgmtCredentials({ authType: "oauth2", config: {}, secret: {} })).rejects.toThrow(/auth type/i);
    await expect(resolveCheckPointMgmtCredentials({ authType: "api_key", config: { mgmtUrl: "mgmt.example.com" }, secret: {} })).rejects.toThrow(/apiKey/);
    const creds = await resolveCheckPointMgmtCredentials({
      authType: "api_key",
      config: { mgmtUrl: "https://mgmt.example.com", deployment: "self_managed", domain: "Corp" },
      secret: { apiKey: "abc" },
    });
    expect(creds).toMatchObject({ mgmtOrigin: "https://mgmt.example.com", deployment: "self_managed", domain: "Corp", apiKey: "abc" });
  });
});
