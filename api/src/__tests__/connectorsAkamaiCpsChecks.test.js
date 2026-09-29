import { describe, test, expect } from "vitest";
import {
  checkNoCertsNearExpiry,
  checkAutoRenewalEnabled,
  checkStrongKeyAlgorithm,
  checkNoStuckChanges,
} from "../connectors/akamai/tests/cps.js";

const THRESHOLDS = { CERT_EXPIRY_MIN_DAYS: 30, STUCK_CHANGE_MAX_DAYS: 14 };
const days = (n) => new Date(Date.now() + n * 86400000).toISOString();

function fakeAkamai({ enrollments = [], deployments = {} } = {}) {
  return {
    listContractIds: async () => ["ctr_1"],
    listEnrollments: async () => enrollments,
    getProductionDeployment: async (id) => deployments[id] ?? null,
  };
}

describe("checkNoCertsNearExpiry", () => {
  test("passes when the production cert expires well beyond the threshold", async () => {
    const akamai = fakeAkamai({
      enrollments: [{ enrollmentId: "1", cn: "www.example.com" }],
      deployments: { 1: { primaryCertificate: { expiry: days(90) } } },
    });
    const results = await checkNoCertsNearExpiry({ akamai, THRESHOLDS });
    expect(results[0].status).toBe("pass");
  });

  test("fails when the cert expires within the threshold", async () => {
    const akamai = fakeAkamai({
      enrollments: [{ enrollmentId: "1", cn: "www.example.com" }],
      deployments: { 1: { primaryCertificate: { expiry: days(10) } } },
    });
    const results = await checkNoCertsNearExpiry({ akamai, THRESHOLDS });
    expect(results[0].status).toBe("fail");
    expect(results[0].evidencePayload.daysToExpiry).toBeLessThanOrEqual(10);
  });

  test("error when the deployment has no primaryCertificate.expiry", async () => {
    const akamai = fakeAkamai({
      enrollments: [{ enrollmentId: "1", cn: "www.example.com" }],
      deployments: { 1: { somethingElse: true } },
    });
    const results = await checkNoCertsNearExpiry({ akamai, THRESHOLDS });
    expect(results[0].status).toBe("error");
  });

  test("error when the enrollment has no readable production deployment at all", async () => {
    const akamai = fakeAkamai({
      enrollments: [{ enrollmentId: "1", cn: "www.example.com" }],
      deployments: {},
    });
    const results = await checkNoCertsNearExpiry({ akamai, THRESHOLDS });
    expect(results[0].status).toBe("error");
  });

  test("single not_applicable row when there are no enrollments", async () => {
    const akamai = fakeAkamai({ enrollments: [] });
    const results = await checkNoCertsNearExpiry({ akamai, THRESHOLDS });
    expect(results).toHaveLength(1);
    expect(results[0].status).toBe("not_applicable");
  });
});

describe("checkAutoRenewalEnabled", () => {
  test("passes a DV enrollment (Akamai auto-renews DV)", async () => {
    const akamai = fakeAkamai({ enrollments: [{ enrollmentId: "1", cn: "a.example.com", validationType: "dv" }] });
    const results = await checkAutoRenewalEnabled({ akamai, THRESHOLDS });
    expect(results[0].status).toBe("pass");
  });

  test("fails a third-party enrollment with no admin/tech contact", async () => {
    const akamai = fakeAkamai({
      enrollments: [{ enrollmentId: "1", cn: "a.example.com", validationType: "third-party", adminContact: {}, techContact: {} }],
    });
    const results = await checkAutoRenewalEnabled({ akamai, THRESHOLDS });
    expect(results[0].status).toBe("fail");
  });

  test("passes a third-party enrollment that names an admin contact", async () => {
    const akamai = fakeAkamai({
      enrollments: [{ enrollmentId: "1", cn: "a.example.com", validationType: "third-party", adminContact: { email: "sec@example.com" } }],
    });
    const results = await checkAutoRenewalEnabled({ akamai, THRESHOLDS });
    expect(results[0].status).toBe("pass");
  });

  test("single not_applicable row when there are no enrollments", async () => {
    const akamai = fakeAkamai({ enrollments: [] });
    const results = await checkAutoRenewalEnabled({ akamai, THRESHOLDS });
    expect(results).toHaveLength(1);
    expect(results[0].status).toBe("not_applicable");
  });
});

