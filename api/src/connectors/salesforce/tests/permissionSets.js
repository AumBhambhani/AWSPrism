import { buildEvidencePayload } from "../../shared/evidencePayload.js";

// Human-readable labels for the PermissionSet field names.
const PERMISSION_LABELS = {
  PermissionsModifyAllData: "Modify All Data",
  PermissionsViewAllData: "View All Data",
  PermissionsManageUsers: "Manage Users",
  PermissionsAuthorApex: "Author Apex",
};

const isActive = (v) => v === true || String(v).toLowerCase() === "true";

// ---------------------------------------------------------------------------
// salesforce.permissionset.sensitive_permissions_reviewed
// ---------------------------------------------------------------------------
// Sensitive system permissions (Modify All Data, View All Data, Manage Users,
// Author Apex) must be limited to a bounded, reviewed set of active assignees.
// The API exposes no "expected roster" field, so this is a bounded-count check:
// per sensitive permission, the count of distinct active users who hold it
// (through any profile or permission set) must not exceed the review threshold,
// and the full roster is surfaced in evidence.
async function checkSensitivePermissionsReviewed(clients) {
  const assignments = await clients.listPermissionSetAssignments();
  const sensitive = clients.SENSITIVE_PERMISSIONS;
  const threshold = clients.THRESHOLDS.SENSITIVE_PERMISSION_ASSIGNEE_THRESHOLD;

  if (!Array.isArray(assignments) || assignments.length === 0) {
    return [
      {
        resourceId: "permission-set-assignments",
        status: "not_applicable",
        message:
          "No permission-set assignments were returned — grant the integration user read access to " +
          "PermissionSetAssignment and PermissionSet to evidence this control.",
        evidencePayload: buildEvidencePayload({
          resourceType: "salesforce_permission_set",
          resourceId: "permission-set-assignments",
          resourceName: "Sensitive permission assignments",
          region: null,
          details: { assignments: 0 },
        }),
      },
    ];
  }

  // permission → Set of active assignee usernames
  const holdersByPermission = new Map(sensitive.map((p) => [p, new Map()]));
  for (const a of assignments) {
    const ps = a.PermissionSet || {};
    const assignee = a.Assignee || {};
    if (!isActive(assignee.IsActive)) continue;
    for (const perm of sensitive) {
      if (ps[perm] === true) {
        holdersByPermission.get(perm).set(a.AssigneeId, assignee.Username || a.AssigneeId);
      }
    }
  }

  const rows = [];
  for (const perm of sensitive) {
    const holders = holdersByPermission.get(perm);
    const roster = [...holders.values()];
    const label = PERMISSION_LABELS[perm] || perm;

    // A permission nobody holds isn't a finding — but "Modify All Data" held by
    // zero active users is implausible and usually means the assignment data
    // didn't resolve, so surface it as not_applicable rather than a silent pass.
    if (roster.length === 0) {
      rows.push({
        resourceId: perm,
        status: perm === "PermissionsModifyAllData" ? "not_applicable" : "pass",
        message:
          perm === "PermissionsModifyAllData"
            ? `No active user resolves as holding "${label}" — verify the permission-set assignment data is complete`
            : `No active user holds "${label}"`,
        evidencePayload: buildEvidencePayload({
          resourceType: "salesforce_permission_set",
          resourceId: perm,
          resourceName: label,
          region: null,
          details: { permission: label, activeHolders: 0, threshold },
        }),
      });
      continue;
    }

    rows.push({
      resourceId: perm,
      status: roster.length <= threshold ? "pass" : "fail",
      message:
        roster.length <= threshold
          ? `"${label}" is held by ${roster.length} active user(s) — within the review threshold of ${threshold}`
          : `"${label}" is held by ${roster.length} active users, exceeding the review threshold of ${threshold} — audit the assignments and remove any not tied to a documented business justification`,
      evidencePayload: buildEvidencePayload({
        resourceType: "salesforce_permission_set",
        resourceId: perm,
        resourceName: label,
        region: null,
        details: { permission: label, activeHolders: roster.length, threshold, roster },
      }),
    });
  }

  return rows;
}

export const permissionSetTests = [
  {
    key: "salesforce.permissionset.sensitive_permissions_reviewed",
    title: "Sensitive system permissions are limited to a reviewed set of assignees",
    failTitle: "A sensitive system permission is assigned more broadly than the review threshold",
    severityDefault: "high",
    isoReferences: ["A.9.2.3"],
    dpdpaControlAreas: ["Access Control"],
    run: (clients) => checkSensitivePermissionsReviewed(clients),
  },
];
