import { describe, test, expect } from "vitest";
import { checkTransparentDataEncryptionEnabled, checkPublicNetworkAccessDisabled, checkAuditingEnabled } from "../connectors/azure/tests/sql.js";

function asyncIterable(items) {
  return { [Symbol.asyncIterator]: async function* () { for (const item of items) yield item; } };
}

describe("checkTransparentDataEncryptionEnabled", () => {
  test("passes a database with TDE enabled", async () => {
    const sql = {
      servers: { list: () => asyncIterable([{ id: "/subscriptions/s/resourceGroups/rg/providers/Microsoft.Sql/servers/srv", name: "srv" }]) },
      databases: { listByServer: () => asyncIterable([{ id: ".../databases/db1", name: "db1" }]) },
      transparentDataEncryptions: { listByDatabase: () => asyncIterable([{ state: "Enabled" }]) },
    };
    const results = await checkTransparentDataEncryptionEnabled(sql);
    expect(results).toEqual([{ resourceId: ".../databases/db1", status: "pass", message: "srv/db1 has transparent data encryption enabled", evidencePayload: { server: "srv", database: "db1" } }]);
  });

  test("fails a database with TDE disabled", async () => {
    const sql = {
      servers: { list: () => asyncIterable([{ id: "/subscriptions/s/resourceGroups/rg/providers/Microsoft.Sql/servers/srv", name: "srv" }]) },
      databases: { listByServer: () => asyncIterable([{ id: ".../databases/db1", name: "db1" }]) },
      transparentDataEncryptions: { listByDatabase: () => asyncIterable([{ state: "Disabled" }]) },
    };
    const results = await checkTransparentDataEncryptionEnabled(sql);
    expect(results[0].status).toBe("fail");
  });

  test("skips the system 'master' database", async () => {
    const sql = {
      servers: { list: () => asyncIterable([{ id: "/subscriptions/s/resourceGroups/rg/providers/Microsoft.Sql/servers/srv", name: "srv" }]) },
      databases: { listByServer: () => asyncIterable([{ id: ".../databases/master", name: "master" }]) },
      transparentDataEncryptions: { listByDatabase: () => asyncIterable([]) },
    };
    const results = await checkTransparentDataEncryptionEnabled(sql);
    expect(results).toEqual([{ resourceId: "subscription", status: "not_applicable", message: "No Azure SQL databases found", evidencePayload: {} }]);
  });

  test("returns not_applicable when there are no servers", async () => {
    const sql = { servers: { list: () => asyncIterable([]) } };
    const results = await checkTransparentDataEncryptionEnabled(sql);
    expect(results).toEqual([{ resourceId: "subscription", status: "not_applicable", message: "No Azure SQL servers found", evidencePayload: {} }]);
  });
});

describe("checkPublicNetworkAccessDisabled", () => {
  test("passes a server with public network access disabled", async () => {
    const sql = { servers: { list: () => asyncIterable([{ id: "/subscriptions/s/resourceGroups/rg/servers/srv", name: "srv", publicNetworkAccess: "Disabled" }]) } };
    const results = await checkPublicNetworkAccessDisabled(sql);
    expect(results[0].status).toBe("pass");
  });

  test("fails a server with public access enabled and a fully-open firewall rule", async () => {
    const sql = {
      servers: { list: () => asyncIterable([{ id: "/subscriptions/s/resourceGroups/rg/servers/srv", name: "srv", publicNetworkAccess: "Enabled" }]) },
      firewallRules: { listByServer: () => asyncIterable([{ name: "AllowAll", startIpAddress: "0.0.0.0", endIpAddress: "255.255.255.255" }]) },
    };
    const results = await checkPublicNetworkAccessDisabled(sql);
    expect(results[0].status).toBe("fail");
  });

  test("passes a server with public access enabled but no fully-open firewall rule", async () => {
    const sql = {
      servers: { list: () => asyncIterable([{ id: "/subscriptions/s/resourceGroups/rg/servers/srv", name: "srv", publicNetworkAccess: "Enabled" }]) },
      firewallRules: { listByServer: () => asyncIterable([{ name: "office", startIpAddress: "203.0.113.1", endIpAddress: "203.0.113.1" }]) },
    };
    const results = await checkPublicNetworkAccessDisabled(sql);
    expect(results[0].status).toBe("pass");
  });

  test("returns not_applicable when there are no servers", async () => {
    const sql = { servers: { list: () => asyncIterable([]) } };
    const results = await checkPublicNetworkAccessDisabled(sql);
    expect(results).toEqual([{ resourceId: "subscription", status: "not_applicable", message: "No Azure SQL servers found", evidencePayload: {} }]);
  });
});

describe("checkAuditingEnabled", () => {
  test("passes a server with auditing enabled", async () => {
    const sql = {
      servers: { list: () => asyncIterable([{ id: "/subscriptions/s/resourceGroups/rg/servers/srv", name: "srv" }]) },
      serverBlobAuditingPolicies: { get: async () => ({ state: "Enabled", retentionDays: 90 }) },
    };
    const results = await checkAuditingEnabled(sql);
    expect(results).toEqual([{ resourceId: "/subscriptions/s/resourceGroups/rg/servers/srv", status: "pass", message: "srv has auditing enabled", evidencePayload: { server: "srv", state: "Enabled", retentionDays: 90 } }]);
  });

  test("fails a server with auditing disabled", async () => {
    const sql = {
      servers: { list: () => asyncIterable([{ id: "/subscriptions/s/resourceGroups/rg/servers/srv", name: "srv" }]) },
      serverBlobAuditingPolicies: { get: async () => ({ state: "Disabled" }) },
    };
    const results = await checkAuditingEnabled(sql);
    expect(results[0].status).toBe("fail");
  });

  test("returns not_applicable when there are no servers", async () => {
    const sql = { servers: { list: () => asyncIterable([]) } };
    const results = await checkAuditingEnabled(sql);
    expect(results).toEqual([{ resourceId: "subscription", status: "not_applicable", message: "No Azure SQL servers found", evidencePayload: {} }]);
  });
});
