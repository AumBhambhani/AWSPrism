// PAPI rule trees are nested { name, children[], behaviors[] } JSON. Behavior
// names below are from Akamai's Property Manager catalogue but VARY by product
// and rule format — every check here returns status:"error" (not a guessed
// pass/fail) when it finds no candidate behavior node at all. Confirm the real
// names against a live account (plan Task 0), then narrow these lists.

const REDIRECT_NAMES = ["redirect", "redirectplus", "edgeRedirector"]; // TODO CONFIRM
const HSTS_NAMES = ["httpStrictTransportSecurity", "http-strict-transport-security"]; // TODO CONFIRM
const ORIGIN_NAMES = ["origin"]; // TODO CONFIRM
const SITESHIELD_NAMES = ["siteShield", "siteshield"]; // TODO CONFIRM
const WEAK_TLS = new Set(["tlsv1", "tlsv1_1", "tlsv1.1", "tls1", "tls1.1"]);

function* walkBehaviors(ruleNode) {
  if (!ruleNode) return;
  for (const b of ruleNode.behaviors || []) yield { name: b.name, options: b.options || {} };
  for (const child of ruleNode.children || []) yield* walkBehaviors(child);
}

function collect(ruleTreeBody, names) {
  const root = ruleTreeBody?.rules || ruleTreeBody;
  const set = new Set(names.map((n) => n.toLowerCase()));
  const found = [];
  for (const b of walkBehaviors(root)) if (set.has(String(b.name).toLowerCase())) found.push(b);
  return found;
}

async function forEachProdProperty(akamai, fn) {
  const properties = await akamai.listProperties();
  const rows = [];
  let saw = false;
  for (const p of properties) {
    const version = await akamai.resolveActivePropertyVersion(p.propertyId);
    if (!version) continue;
    saw = true;
    const resourceId = p.propertyName ?? p.propertyId;
    rows.push(await fn({ akamai, property: p, version, resourceId }));
  }
  if (!saw) return [{ resourceId: "akamai", status: "not_applicable", message: "No property is activated on the production network", evidencePayload: {} }];
  return rows;
}

const errorRow = (resourceId, kind) => ({
  resourceId,
  status: "error",
  message: `${resourceId}: could not locate a ${kind} behavior in the property rule tree — the behavior-node name mapping needs live confirmation against a real Akamai account (see connector plan Task 0) before this check can be trusted.`,
  evidencePayload: { unresolved: kind },
});

export async function checkForceHttps({ akamai }) {
  return forEachProdProperty(akamai, async ({ akamai: a, property, version, resourceId }) => {
    const tree = await a.getRuleTree(property.propertyId, version);
    const redirects = collect(tree, REDIRECT_NAMES);
    if (redirects.length === 0) return errorRow(resourceId, "redirect-to-HTTPS");
    const forces = redirects.some(
      (b) =>
        /https/i.test(b.options.destinationProtocol || "") ||
        b.options.forceHttps === true ||
        /https/i.test(JSON.stringify(b.options))
    );
    return {
      resourceId,
      status: forces ? "pass" : "fail",
      message: forces ? `${resourceId}: forces HTTP requests to HTTPS` : `${resourceId}: has redirect behavior(s) but none force HTTPS`,
      evidencePayload: { redirectBehaviors: redirects.length },
    };
  });
}

export async function checkMinTls12({ akamai }) {
  return forEachProdProperty(akamai, async ({ akamai: a, property, version, resourceId }) => {
    const tree = await a.getRuleTree(property.propertyId, version);
    const origins = collect(tree, ORIGIN_NAMES);
    if (origins.length === 0) return errorRow(resourceId, "origin (TLS floor)");
    const weak = origins
      .map((b) => String(b.options.tlsVersion || b.options.minTlsVersion || "").toLowerCase())
      .filter((v) => v && WEAK_TLS.has(v));
    return {
      resourceId,
      status: weak.length === 0 ? "pass" : "fail",
      message:
        weak.length === 0
          ? `${resourceId}: no origin behavior permits TLS below 1.2`
          : `${resourceId}: an origin behavior permits ${weak.join(", ")}`,
      evidencePayload: { originBehaviors: origins.length, weakTlsVersions: weak },
    };
  });
}

