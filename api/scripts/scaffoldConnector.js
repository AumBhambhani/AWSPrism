#!/usr/bin/env node
// Dev-only scaffold for a new evidence-collection connector. NOT part of the
// runtime request path — no route wiring, no auth. Generates the skeleton a
// connector author would otherwise hand-write, mirroring the structure of an
// existing connector such as api/src/connectors/azure/index.js.
//
// Usage:
//   node scripts/scaffoldConnector.js <key> "<Title>"
// Example:
//   node scripts/scaffoldConnector.js okta "Okta"

import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DEFAULT_CONNECTORS_DIR = path.join(__dirname, "..", "src", "connectors");

const KEY_PATTERN = /^[a-z][a-z0-9_]*$/;

function sqlEscape(value) {
  return String(value).replace(/'/g, "''");
}

function renderIndexJs(key) {
  return `// Scaffolded connector: ${key}
// TODO: replace the placeholders below with real credential resolution and
// SDK client construction for this integration. See an existing connector
// for the pattern to follow, e.g. api/src/connectors/azure/index.js or
// api/src/connectors/github/index.js.

export const key = "${key}";

// TODO: once real checks exist (see api/src/connectors/azure/tests/*.js for
// examples), import their exported arrays from ./tests/*.js and spread them
// in here, e.g.:
//   import { placeholderTests } from "./tests/placeholder.js";
//   export const tests = [...placeholderTests];
// Keep api/src/connectors/${key}/connector.json's "tests" array in sync with
// whatever test keys end up in this array — registry.js's validateManifests()
// throws at load time on any drift between the two.
export const tests = [];

// TODO: resolve this connector's credentials from { authType, config, secret }
// (secret is the decrypted stored credential; config is the connection's
// non-secret JSON config) and return whatever the SDK needs to authenticate.
async function resolveCredentials({ authType, config, secret }) {
  throw new Error("TODO: implement resolveCredentials for the '${key}' connector");
}

// TODO: build and return whatever SDK client object(s) the checks in \`tests\`
// need to run (see buildClients in azure/index.js or github/index.js).
async function buildClients(credential, config) {
  throw new Error("TODO: implement buildClients for the '${key}' connector");
}

export async function testConnection({ authType, config, secret }) {
  // TODO: make one cheap, read-only call to confirm the credentials work, and
  // return { ok: true, externalAccountId }. See azure/index.js's
  // testConnection or github/index.js's testConnection for the shape.
  const credential = await resolveCredentials({ authType, config, secret });
  throw new Error("TODO: implement testConnection for the '${key}' connector");
}

export async function runTests({ authType, config, secret }) {
  const credential = await resolveCredentials({ authType, config, secret });
  const clients = await buildClients(credential, config);
  const runResults = [];
  for (const test of tests) {
    const results = await test.run(clients);
    for (const result of results) {
      runResults.push({ testKey: test.key, title: test.title, severity: test.severityDefault, ...result });
    }
  }
  return runResults;
}
`;
}

function renderConnectorJson(key, title) {
  const manifest = {
    key,
    title,
    category: "TODO",
    authTypes: ["TODO"],
    tests: [],
  };
  return JSON.stringify(manifest, null, 2) + "\n";
}

function renderPlaceholderTest(key) {
  return `// Placeholder test module for the "${key}" connector.
// TODO: replace this with real checks (see api/src/connectors/azure/tests/logging.js
// or api/src/connectors/azure/tests/network.js for real examples). Once you have
// real checks, wire their exported arrays into this connector's \`tests\` export
// in ../index.js and add matching entries to ../connector.json's "tests" array
// (testKey/title/severityDefault/isoReferences per entry).

async function checkPlaceholder(clients) {
  // TODO: implement the real check against \`clients\`, returning one result
  // per resource evaluated:
  //   { resourceId, status: 'pass'|'fail'|'warn'|'not_applicable', message, evidencePayload }
  throw new Error("TODO: implement ${key}.placeholder.check");
}

export const placeholderTests = [
  {
    key: "${key}.placeholder.check",
    title: "TODO: describe what this check verifies",
    severityDefault: "medium",
    isoReferences: ["TODO"],
    run: (clients) => checkPlaceholder(clients),
  },
];
`;
}

function renderRegistrySnippet(key) {
  return (
    `Add to api/src/connectors/registry.js:\n\n` +
    `  import * as ${key} from "./${key}/index.js";\n\n` +
    `...and add \`[${key}.key]: ${key}\` to the \`connectors\` object, e.g.:\n\n` +
    `  const connectors = { [aws.key]: aws, [azure.key]: azure, [github.key]: github, [purview.key]: purview, [${key}.key]: ${key} };`
  );
}

function renderInitSqlSnippet(key, title) {
  return (
    `Add to init.sql (in the "Automated Evidence Collection: catalog seed data" section):\n\n` +
    `INSERT INTO integrations (key, name, category, auth_type, status) VALUES\n` +
    `  ('${sqlEscape(key)}', '${sqlEscape(title)}', 'TODO_CATEGORY', 'TODO_AUTH_TYPE', 'beta')\n` +
    `ON CONFLICT (key) DO NOTHING;\n\n` +
    `-- auth_type must be one of: iam_role, access_key, oauth2, api_key (see init.sql's integrations table CHECK constraint)`
  );
}

// Generates the scaffold on disk and returns the paste-ready snippets for
// registry.js and init.sql. `connectorsDir` defaults to the real
// api/src/connectors/ tree but can be overridden (tests pass a temp dir).
export function scaffoldConnector(key, title, { connectorsDir = DEFAULT_CONNECTORS_DIR } = {}) {
  if (!key || !KEY_PATTERN.test(key)) {
    throw new Error(
      `Invalid connector key "${key}" — use lowercase letters, digits, and underscores, starting with a letter (e.g. "okta").`
    );
  }
  if (!title || !String(title).trim()) {
    throw new Error("A connector title is required (e.g. \"Okta\").");
  }

  const connectorDir = path.join(connectorsDir, key);
  if (fs.existsSync(connectorDir)) {
    throw new Error(`Connector directory already exists: ${connectorDir}`);
  }

  const testsDir = path.join(connectorDir, "tests");
  fs.mkdirSync(testsDir, { recursive: true });

  const indexPath = path.join(connectorDir, "index.js");
  const manifestPath = path.join(connectorDir, "connector.json");
  const placeholderTestPath = path.join(testsDir, "placeholder.js");

  fs.writeFileSync(indexPath, renderIndexJs(key), "utf8");
  fs.writeFileSync(manifestPath, renderConnectorJson(key, title), "utf8");
  fs.writeFileSync(placeholderTestPath, renderPlaceholderTest(key), "utf8");

  return {
    connectorDir,
    filesCreated: [indexPath, manifestPath, placeholderTestPath],
    registrySnippet: renderRegistrySnippet(key),
    initSqlSnippet: renderInitSqlSnippet(key, title),
  };
}

function printUsageAndExit(exitCode) {
  console.error('Usage: node scripts/scaffoldConnector.js <key> "<Title>"');
  console.error('Example: node scripts/scaffoldConnector.js okta "Okta"');
  process.exit(exitCode);
}

function main() {
  const [, , key, title] = process.argv;
  if (!key || !title) {
    printUsageAndExit(1);
    return;
  }

  let result;
  try {
    result = scaffoldConnector(key, title);
  } catch (err) {
    console.error(err.message);
    process.exit(1);
    return;
  }

  console.log(`Created connector scaffold at ${result.connectorDir}`);
  console.log("");
  console.log("Files created:");
  for (const file of result.filesCreated) {
    console.log(`  ${file}`);
  }
  console.log("");
  console.log(result.registrySnippet);
  console.log("");
  console.log(result.initSqlSnippet);
  console.log("");
}

// Only run when this file is executed directly (e.g. `node scripts/scaffoldConnector.js ...`),
// not when imported by the test file.
if (import.meta.url === `file://${process.argv[1]}`) {
  main();
}
