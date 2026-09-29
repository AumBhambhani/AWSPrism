import { describe, test, expect } from "vitest";
import {
  checkForceHttps,
  checkMinTls12,
  checkHstsEnabled,
  checkLatestVersionActive,
  checkOriginProtected,
} from "../connectors/akamai/tests/property.js";

const THRESHOLDS = { HSTS_MIN_MAX_AGE_SECONDS: 15552000, PROPERTY_VERSION_LAG_MAX: 2 };

function fakeAkamai({ properties = [], activeVersion = {}, rules = {} } = {}) {
  return {
    listProperties: async () => properties,
    resolveActivePropertyVersion: async (id) => activeVersion[id] ?? null,
    getRuleTree: async (id, v) => rules[`${id}:${v}`] ?? { rules: { behaviors: [], children: [] } },
  };
}

function ruleTree(behaviors, children = []) {
  return { rules: { name: "default", behaviors, children } };
}

describe("checkForceHttps", () => {
  test("passes a property whose rule tree has a redirect-to-HTTPS behavior", async () => {
    const akamai = fakeAkamai({
      properties: [{ propertyId: "prp_1", propertyName: "www" }],
      activeVersion: { prp_1: 4 },
      rules: { "prp_1:4": ruleTree([{ name: "redirect", options: { destinationProtocol: "HTTPS", statusCode: 301 } }]) },
    });
    const results = await checkForceHttps({ akamai, THRESHOLDS });
    expect(results[0].status).toBe("pass");
  });

  test("fails a property that has a redirect behavior which does not force HTTPS", async () => {
    const akamai = fakeAkamai({
      properties: [{ propertyId: "prp_1", propertyName: "www" }],
      activeVersion: { prp_1: 4 },
      rules: { "prp_1:4": ruleTree([{ name: "redirect", options: { destinationProtocol: "HTTP", statusCode: 302 } }], [{ name: "child", behaviors: [{ name: "caching", options: {} }], children: [] }]) },
    });
    const results = await checkForceHttps({ akamai, THRESHOLDS });
    expect(results[0].status).toBe("fail");
  });

  test("error (not a guessed fail) when there is no redirect-type behavior node at all", async () => {
    const akamai = fakeAkamai({
      properties: [{ propertyId: "prp_1", propertyName: "www" }],
      activeVersion: { prp_1: 4 },
      rules: { "prp_1:4": ruleTree([{ name: "cpCode", options: {} }], [{ name: "child", behaviors: [{ name: "caching", options: {} }], children: [] }]) },
    });
    const results = await checkForceHttps({ akamai, THRESHOLDS });
    expect(results[0].status).toBe("error");
    expect(results[0].message).toMatch(/Task 0|live/i);
  });

  test("not_applicable when no property is production-active", async () => {
    const akamai = fakeAkamai({ properties: [{ propertyId: "prp_1", propertyName: "www" }], activeVersion: { prp_1: null } });
    const results = await checkForceHttps({ akamai, THRESHOLDS });
    expect(results[0].status).toBe("not_applicable");
  });
});

describe("checkHstsEnabled", () => {
  test("passes when HSTS behavior max-age meets the threshold", async () => {
    const akamai = fakeAkamai({
      properties: [{ propertyId: "prp_1", propertyName: "www" }],
      activeVersion: { prp_1: 4 },
      rules: { "prp_1:4": ruleTree([{ name: "httpStrictTransportSecurity", options: { enable: true, maxAge: 31536000 } }]) },
    });
    const results = await checkHstsEnabled({ akamai, THRESHOLDS });
    expect(results[0].status).toBe("pass");
  });

  test("fails when HSTS max-age is below the threshold", async () => {
    const akamai = fakeAkamai({
      properties: [{ propertyId: "prp_1", propertyName: "www" }],
      activeVersion: { prp_1: 4 },
      rules: { "prp_1:4": ruleTree([{ name: "httpStrictTransportSecurity", options: { enable: true, maxAge: 300 } }]) },
    });
    const results = await checkHstsEnabled({ akamai, THRESHOLDS });
    expect(results[0].status).toBe("fail");
  });

  test("error (not fail) when there is no HSTS-type behavior node at all", async () => {
    const akamai = fakeAkamai({
      properties: [{ propertyId: "prp_1", propertyName: "www" }],
      activeVersion: { prp_1: 4 },
      rules: { "prp_1:4": ruleTree([{ name: "caching", options: {} }]) },
    });
    const results = await checkHstsEnabled({ akamai, THRESHOLDS });
    expect(results[0].status).toBe("error");
    expect(results[0].message).toMatch(/Task 0|live/i);
  });
});

