import { describe, test, expect } from "vitest";
import { checkCalendarExternalSharingRestricted } from "../connectors/google_workspace/tests/calendar.js";

function cloudidentityWith(policies) {
  return { policies: { list: async () => ({ data: { policies } }) } };
}

describe("checkCalendarExternalSharingRestricted", () => {
  test("passes when external sharing is limited to free/busy only", async () => {
    const cloudidentity = cloudidentityWith([{ setting: { value: { maxAllowedExternalSharing: "EXTERNAL_FREE_BUSY_ONLY" } }, policyQuery: {} }]);
    const results = await checkCalendarExternalSharingRestricted(cloudidentity, "C0");
    expect(results[0].status).toBe("pass");
  });

  test("fails when external sharing exposes full event details", async () => {
    const cloudidentity = cloudidentityWith([{ setting: { value: { maxAllowedExternalSharing: "EXTERNAL_ALL_INFO_READ_WRITE" } }, policyQuery: {} }]);
    const results = await checkCalendarExternalSharingRestricted(cloudidentity, "C0");
    expect(results[0].status).toBe("fail");
    expect(results[0].message).toContain("EXTERNAL_ALL_INFO_READ_WRITE");
  });

  test("returns not_applicable when no policy is resolvable", async () => {
    const cloudidentity = cloudidentityWith([]);
    const results = await checkCalendarExternalSharingRestricted(cloudidentity, "C0");
    expect(results[0].status).toBe("not_applicable");
  });
});
