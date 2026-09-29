import { ageInHours, aggregate, descriptor, empty, malformed, row } from "./helpers.js";

async function logs(clients) {
  const items = await clients.listAuditLogs();
  return Array.isArray(items) ? items : null;
}

async function checkRetrievable(clients) {
  const items = await logs(clients);
  if (!items) return malformed("audit_event", "Audit log response is malformed");
  if (!items.length) return empty("audit_event", "No audit events were returned for the lookback window", { lookbackDays: clients.THRESHOLDS.AUDIT_LOOKBACK_DAYS });
  const timestamps = items.map((item) => ageInHours(item.createdAt ?? item.timestamp ?? item.when)).filter((v) => v != null);
  if (!timestamps.length) return malformed("audit_event", "Audit event timestamps are missing", items[0]);
  return aggregate("audit_event", "pass", `${items.length} audit event(s) are retrievable`, { eventCount: items.length, oldestAgeDays: Math.round(Math.max(...timestamps) / 24), lookbackDays: clients.THRESHOLDS.AUDIT_LOOKBACK_DAYS });
}

async function checkAdminActivity(clients) {
  const items = await logs(clients);
  if (!items) return malformed("audit_event", "Audit log response is malformed");
  if (!items.length) return empty("audit_event", "No administrative activity appeared in the audit lookback window");
  const adminEvents = items.filter((item) => /admin|policy|setting|role|user/i.test(`${item.action ?? ""} ${item.eventType ?? ""} ${item.description ?? ""}`));
  return aggregate("audit_event", adminEvents.length ? "pass" : "fail", adminEvents.length ? `${adminEvents.length} administrative change event(s) are present in the audit log` : "Audit events were returned but no administrative change activity was identifiable", { eventCount: items.length, administrativeEvents: adminEvents.length });
}

async function checkCredentialChanges(clients) {
  const items = await logs(clients);
  if (!items) return malformed("audit_event", "Audit log response is malformed");
  const changes = items.filter((item) => /api.?credential|service.?principal/i.test(`${item.action ?? ""} ${item.eventType ?? ""} ${item.description ?? ""}`));
  return changes.length ? changes.map((item) => row("audit_event", item, "fail", `API credential change requires review: ${item.description ?? item.action ?? item.id}`, { action: item.action ?? item.eventType ?? null, timestamp: item.createdAt ?? item.timestamp ?? null })) : aggregate("audit_event", "pass", "No API credential create/delete events require review in the lookback window", { eventCount: items.length });
}

export const auditTests = [
  descriptor({ key: "sophos.audit.log_retrievable", title: "Audit events are retrievable for the full lookback window", severityDefault: "medium", isoReferences: ["A.12.4.1"], dpdpaControlAreas: ["Logging & Monitoring"], run: checkRetrievable }),
  descriptor({ key: "sophos.audit.admin_activity_logged", title: "Administrative changes appear in the audit log (completeness sanity check)", severityDefault: "medium", isoReferences: ["A.12.4.3"], dpdpaControlAreas: ["Logging & Monitoring"], run: checkAdminActivity }),
  descriptor({ key: "sophos.audit.api_credential_changes_reviewed", title: "API-credential create/delete events are surfaced for review", severityDefault: "medium", isoReferences: ["A.9.2.5"], dpdpaControlAreas: ["Access Control"], run: checkCredentialChanges }),
];
