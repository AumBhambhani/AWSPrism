import { buildEvidencePayload } from "../../shared/evidencePayload.js";

const ADMIN_PROFILE_NAMES = ["system administrator"];
const isAdminProfileName = (name) => ADMIN_PROFILE_NAMES.includes(String(name || "").trim().toLowerCase());
const isActive = (u) => u?.IsActive === true || String(u?.IsActive).toLowerCase() === "true";

// Salesforce encodes PasswordExpiration as a code, not a day count:
// 0 = never, 1 = 30 days, 2 = 60, 3 = 90, 4 = 180, 5 = 1 year.
const EXPIRATION_DAYS = { 0: Infinity, 1: 30, 2: 60, 3: 90, 4: 180, 5: 365 };
function expirationDays(code) {
  const n = Number(code);
  return EXPIRATION_DAYS[n] ?? null;
}
// PasswordComplexity: 0 = no restriction, 1 = alpha+numeric, 2 = alpha+numeric+special,
// 3 = must not contain username fragments, ... — anything >= 1 counts as "complexity required".
function hasComplexity(code) {
  return Number(code) >= 1;
}

// ---------------------------------------------------------------------------
// salesforce.profile.password_policy_strength
// ---------------------------------------------------------------------------
// Every profile's password policy must meet the baseline: minimum length,
// complexity enforced, and expiration within the policy ceiling. Profiles with
// no ProfilePasswordPolicy row inherit the org default — which is not readable
// via a stable API surface, so those are surfaced as "inherits org default
// (verify manually)" rather than passed or failed.
async function checkPasswordPolicyStrength(clients) {
  const policies = await clients.listProfilePasswordPolicies();
  const minLen = clients.THRESHOLDS.PASSWORD_MIN_LENGTH;
  const maxExpire = clients.THRESHOLDS.PASSWORD_MAX_EXPIRE_DAYS;

  let profileNameById = new Map();
  try {
    const profiles = await clients.listProfiles();
    profileNameById = new Map(profiles.map((p) => [String(p.Id), p.Name]));
  } catch {
    /* names are cosmetic — fall back to the raw ProfileId */
  }

  if (!Array.isArray(policies) || policies.length === 0) {
    return [
      {
        resourceId: "password-policies",
        status: "not_applicable",
        message:
          "No per-profile password policies were returned — every profile appears to inherit the org default " +
          "password policy, which Prism cannot read via the API. Verify Setup > Password Policies manually.",
        evidencePayload: buildEvidencePayload({
          resourceType: "salesforce_password_policy",
          resourceId: "password-policies",
          resourceName: "Profile password policies",
          region: null,
          details: { profilePoliciesFound: 0, minLength: minLen, maxExpireDays: maxExpire },
        }),
      },
    ];
  }

  const rows = [];
  for (const p of policies) {
    const profileId = String(p.ProfileId);
    const name = profileNameById.get(profileId) || profileId;
    const length = Number(p.MinimumPasswordLength);
    const expDays = expirationDays(p.PasswordExpiration);
    const complexity = hasComplexity(p.PasswordComplexity);

    const failures = [];
    if (!Number.isFinite(length) || length < minLen) failures.push(`minimum length ${length || "unset"} < ${minLen}`);
    if (!complexity) failures.push("complexity not enforced");
    if (expDays == null) failures.push("expiration code unrecognised");
    else if (expDays > maxExpire) failures.push(`expiration ${expDays === Infinity ? "never" : expDays + "d"} > ${maxExpire}d`);

    rows.push({
      resourceId: profileId,
      status: failures.length === 0 ? "pass" : "fail",
      message:
        failures.length === 0
          ? `Profile "${name}" password policy meets the baseline (>= ${minLen} chars, complexity on, expiry <= ${maxExpire}d)`
          : `Profile "${name}" password policy is weak: ${failures.join("; ")} — tighten it under Setup > Profiles > ${name} > Password Policies`,
      evidencePayload: buildEvidencePayload({
        resourceType: "salesforce_password_policy",
        resourceId: profileId,
        resourceName: name,
        region: null,
        details: {
          minimumPasswordLength: length,
          complexityEnforced: complexity,
          expirationDays: expDays === Infinity ? "never" : expDays,
          maxLoginAttempts: p.MaxLoginAttempts ?? null,
          baseline: { minLength: minLen, maxExpireDays: maxExpire },
        },
      }),
    });
  }
  return rows;
}

// ---------------------------------------------------------------------------
// salesforce.profile.least_privilege_admin_count
// ---------------------------------------------------------------------------
// The count of active users on the System Administrator profile must stay within
// the review threshold.
async function checkLeastPrivilegeAdminCount(clients) {
  const users = await clients.listUsers();
  const threshold = clients.THRESHOLDS.ADMIN_PROFILE_COUNT_THRESHOLD;

  const admins = users.filter((u) => isActive(u) && isAdminProfileName(u.Profile?.Name));
  const roster = admins.map((u) => u.Username);

  const payload = buildEvidencePayload({
    resourceType: "salesforce_profile",
    resourceId: "system-administrator",
    resourceName: "System Administrator profile",
    region: null,
    details: { activeAdminUsers: admins.length, threshold, roster },
  });

  if (admins.length === 0) {
    return [
      {
        resourceId: "system-administrator",
        status: "not_applicable",
        message:
          "No active user is on a profile named \"System Administrator\" — if admin rights are granted via a " +
          "renamed profile or permission sets, the sensitive-permissions check covers that case instead.",
        evidencePayload: payload,
      },
    ];
  }

  return [
    {
      resourceId: "system-administrator",
      status: admins.length <= threshold ? "pass" : "fail",
      message:
        admins.length <= threshold
          ? `${admins.length} active System Administrator user(s) (${roster.join(", ")}) — within the review threshold of ${threshold}`
          : `${admins.length} active users hold the System Administrator profile, exceeding the review threshold of ${threshold} — move users who don't need full admin rights to a scoped permission set`,
      evidencePayload: payload,
    },
  ];
}

export const profileTests = [
  {
    key: "salesforce.profile.password_policy_strength",
    title: "Org password policy meets minimum strength requirements",
    failTitle: "A profile's password policy is below the strength baseline",
    severityDefault: "high",
    isoReferences: ["A.9.4.3"],
    dpdpaControlAreas: ["Access Control"],
    run: (clients) => checkPasswordPolicyStrength(clients),
  },
  {
    key: "salesforce.profile.least_privilege_admin_count",
    title: "Number of users with the System Administrator profile is within policy",
    failTitle: "Too many active users hold the System Administrator profile",
    severityDefault: "medium",
    isoReferences: ["A.9.2.3"],
    dpdpaControlAreas: ["Access Control"],
    run: (clients) => checkLeastPrivilegeAdminCount(clients),
  },
];