describe("checkLatestVersionActive", () => {
  test("passes when the active version lag is within threshold", async () => {
    const akamai = fakeAkamai({
      properties: [{ propertyId: "prp_1", propertyName: "www", latestVersion: 5 }],
      activeVersion: { prp_1: 4 },
    });
    const results = await checkLatestVersionActive({ akamai, THRESHOLDS });
    expect(results[0].status).toBe("pass");
  });

  test("fails when lag exceeds threshold", async () => {
    const akamai = fakeAkamai({
      properties: [{ propertyId: "prp_1", propertyName: "www", latestVersion: 10 }],
      activeVersion: { prp_1: 4 },
    });
    const results = await checkLatestVersionActive({ akamai, THRESHOLDS });
    expect(results[0].status).toBe("fail");
  });
});

describe("checkMinTls12 / checkOriginProtected", () => {
  test("min TLS: fails when an origin behavior allows TLSv1", async () => {
    const akamai = fakeAkamai({
      properties: [{ propertyId: "prp_1", propertyName: "www" }],
      activeVersion: { prp_1: 4 },
      rules: { "prp_1:4": ruleTree([{ name: "origin", options: { originCertsToHonor: "STANDARD_CERTIFICATE_AUTHORITIES", tlsVersion: "TLSv1" } }]) },
    });
    const results = await checkMinTls12({ akamai, THRESHOLDS });
    expect(results[0].status).toBe("fail");
  });

  test("min TLS: error (not a guessed pass) when there is no origin-type behavior node at all", async () => {
    const akamai = fakeAkamai({
      properties: [{ propertyId: "prp_1", propertyName: "www" }],
      activeVersion: { prp_1: 4 },
      rules: { "prp_1:4": ruleTree([{ name: "caching", options: {} }], [{ name: "child", behaviors: [{ name: "cpCode", options: {} }], children: [] }]) },
    });
    const results = await checkMinTls12({ akamai, THRESHOLDS });
    expect(results[0].status).toBe("error");
    expect(results[0].message).toMatch(/Task 0|live/i);
  });

  test("origin protected: passes when a siteShield behavior is present", async () => {
    const akamai = fakeAkamai({
      properties: [{ propertyId: "prp_1", propertyName: "www" }],
      activeVersion: { prp_1: 4 },
      rules: { "prp_1:4": ruleTree([{ name: "siteShield", options: { ssmap: { value: "s;map=e;" } } }]) },
    });
    const results = await checkOriginProtected({ akamai, THRESHOLDS });
    expect(results[0].status).toBe("pass");
  });

  test("origin protected: error when there is neither a siteShield nor an origin behavior node", async () => {
    const akamai = fakeAkamai({
      properties: [{ propertyId: "prp_1", propertyName: "www" }],
      activeVersion: { prp_1: 4 },
      rules: { "prp_1:4": ruleTree([{ name: "caching", options: {} }], [{ name: "child", behaviors: [{ name: "cpCode", options: {} }], children: [] }]) },
    });
    const results = await checkOriginProtected({ akamai, THRESHOLDS });
    expect(results[0].status).toBe("error");
    expect(results[0].message).toMatch(/Task 0|live/i);
  });
});
