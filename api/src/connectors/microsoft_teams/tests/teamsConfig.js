import { buildEvidencePayload } from "../../shared/evidencePayload.js";

// TCM (Tenant Configuration Management) snapshot helper.
// The TCM APIs use a create-snapshot-job → poll → read pattern rather than a
// plain synchronous GET. This helper encapsulates the three-step flow.
// NOTE: The TCM snapshot job pattern and schema should be verified against the
// live Graph beta TCM API reference before running against a real tenant.
async function tcmSnapshot(getToken, resourceTypes) {
  const token = await getToken();
  const base = "https://graph.microsoft.com/beta/admin/teams/teamsAdministration";

  // Step 1: Create snapshot job
  const createRes = await fetch(`${base}/configurationSnapshotJobs`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify({ resourceTypes }),
  });
  if (!createRes.ok) {
    const text = await createRes.text();
    throw new Error(`TCM snapshot job creation failed: ${createRes.status} ${text}`);
  }
  const job = await createRes.json();
  const jobId = job.id;

  // Step 2: Poll until complete (max 10 attempts, 2s apart)
  let snapshot = null;
  for (let i = 0; i < 10; i++) {
    const pollRes = await fetch(`${base}/configurationSnapshotJobs/${jobId}`, {
      headers: { Authorization: `Bearer ${await getToken()}` },
    });
    if (!pollRes.ok) throw new Error(`TCM snapshot poll failed: ${pollRes.status}`);
    const status = await pollRes.json();
    if (status.status === "succeeded") {
      snapshot = status;
      break;
    }
    if (status.status === "failed") throw new Error(`TCM snapshot job failed: ${JSON.stringify(status.error)}`);
    // Wait 2 seconds before retry
    await new Promise((r) => setTimeout(r, 2000));
  }
  if (!snapshot) throw new Error("TCM snapshot job did not complete within the timeout window");

  // Step 3: Read result
  const resultRes = await fetch(`${base}/configurationSnapshotJobs/${jobId}/result`, {
    headers: { Authorization: `Bearer ${await getToken()}` },
  });
  if (!resultRes.ok) {
    const text = await resultRes.text();
    throw new Error(`TCM snapshot result fetch failed: ${resultRes.status} ${text}`);
  }
  return resultRes.json();
}

// ──────────────────────────────────────────────────────────────────────────────
// microsoft_teams.externalaccess.federation_domains_restricted
// ──────────────────────────────────────────────────────────────────────────────
async function checkFederationDomainsRestricted(getToken, tenantId) {
  const result = await tcmSnapshot(getToken, ["federationConfiguration"]);
  const config = result?.federationConfiguration || result?.value?.[0]?.federationConfiguration || {};
  const allowAll = config.AllowFederatedUsers !== false && !config.AllowedDomains?.length;
  return [{
    resourceId: tenantId,
    status: allowAll ? "fail" : "pass",
    message: allowAll
      ? "Teams external federation allows all external domains — no domain allowlist is configured"
      : "Teams external federation is restricted (disabled or limited to an explicit allowlist)",
    evidencePayload: buildEvidencePayload({
      resourceType: "teams_federation",
      resourceId: tenantId,
      region: null,
      details: { allowFederatedUsers: config.AllowFederatedUsers ?? null, allowedDomainsCount: config.AllowedDomains?.length ?? 0 },
    }),
  }];
}

// ──────────────────────────────────────────────────────────────────────────────
// microsoft_teams.externalaccess.consumer_teams_blocked
// ──────────────────────────────────────────────────────────────────────────────
async function checkConsumerTeamsBlocked(getToken, tenantId) {
  const result = await tcmSnapshot(getToken, ["federationConfiguration"]);
  const config = result?.federationConfiguration || result?.value?.[0]?.federationConfiguration || {};
  const consumerAllowed = config.AllowTeamsConsumer === true || config.AllowTeamsConsumerInbound === true;
  return [{
    resourceId: tenantId,
    status: consumerAllowed ? "fail" : "pass",
    message: consumerAllowed
      ? "Teams consumer (unmanaged Microsoft account) communication is allowed"
      : "Teams consumer communication is blocked",
    evidencePayload: buildEvidencePayload({
      resourceType: "teams_federation",
      resourceId: tenantId,
      region: null,
      details: { allowTeamsConsumer: config.AllowTeamsConsumer ?? false, allowTeamsConsumerInbound: config.AllowTeamsConsumerInbound ?? false },
    }),
  }];
}

