import { buildEvidencePayload } from "../../shared/evidencePayload.js";
import { oDataPaginate } from "../oDataPaginate.js";

// ──────────────────────────────────────────────────────────────────────────────
// microsoft_defender.recommendations.high_impact_open_reviewed
// ──────────────────────────────────────────────────────────────────────────────
async function checkHighImpactOpenReviewed(getToken, baseUrl) {
  const recs = await oDataPaginate(getToken, baseUrl, "/api/recommendations");
  // Flag recommendations with high exposure/config impact that have no documented exception
  const flagged = recs.filter((r) => {
    const highImpact = (r.exposureImpact || 0) > 50 || (r.configScoreImpact || 0) > 50;
    const noException = r.status !== "Exception";
    return highImpact && noException && r.remediationType !== "None";
  });

  if (flagged.length === 0) {
    return [{
      resourceId: "recommendations",
      status: "pass",
      message: `Reviewed ${recs.length} security recommendation(s) — no high-impact open items found`,
      evidencePayload: buildEvidencePayload({ resourceType: "defender_recommendations", resourceId: "recommendations", region: null, details: { totalRecommendations: recs.length, highImpactOpen: 0 } }),
    }];
  }
  return flagged.map((r) => ({
    resourceId: r.id,
    status: "fail",
    message: `High-impact recommendation "${r.recommendationName || r.id}" is open with no documented exception`,
    evidencePayload: buildEvidencePayload({
      resourceType: "defender_recommendation",
      resourceId: r.id,
      resourceName: r.recommendationName || r.id,
      region: null,
      details: { exposureImpact: r.exposureImpact, configScoreImpact: r.configScoreImpact, status: r.status },
    }),
  }));
}

export const recommendationsTests = [
  {
    key: "microsoft_defender.recommendations.high_impact_open_reviewed",
    title: "High-impact security recommendations are actioned or have a documented exception",
    failTitle: "High-impact recommendation is open with no documented exception",
    severityDefault: "high",
    isoReferences: ["A.12.6.1"],
    dpdpaControlAreas: ["Vulnerability & Patch Management"],
    run: (clients) => checkHighImpactOpenReviewed(clients.getToken, clients.baseUrl),
  },
];
