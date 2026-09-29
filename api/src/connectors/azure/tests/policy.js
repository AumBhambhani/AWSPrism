export async function checkAssignmentsCompliant(policyInsights, subscriptionId) {
  const summary = await policyInsights.policyStates.summarizeForSubscription(subscriptionId);
  const summaries = summary?.value ?? [];
  if (summaries.length === 0) {
    return [{ resourceId: "subscription", status: "not_applicable", message: "No policy compliance data available", evidencePayload: {} }];
  }
  const queryResults = summaries[0]?.results ?? {};
  const nonCompliantResources = queryResults.nonCompliantResources ?? 0;
  const nonCompliantPolicies = queryResults.nonCompliantPolicies ?? 0;
  const pass = nonCompliantResources === 0;
  return [{
    resourceId: "subscription",
    status: pass ? "pass" : "fail",
    message: pass
      ? "All resources are compliant with assigned Azure Policy definitions"
      : `${nonCompliantResources} resource(s) are non-compliant with assigned Azure Policy definitions`,
    evidencePayload: { nonCompliantResources, nonCompliantPolicies },
  }];
}

export const policyTests = [
  { key: "azure.policy.assignments_compliant", title: "Assigned Azure Policy definitions report a compliant state", failTitle: "Resources are non-compliant with assigned Azure Policy definitions", severityDefault: "medium", isoReferences: ["A.18.2.2"], dpdpaControlAreas: ["Security Safeguards Program"], run: (clients) => checkAssignmentsCompliant(clients.policyInsights, clients.subscriptionId) },
];
