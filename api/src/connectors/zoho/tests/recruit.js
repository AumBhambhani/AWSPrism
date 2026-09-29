import { buildEvidencePayload } from "../../shared/evidencePayload.js";

// GET https://recruit.zoho.{dc}/recruit/v2/settings/security — check candidate data access
async function checkCandidateDataAccessReview(clients) {
  const data = await clients.recruit.get("/recruit/v2/settings/sharing");
  const rules = data?.data || data?.sharing_rules || [];
  // Flag any module where access is org-wide rather than requisition-based
  const openRules = rules.filter(
    (r) => (r.module === "Candidates" || r.module === "candidates") &&
    (r.access === "Public_ReadWrite" || r.access === "Public_Read" || r.sharing_type === "everyone")
  );
  const results = openRules.map((r) => ({
    resourceId: r.id || "candidates_sharing",
    status: "fail",
    message: `Recruit candidate data sharing rule allows "${r.access || r.sharing_type}" access — not restricted to requisition assignment`,
    evidencePayload: buildEvidencePayload({
      resourceType: "zoho_recruit_org",
      resourceId: r.id || "candidates_sharing",
      resourceName: "Candidates sharing rule",
      region: null,
      details: { module: r.module, access: r.access || r.sharing_type },
    }),
  }));
  if (results.length === 0) {
    results.push({
      resourceId: clients.orgId,
      status: "pass",
      message: "Candidate data access is restricted — no org-wide read/write sharing rules found",
      evidencePayload: buildEvidencePayload({
        resourceType: "zoho_recruit_org",
        resourceId: clients.orgId,
        resourceName: `Org ${clients.orgId}`,
        region: null,
        details: { rulesChecked: rules.length },
      }),
    });
  }
  return results;
}

// GET https://recruit.zoho.{dc}/recruit/v2/settings — check data retention policy
async function checkDataRetentionPolicyConfigured(clients) {
  const data = await clients.recruit.get("/recruit/v2/settings");
  const settings = data?.settings || data;
  const retentionConfigured =
    settings?.data_retention_enabled === true ||
    settings?.candidate_data_retention != null ||
    settings?.retention_policy_configured === true;
  return [
    {
      resourceId: clients.orgId,
      status: retentionConfigured ? "pass" : "fail",
      message: retentionConfigured
        ? "Recruit candidate data retention/deletion policy is configured"
        : "Recruit does not have a candidate data retention/deletion policy configured",
      evidencePayload: buildEvidencePayload({
        resourceType: "zoho_recruit_org",
        resourceId: clients.orgId,
        resourceName: `Org ${clients.orgId}`,
        region: null,
        details: { retentionPolicyConfigured: retentionConfigured },
      }),
    },
  ];
}

// GET https://recruit.zoho.{dc}/recruit/v2/JobOpenings?fields=Job_Status,Publish_Status
async function checkJobPostingVisibilityReview(clients) {
  const data = await clients.recruit.get("/recruit/v2/JobOpenings?fields=Job_Status,Publish_Status,Job_Opening_Name");
  const openings = data?.data || data?.job_openings || [];
  // Flag openings that are marked as internal-only but have a public publish status
  const mismatchedPostings = openings.filter(
    (j) =>
      (j.Publish_Status === "External" || j.publish_status === "external") &&
      (j.Job_Status === "In-review" || j.job_status === "in_review" || j.visibility === "internal")
  );
  const results = mismatchedPostings.map((j) => ({
    resourceId: j.id || j.Job_Opening_Name,
    status: "fail",
    message: `Job opening "${j.Job_Opening_Name || j.id}" is marked internal but published to external/public channels`,
    evidencePayload: buildEvidencePayload({
      resourceType: "zoho_recruit_job_opening",
      resourceId: j.id || j.Job_Opening_Name,
      resourceName: j.Job_Opening_Name || String(j.id),
      region: null,
      details: { jobStatus: j.Job_Status, publishStatus: j.Publish_Status },
    }),
  }));
  if (results.length === 0) {
    results.push({
      resourceId: clients.orgId,
      status: "pass",
      message: "No job postings found with mismatched internal/external visibility settings",
      evidencePayload: buildEvidencePayload({
        resourceType: "zoho_recruit_org",
        resourceId: clients.orgId,
        resourceName: `Org ${clients.orgId}`,
        region: null,
        details: { openingsChecked: openings.length },
      }),
    });
  }
  return results;
}

export const recruitTests = [
  {
    key: "zoho.recruit.candidate_data_access_review",
    title: "Candidate data access is restricted by role",
    failTitle: "Recruit candidate data sharing rule allows org-wide access, not restricted to requisition assignment",
    severityDefault: "high",
    isoReferences: ["A.9.1.1"],
    dpdpaControlAreas: ["Access Control & Least Privilege"],
    run: (clients) => checkCandidateDataAccessReview(clients),
  },
  {
    key: "zoho.recruit.data_retention_policy_configured",
    title: "Candidate data retention/deletion policy is configured",
    failTitle: "Recruit does not have a candidate data retention/deletion policy configured",
    severityDefault: "medium",
    isoReferences: ["A.18.1.3"],
    dpdpaControlAreas: ["Retention Schedule"],
    run: (clients) => checkDataRetentionPolicyConfigured(clients),
  },
  {
    key: "zoho.recruit.job_posting_visibility_review",
    title: "Job posting visibility matches intended audience",
    failTitle: "Job opening is marked internal but published to external/public channels",
    severityDefault: "low",
    isoReferences: ["A.13.2.1"],
    dpdpaControlAreas: ["Access Control & Least Privilege"],
    run: (clients) => checkJobPostingVisibilityReview(clients),
  },
];
