import { ageInHours, aggregate, descriptor, empty, malformed, row } from "./helpers.js";

async function alerts(clients) {
  const items = await clients.listAlerts();
  return Array.isArray(items) ? items : null;
}

const severity = (item) => String(item?.severity ?? "").toLowerCase();

async function checkCritical(clients) {
  const items = await alerts(clients);
  if (!items) return malformed("common_alert", "Common alerts response is malformed");
  const findings = items.filter((item) => severity(item) === "critical");
  return findings.length ? findings.map((item) => row("common_alert", item, "fail", `Critical alert "${item.description ?? item.type ?? item.id}" is unresolved`, { severity: item.severity, raisedAt: item.raisedAt ?? item.createdAt ?? null })) : aggregate("common_alert", "pass", "No unresolved critical Sophos Central alerts were returned", { alertCount: items.length });
}

async function checkHighAge(clients) {
  const items = await alerts(clients);
  if (!items) return malformed("common_alert", "Common alerts response is malformed");
  const high = items.filter((item) => severity(item) === "high");
  const unknown = high.find((item) => ageInHours(item.raisedAt ?? item.createdAt) == null);
  if (unknown) return malformed("common_alert", "High-severity alert timestamp is missing or invalid", unknown);
  const thresholdHours = clients.THRESHOLDS.HIGH_SEV_ALERT_TRIAGE_HOURS;
  const findings = high.filter((item) => ageInHours(item.raisedAt ?? item.createdAt) > thresholdHours);
  return findings.length ? findings.map((item) => row("common_alert", item, "fail", `High alert "${item.description ?? item.id}" is older than the ${thresholdHours}-hour triage SLA`, { severity: item.severity, raisedAt: item.raisedAt ?? item.createdAt, thresholdHours })) : aggregate("common_alert", "pass", `No high-severity alert exceeds the ${thresholdHours}-hour triage SLA`, { alertCount: items.length, thresholdHours });
}

async function adminData(clients) {
  const [admins, roles] = await Promise.all([clients.listAdmins(), clients.listRoles()]);
  return { admins, roles };
}

async function checkAdminCount(clients) {
  const { admins } = await adminData(clients);
  if (!Array.isArray(admins)) return malformed("admin", "Admin response is malformed");
  const threshold = clients.THRESHOLDS.ADMIN_COUNT_THRESHOLD;
  return aggregate("admin", admins.length <= threshold ? "pass" : "fail", `${admins.length} Sophos Central admin(s) exist (policy threshold: ${threshold})`, { adminCount: admins.length, threshold, admins: admins.map((a) => a.profile?.email ?? a.id) });
}

async function checkSuperAdmins(clients) {
  const { admins, roles } = await adminData(clients);
  if (!Array.isArray(admins) || !Array.isArray(roles)) return malformed("admin", "Admin or role response is malformed");
  const superIds = new Set(roles.filter((role) => /super\s*admin/i.test(role.name || "") || role.permissionSets?.includes("central_admin")).map((role) => role.id));
  if (!superIds.size) return malformed("admin", "The Super Admin role could not be identified", null, { roleNames: roles.map((r) => r.name) });
  const members = admins.filter((admin) => admin.roleAssignments?.some((assignment) => superIds.has(assignment.roleId)));
  return aggregate("admin", members.length <= 2 ? "pass" : "fail", `${members.length} account(s) hold a Sophos Central Super Admin role`, { superAdminCount: members.length, admins: members.map((a) => a.profile?.email ?? a.id), expectedMaximum: 2 });
}

async function checkMfa(clients) {
  const setting = await clients.getMfaSettings();
  const enabled = setting?.enabled ?? setting?.mfaEnabled ?? setting?.enforced;
  if (typeof enabled !== "boolean") return malformed("common_setting", "Sophos MFA setting is missing an enabled boolean", setting);
  return aggregate("common_setting", enabled ? "pass" : "fail", enabled ? "MFA is enforced for Sophos Central administrators" : "MFA is not enforced for Sophos Central administrators", { enabled });
}

export const commonTests = [
  descriptor({ key: "sophos.common.no_unresolved_critical_alerts", title: "No unresolved critical Sophos Central alerts", severityDefault: "critical", isoReferences: ["A.16.1.5"], dpdpaControlAreas: ["Incident Management"], run: checkCritical }),
  descriptor({ key: "sophos.common.high_alerts_triaged", title: "No high-severity alerts older than the triage SLA", severityDefault: "high", isoReferences: ["A.16.1.4"], dpdpaControlAreas: ["Incident Management"], run: checkHighAge }),
  descriptor({ key: "sophos.common.admin_count_reasonable", title: "Sophos Central admin count is within the expected bound", severityDefault: "medium", isoReferences: ["A.9.2.3"], dpdpaControlAreas: ["Access Control"], run: checkAdminCount }),
  descriptor({ key: "sophos.common.super_admin_least_privilege", title: "Super Admin role membership is minimal", severityDefault: "high", isoReferences: ["A.9.2.3"], dpdpaControlAreas: ["Access Control"], run: checkSuperAdmins }),
  descriptor({ key: "sophos.common.mfa_enforced", title: "MFA is enforced for Sophos Central admin sign-in", severityDefault: "high", isoReferences: ["A.9.4.2"], dpdpaControlAreas: ["Access Control"], run: checkMfa }),
];