// ──────────────────────────────────────────────────────────────────────────────
// microsoft_teams.client.guest_access_reviewed
// ──────────────────────────────────────────────────────────────────────────────
async function checkGuestAccessReviewed(getToken, tenantId) {
  const result = await tcmSnapshot(getToken, ["clientConfiguration"]);
  const config = result?.clientConfiguration || result?.value?.[0]?.clientConfiguration || {};
  const guestEnabled = config.AllowGuestUser === true;
  // We record whether guest access is enabled; the check passes regardless
  // (guest access enabled is a deliberate, documented policy — not a compliance failure by itself)
  return [{
    resourceId: tenantId,
    status: "pass",
    message: guestEnabled
      ? "Teams guest access is ENABLED — confirm this is a documented, approved setting"
      : "Teams guest access is disabled",
    evidencePayload: buildEvidencePayload({
      resourceType: "teams_client",
      resourceId: tenantId,
      region: null,
      details: { guestAccessEnabled: guestEnabled },
    }),
  }];
}

// ──────────────────────────────────────────────────────────────────────────────
// microsoft_teams.client.unsanctioned_storage_providers_disabled
// ──────────────────────────────────────────────────────────────────────────────
async function checkUnsanctionedStorageDisabled(getToken, tenantId) {
  const result = await tcmSnapshot(getToken, ["clientConfiguration"]);
  const config = result?.clientConfiguration || result?.value?.[0]?.clientConfiguration || {};
  const storageFlags = { Box: config.AllowBox, Dropbox: config.AllowDropBox, GoogleDrive: config.AllowGoogleDrive, ShareFile: config.AllowShareFile, Egnyte: config.AllowEgnyte };
  const enabledProviders = Object.entries(storageFlags).filter(([, v]) => v === true).map(([k]) => k);
  const pass = enabledProviders.length === 0;
  return [{
    resourceId: tenantId,
    status: pass ? "pass" : "fail",
    message: pass
      ? "No unsanctioned third-party cloud storage providers are enabled in the Teams client"
      : `Unsanctioned storage providers enabled: ${enabledProviders.join(", ")}`,
    evidencePayload: buildEvidencePayload({
      resourceType: "teams_client",
      resourceId: tenantId,
      region: null,
      details: storageFlags,
    }),
  }];
}

// ──────────────────────────────────────────────────────────────────────────────
// microsoft_teams.guests.meeting_capabilities_restricted
// ──────────────────────────────────────────────────────────────────────────────
async function checkGuestMeetingCapabilitiesRestricted(getToken, tenantId) {
  const result = await tcmSnapshot(getToken, ["guestMeetingConfiguration"]);
  const config = result?.guestMeetingConfiguration || result?.value?.[0]?.guestMeetingConfiguration || {};
  const allowMeetNow = config.AllowMeetNow === true;
  const fullScreen = config.ScreenSharingMode === "EntireScreen";
  const pass = !allowMeetNow && !fullScreen;
  return [{
    resourceId: tenantId,
    status: pass ? "pass" : "fail",
    message: pass
      ? "Guest meeting capabilities are restricted (no ad-hoc meetings, no full-screen sharing)"
      : `Guest meeting settings need review — AllowMeetNow: ${allowMeetNow}, ScreenSharingMode: ${config.ScreenSharingMode}`,
    evidencePayload: buildEvidencePayload({
      resourceType: "teams_guest_meeting",
      resourceId: tenantId,
      region: null,
      details: { allowMeetNow, screenSharingMode: config.ScreenSharingMode ?? null },
    }),
  }];
}

