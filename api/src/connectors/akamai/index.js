import { resolveAkamaiCredentials } from "./credentials.js";
import { akamaiClient } from "./client.js";
import { appsecTests } from "./tests/appsec.js";
import { siemTests } from "./tests/siem.js";
import { apiTests } from "./tests/apiDefinitions.js";
import { propertyTests } from "./tests/property.js";
import { cpsTests } from "./tests/cps.js";

export const key = "akamai";

export const tests = [...appsecTests, ...siemTests, ...apiTests, ...propertyTests, ...cpsTests];

// Thresholds live in code and are echoed into each check's evidencePayload so a
// reviewer can see exactly what was applied (there is no per-connection config
// store for connector checks yet — see salesforce/index.js, crowdstrike/index.js).
export const THRESHOLDS = {
  CERT_EXPIRY_MIN_DAYS: 30,
  HSTS_MIN_MAX_AGE_SECONDS: 15552000, // 180 days
  PROPERTY_VERSION_LAG_MAX: 2,
  STUCK_CHANGE_MAX_DAYS: 14,
};

function groupTestsByArea(allTests) {
  const map = new Map();
  for (const t of allTests) {
    const area = t.key.split(".")[1];
    if (!map.has(area)) map.set(area, []);
    map.get(area).push(t);
  }
  return map;
}

function isScopeError(err) {
  const m = (err?.message || String(err)).toLowerCase();
  return m.includes(" 403") || m.includes("forbidden") || m.includes("not authorized") || m.includes("permission");
}

export async function testConnection({ authType, config, secret }) {
  const creds = await resolveAkamaiCredentials({ authType, config, secret });
  const akamai = akamaiClient(creds);
  // Probe order: PAPI contracts (most commonly granted) → appsec configs → CPS.
  // The first 2xx confirms the EdgeGrid credential is valid; a 401 anywhere means
  // bad signing (wrong host/secret/token or clock skew).
  const probes = [
    async () => {
      const b = await akamai.get("/papi/v1/contracts");
      return b?.contracts?.items?.[0]?.contractId;
    },
    async () => {
      const b = await akamai.get("/appsec/v1/configs");
      return b?.configurations?.[0]?.id != null ? `appsec:${b.configurations[0].id}` : null;
    },
    async () => {
      const b = await akamai.get("/cps/v2/enrollments", { accept: "application/vnd.akamai.cps.enrollments.v11+json" });
      return b?.enrollments?.[0]?.location ? "cps" : null;
    },
  ];
  let lastErr = null;
  for (const probe of probes) {
    try {
      const id = await probe();
      return { ok: true, externalAccountId: id || creds.host };
    } catch (err) {
      lastErr = err;
      if (/ 401/.test(err.message)) break; // a 401 won't get better on the next probe
    }
  }
  throw new Error(akamai.describeAkamaiError(lastErr || new Error("Akamai connection probe failed")));
}

export async function runTests({ authType, config, secret }) {
  const creds = await resolveAkamaiCredentials({ authType, config, secret });
  const akamai = akamaiClient(creds);
  const clients = { akamai, THRESHOLDS };
  const out = [];

  // The try/catch is PER TEST, not per area: a non-scope failure partway through
  // an area must not append a contradictory error row to checks that already
  // succeeded, nor blanket-error the checks after it. The area 403 downgrade
  // still works — client.js memoises the rejected discovery promise, so when an
  // area's discovery call 403s, every check in that area independently re-throws
  // the same scope error and each is independently downgraded to not_applicable.
  // Mirrors servicenow/index.js and salesforce/index.js.
  for (const [area, areaTests] of groupTestsByArea(tests)) {
    for (const test of areaTests) {
      try {
        const results = await test.run(clients);
        for (const r of results) {
          out.push({
            testKey: test.key,
            title: test.title,
            failTitle: test.failTitle,
            severity: test.severityDefault,
            ...r,
          });
        }
      } catch (err) {
        const scoped = isScopeError(err);
        out.push({
          testKey: test.key,
          title: test.title,
          failTitle: test.failTitle,
          severity: test.severityDefault,
          resourceId: scoped ? "not_applicable" : "error",
          status: scoped ? "not_applicable" : "error",
          message: scoped
            ? `Akamai "${area}" checks could not run — the API client is missing the ${area} product scope. ${akamai.describeAkamaiError(err)}`
            : akamai.describeAkamaiError(err),
          evidencePayload: {},
        });
      }
    }
  }
  return out;
}
