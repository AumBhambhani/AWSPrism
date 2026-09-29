import { buildEvidencePayload } from "../../shared/evidencePayload.js";

// OAuth scope tokens that grant broad access. Salesforce returns scopes on
// OauthConfig.Scopes as tokens like "Api", "RefreshToken", "Full", "Web",
// "OpenID", "Address", "Email". "Full" is full user-data access; "Web" allows
// the app to act through the standard web UI session.
const BROAD_SCOPES = new Set(["full", "web"]);

function scopeList(app) {
  const cfg = app?.OauthConfig ?? app?.oauthConfig ?? null;
  const scopes = cfg?.Scopes ?? cfg?.scopes ?? app?.Scopes ?? null;
  if (!Array.isArray(scopes)) return null; // scopes not readable on this row
  return scopes.map((s) => String(s).toLowerCase());
}

function adminApproved(app) {
  const v = app?.OptionsAllowAdminApprovedUsersOnly ?? app?.optionsAllowAdminApprovedUsersOnly;
  return v === true || String(v).toLowerCase() === "true";
}

// ---------------------------------------------------------------------------
// salesforce.connected_app.oauth_scopes_minimal
// ---------------------------------------------------------------------------
async function checkOauthScopesMinimal(clients) {
  const apps = await clients.listConnectedApps();

  if (!Array.isArray(apps) || apps.length === 0) {
    return [
      {
        resourceId: "connected-apps",
        status: "not_applicable",
        message: "No connected apps are configured on this org",
        evidencePayload: buildEvidencePayload({
          resourceType: "salesforce_connected_app",
          resourceId: "connected-apps",
          resourceName: "Connected apps",
          region: null,
          details: { connectedApps: 0 },
        }),
      },
    ];
  }

  const withScopes = apps.map((a) => ({ app: a, scopes: scopeList(a) }));
  const readable = withScopes.filter((x) => x.scopes !== null);

  if (readable.length === 0) {
    return [
      {
        resourceId: "connected-apps",
        status: "not_applicable",
        message:
          `${apps.length} connected app(s) found, but OAuth scopes were not returned by the API — ` +
          `grant the integration user access to the Tooling API's ConnectedApplication.OauthConfig, ` +
          `or review scopes manually under Setup > App Manager.`,
        evidencePayload: buildEvidencePayload({
          resourceType: "salesforce_connected_app",
          resourceId: "connected-apps",
          resourceName: "Connected apps",
          region: null,
          details: { connectedApps: apps.length, scopesReadable: 0 },
        }),
      },
    ];
  }

  const offenders = readable.filter((x) => x.scopes.some((s) => BROAD_SCOPES.has(s)));

  if (offenders.length === 0) {
    return [
      {
        resourceId: "connected-apps",
        status: "pass",
        message: `None of the ${readable.length} connected app(s) with readable scopes request "full" or "web" access`,
        evidencePayload: buildEvidencePayload({
          resourceType: "salesforce_connected_app",
          resourceId: "connected-apps",
          resourceName: "Connected apps",
          region: null,
          details: { connectedApps: apps.length, scopesReadable: readable.length, broadScopeApps: 0 },
        }),
      },
    ];
  }

  return offenders.map(({ app, scopes }) => ({
    resourceId: String(app.Id ?? app.Name),
    status: "fail",
    message: `Connected app "${app.Name}" requests broad OAuth scope(s): ${scopes.filter((s) => BROAD_SCOPES.has(s)).join(", ")} — remove unused scopes; prefer "api" + "refresh_token" over "full"`,
    evidencePayload: buildEvidencePayload({
      resourceType: "salesforce_connected_app",
      resourceId: String(app.Id ?? app.Name),
      resourceName: String(app.Name),
      region: null,
      details: { scopes, broadScopes: scopes.filter((s) => BROAD_SCOPES.has(s)) },
    }),
  }));
}

// ---------------------------------------------------------------------------
// salesforce.connected_app.admin_approval_required
// ---------------------------------------------------------------------------
async function checkAdminApprovalRequired(clients) {
  const apps = await clients.listConnectedApps();

  if (!Array.isArray(apps) || apps.length === 0) {
    return [
      {
        resourceId: "connected-apps",
        status: "not_applicable",
        message: "No connected apps are configured on this org",
        evidencePayload: buildEvidencePayload({
          resourceType: "salesforce_connected_app",
          resourceId: "connected-apps",
          resourceName: "Connected apps",
          region: null,
          details: { connectedApps: 0 },
        }),
      },
    ];
  }

  const offenders = apps.filter((a) => !adminApproved(a));

  if (offenders.length === 0) {
    return [
      {
        resourceId: "connected-apps",
        status: "pass",
        message: `All ${apps.length} connected app(s) require admin pre-authorization ("Admin approved users are pre-authorized")`,
        evidencePayload: buildEvidencePayload({
          resourceType: "salesforce_connected_app",
          resourceId: "connected-apps",
          resourceName: "Connected apps",
          region: null,
          details: { connectedApps: apps.length, selfAuthorizeApps: 0 },
        }),
      },
    ];
  }

  return offenders.map((a) => ({
    resourceId: String(a.Id ?? a.Name),
    status: "fail",
    message: `Connected app "${a.Name}" allows users to self-authorize — set OAuth Policies > Permitted Users to "Admin approved users are pre-authorized" and assign only the profiles/permission sets that need it`,
    evidencePayload: buildEvidencePayload({
      resourceType: "salesforce_connected_app",
      resourceId: String(a.Id ?? a.Name),
      resourceName: String(a.Name),
      region: null,
      details: { permittedUsers: "all_users_may_self_authorize" },
    }),
  }));
}

export const connectedAppTests = [
  {
    key: "salesforce.connected_app.oauth_scopes_minimal",
    title: "Connected/External Client Apps do not request excessive OAuth scopes",
    failTitle: "A connected app requests excessive OAuth scopes",
    severityDefault: "high",
    isoReferences: ["A.9.1.2"],
    dpdpaControlAreas: ["Access Control"],
    run: (clients) => checkOauthScopesMinimal(clients),
  },
  {
    key: "salesforce.connected_app.admin_approval_required",
    title: "Connected Apps require admin pre-authorization",
    failTitle: "A connected app allows users to self-authorize",
    severityDefault: "high",
    isoReferences: ["A.9.2.2"],
    dpdpaControlAreas: ["Access Control"],
    run: (clients) => checkAdminApprovalRequired(clients),
  },
];