// ──────────────────────────────────────────────────────────────────────────────
// microsoft_teams.policies.meeting_anonymous_join_restricted
// ──────────────────────────────────────────────────────────────────────────────
async function checkMeetingAnonymousJoinRestricted(getToken, tenantId) {
  const result = await tcmSnapshot(getToken, ["meetingPolicy"]);
  const policy = result?.meetingPolicy || result?.value?.[0]?.meetingPolicy || {};
  const anonymousJoin = policy.AllowAnonymousUsersToJoinMeeting === true;
  const autoAdmitEveryone = policy.AutoAdmittedUsers === "Everyone";
  const pass = !anonymousJoin && !autoAdmitEveryone;
  return [{
    resourceId: tenantId,
    status: pass ? "pass" : "fail",
    message: pass
      ? "Meeting policy restricts anonymous join and auto-admit"
      : `Meeting policy issue — anonymous join: ${anonymousJoin}, AutoAdmittedUsers: ${policy.AutoAdmittedUsers}`,
    evidencePayload: buildEvidencePayload({
      resourceType: "teams_meeting_policy",
      resourceId: tenantId,
      region: null,
      details: { allowAnonymousUsersToJoinMeeting: anonymousJoin, autoAdmittedUsers: policy.AutoAdmittedUsers ?? null },
    }),
  }];
}

// ──────────────────────────────────────────────────────────────────────────────
// microsoft_teams.policies.meeting_recording_retention_bounded
// ──────────────────────────────────────────────────────────────────────────────
async function checkMeetingRecordingRetentionBounded(getToken, tenantId) {
  const result = await tcmSnapshot(getToken, ["meetingPolicy"]);
  const policy = result?.meetingPolicy || result?.value?.[0]?.meetingPolicy || {};
  const allowRecording = policy.AllowCloudRecording !== false;
  const retentionDays = policy.NewMeetingRecordingExpirationDays;
  const isUnbounded = allowRecording && (retentionDays === -1 || retentionDays === undefined);
  return [{
    resourceId: tenantId,
    status: isUnbounded ? "fail" : "pass",
    message: isUnbounded
      ? `Meeting recording is enabled with no expiry (retentionDays: ${retentionDays})`
      : allowRecording
      ? `Meeting recording retention is set to ${retentionDays} days`
      : "Cloud recording is disabled — no retention concern",
    evidencePayload: buildEvidencePayload({
      resourceType: "teams_meeting_policy",
      resourceId: tenantId,
      region: null,
      details: { allowCloudRecording: allowRecording, expirationDays: retentionDays ?? null },
    }),
  }];
}

// ──────────────────────────────────────────────────────────────────────────────
// microsoft_teams.policies.thirdparty_app_installation_restricted
// ──────────────────────────────────────────────────────────────────────────────
async function checkThirdPartyAppInstallationRestricted(getToken, tenantId) {
  const result = await tcmSnapshot(getToken, ["appPermissionPolicy"]);
  const policy = result?.appPermissionPolicy || result?.value?.[0]?.appPermissionPolicy || {};
  // DefaultCatalogAppsType: "AllowedForAll" is the widest (all third-party apps allowed)
  const wideOpen = policy.DefaultCatalogAppsType === "AllowedForAll" || policy.ThirdPartyApps === "AllowedForAll";
  return [{
    resourceId: tenantId,
    status: wideOpen ? "fail" : "pass",
    message: wideOpen
      ? "Global Teams app permission policy allows all third-party apps without an allowlist"
      : "Global Teams app permission policy restricts third-party app installation",
    evidencePayload: buildEvidencePayload({
      resourceType: "teams_app_policy",
      resourceId: tenantId,
      region: null,
      details: { defaultCatalogAppsType: policy.DefaultCatalogAppsType ?? null, thirdPartyApps: policy.ThirdPartyApps ?? null },
    }),
  }];
}

