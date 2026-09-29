import { describe, test, expect } from "vitest";
import { checkAssignmentsCompliant } from "../connectors/azure/tests/policy.js";

describe("checkAssignmentsCompliant", () => {
  test("passes when there are no non-compliant resources", async () => {
    const policyInsights = { policyStates: { summarizeForSubscription: async () => ({ value: [{ results: { nonCompliantResources: 0, nonCompliantPolicies: 0 } }] }) } };
    const results = await checkAssignmentsCompliant(policyInsights, "sub-1");
    expect(results).toEqual([{ resourceId: "subscription", status: "pass", message: "All resources are compliant with assigned Azure Policy definitions", evidencePayload: { nonCompliantResources: 0, nonCompliantPolicies: 0 } }]);
  });

  test("fails when there are non-compliant resources", async () => {
    const policyInsights = { policyStates: { summarizeForSubscription: async () => ({ value: [{ results: { nonCompliantResources: 5, nonCompliantPolicies: 2 } }] }) } };
    const results = await checkAssignmentsCompliant(policyInsights, "sub-1");
    expect(results).toEqual([{ resourceId: "subscription", status: "fail", message: "5 resource(s) are non-compliant with assigned Azure Policy definitions", evidencePayload: { nonCompliantResources: 5, nonCompliantPolicies: 2 } }]);
  });

  test("returns not_applicable when no compliance summary is available", async () => {
    const policyInsights = { policyStates: { summarizeForSubscription: async () => ({ value: [] }) } };
    const results = await checkAssignmentsCompliant(policyInsights, "sub-1");
    expect(results).toEqual([{ resourceId: "subscription", status: "not_applicable", message: "No policy compliance data available", evidencePayload: {} }]);
  });
});
