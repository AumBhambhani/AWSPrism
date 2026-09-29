import { DescribeRepositoriesCommand, GetRepositoryPolicyCommand } from "@aws-sdk/client-ecr";

async function listAllRepositories(ecr) {
  let repos = [];
  let nextToken;
  do {
    const resp = await ecr.send(new DescribeRepositoriesCommand(nextToken ? { nextToken } : {}));
    repos = repos.concat(resp.repositories || []);
    nextToken = resp.nextToken;
  } while (nextToken);
  return repos;
}

function hasWildcardPrincipal(statement) {
  if (statement.Effect !== "Allow") return false;
  const principal = statement.Principal;
  if (principal === "*") return true;
  if (principal && typeof principal === "object") {
    const values = [].concat(principal.AWS ?? []).concat(principal["*"] ?? []);
    return values.includes("*");
  }
  return false;
}

export async function checkEcrImageScanningEnabled(ecr) {
  const repos = await listAllRepositories(ecr);
  if (repos.length === 0) {
    return [{ resourceId: "account", status: "not_applicable", message: "No ECR repositories found", evidencePayload: {} }];
  }
  return repos.map((repo) => {
    const pass = Boolean(repo.imageScanningConfiguration?.scanOnPush);
    return {
      resourceId: repo.repositoryArn || repo.repositoryName,
      status: pass ? "pass" : "fail",
      message: pass
        ? `${repo.repositoryName} has scan-on-push enabled`
        : `${repo.repositoryName} does not have scan-on-push enabled`,
      evidencePayload: { repositoryName: repo.repositoryName, scanOnPush: Boolean(repo.imageScanningConfiguration?.scanOnPush) },
    };
  });
}

export async function checkEcrTagImmutabilityEnabled(ecr) {
  const repos = await listAllRepositories(ecr);
  if (repos.length === 0) {
    return [{ resourceId: "account", status: "not_applicable", message: "No ECR repositories found", evidencePayload: {} }];
  }
  return repos.map((repo) => {
    const pass = repo.imageTagMutability === "IMMUTABLE";
    return {
      resourceId: repo.repositoryArn || repo.repositoryName,
      status: pass ? "pass" : "fail",
      message: pass
        ? `${repo.repositoryName} has immutable image tags`
        : `${repo.repositoryName} has mutable image tags (${repo.imageTagMutability})`,
      evidencePayload: { repositoryName: repo.repositoryName, imageTagMutability: repo.imageTagMutability },
    };
  });
}

export async function checkEcrNoWildcardRepositoryPolicy(ecr) {
  const repos = await listAllRepositories(ecr);
  if (repos.length === 0) {
    return [{ resourceId: "account", status: "not_applicable", message: "No ECR repositories found", evidencePayload: {} }];
  }
  const results = [];
  for (const repo of repos) {
    let policyDoc = null;
    try {
      const resp = await ecr.send(new GetRepositoryPolicyCommand({ repositoryName: repo.repositoryName }));
      policyDoc = JSON.parse(resp.policyText);
    } catch (err) {
      // RepositoryPolicyNotFoundException means no policy is attached — treat as pass
      if (err.name === "RepositoryPolicyNotFoundException") {
        results.push({ resourceId: repo.repositoryArn || repo.repositoryName, status: "pass", message: `${repo.repositoryName} has no repository policy`, evidencePayload: { repositoryName: repo.repositoryName, hasPolicy: false } });
        continue;
      }
      throw err;
    }
    const wildcardStatements = (policyDoc?.Statement || []).filter(hasWildcardPrincipal);
    const pass = wildcardStatements.length === 0;
    results.push({
      resourceId: repo.repositoryArn || repo.repositoryName,
      status: pass ? "pass" : "fail",
      message: pass
        ? `${repo.repositoryName} repository policy does not grant a wildcard principal`
        : `${repo.repositoryName} repository policy grants access to a wildcard principal ("*")`,
      evidencePayload: { repositoryName: repo.repositoryName, hasPolicy: true, wildcardStatementCount: wildcardStatements.length },
    });
  }
  return results;
}

export const ecrTests = [
  { key: "aws.ecr.image_scanning_enabled", title: "ECR repositories scan images on push", failTitle: "ECR repository does not scan images on push", severityDefault: "high", isoReferences: ["A.12.6.1"], dpdpaControlAreas: ["Vulnerability & Patch Management"], run: (clients) => checkEcrImageScanningEnabled(clients.ecr) },
  { key: "aws.ecr.tag_immutability_enabled", title: "ECR repositories enforce immutable image tags", failTitle: "ECR repository does not enforce immutable image tags", severityDefault: "medium", isoReferences: ["A.12.5.1"], run: (clients) => checkEcrTagImmutabilityEnabled(clients.ecr) },
  { key: "aws.ecr.no_wildcard_repository_policy", title: "ECR repository policies do not grant a wildcard principal", failTitle: "ECR repository policy grants access to a wildcard principal", severityDefault: "critical", isoReferences: ["A.9.1.2"], run: (clients) => checkEcrNoWildcardRepositoryPolicy(clients.ecr) },
];
