// CPS v2 enrollments + production deployment. Field names from the cps/v2
// enrollments + deployment OpenAPI specs.
// TODO CONFIRM (plan Task 0): pendingChanges entry shape (createdOn vs
// created vs no timestamp — CPS may only give a change location, in which case
// this check widens to "any pending change older than N days by GET change
// status"), and whether keyAlgorithm lives on csr, on the enrollment root, or
// only on the deployed primaryCertificate.

const DAY_MS = 86400000;

function daysUntil(iso) {
  const t = Date.parse(iso);
  return Number.isFinite(t) ? (t - Date.now()) / DAY_MS : null;
}
function daysSince(iso) {
  const t = Date.parse(iso);
  return Number.isFinite(t) ? (Date.now() - t) / DAY_MS : null;
}
function enrollmentLabel(e) {
  return e.cn || e.csr?.cn || e.enrollmentId || "enrollment";
}
// NOTE: the spec §3 `config.contractIds` fallback (for accounts that grant CPS
// but not PAPI) is not yet wired — `akamai.__contractIds` is never set, so if
// PAPI `/papi/v1/contracts` 403s we fall through to an empty list and every CPS
// check reports not_applicable ("no enrollments found").
// TODO: thread config.contractIds from resolveAkamaiCredentials → client as
// akamai.__contractIds so CPS checks work without PAPI scope.
async function allEnrollments(akamai) {
  const contractIds = await akamai.listContractIds().catch(() => []);
  return akamai.listEnrollments(contractIds.length ? contractIds : akamai.__contractIds || []);
}
function naRow(msg) {
  return [{ resourceId: "akamai", status: "not_applicable", message: msg, evidencePayload: {} }];
}

export async function checkNoCertsNearExpiry({ akamai, THRESHOLDS }) {
  const minDays = THRESHOLDS?.CERT_EXPIRY_MIN_DAYS ?? 30;
  const enrollments = await allEnrollments(akamai);
  if (enrollments.length === 0) return naRow("No CPS certificate enrollments found for this account");
  const rows = [];
  for (const e of enrollments) {
    const label = enrollmentLabel(e);
    const dep = await akamai.getProductionDeployment(e.enrollmentId).catch(() => null);
    const expiry = dep?.primaryCertificate?.expiry;
    if (!expiry) {
      rows.push({ resourceId: label, status: "error", message: `${label}: production deployment has no primaryCertificate.expiry — reconfirm the CPS deployment shape against a live account (plan Task 0)`, evidencePayload: { deploymentKeys: Object.keys(dep || {}) } });
      continue;
    }
    const d = daysUntil(expiry);
    rows.push({
      resourceId: label,
      status: d != null && d > minDays ? "pass" : "fail",
      message: d != null && d > minDays ? `${label}: certificate expires in ${Math.round(d)} days` : `${label}: certificate expires in ${d == null ? "an unparseable date" : Math.round(d) + " days"} (threshold ${minDays})`,
      evidencePayload: { expiry, daysToExpiry: d == null ? null : Math.round(d), thresholdDays: minDays },
    });
  }
  return rows;
}

export async function checkAutoRenewalEnabled({ akamai }) {
  const enrollments = await allEnrollments(akamai);
  if (enrollments.length === 0) return naRow("No CPS certificate enrollments found for this account");
  return enrollments.map((e) => {
    const label = enrollmentLabel(e);
    const vt = String(e.validationType || e.certificateType || "").toLowerCase();
    if (vt && vt !== "third-party" && vt !== "third party") {
      return { resourceId: label, status: "pass", message: `${label}: ${vt.toUpperCase()} enrollment — Akamai renews it automatically`, evidencePayload: { validationType: vt } };
    }
    const hasOwner = Boolean(e.adminContact?.email || e.techContact?.email || e.adminContact?.firstName);
    return {
      resourceId: label,
      status: hasOwner ? "pass" : "fail",
      message: hasOwner
        ? `${label}: third-party certificate with a named admin/technical contact accountable for renewal`
        : `${label}: third-party certificate with no admin or technical contact — no owner accountable for manual renewal`,
      evidencePayload: { validationType: vt || "third-party", hasOwner },
    };
  });
}

