import { buildEvidencePayload } from "../../shared/evidencePayload.js";

// ---------------------------------------------------------------------------
// salesforce.network.trusted_ip_ranges_configured
// ---------------------------------------------------------------------------
// The org should restrict sign-in by network: either org-wide trusted IP ranges
// (Setup > Network Access, which suppress the identity-verification challenge)
// or per-profile Login IP Ranges (which hard-block logins outside the range).
// Per-profile ranges are the stronger control, so the check passes if EITHER is
// configured and calls out when only the weaker org-wide list exists.
async function checkTrustedIpRangesConfigured(clients) {
  let orgRanges = [];
  let profileRanges = [];
  let orgReadable = true;
  let profileReadable = true;

  try {
    orgRanges = (await clients.listOrgTrustedIpRanges()) || [];
  } catch {
    orgReadable = false;
  }
  try {
    profileRanges = (await clients.listProfileLoginIpRanges()) || [];
  } catch {
    profileReadable = false;
  }

  const payload = buildEvidencePayload({
    resourceType: "salesforce_network_access",
    resourceId: "network-access",
    resourceName: "Login IP restrictions",
    region: null,
    details: {
      orgWideTrustedIpRanges: orgReadable ? orgRanges.length : null,
      profileLoginIpRanges: profileReadable ? profileRanges.length : null,
      distinctProfilesWithLoginIpRanges: profileReadable
        ? new Set(profileRanges.map((r) => String(r.ProfileId))).size
        : null,
    },
  });

  if (!orgReadable && !profileReadable) {
    return [
      {
        resourceId: "network-access",
        status: "not_applicable",
        message:
          "Neither NetworkAccess (org-wide trusted IP ranges) nor LoginIp (per-profile ranges) was readable — " +
          'grant the integration user "View Setup and Configuration" to evidence this control.',
        evidencePayload: payload,
      },
    ];
  }

  if (profileRanges.length > 0) {
    const n = new Set(profileRanges.map((r) => String(r.ProfileId))).size;
    return [
      {
        resourceId: "network-access",
        status: "pass",
        message: `${n} profile(s) enforce Login IP Ranges${orgRanges.length ? ` and ${orgRanges.length} org-wide trusted IP range(s) are configured` : ""} — sign-in is network-restricted`,
        evidencePayload: payload,
      },
    ];
  }

  if (orgRanges.length > 0) {
    return [
      {
        resourceId: "network-access",
        status: "fail",
        message:
          `${orgRanges.length} org-wide trusted IP range(s) are configured, but no profile enforces a Login IP ` +
          `Range — org-wide ranges only suppress the verification challenge, they do not block out-of-range ` +
          `logins. Set profile-level Login IP Ranges for sensitive profiles.`,
        evidencePayload: payload,
      },
    ];
  }

  return [
    {
      resourceId: "network-access",
      status: "fail",
      message:
        "No login IP restrictions are configured — sign-in is allowed from any network. Configure Setup > " +
        "Network Access trusted IP ranges and/or profile-level Login IP Ranges for sensitive profiles.",
      evidencePayload: payload,
    },
  ];
}

export const networkTests = [
  {
    key: "salesforce.network.trusted_ip_ranges_configured",
    title: "Login IP restrictions or trusted ranges are configured",
    failTitle: "No effective login IP restrictions are configured",
    severityDefault: "medium",
    isoReferences: ["A.13.1.1"],
    dpdpaControlAreas: ["Network Security"],
    run: (clients) => checkTrustedIpRangesConfigured(clients),
  },
];
