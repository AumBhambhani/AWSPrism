import { aggregate, descriptor, empty, malformed, row } from "./helpers.js";

async function firewalls(clients) {
  const items = await clients.listFirewalls();
  return Array.isArray(items) ? items : null;
}

async function booleanStatus(clients, field, desired, title) {
  const items = await firewalls(clients);
  if (!items?.length) return items ? empty("firewall", "No Central-managed firewalls were returned") : malformed("firewall", "Firewall response is malformed");
  const invalid = items.find((item) => typeof item?.status?.[field] !== "boolean");
  if (invalid) return malformed("firewall", `Firewall status.${field} is missing`, invalid);
  const findings = items.filter((item) => item.status[field] !== desired);
  return findings.length ? findings.map((item) => row("firewall", item, "fail", `${item.hostname ?? item.name} ${title}`, { status: item.status })) : aggregate("firewall", "pass", `All ${items.length} firewall(s) ${title.replace(/^is not /, "are ")}`, { firewallCount: items.length });
}

async function checkFirmware(clients) {
  const items = await firewalls(clients);
  if (!items?.length) return items ? empty("firewall", "No Central-managed firewalls were returned") : malformed("firewall", "Firewall response is malformed");
  const invalid = items.find((item) => typeof item.firmwareVersion !== "string");
  if (invalid) return malformed("firewall", "Firewall firmwareVersion is missing", invalid);
  const unsupported = items.filter((item) => item.firmwareLifecycle?.status && !["supported", "current"].includes(String(item.firmwareLifecycle.status).toLowerCase()));
  if (items.every((item) => !item.firmwareLifecycle?.status)) {
    return malformed("firewall", "Sophos Firewall API does not expose firmware lifecycle support status", items[0], { firmwareVersion: items[0].firmwareVersion, graceDays: clients.THRESHOLDS.FIRMWARE_EOL_GRACE_DAYS });
  }
  return unsupported.length ? unsupported.map((item) => row("firewall", item, "fail", `${item.hostname ?? item.name} firmware ${item.firmwareVersion} is ${item.firmwareLifecycle.status}`, { firmwareVersion: item.firmwareVersion, lifecycle: item.firmwareLifecycle })) : aggregate("firewall", "pass", "All firewall firmware versions report supported lifecycle status", { firewallCount: items.length });
}

async function checkHa(clients) {
  const items = await firewalls(clients);
  if (!items?.length) return items ? empty("firewall", "No Central-managed firewalls were returned") : malformed("firewall", "Firewall response is malformed");
  const expected = items.filter((item) => item.haExpected === true || item.tags?.includes("ha-required"));
  if (!expected.length) return empty("firewall", "No firewall is marked as requiring high availability", { firewallCount: items.length });
  const missing = expected.filter((item) => !item.cluster || item.cluster.status === "standalone");
  return missing.length ? missing.map((item) => row("firewall", item, "fail", `${item.hostname ?? item.name} is marked HA-required but is not in an HA pair`, { cluster: item.cluster ?? null })) : aggregate("firewall", "pass", "All HA-required firewalls are members of an HA cluster", { expectedCount: expected.length });
}

async function checkSync(clients) {
  const groups = await clients.listFirewallGroups();
  if (!Array.isArray(groups)) return malformed("firewall_group", "Firewall group response is malformed");
  if (!groups.length) return empty("firewall_group", "No firewall groups were returned");
  const invalid = groups.find((group) => group.syncStatus == null && group.configurationStatus == null);
  if (invalid) return malformed("firewall_group", "Firewall group configuration sync status is not exposed", invalid);
  const bad = groups.filter((group) => !["success", "synchronized", "inSync"].includes(group.syncStatus ?? group.configurationStatus));
  return bad.length ? bad.map((group) => row("firewall_group", group, "fail", `Firewall group ${group.name} configuration sync is ${group.syncStatus ?? group.configurationStatus}`, { syncStatus: group.syncStatus ?? group.configurationStatus })) : aggregate("firewall_group", "pass", "All firewall-group configuration is synchronized", { groupCount: groups.length });
}

export const firewallTests = [
  descriptor({ key: "sophos.firewall.all_connected", title: "All Central-managed firewalls are online and connected", severityDefault: "high", isoReferences: ["A.13.1.1"], dpdpaControlAreas: ["Network Security"], run: (c) => booleanStatus(c, "connected", true, "is not connected") }),
  descriptor({ key: "sophos.firewall.firmware_current", title: "No managed firewall is running EOL/outdated firmware", severityDefault: "high", isoReferences: ["A.12.6.1"], dpdpaControlAreas: ["Network Security"], run: checkFirmware }),
  descriptor({ key: "sophos.firewall.central_management_active", title: "No firewall has Central management suspended", severityDefault: "medium", isoReferences: ["A.13.1.1"], dpdpaControlAreas: ["Network Security"], run: (c) => booleanStatus(c, "suspended", false, "has Central management suspended") }),
  descriptor({ key: "sophos.firewall.ha_configured", title: "Firewalls expected to be resilient are in an HA pair", severityDefault: "medium", isoReferences: ["A.13.1.1"], dpdpaControlAreas: ["Network Security"], run: checkHa }),
  descriptor({ key: "sophos.firewall.config_sync_healthy", title: "Firewall-group configuration sync reports no errors", severityDefault: "medium", isoReferences: ["A.12.1.2"], dpdpaControlAreas: ["Network Security"], run: checkSync }),
];