export async function checkHstsEnabled({ akamai, THRESHOLDS }) {
  const min = THRESHOLDS?.HSTS_MIN_MAX_AGE_SECONDS ?? 15552000;
  return forEachProdProperty(akamai, async ({ akamai: a, property, version, resourceId }) => {
    const tree = await a.getRuleTree(property.propertyId, version);
    const hsts = collect(tree, HSTS_NAMES);
    if (hsts.length === 0) return errorRow(resourceId, "HSTS");
    const strong = hsts.some((b) => b.options.enable !== false && Number(b.options.maxAge) >= min);
    return {
      resourceId,
      status: strong ? "pass" : "fail",
      message: strong
        ? `${resourceId}: sends HSTS with max-age ≥ ${min}s`
        : `${resourceId}: HSTS is missing, disabled, or below the ${min}s max-age floor`,
      evidencePayload: { hstsBehaviors: hsts.length, maxAges: hsts.map((b) => b.options.maxAge ?? null) },
    };
  });
}

export async function checkLatestVersionActive({ akamai, THRESHOLDS }) {
  const maxLag = THRESHOLDS?.PROPERTY_VERSION_LAG_MAX ?? 2;
  return forEachProdProperty(akamai, async ({ property, version, resourceId }) => {
    const latest = Number(property.latestVersion ?? property.latestVersionNumber ?? version);
    const lag = latest - version;
    return {
      resourceId,
      status: lag <= maxLag ? "pass" : "fail",
      message:
        lag <= maxLag
          ? `${resourceId}: production version (${version}) is within ${maxLag} of the latest (${latest})`
          : `${resourceId}: production version (${version}) lags the latest (${latest}) by ${lag}`,
      evidencePayload: { productionVersion: version, latestVersion: latest, lag },
    };
  });
}

export async function checkOriginProtected({ akamai }) {
  return forEachProdProperty(akamai, async ({ akamai: a, property, version, resourceId }) => {
    const tree = await a.getRuleTree(property.propertyId, version);
    const siteShield = collect(tree, SITESHIELD_NAMES);
    const origins = collect(tree, ORIGIN_NAMES);
    if (siteShield.length === 0 && origins.length === 0) return errorRow(resourceId, "Site Shield / origin");
    const shielded =
      siteShield.length > 0 ||
      origins.some((b) => /allowlist|acl|edgeip|verificationmode/i.test(JSON.stringify(b.options)));
    return {
      resourceId,
      status: shielded ? "pass" : "fail",
      message: shielded
        ? `${resourceId}: origin is shielded (Site Shield or origin ACL present)`
        : `${resourceId}: no Site Shield or origin IP restriction — origin may be directly reachable`,
      evidencePayload: { siteShieldBehaviors: siteShield.length, originBehaviors: origins.length },
    };
  });
}

export const propertyTests = [
  { key: "akamai.property.force_https", title: "Production properties force HTTPS", failTitle: "A production property does not force HTTPS", severityDefault: "high", isoReferences: ["A.14.1.2"], dpdpaControlAreas: ["Network Security"], run: (clients) => checkForceHttps(clients) },
  { key: "akamai.property.min_tls_1_2", title: "Edge TLS floor is TLS 1.2 or higher", failTitle: "A property permits TLS below 1.2", severityDefault: "high", isoReferences: ["A.10.1.1"], dpdpaControlAreas: ["Encryption"], run: (clients) => checkMinTls12(clients) },
  { key: "akamai.property.hsts_enabled", title: "HTTPS properties send HSTS", failTitle: "An HTTPS property does not send a strong HSTS header", severityDefault: "medium", isoReferences: ["A.14.1.2"], dpdpaControlAreas: ["Network Security"], run: (clients) => checkHstsEnabled(clients) },
  { key: "akamai.property.latest_version_active", title: "Property production version is current", failTitle: "A property's production version lags the latest by too much", severityDefault: "low", isoReferences: ["A.12.1.2"], dpdpaControlAreas: ["Security Safeguards Program"], run: (clients) => checkLatestVersionActive(clients) },
  { key: "akamai.property.origin_protected", title: "Origin is shielded from direct access", failTitle: "A property's origin is not shielded from direct access", severityDefault: "low", isoReferences: ["A.13.1.3"], dpdpaControlAreas: ["Network Security"], run: (clients) => checkOriginProtected(clients) },
];
