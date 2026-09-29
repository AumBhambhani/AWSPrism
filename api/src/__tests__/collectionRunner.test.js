import { describe, test, expect, vi, beforeEach } from "vitest";

const queryMock = vi.fn();
const getActiveCredentialMock = vi.fn();
const getConnectorMock = vi.fn();
const writeAuditLogMock = vi.fn();

vi.mock("../db/index.js", () => ({
  query: (...args) => queryMock(...args),
  mapRow: (result) => (result && result.rows && result.rows[0] ? result.rows[0] : null),
  mapRows: (result) => (result && result.rows ? result.rows : []),
}));

vi.mock("../db/integrationCredentials.js", () => ({
  getActiveCredential: (...args) => getActiveCredentialMock(...args),
}));

vi.mock("../connectors/registry.js", () => ({
  getConnector: (...args) => getConnectorMock(...args),
}));

vi.mock("../utils/auditLog.js", () => ({
  writeAuditLog: (...args) => writeAuditLogMock(...args),
}));

vi.mock("../utils/email.js", () => ({
  sendEmail: vi.fn(),
}));

vi.mock("../utils/emailTemplate.js", () => ({
  buildEmailHtml: vi.fn(),
}));

const { runCollection } = await import("../utils/collectionRunner.js");

const CONNECTION_ID = "conn-1";
const COMPANY_ID = "company-1";

beforeEach(() => {
  queryMock.mockReset();
  getActiveCredentialMock.mockReset();
  getConnectorMock.mockReset();
  writeAuditLogMock.mockReset();

  getActiveCredentialMock.mockResolvedValue({ authType: "iam_role", secret: { externalId: "ext-1" } });
});

describe("runCollection concurrency guard", () => {
  test("throws a 409 error when the initial insert hits the running-status unique violation (23505)", async () => {
    queryMock.mockImplementation(async (sql) => {
      if (sql.includes("SELECT * FROM integration_connections")) {
        return { rows: [{ id: CONNECTION_ID, company_id: COMPANY_ID, integration_key: "aws", config: {} }] };
      }
      if (sql.includes("INSERT INTO evidence_collection_runs")) {
        const err = new Error(
          'duplicate key value violates unique constraint "evidence_collection_runs_running_uq"'
        );
        err.code = "23505";
        throw err;
      }
      throw new Error(`Unexpected query in test: ${sql}`);
    });

    let caught;
    try {
      await runCollection({ connectionId: CONNECTION_ID, companyId: COMPANY_ID, triggeredBy: "user-1", triggerType: "manual" });
    } catch (err) {
      caught = err;
    }

    expect(caught).toBeInstanceOf(Error);
    expect(caught.status).toBe(409);
    expect(caught.message).toBe("A collection run is already in progress for this connection");

    // The connector must never be invoked once the run couldn't even be recorded.
    expect(getConnectorMock).not.toHaveBeenCalled();
  });

  test("re-throws non-23505 errors from the initial insert unchanged", async () => {
    queryMock.mockImplementation(async (sql) => {
      if (sql.includes("SELECT * FROM integration_connections")) {
        return { rows: [{ id: CONNECTION_ID, company_id: COMPANY_ID, integration_key: "aws", config: {} }] };
      }
      if (sql.includes("INSERT INTO evidence_collection_runs")) {
        throw new Error("connection refused");
      }
      throw new Error(`Unexpected query in test: ${sql}`);
    });

    await expect(
      runCollection({ connectionId: CONNECTION_ID, companyId: COMPANY_ID, triggeredBy: "user-1", triggerType: "manual" })
    ).rejects.toThrow("connection refused");
  });
});
