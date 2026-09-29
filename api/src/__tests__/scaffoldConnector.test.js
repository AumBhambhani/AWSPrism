import { describe, test, expect, afterEach } from "vitest";
import fs from "fs";
import os from "os";
import path from "path";
import { scaffoldConnector } from "../../scripts/scaffoldConnector.js";

const tmpDirs = [];

function makeTmpConnectorsDir() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "prism-scaffold-test-"));
  tmpDirs.push(dir);
  return dir;
}

afterEach(() => {
  while (tmpDirs.length > 0) {
    const dir = tmpDirs.pop();
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

describe("scaffoldConnector", () => {
  test("generates index.js, connector.json, and a placeholder test in a temp directory without throwing", () => {
    const connectorsDir = makeTmpConnectorsDir();

    const result = scaffoldConnector("okta", "Okta", { connectorsDir });

    expect(result.connectorDir).toBe(path.join(connectorsDir, "okta"));
    expect(fs.existsSync(path.join(connectorsDir, "okta", "index.js"))).toBe(true);
    expect(fs.existsSync(path.join(connectorsDir, "okta", "connector.json"))).toBe(true);
    expect(fs.existsSync(path.join(connectorsDir, "okta", "tests", "placeholder.js"))).toBe(true);
    expect(result.filesCreated).toHaveLength(3);
  });

  test("generated index.js exports key/tests/testConnection/runTests", () => {
    const connectorsDir = makeTmpConnectorsDir();
    scaffoldConnector("okta", "Okta", { connectorsDir });

    const indexSrc = fs.readFileSync(path.join(connectorsDir, "okta", "index.js"), "utf8");
    expect(indexSrc).toContain('export const key = "okta";');
    expect(indexSrc).toContain("export const tests = [];");
    expect(indexSrc).toContain("export async function testConnection(");
    expect(indexSrc).toContain("export async function runTests(");
    expect(indexSrc).toContain("TODO");
  });

  test("generated connector.json matches Task 1's manifest shape with an empty tests array", () => {
    const connectorsDir = makeTmpConnectorsDir();
    scaffoldConnector("okta", "Okta", { connectorsDir });

    const manifest = JSON.parse(fs.readFileSync(path.join(connectorsDir, "okta", "connector.json"), "utf8"));
    expect(manifest).toEqual({
      key: "okta",
      title: "Okta",
      category: "TODO",
      authTypes: ["TODO"],
      tests: [],
    });
  });

  test("generated placeholder test file exports a well-shaped placeholder test", () => {
    const connectorsDir = makeTmpConnectorsDir();
    scaffoldConnector("okta", "Okta", { connectorsDir });

    const placeholderSrc = fs.readFileSync(path.join(connectorsDir, "okta", "tests", "placeholder.js"), "utf8");
    expect(placeholderSrc).toContain("export const placeholderTests = [");
    expect(placeholderSrc).toContain('key: "okta.placeholder.check"');
  });

  test("returns a registry.js snippet naming the new connector's import and object entry", () => {
    const connectorsDir = makeTmpConnectorsDir();
    const result = scaffoldConnector("okta", "Okta", { connectorsDir });

    expect(result.registrySnippet).toContain('import * as okta from "./okta/index.js";');
    expect(result.registrySnippet).toContain("[okta.key]: okta");
  });

  test("returns an init.sql INSERT template for the integrations table", () => {
    const connectorsDir = makeTmpConnectorsDir();
    const result = scaffoldConnector("okta", "Okta", { connectorsDir });

    expect(result.initSqlSnippet).toContain("INSERT INTO integrations (key, name, category, auth_type, status) VALUES");
    expect(result.initSqlSnippet).toContain("('okta', 'Okta',");
    expect(result.initSqlSnippet).toContain("ON CONFLICT (key) DO NOTHING;");
  });

  test("rejects an invalid connector key", () => {
    const connectorsDir = makeTmpConnectorsDir();
    expect(() => scaffoldConnector("Okta!", "Okta", { connectorsDir })).toThrow(/Invalid connector key/);
  });

  test("rejects a missing title", () => {
    const connectorsDir = makeTmpConnectorsDir();
    expect(() => scaffoldConnector("okta", "", { connectorsDir })).toThrow(/title is required/);
  });

  test("refuses to overwrite an existing connector directory", () => {
    const connectorsDir = makeTmpConnectorsDir();
    scaffoldConnector("okta", "Okta", { connectorsDir });

    expect(() => scaffoldConnector("okta", "Okta Again", { connectorsDir })).toThrow(/already exists/);
  });

  test("never writes into the real api/src/connectors directory", () => {
    const connectorsDir = makeTmpConnectorsDir();
    scaffoldConnector("okta", "Okta", { connectorsDir });

    const realConnectorsDir = path.join(process.cwd(), "src", "connectors", "okta");
    expect(fs.existsSync(realConnectorsDir)).toBe(false);
  });
});
