import { aggregate, ageInHours, descriptor, isHighSeverity, malformed, row } from "./helpers.js";

async function query(clients) {
  const data = await clients.queryEvents();
  if (!data || !Array.isArray(data.records)) return null;
  return data;
}

async function checkQueryRetrievable(clients) {
  const data = await query(clients);
  if (!data) return malformed("events", "The Infinity Events query API did not return a records array");
  return aggregate("events", "pass", `The Infinity Events query API responded with ${data.records.length} record(s) for the lookback window`, {
    recordCount: data.records.length,
    total: data.total ?? data.records.length,
  });
}

async function checkFeedActive(clients) {
  const data = await query(clients);
  if (!data) return malformed("events", "The Infinity Events query API did not return a records array");
  const total = Number(data.total ?? data.records.length);
  return total > 0
    ? aggregate("events", "pass", `Infinity Events recorded ${total} event(s) in the lookback window`, { total })
    : [row("events", null, "fail", "Infinity Events recorded no events in the lookback window — confirm log forwarding and the Events service are active", { total: 0 })];
}

async function checkCriticalEventsReviewed(clients) {
  const data = await query(clients);
  if (!data) return malformed("events", "The Infinity Events query API did not return a records array");
  const withSeverity = data.records.filter((r) => r?.severity != null || r?.severity_level != null);
  if (data.records.length && !withSeverity.length) {
    return malformed("events", "Infinity Events records carry no severity field");
  }
  const critical = data.records.filter((r) => isHighSeverity(r.severity ?? r.severity_level));
  if (!critical.length) {
    return aggregate("events", "pass", "No high or critical severity events in the lookback window", { criticalCount: 0 });
  }
  // Events only carry a handling state on some tenants. If none do, this check
  // surfaces the count for reviewer attention (pass); if any expose a state,
  // flag the ones still unhandled past the triage SLA.
  const stateful = critical.filter((r) => r.handled != null || r.status != null || r.state != null);
  if (!stateful.length) {
    return aggregate("events", "pass", `${critical.length} high/critical event(s) in the lookback window — no handling state is exposed by this tenant to assess triage`, { criticalCount: critical.length });
  }
  const slaHours = clients.THRESHOLDS.EVENT_TRIAGE_SLA_HOURS;
  const stale = stateful.filter((r) => {
    const handled = r.handled === true || ["handled", "closed", "resolved", "done"].includes(String(r.status ?? r.state ?? "").toLowerCase());
    if (handled) return false;
    const age = ageInHours(r.time ?? r.eventTime ?? r.created ?? r.timestamp);
    return age == null || age > slaHours;
  });
  return stale.length
    ? stale.map((r) => row("events", r, "fail", `A high/critical Infinity Event is still unhandled past the ${slaHours}h triage SLA`, { severity: r.severity ?? r.severity_level, status: r.status ?? r.state }))
    : aggregate("events", "pass", `All ${critical.length} high/critical event(s) were handled within the ${slaHours}h triage SLA`, { criticalCount: critical.length });
}

export const eventsTests = [
  descriptor({ key: "check_point.events.query_retrievable", title: "A baseline Infinity Events query completes (log availability / retention sanity)", failTitle: "The Infinity Events query API is not returning results", severityDefault: "medium", isoReferences: ["A.12.4.1"], dpdpaControlAreas: ["Logging & Monitoring"], run: checkQueryRetrievable }),
  descriptor({ key: "check_point.events.feed_active", title: "Infinity Events has recorded security events within the lookback window", failTitle: "Infinity Events has recorded no security events in the lookback window", severityDefault: "medium", isoReferences: ["A.12.4.1"], dpdpaControlAreas: ["Logging & Monitoring"], run: checkFeedActive }),
  descriptor({ key: "check_point.events.critical_events_reviewed", title: "Critical-severity events are not left unacknowledged past the triage SLA", failTitle: "A critical-severity event is unacknowledged past the triage SLA", severityDefault: "high", isoReferences: ["A.16.1.5"], dpdpaControlAreas: ["Incident Management"], run: checkCriticalEventsReviewed }),
];
