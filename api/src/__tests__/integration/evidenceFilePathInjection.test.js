/**
 * F-02 — Caller-controlled filePath / cross-tenant storage reference injection.
 *
 * Independent validation, deliberately NOT reusing F-01's reassignment endpoint
 * (see evidenceTenantBoundary.test.js). This suite proves or disproves, on its
 * own, whether:
 *
 *   1. An authenticated tenant user can create an evidence row that points at
 *      another tenant's local storage path by supplying `filePath` directly.
 *   2. The download/view endpoints would serve that file if such a row existed.
 *   3. The storage layer's tenant check (`assertTenantStorageKey` in
 *      evidenceStorage.js) is itself sufficient authorization — independent of
 *      the route-level `filePath` rejection in evidence.js — so the primitive
 *      stays closed even if the input-validation gate is ever relaxed.
 *
 * Victim file is written directly to disk at a deterministic path
 * (UPLOAD_DIR/<companyB.id>/known-victim.pdf) rather than relying on the
 * random suffix a real upload would get, per the finding's request to remove
 * "exact path knowledge" as a variable.
 */
import { afterEach, beforeEach, describe, expect, test } from "vitest";
import request from "supertest";
import fs from "fs";
import os from "os";
import path from "path";
import app from "../../app.js";
import { query } from "../../db/index.js";
import { createCompany, createUser } from "../setup/helpers.js";
import { openObjectStream } from "../../utils/evidenceStorage.js";

const VICTIM_CONTENT = "TOP-SECRET-TENANT-B-CONTENT";
let uploadRoot;

beforeEach(() => {
  uploadRoot = fs.mkdtempSync(path.join(os.tmpdir(), "prism-f02-"));
  process.env.UPLOAD_DIR = uploadRoot;
});

afterEach(() => {
  fs.rmSync(uploadRoot, { recursive: true, force: true });
  delete process.env.UPLOAD_DIR;
});

async function tenantPair() {
  const companyA = await createCompany({
    name: "F02 Tenant A",
    domain: `f02-a-${Date.now()}-${Math.random()}.test`,
    adminEmail: `f02-admin-a-${Date.now()}-${Math.random()}@test.local`,
  });
  const companyB = await createCompany({
    name: "F02 Tenant B",
    domain: `f02-b-${Date.now()}-${Math.random()}.test`,
    adminEmail: `f02-admin-b-${Date.now()}-${Math.random()}@test.local`,
  });
  const adminA = await createUser(companyA.id, "ADMIN", {
    email: `f02-user-a-${Date.now()}-${Math.random()}@test.local`,
  });
  const adminB = await createUser(companyB.id, "ADMIN", {
    email: `f02-user-b-${Date.now()}-${Math.random()}@test.local`,
  });
  return { companyA, companyB, adminA, adminB };
}

/** Write a deterministic victim file straight to disk, bypassing the upload API entirely. */
function plantVictimFile(companyId, name = "known-victim.pdf") {
  const dir = path.join(uploadRoot, String(companyId));
  fs.mkdirSync(dir, { recursive: true });
  const absPath = path.join(dir, name);
  fs.writeFileSync(absPath, VICTIM_CONTENT);
  return absPath;
}

async function attackWithFilePath(token, filePath, extra = {}) {
  return request(app)
    .post("/api/evidence")
    .set("Authorization", `Bearer ${token}`)
    .send({
      evidenceType: "FILE",
      evidenceName: "borrowed.pdf",
      filePath,
      ...extra,
    });
}

async function tryDownload(token, evidenceId) {
  return request(app)
    .get(`/api/evidence/${evidenceId}/download`)
    .set("Authorization", `Bearer ${token}`);
}

