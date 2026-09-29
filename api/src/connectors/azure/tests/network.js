const RISKY_PORTS = [22, 3389];
const OPEN_SOURCE_PREFIXES = ["*", "0.0.0.0/0", "internet", "any"];

function portRangeIncludesPort(portRange, port) {
  if (!portRange) return false;
  if (portRange === "*") return true;
  const single = Number(portRange);
  if (!Number.isNaN(single)) return single === port;
  const rangeMatch = portRange.match(/^(\d+)-(\d+)$/);
  if (rangeMatch) {
    const [, start, end] = rangeMatch;
    return port >= Number(start) && port <= Number(end);
  }
  return false;
}

function portRangeIncludesRiskyPort(portRange) {
  return RISKY_PORTS.some((port) => portRangeIncludesPort(portRange, port));
}

function hasOpenSource(rule) {
  const sources = [rule.sourceAddressPrefix, ...(rule.sourceAddressPrefixes || [])]
    .filter(Boolean)
    .map((s) => s.toLowerCase());
  return sources.some((source) => OPEN_SOURCE_PREFIXES.includes(source));
}

// Azure evaluates an NSG's rules in ascending priority order (lowest number
// first) and stops at the first match — so a lower-priority-number Deny rule
// covering the same risky port from an equally open source fully blocks that
// traffic even though a broader Allow rule is also present in the rule set.
function isPortShadowedByDeny(port, rule, allRules) {
  return allRules.some((other) => {
    if (other === rule || other.priority == null || rule.priority == null) return false;
    if (other.priority >= rule.priority) return false;
    if (other.direction !== "Inbound" || other.access !== "Deny") return false;
    if (!hasOpenSource(other)) return false;
    const otherRanges = [other.destinationPortRange, ...(other.destinationPortRanges || [])];
    return otherRanges.some((range) => portRangeIncludesPort(range, port));
  });
}

function isOpenIngressRule(rule, allRules) {
  if (rule.direction !== "Inbound" || rule.access !== "Allow") return false;
  if (!hasOpenSource(rule)) return false;
  const ranges = [rule.destinationPortRange, ...(rule.destinationPortRanges || [])];
  const exposedRiskyPorts = RISKY_PORTS.filter((port) => ranges.some((range) => portRangeIncludesPort(range, port)));
  if (exposedRiskyPorts.length === 0) return false;
  return !exposedRiskyPorts.every((port) => isPortShadowedByDeny(port, rule, allRules));
}

export async function checkStoragePublicAccessBlocked(storage) {
  const results = [];
  for await (const account of storage.storageAccounts.list()) {
    // Azure's own docs: "The default interpretation is false for this property" —
    // an unset/null field means public access is NOT allowed, only an explicit
    // `true` means it is.
    const blocked = account.allowBlobPublicAccess !== true;
    results.push({
      resourceId: account.id,
      status: blocked ? "pass" : "fail",
      message: blocked ? `${account.name} blocks public blob access` : `${account.name} allows public blob access`,
      evidencePayload: { accountName: account.name, allowBlobPublicAccess: account.allowBlobPublicAccess ?? null },
    });
  }
  if (results.length === 0) {
    results.push({ resourceId: "subscription", status: "not_applicable", message: "No storage accounts found", evidencePayload: {} });
  }
  return results;
}

export async function checkNsgNoOpenIngress(network) {
  const results = [];
  for await (const nsg of network.networkSecurityGroups.listAll()) {
    const rules = nsg.securityRules || [];
    const openRules = rules.filter((rule) => isOpenIngressRule(rule, rules));
    results.push({
      resourceId: nsg.id,
      status: openRules.length === 0 ? "pass" : "fail",
      message: openRules.length === 0
        ? `${nsg.name} does not expose ports 22/3389 to the internet`
        : `${nsg.name} allows inbound access to ports 22/3389 from ${openRules.map((r) => r.sourceAddressPrefix).join(", ")}`,
      evidencePayload: { nsgName: nsg.name, openRuleNames: openRules.map((r) => r.name) },
    });
  }
  if (results.length === 0) {
    results.push({ resourceId: "subscription", status: "not_applicable", message: "No network security groups found", evidencePayload: {} });
  }
  return results;
}

export const networkTests = [
  { key: "azure.storage.public_access_blocked", title: "Storage accounts block public blob access", failTitle: "Storage account allows public blob access", severityDefault: "critical", isoReferences: ["A.8.2.3"], dpdpaControlAreas: ["Access Control & Least Privilege"], run: (clients) => checkStoragePublicAccessBlocked(clients.storage) },
  { key: "azure.network.nsg_no_open_ingress", title: "Network security groups do not expose management ports publicly", failTitle: "Network security group exposes management ports (SSH/RDP) publicly", severityDefault: "critical", isoReferences: ["A.13.1.1"], dpdpaControlAreas: ["Access Control & Least Privilege"], run: (clients) => checkNsgNoOpenIngress(clients.network) },
];
