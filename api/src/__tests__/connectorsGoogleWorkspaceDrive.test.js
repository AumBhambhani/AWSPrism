import { describe, test, expect } from "vitest";
import { checkDriveExternalSharingRestricted } from "../connectors/google_workspace/tests/drive.js";

function cloudidentityWith(policiesBySetting) {
  return {
    policies: {
      list: async ({ filter }) => {
        const settingType = /setting\.type=='settings\/([^']+)'/.exec(filter)[1];
        return { data: { policies: policiesBySetting[settingType] || [] } };
      },
    },
  };
}

describe("checkDriveExternalSharingRestricted", () => {
  test("passes when external sharing is restricted and default access isn't search-discoverable", async () => {
    const cloudidentity = cloudidentityWith({
      "drive_and_docs.external_sharing": [{ setting: { value: { externalSharingMode: "ALLOWLISTED_DOMAINS" } }, policyQuery: {} }],
      "drive_and_docs.general_access_default": [{ setting: { value: { defaultFileAccess: "PRIVATE_TO_OWNER" } }, policyQuery: {} }],
    });
    const results = await checkDriveExternalSharingRestricted(cloudidentity, "C0");
    expect(results.map((r) => r.status)).toEqual(["pass", "pass"]);
  });

  test("fails external sharing when unrestricted, independently of the access-default result", async () => {
    const cloudidentity = cloudidentityWith({
      "drive_and_docs.external_sharing": [{ setting: { value: { externalSharingMode: "ALLOWED" } }, policyQuery: {} }],
      "drive_and_docs.general_access_default": [{ setting: { value: { defaultFileAccess: "PRIVATE_TO_OWNER" } }, policyQuery: {} }],
    });
    const results = await checkDriveExternalSharingRestricted(cloudidentity, "C0");
    const [sharing, access] = results;
    expect(sharing.status).toBe("fail");
    expect(sharing.resourceId).toBe("drive_and_docs.external_sharing");
    expect(access.status).toBe("pass");
  });

  test("fails default access when search-discoverable", async () => {
    const cloudidentity = cloudidentityWith({
      "drive_and_docs.external_sharing": [{ setting: { value: { externalSharingMode: "DISALLOWED" } }, policyQuery: {} }],
      "drive_and_docs.general_access_default": [{ setting: { value: { defaultFileAccess: "PRIMARY_AUDIENCE_WITH_LINK_OR_SEARCH" } }, policyQuery: {} }],
    });
    const results = await checkDriveExternalSharingRestricted(cloudidentity, "C0");
    expect(results[1].status).toBe("fail");
  });

  test("returns not_applicable per setting when no policy is resolvable", async () => {
    const cloudidentity = cloudidentityWith({});
    const results = await checkDriveExternalSharingRestricted(cloudidentity, "C0");
    expect(results.every((r) => r.status === "not_applicable")).toBe(true);
  });
});
