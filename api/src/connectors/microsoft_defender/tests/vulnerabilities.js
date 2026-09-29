import { buildEvidencePayload } from "../../shared/evidencePayload.js";
import { oDataPaginate } from "../oDataPaginate.js";

// ──────────────────────────────────────────────────────────────────────────────
// microsoft_defender.vulnerabilities.critical_cves_remediated
// Checks Critical severity CVEs with a public exploit are remediated within 14 days.
// ──────────────────────────────────────────────────────────────────────────────
async function checkCriticalCvesRemediated(getToken, baseUrl) {
  const vulns = await oDataPaginate(getToken, baseUrl, "/api/vulnerabilities/machinesVulnerabilities?$filter=severity eq 'Critical'");
  const fourteenDaysAgo = Date.now() - 14 * 24 * 60 * 60 * 1000;
  const overSLA = vulns.filter((v) => {
    if (v.publicExploit !== true) return false;
    if (!v.patchReleaseDate && !v.detectionTime) return false;
    const discovered = new Date(v.detectionTime || v.patchReleaseDate).getTime();
    return discovered < fourteenDaysAgo;
  });

  if (overSLA.length === 0) {
    return [{
      resourceId: "vulnerabilities",
      status: "pass",
      message: `No critical CVEs with public exploits are past the 14-day remediation SLA`,
      evidencePayload: buildEvidencePayload({ resourceType: "defender_vulnerabilities", resourceId: "vulnerabilities", region: null, details: { criticalWithPublicExploit: vulns.filter((v) => v.publicExploit).length, overSla: 0 } }),
    }];
  }
  return overSLA.map((v) => ({
    resourceId: v.cveId || v.id,
    status: "fail",
    message: `CVE ${v.cveId || v.id} (Critical, public exploit) has not been remediated within the 14-day SLA`,
    evidencePayload: buildEvidencePayload({
      resourceType: "defender_vulnerability",
      resourceId: v.cveId || v.id,
      resourceName: v.cveId || v.id,
      region: null,
      details: { severity: v.severity, publicExploit: v.publicExploit, detectionTime: v.detectionTime, machineId: v.machineId },
    }),
  }));
}

export const vulnerabilitiesTests = [
  {
    key: "microsoft_defender.vulnerabilities.critical_cves_remediated",
    title: "Critical vulnerabilities with a public exploit are remediated within SLA",
    failTitle: "Critical CVE with a public exploit has not been remediated within the 14-day SLA",
    severityDefault: "critical",
    isoReferences: ["A.12.6.1"],
    dpdpaControlAreas: ["Vulnerability & Patch Management"],
    run: (clients) => checkCriticalCvesRemediated(clients.getToken, clients.baseUrl),
  },
];
