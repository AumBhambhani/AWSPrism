import { buildEvidencePayload } from "../../shared/evidencePayload.js";

function isTrue(v) {
  const s = String(v ?? "").toLowerCase();
  return s === "true" || s === "1" || s === "yes";
}

// Heuristic for "this is a service / integration account": ServiceNow's own
// `internal_integration_user` flag, or a user_name that follows a common
// service-account naming convention (svc.*, svc_*, *-svc, *.integration, api.*).
function looksLikeServiceAccount(user) {
  if (isTrue(user.internal_integration_user)) return true;
  const name = String(user.user_name ?? "").toLowerCase();
  return /^(svc|api|integration|service)[._-]/.test(name) || /[._-](svc|integration|service|api)$/.test(name);
}

function userPayload(user, details) {
  return buildEvidencePayload({
    resourceType: "servicenow_user",
    resourceId: String(user?.sys_id ?? user?.user_name ?? "unknown"),
    resourceName: user?.user_name ? String(user.user_name) : String(user?.name ?? user?.sys_id ?? "unknown"),
    region: null,
    details,
  });
}

// Integration / service accounts must have "Web service access only" set so the
// credential cannot be used for an interactive UI login.
async function checkWebServiceOnly(clients) {
  const users = await clients.listUsers();
  const active = users.filter((u) => isTrue(u.active));
  const serviceAccounts = active.filter(looksLikeServiceAccount);

  if (serviceAccounts.length === 0) {
    return [
      {
        resourceId: "service-accounts",
        status: "not_applicable",
        message: "No active user matches a service-account naming convention or the internal integration-user flag",
        evidencePayload: buildEvidencePayload({ resourceType: "servicenow_user", resourceId: "service-accounts", resourceName: "Service accounts", region: null, details: { activeUsers: active.length } }),
      },
    ];
  }

  const rows = [];
  for (const u of serviceAccounts) {
    if (!isTrue(u.web_service_access_only)) {
      rows.push({
        resourceId: String(u.sys_id),
        status: "fail",
        message: `Service account "${u.user_name ?? u.sys_id}" does not have "Web service access only" set — the credential can be used for interactive login`,
        evidencePayload: userPayload(u, {
          webServiceAccessOnly: false,
          internalIntegrationUser: isTrue(u.internal_integration_user),
        }),
      });
    }
  }

  if (rows.length === 0) {
    return [
      {
        resourceId: "service-accounts",
        status: "pass",
        message: `All ${serviceAccounts.length} service account(s) are restricted to web service access only`,
        evidencePayload: buildEvidencePayload({ resourceType: "servicenow_user", resourceId: "service-accounts", resourceName: "Service accounts", region: null, details: { serviceAccountsChecked: serviceAccounts.length } }),
      },
    ];
  }
  return rows;
}

// The instance password policy must enforce a minimum length. Prism reads the
// Password Policy plugin table where present, falling back to the
// glide.security.password.* properties; if neither is readable the check is
// not_applicable rather than a false fail.
async function checkPasswordPolicyStrength(clients) {
  const MIN_LENGTH = 8;
  let policies = [];
  let policyTableReadable = true;
  try {
    policies = await clients.listPasswordPolicies();
  } catch {
    policyTableReadable = false;
  }

  const activePolicies = policies.filter((p) => {
    const flag = clients.displayOf(p.active) ?? clients.valueOf(p.active);
    return flag == null || isTrue(flag);
  });

  const lengths = activePolicies
    .map((p) => Number(clients.displayOf(p.minimum_length) ?? clients.displayOf(p.min_length) ?? clients.valueOf(p.minimum_length) ?? clients.valueOf(p.min_length)))
    .filter((n) => Number.isFinite(n) && n > 0);

  const propLength = Number(
    (await clients.getProperty("glide.security.password.minimum.length")) ??
      (await clients.getProperty("glide.security.password_policy.min_length"))
  );

  const effectiveMin = lengths.length ? Math.min(...lengths) : Number.isFinite(propLength) && propLength > 0 ? propLength : null;

  const payload = buildEvidencePayload({
    resourceType: "servicenow_password_policy",
    resourceId: "password-policy",
    resourceName: "Password policy",
    region: null,
    details: {
      activePolicies: activePolicies.length,
      minimumLengthObserved: effectiveMin,
      requiredMinimum: MIN_LENGTH,
      policyTableReadable,
    },
  });

  if (effectiveMin == null) {
    return [
      {
        resourceId: "password-policy",
        status: "not_applicable",
        message: "No readable password-policy record or property exposes a minimum length — attest the control from the instance's Password Policies directly",
        evidencePayload: payload,
      },
    ];
  }

  return [
    {
      resourceId: "password-policy",
      status: effectiveMin >= MIN_LENGTH ? "pass" : "fail",
      message:
        effectiveMin >= MIN_LENGTH
          ? `Password policy enforces a minimum length of ${effectiveMin}`
          : `Password policy minimum length is ${effectiveMin}, below the required ${MIN_LENGTH}`,
      evidencePayload: payload,
    },
  ];
}

