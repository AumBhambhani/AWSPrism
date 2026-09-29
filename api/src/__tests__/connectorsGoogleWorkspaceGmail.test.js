import { describe, test, expect } from "vitest";
import { checkGmailAutoForwardingRestricted } from "../connectors/google_workspace/tests/gmail.js";

function cloudidentityWith(policies) {
  return { policies: { list: async () => ({ data: { policies } }) } };
}

describe("checkGmailAutoForwardingRestricted", () => {
  test("passes when auto-forwarding is disabled", async () => {
    const cloudidentity = cloudidentityWith([{ setting: { value: { enableAutoForwarding: false } }, policyQuery: {} }]);
    const results = await checkGmailAutoForwardingRestricted(cloudidentity, "C0");
    expect(results[0].status).toBe("pass");
  });

  test("fails when auto-forwarding is allowed", async () => {
    const cloudidentity = cloudidentityWith([{ setting: { value: { enableAutoForwarding: true } }, policyQuery: {} }]);
    const results = await checkGmailAutoForwardingRestricted(cloudidentity, "C0");
    expect(results[0].status).toBe("fail");
    expect(results[0].message).toBe("Automatic email forwarding to external addresses is allowed");
  });

  test("returns not_applicable when no policy is resolvable", async () => {
    const cloudidentity = cloudidentityWith([]);
    const results = await checkGmailAutoForwardingRestricted(cloudidentity, "C0");
    expect(results[0].status).toBe("not_applicable");
  });
});
