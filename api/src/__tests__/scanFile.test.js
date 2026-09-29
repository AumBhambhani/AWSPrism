import { describe, test, expect } from "vitest";
import { scanBuffer } from "../utils/scanFile.js";

const PDF = Buffer.concat([Buffer.from([0x25, 0x50, 0x44, 0x46]), Buffer.alloc(20)]); // %PDF...
const PNG = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47]), Buffer.alloc(20)]);
const ZIP = Buffer.concat([Buffer.from([0x50, 0x4b, 0x03, 0x04]), Buffer.alloc(20)]); // PK..

describe("scanBuffer magic-byte validation", () => {
  test("accepts a real PDF declared as application/pdf", async () => {
    expect(await scanBuffer(PDF, "application/pdf")).toEqual({ safe: true });
  });

  test("accepts text/plain regardless of content", async () => {
    expect(await scanBuffer(Buffer.from("anything"), "text/plain")).toEqual({ safe: true });
  });

  test("accepts an OOXML docx (PK magic) declared as a Word document", async () => {
    expect(await scanBuffer(ZIP, "application/vnd.openxmlformats-officedocument.wordprocessingml.document")).toEqual({ safe: true });
  });

  test("rejects a PNG masquerading as a PDF", async () => {
    const res = await scanBuffer(PNG, "application/pdf");
    expect(res.safe).toBe(false);
    expect(res.reason).toMatch(/does not match/);
  });

  test("rejects an unknown declared MIME type", async () => {
    const res = await scanBuffer(PDF, "application/x-msdownload");
    expect(res.safe).toBe(false);
  });

  test("rejects a non-buffer argument", async () => {
    const res = await scanBuffer("not a buffer", "application/pdf");
    expect(res.safe).toBe(false);
  });
});
