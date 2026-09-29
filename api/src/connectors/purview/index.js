import { resolvePurviewCredentials } from "./credentials.js";
import { datamapTests } from "./tests/datamap.js";
import { auditTests } from "./tests/audit.js";

export const key = "purview";

export const tests = [...datamapTests, ...auditTests];

function buildClients(purviewCreds) {
  return {
    dataMap: {
      get: (path) => authedFetch(purviewCreds.dataMapBaseUrl + path, purviewCreds.getDataMapToken, "GET"),
      post: (path, body) => authedFetch(purviewCreds.dataMapBaseUrl + path, purviewCreds.getDataMapToken, "POST", body),
    },
    audit: {
      get: (path) => authedFetch(purviewCreds.auditBaseUrl + path, purviewCreds.getAuditToken, "GET"),
    },
  };
}

async function authedFetch(url, getToken, method, body) {
  const token = await getToken();
  const res = await fetch(url, {
    method,
    headers: {
      Authorization: `Bearer ${token}`,
      ...(body !== undefined ? { "Content-Type": "application/json" } : {}),
    },
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Purview request to ${url} failed: ${res.status} ${text}`);
  }
  return res.json();
}

// Purview's two error shapes:
// - Atlas/Scanning (Data Map) errors are JSON bodies of the form
//   {"error":{"code":...,"message":...}} embedded in authedFetch's thrown
//   message text (see the "failed: <status> <text>" format above).
// - Office 365 Management Activity (Audit) errors surface as a raw text body
//   naming a Microsoft.Office.* exception namespace, most notably the
//   "unified audit logging is disabled" signature already substring-matched
//   by tests/audit.js's checkUnifiedLoggingEnabled.
function describePurviewError(err) {
  const message = err?.message || String(err);

  try {
    const jsonStart = message.indexOf("{");
    if (jsonStart !== -1) {
      const parsed = JSON.parse(message.slice(jsonStart));
      if (parsed?.error?.message) return parsed.error.message;
    }
  } catch {}

  if (message.includes("Microsoft.Office.Compliance.Audit.DataServiceException")) {
    return (
      `${message} This indicates unified audit logging is disabled for the tenant — see ` +
      `Microsoft Purview > Audit > Start recording user and admin activity (can take up to 60 minutes to take effect).`
    );
  }

  return (
    `${message} If this looks like an authorization failure, verify the Purview RBAC roles ` +
    `(Data Reader + Data Source Administrator, assigned in the Purview governance portal, not Azure IAM) ` +
    `and the Office 365 Management API application permissions with admin consent granted.`
  );
}

export async function testConnection({ authType, config, secret }) {
  const purviewCreds = await resolvePurviewCredentials({ authType, config, secret });
  const clients = buildClients(purviewCreds);

  const [dataMapResult, auditResult] = await Promise.allSettled([
    clients.dataMap.get("/datasources"),
    clients.audit.get("/subscriptions/list"),
  ]);

  if (dataMapResult.status === "rejected" && auditResult.status === "rejected") {
    throw new Error(
      `Both Purview grants failed. Data Map: ${describePurviewError(dataMapResult.reason)} ` +
        `Audit: ${describePurviewError(auditResult.reason)}`
    );
  }
  if (dataMapResult.status === "rejected") {
    throw new Error(
      `Purview Data Map access failed (Audit access is OK) — check the Data Reader / Data Source ` +
        `Administrator role assignment in the Purview governance portal's collection Role assignments ` +
        `tab (NOT Azure IAM): ${describePurviewError(dataMapResult.reason)}`
    );
  }
  if (auditResult.status === "rejected") {
    throw new Error(
      `Purview Audit access failed (Data Map access is OK) — check the Office 365 Management APIs ` +
        `application permissions (ActivityFeed.Read, ActivityFeed.ReadDlp, ServiceHealth.Read) and that ` +
        `admin consent was granted: ${describePurviewError(auditResult.reason)}`
    );
  }
  return { ok: true, externalAccountId: config.purviewAccountName };
}

export async function runTests({ authType, config, secret }) {
  const purviewCreds = await resolvePurviewCredentials({ authType, config, secret });
  const clients = buildClients(purviewCreds);
  const runResults = [];
  try {
    for (const test of tests) {
      try {
        const results = await test.run(clients);
        for (const result of results) {
          runResults.push({ testKey: test.key, title: test.title, failTitle: test.failTitle, severity: test.severityDefault, ...result });
        }
      } catch (err) {
        runResults.push({ testKey: test.key, title: test.title, failTitle: test.failTitle, severity: test.severityDefault, resourceId: "error", status: "error", message: describePurviewError(err), evidencePayload: {} });
      }
    }
  } catch (err) {
    throw new Error(describePurviewError(err));
  }
  return runResults;
}
