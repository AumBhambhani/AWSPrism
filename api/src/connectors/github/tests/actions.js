export async function checkActionsDefaultWorkflowPermissionsReadonly(octokit, org) {
  const { data } = await octokit.rest.actions.getGithubActionsDefaultWorkflowPermissionsOrganization({ org });

  if (data.default_workflow_permissions === undefined) {
    return [{
      resourceId: org,
      status: "not_applicable",
      message: `${org}'s default Actions workflow permissions are not visible with this App's current permissions`,
      evidencePayload: { org },
    }];
  }

  const readonly = data.default_workflow_permissions === "read";
  return [{
    resourceId: org,
    status: readonly ? "pass" : "fail",
    message: readonly
      ? `${org}'s default Actions workflow token permissions are read-only`
      : `${org}'s default Actions workflow token permissions are read-write`,
    evidencePayload: { org, defaultWorkflowPermissions: data.default_workflow_permissions },
  }];
}

export async function checkActionsThirdPartyRestricted(octokit, org) {
  const { data } = await octokit.rest.actions.getGithubActionsPermissionsOrganization({ org });

  if (data.allowed_actions === undefined) {
    return [{
      resourceId: org,
      status: "not_applicable",
      message: `${org}'s allowed-Actions setting is not visible with this App's current permissions`,
      evidencePayload: { org },
    }];
  }

  const restricted = data.allowed_actions !== "all";
  return [{
    resourceId: org,
    status: restricted ? "pass" : "fail",
    message: restricted
      ? `${org} restricts which Actions and reusable workflows can run (allowed_actions: "${data.allowed_actions}")`
      : `${org} allows any Action or reusable workflow from the GitHub Marketplace to run`,
    evidencePayload: { org, allowedActions: data.allowed_actions },
  }];
}

export const actionsTests = [
  { key: "github.org.actions_default_workflow_permissions_readonly", title: "Actions default workflow token permissions are read-only", failTitle: "Actions default workflow token permissions are read-write", severityDefault: "high", isoReferences: ["A.9.4.1"], dpdpaControlAreas: ["Privileged Access Management"], run: (clients) => checkActionsDefaultWorkflowPermissionsReadonly(clients.octokit, clients.org) },
  { key: "github.org.actions_third_party_restricted", title: "Actions are restricted to verified or selected sources", failTitle: "Actions are not restricted to verified or selected sources", severityDefault: "medium", isoReferences: ["A.14.2.2"], dpdpaControlAreas: ["Secure Development & API Security"], run: (clients) => checkActionsThirdPartyRestricted(clients.octokit, clients.org) },
];
