import { describe, test, expect } from "vitest";
import { checkThirdPartyAppRiskReviewed } from "../connectors/google_workspace/tests/oauth.js";

function directoryFor(users, tokensByEmail) {
  return {
    users: { list: async () => ({ data: { users } }) },
    tokens: { list: async ({ userKey }) => ({ data: { items: tokensByEmail[userKey] || [] } }) },
  };
}

describe("checkThirdPartyAppRiskReviewed", () => {
  test("passes when no authorized app holds a high-risk scope", async () => {
    const directory = directoryFor(
      [{ primaryEmail: "a@acme.com", suspended: false }],
      { "a@acme.com": [{ clientId: "123", displayText: "Calendar Widget", scopes: ["https://www.googleapis.com/auth/calendar.readonly"] }] }
    );
    const results = await checkThirdPartyAppRiskReviewed(directory, "C0");
    expect(results).toEqual([{
      resourceId: "domain", status: "pass",
      message: "No third-party app authorizations with high-risk scopes were found across 1 active user(s)",
      evidencePayload: { scannedUsers: 1 },
    }]);
  });

  test("flags a token granted a high-risk full-Drive scope", async () => {
    const directory = directoryFor(
      [{ primaryEmail: "a@acme.com", suspended: false }],
      { "a@acme.com": [{ clientId: "123", displayText: "Risky App", scopes: ["https://www.googleapis.com/auth/drive"] }] }
    );
    const results = await checkThirdPartyAppRiskReviewed(directory, "C0");
    expect(results).toEqual([{
      resourceId: "a@acme.com:123", status: "fail",
      message: "Risky App is authorized for a@acme.com with high-risk scope(s): https://www.googleapis.com/auth/drive",
      evidencePayload: { email: "a@acme.com", clientId: "123", displayText: "Risky App", riskyScopes: ["https://www.googleapis.com/auth/drive"] },
    }]);
  });

  test("skips suspended users and tolerates a tokens.list failure for a given user", async () => {
    const directory = {
      users: { list: async () => ({ data: { users: [{ primaryEmail: "gone@acme.com", suspended: true }, { primaryEmail: "b@acme.com", suspended: false }] } }) },
      tokens: { list: async ({ userKey }) => { if (userKey === "b@acme.com") throw new Error("404"); return { data: { items: [] } }; } },
    };
    const results = await checkThirdPartyAppRiskReviewed(directory, "C0");
    expect(results[0].status).toBe("pass");
    expect(results[0].evidencePayload.scannedUsers).toBe(1);
  });
});
