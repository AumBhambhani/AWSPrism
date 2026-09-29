import { resolveZohoCredentials } from "./credentials.js";
import { directoryTests } from "./tests/directory.js";
import { crmTests } from "./tests/crm.js";
import { booksTests } from "./tests/books.js";
import { peopleTests } from "./tests/people.js";
import { workdriveTests } from "./tests/workdrive.js";
import { deskTests } from "./tests/desk.js";
import { mailTests } from "./tests/mail.js";
import { vaultTests } from "./tests/vault.js";
import { projectsTests } from "./tests/projects.js";
import { analyticsTests } from "./tests/analytics.js";
import { creatorTests } from "./tests/creator.js";
import { signTests } from "./tests/sign.js";
import { expenseTests } from "./tests/expense.js";
import { recruitTests } from "./tests/recruit.js";

export const key = "zoho";

export const tests = [
  ...directoryTests,
  ...crmTests,
  ...booksTests,
  ...peopleTests,
  ...workdriveTests,
  ...deskTests,
  ...mailTests,
  ...vaultTests,
  ...projectsTests,
  ...analyticsTests,
  ...creatorTests,
  ...signTests,
  ...expenseTests,
  ...recruitTests,
];

// Groups tests by the product segment of their key (e.g. "zoho.crm.*" → "crm").
// Used in runTests() to run each product in its own try/catch so a scope gap
// on one product doesn't abort the remaining 13.
function groupTestsByProduct(allTests) {
  const map = new Map();
  for (const test of allTests) {
    const product = test.key.split(".")[1]; // "zoho.crm.audit_log_enabled" → "crm"
    if (!map.has(product)) map.set(product, []);
    map.get(product).push(test);
  }
  return map;
}

