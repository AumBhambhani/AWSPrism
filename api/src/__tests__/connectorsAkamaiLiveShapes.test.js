import { describe, test, expect, beforeAll } from "vitest";

const LIVE = Boolean(
  process.env.AKAMAI_TEST_HOST &&
    process.env.AKAMAI_TEST_CLIENT_TOKEN &&
    process.env.AKAMAI_TEST_CLIENT_SECRET &&
    process.env.AKAMAI_TEST_ACCESS_TOKEN
);

describe.skipIf(!LIVE)("Akamai live response shapes (only runs when AKAMAI_TEST_* env vars are set)", () => {
  let resolveAkamaiCredentials;
  let akamaiClient;

  beforeAll(async () => {
    ({ resolveAkamaiCredentials } = await import("../connectors/akamai/credentials.js"));
    ({ akamaiClient } = await import("../connectors/akamai/client.js"));
  });

  async function client() {
    const creds = await resolveAkamaiCredentials({
      authType: "api_key",
      config: { host: process.env.AKAMAI_TEST_HOST, accountSwitchKey: process.env.AKAMAI_TEST_ACCOUNT_SWITCH_KEY },
      secret: {
        clientToken: process.env.AKAMAI_TEST_CLIENT_TOKEN,
        clientSecret: process.env.AKAMAI_TEST_CLIENT_SECRET,
        accessToken: process.env.AKAMAI_TEST_ACCESS_TOKEN,
      },
    });
    return akamaiClient(creds);
  }

  test("GET /appsec/v1/configs returns a configurations array", async () => {
    const body = await (await client()).get("/appsec/v1/configs");
    expect(Array.isArray(body.configurations)).toBe(true);
  });

  test("GET /papi/v1/contracts returns contracts.items", async () => {
    const body = await (await client()).get("/papi/v1/contracts");
    expect(Array.isArray(body?.contracts?.items)).toBe(true);
  });

  test("a PAPI rule tree exposes a 'behaviors' array on its top rule", async () => {
    const c = await client();
    const groups = await c.get("/papi/v1/groups");
    const g = groups.groups.items.find((x) => x.contractIds?.length);
    const props = await c.get(`/papi/v1/properties?contractId=${g.contractIds[0]}&groupId=${g.groupId}`);
    const p = props.properties.items[0];
    if (!p) return;
    const rules = await c.get(`/papi/v1/properties/${p.propertyId}/versions/${p.latestVersion}/rules`);
    expect(Array.isArray(rules?.rules?.behaviors)).toBe(true);
    // Record the behavior names actually present so Task 7's node-name list can be tightened:
    console.log("[live-shapes] top-level behavior names:", rules.rules.behaviors.map((b) => b.name));
  });

  test("a CPS production deployment exposes primaryCertificate.expiry", async () => {
    const c = await client();
    const contracts = await c.get("/papi/v1/contracts");
    const contractId = contracts.contracts.items[0]?.contractId;
    const enrollments = await c.get(`/cps/v2/enrollments?contractId=${contractId}`, {
      accept: "application/vnd.akamai.cps.enrollments.v11+json",
    });
    const e = enrollments.enrollments?.[0];
    if (!e) return;
    const id = e.location.split("/").pop();
    const dep = await c.get(`/cps/v2/enrollments/${id}/deployments/production`, {
      accept: "application/vnd.akamai.cps.deployment.v8+json",
    });
    expect(typeof dep?.primaryCertificate?.expiry).toBe("string");
    console.log("[live-shapes] enrollment keyAlgorithm:", e.networkConfiguration?.geography, e.certificateType, e.validationType);
  });
});
