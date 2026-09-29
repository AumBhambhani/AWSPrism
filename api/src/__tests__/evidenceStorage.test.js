import { describe, test, expect, beforeEach, afterEach, vi } from "vitest";
import fs from "fs";
import os from "os";
import path from "path";

const queryMock = vi.fn();

vi.mock("../db/index.js", () => ({
  query: (...args) => queryMock(...args),
  mapRow: (result) => (result && result.rows && result.rows[0] ? toCamel(result.rows[0]) : null),
}));

vi.mock("../db/storageCredentials.js", () => ({
  getStorageCredential: vi.fn().mockResolvedValue(null),
}));

function toCamel(row) {
  const out = {};
  for (const [k, v] of Object.entries(row)) {
    out[k.replace(/_([a-z])/g, (_, c) => c.toUpperCase())] = v;
  }
  return out;
}

const {
  parseRef, makeRef, refBackend,
  saveObject, openObjectStream, readObjectBuffer, deleteObject,
  withLocalCopy, testBackend, invalidateStorage,
} = await import("../utils/evidenceStorage.js");

let tmpRoot;

beforeEach(() => {
  queryMock.mockReset();
  tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), "prism-storage-"));
  process.env.UPLOAD_DIR = tmpRoot;
  // Every company resolves to the local backend.
  queryMock.mockResolvedValue({ rows: [{ evidence_storage_backend: "local", evidence_storage_config: null }] });
  invalidateStorage(7);
});

afterEach(() => {
  fs.rmSync(tmpRoot, { recursive: true, force: true });
  delete process.env.UPLOAD_DIR;
});

describe("storage refs", () => {
  test("parseRef recognises each backend prefix", () => {
    expect(parseRef("s3:12/a.pdf")).toEqual({ backend: "s3", key: "12/a.pdf" });
    expect(parseRef("azure_blob:12/a.pdf")).toEqual({ backend: "azure_blob", key: "12/a.pdf" });
    expect(parseRef("local:uploads/12/a.pdf")).toEqual({ backend: "local", key: "uploads/12/a.pdf" });
  });

  test("a bare path (legacy row) is treated as a local ref", () => {
    expect(parseRef("uploads/12/a.pdf")).toEqual({ backend: "local", key: "uploads/12/a.pdf" });
    expect(refBackend("uploads/12/a.pdf")).toBe("local");
  });

  test("parseRef returns null for empty input", () => {
    expect(parseRef("")).toBeNull();
    expect(parseRef(null)).toBeNull();
  });

  test("makeRef round-trips", () => {
    expect(parseRef(makeRef("s3", "12/x.pdf"))).toEqual({ backend: "s3", key: "12/x.pdf" });
  });
});

describe("local backend", () => {
  test("saveObject writes under UPLOAD_DIR/<companyId> and returns a local ref", async () => {
    const ref = await saveObject(7, { buffer: Buffer.from("hello"), originalName: "a.txt", scope: "evidence" });
    const { backend, key } = parseRef(ref);
    expect(backend).toBe("local");
    expect(key).toContain(path.join(tmpRoot, "7"));
    expect(fs.readFileSync(key, "utf8")).toBe("hello");
  });

  test("vault scope lands in the vault subdirectory", async () => {
    const ref = await saveObject(7, { buffer: Buffer.from("x"), originalName: "a.txt", scope: "vault" });
    expect(parseRef(ref).key).toContain(path.join(tmpRoot, "7", "vault"));
  });

  test("openObjectStream / readObjectBuffer round-trip", async () => {
    const ref = await saveObject(7, { buffer: Buffer.from("payload"), originalName: "a.txt", scope: "evidence" });
    const buf = await readObjectBuffer(7, ref);
    expect(buf.toString()).toBe("payload");
  });

  test("openObjectStream returns null for a missing object", async () => {
    expect(await openObjectStream(7, "local:" + path.join(tmpRoot, "7", "nope.txt"))).toBeNull();
  });

  test("path traversal outside UPLOAD_DIR is rejected", async () => {
    await expect(openObjectStream(7, "local:/etc/passwd")).rejects.toThrow(/Invalid file path/);
  });

  test("deleteObject removes the file", async () => {
    const ref = await saveObject(7, { buffer: Buffer.from("x"), originalName: "a.txt", scope: "evidence" });
    await deleteObject(7, ref);
    expect(fs.existsSync(parseRef(ref).key)).toBe(false);
  });

  test("withLocalCopy hands a real path for a local ref", async () => {
    const ref = await saveObject(7, { buffer: Buffer.from("abc"), originalName: "a.txt", scope: "evidence" });
    const seen = await withLocalCopy(7, ref, async (p) => fs.readFileSync(p, "utf8"));
    expect(seen).toBe("abc");
  });

  test("testBackend succeeds for local (writes + reads back + cleans up)", async () => {
    await expect(testBackend({ backend: "local", config: {}, authType: null, secret: null })).resolves.toBeUndefined();
  });
});

describe("testBackend connectivity failures", () => {
  // The provider's raw text can echo a remote/internal service, so only a safe summary
  // reaches the client (closure review 6B).
  test("wraps an S3 client error in a friendly message without the raw text", async () => {
    vi.doMock("@aws-sdk/client-s3", () => {
      class S3Client { async send() { throw new Error("The specified bucket does not exist"); } }
      return { S3Client, PutObjectCommand: class {}, GetObjectCommand: class {}, DeleteObjectCommand: class {} };
    });
    const mod = await import("../utils/evidenceStorage.js");
    await expect(mod.testBackend({
      backend: "s3",
      config: { bucket: "nope", region: "us-east-1" },
      authType: "access_key",
      secret: { accessKeyId: "AKIA", secretAccessKey: "x" },
    })).rejects.toThrow(/^Could not write to S3\. Check the bucket/);
    vi.doUnmock("@aws-sdk/client-s3");
  });
});
