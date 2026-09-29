const REQUIRED_CONTENT_TYPES = ["Audit.AzureActiveDirectory", "Audit.Exchange", "Audit.SharePoint", "Audit.General"];

// Confirmed by Task 0 research (findings doc for this plan, research item #7):
// when unified audit logging is disabled for a tenant, the Office 365
// Management Activity API's /subscriptions/list call fails with this specific
// Microsoft exception namespace in the response body. We substring-match on
// it (rather than an HTTP status code) because that's the only observable
// signal the API surfaces for "audit logging is off" vs. any other failure.
const AUDIT_DISABLED_SIGNATURE = "Microsoft.Office.Compliance.Audit.DataServiceException";

function isSubscriptionsDisabledError(err) {
  const message = (err && err.message) || "";
  return message.includes(AUDIT_DISABLED_SIGNATURE);
}

async function fetchSubscriptions(audit) {
  const response = await audit.get("/subscriptions/list");
  return Array.isArray(response) ? response : [];
}

function findSubscription(subscriptions, contentType) {
  return subscriptions.find((s) => s.contentType === contentType);
}

function isEnabled(subscription) {
  return Boolean(subscription) && (subscription.status || "").toLowerCase() === "enabled";
}

export async function checkUnifiedLoggingEnabled(audit) {
  try {
    await audit.get("/subscriptions/list");
    return [{ resourceId: "tenant", status: "pass", message: "Unified audit logging is enabled for this tenant", evidencePayload: {} }];
  } catch (err) {
    if (isSubscriptionsDisabledError(err)) {
      return [{ resourceId: "tenant", status: "fail", message: "Unified audit logging is disabled for this tenant.", evidencePayload: {} }];
    }
    // Any other failure (auth, transient, network) can't be distinguished
    // from "audit logging is off" via this API alone, so we report `error`
    // rather than asserting a false `fail`.
    return [{ resourceId: "tenant", status: "error", message: `Could not determine unified audit logging status: ${err.message}`, evidencePayload: {} }];
  }
}

export async function checkSubscriptionsActive(audit) {
  let subscriptions;
  try {
    subscriptions = await fetchSubscriptions(audit);
  } catch (err) {
    // The root cause (e.g. audit logging disabled entirely) is already
    // captured as its own finding by checkUnifiedLoggingEnabled — this check
    // simply couldn't determine subscription status, so every required
    // content type is `error`, not `fail`.
    return REQUIRED_CONTENT_TYPES.map((contentType) => ({
      resourceId: contentType,
      status: "error",
      message: `Could not determine subscription status for ${contentType}: ${err.message}`,
      evidencePayload: {},
    }));
  }

  return REQUIRED_CONTENT_TYPES.map((contentType) => {
    const subscription = findSubscription(subscriptions, contentType);
    const enabled = isEnabled(subscription);
    return {
      resourceId: contentType,
      status: enabled ? "pass" : "fail",
      message: enabled
        ? `${contentType} audit log subscription is active`
        : subscription
          ? `${contentType} audit log subscription exists but is not enabled (status: ${subscription.status})`
          : `${contentType} audit log subscription has not been started`,
      evidencePayload: { status: subscription ? subscription.status : null },
    };
  });
}

export async function checkDlpAlertsAvailable(audit) {
  let subscriptions;
  try {
    subscriptions = await fetchSubscriptions(audit);
  } catch (err) {
    return [{ resourceId: "DLP.All", status: "error", message: `Could not determine DLP.All subscription status: ${err.message}`, evidencePayload: {} }];
  }

  const dlpSubscription = findSubscription(subscriptions, "DLP.All");

  // Judgment call (explicit per the plan): the Management Activity API gives
  // no direct signal of "how many DLP policies exist" — the DLP.All content
  // type subscription is the only observable proxy. If it's absent from the
  // subscriptions list, we cannot tell "tenant has zero DLP policies
  // configured" (not a compliance gap — nothing to flag) apart from "DLP.All
  // was simply never started despite policies existing" (a real gap). Since
  // we can't distinguish these via this API alone, we report `not_applicable`
  // rather than asserting a false `fail`. If DLP.All IS present, we treat
  // that as evidence a subscription attempt was made — at that point a
  // non-enabled status is unambiguously a real logging gap, so we report
  // `fail` (not `not_applicable`).
  if (!dlpSubscription) {
    return [
      {
        resourceId: "DLP.All",
        status: "not_applicable",
        message: "No evidence of DLP policy configuration; cannot distinguish 'no DLP policies configured' from 'DLP.All subscription never started' via this API alone",
        evidencePayload: {},
      },
    ];
  }

  const enabled = isEnabled(dlpSubscription);
  return [
    {
      resourceId: "DLP.All",
      status: enabled ? "pass" : "fail",
      message: enabled ? "DLP.All subscription is active and logging" : "DLP.All subscription exists but is not actively logging",
      evidencePayload: { status: dlpSubscription.status },
    },
  ];
}

