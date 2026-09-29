import { buildEvidencePayload } from "../../shared/evidencePayload.js";

// Role identifiers / names that grant full Falcon console administration.
const ADMIN_ROLE_TOKENS = ["falcon_administrator", "falcon administrator", "falcon_console_admin", "falcon console admin"];

function roleStrings(user) {
  const roles = user?.roles ?? user?.role_ids ?? user?.roleIds ?? [];
  if (!Array.isArray(roles)) return [];
  return roles
    .map((r) => (typeof r === "string" ? r : r?.id ?? r?.name ?? r?.display_name ?? ""))
    .map((s) => String(s).toLowerCase())
    .filter(Boolean);
}

function isAdmin(user) {
  return roleStrings(user).some(
    (r) => ADMIN_ROLE_TOKENS.includes(r) || (r.includes("admin") && r.includes("falcon"))
  );
}

function userLabel(user) {
  const email = user?.uid ?? user?.email ?? null;
  const name = [user?.first_name, user?.last_name].filter(Boolean).join(" ").trim();
  return email || name || user?.uuid || "unknown";
}

// Falcon console administrator roles must be limited to a small, reviewed roster.
// The API exposes no expected-roster field, so this is a bounded-count + liveness
// check: the full admin roster is surfaced in evidence, and the check fails when
// the count exceeds the review threshold.
async function checkAdminRoleReview(clients) {
  const users = await clients.listConsoleUsers();

  if (users.length === 0) {
    return [
      {
        resourceId: "console-users",
        status: "not_applicable",
        message: "No Falcon console users were readable — grant the API client the User Management (user-management:read) scope to evidence this control",
        evidencePayload: buildEvidencePayload({ resourceType: "crowdstrike_user", resourceId: "console-users", resourceName: "Falcon console users", region: null, details: { users: 0 } }),
      },
    ];
  }

  const admins = users.filter(isAdmin);
  const threshold = clients.THRESHOLDS.ADMIN_COUNT_THRESHOLD;
  const roster = admins.map((u) => ({ user: userLabel(u), uuid: u.uuid ?? null }));

  const payload = buildEvidencePayload({
    resourceType: "crowdstrike_user",
    resourceId: "console-admins",
    resourceName: "Falcon console administrators",
    region: null,
    details: { totalConsoleUsers: users.length, administrators: admins.length, threshold, roster },
  });

  if (admins.length === 0) {
    return [
      {
        resourceId: "console-admins",
        status: "fail",
        message: "No Falcon console user holds an administrator role — confirm the connector's User Management scope resolves role assignments (a tenant with zero admins is implausible)",
        evidencePayload: payload,
      },
    ];
  }

  return [
    {
      resourceId: "console-admins",
      status: admins.length <= threshold ? "pass" : "fail",
      message:
        admins.length <= threshold
          ? `${admins.length} Falcon console administrator(s) (${roster.map((r) => r.user).join(", ")}) — within the review threshold of ${threshold}`
          : `${admins.length} Falcon console administrators exceeds the review threshold of ${threshold} — review the roster under User Management and remove administrator access from accounts that no longer require it`,
      evidencePayload: payload,
    },
  ];
}

export const userTests = [
  {
    key: "crowdstrike.user.admin_role_review",
    title: "Falcon console admin roles are limited to a reviewed set of accounts",
    failTitle: "Falcon console administrator access is not limited to a reviewed roster",
    severityDefault: "medium",
    isoReferences: ["A.9.2.3"],
    dpdpaControlAreas: ["Access Control"],
    run: (clients) => checkAdminRoleReview(clients),
  },
];
