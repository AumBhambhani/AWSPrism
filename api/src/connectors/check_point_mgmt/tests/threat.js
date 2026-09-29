import { aggregate, ageInDays, descriptor, empty, isAnyRef, malformed, refName, row } from "./helpers.js";

async function threatProfiles(clients) {
  const objects = await clients.getThreatProfiles();
  return Array.isArray(objects) ? objects : null;
}

async function threatRulebase(clients) {
  const data = await clients.getThreatRulebase();
  if (!data || !Array.isArray(data.rulebase)) return null;
  return data;
}

async function checkProfileAssigned(clients) {
  const profiles = await threatProfiles(clients);
  if (!profiles) return malformed("threat", "show-threat-profiles response is missing an objects array");
  if (!profiles.length) return [row("threat", null, "fail", "No Threat Prevention profile is defined on this management server", { profileCount: 0 })];
  const data = await threatRulebase(clients);
  if (!data) return malformed("threat", "show-threat-rulebase response is missing a rulebase array");
  const rules = data.rulebase.filter((entry) => entry?.type === "threat-rule" || entry?.["rule-number"] != null);
  const enforcing = rules.filter((rule) => rule.enabled !== false);
  return enforcing.length
    ? aggregate("threat", "pass", `${profiles.length} Threat Prevention profile(s) exist and ${enforcing.length} enforcing threat rule(s) are active`, { profileCount: profiles.length, enforcingRuleCount: enforcing.length })
    : [row("threat", null, "fail", `${profiles.length} Threat Prevention profile(s) exist but no enforcing threat rule is active`, { profileCount: profiles.length })];
}

async function checkModeIsPrevent(clients) {
  const profiles = await threatProfiles(clients);
  if (!profiles) return malformed("threat", "show-threat-profiles response is missing an objects array");
  if (!profiles.length) return empty("threat", "No Threat Prevention profile is defined to evaluate");
  const unknown = profiles.find((p) => p["confidence-level-high"] == null && p["ips-settings"]?.["confidence-level-high"] == null);
  if (unknown) return malformed("threat", "Threat profile confidence-level-high is missing from the API response", unknown);
  const findings = profiles.filter((p) => {
    const high = String(p["confidence-level-high"] ?? p["ips-settings"]?.["confidence-level-high"] ?? "").toLowerCase();
    return high !== "prevent";
  });
  return findings.length
    ? findings.map((p) => row("threat", p, "fail", `Threat profile "${p.name}" sets high-confidence activations to ${p["confidence-level-high"] ?? "detect/inactive"} rather than Prevent`, { confidenceLevelHigh: p["confidence-level-high"] ?? null }))
    : aggregate("threat", "pass", `All ${profiles.length} Threat Prevention profile(s) set high-confidence activations to Prevent`, { profileCount: profiles.length });
}

async function checkIpsCurrent(clients) {
  const status = await clients.getIpsStatus();
  if (!status || typeof status !== "object") return malformed("threat", "show-ips-status returned no data");
  const updateAvailable = status["update-available"];
  const lastUpdated = status["last-updated"]?.posix ?? status["last-updated"]?.["iso-8601"] ?? status["last-updated"];
  if (updateAvailable == null && lastUpdated == null) {
    return malformed("threat", "show-ips-status is missing both update-available and last-updated");
  }
  const staleDays = clients.THRESHOLDS.IPS_DB_MAX_AGE_DAYS;
  const age = ageInDays(lastUpdated);
  if (updateAvailable === true) {
    return [row("threat", null, "fail", `The IPS signature database has an update available (installed ${status["installed-version"] ?? "unknown"}, latest ${status["latest-version"] ?? "unknown"})`, { ...status })];
  }
  if (age != null && age > staleDays) {
    return [row("threat", null, "fail", `The IPS signature database was last updated ${Math.round(age)} days ago (threshold ${staleDays})`, { lastUpdated, staleDays })];
  }
  return aggregate("threat", "pass", "The IPS signature database is current", { installedVersion: status["installed-version"] ?? null, ageDays: age == null ? null : Math.round(age) });
}

async function checkNoBlanketExceptions(clients) {
  const data = await threatRulebase(clients);
  if (!data) return malformed("threat", "show-threat-rulebase response is missing a rulebase array");
  const dictionary = data.dictionary || data["objects-dictionary"] || [];
  const exceptions = [];
  for (const entry of data.rulebase) {
    if (entry?.type === "threat-exception" || entry?.type === "threat-exception-group") exceptions.push(entry);
    for (const child of Array.isArray(entry?.exceptions) ? entry.exceptions : []) exceptions.push(child);
  }
  if (!exceptions.length) return aggregate("threat", "pass", "No Threat Prevention exception rules are configured", { exceptionCount: 0 });
  const findings = exceptions.filter((ex) => isAnyRef(ex.source, dictionary) && isAnyRef(ex.destination, dictionary) && refName(ex["protection-or-site"] ?? ex.protection, dictionary) === "any");
  return findings.length
    ? findings.map((ex) => row("threat", ex, "fail", `Threat Prevention exception "${ex.name ?? ex.uid}" disables protection for Any source to Any destination`, { exception: ex.name ?? ex.uid }))
    : aggregate("threat", "pass", `All ${exceptions.length} Threat Prevention exception(s) are scoped, not blanket Any/Any`, { exceptionCount: exceptions.length });
}

const malwareControls = ["Malware Protection"];
export const threatTests = [
  descriptor({ key: "check_point_mgmt.threat.profile_assigned", title: "A Threat Prevention profile is bound to enforcing traffic", failTitle: "No Threat Prevention profile is bound to enforcing traffic", severityDefault: "high", isoReferences: ["A.12.2.1"], dpdpaControlAreas: malwareControls, run: checkProfileAssigned }),
  descriptor({ key: "check_point_mgmt.threat.mode_is_prevent", title: "High-confidence Threat Prevention activations are set to Prevent, not Detect", failTitle: "A Threat Prevention profile leaves high-confidence activations in Detect", severityDefault: "high", isoReferences: ["A.12.2.1"], dpdpaControlAreas: malwareControls, run: checkModeIsPrevent }),
  descriptor({ key: "check_point_mgmt.threat.ips_signatures_current", title: "The IPS signature database is current", failTitle: "The IPS signature database is out of date", severityDefault: "high", isoReferences: ["A.12.6.1"], dpdpaControlAreas: ["Vulnerability Management"], run: checkIpsCurrent }),
  descriptor({ key: "check_point_mgmt.threat.no_blanket_exceptions", title: "Threat Prevention exception rules are not blanket Any/Any", failTitle: "A Threat Prevention exception is blanket Any/Any", severityDefault: "medium", isoReferences: ["A.12.2.1"], dpdpaControlAreas: malwareControls, run: checkNoBlanketExceptions }),
];
