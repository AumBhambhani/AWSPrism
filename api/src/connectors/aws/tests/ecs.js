import { ListClustersCommand, DescribeClustersCommand, ListTaskDefinitionsCommand, DescribeTaskDefinitionCommand } from "@aws-sdk/client-ecs";

export async function checkEcsNoPrivilegedContainers(ecs) {
  let taskDefArns = [];
  let nextToken;
  do {
    const resp = await ecs.send(new ListTaskDefinitionsCommand({ status: "ACTIVE", ...(nextToken ? { nextToken } : {}) }));
    taskDefArns = taskDefArns.concat(resp.taskDefinitionArns || []);
    nextToken = resp.nextToken;
  } while (nextToken);

  if (taskDefArns.length === 0) {
    return [{ resourceId: "account", status: "not_applicable", message: "No active ECS task definitions found", evidencePayload: {} }];
  }

  // Only check the latest active revision per family
  const latestByFamily = new Map();
  for (const arn of taskDefArns) {
    // ARN format: arn:aws:ecs:<region>:<account>:task-definition/<family>:<revision>
    const match = arn.match(/task-definition\/([^:]+):(\d+)$/);
    if (!match) continue;
    const [, family, revStr] = match;
    const rev = parseInt(revStr, 10);
    if (!latestByFamily.has(family) || rev > latestByFamily.get(family).rev) {
      latestByFamily.set(family, { arn, rev });
    }
  }

  const results = [];
  for (const { arn } of latestByFamily.values()) {
    const { taskDefinition } = await ecs.send(new DescribeTaskDefinitionCommand({ taskDefinition: arn }));
    const privilegedContainers = (taskDefinition.containerDefinitions || []).filter((c) => c.privileged === true);
    const pass = privilegedContainers.length === 0;
    results.push({
      resourceId: arn,
      status: pass ? "pass" : "fail",
      message: pass
        ? `${taskDefinition.family}:${taskDefinition.revision} has no privileged containers`
        : `${taskDefinition.family}:${taskDefinition.revision} has ${privilegedContainers.length} privileged container(s): ${privilegedContainers.map((c) => c.name).join(", ")}`,
      evidencePayload: { family: taskDefinition.family, revision: taskDefinition.revision, privilegedContainerCount: privilegedContainers.length },
    });
  }
  return results;
}

export async function checkEcsContainerInsightsEnabled(ecs) {
  let clusterArns = [];
  let nextToken;
  do {
    const resp = await ecs.send(new ListClustersCommand(nextToken ? { nextToken } : {}));
    clusterArns = clusterArns.concat(resp.clusterArns || []);
    nextToken = resp.nextToken;
  } while (nextToken);

  if (clusterArns.length === 0) {
    return [{ resourceId: "account", status: "not_applicable", message: "No ECS clusters found", evidencePayload: {} }];
  }

  const { clusters } = await ecs.send(new DescribeClustersCommand({ clusters: clusterArns, include: ["SETTINGS"] }));
  return (clusters || []).map((cluster) => {
    const insightsSetting = (cluster.settings || []).find((s) => s.name === "containerInsights");
    const pass = insightsSetting?.value === "enabled";
    return {
      resourceId: cluster.clusterArn || cluster.clusterName,
      status: pass ? "pass" : "fail",
      message: pass
        ? `${cluster.clusterName} has Container Insights enabled`
        : `${cluster.clusterName} does not have Container Insights enabled`,
      evidencePayload: { clusterName: cluster.clusterName, containerInsights: insightsSetting?.value ?? "disabled" },
    };
  });
}

export const ecsTests = [
  { key: "aws.ecs.no_privileged_containers", title: "ECS task definitions do not run privileged containers", failTitle: "ECS task definition runs a privileged container", severityDefault: "critical", isoReferences: ["A.9.4.4"], run: (clients) => checkEcsNoPrivilegedContainers(clients.ecs) },
  { key: "aws.ecs.container_insights_enabled", title: "ECS clusters have Container Insights enabled", failTitle: "ECS cluster does not have Container Insights enabled", severityDefault: "medium", isoReferences: ["A.12.4.1"], run: (clients) => checkEcsContainerInsightsEnabled(clients.ecs) },
];