// Basic Authentication for REST must be restricted in favour of OAuth. Prism
// looks for an active REST API Access Policy; the table name and semantics vary
// across releases, so a table that can't be read / doesn't exist yields
// not_applicable with guidance.
async function checkBasicAuthRestricted(clients) {
  let policies;
  try {
    policies = await clients.listApiAccessPolicies();
  } catch {
    return [
      {
        resourceId: "api-access-policies",
        status: "not_applicable",
        message:
          "REST API Access Policies are not readable on this instance (feature not in use, or the table is not accessible). Confirm Basic Auth is restricted under System Web Services → REST → API Access Policies.",
        evidencePayload: buildEvidencePayload({ resourceType: "servicenow_api_access_policy", resourceId: "api-access-policies", resourceName: "REST API Access Policies", region: null, details: {} }),
      },
    ];
  }

  const active = policies.filter((p) => {
    const flag = clients.displayOf(p.active) ?? clients.valueOf(p.active);
    return flag == null || isTrue(flag);
  });

  const payload = buildEvidencePayload({
    resourceType: "servicenow_api_access_policy",
    resourceId: "api-access-policies",
    resourceName: "REST API Access Policies",
    region: null,
    details: { totalPolicies: policies.length, activePolicies: active.length },
  });

  return [
    {
      resourceId: "api-access-policies",
      status: active.length > 0 ? "pass" : "fail",
      message:
        active.length > 0
          ? `${active.length} active REST API Access Policy(ies) are in place to restrict authentication`
          : "No active REST API Access Policy restricts Basic Authentication for REST access",
      evidencePayload: payload,
    },
  ];
}

export const accountTests = [
  {
    key: "servicenow.integrationuser.web_service_only",
    title: "Integration/service accounts are restricted to web service access",
    failTitle: "A service account is not restricted to web service access only",
    severityDefault: "high",
    isoReferences: ["A.9.2.3"],
    dpdpaControlAreas: ["Access Control"],
    run: (clients) => checkWebServiceOnly(clients),
  },
  {
    key: "servicenow.password_policy.strength_enforced",
    title: "Password policy meets minimum strength requirements",
    failTitle: "The instance password policy does not enforce a sufficient minimum length",
    severityDefault: "high",
    isoReferences: ["A.9.4.3"],
    dpdpaControlAreas: ["Access Control"],
    run: (clients) => checkPasswordPolicyStrength(clients),
  },
  {
    key: "servicenow.oauth.basic_auth_restricted",
    title: "Basic Authentication is restricted for REST API access",
    failTitle: "No REST API Access Policy restricts Basic Authentication",
    severityDefault: "high",
    isoReferences: ["A.9.4.2"],
    dpdpaControlAreas: ["Access Control"],
    run: (clients) => checkBasicAuthRestricted(clients),
  },
];
