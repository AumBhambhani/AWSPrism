import { describe, test, expect, beforeEach, vi } from "vitest";

const queryMock = vi.fn();
const openStreamMock = vi.fn();
const saveMock = vi.fn();
const deleteMock = vi.fn();
const getStorageMigrationMock = vi.fn();
const deleteStorageMigrationMock = vi.fn();
const getStorageCredentialMock = vi.fn();

vi.mock("../db/index.js", () => ({
  query: (...args) => queryMock(...args),
  mapRow: (r) => (r && r.rows && r.rows[0]) || null,
}));

vi.mock("../db/storageMigrations.js", () => ({
  getStorageMigration: (...a) => getStorageMigrationMock(...a),
  deleteStorageMigration: (...a) => deleteStorageMigrationMock(...a),
}));

vi.mock("../db/storageCredentials.js", () => ({
  getStorageCredential: (...a) => getStorageCredentialMock(...a),
}));

vi.mock("../utils/evidenceStorage.js", async (importOriginal) => {
  const actual = await importOriginal();
  return {
    ...actual,
    getBackendHandler: vi.fn(({ backend }) => ({
      openStream: (key) => openStreamMock(backend, key),
      save: (companyId, opts) => saveMock(backend, companyId, opts),
      delete: (key) => deleteMock(backend, key),
    })),
  };
});

const { runStorageMigration } = await import("../utils/storageMigration.js");

const S3_SOURCE = { fromBackend: "s3", fromConfig: { bucket: "old" }, fromAuthType: "access_key", fromSecret: { accessKeyId: "A", secretAccessKey: "B" } };
const LOCAL_SOURCE = { fromBackend: "local", fromConfig: {}, fromAuthType: null, fromSecret: null };

beforeEach(() => {
  queryMock.mockReset().mockResolvedValue({ rows: [] });
  openStreamMock.mockReset();
  saveMock.mockReset();
  deleteMock.mockReset();
  getStorageMigrationMock.mockReset();
  deleteStorageMigrationMock.mockReset().mockResolvedValue(undefined);
  getStorageCredentialMock.mockReset().mockResolvedValue({ authType: "connection_string", secret: { connectionString: "cs" } });
});

// collectRefs issues 3 SELECTs (evidence, evidence_vault, evidence_versions) after
// the initial target-descriptor SELECT. Wire the target row + ref rows in order.
function wire({ targetBackend = "azure_blob", evidence = [], vault = [], versions = [] }) {
  queryMock.mockReset();
  queryMock
    .mockResolvedValueOnce({ rows: [{ evidenceStorageBackend: targetBackend, evidenceStorageConfig: { container: "c" } }] })
    .mockResolvedValueOnce({ rows: evidence.map((ref) => ({ ref })) })
    .mockResolvedValueOnce({ rows: vault.map((ref) => ({ ref })) })
    .mockResolvedValueOnce({ rows: versions.map((ref) => ({ ref })) })
    .mockResolvedValue({ rows: [] }); // rewriteRef UPDATEs + final status UPDATE
}

describe("runStorageMigration", () => {
  test("resumes from the storage_migrations row and rewrites refs", async () => {
    getStorageMigrationMock.mockResolvedValue(S3_SOURCE);
    wire({ evidence: ["s3:7/a.pdf"], vault: ["s3:7/a.pdf", "s3:7/b.pdf"], versions: ["s3:7/b.pdf"] });
    openStreamMock.mockImplementation(async () => (async function* () { yield Buffer.from("x"); })());
    saveMock.mockImplementation(async (backend, cid, opts) => `key/${opts.originalName}`);

    await runStorageMigration(7);

    expect(saveMock).toHaveBeenCalledTimes(2); // two distinct source objects
    expect(saveMock.mock.calls.every((c) => c[0] === "azure_blob")).toBe(true);
    expect(openStreamMock.mock.calls.every((c) => c[0] === "s3")).toBe(true);
  });

  test("on success deletes the storage_migrations row and clears status", async () => {
    getStorageMigrationMock.mockResolvedValue(LOCAL_SOURCE);
    wire({ evidence: ["local:/u/7/a.pdf"] });
    openStreamMock.mockImplementation(async () => (async function* () { yield Buffer.from("x"); })());
    saveMock.mockResolvedValue("azure/a.pdf");

    await runStorageMigration(7);

    expect(deleteStorageMigrationMock).toHaveBeenCalledWith(7);
    const statusClear = queryMock.mock.calls.find((c) => /evidence_storage_migration_status = NULL/.test(c[0]));
    expect(statusClear).toBeTruthy();
  });

  test("on a copy error keeps the row and marks failed", async () => {
    getStorageMigrationMock.mockResolvedValue(S3_SOURCE);
    wire({ evidence: ["s3:7/a.pdf"] });
    openStreamMock.mockImplementation(async () => (async function* () { yield Buffer.from("x"); })());
    saveMock.mockRejectedValue(new Error("azure unreachable"));

    await runStorageMigration(7);

    expect(deleteStorageMigrationMock).not.toHaveBeenCalled();
    const failCall = queryMock.mock.calls.find((c) => /migration_status = 'failed'/.test(c[0]));
    expect(failCall).toBeTruthy();
    // F-23: the admin sees a safe summary; the raw error only goes to the server log.
    expect(String(failCall[1][1])).toMatch(/^Could not copy the evidence files/);
    expect(String(failCall[1][1])).not.toMatch(/azure unreachable/);
  });

  test("no storage_migrations row → clears status, no copy work", async () => {
    getStorageMigrationMock.mockResolvedValue(null);

    await runStorageMigration(7);

    expect(saveMock).not.toHaveBeenCalled();
    expect(deleteStorageMigrationMock).toHaveBeenCalledWith(7);
  });

  test("_running guard makes a concurrent second call a no-op", async () => {
    let release;
    getStorageMigrationMock.mockImplementation(() => new Promise((r) => { release = () => r(LOCAL_SOURCE); }));
    wire({ evidence: [] });

    const first = runStorageMigration(7);
    const second = runStorageMigration(7); // should bail immediately on the _running guard
    await second;
    expect(getStorageMigrationMock).toHaveBeenCalledTimes(1);
    release();
    await first;
  });
});
