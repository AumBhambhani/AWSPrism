import { describe, test, expect } from "vitest";
import { checkFirewallNoOpenManagementPorts } from "../connectors/gcp/tests/network.js";

function computeWith(items) {
  return { firewalls: { list: async () => ({ data: { items } }) } };
}

describe("checkFirewallNoOpenManagementPorts", () => {
  test("flags an enabled ingress rule opening SSH to 0.0.0.0/0", async () => {
    const compute = computeWith([{ name: "fw1", direction: "INGRESS", disabled: false, sourceRanges: ["0.0.0.0/0"], allowed: [{ IPProtocol: "tcp", ports: ["22"] }] }]);
    const results = await checkFirewallNoOpenManagementPorts(compute, "p");
    expect(results[0].status).toBe("fail");
    expect(results[0].evidencePayload.exposedPorts).toContain("22");
  });

  test("flags a port range that includes 3389", async () => {
    const compute = computeWith([{ name: "fw1", direction: "INGRESS", disabled: false, sourceRanges: ["0.0.0.0/0"], allowed: [{ IPProtocol: "tcp", ports: ["3000-4000"] }] }]);
    const results = await checkFirewallNoOpenManagementPorts(compute, "p");
    expect(results[0].status).toBe("fail");
  });

  test("ignores a disabled rule", async () => {
    const compute = computeWith([{ name: "fw1", direction: "INGRESS", disabled: true, sourceRanges: ["0.0.0.0/0"], allowed: [{ IPProtocol: "tcp", ports: ["22"] }] }]);
    const results = await checkFirewallNoOpenManagementPorts(compute, "p");
    expect(results[0].status).toBe("pass");
  });

  test("ignores an egress rule", async () => {
    const compute = computeWith([{ name: "fw1", direction: "EGRESS", disabled: false, sourceRanges: ["0.0.0.0/0"], allowed: [{ IPProtocol: "tcp", ports: ["22"] }] }]);
    const results = await checkFirewallNoOpenManagementPorts(compute, "p");
    expect(results[0].status).toBe("pass");
  });

  test("passes a rule scoped to a private source range", async () => {
    const compute = computeWith([{ name: "fw1", direction: "INGRESS", disabled: false, sourceRanges: ["10.0.0.0/8"], allowed: [{ IPProtocol: "tcp", ports: ["22"] }] }]);
    const results = await checkFirewallNoOpenManagementPorts(compute, "p");
    expect(results[0].status).toBe("pass");
  });

  test("returns not_applicable when there are no firewall rules", async () => {
    const compute = computeWith([]);
    const results = await checkFirewallNoOpenManagementPorts(compute, "p");
    expect(results[0].status).toBe("not_applicable");
  });
});
