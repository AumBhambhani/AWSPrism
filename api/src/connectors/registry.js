import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import * as aws from "./aws/index.js";
import * as azure from "./azure/index.js";
import * as github from "./github/index.js";
import * as purview from "./purview/index.js";
import * as zoho from "./zoho/index.js";
import * as entraId from "./entra_id/index.js";
import * as microsoft365 from "./microsoft_365/index.js";
import * as microsoftTeams from "./microsoft_teams/index.js";
import * as microsoftDefender from "./microsoft_defender/index.js";
import * as googleWorkspace from "./google_workspace/index.js";
import * as gcp from "./gcp/index.js";
import * as onetrust from "./onetrust/index.js";
import * as servicenow from "./servicenow/index.js";
import * as privy from "./privy/index.js";
import * as crowdstrike from "./crowdstrike/index.js";
import * as salesforce from "./salesforce/index.js";
import * as acronis from "./acronis/index.js";
import * as commvault from "./commvault/index.js";
import * as carbonite from "./carbonite/index.js";
import * as carboniteServer from "./carbonite-server/index.js";
import * as sophos from "./sophos/index.js";
import * as checkPointMgmt from "./check_point_mgmt/index.js";
import * as checkPoint from "./check_point/index.js";
import * as checkPointCloudguard from "./check_point_cloudguard/index.js";
import * as akamai from "./akamai/index.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const connectors = {
  [aws.key]: aws,
  [azure.key]: azure,
  [github.key]: github,
  [purview.key]: purview,
  [zoho.key]: zoho,
  [entraId.key]: entraId,
  [microsoft365.key]: microsoft365,
  [microsoftTeams.key]: microsoftTeams,
  [microsoftDefender.key]: microsoftDefender,
  [googleWorkspace.key]: googleWorkspace,
  [gcp.key]: gcp,
  [onetrust.key]: onetrust,
  [servicenow.key]: servicenow,
  [privy.key]: privy,
  [crowdstrike.key]: crowdstrike,
  [salesforce.key]: salesforce,
  [acronis.key]: acronis,
  [commvault.key]: commvault,
  [carbonite.key]: carbonite,
  [carboniteServer.key]: carboniteServer,
  [sophos.key]: sophos,
  [checkPointMgmt.key]: checkPointMgmt,
  [checkPoint.key]: checkPoint,
  [checkPointCloudguard.key]: checkPointCloudguard,
  [akamai.key]: akamai,
};

function readManifest(connectorKey) {
  const manifestPath = path.join(__dirname, connectorKey, "connector.json");
  const raw = fs.readFileSync(manifestPath, "utf8");
  return JSON.parse(raw);
}

// Fails fast (throws synchronously at module load) if a connector's JS
// `tests` array and its `connector.json` manifest's `tests` array have
// drifted apart — every test key defined in the JS checks must have a
// matching manifest entry, and vice versa. This is the only thing keeping
// the manifest (consumed by later scaffold/DB-sync tooling) honest, since
// nothing else re-derives it from the JS check objects automatically.
function validateManifests() {
  for (const connectorKey of Object.keys(connectors)) {
    const manifest = readManifest(connectorKey);
    const jsKeys = new Set(connectors[connectorKey].tests.map((t) => t.key));
    const manifestKeys = new Set(manifest.tests.map((t) => t.testKey));

    const missingFromManifest = [...jsKeys].filter((k) => !manifestKeys.has(k));
    const extraInManifest = [...manifestKeys].filter((k) => !jsKeys.has(k));

    if (missingFromManifest.length > 0 || extraInManifest.length > 0) {
      const problems = [];
      if (missingFromManifest.length > 0) {
        problems.push(`missing from connector.json: ${missingFromManifest.join(", ")}`);
      }
      if (extraInManifest.length > 0) {
        problems.push(`present in connector.json but not in the JS tests array: ${extraInManifest.join(", ")}`);
      }
      throw new Error(
        `Connector manifest drift for "${connectorKey}": ${problems.join("; ")}. ` +
          `Keep api/src/connectors/${connectorKey}/connector.json's tests[].testKey in sync with the ` +
          `test "key" values exported from api/src/connectors/${connectorKey}/index.js.`
      );
    }

    // Check that each JS test's severityDefault matches its manifest counterpart.
    const manifestSeverityByKey = new Map(manifest.tests.map((t) => [t.testKey, t.severityDefault]));
    const severityMismatches = [];
    for (const jsTest of connectors[connectorKey].tests) {
      const manifestSeverity = manifestSeverityByKey.get(jsTest.key);
      if (manifestSeverity !== undefined && jsTest.severityDefault !== manifestSeverity) {
        severityMismatches.push(
          `  ${jsTest.key}: JS="${jsTest.severityDefault}" vs connector.json="${manifestSeverity}"`
        );
      }
    }
    if (severityMismatches.length > 0) {
      throw new Error(
        `Connector severityDefault drift for "${connectorKey}":\n${severityMismatches.join("\n")}\n` +
          `Keep api/src/connectors/${connectorKey}/connector.json's tests[].severityDefault in sync with the ` +
          `"severityDefault" values exported from api/src/connectors/${connectorKey}/index.js.`
      );
    }
  }
}

validateManifests();

export function getConnector(integrationKey) {
  const connector = connectors[integrationKey];
  if (!connector) throw new Error(`Unknown integration: ${integrationKey}`);
  return connector;
}

export function listConnectorTests(integrationKey) {
  return getConnector(integrationKey).tests;
}

export function listConnectorKeys() {
  return Object.keys(connectors);
}
