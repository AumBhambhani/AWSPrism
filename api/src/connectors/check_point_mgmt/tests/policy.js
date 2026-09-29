import { aggregate, descriptor, empty, flattenRulebase, isAnyRef, malformed, refName, row } from "./helpers.js";

// Loads the first policy package's access rulebase as
// { rules: [...flat access-rule objects], dictionary: [...objects-dictionary] }.
async function accessRules(clients) {
  const data = await clients.getAccessRulebase();
  if (!data || !Array.isArray(data.rulebase)) return null;
  return { rules: flattenRulebase(data.rulebase), dictionary: data.dictionary || [], packageName: data.packageName };
}

async function checkCleanupRule(clients) {
  const data = await accessRules(clients);
  if (!data) return malformed("policy", "Access rulebase is missing or malformed");
  if (!data.rules.length) return empty("policy", "The policy package has no access rules to evaluate");
  const last = data.rules[data.rules.length - 1];
  const action = refName(last.action, data.dictionary);
  if (!action) return malformed("policy", "Access rule action could not be resolved from the objects dictionary", last);
  const isDrop = ["drop", "reject"].includes(action);
  const catchAll = isAnyRef(last.source, data.dictionary) && isAnyRef(last.destination, data.dictionary) && isAnyRef(last.service, data.dictionary);
  return isDrop && catchAll
    ? aggregate("policy", "pass", `Package "${data.packageName}" ends with an explicit cleanup ${action} rule`, { lastRule: last.name ?? last["rule-number"], action })
    : [row("policy", last, "fail", `Package "${data.packageName}" does not end with an Any/Any/Any cleanup drop rule (last rule action: ${action})`, { action, catchAll })];
}

async function checkNoPermissiveRule(clients) {
  const data = await accessRules(clients);
  if (!data) return malformed("policy", "Access rulebase is missing or malformed");
  if (!data.rules.length) return empty("policy", "The policy package has no access rules to evaluate");
  const findings = data.rules.filter((rule) => {
    if (rule.enabled === false) return false;
    const action = refName(rule.action, data.dictionary);
    if (action !== "accept") return false;
    return isAnyRef(rule.source, data.dictionary) && isAnyRef(rule.destination, data.dictionary) && isAnyRef(rule.service, data.dictionary);
  });
  return findings.length
    ? findings.map((rule) => row("policy", rule, "fail", `Access rule "${rule.name ?? rule["rule-number"]}" accepts Any source to Any destination on Any service`, { ruleNumber: rule["rule-number"] }))
    : aggregate("policy", "pass", `No enabled access rule in "${data.packageName}" allows Any/Any/Any Accept`, { ruleCount: data.rules.length });
}

async function checkRuleLogging(clients) {
  const data = await accessRules(clients);
  if (!data) return malformed("policy", "Access rulebase is missing or malformed");
  const enforcing = data.rules.filter((rule) => rule.enabled !== false && ["accept", "drop", "reject"].includes(refName(rule.action, data.dictionary)));
  if (!enforcing.length) return empty("policy", "The policy package has no enforcing access rules to evaluate");
  const missingTrack = enforcing.find((rule) => rule.track == null || (typeof rule.track === "object" && rule.track.type == null));
  if (missingTrack) return malformed("policy", "Access rule track.type is missing from the API response", missingTrack);
  const findings = enforcing.filter((rule) => refName(rule.track?.type ?? rule.track, data.dictionary) === "none");
  return findings.length
    ? findings.map((rule) => row("policy", rule, "fail", `Access rule "${rule.name ?? rule["rule-number"]}" has tracking set to None`, { ruleNumber: rule["rule-number"] }))
    : aggregate("policy", "pass", `All ${enforcing.length} enforcing access rule(s) in "${data.packageName}" are logged`, { enforcingRuleCount: enforcing.length });
}

async function checkStealthRule(clients) {
  const data = await accessRules(clients);
  if (!data) return malformed("policy", "Access rulebase is missing or malformed");
  if (data.rules.length < 2) return empty("policy", "The policy package is too small to evaluate a stealth rule");
  const firstAccept = data.rules.findIndex((rule) => rule.enabled !== false && refName(rule.action, data.dictionary) === "accept");
  const cutoff = firstAccept === -1 ? data.rules.length : firstAccept;
  const stealth = data.rules.slice(0, Math.max(cutoff, 1)).find((rule) => {
    if (rule.enabled === false) return false;
    const action = refName(rule.action, data.dictionary);
    return ["drop", "reject"].includes(action) && !isAnyRef(rule.destination, data.dictionary);
  });
  return stealth
    ? aggregate("policy", "pass", `A stealth rule ("${stealth.name ?? stealth["rule-number"]}") drops traffic to the gateways above the first Accept rule`, { ruleNumber: stealth["rule-number"] })
    : [row("policy", null, "fail", `Package "${data.packageName}" has no stealth rule dropping traffic destined to the gateways above the first Accept rule`, { firstAcceptRuleIndex: firstAccept })];
}

async function checkDisabledRulesReviewed(clients) {
  const data = await accessRules(clients);
  if (!data) return malformed("policy", "Access rulebase is missing or malformed");
  const disabled = data.rules.filter((rule) => rule.enabled === false);
  if (!disabled.length) return aggregate("policy", "pass", `No disabled rules remain in "${data.packageName}"`, { disabledCount: 0 });
  const undocumented = disabled.filter((rule) => !String(rule.comments ?? "").trim());
  return undocumented.length
    ? undocumented.map((rule) => row("policy", rule, "fail", `Disabled access rule "${rule.name ?? rule["rule-number"]}" has no comment explaining why it is retained`, { ruleNumber: rule["rule-number"] }))
    : aggregate("policy", "pass", `All ${disabled.length} disabled rule(s) in "${data.packageName}" carry a review comment`, { disabledCount: disabled.length });
}

const network = ["Network Security"];
export const policyTests = [
  descriptor({ key: "check_point_mgmt.policy.cleanup_rule_present", title: "Every access policy package ends with an explicit cleanup (drop) rule", failTitle: "An access policy package has no explicit cleanup drop rule", severityDefault: "high", isoReferences: ["A.13.1.1"], dpdpaControlAreas: network, run: checkCleanupRule }),
  descriptor({ key: "check_point_mgmt.policy.no_permissive_any_rule", title: "No enabled access rule allows Any source, Any destination and Any service with Accept", failTitle: "An enabled access rule allows Any/Any/Any with Accept", severityDefault: "high", isoReferences: ["A.9.4.1"], dpdpaControlAreas: network, run: checkNoPermissiveRule }),
  descriptor({ key: "check_point_mgmt.policy.rule_logging_enabled", title: "Enforcing access rules have tracking set to Log", failTitle: "An enforcing access rule has tracking set to None", severityDefault: "medium", isoReferences: ["A.12.4.1"], dpdpaControlAreas: ["Logging & Monitoring"], run: checkRuleLogging }),
  descriptor({ key: "check_point_mgmt.policy.stealth_rule_present", title: "A stealth rule protecting the gateways sits above the first permissive rule", failTitle: "No stealth rule protects the gateways", severityDefault: "medium", isoReferences: ["A.13.1.1"], dpdpaControlAreas: network, run: checkStealthRule }),
  descriptor({ key: "check_point_mgmt.policy.disabled_rules_reviewed", title: "Disabled rules are not left in the rulebase without a review comment", failTitle: "A disabled rule has no review comment", severityDefault: "low", isoReferences: ["A.9.4.1"], dpdpaControlAreas: network, run: checkDisabledRulesReviewed }),
];
