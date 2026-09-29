import { aggregate, descriptor, empty, malformed, row } from "./helpers.js";

const GATEWAY_TYPES = new Set([
  "simple-gateway",
  "simple-cluster",
  "CpmiGatewayCluster",
  "CpmiClusterMember",
  "CpmiVsClusterNetobj",
  "CpmiVsxClusterNetobj",
  "CpmiVsxClusterMember",
  "CpmiHostCkp",
]);

// A "gateway" for our purposes: an enforcement point that installs policy. Match
// on the documented object types, or fall back to "carries a version and a
// policy block".
function isGateway(object) {
  if (!object || typeof object !== "object") return false;
  if (GATEWAY_TYPES.has(object.type)) return true;
  return typeof object.version === "string" && object.policy && typeof object.policy === "object";
}

async function gateways(clients) {
  const objects = await clients.getGateways();
  if (!Array.isArray(objects)) return null;
  return objects.filter(isGateway);
}

// R80.40 and earlier are past end-of-support; treat anything below R81 as a
// finding. An unparseable version is an error, not a guessed pass.
function majorVersion(version) {
  const m = String(version || "").match(/R(\d+)(?:\.(\d+))?/i);
  if (!m) return null;
  return Number(m[1]) + (m[2] ? Number(m[2]) / 100 : 0);
}

async function checkPolicyInstalled(clients) {
  const list = await gateways(clients);
  if (!list) return malformed("gateway", "show-gateways-and-servers response is missing an objects array");
  if (!list.length) return empty("gateway", "No enforcement gateways are managed by this server");
  const unknown = list.find((gw) => gw.policy?.["access-policy-installed"] == null);
  if (unknown) return malformed("gateway", "Gateway policy.access-policy-installed is missing from the API response", unknown);
  const findings = list.filter((gw) => gw.policy["access-policy-installed"] !== true);
  return findings.length
    ? findings.map((gw) => row("gateway", gw, "fail", `Gateway "${gw.name}" has no access policy installed`, { policy: gw.policy }))
    : aggregate("gateway", "pass", `All ${list.length} managed gateway(s) have an access policy installed`, { gatewayCount: list.length });
}

async function checkSoftwareSupported(clients) {
  const list = await gateways(clients);
  if (!list) return malformed("gateway", "show-gateways-and-servers response is missing an objects array");
  if (!list.length) return empty("gateway", "No enforcement gateways are managed by this server");
  const unparseable = list.find((gw) => majorVersion(gw.version) == null);
  if (unparseable) return malformed("gateway", `Gateway software version could not be parsed ("${unparseable.version ?? "missing"}")`, unparseable);
  const findings = list.filter((gw) => majorVersion(gw.version) < 81);
  return findings.length
    ? findings.map((gw) => row("gateway", gw, "fail", `Gateway "${gw.name}" runs ${gw.version}, which is past Check Point end-of-support`, { version: gw.version }))
    : aggregate("gateway", "pass", `All ${list.length} managed gateway(s) run a supported software version`, { gatewayCount: list.length });
}

export const gatewayTests = [
  descriptor({ key: "check_point_mgmt.gateway.policy_installed_current", title: "Every managed gateway has an access policy installed", failTitle: "A managed gateway has no access policy installed", severityDefault: "high", isoReferences: ["A.12.1.2"], dpdpaControlAreas: ["Change Management"], run: checkPolicyInstalled }),
  descriptor({ key: "check_point_mgmt.gateway.software_supported", title: "No managed gateway runs an end-of-support software version", failTitle: "A managed gateway runs end-of-support software", severityDefault: "high", isoReferences: ["A.12.6.1"], dpdpaControlAreas: ["Vulnerability Management"], run: checkSoftwareSupported }),
];
