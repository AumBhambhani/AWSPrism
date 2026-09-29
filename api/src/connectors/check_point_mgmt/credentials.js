// Check Point Security Management authentication.
//
// The connector logs into the Management API (`web_api`) with an administrator
// *API key* (SmartConsole > Manage & Settings > Permissions > Administrators >
// generate API key) and the read-only flag set, so it can never write. Two
// deployment targets are supported:
//
//   - self_managed  — a customer-hosted Security Management server or Multi-Domain
//     server reachable over https at `config.mgmtUrl`.
//   - smart1_cloud   — Check Point's hosted management; `config.mgmtUrl` is the
//     tenant service URL shown in the Infinity Portal (…/<id>/web_api).
//
// `config.mgmtUrl` is always captured explicitly per connection and never
// defaulted to a global hostname (same lesson as the CrowdStrike regional host).
//
// This is a "beta" connector — the show-* command response shapes in ./tests/*
// are built from the public Management API reference but not confirmed against a
// live server. Unconfirmed fields must surface as status "error", never a guess.

export function normaliseMgmtOrigin(raw) {
  if (!raw || typeof raw !== "string" || !raw.trim()) {
    throw new Error("Check Point Management connection is missing config.mgmtUrl");
  }
  let value = raw.trim();
  if (!/^https?:\/\//i.test(value)) value = `https://${value}`;
  let url;
  try {
    url = new URL(value);
  } catch {
    throw new Error(`Check Point Management connection has an invalid config.mgmtUrl: "${raw}"`);
  }
  if (url.protocol !== "https:") {
    throw new Error(`Check Point Management connection config.mgmtUrl must be https, got "${raw}"`);
  }
  // Keep any path prefix (Smart-1 Cloud service URLs carry a /<tenant-id> path),
  // but drop a trailing /web_api or slash — the client appends /web_api itself.
  const path = url.pathname.replace(/\/+$/, "").replace(/\/web_api$/i, "");
  return `${url.origin}${path}`;
}

const DEPLOYMENTS = new Set(["self_managed", "smart1_cloud"]);

export function normaliseDeployment(raw) {
  if (raw == null || raw === "") return "self_managed";
  const value = String(raw).trim().toLowerCase();
  if (!DEPLOYMENTS.has(value)) {
    throw new Error(`Check Point Management connection has an unknown config.deployment: "${raw}" (expected self_managed or smart1_cloud)`);
  }
  return value;
}

// Management API version segment. Empty string = the server's latest. Pinning is
// preferred but a mis-typed value fails harder than "latest" drifting, so accept
// bare "1.1" / "v1.1" and normalise, and treat unset as latest.
export function normaliseApiVersion(raw) {
  if (raw == null || raw === "") return "";
  const m = String(raw).trim().match(/^v?(\d+(?:\.\d+)?)$/i);
  if (!m) throw new Error(`Check Point Management connection has an invalid config.apiVersion: "${raw}" (use e.g. "1.1")`);
  return `v${m[1]}`;
}

export async function resolveCheckPointMgmtCredentials({ authType, config, secret }) {
  if (authType !== "api_key") {
    throw new Error(`Unsupported Check Point Management auth type: ${authType}`);
  }
  const apiKey = typeof secret?.apiKey === "string" ? secret.apiKey.trim() : "";
  if (!apiKey) throw new Error("Check Point Management connection is missing secret.apiKey");

  return {
    mgmtOrigin: normaliseMgmtOrigin(config?.mgmtUrl),
    deployment: normaliseDeployment(config?.deployment),
    domain: typeof config?.domain === "string" && config.domain.trim() ? config.domain.trim() : null,
    apiVersion: normaliseApiVersion(config?.apiVersion),
    apiKey,
  };
}
