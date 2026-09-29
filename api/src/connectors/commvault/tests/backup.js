import { buildEvidencePayload } from "../../shared/evidencePayload.js";

// UNCONFIRMED (see the connector's credentials.js header): the CommCell-wide
// "Backup Health" SLA summary's real REST path was not confirmed during
// planning. Only the Active-Directory-specific ADDASHBOARD endpoint's response
// shape (`solutionSummary.slaSummary.{totalEntities, ...}`) was confirmed via
// cvpysdk's dashboard docs, which is the basis for this guess. Confirm against a
// live CommCell's Swagger UI before treating this check as production-ready;
// update this constant if wrong.
const SLA_DASHBOARD_ENDPOINT = "/dashboard?slaNumberOfDays=1"; // TODO CONFIRM

// A shape the check doesn't recognise degrades to `status: "error"` (a value the
// schema's CHECK constraint already allows) rather than a guessed pass/fail, so
// a wrong endpoint guess never ships false compliance evidence.
async function checkBackupSlaCompliance(clients) {
  const response = await clients.request(SLA_DASHBOARD_ENDPOINT);
  const slaSummary = response?.solutionSummary?.slaSummary;

  if (!slaSummary || typeof slaSummary.totalEntities !== "number") {
    return [
      {
        resourceId: "commcell",
        status: "error",
        message:
          "Commvault SLA dashboard response did not match the expected " +
          "solutionSummary.slaSummary shape — this endpoint/field mapping needs to be " +
          "reconfirmed against this CommCell's live Swagger UI before the check can be trusted.",
        evidencePayload: buildEvidencePayload({
          resourceType: "commvault_commcell",
          resourceId: "commcell",
          resourceName: "CommCell backup health",
          region: null,
          details: { rawResponseKeys: Object.keys(response || {}) },
        }),
      },
    ];
  }

  const slaNotMet = Number(slaSummary.slaNotMetEntities) || 0;
  const neverBackedUp = Number(slaSummary.neverBackedupEntities) || 0;
  const notMeetingSla = slaNotMet + neverBackedUp;
  const compliant = notMeetingSla === 0;

  return [
    {
      resourceId: "commcell",
      status: compliant ? "pass" : "fail",
      message: compliant
        ? `All ${slaSummary.totalEntities} monitored entities meet their backup SLA`
        : `${notMeetingSla} of ${slaSummary.totalEntities} monitored entities are missing their backup SLA`,
      evidencePayload: buildEvidencePayload({
        resourceType: "commvault_commcell",
        resourceId: "commcell",
        resourceName: "CommCell backup health",
        region: null,
        details: {
          totalEntities: slaSummary.totalEntities,
          slaNotMetEntities: slaNotMet,
          neverBackedupEntities: neverBackedUp,
        },
      }),
    },
  ];
}

export const backupTests = [
  {
    key: "commvault.backup.sla_compliance",
    title: "Monitored entities meet their backup SLA",
    failTitle: "Monitored entities are missing their backup SLA",
    severityDefault: "critical",
    isoReferences: ["A.12.3.1"],
    dpdpaControlAreas: ["Backup & Recovery"],
    run: (clients) => checkBackupSlaCompliance(clients.commvault),
  },
];

export { checkBackupSlaCompliance };
