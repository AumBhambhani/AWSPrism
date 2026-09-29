import { describe, test, expect, afterEach } from "vitest";
import fs from "fs";
import os from "os";
import path from "path";
import { fileURLToPath } from "url";
import { extractFileContent } from "../utils/fileExtract.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const tmpFiles = [];
function writeTmp(name, content) {
  const p = path.join(os.tmpdir(), `fx-${Date.now()}-${name}`);
  fs.writeFileSync(p, content);
  tmpFiles.push(p);
  return p;
}

afterEach(() => {
  while (tmpFiles.length) fs.rmSync(tmpFiles.pop(), { force: true });
});

describe("extractFileContent", () => {
  test("reads plain-text files as text", async () => {
    const p = writeTmp("doc.txt", "hello world");
    const result = await extractFileContent(p, "txt");
    expect(result).toEqual({ type: "text", content: "hello world" });
  });

  test("truncates very long text to the content cap", async () => {
    const p = writeTmp("big.txt", "x".repeat(50000));
    const result = await extractFileContent(p, "txt");
    expect(result.type).toBe("text");
    expect(result.content.length).toBe(20000);
  });

  test("returns an explanatory text stub for unsupported extensions", async () => {
    const p = writeTmp("thing.zip", "binary");
    const result = await extractFileContent(p, "zip");
    expect(result.type).toBe("text");
    expect(result.content).toMatch(/Unsupported file type: ZIP/);
  });

  test("recovers content from a Strict Open XML Spreadsheet", async () => {
    const fixture = path.join(__dirname, "fixtures", "strict-ooxml.xlsx");
    const result = await extractFileContent(fixture, "xlsx");
    expect(result.type).toBe("text");
    expect(result.content).toMatch(/Module ID/);
    expect(result.content).toMatch(/P-1/);
  });

  test("degrades gracefully on an unrecoverable Strict workbook", async () => {
    const fixture = path.join(__dirname, "fixtures", "strict-unrecoverable.xlsx");
    const result = await extractFileContent(fixture, "xlsx");
    expect(result.type).toBe("text");
    expect(result.content).toMatch(/Strict Open XML Spreadsheet/i);
  });

  test("degrades gracefully on an unreadable .xlsx", async () => {
    const p = writeTmp("fake.xlsx", "col1,col2\n1,2\n");
    const result = await extractFileContent(p, "xlsx");
    expect(result.type).toBe("text");
    expect(result.content).toMatch(/could not be read/i);
  });
});
