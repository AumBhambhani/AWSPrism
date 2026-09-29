import { describe, test, expect } from "vitest";
import { checkSqlSslEnforced, checkSqlPublicAccessDisabled } from "../connectors/gcp/tests/sql.js";

function sqladminWith(items) {
  return { instances: { list: async () => ({ data: { items } }) } };
}

describe("checkSqlSslEnforced", () => {
  test("passes via the legacy requireSsl flag when sslMode is absent", async () => {
    const sqladmin = sqladminWith([{ name: "db1", settings: { ipConfiguration: { requireSsl: true } } }]);
    const results = await checkSqlSslEnforced(sqladmin, "p");
    expect(results[0].status).toBe("pass");
  });

  test("fails when requireSsl is false and sslMode is absent", async () => {
    const sqladmin = sqladminWith([{ name: "db1", settings: { ipConfiguration: { requireSsl: false } } }]);
    const results = await checkSqlSslEnforced(sqladmin, "p");
    expect(results[0].status).toBe("fail");
  });

  test("sslMode takes priority over requireSsl when both are present", async () => {
    const sqladmin = sqladminWith([{ name: "db1", settings: { ipConfiguration: { requireSsl: false, sslMode: "TRUSTED_CLIENT_CERTIFICATE_REQUIRED" } } }]);
    const results = await checkSqlSslEnforced(sqladmin, "p");
    expect(results[0].status).toBe("pass");
  });

  test("fails an unencrypted sslMode", async () => {
    const sqladmin = sqladminWith([{ name: "db1", settings: { ipConfiguration: { sslMode: "ALLOW_UNENCRYPTED_AND_ENCRYPTED" } } }]);
    const results = await checkSqlSslEnforced(sqladmin, "p");
    expect(results[0].status).toBe("fail");
  });
});

describe("checkSqlPublicAccessDisabled", () => {
  test("passes when no authorized network is 0.0.0.0/0", async () => {
    const sqladmin = sqladminWith([{ name: "db1", settings: { ipConfiguration: { authorizedNetworks: [{ value: "10.0.0.0/8" }] } } }]);
    const results = await checkSqlPublicAccessDisabled(sqladmin, "p");
    expect(results[0].status).toBe("pass");
  });

  test("fails when 0.0.0.0/0 is an authorized network", async () => {
    const sqladmin = sqladminWith([{ name: "db1", settings: { ipConfiguration: { authorizedNetworks: [{ value: "0.0.0.0/0" }] } } }]);
    const results = await checkSqlPublicAccessDisabled(sqladmin, "p");
    expect(results[0].status).toBe("fail");
  });

  test("returns not_applicable when there are no instances", async () => {
    const sqladmin = sqladminWith([]);
    const results = await checkSqlPublicAccessDisabled(sqladmin, "p");
    expect(results[0].status).toBe("not_applicable");
  });
});
