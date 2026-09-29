export async function checkVulnerabilityAlertsEnabled(octokit, org, repos) {
  const results = [];
  for (const repo of repos) {
    try {
      await octokit.rest.repos.checkVulnerabilityAlerts({ owner: org, repo: repo.name });
      results.push({ resourceId: `${org}/${repo.name}`, status: "pass", message: `${repo.name} has Dependabot vulnerability alerts enabled`, evidencePayload: { repo: repo.name } });
    } catch (err) {
      if (err.status === 404) {
        results.push({ resourceId: `${org}/${repo.name}`, status: "fail", message: `${repo.name} does not have Dependabot vulnerability alerts enabled`, evidencePayload: { repo: repo.name } });
      } else {
        throw err;
      }
    }
  }
  if (results.length === 0) {
    results.push({ resourceId: org, status: "not_applicable", message: "No repositories found", evidencePayload: {} });
  }
  return results;
}

export async function checkSecretScanningEnabled(octokit, org, repos) {
  const results = [];
  for (const repo of repos) {
    const { data } = await octokit.rest.repos.get({ owner: org, repo: repo.name });
    const status = data.security_and_analysis?.secret_scanning?.status;
    if (!status) {
      // No security_and_analysis block at all means GitHub Advanced Security
      // isn't licensed on this repo — the org can't control this setting here,
      // so flagging it as a "fail" would be a false negative, not a real gap.
      results.push({ resourceId: `${org}/${repo.name}`, status: "not_applicable", message: `${repo.name} does not have GitHub Advanced Security available to report secret scanning status`, evidencePayload: { repo: repo.name } });
      continue;
    }
    const enabled = status === "enabled";
    results.push({
      resourceId: `${org}/${repo.name}`,
      status: enabled ? "pass" : "fail",
      message: enabled ? `${repo.name} has secret scanning enabled` : `${repo.name} has secret scanning disabled`,
      evidencePayload: { repo: repo.name, secretScanningStatus: status },
    });
  }
  if (results.length === 0) {
    results.push({ resourceId: org, status: "not_applicable", message: "No repositories found", evidencePayload: {} });
  }
  return results;
}

export const securityTests = [
  { key: "github.repo.vulnerability_alerts_enabled", title: "Dependabot vulnerability alerts are enabled", failTitle: "Dependabot vulnerability alerts are not enabled", severityDefault: "high", isoReferences: ["A.12.6.1"], dpdpaControlAreas: ["Vulnerability & Patch Management"], run: (clients) => checkVulnerabilityAlertsEnabled(clients.octokit, clients.org, clients.repos) },
  { key: "github.repo.secret_scanning_enabled", title: "Secret scanning is enabled", failTitle: "Secret scanning is disabled", severityDefault: "medium", isoReferences: ["A.9.4.3"], dpdpaControlAreas: ["DLP / Data Leakage Prevention"], run: (clients) => checkSecretScanningEnabled(clients.octokit, clients.org, clients.repos) },
];
