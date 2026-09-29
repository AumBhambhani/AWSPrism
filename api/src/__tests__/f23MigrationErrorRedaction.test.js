import { describe, expect, test } from "vitest";
import { publicMigrationError } from "../utils/storageMigration.js";

// F-23 — storage-migration failures stored err.message (object keys, local paths,
// endpoints) and GET /api/settings/evidence-storage returned it to the ADMIN.
describe("F-23 storage migration error text", () => {
  test("paths, keys and endpoints never reach the stored message", () => {
    const err = Object.assign(new Error("ENOENT: no such file or directory, open '/app/uploads/42/vault/secret-board-minutes.pdf'"), { code: "ENOENT" });
    const msg = publicMigrationError(err);
    expect(msg).not.toContain("/app/uploads");
    expect(msg).not.toContain("secret-board-minutes");
    expect(msg).toContain("(ENOENT)");
  });

  test("an SDK error keeps only its class name", () => {
    const err = Object.assign(new Error("Access Denied for bucket acme-evidence key 42/vault/x.pdf at https://s3.eu-west-1.amazonaws.com"), { name: "AccessDenied" });
    const msg = publicMigrationError(err);
    expect(msg).toContain("(AccessDenied)");
    expect(msg).not.toMatch(/acme-evidence|amazonaws|x\.pdf/);
  });

  test("a code that could itself carry data is dropped", () => {
    expect(publicMigrationError({ code: "/etc/passwd leaked" })).not.toContain("passwd");
    expect(publicMigrationError("plain string")).toMatch(/^Could not copy the evidence files\./);
  });
});
