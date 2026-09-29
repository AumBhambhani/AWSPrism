import { aggregate, ageInDays, descriptor, empty, isCriticalSeverity, isHighSeverity, malformed, row } from "./helpers.js";

async function accounts(clients) {
  const list = await clients.listCloudAccounts();
  return Array.isArray(list) ? list : null;
}

async function checkAccountsFetching(clients) {
  const list = await accounts(clients);
  if (!list) return malformed("posture", "The CloudGuard /CloudAccounts response is not an array");
  if (!list.length) return empty("posture", "No cloud accounts are onboarded to CloudGuard");
  const findings = list.filter((acct) => {
    const protocol = String(acct.credentialsProtocol ?? acct.credentials?.protocol ?? "").toLowerCase();
    const suspended = acct.isFetchingSuspended === true || acct.fetchingSuspended === true;
    return suspended || protocol === "missing" || protocol === "none";
  });
  return findings.length
    ? findings.map((acct) => row("posture", acct, "fail", `CloudGuard account "${acct.name ?? acct.id}" is not fetching configuration (credentials protocol: ${acct.credentialsProtocol ?? "missing"})`, { credentialsProtocol: acct.credentialsProtocol ?? null }))
    : aggregate("posture", "pass", `All ${list.length} onboarded cloud account(s) are fetching configuration`, { accountCount: list.length });
}

async function checkAssessmentRecent(clients) {
  const list = await accounts(clients);
  if (!list) return malformed("posture", "The CloudGuard /CloudAccounts response is not an array");
  if (!list.length) return empty("posture", "No cloud accounts are onboarded to CloudGuard");
  const history = await clients.listAssessmentHistory();
  if (!Array.isArray(history)) return malformed("posture", "The CloudGuard /AssessmentHistoryV2 response is not an array");
  const latestByAccount = new Map();
  for (const entry of history) {
    const acctId = String(entry.cloudAccountId ?? entry.request?.cloudAccountId ?? "");
    const created = entry.createdTime ?? entry.assessmentPassedTime ?? entry.request?.requestTime ?? entry.updatedTime;
    const age = ageInDays(created);
    if (age == null) continue;
    if (!latestByAccount.has(acctId) || age < latestByAccount.get(acctId)) latestByAccount.set(acctId, age);
  }
  const freshDays = clients.THRESHOLDS.ASSESSMENT_FRESHNESS_DAYS;
  const findings = list.filter((acct) => {
    const age = latestByAccount.get(String(acct.id));
    return age == null || age > freshDays;
  });
  return findings.length
    ? findings.map((acct) => row("posture", acct, "fail", `CloudGuard account "${acct.name ?? acct.id}" has no compliance assessment within the last ${freshDays} days`, { lastAssessmentAgeDays: latestByAccount.get(String(acct.id)) ?? null, freshDays }))
    : aggregate("posture", "pass", `All ${list.length} cloud account(s) were assessed within the last ${freshDays} days`, { accountCount: list.length });
}

async function checkRulesetAssigned(clients) {
  const list = await accounts(clients);
  if (!list) return malformed("posture", "The CloudGuard /CloudAccounts response is not an array");
  if (!list.length) return empty("posture", "No cloud accounts are onboarded to CloudGuard");
  const policies = await clients.listContinuousCompliancePolicies();
  if (!Array.isArray(policies)) return malformed("posture", "The CloudGuard continuous-compliance policy response is not an array");
  const covered = new Set(policies.map((p) => String(p.targetId ?? p.cloudAccountId ?? p.targetInternalId ?? "")));
  const findings = list.filter((acct) => !covered.has(String(acct.id)));
  return findings.length
    ? findings.map((acct) => row("posture", acct, "fail", `CloudGuard account "${acct.name ?? acct.id}" has no compliance ruleset bound for continuous assessment`, {}))
    : aggregate("posture", "pass", `All ${list.length} cloud account(s) have a compliance ruleset bound`, { accountCount: list.length, policyCount: policies.length });
}

async function findings(clients) {
  const list = await clients.searchFindings();
  return Array.isArray(list) ? list : null;
}

function isOpenFinding(finding) {
  const status = String(finding.status ?? finding.remediationStatus ?? "").toLowerCase();
  return !["closed", "resolved", "remediated", "excluded", "archived"].includes(status);
}

