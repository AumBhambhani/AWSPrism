import { aggregate, descriptor, empty, malformed, row } from "./helpers.js";

async function webData(clients) {
  const [policies, groups] = await Promise.all([clients.listPolicies(), clients.listEndpointGroups()]);
  if (!Array.isArray(policies) || !Array.isArray(groups)) return null;
  return { policies: policies.filter((policy) => ["web-control", "server-web-control"].includes(policy.type)), groups };
}

async function checkAssigned(clients) {
  const data = await webData(clients);
  if (!data) return malformed("web_policy", "Web policy or endpoint group response is malformed");
  if (!data.groups.length) return empty("web_policy", "No endpoint groups were returned");
  const assigned = new Set(data.policies.flatMap((policy) => policy.assignedGroupIds ?? policy.groups ?? []).map((value) => String(value?.id ?? value)));
  const missing = data.groups.filter((group) => !assigned.has(String(group.id)) && !group.webControlPolicy);
  return missing.length ? missing.map((group) => row("endpoint_group", group, "fail", `Endpoint group "${group.name}" has no Web Control policy assignment`, { assignedPolicyCount: 0 })) : aggregate("web_policy", "pass", `Every ${data.groups.length} endpoint group(s) has a Web Control policy assignment`, { groupCount: data.groups.length, policyCount: data.policies.length });
}

async function getPolicies(clients) {
  const data = await webData(clients);
  return data?.policies ?? null;
}

async function checkCategories(clients) {
  const policies = await getPolicies(clients);
  if (!policies) return malformed("web_policy", "Web policy response is malformed");
  if (!policies.length) return empty("web_policy", "No Web Control policies were returned");
  const required = ["malware", "phishing", "command-and-control"];
  const unknown = policies.find((p) => !Array.isArray(p.blockedCategories ?? p.settings?.blockedCategories));
  if (unknown) return malformed("web_policy", "blockedCategories is not exposed on Web Control policy", unknown, { requiredCategories: required });
  const bad = policies.filter((p) => !required.every((category) => (p.blockedCategories ?? p.settings.blockedCategories).map((v) => String(v).toLowerCase()).includes(category)));
  return bad.length ? bad.map((p) => row("web_policy", p, "fail", `Web Control policy "${p.name}" does not block every high-risk category`, { blockedCategories: p.blockedCategories ?? p.settings.blockedCategories, requiredCategories: required })) : aggregate("web_policy", "pass", "All Web Control policies block the required high-risk categories", { policyCount: policies.length });
}

async function checkScanning(clients) {
  const policies = await getPolicies(clients);
  if (!policies?.length) return policies ? empty("web_policy", "No Web Control policies were returned") : malformed("web_policy", "Web policy response is malformed");
  const values = policies.map((p) => p.downloadScanningEnabled ?? p.settings?.downloadScanningEnabled ?? p.tlsInspectionEnabled ?? p.settings?.tlsInspectionEnabled);
  if (values.some((v) => typeof v !== "boolean")) return malformed("web_policy", "Download scanning / TLS inspection setting is not exposed", policies[values.findIndex((v) => typeof v !== "boolean")]);
  const bad = policies.filter((_, index) => values[index] !== true);
  return bad.length ? bad.map((p) => row("web_policy", p, "fail", `Web Control policy "${p.name}" does not enable download scanning / TLS inspection`, { settings: p.settings ?? p })) : aggregate("web_policy", "pass", "All Web Control policies enable download scanning / TLS inspection", { policyCount: policies.length });
}

async function checkExceptions(clients) {
  const policies = await getPolicies(clients);
  if (!policies?.length) return policies ? empty("web_policy", "No Web Control policies were returned") : malformed("web_policy", "Web policy response is malformed");
  const exceptions = policies.flatMap((policy) => (policy.allowedWebsites ?? policy.settings?.allowedWebsites ?? []).map((value) => ({ policy, value: String(value?.url ?? value) })));
  const blanket = exceptions.filter(({ value }) => ["*", "*.*", "http://*", "https://*"].includes(value.trim().toLowerCase()));
  return blanket.length ? blanket.map(({ policy, value }) => row("web_policy", policy, "fail", `Web Control policy "${policy.name}" contains blanket allow exception ${value}`, { exception: value })) : aggregate("web_policy", "pass", "No Web Control policy contains a blanket allow-all website exception", { policyCount: policies.length, exceptionCount: exceptions.length });
}

export const webTests = [
  descriptor({ key: "sophos.web.policy_assigned", title: "A Web Control policy is assigned to every endpoint group", severityDefault: "medium", isoReferences: ["A.13.1.1"], dpdpaControlAreas: ["Network Security"], run: checkAssigned }),
  descriptor({ key: "sophos.web.risky_categories_blocked", title: "High-risk web categories are blocked in policy", severityDefault: "medium", isoReferences: ["A.13.1.1"], dpdpaControlAreas: ["Network Security"], run: checkCategories }),
  descriptor({ key: "sophos.web.download_scanning_enabled", title: "Web download scanning / TLS inspection is enabled", severityDefault: "medium", isoReferences: ["A.13.1.1"], dpdpaControlAreas: ["Network Security"], run: checkScanning }),
  descriptor({ key: "sophos.web.no_blanket_allow", title: "No blanket allow-all website exceptions are configured", severityDefault: "medium", isoReferences: ["A.9.4.1"], dpdpaControlAreas: ["Access Control"], run: checkExceptions }),
];
