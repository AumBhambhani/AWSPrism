import { buildEvidencePayload } from "../../shared/evidencePayload.js";

// UNCONFIRMED (connector plan Task 0, items 3-4): the Safesets OData collection
// path and its field names. The vendor's per-install Swagger UI is the only
// authoritative source and was unreachable during planning.
//   - path: `/odata/Safesets` is a guess (could be `/api/v1/Safesets`, etc.)
//   - `LastRunStatus` / `LastRunTime` are placeholder field names (could be
//     `Status`, `LastResult`, `CompletedUtc`, `EndTime`, ...)
// Any response shape or field the check doesn't recognise degrades to
// `status: "error"` (an allowed evidence_test_results.status) rather than a
// guessed pass/fail, so a wrong guess never ships false compliance evidence.
const SAFESETS_ENDPOINT = "/odata/Safesets"; // TODO CONFIRM

// A safeset whose most recent run is older than this is treated as stale even if
// that run "succeeded" — a backup that stopped running weeks ago is not
// protecting current data. Echoed into every evidence payload so a reviewer sees
// exactly what window was applied (there is no per-connection config store for
// connector thresholds yet — see crowdstrike/index.js's THRESHOLDS).
export const STALE_SAFESET_HOURS = 48;

// CONFIRMED convention only: OData collections wrap their rows in `value`.
// Everything about the rows themselves is unconfirmed.
const SUCCESS_TOKENS = new Set(["success", "completed", "completedwithwarnings", "ok"]);

function hoursSince(value) {
  const t = Date.parse(value);
  return Number.isNaN(t) ? null : (Date.now() - t) / 3_600_000;
}

function unrecognisedShapeRow(response) {
  return [
    {
      resourceId: "install",
      status: "error",
      message:
        "Carbonite Server Backup Safesets response did not match the expected OData " +
        "{ value: [...] } shape — this endpoint/field mapping needs to be reconfirmed against " +
        "this install's live Swagger UI before the check can be trusted (see the connector plan Task 0).",
      evidencePayload: buildEvidencePayload({
        resourceType: "carbonite_server_safeset",
        resourceId: "install",
        resourceName: "Carbonite Server Backup safesets",
        region: null,
        details: { rawResponseKeys: Object.keys(response || {}) },
      }),
    },
  ];
}

export async function checkRecentSuccessfulSafeset(carboniteServer) {
  const response = await carboniteServer.request(SAFESETS_ENDPOINT);
  const safesets = response?.value;

  if (!Array.isArray(safesets)) return unrecognisedShapeRow(response);

  if (safesets.length === 0) {
    return [
      {
        resourceId: "install",
        status: "not_applicable",
        message: "No safesets are monitored on this Carbonite Server Backup install",
        evidencePayload: buildEvidencePayload({
          resourceType: "carbonite_server_safeset",
          resourceId: "install",
          resourceName: "Carbonite Server Backup safesets",
          region: null,
          details: { safesets: 0, staleAfterHours: STALE_SAFESET_HOURS },
        }),
      },
    ];
  }

  return safesets.map((safeset) => {
    const resourceId = String(
      safeset?.Id ?? safeset?.SafesetId ?? safeset?.Name ?? safeset?.TaskName ?? "unknown"
    );
    const resourceName = String(safeset?.Name ?? safeset?.TaskName ?? resourceId);
    const rawStatus = safeset?.LastRunStatus ?? safeset?.Status ?? safeset?.LastResult;
    const lastRunTime = safeset?.LastRunTime ?? safeset?.CompletedUtc ?? safeset?.EndTime ?? null;

    const payload = (details) =>
      buildEvidencePayload({
        resourceType: "carbonite_server_safeset",
        resourceId,
        resourceName,
        region: null,
        details: { lastRunStatus: rawStatus ?? null, lastRunTime, staleAfterHours: STALE_SAFESET_HOURS, ...details },
      });

    if (rawStatus === undefined || rawStatus === null) {
      return {
        resourceId,
        status: "error",
        message:
          `Could not determine the last-run status for safeset "${resourceName}" — no known status field ` +
          `was present on this install's Safesets response. The field mapping needs live confirmation ` +
          `against the Swagger UI before this check can be trusted.`,
        evidencePayload: payload({ safesetKeys: Object.keys(safeset || {}) }),
      };
    }

    const succeeded = SUCCESS_TOKENS.has(String(rawStatus).toLowerCase());
    const ageHours = lastRunTime == null ? null : hoursSince(lastRunTime);
    const stale = ageHours != null && ageHours > STALE_SAFESET_HOURS;

    if (!succeeded) {
      return {
        resourceId,
        status: "fail",
        message: `Safeset "${resourceName}" — most recent run did not succeed (status: ${rawStatus})`,
        evidencePayload: payload({}),
      };
    }
    if (stale) {
      return {
        resourceId,
        status: "fail",
        message:
          `Safeset "${resourceName}" — last successful run was ${Math.round(ageHours)}h ago ` +
          `(> ${STALE_SAFESET_HOURS}h); the backup has stopped running`,
        evidencePayload: payload({ ageHours: Math.round(ageHours) }),
      };
    }
    if (ageHours == null) {
      return {
        resourceId,
        status: "fail",
        message:
          `Safeset "${resourceName}" reports its last run succeeded but has no last-run timestamp — ` +
          `recency cannot be confirmed`,
        evidencePayload: payload({}),
      };
    }
    return {
      resourceId,
      status: "pass",
      message: `Safeset "${resourceName}" completed successfully ${Math.round(ageHours)}h ago`,
      evidencePayload: payload({ ageHours: Math.round(ageHours) }),
    };
  });
}

export const backupTests = [
  {
    key: "carbonite-server.backup.recent_successful_safeset",
    title: "Safesets have a recent successful backup run",
    failTitle: "A safeset has a stale or failed most-recent backup run",
    severityDefault: "critical",
    isoReferences: ["A.12.3.1"],
    dpdpaControlAreas: ["Backup & Recovery"],
    run: (clients) => checkRecentSuccessfulSafeset(clients.carboniteServer),
  },
];