export async function checkStrongKeyAlgorithm({ akamai }) {
  const enrollments = await allEnrollments(akamai);
  if (enrollments.length === 0) return naRow("No CPS certificate enrollments found for this account");
  return enrollments.map((e) => {
    const label = enrollmentLabel(e);
    const algo = String(e.csr?.keyAlgorithm || e.keyAlgorithm || e.certificateChainType || "").toUpperCase();
    const size = Number(e.csr?.keySize || e.keySize || 0);
    let strong;
    if (algo.includes("ECDSA") || algo.includes("EC")) strong = true;
    else if (algo.includes("RSA")) strong = size === 0 ? null : size >= 2048;
    else strong = null;
    if (strong === null) {
      return { resourceId: label, status: "error", message: `${label}: could not determine key algorithm/size ("${algo}" size ${size || "?"}) — reconfirm where CPS exposes this (plan Task 0)`, evidencePayload: { algo, size } };
    }
    return {
      resourceId: label,
      status: strong ? "pass" : "fail",
      message: strong ? `${label}: key is ${algo}${size ? " " + size : ""} — meets the strength floor` : `${label}: key is ${algo} ${size} — below the RSA-2048 / ECDSA floor`,
      evidencePayload: { algo, size },
    };
  });
}

export async function checkNoStuckChanges({ akamai, THRESHOLDS }) {
  const maxDays = THRESHOLDS?.STUCK_CHANGE_MAX_DAYS ?? 14;
  const enrollments = await allEnrollments(akamai);
  if (enrollments.length === 0) return naRow("No CPS certificate enrollments found for this account");
  return enrollments.map((e) => {
    const label = enrollmentLabel(e);
    const pending = e.pendingChanges || [];
    if (pending.length === 0) {
      return { resourceId: label, status: "pass", message: `${label}: no certificate change in progress`, evidencePayload: { pendingChanges: 0 } };
    }
    const ages = pending.map((c) => daysSince(c.createdOn || c.created || c.startTime)).filter((n) => n != null);
    const oldest = ages.length ? Math.max(...ages) : null;
    if (oldest == null) {
      // CPS gave us a change with no timestamp — flag as warn rather than guess.
      return { resourceId: label, status: "warn", message: `${label}: ${pending.length} pending change(s) with no readable start time — check them manually in CPS`, evidencePayload: { pendingChanges: pending.length } };
    }
    return {
      resourceId: label,
      status: oldest <= maxDays ? "pass" : "fail",
      message: oldest <= maxDays
        ? `${label}: ${pending.length} pending change(s), oldest ${Math.round(oldest)}d (within the ${maxDays}d window)`
        : `${label}: a certificate change has been pending for ${Math.round(oldest)} days (stuck — likely awaiting domain validation or approval)`,
      evidencePayload: { pendingChanges: pending.length, oldestChangeDays: Math.round(oldest), thresholdDays: maxDays },
    };
  });
}

export const cpsTests = [
  { key: "akamai.cps.no_certs_near_expiry", title: "No production certificate expires soon", failTitle: "A production certificate expires within the warning window", severityDefault: "critical", isoReferences: ["A.10.1.1"], dpdpaControlAreas: ["Encryption"], run: (clients) => checkNoCertsNearExpiry(clients) },
  { key: "akamai.cps.auto_renewal_enabled", title: "Certificates renew automatically or have an owner", failTitle: "A certificate neither auto-renews nor has a named owner", severityDefault: "high", isoReferences: ["A.10.1.2"], dpdpaControlAreas: ["Encryption"], run: (clients) => checkAutoRenewalEnabled(clients) },
  { key: "akamai.cps.strong_key_algorithm", title: "Certificate keys meet the strength floor", failTitle: "A certificate key is below the strength floor", severityDefault: "high", isoReferences: ["A.10.1.1"], dpdpaControlAreas: ["Encryption"], run: (clients) => checkStrongKeyAlgorithm(clients) },
  { key: "akamai.cps.no_stuck_changes", title: "No certificate change is stuck in progress", failTitle: "A certificate change has been stuck in progress", severityDefault: "medium", isoReferences: ["A.12.1.2"], dpdpaControlAreas: ["Security Safeguards Program"], run: (clients) => checkNoStuckChanges(clients) },
];
