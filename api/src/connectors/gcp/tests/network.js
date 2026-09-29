import { paginate } from "./pagination.js";

const SENSITIVE_MANAGEMENT_PORTS = ["22", "3389"];

function allowsPort(allowedEntry, port) {
  if (!allowedEntry.ports || allowedEntry.ports.length === 0) return true; // no ports listed = all ports for this protocol
  return allowedEntry.ports.some((range) => {
    const [start, end] = range.split("-").map(Number);
    const portNum = Number(port);
    return end ? portNum >= start && portNum <= end : portNum === start;
  });
}

export async function checkFirewallNoOpenManagementPorts(compute, projectId) {
  const firewalls = await paginate((params) => compute.firewalls.list(params), { project: projectId }, "items");
  if (firewalls.length === 0) {
    return [{ resourceId: projectId, status: "not_applicable", message: "No firewall rules found", evidencePayload: {} }];
  }

  const results = [];
  for (const rule of firewalls) {
    if (rule.disabled || rule.direction !== "INGRESS") continue;
    const opensToInternet = (rule.sourceRanges || []).includes("0.0.0.0/0");
    if (!opensToInternet) continue;
    const exposedPorts = SENSITIVE_MANAGEMENT_PORTS.filter((port) => (rule.allowed || []).some((entry) => allowsPort(entry, port)));
    if (exposedPorts.length > 0) {
      results.push({
        resourceId: rule.name,
        status: "fail",
        message: `${rule.name} allows ingress from 0.0.0.0/0 on management port(s): ${exposedPorts.join(", ")}`,
        evidencePayload: { rule: rule.name, network: rule.network, exposedPorts },
      });
    }
  }

  if (results.length === 0) {
    return [{ resourceId: projectId, status: "pass", message: `No enabled ingress firewall rule exposes management ports to 0.0.0.0/0 across ${firewalls.length} rule(s)`, evidencePayload: { ruleCount: firewalls.length } }];
  }
  return results;
}

export const networkTests = [
  {
    key: "gcp.network.firewall_no_open_management_ports",
    title: "Firewall rules do not expose management ports publicly",
    failTitle: "Firewall rule exposes a management port to the public internet",
    severityDefault: "critical",
    isoReferences: ["A.13.1.1"],
    dpdpaControlAreas: ["Access Control & Least Privilege"],
    run: (clients) => checkFirewallNoOpenManagementPorts(clients.compute, clients.projectId),
  },
];