export async function checkContentRecentlyAvailable(audit) {
  let subscriptions;
  try {
    subscriptions = await fetchSubscriptions(audit);
  } catch (err) {
    // Mirrors checkSubscriptionsActive's upstream-call-failure fallback:
    // we can't determine which content types are active, so this is an
    // `error` (we don't know) rather than `not_applicable` (which is
    // reserved for a confirmed "legitimately nothing to check" state, e.g.
    // zero active subscriptions once the list call actually succeeds).
    return REQUIRED_CONTENT_TYPES.map((contentType) => ({
      resourceId: contentType,
      status: "error",
      message: `Could not determine active subscriptions to check content for ${contentType}: ${err.message}`,
      evidencePayload: {},
    }));
  }

  const activeContentTypes = REQUIRED_CONTENT_TYPES.filter((contentType) => isEnabled(findSubscription(subscriptions, contentType)));

  if (activeContentTypes.length === 0) {
    return [{ resourceId: "tenant", status: "not_applicable", message: "No active subscriptions to check content for", evidencePayload: {} }];
  }

  const results = [];
  for (const contentType of activeContentTypes) {
    try {
      // Omit startTime/endTime — the API defaults to the last 24h window.
      const content = await audit.get(`/subscriptions/content?contentType=${contentType}`);
      const blobs = Array.isArray(content) ? content : [];
      const hasContent = blobs.length > 0;
      results.push({
        resourceId: contentType,
        status: hasContent ? "pass" : "fail",
        message: hasContent
          ? `${contentType} has audit content available from the last 24 hours`
          : `${contentType} is subscribed but no audit content was found in the last 24 hours; a fresh subscription can take up to 12 hours before content appears`,
        evidencePayload: { blobCount: blobs.length },
      });
    } catch (err) {
      // Keep distinct from `fail` — an API-call failure doesn't tell us
      // whether content is or isn't flowing, so this maps to the DB CHECK
      // constraint's `error` status, not `fail`.
      results.push({
        resourceId: contentType,
        status: "error",
        message: `Could not check content availability for ${contentType}: ${err.message}`,
        evidencePayload: {},
      });
    }
  }
  return results;
}

export const auditTests = [
  {
    key: "purview.audit.unified_logging_enabled",
    title: "Unified audit logging is enabled",
    failTitle: "Unified audit logging is disabled",
    severityDefault: "critical",
    isoReferences: ["A.12.4.1"],
    dpdpaControlAreas: ["Logging & Monitoring"],
    run: (clients) => checkUnifiedLoggingEnabled(clients.audit),
  },
  {
    key: "purview.audit.subscriptions_active",
    title: "Required audit log content-type subscriptions are active",
    failTitle: "Required audit log content-type subscription is not active",
    severityDefault: "high",
    isoReferences: ["A.12.4.1"],
    dpdpaControlAreas: ["Logging & Monitoring"],
    run: (clients) => checkSubscriptionsActive(clients.audit),
  },
  {
    key: "purview.audit.dlp_alerts_available",
    title: "DLP audit content is available",
    failTitle: "DLP audit content is not available",
    severityDefault: "high",
    isoReferences: ["A.13.2.1"],
    dpdpaControlAreas: ["DLP / Data Leakage Prevention"],
    run: (clients) => checkDlpAlertsAvailable(clients.audit),
  },
  {
    key: "purview.audit.content_recently_available",
    title: "Audit content is actively flowing",
    failTitle: "Audit content is not actively flowing",
    severityDefault: "medium",
    isoReferences: ["A.12.4.1"],
    dpdpaControlAreas: ["Logging & Monitoring"],
    run: (clients) => checkContentRecentlyAvailable(clients.audit),
  },
];
