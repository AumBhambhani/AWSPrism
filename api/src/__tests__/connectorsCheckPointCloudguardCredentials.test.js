import { describe, expect, test } from "vitest";
import { normaliseBaseUrl, resolveCheckPointCloudguardCredentials } from "../connectors/check_point_cloudguard/credentials.js";

describe("Check Point CloudGuard credentials", () => {
  test("resolves the data-centre host and always lands on /v2", () => {
    expect(normaliseBaseUrl("", "us")).toBe("https://api.dome9.com/v2");
    expect(normaliseBaseUrl("", "eu")).toBe("https://api.eu1.dome9.com/v2");
    expect(normaliseBaseUrl("https://api.dome9.com/v2/")).toBe("https://api.dome9.com/v2");
    expect(normaliseBaseUrl("api.ap3.dome9.com")).toBe("https://api.ap3.dome9.com/v2");
    expect(() => normaliseBaseUrl("", "")).toThrow(/baseUrl/);
    expect(() => normaliseBaseUrl("http://api.dome9.com")).toThrow(/https/i);
  });

  test("requires api_key auth and a keyId + keySecret, and builds a Basic header", async () => {
    await expect(resolveCheckPointCloudguardCredentials({ authType: "oauth2", config: {}, secret: {} })).rejects.toThrow(/auth type/i);
    await expect(resolveCheckPointCloudguardCredentials({ authType: "api_key", config: { dataCenter: "us" }, secret: { keyId: "id" } })).rejects.toThrow(/keySecret/);
    const creds = await resolveCheckPointCloudguardCredentials({ authType: "api_key", config: { dataCenter: "us" }, secret: { keyId: "id", keySecret: "sec" } });
    expect(creds.baseUrl).toBe("https://api.dome9.com/v2");
    expect(creds.authHeader).toBe(`Basic ${Buffer.from("id:sec").toString("base64")}`);
  });
});