// Builds an authenticated fetch client for a given base URL.
// All Zoho product APIs use Authorization: Zoho-oauthtoken {token} — NOT Bearer.
function buildProductClient(baseUrl, getToken) {
  return {
    get: async (path) => {
      const token = await getToken();
      const res = await fetch(`${baseUrl}${path}`, {
        method: "GET",
        headers: { Authorization: `Zoho-oauthtoken ${token}` },
      });
      if (!res.ok) {
        const text = await res.text();
        throw new Error(`Zoho request to ${baseUrl}${path} failed: ${res.status} ${text}`);
      }
      return res.json();
    },
    post: async (path, body) => {
      const token = await getToken();
      const res = await fetch(`${baseUrl}${path}`, {
        method: "POST",
        headers: {
          Authorization: `Zoho-oauthtoken ${token}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify(body),
      });
      if (!res.ok) {
        const text = await res.text();
        throw new Error(`Zoho request to ${baseUrl}${path} failed: ${res.status} ${text}`);
      }
      return res.json();
    },
  };
}

// Assembles per-product API clients. Products largely follow:
//   https://<product>.zoho.<dc>/...  (Desk, Books, People, Sign, Projects, etc.)
//   https://www.zohoapis.<dc>/...     (CRM, WorkDrive, Analytics-style)
//   https://analyticsapi.zoho.<dc>/  (Analytics)
// The apiDomain resolved by credentials.js is www.zohoapis.<dc> — used as-is
// for CRM and WorkDrive; other products get their own subdomain.
function buildClients(creds) {
  const { getToken, dataCenter, orgId } = creds;
  // For Canada DC, the product subdomains still use zohocloud.ca not zohoapis.ca
  const tld = dataCenter === "cloud.ca" ? "ca" : dataCenter;
  const productBase = (product) => `https://${product}.zoho.${tld}`;

  return {
    // org context — passed through to every test as clients.orgId
    orgId,

    // Generic zohoapis domain — CRM, WorkDrive, Analytics direct API calls
    crm: buildProductClient(creds.apiDomain, getToken),
    workdrive: buildProductClient(creds.apiDomain, getToken),

    // Per-product subdomain clients
    directory: buildProductClient(`https://directory.zoho.${tld}`, getToken),
    books: buildProductClient(productBase("books"), getToken),
    people: buildProductClient(productBase("people"), getToken),
    desk: buildProductClient(productBase("desk"), getToken),
    mail: buildProductClient(productBase("mail"), getToken),
    vault: buildProductClient(productBase("vault"), getToken),
    projects: buildProductClient(productBase("projects"), getToken),
    analytics: buildProductClient(`https://analyticsapi.zoho.${tld}`, getToken),
    creator: buildProductClient(productBase("creator"), getToken),
    sign: buildProductClient(productBase("sign"), getToken),
    expense: buildProductClient(productBase("expense"), getToken),
    recruit: buildProductClient(productBase("recruit"), getToken),
  };
}

// Distinguishes Zoho-specific error cases from generic failures.
// - HTTP 401 or error.code INVALID_OAUTH_TOKEN → scope/auth failure
// - HTTP 429 or error.code RATE_LIMIT → rate limit hit
// - Otherwise → genuine error
function describeZohoError(err) {
  const message = err?.message || String(err);

  // Check for rate limit signals (429 or Zoho's RATE_LIMIT error code)
  if (message.includes("429") || message.toLowerCase().includes("rate_limit") || message.toLowerCase().includes("rate limit")) {
    return (
      `${message} — Zoho rate limit hit. Each Zoho product enforces its own per-organization, ` +
      `per-day API credit cap (varies by product edition and license count). ` +
      `Consider reducing run frequency or the number of checks per run.`
    );
  }

  // Check for scope/auth failures (401 or INVALID_OAUTH_TOKEN)
  if (
    message.includes("401") ||
    message.toLowerCase().includes("invalid_oauth_token") ||
    message.toLowerCase().includes("invalid token") ||
    message.toLowerCase().includes("wrong_dc")
  ) {
    return (
      `${message} — Zoho authorization failure. ` +
      `If "INVALID_OAUTH_TOKEN": the access token may have expired or the refresh token was revoked — ` +
      `re-generate credentials in the Zoho API Console. ` +
      `If "WRONG_DC": config.dataCenter doesn't match the org's actual data center — ` +
      `confirm the customer's Zoho login domain (zoho.com, zoho.eu, zoho.in, etc.) and update accordingly.`
    );
  }

  return (
    `${message} — if this looks like a missing scope, verify the OAuth2 client's scope list in the ` +
    `Zoho API Console covers all products Prism is attempting to audit, and that a fresh authorization ` +
    `code was exchanged after adding the new scopes.`
  );
}

export async function testConnection({ authType, config, secret }) {
  const creds = await resolveZohoCredentials({ authType, config, secret });
  const clients = buildClients(creds);

  // Use CRM org endpoint as the cheapest authenticated call to verify the token works.
  try {
    await clients.crm.get("/crm/v6/org");
  } catch (err) {
    throw new Error(describeZohoError(err));
  }
  return { ok: true, externalAccountId: config.orgId };
}

export async function runTests({ authType, config, secret }) {
  const creds = await resolveZohoCredentials({ authType, config, secret });
  const clients = buildClients(creds);
  const runResults = [];
  const productGroups = groupTestsByProduct(tests);

  // Per-product isolation: a scope gap or rate-limit hit on one product
  // records a per-product error result and continues with the remaining products.
  for (const [product, productTests] of productGroups) {
    try {
      for (const test of productTests) {
        try {
          const results = await test.run(clients);
          for (const result of results) {
            runResults.push({ testKey: test.key, title: test.title, failTitle: test.failTitle, severity: test.severityDefault, ...result });
          }
        } catch (err) {
          runResults.push({
            testKey: test.key,
            title: test.title,
            failTitle: test.failTitle,
            severity: test.severityDefault,
            resourceId: "error",
            status: "error",
            message: describeZohoError(err),
            evidencePayload: {},
          });
        }
      }
    } catch (err) {
      // Product-level catch: scope gap / 401 before any individual test ran
      for (const test of productTests) {
        runResults.push({
          testKey: test.key,
          title: test.title,
          failTitle: test.failTitle,
          severity: test.severityDefault,
          resourceId: "error",
          status: "error",
          message: `Product "${product}" failed before any tests ran: ${describeZohoError(err)}`,
          evidencePayload: {},
        });
      }
    }
  }

  return runResults;
}
