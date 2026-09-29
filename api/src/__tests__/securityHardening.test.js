import { describe, test, expect, vi } from "vitest";
import { redactStoragePaths } from "../utils/redactStoragePaths.js";
import { isAllowedUpload } from "../utils/uploadPolicy.js";
import { scanBuffer } from "../utils/scanFile.js";
import { errorHandler } from "../middleware/errorHandler.js";

describe("redactStoragePaths (PRISM-004)", () => {
  test("replaces filesystem paths with a boolean, recursively", () => {
    const out = redactStoragePaths([
      { id: 1, storagePath: "local:/app/uploads/7/vault/1-2.pdf", fileName: "a.pdf" },
      { id: 2, storagePath: null, nested: { filePath: "/app/uploads/x.png" } },
    ]);
    expect(out[0]).toEqual({ id: 1, storagePath: true, fileName: "a.pdf" });
    expect(out[1].storagePath).toBeNull();
    expect(out[1].nested.filePath).toBe(true);
    expect(JSON.stringify(out)).not.toContain("/app/uploads");
  });

  test("leaves dates and primitives alone", () => {
    const d = new Date();
    expect(redactStoragePaths({ at: d, n: 3 }).at).toBe(d);
  });
});

describe("errorHandler (PRISM-004)", () => {
  const run = (err) => {
    const res = { headersSent: false, status: vi.fn().mockReturnThis(), json: vi.fn() };
    vi.spyOn(console, "error").mockImplementation(() => {});
    errorHandler(err, {}, res, vi.fn());
    return res;
  };

  test("hides internal detail of 5xx errors", () => {
    const res = run(new Error("ENOENT: no such file or directory, open '/app/uploads/1/a.pdf'"));
    expect(res.status).toHaveBeenCalledWith(500);
    expect(res.json).toHaveBeenCalledWith({ error: "Internal server error" });
  });

  test("passes authored 4xx messages through", () => {
    const res = run(Object.assign(new Error("File type not allowed"), { status: 400 }));
    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json).toHaveBeenCalledWith({ error: "File type not allowed" });
  });
});

describe("upload policy (PRISM-005)", () => {
  test("requires the extension to match the declared MIME type", () => {
    expect(isAllowedUpload({ mimetype: "application/pdf", originalname: "policy.PDF" })).toBe(true);
    expect(isAllowedUpload({ mimetype: "text/plain", originalname: "x.html" })).toBe(false);
    expect(isAllowedUpload({ mimetype: "application/pdf", originalname: "shell.php" })).toBe(false);
    expect(isAllowedUpload({ mimetype: "application/pdf", originalname: "noext" })).toBe(false);
    expect(isAllowedUpload({ mimetype: "text/html", originalname: "a.html" })).toBe(false);
  });

  test("legacy .xls is accepted only with OLE2 content", async () => {
    const ole = Buffer.from([0xD0, 0xCF, 0x11, 0xE0, 0, 0, 0, 0, 0, 0, 0, 0]);
    const zip = Buffer.from([0x50, 0x4B, 3, 4, 0, 0, 0, 0, 0, 0, 0, 0]);
    expect((await scanBuffer(ole, "application/vnd.ms-excel")).safe).toBe(true);
    expect((await scanBuffer(zip, "application/vnd.ms-excel")).safe).toBe(false);
  });

  test("text uploads containing NUL bytes are rejected", async () => {
    expect((await scanBuffer(Buffer.from("a,b\n1,2\n"), "text/csv")).safe).toBe(true);
    expect((await scanBuffer(Buffer.from([0x4D, 0x5A, 0, 0, 1]), "text/plain")).safe).toBe(false);
  });

  test("webp requires the WEBP marker", async () => {
    const good = Buffer.concat([Buffer.from("RIFF"), Buffer.alloc(4), Buffer.from("WEBP")]);
    const bad = Buffer.concat([Buffer.from("RIFF"), Buffer.alloc(4), Buffer.from("AVI ")]);
    expect((await scanBuffer(good, "image/webp")).safe).toBe(true);
    expect((await scanBuffer(bad, "image/webp")).safe).toBe(false);
  });
});
