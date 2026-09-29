export async function checkCodeScanningDefaultSetupEnabled(octokit, org, repos) {
  const results = [];
  for (const repo of repos) {
    try {
      const { data } = await octokit.rest.codeScanning.getDefaultSetup({ owner: org, repo: repo.name });
      const enabled = data.state === "configured";
      results.push({
        resourceId: `${org}/${repo.name}`,
        status: enabled ? "pass" : "fail",
        message: enabled
          ? `${repo.name} has CodeQL default setup configured`
          : `${repo.name} does not have CodeQL default setup configured`,
        evidencePayload: { repo: repo.name, codeScanningDefaultSetupState: data.state },
      });
    } catch (err) {
      // Same "feature not licensed on this repo" treatment as
      // checkSecretScanningEnabled's missing security_and_analysis block —
      // a 404 here means code scanning isn't available, not that it failed.
      if (err.status === 404) {
        results.push({
          resourceId: `${org}/${repo.name}`,
          status: "not_applicable",
          message: `${repo.name} does not have code scanning available to report default setup status`,
          evidencePayload: { repo: repo.name },
        });
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

export const codeScanningTests = [
  { key: "github.repo.code_scanning_default_setup_enabled", title: "Code scanning (CodeQL) default setup is enabled", failTitle: "Code scanning (CodeQL) default setup is not enabled", severityDefault: "high", isoReferences: ["A.12.6.1"], dpdpaControlAreas: ["Vulnerability & Patch Management"], run: (clients) => checkCodeScanningDefaultSetupEnabled(clients.octokit, clients.org, clients.repos) },
];
