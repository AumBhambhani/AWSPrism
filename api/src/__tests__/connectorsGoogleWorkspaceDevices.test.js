import { describe, test, expect } from "vitest";
import { checkChromePolicyCompliant } from "../connectors/google_workspace/tests/devices.js";

function directoryWith(devices) {
  return {
    chromeosdevices: { list: async () => ({ data: { chromeosdevices: devices } }) },
    orgunits: { get: async () => ({ data: { orgUnitId: "id:root" } }) },
  };
}

describe("checkChromePolicyCompliant", () => {
  test("returns not_applicable when no managed ChromeOS devices exist", async () => {
    const directory = directoryWith([]);
    const results = await checkChromePolicyCompliant({}, directory, "C0");
    expect(results).toEqual([{ resourceId: "chromeos", status: "not_applicable", message: "No managed ChromeOS devices found", evidencePayload: {} }]);
  });

  test("passes when a session length policy is resolved for the root org unit", async () => {
    const directory = directoryWith([{ deviceId: "d1" }]);
    const chromepolicy = { customers: { policies: { resolve: async () => ({ data: { resolvedPolicies: [{ value: {} }] } }) } } };
    const results = await checkChromePolicyCompliant(chromepolicy, directory, "C0");
    expect(results[0].status).toBe("pass");
    expect(results[0].evidencePayload.managedDeviceCount).toBe(1);
  });

  test("fails when no session length policy is resolved", async () => {
    const directory = directoryWith([{ deviceId: "d1" }]);
    const chromepolicy = { customers: { policies: { resolve: async () => ({ data: { resolvedPolicies: [] } }) } } };
    const results = await checkChromePolicyCompliant(chromepolicy, directory, "C0");
    expect(results[0].status).toBe("fail");
  });

  test("resolves against the root org unit returned by orgunits.get", async () => {
    const directory = directoryWith([{ deviceId: "d1" }]);
    let capturedTargetResource;
    const chromepolicy = {
      customers: {
        policies: {
          resolve: async ({ requestBody }) => {
            capturedTargetResource = requestBody.policyTargetKey.targetResource;
            return { data: { resolvedPolicies: [] } };
          },
        },
      },
    };
    await checkChromePolicyCompliant(chromepolicy, directory, "C0");
    expect(capturedTargetResource).toBe("orgunits/id:root");
  });
});
