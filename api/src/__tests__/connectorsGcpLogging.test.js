import { describe, test, expect } from "vitest";
import { checkDataAccessAuditLogsEnabled } from "../connectors/gcp/tests/logging.js";

function crmWith(auditConfigs) {
  return { projects: { getIamPolicy: async () => ({ data: { auditConfigs } }) } };
}

describe("checkDataAccessAuditLogsEnabled", () => {
  test("passes when DATA_READ and DATA_WRITE are both enabled for allServices", async () => {
    const crm = crmWith([{ service: "allServices", auditLogConfigs: [{ logType: "DATA_READ" }, { logType: "DATA_WRITE" }] }]);
    const results = await checkDataAccessAuditLogsEnabled(crm, "p");
    expect(results[0].status).toBe("pass");
  });

  test("fails when only DATA_READ is enabled", async () => {
    const crm = crmWith([{ service: "allServices", auditLogConfigs: [{ logType: "DATA_READ" }] }]);
    const results = await checkDataAccessAuditLogsEnabled(crm, "p");
    expect(results[0].status).toBe("fail");
  });

  test("fails when there is no audit config at all", async () => {
    const crm = crmWith([]);
    const results = await checkDataAccessAuditLogsEnabled(crm, "p");
    expect(results[0].status).toBe("fail");
  });

  test("fails when audit config exists only for a specific service, not allServices", async () => {
    const crm = crmWith([{ service: "storage.googleapis.com", auditLogConfigs: [{ logType: "DATA_READ" }, { logType: "DATA_WRITE" }] }]);
    const results = await checkDataAccessAuditLogsEnabled(crm, "p");
    expect(results[0].status).toBe("fail");
  });
});
