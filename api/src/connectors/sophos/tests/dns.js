import { aggregate, descriptor, empty, malformed, row } from "./helpers.js";

async function dns(clients) {
  const [locations, policies, domainLists] = await Promise.all([clients.listDnsLocations(), clients.listDnsPolicies(), clients.listDnsDomainLists()]);
  if (![locations, policies, domainLists].every(Array.isArray)) return null;
  return { locations, policies, domainLists };
}

async function checkActive(clients) {
  const data = await dns(clients);
  if (!data) return malformed("dns_location", "DNS Protection response is malformed");
  if (!data.locations.length) return empty("dns_location", "No DNS Protection locations were returned");
  const active = data.locations.filter((location) => location.enabled !== false && location.status !== "inactive");
  return aggregate("dns_location", active.length ? "pass" : "fail", `${active.length} of ${data.locations.length} DNS Protection location(s) are active`, { locationCount: data.locations.length, activeLocations: active.length });
}

async function checkBlocked(clients) {
  const data = await dns(clients);
  if (!data) return malformed("dns_policy", "DNS Protection response is malformed");
  if (!data.policies.length) return empty("dns_policy", "No DNS Protection policies were returned");
  const required = ["malware", "phishing", "command-and-control"];
  const categories = (policy) => policy.rejectedWebCategories ?? policy.blockedCategories ?? policy.webCategoryActions?.filter((x) => String(x.action).toLowerCase() === "block").map((x) => x.category) ?? null;
  const unknown = data.policies.find((policy) => !Array.isArray(categories(policy)));
  if (unknown) return malformed("dns_policy", "DNS policy blocked-category fields are missing", unknown, { requiredCategories: required });
  const bad = data.policies.filter((policy) => !required.every((requiredCategory) => categories(policy).some((value) => String(value).toLowerCase().includes(requiredCategory))));
  return bad.length ? bad.map((policy) => row("dns_policy", policy, "fail", `DNS policy "${policy.name}" does not block every malware/phishing/C2 category`, { blockedCategories: categories(policy), requiredCategories: required })) : aggregate("dns_policy", "pass", "All DNS policies block malware, phishing and command-and-control categories", { policyCount: data.policies.length });
}

async function checkAssignments(clients) {
  const data = await dns(clients);
  if (!data) return malformed("dns_location", "DNS Protection response is malformed");
  if (!data.locations.length) return empty("dns_location", "No DNS Protection locations were returned");
  const missing = data.locations.filter((location) => !location.policyId && !data.policies.some((policy) => policy.locationIds?.includes(location.id)));
  return missing.length ? missing.map((location) => row("dns_location", location, "fail", `DNS location "${location.name}" has no explicit policy assignment`, { policyId: location.policyId ?? null })) : aggregate("dns_location", "pass", "Every DNS Protection location is assigned to a policy", { locationCount: data.locations.length });
}

async function checkSafeSearch(clients) {
  const data = await dns(clients);
  if (!data) return malformed("dns_policy", "DNS Protection response is malformed");
  if (!data.policies.length) return empty("dns_policy", "No DNS Protection policies were returned");
  const value = (policy) => policy.safeSearchEnabled ?? policy.safeSearch?.enabled;
  const unknown = data.policies.find((policy) => typeof value(policy) !== "boolean");
  if (unknown) return malformed("dns_policy", "DNS policy safe-search setting is missing", unknown);
  const bad = data.policies.filter((policy) => !value(policy));
  return bad.length ? bad.map((policy) => row("dns_policy", policy, "fail", `DNS policy "${policy.name}" does not enforce safe search`, { safeSearchEnabled: false })) : aggregate("dns_policy", "pass", "All DNS Protection policies enforce safe search", { policyCount: data.policies.length });
}

async function checkBlocklist(clients) {
  const data = await dns(clients);
  if (!data) return malformed("dns_domain_list", "DNS Protection response is malformed");
  const blockedIds = new Set(data.policies.flatMap((policy) => policy.blockedCustomDomainIds ?? []));
  const active = data.domainLists.filter((list) => blockedIds.has(list.id) && (list.domains?.length ?? 0) > 0);
  return aggregate("dns_domain_list", active.length ? "pass" : "fail", active.length ? `${active.length} populated custom domain block list(s) are assigned to DNS policies` : "No populated custom domain block list is assigned to a DNS policy", { domainListCount: data.domainLists.length, assignedBlocklists: active.length });
}

export const dnsTests = [
  descriptor({ key: "sophos.dns.protection_active", title: "At least one DNS Protection location is active", severityDefault: "medium", isoReferences: ["A.13.1.1"], dpdpaControlAreas: ["Network Security"], run: checkActive }),
  descriptor({ key: "sophos.dns.malware_categories_blocked", title: "DNS policies block malware / phishing / C2 categories", severityDefault: "high", isoReferences: ["A.12.2.1"], dpdpaControlAreas: ["Malware Protection"], run: checkBlocked }),
  descriptor({ key: "sophos.dns.all_locations_have_policy", title: "Every DNS location is bound to a policy (not default-only)", severityDefault: "medium", isoReferences: ["A.13.1.1"], dpdpaControlAreas: ["Network Security"], run: checkAssignments }),
  descriptor({ key: "sophos.dns.safe_search_enforced", title: "Safe search is enforced in DNS policy", severityDefault: "low", isoReferences: ["A.13.1.1"], dpdpaControlAreas: ["Network Security"], run: checkSafeSearch }),
  descriptor({ key: "sophos.dns.custom_blocklist_present", title: "A maintained custom domain block list exists", severityDefault: "low", isoReferences: ["A.13.1.1"], dpdpaControlAreas: ["Network Security"], run: checkBlocklist }),
];
