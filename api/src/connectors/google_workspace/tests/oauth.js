import { paginate } from "./pagination.js";

// Substrings matched against each authorized OAuth token's granted scopes.
// Any hit means the app holds broad read/write access to core company data
// (full Drive, full Gmail, or domain-wide Admin SDK control) rather than a
// narrow, purpose-specific scope.
const HIGH_RISK_SCOPE_SUBSTRINGS = [
  "auth/drive$",
  "auth/drive.file",
  "auth/gmail.modify",
  "auth/gmail.readonly",
  "auth/gmail$",
  "mail.google.com/",
  "auth/admin.directory.user$",
  "auth/admin.directory.group$",
];

function isHighRiskScope(scope) {
  return HIGH_RISK_SCOPE_SUBSTRINGS.some((pattern) => new RegExp(pattern).test(scope));
}

export async function checkThirdPartyAppRiskReviewed(directory, customerId) {
  const users = await paginate(
    (params) => directory.users.list(params),
    { customer: customerId, maxResults: 500, projection: "basic" },
    "users"
  );
  const activeUsers = users.filter((u) => !u.suspended);

  const flagged = [];
  for (const user of activeUsers) {
    let tokens;
    try {
      const { data } = await directory.tokens.list({ userKey: user.primaryEmail });
      tokens = data.items || [];
    } catch {
      // A user with no authorized third-party apps yields a 404 from this
      // endpoint on some accounts rather than an empty list — treat either
      // shape as "no tokens" rather than failing the whole check.
      tokens = [];
    }
    for (const token of tokens) {
      const riskyScopes = (token.scopes || []).filter(isHighRiskScope);
      if (riskyScopes.length > 0) {
        flagged.push({ email: user.primaryEmail, clientId: token.clientId, displayText: token.displayText, riskyScopes });
      }
    }
  }

  if (flagged.length === 0) {
    return [{
      resourceId: "domain",
      status: "pass",
      message: `No third-party app authorizations with high-risk scopes were found across ${activeUsers.length} active user(s)`,
      evidencePayload: { scannedUsers: activeUsers.length },
    }];
  }

  return flagged.map((f) => ({
    resourceId: `${f.email}:${f.clientId}`,
    status: "fail",
    message: `${f.displayText || f.clientId} is authorized for ${f.email} with high-risk scope(s): ${f.riskyScopes.join(", ")}`,
    evidencePayload: { email: f.email, clientId: f.clientId, displayText: f.displayText, riskyScopes: f.riskyScopes },
  }));
}

export const oauthTests = [
  {
    key: "google_workspace.oauth.third_party_app_risk_reviewed",
    title: "Third-party OAuth app authorizations are reviewed and restricted",
    failTitle: "Third-party app is authorized with a high-risk OAuth scope",
    severityDefault: "high",
    isoReferences: ["A.9.4.1"],
    dpdpaControlAreas: ["Access Control & Least Privilege"],
    run: (clients) => checkThirdPartyAppRiskReviewed(clients.directory, clients.customerId),
  },
];