async function checkCriticalFindingsAddressed(clients) {
  const list = await findings(clients);
  if (!list) return malformed("posture", "The CloudGuard findings search response is not an array");
  const critical = list.filter((f) => isCriticalSeverity(f.severity) && isOpenFinding(f));
  if (!critical.length) return aggregate("posture", "pass", "No open critical posture findings", { criticalOpen: 0 });
  const slaDays = clients.THRESHOLDS.CRITICAL_REMEDIATION_SLA_DAYS;
  const stale = critical.filter((f) => (ageInDays(f.createdTime ?? f.firstSeenTime ?? f.updatedTime) ?? Infinity) > slaDays);
  return (stale.length ? stale : critical).map((f) =>
    row("posture", f, "fail", `Critical posture finding "${f.ruleName ?? f.rule?.name ?? f.id}" on ${f.entityName ?? f.cloudAccountId} is open${(ageInDays(f.createdTime) ?? 0) > slaDays ? ` past the ${slaDays}-day SLA` : ""}`, { severity: f.severity, createdTime: f.createdTime ?? null })
  );
}

async function checkHighFindingsWithinPolicy(clients) {
  const list = await findings(clients);
  if (!list) return malformed("posture", "The CloudGuard findings search response is not an array");
  const high = list.filter((f) => isHighSeverity(f.severity) && !isCriticalSeverity(f.severity) && isOpenFinding(f));
  const threshold = clients.THRESHOLDS.HIGH_FINDING_COUNT_THRESHOLD;
  return high.length > threshold
    ? [row("posture", null, "fail", `${high.length} open high-severity posture findings exceed the policy threshold of ${threshold}`, { openHigh: high.length, threshold })]
    : aggregate("posture", "pass", `${high.length} open high-severity posture finding(s), within the policy threshold of ${threshold}`, { openHigh: high.length, threshold });
}

async function checkExclusionsReviewed(clients) {
  const list = await clients.listExclusions();
  if (!Array.isArray(list)) return malformed("posture", "The CloudGuard /Compliance/Exclusion response is not an array");
  if (!list.length) return aggregate("posture", "pass", "No compliance exclusions are configured", { exclusionCount: 0 });
  const findingsList = list.filter((ex) => {
    const expiry = ex.expirationDate ?? ex.expiration ?? ex.dateRange?.to;
    if (!expiry) return true; // no expiry = unbounded
    const remaining = -(ageInDays(expiry) ?? 0);
    return remaining > clients.THRESHOLDS.EXCLUSION_MAX_FUTURE_DAYS;
  });
  return findingsList.length
    ? findingsList.map((ex) => row("posture", ex, "fail", `Compliance exclusion "${ex.name ?? ex.id}" is unbounded or expires too far in the future`, { expirationDate: ex.expirationDate ?? ex.expiration ?? null }))
    : aggregate("posture", "pass", `All ${list.length} compliance exclusion(s) are time-bounded within policy`, { exclusionCount: list.length });
}

const compliance = ["Technical Compliance Review"];
export const postureTests = [
  descriptor({ key: "check_point_cloudguard.posture.accounts_fetching", title: "Every onboarded cloud account is fetching configuration successfully", failTitle: "An onboarded cloud account is not fetching configuration", severityDefault: "medium", isoReferences: ["A.12.1.1"], dpdpaControlAreas: compliance, run: checkAccountsFetching }),
  descriptor({ key: "check_point_cloudguard.posture.assessment_recent", title: "A compliance assessment has run for each account within the freshness window", failTitle: "A cloud account has no recent compliance assessment", severityDefault: "medium", isoReferences: ["A.18.2.2"], dpdpaControlAreas: compliance, run: checkAssessmentRecent }),
  descriptor({ key: "check_point_cloudguard.posture.ruleset_assigned", title: "Each account has a compliance ruleset bound and scheduled", failTitle: "A cloud account has no compliance ruleset bound", severityDefault: "medium", isoReferences: ["A.18.2.2"], dpdpaControlAreas: compliance, run: checkRulesetAssigned }),
  descriptor({ key: "check_point_cloudguard.posture.critical_findings_addressed", title: "No critical posture findings remain open past the remediation SLA", failTitle: "A critical posture finding is open past the remediation SLA", severityDefault: "critical", isoReferences: ["A.12.6.1"], dpdpaControlAreas: ["Vulnerability Management"], run: checkCriticalFindingsAddressed }),
  descriptor({ key: "check_point_cloudguard.posture.high_findings_within_policy", title: "High-severity posture findings are within the policy count and age threshold", failTitle: "Open high-severity posture findings exceed the policy threshold", severityDefault: "high", isoReferences: ["A.18.2.2"], dpdpaControlAreas: compliance, run: checkHighFindingsWithinPolicy }),
  descriptor({ key: "check_point_cloudguard.posture.exclusions_reviewed", title: "Posture exclusions are time-bounded and not stale", failTitle: "A posture exclusion is unbounded or stale", severityDefault: "low", isoReferences: ["A.9.4.1"], dpdpaControlAreas: ["Access Control"], run: checkExclusionsReviewed }),
];
