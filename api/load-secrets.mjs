#!/usr/bin/env node
/**
 * Fetches all /prism/prod/* parameters from SSM Parameter Store and prints
 * shell export statements to stdout. Called by start.sh via eval so both
 * Node.js and Python inherit the secrets before either process starts.
 *
 * Usage (by start.sh):
 *   eval "$(node /app/load-secrets.mjs)"
 *
 * Requires: IAM role on the server with ssm:GetParametersByPath + kms:Decrypt
 */

import { SSMClient, GetParametersByPathCommand } from "@aws-sdk/client-ssm";

const SSM_PATH = process.env.SSM_PATH || "/prism/prod/";
const REGION   = process.env.AWS_REGION || "eu-north-1";

const client = new SSMClient({ region: REGION });
const params = {};

let nextToken;
do {
  const cmd = new GetParametersByPathCommand({
    Path: SSM_PATH,
    WithDecryption: true,
    Recursive: false,
    NextToken: nextToken,
  });
  const resp = await client.send(cmd);
  for (const p of resp.Parameters ?? []) {
    // Strip the path prefix → bare env var name
    const name = p.Name.slice(SSM_PATH.length);
    params[name] = p.Value;
  }
  nextToken = resp.NextToken;
} while (nextToken);

// Output shell export statements — single-quote values so special chars are safe
for (const [k, v] of Object.entries(params)) {
  // Escape any single quotes inside the value
  const safe = v.replace(/'/g, "'\\''");
  process.stdout.write(`export ${k}='${safe}'\n`);
}
