import { buildEvidencePayload } from "../../shared/evidencePayload.js";

function daysSince(value) {
  const t = Date.parse(value);
  return Number.isNaN(t) ? null : (Date.now() - t) / 86400000;
}

const OPEN_VULN_STATUSES = new Set(["open", "reopen", "reopened"]);

function cveSeverity(vuln) {
  return String(vuln?.cve?.severity ?? vuln?.severity ?? "").toUpperCase();
}
function cveId(vuln) {
  return vuln?.cve?.id ?? vuln?.cve_id ?? vuln?.id ?? "unknown";
}
function vulnHostname(vuln) {
  return vuln?.host_info?.hostname ?? vuln?.hostname ?? vuln?.aid ?? null;
}

// Spotlight vulnerability records with a critical/high severity and an open
// remediation status must not exceed the policy age threshold (default 30 days
// for critical, 90 for high).
async function checkCriticalExposureReview(clients) {
  const vulns = await clients.listVulnerabilities();
  const critDays = clients.THRESHOLDS.CRITICAL_CVE_AGE_DAYS;
  const highDays = clients.THRESHOLDS.HIGH_CVE_AGE_DAYS;

  if (vulns.length === 0) {
    return [
      {
        resourceId: "spotlight-vulnerabilities",
        status: "not_applicable",
        message: "Spotlight returned no open critical/high vulnerability records for managed hosts (module not licensed, or genuinely none)",
        evidencePayload: buildEvidencePayload({ resourceType: "crowdstrike_vulnerability", resourceId: "spotlight-vulnerabilities", resourceName: "Spotlight vulnerability exposure", region: null, details: { records: 0, criticalAgeDays: critDays, highAgeDays: highDays } }),
      },
    ];
  }

  const open = vulns.filter((v) => {
    const status = String(v.status ?? "").toLowerCase();
    return status === "" || OPEN_VULN_STATUSES.has(status);
  });

  const breaching = [];
  for (const v of open) {
    const sev = cveSeverity(v);
    if (sev !== "CRITICAL" && sev !== "HIGH") continue;
    const age = daysSince(v.created_timestamp ?? v.created_on ?? v.first_seen_timestamp);
    if (age == null) continue;
    const limit = sev === "CRITICAL" ? critDays : highDays;
    if (age > limit) breaching.push({ v, sev, age, limit });
  }

  if (breaching.length === 0) {
    return [
      {
        resourceId: "spotlight-vulnerabilities",
        status: "pass",
        message: `No open critical/high CVE exposure exceeds the review threshold (${critDays}d critical / ${highDays}d high) across ${open.length} open record(s)`,
        evidencePayload: buildEvidencePayload({ resourceType: "crowdstrike_vulnerability", resourceId: "spotlight-vulnerabilities", resourceName: "Spotlight vulnerability exposure", region: null, details: { openRecords: open.length, breaching: 0, criticalAgeDays: critDays, highAgeDays: highDays } }),
      },
    ];
  }

  return breaching.map(({ v, sev, age, limit }) => ({
    resourceId: `${cveId(v)}:${vulnHostname(v) ?? "host"}`,
    status: "fail",
    message: `${sev} ${cveId(v)} on "${vulnHostname(v) ?? "unknown host"}" has been open ${Math.round(age)} days (> ${limit}d policy threshold) — patch, mitigate, or record a documented risk acceptance`,
    evidencePayload: buildEvidencePayload({
      resourceType: "crowdstrike_vulnerability",
      resourceId: `${cveId(v)}:${vulnHostname(v) ?? "host"}`,
      resourceName: `${cveId(v)} — ${vulnHostname(v) ?? "unknown host"}`,
      region: null,
      details: {
        cve: cveId(v),
        severity: sev,
        status: v.status ?? "open",
        ageDays: Math.round(age),
        thresholdDays: limit,
        cvssBaseScore: v.cve?.base_score ?? v.cve?.cvss_base_score ?? null,
        exprtRating: v.cve?.exprt_rating ?? null,
        hostname: vulnHostname(v),
      },
    }),
  }));
}

export const vulnerabilityTests = [
  {
    key: "crowdstrike.vulnerability.critical_exposure_review",
    title: "Critical/high CVE exposure on managed hosts is within policy",
    failTitle: "Critical/high CVE exposure has exceeded the policy age threshold",
    severityDefault: "critical",
    isoReferences: ["A.12.6.1"],
    dpdpaControlAreas: ["Vulnerability Management"],
    run: (clients) => checkCriticalExposureReview(clients),
  },
];