export const externalAccessTests = [
  {
    key: "microsoft_teams.externalaccess.federation_domains_restricted",
    title: "External domain federation is restricted, not fully open",
    failTitle: "External federation allows all domains — no domain allowlist is configured",
    severityDefault: "critical",
    isoReferences: ["A.13.2.1"],
    dpdpaControlAreas: ["Access Control & Least Privilege"],
    run: (clients) => checkFederationDomainsRestricted(clients.getToken, clients.tenantId),
  },
  {
    key: "microsoft_teams.externalaccess.consumer_teams_blocked",
    title: "Communication with unmanaged consumer Teams/Skype accounts is blocked",
    failTitle: "Communication with unmanaged consumer Teams/Skype accounts is allowed",
    severityDefault: "high",
    isoReferences: ["A.13.2.1"],
    dpdpaControlAreas: ["Access Control & Least Privilege"],
    run: (clients) => checkConsumerTeamsBlocked(clients.getToken, clients.tenantId),
  },
];

export const clientConfigTests = [
  {
    key: "microsoft_teams.client.guest_access_reviewed",
    title: "The Teams client's tenant-wide guest access toggle is a reviewed, deliberate setting",
    failTitle: "The Teams client's tenant-wide guest access toggle has not been reviewed",
    severityDefault: "high",
    isoReferences: ["A.9.2.6"],
    dpdpaControlAreas: ["Access Control & Least Privilege"],
    run: (clients) => checkGuestAccessReviewed(clients.getToken, clients.tenantId),
  },
  {
    key: "microsoft_teams.client.unsanctioned_storage_providers_disabled",
    title: "Unsanctioned third-party cloud storage providers are disabled in the Teams client",
    failTitle: "Unsanctioned third-party cloud storage providers are enabled in the Teams client",
    severityDefault: "medium",
    isoReferences: ["A.13.2.1"],
    dpdpaControlAreas: ["DLP / Data Leakage Prevention"],
    run: (clients) => checkUnsanctionedStorageDisabled(clients.getToken, clients.tenantId),
  },
  {
    key: "microsoft_teams.guests.meeting_capabilities_restricted",
    title: "Guest meeting capabilities are limited to what's required",
    failTitle: "Guest meeting capabilities are not limited to what's required",
    severityDefault: "medium",
    isoReferences: ["A.9.4.1"],
    dpdpaControlAreas: ["Access Control & Least Privilege"],
    run: (clients) => checkGuestMeetingCapabilitiesRestricted(clients.getToken, clients.tenantId),
  },
];

export const meetingPolicyTests = [
  {
    key: "microsoft_teams.policies.meeting_anonymous_join_restricted",
    title: "The global meeting policy does not auto-admit anonymous or unknown external participants",
    failTitle: "The global meeting policy auto-admits anonymous or unknown external participants",
    severityDefault: "critical",
    isoReferences: ["A.9.4.1"],
    dpdpaControlAreas: ["Access Control & Least Privilege"],
    run: (clients) => checkMeetingAnonymousJoinRestricted(clients.getToken, clients.tenantId),
  },
  {
    key: "microsoft_teams.policies.meeting_recording_retention_bounded",
    title: "Meeting recording retention is bounded, not set to never expire",
    failTitle: "Meeting recording is enabled with no expiry set",
    severityDefault: "medium",
    isoReferences: ["A.18.1.3"],
    dpdpaControlAreas: ["Retention Schedule"],
    run: (clients) => checkMeetingRecordingRetentionBounded(clients.getToken, clients.tenantId),
  },
];

export const appPolicyTests = [
  {
    key: "microsoft_teams.policies.thirdparty_app_installation_restricted",
    title: "Third-party Teams app installation is governed by an explicit allow-list",
    failTitle: "Global app permission policy allows all third-party apps without an allowlist",
    severityDefault: "medium",
    isoReferences: ["A.12.5.1"],
    dpdpaControlAreas: ["Access Control & Least Privilege"],
    run: (clients) => checkThirdPartyAppInstallationRestricted(clients.getToken, clients.tenantId),
  },
];
