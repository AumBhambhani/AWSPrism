import { describe, test, expect, vi } from "vitest";
import request from "supertest";
import app from "../../app.js";
import { createCompany, createUser } from "../setup/helpers.js";
import { query } from "../../db/index.js";
import { upsertStorageMigration } from "../../db/storageMigrations.js";
import { storeStorageCredential } from "../../db/storageCredentials.js";

// Never make real cloud calls — stub the connectivity probe.
vi.mock("../../utils/evidenceStorage.js", async (importOriginal) => {
  const actual = await importOriginal();
  return { ...actual, testBackend: vi.fn().mockResolvedValue(undefined) };
});

// The background migration runner is exercised by its own unit test; here we only
// care that the endpoints wire it up, so make it a deterministic no-op.
const runStorageMigrationMock = vi.fn().mockResolvedValue(undefined);
vi.mock("../../utils/storageMigration.js", async (importOriginal) => {
  const actual = await importOriginal();
  return { ...actual, runStorageMigration: (...a) => runStorageMigrationMock(...a) };
});

describe("GET/PUT /api/settings/evidence-storage", () => {
  test("defaults to the local backend", async () => {
    const company = await createCompany();
    const admin = await createUser(company.id, "ADMIN");

    const res = await request(app)
      .get("/api/settings/evidence-storage")
      .set("Authorization", `Bearer ${admin.token}`);

    expect(res.status).toBe(200);
    expect(res.body.backend).toBe("local");
    expect(res.body.migrationStatus).toBeNull();
  });

  test("non-admins are refused", async () => {
    const company = await createCompany();
    const lead = await createUser(company.id, "LEAD");

    const res = await request(app)
      .get("/api/settings/evidence-storage")
      .set("Authorization", `Bearer ${lead.token}`);

    expect(res.status).toBe(403);
  });

  test("switching to S3 stores an encrypted credential and no plaintext secret", async () => {
    const company = await createCompany();
    const admin = await createUser(company.id, "ADMIN");

    const res = await request(app)
      .put("/api/settings/evidence-storage")
      .set("Authorization", `Bearer ${admin.token}`)
      .send({
        backend: "s3",
        authType: "access_key",
        config: { bucket: "my-eu-bucket", region: "eu-north-1", prefix: "prism/" },
        secret: { accessKeyId: "AKIAEXAMPLE", secretAccessKey: "s3cr3t-value-xyz" },
      });

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ ok: true, migrating: false });

    const settings = await query(
      "SELECT evidence_storage_backend, evidence_storage_config FROM company_settings WHERE company_id = $1",
      [company.id]
    );
    expect(settings.rows[0].evidence_storage_backend).toBe("s3");
    expect(settings.rows[0].evidence_storage_config).toMatchObject({ bucket: "my-eu-bucket", region: "eu-north-1", prefix: "prism" });

    const cred = await query("SELECT * FROM company_storage_credentials WHERE company_id = $1", [company.id]);
    expect(cred.rows).toHaveLength(1);
    expect(cred.rows[0].ciphertext).toBeTruthy();
    expect(JSON.stringify(cred.rows[0])).not.toContain("s3cr3t-value-xyz");

    // GET never leaks the secret
    const get = await request(app)
      .get("/api/settings/evidence-storage")
      .set("Authorization", `Bearer ${admin.token}`);
    expect(get.body.authType).toBe("access_key");
    expect(JSON.stringify(get.body)).not.toContain("s3cr3t-value-xyz");
  });

  test("rejects a malformed S3 body", async () => {
    const company = await createCompany();
    const admin = await createUser(company.id, "ADMIN");

    const res = await request(app)
      .put("/api/settings/evidence-storage")
      .set("Authorization", `Bearer ${admin.token}`)
      .send({ backend: "s3", authType: "access_key", config: { bucket: "b" }, secret: {} });

    expect(res.status).toBe(400);
  });

  test("409 while a migration is already in progress", async () => {
    const company = await createCompany();
    const admin = await createUser(company.id, "ADMIN");
    await query(
      `INSERT INTO company_settings (company_id, evidence_storage_backend, evidence_storage_migration_status)
       VALUES ($1, 'local', 'in_progress')
       ON CONFLICT (company_id) DO UPDATE SET evidence_storage_migration_status = 'in_progress'`,
      [company.id]
    );

    const res = await request(app)
      .put("/api/settings/evidence-storage")
      .set("Authorization", `Bearer ${admin.token}`)
      .send({
        backend: "azure_blob",
        config: { container: "evidence" },
        secret: { connectionString: "DefaultEndpointsProtocol=https;AccountName=x;AccountKey=y;EndpointSuffix=core.windows.net" },
      });

    expect(res.status).toBe(409);
  });

  test("switching back to local removes the stored credential", async () => {
    const company = await createCompany();
    const admin = await createUser(company.id, "ADMIN");

    await request(app)
      .put("/api/settings/evidence-storage")
      .set("Authorization", `Bearer ${admin.token}`)
      .send({
        backend: "azure_blob",
        config: { container: "evidence" },
        secret: { connectionString: "DefaultEndpointsProtocol=https;AccountName=x;AccountKey=y;EndpointSuffix=core.windows.net" },
      });

    const back = await request(app)
      .put("/api/settings/evidence-storage")
      .set("Authorization", `Bearer ${admin.token}`)
      .send({ backend: "local" });

    expect(back.status).toBe(200);
    const cred = await query("SELECT * FROM company_storage_credentials WHERE company_id = $1", [company.id]);
    expect(cred.rows).toHaveLength(0);
  });

  test("switching a company with existing files records a resumable storage_migrations row", async () => {
    const company = await createCompany();
    const admin = await createUser(company.id, "ADMIN");
    await query(
      `INSERT INTO evidence (company_id, evidence_type, evidence_name, file_path, upload_date)
       VALUES ($1, 'FILE', 'a.pdf', 'local:uploads/x/a.pdf', NOW())`,
      [company.id]
    );

    const res = await request(app)
      .put("/api/settings/evidence-storage")
      .set("Authorization", `Bearer ${admin.token}`)
      .send({
        backend: "s3",
        authType: "access_key",
        config: { bucket: "b", region: "eu-north-1" },
        secret: { accessKeyId: "AKIA", secretAccessKey: "shhh" },
      });

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ ok: true, migrating: true });
    expect(runStorageMigrationMock).toHaveBeenCalledWith(company.id);

    const mig = await query("SELECT * FROM storage_migrations WHERE company_id = $1", [company.id]);
    expect(mig.rows).toHaveLength(1);
    expect(mig.rows[0].from_backend).toBe("local");
    expect(mig.rows[0].ciphertext).toBeNull(); // local source has no secret

    const st = await query("SELECT evidence_storage_migration_status FROM company_settings WHERE company_id = $1", [company.id]);
    expect(st.rows[0].evidence_storage_migration_status).toBe("in_progress");
  });

  test("retry-migration resumes a cloud→cloud job from persisted source creds (failed and in_progress, never 409)", async () => {
    for (const status of ["failed", "in_progress"]) {
      runStorageMigrationMock.mockClear();
      const company = await createCompany({ domain: `retry-${status}-${Date.now()}.com` });
      const admin = await createUser(company.id, "ADMIN");

      // A company mid-switch: now on azure, an interrupted migration from s3.
      await query(
        `INSERT INTO company_settings (company_id, evidence_storage_backend, evidence_storage_config, evidence_storage_migration_status)
         VALUES ($1, 'azure_blob', $2, $3)
         ON CONFLICT (company_id) DO UPDATE SET
           evidence_storage_backend = 'azure_blob', evidence_storage_config = $2, evidence_storage_migration_status = $3`,
        [company.id, JSON.stringify({ container: "c" }), status]
      );
      await storeStorageCredential({ companyId: company.id, authType: "connection_string", secret: { connectionString: "cs-new" } });
      await upsertStorageMigration({
        companyId: company.id,
        fromBackend: "s3",
        fromConfig: { bucket: "old", region: "us-east-1" },
        fromAuthType: "access_key",
        fromSecret: { accessKeyId: "AKIAOLD", secretAccessKey: "old-secret-value" },
      });

      const res = await request(app)
        .post("/api/settings/evidence-storage/retry-migration")
        .set("Authorization", `Bearer ${admin.token}`)
        .send({});

      expect(res.status).toBe(200);
      expect(runStorageMigrationMock).toHaveBeenCalledWith(company.id);

      const mig = await query("SELECT ciphertext FROM storage_migrations WHERE company_id = $1", [company.id]);
      expect(mig.rows[0].ciphertext).toBeTruthy();
      expect(JSON.stringify(mig.rows[0])).not.toContain("old-secret-value");
    }
  });

  test("retry-migration with no migration returns 400", async () => {
    const company = await createCompany();
    const admin = await createUser(company.id, "ADMIN");

    const res = await request(app)
      .post("/api/settings/evidence-storage/retry-migration")
      .set("Authorization", `Bearer ${admin.token}`)
      .send({});

    expect(res.status).toBe(400);
  });
});