describe("F-02 caller-controlled filePath / cross-tenant storage reference", () => {
  describe("1. known victim local path — bare fs path", () => {
    test("Tenant A cannot create+download an evidence row referencing Tenant B's exact known path", async () => {
      const { adminA, companyB, adminB } = await tenantPair();
      const victimAbsPath = plantVictimFile(companyB.id);

      const forged = await attackWithFilePath(adminA.token, victimAbsPath);

      // Creation itself must be rejected before it ever reaches the DB/storage layer.
      expect(forged.status).toBe(400);
      expect(forged.body).not.toHaveProperty("id");

      if (forged.body?.id) {
        const downloaded = await tryDownload(adminA.token, forged.body.id);
        expect(downloaded.status).not.toBe(200);
        expect(downloaded.text || "").not.toContain(VICTIM_CONTENT);
      }
    });
  });

  describe("2. victim path using another tenant's directory — 'local:' prefixed ref", () => {
    test("prefixed storage ref is rejected the same way as a bare path", async () => {
      const { adminA, companyB } = await tenantPair();
      const victimAbsPath = plantVictimFile(companyB.id, "known-victim-2.pdf");

      const forged = await attackWithFilePath(adminA.token, `local:${victimAbsPath}`);

      expect(forged.status).toBe(400);
      expect(forged.body).not.toHaveProperty("id");

      if (forged.body?.id) {
        const downloaded = await tryDownload(adminA.token, forged.body.id);
        expect(downloaded.status).not.toBe(200);
        expect(downloaded.text || "").not.toContain(VICTIM_CONTENT);
      }
    });

    test("snake_case file_path is rejected identically", async () => {
      const { adminA, companyB } = await tenantPair();
      const victimAbsPath = plantVictimFile(companyB.id, "known-victim-3.pdf");

      const forged = await request(app)
        .post("/api/evidence")
        .set("Authorization", `Bearer ${adminA.token}`)
        .send({
          evidenceType: "FILE",
          evidenceName: "borrowed3.pdf",
          file_path: `local:${victimAbsPath}`,
        });

      expect(forged.status).toBe(400);
      expect(forged.body).not.toHaveProperty("id");
    });
  });

  describe("3. attacker cannot escape UPLOAD_DIR entirely (existing traversal protection)", () => {
    test("a path-traversal filePath is rejected at creation", async () => {
      const { adminA } = await tenantPair();
      const forged = await attackWithFilePath(adminA.token, "../../../../etc/passwd");
      expect(forged.status).toBe(400);
    });

    test("storage layer itself refuses to open a ref that resolves outside UPLOAD_DIR", async () => {
      const { companyA } = await tenantPair();
      await expect(
        openObjectStream(companyA.id, `local:${path.join(uploadRoot, "..", "outside.txt")}`)
      ).rejects.toThrow(/Invalid/i);
    });
  });

  describe("4. storage-layer tenant check, isolated from the route-level input rejection", () => {
    // This does not go through POST /api/evidence at all — it calls the storage
    // choke point directly, the same function evidence.js/vault.js call for
    // every read. It proves the authorization boundary lives in the storage
    // layer itself (defense in depth), not only in evidence.js's field check.
    test("openObjectStream refuses a same-shape ref pointing into a different tenant's directory", async () => {
      const { companyA, companyB } = await tenantPair();
      plantVictimFile(companyB.id, "known-victim-4.pdf");
      const forgedRef = `local:${path.join(uploadRoot, String(companyB.id), "known-victim-4.pdf")}`;

      await expect(openObjectStream(companyA.id, forgedRef)).rejects.toThrow(/Invalid tenant storage/i);
    });

    test("openObjectStream succeeds for a same-tenant ref (sanity check on the assertion itself)", async () => {
      const { companyA } = await tenantPair();
      const ownPath = plantVictimFile(companyA.id, "own-file.pdf");
      const ownRef = `local:${ownPath}`;

      const stream = await openObjectStream(companyA.id, ownRef);
      expect(stream).not.toBeNull();
      const chunks = [];
      for await (const chunk of stream) chunks.push(chunk);
      expect(Buffer.concat(chunks).toString()).toBe(VICTIM_CONTENT);
    });
  });

  describe("5. same-tenant legitimate local reference — does this workflow even exist?", () => {
    test("a tenant cannot reference its own already-uploaded file by filePath either (no legitimate filePath-supply workflow)", async () => {
      const { adminA } = await tenantPair();
      const own = await request(app)
        .post("/api/evidence")
        .set("Authorization", `Bearer ${adminA.token}`)
        .attach("file", Buffer.from("first-upload"), { filename: "first.txt", contentType: "text/plain" })
        .field("evidenceType", "FILE")
        .field("evidenceName", "first.txt");
      expect(own.status).toBe(201);

      const ownRow = await query("SELECT file_path FROM evidence WHERE id = $1", [own.body.id]);
      const reuse = await attackWithFilePath(adminA.token, ownRow.rows[0].file_path);

      // Even referencing one's own real, existing file by filePath is rejected —
      // confirming there is no legitimate product workflow that supplies filePath
      // on creation. All file association happens via multipart upload.
      expect(reuse.status).toBe(400);
    });
  });

  describe("6. multipart upload still works normally (no regression from the filePath rejection)", () => {
    test("uploading a real file via multipart succeeds and is downloadable by its owner", async () => {
      const { adminA } = await tenantPair();
      const uploaded = await request(app)
        .post("/api/evidence")
        .set("Authorization", `Bearer ${adminA.token}`)
        .attach("file", Buffer.from("legit-content"), { filename: "legit.txt", contentType: "text/plain" })
        .field("evidenceType", "FILE")
        .field("evidenceName", "legit.txt");

      expect(uploaded.status).toBe(201);
      const downloaded = await tryDownload(adminA.token, uploaded.body.id);
      expect(downloaded.status).toBe(200);
      expect(downloaded.text).toBe("legit-content");
    });
  });

  describe("7. evidence rows without a file remain valid (LINK-type evidence)", () => {
    test("creating LINK evidence with no file and no filePath succeeds", async () => {
      const { adminA } = await tenantPair();
      const linked = await request(app)
        .post("/api/evidence")
        .set("Authorization", `Bearer ${adminA.token}`)
        .send({ evidenceType: "LINK", evidenceName: "External doc", evidenceLink: "https://example.com/policy" });

      expect(linked.status).toBe(201);
      expect(linked.body.hasFile).toBe(false);
    });
  });

  describe("8. filePath cannot be injected via mutation (PUT) either", () => {
    test("PUT /api/evidence/:id ignores a filePath field pointed at another tenant's file", async () => {
      const { adminA, companyB } = await tenantPair();
      const victimAbsPath = plantVictimFile(companyB.id, "known-victim-8.pdf");

      const uploaded = await request(app)
        .post("/api/evidence")
        .set("Authorization", `Bearer ${adminA.token}`)
        .attach("file", Buffer.from("mine"), { filename: "mine.txt", contentType: "text/plain" })
        .field("evidenceType", "FILE")
        .field("evidenceName", "mine.txt");
      const before = await query("SELECT file_path FROM evidence WHERE id = $1", [uploaded.body.id]);

      const mutated = await request(app)
        .put(`/api/evidence/${uploaded.body.id}`)
        .set("Authorization", `Bearer ${adminA.token}`)
        .send({ evidenceName: "renamed.txt", filePath: `local:${victimAbsPath}` });

      expect(mutated.status).toBe(200);
      const after = await query("SELECT file_path FROM evidence WHERE id = $1", [uploaded.body.id]);
      expect(after.rows[0].file_path).toBe(before.rows[0].file_path);

      const downloaded = await tryDownload(adminA.token, uploaded.body.id);
      expect(downloaded.status).toBe(200);
      expect(downloaded.text).toBe("mine");
      expect(downloaded.text).not.toContain(VICTIM_CONTENT);
    });
  });

  describe("9. attacker role coverage — who can even reach the vulnerable creation route", () => {
    test.each(["ADMIN", "LEAD", "CONTRIBUTOR"])(
      "%s can reach POST /api/evidence, but the filePath attack is still rejected",
      async (role) => {
        const { companyB } = await tenantPair();
        const company = await createCompany({
          domain: `f02-role-${role}-${Date.now()}-${Math.random()}.test`,
          adminEmail: `f02-role-${role}-${Date.now()}-${Math.random()}@test.local`,
        });
        const user = await createUser(company.id, role);
        const victimAbsPath = plantVictimFile(companyB.id, `known-victim-${role}.pdf`);

        const forged = await attackWithFilePath(user.token, victimAbsPath);
        expect(forged.status).toBe(400);
      }
    );

    test.each(["AUDITOR", "REVIEWER"])(
      "%s cannot reach POST /api/evidence at all (role gate, not the filePath gate, blocks them)",
      async (role) => {
        const { companyB } = await tenantPair();
        const company = await createCompany({
          domain: `f02-role-${role}-${Date.now()}-${Math.random()}.test`,
          adminEmail: `f02-role-${role}-${Date.now()}-${Math.random()}@test.local`,
        });
        const user = await createUser(company.id, role);
        const victimAbsPath = plantVictimFile(companyB.id, `known-victim-${role}.pdf`);

        const forged = await attackWithFilePath(user.token, victimAbsPath);
        expect(forged.status).toBe(403);
      }
    );
  });
});
