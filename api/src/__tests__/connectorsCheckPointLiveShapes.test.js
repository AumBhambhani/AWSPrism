import { describe, expect, test } from "vitest";
import { resolveCheckPointMgmtCredentials } from "../connectors/check_point_mgmt/credentials.js";
import { checkPointMgmtClient } from "../connectors/check_point_mgmt/client.js";
import { resolveCheckPointCredentials } from "../connectors/check_point/credentials.js";
import { buildClients as buildInfinityClients } from "../connectors/check_point/index.js";
import { resolveCheckPointCloudguardCredentials } from "../connectors/check_point_cloudguard/credentials.js";
import { checkPointCloudguardClient } from "../connectors/check_point_cloudguard/client.js";

// Env-gated live-shape harness. NOT a CI gate — skipped unless CHECKPOINT_LIVE=1
// and the relevant credential env vars are set. Each test hits the real API once
// and console.logs the actual field names so a future implementer can tighten the
// beta checks before promoting these connectors to `active`.
//
//   CHECKPOINT_LIVE=1
//   CP_MGMT_URL= CP_MGMT_API_KEY= [CP_MGMT_DEPLOYMENT=]
//   CP_INFINITY_REGION= CP_INFINITY_CLIENT_ID= CP_INFINITY_ACCESS_KEY=
//   CP_CLOUDGUARD_DC= CP_CLOUDGUARD_KEY_ID= CP_CLOUDGUARD_KEY_SECRET=

const LIVE = process.env.CHECKPOINT_LIVE === "1";

describe.skipIf(!LIVE || !process.env.CP_MGMT_URL)("check_point_mgmt live shapes", () => {
  test("logs the shapes of show-packages / show-gateways-and-servers / show-ips-status", async () => {
    const creds = await resolveCheckPointMgmtCredentials({
      authType: "api_key",
      config: { mgmtUrl: process.env.CP_MGMT_URL, deployment: process.env.CP_MGMT_DEPLOYMENT || "self_managed" },
      secret: { apiKey: process.env.CP_MGMT_API_KEY },
    });
    const api = checkPointMgmtClient({ mgmtOrigin: creds.mgmtOrigin, apiVersion: creds.apiVersion });
    const session = await api.openSession({ apiKey: creds.apiKey, domain: creds.domain });
    try {
      for (const command of ["show-packages", "show-gateways-and-servers", "show-ips-status", "show-threat-profiles"]) {
        const body = command === "show-gateways-and-servers" || command === "show-threat-profiles"
          ? { "details-level": "full", limit: 5 }
          : {};
        const data = await session.post(command, body).catch((e) => ({ error: e.message }));
        console.log(`[${command}]`, JSON.stringify(data).slice(0, 2000));
      }
    } finally {
      await session.logout();
    }
    expect(session.sid).toBeTruthy();
  });
});

describe.skipIf(!LIVE || !process.env.CP_INFINITY_CLIENT_ID)("check_point (Infinity) live shapes", () => {
  test("logs the shapes of Infinity Events / XDR / Harmony Endpoint responses", async () => {
    const resolved = await resolveCheckPointCredentials({
      authType: "api_key",
      config: { region: process.env.CP_INFINITY_REGION || "eu" },
      secret: { clientId: process.env.CP_INFINITY_CLIENT_ID, accessKey: process.env.CP_INFINITY_ACCESS_KEY },
    });
    const clients = buildInfinityClients(resolved);
    for (const [name, fn] of [
      ["queryEvents", clients.queryEvents],
      ["listXdrIncidents", clients.listXdrIncidents],
      ["listEndpointComputers", clients.listEndpointComputers],
      ["listEndpointPolicies", clients.listEndpointPolicies],
    ]) {
      const data = await fn().catch((e) => ({ error: e.message }));
      console.log(`[${name}]`, JSON.stringify(data).slice(0, 2000));
    }
    expect(resolved.gatewayUrl).toContain("checkpoint.com");
  });
});

describe.skipIf(!LIVE || !process.env.CP_CLOUDGUARD_KEY_ID)("check_point_cloudguard live shapes", () => {
  test("logs the shapes of CloudAccounts / AssessmentHistoryV2 / Finding search", async () => {
    const creds = await resolveCheckPointCloudguardCredentials({
      authType: "api_key",
      config: { dataCenter: process.env.CP_CLOUDGUARD_DC || "us" },
      secret: { keyId: process.env.CP_CLOUDGUARD_KEY_ID, keySecret: process.env.CP_CLOUDGUARD_KEY_SECRET },
    });
    const api = checkPointCloudguardClient({ baseUrl: creds.baseUrl, authHeader: creds.authHeader });
    for (const path of ["/CloudAccounts", "/AssessmentHistoryV2?pageSize=3", "/Compliance/ContinuousCompliancePolicy", "/Compliance/Exclusion"]) {
      const data = await api.request("GET", path).catch((e) => ({ error: e.message }));
      console.log(`[GET ${path}]`, JSON.stringify(data).slice(0, 2000));
    }
    const findings = await api.search("/Compliance/Finding/search", { severities: ["Critical"] }).catch((e) => ({ error: e.message }));
    console.log("[POST /Compliance/Finding/search]", JSON.stringify(findings).slice(0, 2000));
    expect(creds.baseUrl).toContain("/v2");
  });
});
