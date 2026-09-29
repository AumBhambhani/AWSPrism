import { buildEvidencePayload } from "../../shared/evidencePayload.js";

const ARTIFACT_WINDOW_DAYS = 30;
const NOTICE_REVIEW_DAYS = 365;

function daysSince(value) {
  const t = Date.parse(value);
  return Number.isNaN(t) ? null : (Date.now() - t) / 86400000;
}

function isActivePoint(p) {
  const s = String(p.status ?? p.state ?? "").toLowerCase();
  if (s) return s === "active" || s === "published" || s === "live";
  return p.active !== false && p.enabled !== false;
}

function pointPayload(p, details) {
  return buildEvidencePayload({
    resourceType: "privy_consent_collection_point",
    resourceId: String(p.id ?? p.collectionPointId ?? p.key ?? "unknown"),
    resourceName: p.name ? String(p.name) : String(p.id ?? p.collectionPointId ?? "unknown"),
    region: null,
    details,
  });
}

// At least one active consent collection point must be registered — otherwise
// there is no evidence a consent-capture programme is operating at all.
async function checkCollectionPointsRegistered(clients) {
  const points = await clients.listConsentCollectionPoints();
  const active = points.filter(isActivePoint);
  return [
    {
      resourceId: "consent-collection-points",
      status: active.length > 0 ? "pass" : "fail",
      message:
        active.length > 0
          ? `${active.length} active consent collection point(s) registered in Privy`
          : "No active consent collection point is registered in Privy — a consent-capture programme is not demonstrably operating",
      evidencePayload: buildEvidencePayload({
        resourceType: "privy_consent_programme",
        resourceId: "consent-collection-points",
        resourceName: "Consent collection points",
        region: null,
        details: { totalCollectionPoints: points.length, activeCollectionPoints: active.length },
      }),
    },
  ];
}

// Consent artefacts must be getting written — at least one in the trailing 30
// days — so the collection points are live, not just configured.
async function checkArtifactsBeingCaptured(clients) {
  const artifacts = await clients.listConsentArtifacts();
  const recent = artifacts.filter((a) => {
    const age = daysSince(a.createdAt ?? a.timestamp ?? a.collectedAt ?? a.date);
    return age != null && age <= ARTIFACT_WINDOW_DAYS;
  });
  return [
    {
      resourceId: "consent-artifacts",
      status: recent.length > 0 ? "pass" : "fail",
      message:
        recent.length > 0
          ? `${recent.length} consent artefact(s) captured in the last ${ARTIFACT_WINDOW_DAYS} days`
          : `No consent artefact has been captured in Privy in the last ${ARTIFACT_WINDOW_DAYS} days`,
      evidencePayload: buildEvidencePayload({
        resourceType: "privy_consent_artifact_activity",
        resourceId: "consent-artifacts",
        resourceName: "Consent artefacts",
        region: null,
        details: { artifactsSeen: artifacts.length, artifactsLast30Days: recent.length },
      }),
    },
  ];
}

// Every active collection point should carry a versioned notice / purpose text
// reviewed within the last 12 months.
async function checkNoticeVersioned(clients) {
  const points = (await clients.listConsentCollectionPoints()).filter(isActivePoint);
  if (points.length === 0) {
    return [{ resourceId: "consent-collection-points", status: "not_applicable", message: "No active consent collection point to evaluate for notice versioning", evidencePayload: pointPayload({}, {}) }];
  }
  const rows = [];
  for (const p of points) {
    const version = p.noticeVersion ?? p.purposeVersion ?? p.version ?? p.notice?.version;
    const reviewed = daysSince(p.noticeUpdatedAt ?? p.updatedAt ?? p.lastModified ?? p.notice?.updatedAt);
    const noVersion = version == null || version === "";
    const stale = reviewed != null && reviewed > NOTICE_REVIEW_DAYS;
    if (noVersion || stale) {
      rows.push({
        resourceId: String(p.id ?? p.collectionPointId),
        status: "fail",
        message: noVersion
          ? `Collection point "${p.name ?? p.id}" has no versioned notice / purpose text`
          : `Collection point "${p.name ?? p.id}" notice has not been reviewed in ${Math.round(reviewed)} days`,
        evidencePayload: pointPayload(p, { noticeVersion: version ?? null, noticeReviewedDaysAgo: reviewed == null ? null : Math.round(reviewed) }),
      });
    }
  }
  if (rows.length === 0) {
    return [{ resourceId: "consent-collection-points", status: "pass", message: `All ${points.length} active collection point(s) carry a notice reviewed within ${NOTICE_REVIEW_DAYS} days`, evidencePayload: pointPayload({}, { collectionPointsChecked: points.length }) }];
  }
  return rows;
}

// Consent must be as easy to withdraw as to give — every active collection point
// needs a withdrawal path configured.
async function checkWithdrawalSupported(clients) {
  const points = (await clients.listConsentCollectionPoints()).filter(isActivePoint);
  if (points.length === 0) {
    return [{ resourceId: "consent-collection-points", status: "not_applicable", message: "No active consent collection point to evaluate for withdrawal support", evidencePayload: pointPayload({}, {}) }];
  }
  const rows = [];
  for (const p of points) {
    const withdrawal =
      p.withdrawalEnabled ??
      p.allowWithdrawal ??
      p.withdrawalSupported ??
      (p.withdrawalUrl || p.withdrawalEndpoint ? true : undefined);
    if (withdrawal === false) {
      rows.push({
        resourceId: String(p.id ?? p.collectionPointId),
        status: "fail",
        message: `Collection point "${p.name ?? p.id}" has consent withdrawal disabled`,
        evidencePayload: pointPayload(p, { withdrawalEnabled: false }),
      });
    }
  }
  if (rows.length === 0) {
    return [{ resourceId: "consent-collection-points", status: "pass", message: `No active collection point has withdrawal explicitly disabled`, evidencePayload: pointPayload({}, { collectionPointsChecked: points.length }) }];
  }
  return rows;
}

export const consentTests = [
  {
    key: "privy.consent.collection_points_registered",
    title: "A consent-capture programme is operating",
    failTitle: "No active consent collection point is registered in Privy",
    severityDefault: "high",
    isoReferences: ["A.18.1.1"],
    dpdpaControlAreas: ["Consent Management"],
    run: (clients) => checkCollectionPointsRegistered(clients),
  },
  {
    key: "privy.consent.artifacts_being_captured",
    title: "Consent artefacts are actively being captured",
    failTitle: "No consent artefact has been captured in the last 30 days",
    severityDefault: "high",
    isoReferences: ["A.18.1.4"],
    dpdpaControlAreas: ["Consent Management"],
    run: (clients) => checkArtifactsBeingCaptured(clients),
  },
  {
    key: "privy.consent.notice_versioned",
    title: "Consent notices are versioned and reviewed",
    failTitle: "Consent collection point has an unversioned or stale notice",
    severityDefault: "medium",
    isoReferences: ["A.18.1.1"],
    dpdpaControlAreas: ["Consent Management"],
    run: (clients) => checkNoticeVersioned(clients),
  },
  {
    key: "privy.consent.withdrawal_supported",
    title: "Consent withdrawal is supported at every collection point",
    failTitle: "Consent collection point has withdrawal disabled",
    severityDefault: "medium",
    isoReferences: ["A.18.1.4"],
    dpdpaControlAreas: ["Consent Management"],
    run: (clients) => checkWithdrawalSupported(clients),
  },
];