describe("checkStrongKeyAlgorithm", () => {
  test("passes RSA 2048", async () => {
    const akamai = fakeAkamai({ enrollments: [{ enrollmentId: "1", cn: "a", csr: { keyAlgorithm: "RSA", keySize: 2048 } }] });
    const results = await checkStrongKeyAlgorithm({ akamai, THRESHOLDS });
    expect(results[0].status).toBe("pass");
  });

  test("fails RSA 1024", async () => {
    const akamai = fakeAkamai({ enrollments: [{ enrollmentId: "1", cn: "a", csr: { keyAlgorithm: "RSA", keySize: 1024 } }] });
    const results = await checkStrongKeyAlgorithm({ akamai, THRESHOLDS });
    expect(results[0].status).toBe("fail");
  });

  test("passes ECDSA", async () => {
    const akamai = fakeAkamai({ enrollments: [{ enrollmentId: "1", cn: "a", csr: { keyAlgorithm: "ECDSA" } }] });
    const results = await checkStrongKeyAlgorithm({ akamai, THRESHOLDS });
    expect(results[0].status).toBe("pass");
  });

  test("error when the key algorithm/size cannot be determined", async () => {
    const akamai = fakeAkamai({ enrollments: [{ enrollmentId: "1", cn: "a" }] });
    const results = await checkStrongKeyAlgorithm({ akamai, THRESHOLDS });
    expect(results[0].status).toBe("error");
  });

  test("error when RSA is reported with no key size", async () => {
    const akamai = fakeAkamai({ enrollments: [{ enrollmentId: "1", cn: "a", csr: { keyAlgorithm: "RSA" } }] });
    const results = await checkStrongKeyAlgorithm({ akamai, THRESHOLDS });
    expect(results[0].status).toBe("error");
  });

  test("single not_applicable row when there are no enrollments", async () => {
    const akamai = fakeAkamai({ enrollments: [] });
    const results = await checkStrongKeyAlgorithm({ akamai, THRESHOLDS });
    expect(results).toHaveLength(1);
    expect(results[0].status).toBe("not_applicable");
  });
});

describe("checkNoStuckChanges", () => {
  test("passes when there are no pending changes", async () => {
    const akamai = fakeAkamai({ enrollments: [{ enrollmentId: "1", cn: "a", pendingChanges: [] }] });
    const results = await checkNoStuckChanges({ akamai, THRESHOLDS });
    expect(results[0].status).toBe("pass");
  });

  test("fails when a pending change is older than the threshold", async () => {
    const akamai = fakeAkamai({
      enrollments: [{ enrollmentId: "1", cn: "a", pendingChanges: [{ location: "/cps/v2/enrollments/1/changes/55", createdOn: days(-40) }] }],
    });
    const results = await checkNoStuckChanges({ akamai, THRESHOLDS });
    expect(results[0].status).toBe("fail");
  });

  test("passes when a pending change is recent (not yet stuck)", async () => {
    const akamai = fakeAkamai({
      enrollments: [{ enrollmentId: "1", cn: "a", pendingChanges: [{ location: "/cps/v2/enrollments/1/changes/55", createdOn: days(-2) }] }],
    });
    const results = await checkNoStuckChanges({ akamai, THRESHOLDS });
    expect(results[0].status).toBe("pass");
  });

  test("warns when a pending change has no readable timestamp", async () => {
    const akamai = fakeAkamai({
      enrollments: [{ enrollmentId: "1", cn: "a", pendingChanges: [{ location: "/cps/v2/enrollments/1/changes/55" }] }],
    });
    const results = await checkNoStuckChanges({ akamai, THRESHOLDS });
    expect(results[0].status).toBe("warn");
  });

  test("single not_applicable row when there are no enrollments", async () => {
    const akamai = fakeAkamai({ enrollments: [] });
    const results = await checkNoStuckChanges({ akamai, THRESHOLDS });
    expect(results).toHaveLength(1);
    expect(results[0].status).toBe("not_applicable");
  });
});
